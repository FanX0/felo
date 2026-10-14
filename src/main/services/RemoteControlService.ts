import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow, ipcMain, app } from 'electron'
import QRCode from 'qrcode'
import { getDb } from '../database'
import { CommandScheduler, searchLibrary, type LibraryTrack } from './playbackControlCore'
import { isPathAllowedForMedia } from '../index'

const REMOTE_SETTING_KEY = 'felo_remote_control_enabled'
const REMOTE_TOKEN_KEY = 'felo_remote_control_token'
const STATUS_CHANNEL = 'external-player:status'
const COMMAND_CHANNEL = 'external-player:command'
const RESULT_CHANNEL = 'external-player:result'

const DEFAULT_PORT = 4788

export type RemotePlayerStatus = {
  ready: boolean
  playbackState: 'playing' | 'paused' | 'loading' | 'ended' | 'error' | 'stopped'
  isPlaying: boolean
  song: {
    id: string
    title: string
    artist: string
    album: string
    duration: number
    artworkPath?: string
    artworkUrl?: string
  } | null
  position: number
  duration: number
  volume: number
  volumePercent?: number
  muted?: boolean
  outputMuted?: boolean
  queueLength?: number
  queueIndex?: number
  shuffle?: boolean
  repeat?: 'off' | 'all' | 'one'
  deviceName?: string
  connectedClients?: number
}

type PendingCommand = { resolve: (value: unknown) => void; timer: NodeJS.Timeout }

export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces()
  // Prefer standard Wi-Fi / Ethernet IPv4 non-internal interfaces
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || []
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Exclude virtual/docker/WSL adapters if possible, but keep standard 192.168 / 10. / 172.
        if (
          !name.toLowerCase().includes('virtual') &&
          !name.toLowerCase().includes('pseudo') &&
          !name.toLowerCase().includes('loopback')
        ) {
          return iface.address
        }
      }
    }
  }

  // Fallback to any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || []
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }

  return '127.0.0.1'
}

export class RemoteControlService {
  private server: ReturnType<typeof createServer> | null = null
  private enabled = false
  private started = false
  private port = DEFAULT_PORT
  private token = ''
  private ipAddress = '127.0.0.1'
  private sseClients = new Set<ServerResponse>()
  private commands = new CommandScheduler()
  private pending = new Map<string, PendingCommand>()
  private generation = 0
  private state: RemotePlayerStatus = {
    ready: false,
    playbackState: 'stopped',
    isPlaying: false,
    song: null,
    position: 0,
    duration: 0,
    volume: 1,
    volumePercent: 100,
    shuffle: false,
    repeat: 'off',
    queueLength: 0,
    queueIndex: 0,
    deviceName: os.hostname() || 'Felo Desktop',
    connectedClients: 0
  }

