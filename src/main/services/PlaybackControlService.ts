import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import { getDb } from '../database'
import {
  CommandScheduler,
  safeSong,
  searchLibrary,
  searchPlaylists,
  searchArtists,
  searchAlbums,
  type LibraryTrack
} from './playbackControlCore'
import { PlaylistService } from './PlaylistService'
import { DownloadService } from './DownloadService'

const SETTING_KEY = 'felo_external_playback_enabled'
const API_KEY_SETTING = 'felo_external_playback_api_key'
const STATUS_CHANNEL = 'external-player:status'
const COMMAND_CHANNEL = 'external-player:command'
const RESULT_CHANNEL = 'external-player:result'

type PlayerStatus = {
  ready: boolean
  playbackState: 'playing' | 'paused' | 'loading' | 'ended' | 'error' | 'stopped'
  isPlaying: boolean
  song: { id: string; title: string; artist: string; album: string; duration: number } | null
  position: number
  duration: number
  volume: number
  volumePercent?: number
  muted?: boolean
  outputMuted?: boolean
  queueLength?: number
  warnings?: string[]
  error?: string
}

type PendingCommand = { resolve: (value: unknown) => void; timer: NodeJS.Timeout }

function loopback(address?: string) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export class PlaybackControlService {
  private server: ReturnType<typeof createServer> | null = null
  private state: PlayerStatus = {
    ready: false,
    playbackState: 'stopped',
    isPlaying: false,
    song: null,
    position: 0,
    duration: 0,
    volume: 1
  }
  private token = ''
  private apiKey = ''
  private pending = new Map<string, PendingCommand>()
  private commands = new CommandScheduler()
  private port = 0
  private statusAt = 0
  private enabled = false
  private started = false
  private generation = 0

  private getOrCreateApiKey(): string {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(API_KEY_SETTING) as { value?: string } | undefined
    if (row?.value && typeof row.value === 'string' && row.value.startsWith('felo_sk_')) {
      this.apiKey = row.value
      return this.apiKey
    }
    this.apiKey = `felo_sk_${randomBytes(24).toString('hex')}`
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
      )
      .run(API_KEY_SETTING, this.apiKey)
    return this.apiKey
  }

  private regenerateApiKey(): string {
    this.apiKey = `felo_sk_${randomBytes(24).toString('hex')}`
    getDb()
      .prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
      )
      .run(API_KEY_SETTING, this.apiKey)
    return this.apiKey
  }

  private readonly onStatus = (_event: Electron.IpcMainEvent, status: PlayerStatus) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (
      !win ||
      _event.sender !== win.webContents ||
      !this.enabled ||
      !status ||
      typeof status.ready !== 'boolean' ||
      !['playing', 'paused', 'loading', 'ended', 'error', 'stopped'].includes(status.playbackState)
    )
      return
    this.state = {
      ...status,
      position: Math.max(0, Number(status.position) || 0),
      duration: Math.max(0, Number(status.duration) || 0),
      volume: Math.max(0, Math.min(1, Number(status.volume) || 0))
    }
    this.statusAt = Date.now()
    if (status.song) this.state.song = safeSong(status.song)
  }

  private readonly onResult = (
    event: Electron.IpcMainEvent,
    requestId: string,
    result: unknown
  ) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || event.sender !== win.webContents || typeof requestId !== 'string') return
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.resolve(result)
  }

  initialize(): void {
    this.getOrCreateApiKey()
    ipcMain.on(STATUS_CHANNEL, this.onStatus)
    ipcMain.on(RESULT_CHANNEL, this.onResult)
    ipcMain.handle('external-player:set-enabled', async (_event, enabled: boolean) => {
      if (typeof enabled !== 'boolean') throw new Error('Expected an enabled setting.')
      getDb()
        .prepare(
          "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
        )
        .run(SETTING_KEY, JSON.stringify(enabled))
      try {
        await this.setEnabled(enabled)
      } catch (error) {
        getDb()
          .prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          )
          .run(SETTING_KEY, JSON.stringify(false))
        this.stop()
        throw error
      }
      return { enabled: this.enabled, running: this.started }
    })
    ipcMain.handle('external-player:get-settings', () => ({
      enabled: this.enabled,
      running: this.started,
      port: this.port,
      apiKey: this.apiKey
    }))
    ipcMain.handle('external-player:get-api-key', () => ({
      apiKey: this.getOrCreateApiKey()
    }))
    ipcMain.handle('external-player:regenerate-api-key', () => ({
      apiKey: this.regenerateApiKey()
    }))
    ipcMain.handle('external-player:get-client-configs', () => {
      const apiKey = this.getOrCreateApiKey()
      const pythonScript = this.getHelperPath()
      const nodeScript = this.getNodeHelperPath()
      const hasNodeScript = fs.existsSync(nodeScript)
      const primaryScript = hasNodeScript ? nodeScript : pythonScript
      const primaryCommand = hasNodeScript ? 'node' : 'python'

      return {
        apiKey,
        port: this.port,
        running: this.started,
        hermes: `mcp_servers:\n  felo:\n    command: "${primaryCommand}"\n    args: [${JSON.stringify(primaryScript)}, "mcp"]\n`,
        claudeDesktop: JSON.stringify(
          {
            mcpServers: {
              felo: {
                command: primaryCommand,
                args: [primaryScript, 'mcp'],
                env: {
                  FELO_API_KEY: apiKey
                }
              }
            }
          },
          null,
          2
        ),
        cursor: JSON.stringify(
          {
            mcpServers: {
              felo: {
                command: primaryCommand,
                args: [primaryScript, 'mcp']
              }
            }
          },
          null,
          2
        ),
        windsurf: JSON.stringify(
          {
            mcpServers: {
              felo: {
                command: primaryCommand,
                args: [primaryScript, 'mcp']
              }
            }
          },
          null,
          2
        )
      }
    })
    ipcMain.handle('external-player:copy-hermes-config', async () => {
      if (!this.enabled || !this.started) throw new Error('Enable Felo control first.')
      const { clipboard } = await import('electron')
      const nodeScript = this.getNodeHelperPath()
      const script = fs.existsSync(nodeScript) ? nodeScript : this.getHelperPath()
      const cmd = fs.existsSync(nodeScript) ? 'node' : 'python'
      const config = `mcp_servers:
  felo:
    command: "${cmd}"
    args: [${JSON.stringify(script)}, "mcp"]
`
      clipboard.writeText(config)
      return config
    })
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY) as
      { value?: string } | undefined
    try {
      if (row?.value && JSON.parse(row.value) === true)
        void this.setEnabled(true).catch((error) =>
          console.warn('Felo playback control did not start:', error)
        )
    } catch {
      /* Ignore invalid preference values. */
    }
  }

  private getHelperPath(): string {
    const candidates = [
      path.join(process.resourcesPath, 'hermes', 'felo-control.py'),
      path.resolve(process.cwd(), 'resources', 'hermes', 'felo-control.py')
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
  }

  private getNodeHelperPath(): string {
    const candidates = [
      path.join(process.resourcesPath, 'hermes', 'felo-control.mjs'),
      path.resolve(process.cwd(), 'resources', 'hermes', 'felo-control.mjs')
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (!enabled) {
      this.stop()
      return
    }
    if (this.started) return
    this.token = randomBytes(32).toString('hex')
    const server = createServer((request, response) => void this.handle(request, response))
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('Unable to bind Felo control API.')
      this.port = address.port
      const directory = path.join(path.dirname(getDb().name), 'hermes-control')
      fs.mkdirSync(directory, { recursive: true })
      const record = path.join(directory, 'connection.json')
      const temporary = `${record}.${process.pid}.tmp`
      fs.writeFileSync(
        temporary,
        JSON.stringify({ port: this.port, token: this.token, protocolVersion: 1 }),
        { mode: 0o600 }
      )
      fs.renameSync(temporary, record)
      this.started = true
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    this.generation++
    this.started = false
    this.enabled = false
    this.port = 0
    this.token = ''
    this.state.ready = false
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ error: 'CONTROL_DISABLED' })
    }
    this.pending.clear()
    this.commands.reset()
    const directory = path.join(path.dirname(getDb().name), 'hermes-control')
    try {
      fs.rmSync(path.join(directory, 'connection.json'), { force: true })
    } catch {
      /* best effort */
    }
    if (this.server?.listening) this.server.close()
    this.server = null
  }

  private sendCommand(
    command: Record<string, unknown>,
    deadline = Date.now() + 12_000
  ): Promise<any> {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed() || !this.state.ready || Date.now() - this.statusAt >= 4_000)
      throw new Error('PLAYER_NOT_READY')
    const requestId = randomBytes(16).toString('hex')
    const generation = this.generation
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId)
          reject(
            new Error(
              generation === this.generation
                ? 'PLAYBACK_FAILED: command timed out; check status before retrying.'
                : 'CONTROL_DISABLED'
            )
          )
        },
        Math.max(1, deadline - Date.now())
      )
      this.pending.set(requestId, { resolve, timer })
      win.webContents.send(COMMAND_CHANNEL, { requestId, command, deadline })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
    const reply = (status: number, data: unknown) => {
      response.writeHead(status, headers)
      response.end(JSON.stringify(data))
    }
    if (!this.enabled || !this.started) return reply(503, { error: 'CONTROL_DISABLED' })
    if (
      !loopback(request.socket.remoteAddress) ||
      request.headers.host !== `127.0.0.1:${this.port}`
    )
      return reply(403, { error: 'LOCAL_ONLY' })
    const authorization = request.headers.authorization || ''
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    const suppliedBuf = Buffer.from(supplied)
    const tokenBuf = Buffer.from(this.token)
    const apiKeyBuf = Buffer.from(this.apiKey)
    const isTokenValid = Boolean(
      this.token && suppliedBuf.length === tokenBuf.length && timingSafeEqual(suppliedBuf, tokenBuf)
    )
    const isApiKeyValid = Boolean(
      this.apiKey &&
        suppliedBuf.length === apiKeyBuf.length &&
        timingSafeEqual(suppliedBuf, apiKeyBuf)
    )
    if (!isTokenValid && !isApiKeyValid) return reply(401, { error: 'UNAUTHORIZED' })
    const url = new URL(request.url || '/', `http://127.0.0.1:${this.port}`)
    const method = request.method || 'GET'
    try {
      if (method === 'GET' && url.pathname === '/v1/status')
        return reply(200, {
          ...this.state,
          ready: this.state.ready && Date.now() - this.statusAt < 4_000,
          enabled: this.enabled,
          apiVersion: 2,
          statusAgeMs: this.statusAt ? Date.now() - this.statusAt : null
        })
      if (method === 'GET' && url.pathname === '/v1/player/queue') {
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
        const limit = Math.max(
          1,
          Math.min(50, Math.floor(Number(url.searchParams.get('limit')) || 20))
        )
        const result = await this.sendCommand({ type: 'queue', offset, limit })
        return reply(result.error ? 409 : 200, result)
      }
      if (method === 'GET' && url.pathname === '/v1/library/search') {
        const query = (url.searchParams.get('q') || '').trim().slice(0, 160)
        const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120)
        const limit = Math.max(
          1,
          Math.min(20, Math.floor(Number(url.searchParams.get('limit')) || 10))
        )
        const songs = getDb()
          .prepare(
            `SELECT s.id, s.title, s.artist, s.album, s.duration, s.filePath,
                    GROUP_CONCAT(a.name, ' ') as allArtists
             FROM songs s
             LEFT JOIN song_artists sa ON sa.songId = s.id
             LEFT JOIN artists a ON a.id = sa.artistId
             WHERE s.filePath IS NOT NULL AND s.filePath != '' AND s.filePath NOT LIKE 'virtual:%'
             GROUP BY s.id`
          )
          .all() as LibraryTrack[]
        return reply(200, searchLibrary(songs, query, artist, limit, fs.existsSync))
      }
      if (method === 'GET' && url.pathname === '/v1/library/playlists') {
        const query = (url.searchParams.get('q') || '').trim()
        const limit = Math.max(
          1,
          Math.min(50, Math.floor(Number(url.searchParams.get('limit')) || 20))
        )
        const playlists = (PlaylistService.getPlaylists() as any[]) || []
        return reply(200, searchPlaylists(playlists, query, limit))
      }
      if (method === 'GET' && url.pathname === '/v1/library/artists') {
        const query = (url.searchParams.get('q') || '').trim()
        const limit = Math.max(
          1,
          Math.min(50, Math.floor(Number(url.searchParams.get('limit')) || 20))
        )
        const artists =
          (getDb()
            .prepare(
              "SELECT a.id, a.name, COUNT(s.id) as songCount FROM artists a LEFT JOIN songs s ON s.artistId = a.id WHERE s.filePath IS NOT NULL AND s.filePath != '' AND s.filePath NOT LIKE 'virtual:%' GROUP BY a.id ORDER BY a.name ASC"
            )
            .all() as any[]) || []
        return reply(200, searchArtists(artists, query, limit))
      }
      if (method === 'GET' && url.pathname === '/v1/library/albums') {
        const query = (url.searchParams.get('q') || '').trim()
        const limit = Math.max(
          1,
          Math.min(50, Math.floor(Number(url.searchParams.get('limit')) || 20))
        )
        const albums =
          (getDb()
            .prepare(
              "SELECT al.id, al.title, ar.name as artist, COUNT(s.id) as songCount FROM albums al LEFT JOIN artists ar ON ar.id = al.artistId LEFT JOIN songs s ON s.albumId = al.id WHERE s.filePath IS NOT NULL AND s.filePath != '' AND s.filePath NOT LIKE 'virtual:%' GROUP BY al.id ORDER BY al.title ASC"
            )
            .all() as any[]) || []
        return reply(200, searchAlbums(albums, query, limit))
      }
      if (method === 'POST' && url.pathname === '/v1/library/download') {
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          bytes += chunk.length
          if (bytes > 4096) return reply(413, { error: 'REQUEST_TOO_LARGE' })
          chunks.push(Buffer.from(chunk))
        }
        let body: any
        try {
          body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        } catch {
          return reply(400, { error: 'INVALID_JSON' })
        }
        const query = typeof body.query === 'string' ? body.query.trim().slice(0, 160) : ''
        const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 120) : ''
        if (!query) return reply(400, { error: 'QUERY_REQUIRED' })

        try {
          const song = await DownloadService.acquireAndDownload(query, artist)
          if (!song) return reply(404, { error: 'DOWNLOAD_FAILED' })

          if (body.play !== false) {
            const playResult = await this.sendCommand({ type: 'play-song', song })
            return reply(200, { ok: true, song: safeSong(song), state: playResult?.state || this.state })
          }
          return reply(200, { ok: true, song: safeSong(song), state: this.state })
        } catch (downloadErr: any) {
          return reply(409, {
            error: downloadErr?.message || 'DOWNLOAD_FAILED',
            message: downloadErr instanceof Error ? downloadErr.message : String(downloadErr)
          })
        }
      }
      if (method === 'POST' && url.pathname.startsWith('/v1/player/')) {
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          bytes += chunk.length
          if (bytes > 4096) return reply(413, { error: 'REQUEST_TOO_LARGE' })
          chunks.push(Buffer.from(chunk))
        }
        let body: any
        try {
          body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
        } catch {
          return reply(400, { error: 'INVALID_JSON' })
        }
        if (typeof body !== 'object' || body === null || Array.isArray(body))
          return reply(400, { error: 'INVALID_INPUT' })
        const requestId =
          typeof body.requestId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)
            ? body.requestId
            : ''
        if (!requestId) return reply(400, { error: 'REQUEST_ID_REQUIRED' })

        const isAutoDownload = Boolean(body.query && body.auto_download !== false)
        const timeoutMs = isAutoDownload ? 90_000 : 20_000

        const result = await this.commands.run(
          requestId,
          JSON.stringify([
            url.pathname,
            Object.keys(body)
              .sort()
              .map((key) => [key, body[key]])
          ]),
          async (deadline) => {
            let command: Record<string, unknown>
            if (url.pathname === '/v1/player/play' || url.pathname === '/v1/player/enqueue') {
              if (
                body.song_id !== undefined &&
                (typeof body.song_id !== 'string' || !body.song_id || body.song_id.length > 80)
              )
                throw new Error('INVALID_SONG_ID')
              const songId = typeof body.song_id === 'string' ? body.song_id.slice(0, 80) : ''
              let song = songId
                ? (getDb()
                    .prepare("SELECT * FROM songs WHERE id = ? AND filePath NOT LIKE 'virtual:%'")
                    .get(songId) as any)
                : undefined

              const query = typeof body.query === 'string' ? body.query.trim().slice(0, 160) : ''
              const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 120) : ''
              const autoDownload = body.auto_download !== false

              if (!song && query) {
                const localSongs = getDb()
                  .prepare(
                    `SELECT s.id, s.title, s.artist, s.album, s.duration, s.filePath,
                            GROUP_CONCAT(a.name, ' ') as allArtists
                     FROM songs s
                     LEFT JOIN song_artists sa ON sa.songId = s.id
                     LEFT JOIN artists a ON a.id = sa.artistId
                     WHERE s.filePath IS NOT NULL AND s.filePath != '' AND s.filePath NOT LIKE 'virtual:%'
                     GROUP BY s.id`
                  )
                  .all() as LibraryTrack[]
                const search = searchLibrary(localSongs, query, artist, 10, fs.existsSync)
                if (search.suggestedSongId) {
                  song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(search.suggestedSongId) as any
                }
              }

              if (!song && query && autoDownload) {
                song = await DownloadService.acquireAndDownload(query, artist)
              }

              if (songId && !song) throw new Error('SONG_NOT_FOUND')
              if (song && (!song.filePath || !fs.existsSync(song.filePath))) throw new Error('FILE_UNAVAILABLE')
              if (url.pathname === '/v1/player/enqueue') {
                if (!song) throw new Error('SONG_ID_REQUIRED')
                return this.sendCommand({ type: 'enqueue', song }, deadline)
              }
              if (
                body.volume_percent !== undefined &&
                (!Number.isInteger(body.volume_percent) ||
                  body.volume_percent < 0 ||
                  body.volume_percent > 100)
              )
                throw new Error('INVALID_VOLUME')
              if (!song && !this.state.song && !this.state.queueLength) {
                const candidates = getDb()
                  .prepare(
                    "SELECT * FROM songs WHERE filePath NOT LIKE 'virtual:%' ORDER BY dateAdded DESC LIMIT 200"
                  )
                  .all() as any[]
                const first = candidates.find((candidate) => fs.existsSync(candidate.filePath))
                if (!first) throw new Error('NO_PLAYABLE_TRACKS')
                command = { type: 'play-song', song: first }
              } else command = song ? { type: 'play-song', song } : { type: 'play' }
              command.volumePercent = body.volume_percent
            } else if (url.pathname === '/v1/player/play-playlist') {
              const playlistId = typeof body.playlist_id === 'string' ? body.playlist_id.trim() : ''
              const query = typeof body.query === 'string' ? body.query.trim() : ''
              let playlist: any = null
              if (playlistId) {
                playlist = PlaylistService.getPlaylist(playlistId)
              } else if (query) {
                const search = searchPlaylists(PlaylistService.getPlaylists() as any[], query, 1)
                if (search.suggestedPlaylistId) {
                  playlist = PlaylistService.getPlaylist(search.suggestedPlaylistId)
                }
              }
              if (!playlist) throw new Error('PLAYLIST_NOT_FOUND')
              const rawSongs =
                (getDb()
                  .prepare(
                    "SELECT s.* FROM playlist_items pi JOIN songs s ON s.id = pi.songId WHERE pi.playlistId = ? AND s.filePath IS NOT NULL AND s.filePath != '' AND s.filePath NOT LIKE 'virtual:%' ORDER BY pi.sortOrder ASC, pi.dateAdded ASC"
                  )
                  .all(playlist.id) as any[]) || []
              const playable = rawSongs.filter((song) => fs.existsSync(song.filePath))
              if (!playable.length) throw new Error('NO_PLAYABLE_TRACKS')
              command = {
                type: 'play-playlist',
                songs: playable,
                shuffle: Boolean(body.shuffle),
                playlistName: playlist.name
              }
            } else if (url.pathname === '/v1/player/play-collection') {
              const collection = String(body.collection || 'favorites')
              const limit = Math.max(1, Math.min(100, Number(body.limit) || 50))
              let sql = ''
              if (collection === 'favorites') {
                sql =
                  "SELECT * FROM songs WHERE isFavorite = 1 AND filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%' ORDER BY dateAdded DESC LIMIT ?"
              } else if (collection === 'recent') {
                sql =
                  "SELECT * FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%' ORDER BY dateAdded DESC LIMIT ?"
              } else if (collection === 'top') {
                sql =
                  "SELECT * FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%' ORDER BY playCount DESC, dateAdded DESC LIMIT ?"
              } else {
                throw new Error('INVALID_COLLECTION')
              }
              const candidates = (getDb().prepare(sql).all(limit) as any[]) || []
              const playable = candidates.filter((song) => fs.existsSync(song.filePath))
              if (!playable.length) throw new Error('NO_PLAYABLE_TRACKS')
              command = {
                type: 'play-collection',
                songs: playable,
                shuffle: Boolean(body.shuffle),
                collection
              }
            } else if (url.pathname === '/v1/player/play-artist') {
              const artistId = typeof body.artist_id === 'string' ? body.artist_id.trim() : ''
              const query = typeof body.query === 'string' ? body.query.trim() : ''
              let artistName = ''
              let artistRow: any = null
              if (artistId) {
                artistRow = getDb().prepare('SELECT * FROM artists WHERE id = ?').get(artistId)
                if (artistRow) artistName = artistRow.name
              } else if (query) {
                const allArtists =
                  (getDb().prepare('SELECT id, name FROM artists').all() as any[]) || []
                const search = searchArtists(allArtists, query, 1)
                if (search.suggestedArtistId) {
                  artistRow = allArtists.find((a) => a.id === search.suggestedArtistId)
                  if (artistRow) artistName = artistRow.name
                } else {
                  artistName = query
                }
              }
              if (!artistName) throw new Error('ARTIST_NOT_FOUND')
              const candidates =
                (getDb()
                  .prepare(
                    "SELECT * FROM songs WHERE (artistId = ? OR artist LIKE ?) AND filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%' ORDER BY playCount DESC, dateAdded DESC LIMIT 100"
                  )
                  .all(artistRow?.id || '', `%${artistName}%`) as any[]) || []
              const playable = candidates.filter((song) => fs.existsSync(song.filePath))
              if (!playable.length) throw new Error('NO_PLAYABLE_TRACKS')
              command = {
                type: 'play-artist',
                songs: playable,
                shuffle: Boolean(body.shuffle),
                artistName
              }
            } else if (url.pathname === '/v1/player/play-album') {
              const albumId = typeof body.album_id === 'string' ? body.album_id.trim() : ''
              const query = typeof body.query === 'string' ? body.query.trim() : ''
              let albumTitle = ''
              let albumRow: any = null
              if (albumId) {
                albumRow = getDb().prepare('SELECT * FROM albums WHERE id = ?').get(albumId)
                if (albumRow) albumTitle = albumRow.title
              } else if (query) {
                const allAlbums =
                  (getDb().prepare('SELECT id, title FROM albums').all() as any[]) || []
                const search = searchAlbums(allAlbums, query, 1)
                if (search.suggestedAlbumId) {
                  albumRow = allAlbums.find((a) => a.id === search.suggestedAlbumId)
                  if (albumRow) albumTitle = albumRow.title
                } else {
                  albumTitle = query
                }
              }
              if (!albumTitle) throw new Error('ALBUM_NOT_FOUND')
              const candidates =
                (getDb()
                  .prepare(
                    "SELECT * FROM songs WHERE (albumId = ? OR album LIKE ?) AND filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%' ORDER BY trackNumber ASC, dateAdded ASC LIMIT 100"
                  )
                  .all(albumRow?.id || '', `%${albumTitle}%`) as any[]) || []
              const playable = candidates.filter((song) => fs.existsSync(song.filePath))
              if (!playable.length) throw new Error('NO_PLAYABLE_TRACKS')
              command = {
                type: 'play-album',
                songs: playable,
                shuffle: Boolean(body.shuffle),
                albumTitle
              }
            } else if (url.pathname === '/v1/player/pause') command = { type: 'pause' }
            else if (url.pathname === '/v1/player/next') command = { type: 'next' }
            else if (url.pathname === '/v1/player/previous') command = { type: 'previous' }
            else if (url.pathname === '/v1/player/volume') {
              if (!Number.isInteger(body.percent) || body.percent < 0 || body.percent > 100)
                throw new Error('INVALID_VOLUME')
              command = { type: 'volume', percent: body.percent }
            } else if (url.pathname === '/v1/player/remove') {
              if (typeof body.song_id !== 'string' || !body.song_id || body.song_id.length > 80)
                throw new Error('INVALID_SONG_ID')
              command = { type: 'remove', songId: body.song_id }
            } else if (url.pathname === '/v1/player/seek') {
              if (
                typeof body.seconds !== 'number' ||
                !Number.isFinite(body.seconds) ||
                body.seconds < 0
              )
                throw new Error('INVALID_POSITION')
              command = { type: 'seek', seconds: body.seconds }
            } else if (url.pathname === '/v1/player/mode') {
              if (body.shuffle === undefined && body.repeat === undefined)
                throw new Error('MODE_REQUIRED')
              if (body.shuffle !== undefined && typeof body.shuffle !== 'boolean')
                throw new Error('INVALID_SHUFFLE')
              if (body.repeat !== undefined && !['off', 'all', 'one'].includes(body.repeat))
                throw new Error('INVALID_REPEAT')
              command = { type: 'mode', shuffle: body.shuffle, repeat: body.repeat }
            } else throw new Error('UNKNOWN_COMMAND')
            return this.sendCommand(command, deadline)
          },
          timeoutMs
        )
        if (result && typeof result === 'object') result.requestId = requestId
        return reply(result?.error ? 409 : 200, result)
      }
      return reply(404, { error: 'NOT_FOUND' })
    } catch (error) {
      if (!response.headersSent) {
        const errorCode = error instanceof Error ? error.message : 'PLAYBACK_FAILED'
        reply(errorCode.startsWith('INVALID_') ? 400 : 409, { error: errorCode })
      }
    }
  }
}