  private readonly onStatus = (_event: Electron.IpcMainEvent, status: any) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || _event.sender !== win.webContents || !status) return

    const previousSongId = this.state.song?.id
    const previousState = this.state.playbackState
    const previousIsPlaying = this.state.isPlaying
    const previousPosition = this.state.position

    this.state = {
      ...this.state,
      ready: Boolean(status.ready),
      playbackState: status.playbackState || 'stopped',
      isPlaying: Boolean(status.isPlaying),
      position: Math.max(0, Number(status.position) || 0),
      duration: Math.max(0, Number(status.duration) || 0),
      volume: Math.max(0, Math.min(1, Number(status.volume) ?? 1)),
      volumePercent: status.volumePercent ?? Math.round((status.volume ?? 1) * 100),
      muted: Boolean(status.muted),
      outputMuted: Boolean(status.outputMuted),
      queueLength: Number(status.queueLength) || 0,
      queueIndex: Number(status.queueIndex) || 0,
      shuffle: Boolean(status.shuffle),
      repeat: status.repeat || 'off',
      deviceName: os.hostname() || 'Felo Desktop',
      connectedClients: this.sseClients.size
    }

    if (status.song) {
      const songId = String(status.song.id)
      this.state.song = {
        id: songId,
        title: String(status.song.title || 'Unknown title'),
        artist: String(status.song.artist || 'Unknown artist'),
        album: String(status.song.album || ''),
        duration: Number(status.song.duration || 0),
        artworkPath: status.song.artworkPath,
        artworkUrl: `/v1/artwork/${encodeURIComponent(songId)}?token=${this.token}`
      }
    } else {
      this.state.song = null
    }

    // Broadcast update to connected phone clients via SSE
    if (
      this.sseClients.size > 0 &&
      (previousSongId !== this.state.song?.id ||
        previousState !== this.state.playbackState ||
        previousIsPlaying !== this.state.isPlaying ||
        Math.abs(this.state.position - previousPosition) >= 1)
    ) {
      this.broadcastStatus()
    }
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
    ipcMain.on(STATUS_CHANNEL, this.onStatus)
    ipcMain.on(RESULT_CHANNEL, this.onResult)

    ipcMain.handle('remote-control:get-info', async () => {
      return this.getConnectionInfo()
    })

    ipcMain.handle('remote-control:set-enabled', async (_event, enabled: boolean) => {
      if (typeof enabled !== 'boolean') throw new Error('Expected boolean enabled flag.')
      const db = getDb()
      db.prepare(
        "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
      ).run(REMOTE_SETTING_KEY, JSON.stringify(enabled))

      await this.setEnabled(enabled)
      return this.getConnectionInfo()
    })

    ipcMain.handle('remote-control:regenerate-token', async () => {
      this.token = randomBytes(16).toString('hex')
      getDb()
        .prepare(
          "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
        )
        .run(REMOTE_TOKEN_KEY, JSON.stringify(this.token))

      // Disconnect previous clients to require reconnecting with the new token
      for (const client of this.sseClients) {
        try {
          client.end('event: revoked\ndata: {}\n\n')
        } catch {
          // ignore
        }
      }
      this.sseClients.clear()
      this.state.connectedClients = 0

      return this.getConnectionInfo()
    })

    // Load persisted settings
    try {
      const db = getDb()
      const tokenRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(REMOTE_TOKEN_KEY) as
        | { value?: string }
        | undefined
      if (tokenRow?.value) {
        this.token = JSON.parse(tokenRow.value)
      } else {
        this.token = randomBytes(16).toString('hex')
        db.prepare(
          "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
        ).run(REMOTE_TOKEN_KEY, JSON.stringify(this.token))
      }

      const enabledRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(REMOTE_SETTING_KEY) as
        | { value?: string }
        | undefined
      // Default enabled to true so remote control is ready immediately for phone pairing
      const shouldEnable = enabledRow?.value ? JSON.parse(enabledRow.value) === true : true
      if (shouldEnable) {
        void this.setEnabled(true).catch((err) =>
          console.warn('Felo Remote Control service failed to start:', err)
        )
      }
    } catch (e) {
      console.warn('Error reading remote control settings:', e)
    }
  }

  async getConnectionInfo(): Promise<{
    enabled: boolean
    running: boolean
    port: number
    ip: string
    token: string
    url: string
    qrDataUrl: string
    cloudflareUrl: string
    cloudflareQrDataUrl: string
    connectedClients: number
  }> {
    this.ipAddress = getLocalIpAddress()
    const url = `http://${this.ipAddress}:${this.port}/#remote?token=${this.token}`
    const cloudflareUrl = `https://felo.feloapp.workers.dev/#remote?host=${encodeURIComponent(
      `http://${this.ipAddress}:${this.port}`
    )}&token=${encodeURIComponent(this.token)}`

    let qrDataUrl = ''
    let cloudflareQrDataUrl = ''

    try {
      qrDataUrl = await QRCode.toDataURL(url, {
        margin: 2,
        scale: 7,
        color: { dark: '#000000', light: '#ffffff' }
      })
    } catch (e) {
      console.error('Failed to generate local QR code data URL:', e)
    }

    try {
      cloudflareQrDataUrl = await QRCode.toDataURL(cloudflareUrl, {
        margin: 2,
        scale: 7,
        color: { dark: '#000000', light: '#ffffff' }
      })
    } catch (e) {
      console.error('Failed to generate Cloudflare QR code data URL:', e)
    }

    return {
      enabled: this.enabled,
      running: this.started,
      port: this.port,
      ip: this.ipAddress,
      token: this.token,
      url,
      qrDataUrl,
      cloudflareUrl,
      cloudflareQrDataUrl,
      connectedClients: this.sseClients.size
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (!enabled) {
      this.stop()
      return
    }
    if (this.started) return

    this.ipAddress = getLocalIpAddress()
    const server = createServer((req, res) => void this.handleRequest(req, res))
    this.server = server

    const tryListen = (port: number): Promise<number> => {
      return new Promise((resolve, reject) => {
        server.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
            resolve(tryListen(port + 1))
          } else {
            reject(err)
          }
        })
        server.listen(port, '0.0.0.0', () => {
          resolve(port)
        })
      })
    }

    try {
      this.port = await tryListen(DEFAULT_PORT)
      this.started = true
      console.log(`[Felo Remote] Listening on http://0.0.0.0:${this.port} (LAN: http://${this.ipAddress}:${this.port})`)
    } catch (error) {
      this.stop()
      throw error
    }
  }

  stop(): void {
    this.generation++
    this.started = false
    this.enabled = false
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ error: 'CONTROL_DISABLED' })
    }
    this.pending.clear()
    this.commands.reset()

    for (const client of this.sseClients) {
      try {
        client.end('event: close\ndata: {}\n\n')
      } catch {
        // ignore
      }
    }
    this.sseClients.clear()
    this.state.connectedClients = 0

    if (this.server?.listening) {
      this.server.close()
    }
    this.server = null
  }

  private broadcastStatus(): void {
    if (!this.sseClients.size) return
    const payload = `data: ${JSON.stringify(this.state)}\n\n`
    for (const client of this.sseClients) {
      try {
        client.write(payload)
      } catch {
        this.sseClients.delete(client)
      }
    }
    this.state.connectedClients = this.sseClients.size
  }

  private sendCommand(command: Record<string, unknown>, deadline = Date.now() + 7_000): Promise<any> {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) throw new Error('PLAYER_NOT_READY')
    const requestId = `remote-${randomBytes(16).toString('hex')}`
    const generation = this.generation

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(generation === this.generation ? 'PLAYBACK_TIMEOUT' : 'CONTROL_DISABLED'))
      }, Math.max(1, deadline - Date.now()))

      this.pending.set(requestId, { resolve, timer })
      win.webContents.send(COMMAND_CHANNEL, { requestId, command, deadline })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store'
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    const reply = (status: number, data: unknown, extraHeaders: Record<string, string> = {}) => {
      res.writeHead(status, {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        ...extraHeaders
      })
      res.end(JSON.stringify(data))
    }

    const host = req.headers.host || `localhost:${this.port}`
    const parsedUrl = new URL(req.url || '/', `http://${host}`)
    const pathname = parsedUrl.pathname
    const method = req.method || 'GET'

    // Check token authentication for protected API endpoints
    const authHeader = req.headers.authorization || ''
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    const queryToken = parsedUrl.searchParams.get('token') || ''
    const providedToken = bearerToken || queryToken
    const providedBuf = Buffer.from(providedToken)
    const tokenBuf = Buffer.from(this.token)
    const isTokenValid = Boolean(
      this.token &&
        providedBuf.length === tokenBuf.length &&
        timingSafeEqual(providedBuf, tokenBuf)
    )

    // Static assets & web client do not strictly require token to download HTML/JS/CSS,
    // but the app on the phone stores and sends the token for all API and SSE calls.
    const isApiRequest = pathname.startsWith('/v1/')

    if (isApiRequest && !isTokenValid) {
      return reply(401, { error: 'UNAUTHORIZED', message: 'Valid token required.' })
    }

    try {
      // 1. SSE Events stream
      if (method === 'GET' && pathname === '/v1/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        })

        this.sseClients.add(res)
        this.state.connectedClients = this.sseClients.size

        // Send initial full state immediately
        res.write(`data: ${JSON.stringify(this.state)}\n\n`)

        // Keepalive interval
        const keepAlive = setInterval(() => {
          try {
            res.write(': keep-alive\n\n')
          } catch {
            clearInterval(keepAlive)
          }
        }, 15_000)

        req.on('close', () => {
          clearInterval(keepAlive)
          this.sseClients.delete(res)
          this.state.connectedClients = this.sseClients.size
        })
        return
      }

      // 2. Status snapshot
      if (method === 'GET' && pathname === '/v1/status') {
        return reply(200, {
          ...this.state,
          connectedClients: this.sseClients.size
        })
      }

      // 3. Album artwork proxy
      if (method === 'GET' && pathname.startsWith('/v1/artwork/')) {
        const songId = decodeURIComponent(pathname.replace('/v1/artwork/', ''))
        return this.handleArtworkRequest(songId, res, corsHeaders)
      }

      // 3b. Audio streaming with HTTP Range support for mobile playback (supports GET & HEAD)
      if ((method === 'GET' || method === 'HEAD') && pathname.startsWith('/v1/audio/')) {
        const songId = decodeURIComponent(pathname.replace('/v1/audio/', ''))
        return this.handleAudioStreamRequest(songId, req, res, corsHeaders)
      }

      // 3c. Direct file download for saving music to mobile storage
      if (method === 'GET' && pathname.startsWith('/v1/download/')) {
        const songId = decodeURIComponent(pathname.replace('/v1/download/', ''))
        return this.handleAudioDownloadRequest(songId, req, res, corsHeaders)
      }

      // 3d. Synced lyrics retrieval
      if (method === 'GET' && pathname.startsWith('/v1/lyrics/')) {
        const songId = decodeURIComponent(pathname.replace('/v1/lyrics/', ''))
        return this.handleLyricsRequest(songId, res, corsHeaders)
      }

      // 4. Queue retrieval
      if (method === 'GET' && pathname === '/v1/player/queue') {
        const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset')) || 0)
        const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get('limit')) || 50))
        const result: any = await this.sendCommand({ type: 'queue', offset, limit })
        if (result && Array.isArray(result.queue)) {
          result.queue = result.queue.map((track: any) => ({
            ...track,
            artworkUrl: track.id ? `/v1/artwork/${encodeURIComponent(track.id)}?token=${this.token}` : undefined
          }))
        }
        return reply(result?.error ? 409 : 200, result)
      }

      // 5. Library Search
      if (method === 'GET' && pathname === '/v1/library/search') {
        const query = (parsedUrl.searchParams.get('q') || '').trim().slice(0, 160)
        const artist = (parsedUrl.searchParams.get('artist') || '').trim().slice(0, 120)
        const limit = Math.max(1, Math.min(50, Number(parsedUrl.searchParams.get('limit')) || 20))

        let sql =
          "SELECT id, title, artist, album, duration, filePath, artworkPath FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%'"
        const params: any[] = []

        if (query) {
          sql += ' AND (title LIKE ? OR artist LIKE ? OR album LIKE ?)'
          const likeQuery = `%${query}%`
          params.push(likeQuery, likeQuery, likeQuery)
        }
        if (artist) {
          sql += ' AND artist LIKE ?'
          params.push(`%${artist}%`)
        }

        sql += ' LIMIT 200'
        const songs = getDb().prepare(sql).all(...params) as (LibraryTrack & { artworkPath?: string })[]

        const searchResult = searchLibrary(songs, query, artist, limit, (p) => fs.existsSync(p))
        const decoratedResults = searchResult.results.map((song: any) => ({
          ...song,
          artworkUrl: `/v1/artwork/${encodeURIComponent(song.id)}?token=${this.token}`
        }))

        return reply(200, {
          ...searchResult,
          results: decoratedResults
        })
      }

      // 6. Playback Control Mutation Commands
      if (method === 'POST' && pathname.startsWith('/v1/player/')) {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk))
        }
        let body: any = {}
        if (chunks.length > 0) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            return reply(400, { error: 'INVALID_JSON' })
          }
        }

        const requestId =
          typeof body.requestId === 'string' && body.requestId.length >= 6
            ? body.requestId
            : `cmd-${randomBytes(8).toString('hex')}`

        let command: Record<string, unknown>

        switch (pathname) {
          case '/v1/player/play': {
            if (body.song_id) {
              const song = getDb()
                .prepare("SELECT * FROM songs WHERE id = ? AND filePath NOT LIKE 'virtual:%'")
                .get(body.song_id) as any
              if (!song) return reply(404, { error: 'SONG_NOT_FOUND' })
              command = { type: 'play-song', song, volumePercent: body.volume_percent }
            } else {
              command = { type: 'play', volumePercent: body.volume_percent }
            }
            break
          }
          case '/v1/player/pause':
            command = { type: 'pause' }
            break
          case '/v1/player/next':
            command = { type: 'next' }
            break
          case '/v1/player/previous':
            command = { type: 'previous' }
            break
          case '/v1/player/seek':
            if (typeof body.seconds !== 'number' || body.seconds < 0) {
              return reply(400, { error: 'INVALID_SECONDS' })
            }
            command = { type: 'seek', seconds: body.seconds }
            break
          case '/v1/player/volume':
            if (typeof body.percent !== 'number' || body.percent < 0 || body.percent > 100) {
              return reply(400, { error: 'INVALID_VOLUME' })
            }
            command = { type: 'volume', percent: Math.round(body.percent) }
            break
          case '/v1/player/mode':
            command = { type: 'mode', shuffle: body.shuffle, repeat: body.repeat }
            break
          case '/v1/player/remove':
            if (!body.song_id) return reply(400, { error: 'SONG_ID_REQUIRED' })
            command = { type: 'remove', songId: body.song_id }
            break
          case '/v1/player/enqueue': {
            if (!body.song_id) return reply(400, { error: 'SONG_ID_REQUIRED' })
            const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(body.song_id) as any
            if (!song) return reply(404, { error: 'SONG_NOT_FOUND' })
            command = { type: 'enqueue', song }
            break
          }
          case '/v1/player/play-index': {
            if (typeof body.index !== 'number' || body.index < 0) {
              return reply(400, { error: 'INVALID_INDEX' })
            }
            command = { type: 'play-index', index: body.index }
            break
          }
          default:
            return reply(404, { error: 'UNKNOWN_COMMAND' })
        }

        const result = await this.commands.run(requestId, JSON.stringify([pathname, body]), async (deadline) => {
          return this.sendCommand(command, deadline)
        })

        // Immediate broadcast after command execution
        this.broadcastStatus()
        return reply(200, { ok: true, result, requestId })
      }

      // 7. Direct APK Download (for Android sideloading)
      if (method === 'GET' && (pathname === '/felo-remote.apk' || pathname === '/download/apk')) {
        const apkPath = path.resolve(app.getAppPath(), 'android/app/build/outputs/apk/debug/app-debug.apk')
        if (fs.existsSync(apkPath)) {
          const stat = fs.statSync(apkPath)
          res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Length': stat.size,
            'Content-Disposition': 'attachment; filename="FeloRemote.apk"',
            'Cache-Control': 'no-cache'
          })
          fs.createReadStream(apkPath).pipe(res)
          return
        } else {
          return reply(404, { error: 'APK_NOT_BUILT', message: 'APK not found. Run npm run mobile:apk first.' })
        }
      }

      // 8. Static Asset Serving (Web client for phone browser)
      if (method === 'GET') {
        return this.serveStatic(pathname, res)
      }

      return reply(404, { error: 'NOT_FOUND' })
    } catch (err: any) {
      if (!res.headersSent) {
        reply(500, { error: err.message || 'INTERNAL_ERROR' })
      }
    }
  }

  private handleArtworkRequest(songId: string, res: ServerResponse, corsHeaders: Record<string, string>): void {
    if (!songId) {
      res.writeHead(400, corsHeaders)
      res.end('Missing song ID')
      return
    }

    try {
      const song = getDb().prepare('SELECT artworkPath FROM songs WHERE id = ?').get(songId) as
        | { artworkPath?: string }
        | undefined

      const artworkPath = song?.artworkPath

      if (artworkPath) {
        if (/^https?:\/\//i.test(artworkPath)) {
          res.writeHead(302, { Location: artworkPath, ...corsHeaders })
          res.end()
          return
        }

        if (fs.existsSync(artworkPath)) {
          const ext = path.extname(artworkPath).toLowerCase()
          const mime =
            ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                  ? 'image/gif'
                  : 'image/jpeg'

          res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400, immutable',
            ...corsHeaders
          })
          fs.createReadStream(artworkPath).pipe(res)
          return
        }
      }

      // Return default Spotify-styled SVG cover if no artwork found
      const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
        <rect width="200" height="200" fill="#282828" rx="8"/>
        <circle cx="100" cy="100" r="45" fill="#181818"/>
        <path d="M92 75 v50 l35 -25 Z" fill="#b3b3b3"/>
      </svg>`

      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
        ...corsHeaders
      })
      res.end(defaultSvg)
    } catch (e) {
      res.writeHead(500, corsHeaders)
      res.end('Artwork error')
    }
  }

  private handleAudioStreamRequest(
    songId: string,
    req: IncomingMessage,
    res: ServerResponse,
    corsHeaders: Record<string, string>
  ): void {
    if (!songId) {
      res.writeHead(400, corsHeaders)
      res.end('Missing song ID')
      return
    }

    try {
      const song = getDb()
        .prepare('SELECT id, title, artist, album, filePath FROM songs WHERE id = ?')
        .get(songId) as { id: string; title: string; artist: string; album: string; filePath?: string } | undefined

      if (!song || !song.filePath || song.filePath.startsWith('virtual:')) {
        res.writeHead(404, corsHeaders)
        res.end('Song not found or is virtual')
        return
      }

      if (!isPathAllowedForMedia(song.filePath)) {
        res.writeHead(403, corsHeaders)
        res.end('Forbidden: File outside permitted media paths')
        return
      }

      if (!fs.existsSync(song.filePath)) {
        res.writeHead(404, corsHeaders)
        res.end('Audio file not found on disk')
        return
      }

      const stat = fs.statSync(song.filePath)
      const fileSize = stat.size
      const ext = path.extname(song.filePath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.opus': 'audio/opus',
        '.webm': 'audio/webm'
      }
      const contentType = mimeMap[ext] || 'audio/mpeg'

      // Handle HEAD request (iOS Safari pre-flight check)
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        })
        res.end()
        return
      }

      const range = req.headers.range
      if (range) {
        // e.g. "bytes=0-1024" or "bytes=1024-"
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)

        // Industry standard optimization: cap open-ended ranges to 3MB chunks
        // for instant start latency (<100ms) and low server memory footprint.
        const MAX_CHUNK_SIZE = 3 * 1024 * 1024 // 3 MB
        const requestedEnd = parts[1] ? parseInt(parts[1], 10) : NaN
        const end = !isNaN(requestedEnd)
          ? Math.min(fileSize - 1, requestedEnd)
          : Math.min(fileSize - 1, start + MAX_CHUNK_SIZE - 1)

        if (isNaN(start) || start >= fileSize || start > end) {
          res.writeHead(416, {
            ...corsHeaders,
            'Content-Range': `bytes */${fileSize}`
          })
          res.end()
          return
        }

        const chunkSize = end - start + 1
        res.writeHead(206, {
          ...corsHeaders,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        })

        const stream = fs.createReadStream(song.filePath, { start, end })
        res.on('close', () => stream.destroy())
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        stream.pipe(res)
      } else {
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        })

        const stream = fs.createReadStream(song.filePath)
        res.on('close', () => stream.destroy())
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
        stream.pipe(res)
      }
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders)
      }
      res.end('Streaming error')
    }
  }

  private handleAudioDownloadRequest(
    songId: string,
    _req: IncomingMessage,
    res: ServerResponse,
    corsHeaders: Record<string, string>
  ): void {
    if (!songId) {
      res.writeHead(400, corsHeaders)
      res.end('Missing song ID')
      return
    }

    try {
      const song = getDb()
        .prepare('SELECT id, title, artist, album, filePath FROM songs WHERE id = ?')
        .get(songId) as { id: string; title: string; artist: string; album: string; filePath?: string } | undefined

      if (!song || !song.filePath || song.filePath.startsWith('virtual:')) {
        res.writeHead(404, corsHeaders)
        res.end('Song not found or is virtual')
        return
      }

      if (!isPathAllowedForMedia(song.filePath)) {
        res.writeHead(403, corsHeaders)
        res.end('Forbidden: File outside permitted media paths')
        return
      }

      if (!fs.existsSync(song.filePath)) {
        res.writeHead(404, corsHeaders)
        res.end('Audio file not found on disk')
        return
      }

      const stat = fs.statSync(song.filePath)
      const fileSize = stat.size
      const ext = path.extname(song.filePath) || '.mp3'
      const cleanArtist = (song.artist || 'Unknown').replace(/[/\\?%*:|"<>]/g, '_').trim()
      const cleanTitle = (song.title || 'Track').replace(/[/\\?%*:|"<>]/g, '_').trim()
      const filename = `${cleanArtist} - ${cleanTitle}${ext}`
      const encodedFilename = encodeURIComponent(filename)

      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
        'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'public, max-age=3600'
      })

      const stream = fs.createReadStream(song.filePath)
      res.on('close', () => stream.destroy())
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
      stream.pipe(res)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, corsHeaders)
      }
      res.end('Download error')
    }
  }

  private async handleLyricsRequest(
    songId: string,
    res: ServerResponse,
    corsHeaders: Record<string, string>
  ): Promise<void> {
    if (!songId) {
      res.writeHead(400, corsHeaders)
      res.end(JSON.stringify({ error: 'SONG_ID_REQUIRED' }))
      return
    }

    try {
      const song = getDb()
        .prepare('SELECT title, artist, album, duration FROM songs WHERE id = ?')
        .get(songId) as { title: string; artist: string; album?: string; duration?: number } | undefined

      if (!song) {
        res.writeHead(404, corsHeaders)
        res.end(JSON.stringify({ error: 'SONG_NOT_FOUND' }))
        return
      }

      const params = new URLSearchParams({
        artist_name: song.artist || '',
        track_name: song.title || '',
        album_name: song.album || ''
      })
      if (song.duration) params.append('duration', String(Math.round(song.duration)))

      const lrclibUrl = `https://lrclib.net/api/get?${params.toString()}`
      const fetchRes = await fetch(lrclibUrl, {
        headers: { 'User-Agent': 'Felo Music Player (https://github.com/FanX0/felo)' }
      })

      if (fetchRes.ok) {
        const data = await fetchRes.json()
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400'
        })
        res.end(JSON.stringify(data))
        return
      }

      res.writeHead(404, corsHeaders)
      res.end(JSON.stringify({ error: 'NO_LYRICS' }))
    } catch (e: any) {
      res.writeHead(500, corsHeaders)
      res.end(JSON.stringify({ error: e.message || 'LYRICS_FAILED' }))
    }
  }

  private serveStatic(urlPath: string, res: ServerResponse): void {
    // Resolve static directory (out/renderer)
    const baseDir = path.resolve(app.getAppPath(), 'out/renderer')
    const baseDirWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep
    const normalizedUrl = urlPath === '/manifest.json' ? '/site.webmanifest' : urlPath
    const safeSubPath = normalizedUrl === '/' ? 'index.html' : normalizedUrl.replace(/^[/\\]+/, '')
    let filePath = path.resolve(baseDir, safeSubPath)

    // Security check to avoid directory traversal
    if (!filePath.startsWith(baseDirWithSep) && filePath !== baseDir) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // Single-page application fallback: if file does not exist, serve index.html
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(baseDir, 'index.html')
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Felo Web UI build not found in out/renderer. Run npm run build first.')
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const MIME_MAP: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json'
    }

    const contentType = MIME_MAP[ext] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    })

    const stream = fs.createReadStream(filePath)
    res.on('close', () => stream.destroy())
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    stream.pipe(res)
  }
}
