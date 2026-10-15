import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getDb } from '../database'
import { LibraryService } from './LibraryService'
import { ArtworkService } from './ArtworkService'
import {
  scoreProviderMatch,
  cleanSearchQuery,
  parseAudioFilePath,
  parseSmartQuery,
  sanitizeTrackMetadata,
  DUMMY_PROVIDER_ALBUMS
} from '../../shared/songMatching'

interface ExternalProviders {
  QobuzClient?: any
  DeezerClient?: any
  slsk?: any
  getSoulseekCredentials?: (accounts: any) => { user: string; pass: string }
  formatSoulseekError?: (error: unknown) => string
}

let _providersCache: ExternalProviders | null = null
let _providersAttempted = false

async function getExternalProviders(): Promise<ExternalProviders | null> {
  // If explicitly requested to run in public mode, disable proprietary external providers
  if (process.env.FELO_MODE === 'public') {
    return null
  }
  if (_providersAttempted) return _providersCache
  _providersAttempted = true
  try {
    const candidatePaths = [
      process.env.FELO_PROVIDERS_PATH,
      path.resolve(process.cwd(), 'src/main/providers/index.ts'),
      path.resolve(process.cwd(), 'src/main/providers/index.js'),
      path.resolve(process.cwd(), '../felo-private/src/main/providers/index.ts'),
      path.resolve(process.cwd(), '../felo-private/src/main/providers/index.js'),
      path.resolve(__dirname, '../providers/index.js'),
      path.resolve(__dirname, '../providers/index.cjs'),
      app.isPackaged ? path.join(process.resourcesPath, 'providers', 'index.cjs') : null,
      app.isPackaged ? path.join(process.resourcesPath, 'providers', 'index.js') : null,
      path.resolve(process.cwd(), 'resources', 'providers', 'index.cjs'),
      path.resolve(process.cwd(), 'resources', 'providers', 'index.js')
    ].filter(Boolean) as string[]

    const dynamicImport = new Function('m', 'return import(m)')

    for (const cand of candidatePaths) {
      if (fs.existsSync(cand)) {
        try {
          let mod: any
          if (cand.endsWith('.cjs')) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            mod = typeof require !== 'undefined' ? require(cand) : (new Function('m', 'return require(m)'))(cand)
          } else {
            const fileUrl = pathToFileURL(cand).href
            mod = await dynamicImport(fileUrl)
          }
          if (mod && (mod.QobuzClient || mod.DeezerClient || mod.slsk)) {
            _providersCache = mod as ExternalProviders
            break
          }
        } catch (err) {
          console.warn(`[DownloadService] Failed importing candidate from ${cand}:`, err)
        }
      }
    }

    if (!_providersCache) {
      // Fallback to relative specifier
      try {
        const specifier = '../providers' + '/index'
        const mod = await dynamicImport(specifier)
        if (mod && (mod.QobuzClient || mod.DeezerClient || mod.slsk)) {
          _providersCache = mod as ExternalProviders
        }
      } catch {
        _providersCache = null
      }
    }
  } catch {
    _providersCache = null
  }
  return _providersCache
}

export type StreamingSource = 'qobuz' | 'deezer' | 'soulseek' | 'youtube'

export interface StreamingAccounts {
  qobuzAuthMethod?: 'token' | 'password'
  qobuzUser?: string
  qobuzSecret?: string
  qobuzAppId?: string
  qobuzAppSecret?: string
  qobuzQuality?: string
  deezerArl?: string
  deezerQuality?: string
  soulseekUser?: string
  soulseekPassword?: string
}

export interface ProviderSearchResult {
  id: string
  source: StreamingSource
  mediaType: 'track'
  title: string
  artist: string
  album?: string
  description: string
  quality: string
  size?: string
  meta?: string
  slots?: boolean
  speed?: number
  artworkUrl?: string
  duration?: number
}

export interface StartDownloadRequest {
  transferId: string
  source: StreamingSource
  resultId: string
  title: string
  artist: string
  songId: string
  conflictMode: 'replace' | 'keep_both'
  accounts: StreamingAccounts
  storageMode?: 'stream' | 'download'
  skipIfExists?: boolean
  autoPlay?: boolean
  artworkUrl?: string
  album?: string
}

export interface StartDownloadResult {
  started: boolean
  transferId: string
  alreadyExists?: boolean
  duplicateRequest?: boolean
}

interface DownloadProgressEvent {
  transferId: string
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  progress: number
  message: string
  filePath?: string
  song?: unknown
  songId?: string
  title?: string
  artist?: string
}

const AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.opus',
  '.aac',
  '.alac',
  '.wma'
])

type CommandResolution = { command: string; prefixArgs: string[] }

function emitProgress(event: DownloadProgressEvent): void {
  try {
    DownloadService.emitter.emit('progress', event)
    if (event.transferId) {
      DownloadService.emitter.emit(`progress:${event.transferId}`, event)
    }
  } catch {}
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('downloads:progress', event)
  }
}

function runCommand(
  command: string,
  args: string[],
  onProgress?: (data: string) => void,
  timeoutMs = 0,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Download cancelled'))
      return
    }

    const child = spawn(command, args, { windowsHide: true })

    const killChildProcess = () => {
      clearProcessTimeout()
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
        } catch {
          try {
            child.kill()
          } catch {}
        }
      } else {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
    }

    const timeout = timeoutMs
      ? setTimeout(() => {
          killChildProcess()
          reject(new Error(`Download process timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
        }, timeoutMs)
      : undefined
    const clearProcessTimeout = () => {
      if (timeout) clearTimeout(timeout)
    }

    const onAbort = () => {
      killChildProcess()
      reject(new Error('Download cancelled'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      if (onProgress) onProgress(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (onProgress) onProgress(text)
    })
    child.on('error', (error) => {
      clearProcessTimeout()
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      clearProcessTimeout()
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) {
        reject(new Error('Download cancelled'))
        return
      }
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const outputLines = `${stderr}\n${stdout}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const usefulError = [...outputLines]
        .reverse()
        .find((line) =>
          /error|unable|failed|unavailable|private|sign in|requested format|not found/i.test(line)
        )
      reject(new Error(usefulError || outputLines.at(-1) || `Process exited with code ${code}`))
    })
  })
}

function resourcePath(...segments: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...segments)
    : path.join(process.cwd(), 'resources', ...segments)
}

function existingFile(...candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

function findYtDlp(): CommandResolution {
  const homeDir = app.getPath('home')

  // Bundled locations
  const bundled = existingFile(
    resourcePath('downloader', 'bin', 'yt-dlp.exe'),
    resourcePath('downloader', 'yt-dlp.exe'),
    resourcePath('downloader', 'python', 'Scripts', 'yt-dlp.exe')
  )
  if (bundled) return { command: bundled, prefixArgs: [] }

  const candidates = [
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    'yt-dlp.exe',
    'yt-dlp'
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, prefixArgs: [] }
    }
  }

  return { command: 'yt-dlp', prefixArgs: [] }
}

let cachedFfmpegLocation: string | undefined = undefined

function findFfmpegLocation(): string | undefined {
  if (cachedFfmpegLocation !== undefined) return cachedFfmpegLocation

  const homeDir = app.getPath('home')
  const bundled = existingFile(
    resourcePath('downloader', 'bin', 'ffmpeg.exe'),
    resourcePath('downloader', 'ffmpeg.exe'),
    resourcePath('downloader', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')
  )
  if (bundled) {
    cachedFfmpegLocation = bundled
    return bundled
  }

  const dirCandidates = [
    resourcePath('downloader', 'ffmpeg', 'bin'),
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
  ]
  for (const dir of dirCandidates) {
    const exePath = path.join(dir, 'ffmpeg.exe')
    if (existingFile(exePath)) {
      cachedFfmpegLocation = exePath
      return exePath
    }
  }

  cachedFfmpegLocation = 'ffmpeg'
  return cachedFfmpegLocation
}

async function embedCleanAudioTags(
  filePath: string,
  tags: { title: string; artist: string; album?: string }
): Promise<void> {
  const ffmpegLoc = findFfmpegLocation()
  if (!ffmpegLoc) return
  if (!fs.existsSync(filePath)) return

  const ext = path.extname(filePath).toLowerCase()
  const dir = path.dirname(filePath)
  const tempTaggedPath = path.join(dir, `tagged_${crypto.randomUUID()}${ext}`)

  const ffmpegArgs: string[] = [
    '-y',
    '-i',
    filePath,
    '-c',
    'copy',
    '-map',
    '0',
    '-metadata',
    `title=${tags.title}`,
    '-metadata',
    `artist=${tags.artist}`
  ]

  if (tags.album) {
    ffmpegArgs.push('-metadata', `album=${tags.album}`)
  } else {
    ffmpegArgs.push('-metadata', 'album=')
  }

  ffmpegArgs.push(tempTaggedPath)

  try {
    await runCommand(ffmpegLoc, ffmpegArgs, undefined, 15000)
    if (fs.existsSync(tempTaggedPath) && fs.statSync(tempTaggedPath).size > 1000) {
      fs.unlinkSync(filePath)
      fs.renameSync(tempTaggedPath, filePath)
    } else if (fs.existsSync(tempTaggedPath)) {
      try {
        fs.unlinkSync(tempTaggedPath)
      } catch {}
    }
  } catch (err) {
    console.warn('[DownloadService] embedCleanAudioTags non-fatal warning:', err)
    if (fs.existsSync(tempTaggedPath)) {
      try {
        fs.unlinkSync(tempTaggedPath)
      } catch {}
    }
  }
}

function getCustomDownloadDirectory(): string {
  try {
    const row = getDb()
      .prepare("SELECT value FROM app_settings WHERE key = 'download.location'")
      .get() as { value?: string } | undefined
    if (row?.value) {
      let parsed = row.value
      try {
        parsed = JSON.parse(row.value)
      } catch {
        parsed = row.value.replace(/^"|"$/g, '')
      }
      if (typeof parsed === 'string' && parsed.trim().length > 0) {
        return path.resolve(parsed.trim())
      }
    }
  } catch {
    // fallback
  }
  return path.join(app.getPath('music'), 'Felo')
}

function getAudioFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...getAudioFiles(fullPath))
    else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath)
  }
  return files
}

function uniquePath(candidate: string): string {
  if (!fs.existsSync(candidate)) return candidate
  const directory = path.dirname(candidate)
  const extension = path.extname(candidate)
  const base = path.basename(candidate, extension)
  let number = 2
  while (fs.existsSync(path.join(directory, `${base} (${number})${extension}`))) number++
  return path.join(directory, `${base} (${number})${extension}`)
}

function normalizeDuplicateValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findExistingLibrarySong(title: string, artist: string): any | undefined {
  const songs = getDb()
    .prepare("SELECT * FROM songs WHERE filePath IS NOT NULL AND filePath NOT LIKE 'virtual:%'")
    .all() as any[]
  const normTargetTitle = normalizeDuplicateValue(title)
  const normTargetArtist = normalizeDuplicateValue(artist)
  if (!normTargetTitle) return undefined

  const targetFull = normalizeDuplicateValue(`${artist} ${title}`)
  const targetFullRev = normalizeDuplicateValue(`${title} ${artist}`)

  return songs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false
    const normLocalTitle = normalizeDuplicateValue(song.title || '')
    const normLocalArtist = normalizeDuplicateValue(song.artist || '')
    if (!normLocalTitle) return false

    if (normLocalTitle === normTargetTitle) {
      if (!normTargetArtist || !normLocalArtist || normLocalArtist === normTargetArtist) return true
      if (normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist)) return true
    }

    const localFull = normalizeDuplicateValue(`${song.artist || ''} ${song.title || ''}`)
    const localFullRev = normalizeDuplicateValue(`${song.title || ''} ${song.artist || ''}`)
    if (
      localFull === targetFull ||
      localFull === targetFullRev ||
      localFullRev === targetFull ||
      localFullRev === targetFullRev
    ) {
      return true
    }

    if (normTargetTitle.length >= 4 && normLocalTitle.includes(normTargetTitle)) {
      const hasArtistMatch =
        normTargetArtist &&
        normLocalArtist &&
        (normLocalArtist === normTargetArtist ||
          normLocalTitle.includes(normTargetArtist) ||
          normTargetArtist.includes(normLocalArtist) ||
          normLocalArtist.includes(normTargetArtist))
      if (hasArtistMatch) {
        return true
      }
    }
    return false
  })
}

function getStreamCacheDirectory(): string {
  const directory = path.join(app.getPath('userData'), 'stream-cache')
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function getStreamCacheLimit(): number {
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('download.streamCacheLimit') as { value?: string } | undefined
    const value = Number(row?.value)
    return Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 3
  } catch {
    return 3
  }
}

function cacheDownloadedFile(downloadedPath: string, request: StartDownloadRequest, song: any): any {
  const extension = path.extname(downloadedPath).toLowerCase() || '.audio'
  const safeName = `${request.artist} - ${request.title}`.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180)
  const targetPath = uniquePath(path.join(getStreamCacheDirectory(), `${safeName}${extension}`))
  fs.copyFileSync(downloadedPath, targetPath)

  const files = getAudioFiles(getStreamCacheDirectory()).sort(
    (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
  )
  files.slice(getStreamCacheLimit()).forEach((file) => {
    try {
      fs.unlinkSync(file)
    } catch {}
  })

  return {
    ...(song || {}),
    id: song?.id || `stream-cache:${crypto.randomUUID()}`,
    title: request.title,
    artist: request.artist,
    album: song?.album || '',
    duration: song?.duration || 0,
    filePath: targetPath,
    artworkPath: song?.artworkPath || '',
    size: fs.statSync(targetPath).size,
    dateAdded: Math.floor(Date.now() / 1000)
  }
}

function moveCompletedFile(
  downloadedPath: string,
  source: StreamingSource,
  song: any,
  conflictMode: 'replace' | 'keep_both',
  requestTitle?: string,
  requestArtist?: string
): { filePath: string; replaced: boolean; oldPath?: string } {
  const downloadedExtension = path.extname(downloadedPath).toLowerCase()
  const customDownloadDir = getCustomDownloadDirectory()
  const isVirtual = !song?.filePath || String(song.filePath).startsWith('virtual:')
  const libraryRoot = song?.rootId
    ? (getDb().prepare('SELECT path FROM library_roots WHERE id = ?').get(song.rootId) as any)?.path
    : null
  const targetDirectory = !isVirtual && song?.filePath
    ? path.dirname(song.filePath)
    : customDownloadDir || libraryRoot || path.join(app.getPath('music'), 'Felo')
  fs.mkdirSync(targetDirectory, { recursive: true })

  const downloadedBase = path.basename(downloadedPath, downloadedExtension)
  const sanitizedBase = sanitizeTrackMetadata({ title: downloadedBase, artist: '' }, source)
  const cleanBase =
    sanitizedBase.artist && sanitizedBase.artist.toLowerCase() !== 'unknown artist'
      ? `${sanitizedBase.artist} - ${sanitizedBase.title}`
      : sanitizedBase.title || downloadedBase

  const sanitizedReq = sanitizeTrackMetadata(
    { title: requestTitle || '', artist: requestArtist || '' },
    source
  )
  const cleanReqTitle = sanitizedReq.title
  const cleanReqArtist = sanitizedReq.artist

  const preferredName =
    cleanReqTitle && cleanReqTitle.trim()
      ? cleanReqArtist && cleanReqArtist.trim() && cleanReqArtist.toLowerCase() !== 'unknown artist'
        ? `${cleanReqArtist.trim()} - ${cleanReqTitle.trim()}`
        : cleanReqTitle.trim()
      : cleanBase

  if (conflictMode === 'replace' && !isVirtual && song?.filePath) {
    const oldPath = path.resolve(song.filePath)
    const safeTargetBase = preferredName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180)
    const directTargetPath = path.join(
      targetDirectory,
      `${safeTargetBase}${downloadedExtension}`
    )
    const targetPath =
      path.normalize(oldPath).toLowerCase() === path.normalize(directTargetPath).toLowerCase() ||
      !fs.existsSync(directTargetPath)
        ? directTargetPath
        : uniquePath(
            path.join(
              targetDirectory,
              `${safeTargetBase}${downloadedExtension}`
            )
          )
    const incomingPath = `${targetPath}.felo-incoming`
    fs.copyFileSync(downloadedPath, incomingPath)

    try {
      fs.renameSync(incomingPath, targetPath)
      return { filePath: targetPath, replaced: true, oldPath }
    } catch (renameErr: any) {
      if (renameErr?.code === 'EBUSY' || renameErr?.code === 'EPERM') {
        const fallbackTarget = uniquePath(
          path.join(
            targetDirectory,
            `${safeTargetBase} (Replaced)${downloadedExtension}`
          )
        )
        fs.renameSync(incomingPath, fallbackTarget)
        return { filePath: fallbackTarget, replaced: true, oldPath }
      }
      throw renameErr
    }
  }

  const safePreferred = preferredName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180)
  const targetPath = uniquePath(
    path.join(targetDirectory, `${safePreferred}${downloadedExtension}`)
  )
  fs.copyFileSync(downloadedPath, targetPath)
  return { filePath: targetPath, replaced: false }
}

async function finalizeDownloadedFile(
  downloadedPath: string,
  request: StartDownloadRequest,
  song: any,
  stagingDirectory?: string
): Promise<{ filePath: string; updatedSong: any; replaced: boolean; oldPath?: string }> {
  const sanitized = sanitizeTrackMetadata(
    {
      title: request.title,
      artist: request.artist,
      album: request.album || song?.album
    },
    request.source
  )
  const cleanTitle = sanitized.title || request.title
  const cleanArtist = sanitized.artist || request.artist
  const cleanAlbum =
    sanitized.album ||
    (request.album && !DUMMY_PROVIDER_ALBUMS.has(request.album.toLowerCase())
      ? request.album
      : song?.album && !DUMMY_PROVIDER_ALBUMS.has(song.album.toLowerCase())
        ? song.album
        : `${cleanTitle} - Single`)

  // Embed clean canonical tags into the physical audio file before caching or moving
  await embedCleanAudioTags(downloadedPath, {
    title: cleanTitle,
    artist: cleanArtist,
    album: cleanAlbum
  })

  if (request.storageMode === 'stream') {
    const streamRequest: StartDownloadRequest = {
      ...request,
      title: cleanTitle,
      artist: cleanArtist,
      album: cleanAlbum
    }
    const updatedSong = cacheDownloadedFile(downloadedPath, streamRequest, song)
    const verifiedArtwork = await ArtworkService.verifyAndEnrichTrackArtwork({
      filePath: updatedSong.filePath,
      stagingDirectory,
      title: cleanTitle,
      artist: cleanArtist,
      album: cleanAlbum || song?.album,
      source: request.source,
      resultId: request.resultId,
      hintArtworkUrl: request.artworkUrl || song?.artworkUrl,
      songId: updatedSong.id
    })
    if (verifiedArtwork) {
      updatedSong.artworkPath = verifiedArtwork
    }
    return { filePath: updatedSong.filePath, updatedSong, replaced: false }
  }

  const completed = moveCompletedFile(
    downloadedPath,
    request.source,
    song,
    request.conflictMode,
    cleanTitle,
    cleanArtist
  )
  const updatedSong = completed.replaced
    ? await LibraryService.replaceSongFile(request.songId, completed.filePath, {
        title: cleanTitle,
        artist: cleanArtist,
        album: cleanAlbum || song?.album,
        artworkUrl: request.artworkUrl || song?.artworkUrl
      })
    : await LibraryService.importDownloadedFile(completed.filePath, song?.rootId, {
        title: cleanTitle,
        artist: cleanArtist,
        album: cleanAlbum || song?.album,
        artworkUrl: request.artworkUrl || song?.artworkUrl
      })

  if (completed.replaced && completed.oldPath) {
    try {
      const normalizedOld = path.normalize(completed.oldPath).toLowerCase()
      const normalizedNew = path.normalize(completed.filePath).toLowerCase()
      if (normalizedOld !== normalizedNew && fs.existsSync(completed.oldPath)) {
        fs.unlinkSync(completed.oldPath)
      }
    } catch (cleanupErr) {
      console.warn('[DownloadService] Could not remove old replaced file:', cleanupErr)
    }
  }

  // Mandatory artwork verification test for every download:
  // If the track does not have valid artwork, trigger multi-tier fallback pipeline
  const verifiedArtwork = await ArtworkService.verifyAndEnrichTrackArtwork({
    filePath: completed.filePath,
    stagingDirectory,
    title: request.title,
    artist: request.artist,
    album: request.album || song?.album || updatedSong?.album,
    source: request.source,
    resultId: request.resultId,
    hintArtworkUrl: request.artworkUrl || song?.artworkUrl,
    songId: updatedSong?.id,
    albumId: updatedSong?.albumId
  })
  if (verifiedArtwork && updatedSong) {
    updatedSong.artworkPath = verifiedArtwork
  }

  const shouldRelinkVirtualSong =
    !completed.replaced &&
    song?.id &&
    updatedSong?.id &&
    typeof song.filePath === 'string' &&
    song.filePath.startsWith('virtual:')
  if (shouldRelinkVirtualSong) {
    LibraryService.relinkVirtualSong(song.id, updatedSong.id)
  }
  return { ...completed, updatedSong }
}

interface ActiveTask {
  controller: AbortController
  downloadKey: string
  stagingDirectory: string
}

interface QueuedDownloadItem {
  request: StartDownloadRequest
  controller: AbortController
  downloadKey: string
  stagingDirectory: string
}

export class DownloadService {
  public static readonly emitter = new EventEmitter()
  private static readonly MAX_CONCURRENT_DOWNLOADS = 2
  private static activeDownloadCount = 0
  private static readonly pendingQueue: QueuedDownloadItem[] = []
  private static readonly activeDownloadKeys = new Set<string>()
  private static readonly activeTasks = new Map<string, ActiveTask>()
  private static readonly inFlightAcquisitions = new Map<string, Promise<any>>()

  static async getProviderInfo(): Promise<{
    mode: 'public' | 'private'
    sources: string[]
  }> {
    const providers = await getExternalProviders()
    if (!providers) {
      return {
        mode: 'public',
        sources: ['YouTube Audio', 'Local Library']
      }
    }
    const sources: string[] = []
    if (providers.QobuzClient) sources.push('Qobuz 24-bit Hi-Res')
    if (providers.DeezerClient) sources.push('Deezer FLAC')
    if (providers.slsk) sources.push('Soulseek P2P')
    sources.push('YouTube')
    return {
      mode: 'private',
      sources
    }
  }

  static async acquireAndDownload(
    query: string,
    artist?: string,
    options?: {
      timeoutMs?: number
      storageMode?: 'stream' | 'download'
      onProgress?: (message: string, progress: number) => void
    }
  ): Promise<any> {
    const parsed = parseSmartQuery(query, artist)
    const cleanTitle = (parsed.title || query || '').trim()
    const cleanArtist = (parsed.artist || artist || '').trim()
    if (!cleanTitle) throw new Error('QUERY_REQUIRED')

    // 1. Check if song already exists locally
    const existingSong = findExistingLibrarySong(cleanTitle, cleanArtist)
    if (existingSong && existingSong.filePath && fs.existsSync(existingSong.filePath)) {
      return existingSong
    }

    // 2. Single-Flight Coalescing: return existing pending promise for identical query
    const flightKey = `${cleanArtist}::${cleanTitle}`.toLowerCase()
    const existingFlight = this.inFlightAcquisitions.get(flightKey)
    if (existingFlight) {
      return existingFlight
    }

    const taskPromise = this.performAcquisition(cleanTitle, cleanArtist, options)
    this.inFlightAcquisitions.set(flightKey, taskPromise)
    taskPromise.finally(() => {
      this.inFlightAcquisitions.delete(flightKey)
    })

    return taskPromise
  }

  private static async performAcquisition(
    cleanTitle: string,
    cleanArtist: string,
    options?: {
      timeoutMs?: number
      storageMode?: 'stream' | 'download'
      onProgress?: (message: string, progress: number) => void
    }
  ): Promise<any> {
    // Load configured accounts and priority
    let prioritySetting: string[] = ['qobuz', 'deezer', 'soulseek', 'youtube']
    try {
      const priorityRow = getDb().prepare("SELECT value FROM app_settings WHERE key = 'download.priority'").get() as any
      if (priorityRow?.value) {
        const parsed = JSON.parse(priorityRow.value)
        if (Array.isArray(parsed) && parsed.length > 0) prioritySetting = parsed
      }
    } catch {}

    let accounts: StreamingAccounts = {}
    try {
      const accountsRow = getDb().prepare("SELECT value FROM app_settings WHERE key = 'download.streamingAccounts'").get() as any
      if (accountsRow?.value) {
        accounts = JSON.parse(accountsRow.value)
      }
    } catch {}

    let storageMode: 'stream' | 'download' = options?.storageMode || 'download'
    if (!options?.storageMode) {
      try {
        const storageRow = getDb().prepare("SELECT value FROM app_settings WHERE key = 'download.playbackStorage'").get() as any
        if (storageRow?.value) {
          const val = JSON.parse(storageRow.value)
          if (val === 'stream' || val === 'download') storageMode = val
        }
      } catch {}
    }

    const priority = [...prioritySetting]
    if (!priority.includes('youtube')) priority.push('youtube')

    const searchQuery = cleanSearchQuery(cleanArtist, cleanTitle) || `${cleanArtist} ${cleanTitle}`.trim()

    let chosenSource: StreamingSource | null = null
    let chosenResult: ProviderSearchResult | null = null

    // 3. Search in priority order
    for (const source of priority) {
      try {
        if (
          source !== 'qobuz' &&
          source !== 'deezer' &&
          source !== 'soulseek' &&
          source !== 'youtube'
        ) continue

        const results = await this.search(source as StreamingSource, searchQuery, accounts)
        if (!Array.isArray(results) || results.length === 0) continue

        const scored = results
          .map((item) => {
            const match = scoreProviderMatch(
              { title: cleanTitle, artist: cleanArtist, duration: undefined },
              item
            )
            return {
              ...item,
              _score: match.score,
              _isAcceptable: match.isAcceptable
            }
          })
          .filter((item) => item._isAcceptable && item._score >= 50)
          .sort((a, b) => b._score - a._score)

        if (scored.length > 0) {
          chosenSource = source as StreamingSource
          chosenResult = scored[0]
          break
        }
      } catch (err) {
        console.warn(`[DownloadService] Auto-acquire search error on ${source}:`, err)
      }
    }

    // Fallback search on YouTube if no scored match yet
    if (!chosenSource || !chosenResult) {
      try {
        const ytResults = await this.search('youtube', searchQuery, accounts)
        if (Array.isArray(ytResults) && ytResults.length > 0) {
          chosenSource = 'youtube'
          chosenResult = ytResults[0]
        }
      } catch (ytErr) {
        console.warn('[DownloadService] Auto-acquire fallback YouTube error:', ytErr)
      }
    }

    if (!chosenSource || !chosenResult) {
      throw new Error(`NO_MATCH: No downloadable version found online for "${cleanTitle}".`)
    }

    // 4. Start the download and wait for it to complete
    const transferId = crypto.randomUUID()
    const startReq: StartDownloadRequest = {
      transferId,
      source: chosenSource,
      resultId: chosenResult.id,
      title: chosenResult.title || cleanTitle,
      artist: chosenResult.artist || cleanArtist || '',
      songId: '',
      conflictMode: 'replace',
      accounts,
      storageMode,
      skipIfExists: true,
      album: chosenResult.album,
      artworkUrl: chosenResult.artworkUrl
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options?.timeoutMs || 90_000
      let settled = false

      const cleanup = () => {
        settled = true
        clearTimeout(timer)
        DownloadService.emitter.removeListener(`progress:${transferId}`, onUpdate)
      }

      const timer = setTimeout(() => {
        if (settled) return
        cleanup()
        DownloadService.cancel(transferId)
        reject(new Error('DOWNLOAD_TIMEOUT: The song download timed out.'))
      }, timeoutMs)

      const onUpdate = (event: DownloadProgressEvent) => {
        if (settled) return
        if (options?.onProgress) {
          options.onProgress(event.message || '', event.progress)
        }
        if (event.status === 'completed') {
          cleanup()
          let finalSong = event.song
          if (!finalSong && event.songId) {
            finalSong = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(event.songId)
          }
          if (!finalSong && event.filePath) {
            finalSong = getDb().prepare('SELECT * FROM songs WHERE filePath = ?').get(event.filePath)
          }
          resolve(finalSong)
        } else if (event.status === 'failed') {
          cleanup()
          reject(new Error(event.message || 'DOWNLOAD_FAILED: Song download could not be completed.'))
        }
      }

      DownloadService.emitter.on(`progress:${transferId}`, onUpdate)

      const startResult = DownloadService.start(startReq)
      if (!startResult.started) {
        if (startResult.duplicateRequest) {
          const onGlobal = (evt: DownloadProgressEvent) => {
            const matchesResult =
              (evt.song as any)?.title?.toLowerCase() === cleanTitle.toLowerCase() ||
              (evt.filePath && fs.existsSync(evt.filePath))
            if (evt.status === 'completed' && matchesResult) {
              DownloadService.emitter.removeListener('progress', onGlobal)
              cleanup()
              resolve(
                evt.song || getDb().prepare('SELECT * FROM songs WHERE filePath = ?').get(evt.filePath)
              )
            } else if (evt.status === 'failed' && matchesResult) {
              DownloadService.emitter.removeListener('progress', onGlobal)
              cleanup()
              reject(new Error(evt.message || 'DOWNLOAD_FAILED: Song download could not be completed.'))
            }
          }
          DownloadService.emitter.on('progress', onGlobal)
        } else {
          cleanup()
          reject(new Error('DOWNLOAD_START_FAILED: Could not initiate download task.'))
        }
      }
    })
  }

  static cancel(transferId: string): boolean {
    const queueIdx = this.pendingQueue.findIndex((item) => item.request.transferId === transferId)
    if (queueIdx >= 0) {
      const [queued] = this.pendingQueue.splice(queueIdx, 1)
      queued.controller.abort()
      this.activeDownloadKeys.delete(queued.downloadKey)
      this.activeTasks.delete(transferId)
      try {
        if (fs.existsSync(queued.stagingDirectory)) {
          fs.rmSync(queued.stagingDirectory, { recursive: true, force: true })
        }
      } catch {}
      emitProgress({
        transferId,
        status: 'failed',
        progress: 0,
        message: 'Download cancelled'
      })
      return true
    }

    const task = this.activeTasks.get(transferId)
    if (!task) return false

    task.controller.abort()
    this.activeDownloadKeys.delete(task.downloadKey)
    this.activeTasks.delete(transferId)

    try {
      if (fs.existsSync(task.stagingDirectory)) {
        fs.rmSync(task.stagingDirectory, { recursive: true, force: true })
      }
    } catch {}

    emitProgress({
      transferId,
      status: 'failed',
      progress: 0,
      message: 'Download cancelled'
    })
    return true
  }

  static async search(
    source: StreamingSource,
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    if (!query.trim()) return []

    if (source === 'youtube') {
      return this.searchYoutube(this.normalizeYoutubeQuery(query))
    }

    if (source === 'soulseek') {
      return this.searchSoulseek(query, accounts)
    }

    if (source === 'qobuz') {
      return this.searchQobuz(query, accounts)
    }

    if (source === 'deezer') {
      return this.searchDeezer(query, accounts)
    }

    return []
  }

  private static normalizeYoutubeQuery(query: string): string {
    return query
      .replace(/^unknown artist\s+/i, '')
      .replace(/\s*\(\d+\)\s*$/i, '')
      .replace(/\s*\((?:youtube|official)\)\s*$/i, '')
      .replace(
        /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video)\s*$/i,
        ''
      )
      .replace(/[‘’“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private static async searchYoutube(query: string): Promise<ProviderSearchResult[]> {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20240101.01.00'
            }
          },
          query: query.trim()
        })
      })

      if (!res.ok) return []
      const data = (await res.json()) as any
      const contents =
        data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
          ?.contents?.[0]?.itemSectionRenderer?.contents || []

      const results: ProviderSearchResult[] = []
      for (const item of contents) {
        const vr = item.videoRenderer
        if (vr && vr.videoId) {
          const rawTitle =
            vr.title?.runs?.map((r: any) => r.text).join('') ||
            vr.title?.simpleText ||
            'YouTube Track'
          const rawOwner =
            vr.ownerText?.runs?.map((r: any) => r.text).join('') || 'YouTube'
          const duration = vr.lengthText?.simpleText || ''
          const sanitized = sanitizeTrackMetadata(
            { title: rawTitle, artist: rawOwner },
            'youtube'
          )
          const cleanTitle = sanitized.title || rawTitle
          const cleanArtist = sanitized.artist || rawOwner
          results.push({
            id: vr.videoId,
            source: 'youtube',
            mediaType: 'track',
            title: cleanTitle,
            artist: cleanArtist,
            album: undefined,
            quality: 'Opus / MP3 256k',
            description: `${cleanArtist}${duration ? ` · ${duration}` : ''}`,
            size: 'Standard Audio',
            meta: duration ? `${duration} · YouTube Audio` : 'YouTube Audio',
            artworkUrl: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`
          })
        }
      }
      return results.slice(0, 15)
    } catch (err) {
      console.error('YouTube search error:', err)
      return []
    }
  }

  private static isLosslessFormat(ext: string, filePath: string): boolean {
    const cleanExt = ext.toLowerCase().replace('.', '')
    if (['flac', 'wav', 'alac', 'aiff'].includes(cleanExt)) return true
    const lowerPath = filePath.toLowerCase()
    return (
      lowerPath.endsWith('.flac') ||
      lowerPath.endsWith('.wav') ||
      lowerPath.includes('lossless') ||
      lowerPath.includes('24bit') ||
      lowerPath.includes('16bit')
    )
  }

  private static calculateSoulseekQualityScore(item: any, ext: string): number {
    let score = 0
    const lowerPath = String(item.file || '').toLowerCase()
    const lossless = this.isLosslessFormat(ext, item.file)

    if (lossless) {
      score += 50
      if (
        lowerPath.includes('24bit') ||
        lowerPath.includes('24-bit') ||
        lowerPath.includes('24 bit') ||
        lowerPath.includes('96khz') ||
        lowerPath.includes('192khz')
      ) {
        score += 30
      } else if (
        lowerPath.includes('16bit') ||
        lowerPath.includes('16-bit') ||
        lowerPath.includes('16 bit')
      ) {
        score += 20
      } else {
        score += 15
      }

      if (lowerPath.includes('96khz') || lowerPath.includes('192khz')) {
        score += 10
      } else if (lowerPath.includes('48khz') || lowerPath.includes('44.1khz')) {
        score += 5
      }
    } else {
      if (item.bitrate) {
        if (item.bitrate >= 320) score += 30
        else if (item.bitrate >= 256) score += 20
        else if (item.bitrate >= 192) score += 15
        else if (item.bitrate >= 128) score += 10
        else score += 5
      }
    }

    if (item.size > 50000000) score += 15
    else if (item.size > 20000000) score += 10
    else if (item.size > 10000000) score += 5

    if (item.slots) score += 25
    return score
  }

  private static parseQueryArtistTitle(query: string): { artist: string; title: string } {
    const cleaned = cleanSearchQuery(undefined, undefined, query)
    if (cleaned.includes(' - ')) {
      const parts = cleaned.split(' - ').map((s) => s.trim()).filter(Boolean)
      if (parts.length === 2) {
        return { artist: parts[0], title: parts[1] }
      }
    }
    return { artist: '', title: cleaned }
  }

  private static async searchSoulseek(
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    const providers = await getExternalProviders()
    if (!providers?.slsk || !providers?.getSoulseekCredentials) {
      throw new Error('Soulseek P2P provider is not available in this build.')
    }
    const slsk = providers.slsk
    const formatSoulseekError = providers.formatSoulseekError || ((e: any) => String(e?.message || e))

    return new Promise((resolve, reject) => {
      let credentials: { user: string; pass: string }
      try {
        credentials = providers.getSoulseekCredentials!(accounts)
      } catch (error) {
        reject(error)
        return
      }

      const { artist: queryArtist, title: queryTitle } = this.parseQueryArtistTitle(query)
      const searchTerm = cleanSearchQuery(queryArtist, queryTitle, query) || query.trim()

      let clientInstance: any = null
      const timeoutTimer = setTimeout(() => {
        try {
          clientInstance?.destroy?.()
        } catch {}
        reject(new Error('Soulseek login/search timed out. The network may be temporarily unavailable.'))
      }, 35000)

      slsk.connect({ ...credentials, timeout: 30000 }, (err: any, client: any) => {
        if (err || !client) {
          clearTimeout(timeoutTimer)
          const message = formatSoulseekError(err)
          console.warn('Soulseek connect warning:', err?.message || err)
          reject(new Error(message))
          return
        }
        clientInstance = client

        client.search({ req: searchTerm, timeout: 6000 }, (searchErr: any, rawResults: any[]) => {
          clearTimeout(timeoutTimer)
          try {
            client.destroy?.()
          } catch {}

          if (searchErr || !Array.isArray(rawResults)) {
            reject(new Error(formatSoulseekError(searchErr)))
            return
          }

          // Filter valid audio files
          const audioResults = rawResults.filter((item) => {
            if (!item?.file) return false
            const ext = path.extname(item.file).toLowerCase()
            return AUDIO_EXTENSIONS.has(ext)
          })

          // Deduplicate identical files (same filename and size)
          const uniqueMap = new Map<string, any>()
          for (const item of audioResults) {
            const rawFile = String(item.file || '').replace(/^@@/, '')
            const filename = (rawFile.split(/[/\\]/).pop() || rawFile).toLowerCase()
            const dedupeKey = `${filename}_${item.size}`
            if (!uniqueMap.has(dedupeKey)) {
              uniqueMap.set(dedupeKey, item)
            }
          }
          const deduplicated = Array.from(uniqueMap.values())

          // Parse metadata and compute relevance match score for every candidate
          const candidates = deduplicated.map((item) => {
            const parsed = parseAudioFilePath(item.file)
            const ext = path.extname(item.file).toLowerCase()
            const isLossless = DownloadService.isLosslessFormat(ext, item.file)
            const qualityScore = DownloadService.calculateSoulseekQualityScore(item, ext)

            const match = scoreProviderMatch(
              { title: queryTitle || searchTerm, artist: queryArtist },
              {
                title: parsed.title,
                artist: parsed.artist,
                meta: item.slots ? 'Instant Slot' : 'Queued Slot'
              }
            )

            return {
              item,
              parsed,
              ext,
              isLossless,
              qualityScore,
              matchScore: match.score
            }
          })

          // Relevance-First Sort: Precision/accuracy takes priority over bitrate
          candidates.sort((a, b) => {
            // Significant relevance difference (>= 15 pts) always wins
            if (Math.abs(b.matchScore - a.matchScore) >= 15) {
              return b.matchScore - a.matchScore
            }
            // For similarly relevant candidates, prefer lossless audio
            const lossA = a.isLossless ? 1 : 0
            const lossB = b.isLossless ? 1 : 0
            if (lossA !== lossB) {
              return lossB - lossA
            }
            // Higher match score
            if (b.matchScore !== a.matchScore) {
              return b.matchScore - a.matchScore
            }
            // Quality score (bitrate, 24-bit, size)
            if (b.qualityScore !== a.qualityScore) {
              return b.qualityScore - a.qualityScore
            }
            // Available instant download slot
            if (Boolean(a.item.slots) !== Boolean(b.item.slots)) {
              return a.item.slots ? -1 : 1
            }
            return (b.item.speed || 0) - (a.item.speed || 0)
          })

          const mapped: ProviderSearchResult[] = candidates.slice(0, 30).map((cand) => {
            const item = cand.item
            const rawFile = String(item.file || '').replace(/^@@/, '')
            const parts = rawFile.split(/[/\\]/).filter(Boolean)
            const fileName = parts[parts.length - 1] || rawFile
            const cleanTitle = fileName
              .replace(/\.[^.]+$/, '')
              .replace(/^[\d\s._-]+/, '')
            const folderName = parts.length > 1 ? parts[parts.length - 2] : ''
            const ext = cand.ext
            const isLossless = cand.isLossless
            const lowerFile = fileName.toLowerCase()

            let qualityBadge = ''
            if (isLossless) {
              if (lowerFile.includes('24bit') || lowerFile.includes('24-bit')) {
                qualityBadge = lowerFile.includes('192khz')
                  ? '24-bit / 192 kHz FLAC'
                  : lowerFile.includes('96khz')
                    ? '24-bit / 96 kHz FLAC'
                    : '24-bit Hi-Res FLAC'
              } else if (lowerFile.includes('16bit') || lowerFile.includes('16-bit')) {
                qualityBadge = '16-bit / 44.1 kHz FLAC'
              } else {
                qualityBadge = ext === '.wav' ? 'WAV Lossless' : 'FLAC Lossless'
              }
            } else if (item.bitrate) {
              qualityBadge = `${item.bitrate} kbps ${ext.replace('.', '').toUpperCase()}`
            } else {
              qualityBadge = `${ext.replace('.', '').toUpperCase()} Audio`
            }

            const sizeMB = item.size
              ? `${(item.size / (1024 * 1024)).toFixed(1)} MB`
              : 'Unknown size'
            const speedKB = item.speed ? `${Math.round(item.speed / 1024)} KB/s` : ''

            const rawTitleCand = cand.parsed.title || cleanTitle || fileName
            const rawArtistCand =
              cand.parsed.artist || (queryArtist ? queryArtist : item.user ? `Peer: ${item.user}` : 'Soulseek Peer')
            const cleanFolderAlbum =
              folderName && !DUMMY_PROVIDER_ALBUMS.has(folderName.toLowerCase())
                ? folderName
                : undefined
            const rawAlbumCand = cand.parsed.album || cleanFolderAlbum

            const sanitized = sanitizeTrackMetadata(
              { title: rawTitleCand, artist: rawArtistCand, album: rawAlbumCand },
              'soulseek'
            )
            const finalTitle = sanitized.title || rawTitleCand
            const finalArtist = sanitized.artist || rawArtistCand
            const finalAlbum = sanitized.album

            return {
              id: JSON.stringify({ user: item.user, file: item.file, size: item.size }),
              source: 'soulseek',
              mediaType: 'track',
              title: finalTitle,
              artist: finalArtist,
              album: finalAlbum,
              quality: qualityBadge,
              description: `${item.user} · ${item.slots ? 'Free slot' : 'Queued'} · ${sizeMB}${speedKB ? ` · ${speedKB}` : ''}`,
              size: sizeMB,
              meta: item.slots ? 'Instant Slot' : 'Queued Slot',
              slots: Boolean(item.slots),
              speed: item.speed
            }
          })

          resolve(mapped)
        })
      })
    })
  }

  private static async searchQobuz(
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    const providers = await getExternalProviders()
    if (!providers?.QobuzClient) {
      throw new Error('Qobuz streaming provider is not available in this build.')
    }
    const client = new providers.QobuzClient({
      authMethod: accounts.qobuzAuthMethod,
      user: accounts.qobuzUser,
      secret: accounts.qobuzSecret,
      appId: accounts.qobuzAppId,
      appSecret: accounts.qobuzAppSecret,
      quality: accounts.qobuzQuality
    })

    const { artist: queryArtist, title: queryTitle } = this.parseQueryArtistTitle(query)
    const cleanQ = cleanSearchQuery(queryArtist, queryTitle, query) || query.trim()
    const results = await client.searchTracks(cleanQ, 25)
    const formatDur = (sec?: number) => {
      if (!sec || sec <= 0) return ''
      return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
    }

    const scored = results.map((item) => {
      const match = scoreProviderMatch(
        { title: queryTitle || cleanQ, artist: queryArtist },
        {
          title: item.title,
          artist: item.artist,
          duration: item.duration,
          meta: item.hires ? 'Hi-Res Lossless' : 'CD Lossless'
        }
      )
      return { item, matchScore: match.score }
    })

    scored.sort((a, b) => {
      if (Math.abs(b.matchScore - a.matchScore) >= 12) {
        return b.matchScore - a.matchScore
      }
      if (a.item.hires !== b.item.hires) {
        return b.item.hires ? 1 : -1
      }
      return b.matchScore - a.matchScore
    })

    return scored.map(({ item }) => {
      const durStr = formatDur(item.duration)
      const baseMeta = item.hires ? 'Hi-Res Lossless' : 'CD Lossless'
      const meta = durStr ? `${durStr} · ${baseMeta}` : baseMeta
      const sanitized = sanitizeTrackMetadata(
        { title: item.title, artist: item.artist, album: item.album },
        'qobuz'
      )
      const cleanTitle = sanitized.title || item.title
      const cleanArtist = sanitized.artist || item.artist
      const cleanAlbum = sanitized.album

      return {
        id: item.id,
        source: 'qobuz',
        mediaType: 'track',
        title: cleanTitle,
        artist: cleanArtist,
        album: cleanAlbum,
        description: `${cleanArtist}${cleanAlbum ? ` · ${cleanAlbum}` : ''}${durStr ? ` · ${durStr}` : ''}`,
        quality: item.quality,
        meta,
        artworkUrl: item.artworkUrl,
        duration: item.duration
      }
    })
  }

  private static async searchDeezer(
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    const providers = await getExternalProviders()
    if (!providers?.DeezerClient) {
      throw new Error('Deezer streaming provider is not available in this build.')
    }
    const client = new providers.DeezerClient({
      arl: accounts.deezerArl,
      quality: (accounts.deezerQuality as any) || 'lossless'
    })

    const { artist: queryArtist, title: queryTitle } = this.parseQueryArtistTitle(query)
    const cleanQ = cleanSearchQuery(queryArtist, queryTitle, query) || query.trim()
    const results = await client.searchTracks(cleanQ, 25, queryArtist, queryTitle)
    const formatDur = (sec?: number) => {
      if (!sec || sec <= 0) return ''
      return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
    }

    const scored = results.map((item) => {
      const match = scoreProviderMatch(
        { title: queryTitle || cleanQ, artist: queryArtist },
        { title: item.title, artist: item.artist, duration: item.duration }
      )
      return { item, matchScore: match.score }
    })

    scored.sort((a, b) => b.matchScore - a.matchScore)

    return scored.map(({ item }) => {
      const durStr = formatDur(item.duration)
      const meta = durStr ? `${durStr} · FLAC / 320k Lossless` : 'FLAC / 320k Lossless'
      const sanitized = sanitizeTrackMetadata(
        { title: item.title, artist: item.artist, album: item.album },
        'deezer'
      )
      const cleanTitle = sanitized.title || item.title
      const cleanArtist = sanitized.artist || item.artist
      const cleanAlbum = sanitized.album

      return {
        id: item.id,
        source: 'deezer',
        mediaType: 'track',
        title: cleanTitle,
        artist: cleanArtist,
        album: cleanAlbum,
        description: `${cleanArtist}${cleanAlbum ? ` · ${cleanAlbum}` : ''}${durStr ? ` · ${durStr}` : ''}`,
        quality: item.quality,
        meta,
        duration: item.duration
      }
    })
  }

  static start(request: StartDownloadRequest): StartDownloadResult {
    const fallbackId = `${(request.artist || '').trim()}::${(request.title || '').trim()}`.toLowerCase()
    const downloadKey = `${request.source}:${request.resultId || fallbackId || request.transferId}`
    if (this.activeDownloadKeys.has(downloadKey)) {
      return { started: false, transferId: request.transferId, duplicateRequest: true }
    }

    const controller = new AbortController()
    const stagingRoot = path.join(app.getPath('userData'), 'download-staging')
    const safeTransferId = (request.transferId || '').replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeTransferId) {
      throw new Error('Invalid download transfer ID.')
    }
    const stagingDirectory = path.resolve(stagingRoot, safeTransferId)
    const rootWithSep = stagingRoot.endsWith(path.sep) ? stagingRoot : stagingRoot + path.sep
    if (!stagingDirectory.startsWith(rootWithSep)) {
      throw new Error('Invalid staging directory path boundary.')
    }

    this.activeDownloadKeys.add(downloadKey)
    this.activeTasks.set(request.transferId, {
      controller,
      downloadKey,
      stagingDirectory
    })

    const queuedItem: QueuedDownloadItem = {
      request,
      controller,
      stagingDirectory,
      downloadKey
    }

    const isUrgentPlayback = Boolean(request.autoPlay)
    const maxAllowedSlots = isUrgentPlayback
      ? this.MAX_CONCURRENT_DOWNLOADS + 1
      : this.MAX_CONCURRENT_DOWNLOADS

    if (this.activeDownloadCount < maxAllowedSlots) {
      this.activeDownloadCount++
      void this.dispatchTask(queuedItem)
    } else {
      if (isUrgentPlayback) {
        this.pendingQueue.unshift(queuedItem)
      } else {
        this.pendingQueue.push(queuedItem)
      }
      emitProgress({
        transferId: request.transferId,
        status: 'queued',
        progress: 0,
        message: isUrgentPlayback
          ? 'Queued with priority for playback...'
          : `Queued behind active downloads (position ${this.pendingQueue.length})...`
      })
    }

    return { started: true, transferId: request.transferId }
  }

  private static async dispatchTask(item: QueuedDownloadItem): Promise<void> {
    const stagingRoot = path.join(app.getPath('userData'), 'download-staging')
    const rootWithSep = stagingRoot.endsWith(path.sep) ? stagingRoot : stagingRoot + path.sep
    try {
      await this.execute(item.request, item.controller.signal, item.stagingDirectory)
    } finally {
      this.activeDownloadKeys.delete(item.downloadKey)
      this.activeTasks.delete(item.request.transferId)
      try {
        if (
          item.stagingDirectory &&
          path.resolve(item.stagingDirectory).startsWith(rootWithSep) &&
          fs.existsSync(item.stagingDirectory)
        ) {
          fs.rmSync(item.stagingDirectory, { recursive: true, force: true })
        }
      } catch {}
      this.activeDownloadCount--
      this.pumpQueue()
    }
  }

  private static pumpQueue(): void {
    if (this.pendingQueue.length > 1) {
      this.pendingQueue.sort((a, b) => (b.request.autoPlay ? 1 : 0) - (a.request.autoPlay ? 1 : 0))
    }
    while (this.pendingQueue.length > 0 && this.activeDownloadCount < this.MAX_CONCURRENT_DOWNLOADS) {
      const nextItem = this.pendingQueue.shift()
      if (!nextItem) break

      if (nextItem.controller.signal.aborted) {
        this.activeDownloadKeys.delete(nextItem.downloadKey)
        this.activeTasks.delete(nextItem.request.transferId)
        continue
      }

      this.activeDownloadCount++
      void this.dispatchTask(nextItem)
    }
  }

  private static async execute(
    request: StartDownloadRequest,
    signal: AbortSignal,
    stagingDirectory: string
  ): Promise<void> {
    if (signal.aborted) {
      emitProgress({
        transferId: request.transferId,
        songId: request.songId,
        title: request.title,
        artist: request.artist,
        status: 'failed',
        progress: 0,
        message: 'Download cancelled'
      })
      return
    }

    const song = request.songId
      ? (getDb().prepare('SELECT * FROM songs WHERE id = ?').get(request.songId) as any)
      : null
    const isPhysicalReplace =
      request.conflictMode === 'replace' &&
      song?.filePath &&
      !String(song.filePath).startsWith('virtual:')

    if (request.skipIfExists && !isPhysicalReplace) {
      const existingSong = findExistingLibrarySong(request.title, request.artist)
      if (existingSong) {
        if (request.songId && request.songId !== existingSong.id) {
          LibraryService.relinkVirtualSong(request.songId, existingSong.id)
        }
        emitProgress({
          transferId: request.transferId,
          songId: request.songId || existingSong.id,
          title: request.title,
          artist: request.artist,
          status: 'completed',
          progress: 100,
          message: 'Song already exists in your library; using the existing file.',
          filePath: existingSong.filePath,
          song: existingSong
        })
        return
      }
    }

    try {
      fs.mkdirSync(stagingDirectory, { recursive: true })

      if (request.source === 'youtube') {
        await this.executeYoutube(request, stagingDirectory, song, signal)
        return
      }

      if (request.source === 'soulseek') {
        try {
          await this.executeSoulseek(request, stagingDirectory, song, signal)
          return
        } catch (slskError: any) {
          if (signal.aborted) throw slskError
          console.warn(`Soulseek download failed: ${slskError?.message}. Attempting fallback...`)

          // Try Deezer fallback if ARL configured
          if (request.accounts.deezerArl?.trim()) {
            emitProgress({
              transferId: request.transferId,
              songId: request.songId,
              title: request.title,
              artist: request.artist,
              status: 'downloading',
              progress: 15,
              message: 'Soulseek peer unavailable; falling back to Deezer...'
            })
            try {
              const cleanQuery = cleanSearchQuery(request.artist, request.title)
              const deezerResults = await this.searchDeezer(cleanQuery, request.accounts)
              const scored = deezerResults
                .map((item) => {
                  const match = scoreProviderMatch(
                    { title: request.title, artist: request.artist, duration: song?.duration },
                    item
                  )
                  return { ...item, _score: match.score }
                })
                .filter((item) => item._score >= 60)
                .sort((a, b) => b._score - a._score)

              if (scored.length > 0) {
                const deezerRequest: StartDownloadRequest = {
                  ...request,
                  source: 'deezer',
                  resultId: scored[0].id,
                  artworkUrl: scored[0].artworkUrl || request.artworkUrl
                }
                await this.executeDeezer(deezerRequest, stagingDirectory, song, signal)
                return
              }
            } catch (deezerErr) {
              console.warn('Deezer fallback error:', deezerErr)
            }
          }

          // Fall back to YouTube Music
          emitProgress({
            transferId: request.transferId,
            songId: request.songId,
            title: request.title,
            artist: request.artist,
            status: 'downloading',
            progress: 15,
            message: 'Soulseek unavailable; falling back to YouTube Music...'
          })
          let bestYtResult: ProviderSearchResult | null = null
          try {
            const cleanQuery = cleanSearchQuery(request.artist, request.title)
            const ytResults = await this.searchYoutube(cleanQuery)
            const scored = ytResults
              .map((item) => {
                const match = scoreProviderMatch(
                  { title: request.title, artist: request.artist, duration: song?.duration },
                  item
                )
                return { ...item, _score: match.score }
              })
              .filter((item) => item._score >= 55)
              .sort((a, b) => b._score - a._score)

            if (scored.length > 0) {
              bestYtResult = scored[0]
            }
          } catch {}

          const ytRequest: StartDownloadRequest = {
            ...request,
            source: 'youtube',
            resultId: bestYtResult?.id || `ytsearch1:${request.artist} ${request.title}`,
            artworkUrl: bestYtResult?.artworkUrl || request.artworkUrl
          }
          await this.executeYoutube(ytRequest, stagingDirectory, song, signal)
          return
        }
      }

      if (request.source === 'qobuz') {
        try {
          await this.executeQobuz(request, stagingDirectory, song, signal)
          return
        } catch (qobuzError: any) {
          if (signal.aborted) throw qobuzError
          console.warn(`Qobuz download failed: ${qobuzError?.message}. Attempting provider fallback...`)

          // 1. Try Soulseek first (Lossless FLAC) if credentials configured
          if (request.accounts.soulseekUser?.trim() && request.accounts.soulseekPassword?.trim()) {
            emitProgress({
              transferId: request.transferId,
              songId: request.songId,
              title: request.title,
              artist: request.artist,
              status: 'downloading',
              progress: 12,
              message: 'Qobuz full track restricted; searching Soulseek lossless network...'
            })
            try {
              const cleanQuery = cleanSearchQuery(request.artist, request.title)
              const slskResults = await this.searchSoulseek(cleanQuery, request.accounts)
              const scored = slskResults
                .map((item) => {
                  const match = scoreProviderMatch(
                    { title: request.title, artist: request.artist, duration: song?.duration },
                    item
                  )
                  return { ...item, _score: match.score }
                })
                .filter((item) => item._score >= 60)
                .sort((a, b) => {
                  if (Math.abs(b._score - a._score) > 5) {
                    return b._score - a._score
                  }
                  if (Boolean(a.slots) !== Boolean(b.slots)) {
                    return a.slots ? -1 : 1
                  }
                  return b._score - a._score
                })

              if (scored.length > 0) {
                const bestSlsk = scored[0]
                const slskRequest: StartDownloadRequest = {
                  ...request,
                  source: 'soulseek',
                  resultId: bestSlsk.id,
                  title: bestSlsk.title,
                  artist: bestSlsk.artist
                }
                await this.executeSoulseek(slskRequest, stagingDirectory, song, signal)
                return
              }
            } catch (slskErr) {
              console.warn('Soulseek fallback error:', slskErr)
            }
          }

          // 2. Try Deezer fallback if ARL configured
          if (request.accounts.deezerArl?.trim()) {
            emitProgress({
              transferId: request.transferId,
              songId: request.songId,
              title: request.title,
              artist: request.artist,
              status: 'downloading',
              progress: 15,
              message: 'Searching Deezer for full track...'
            })
            try {
              const cleanQuery = cleanSearchQuery(request.artist, request.title)
              const deezerResults = await this.searchDeezer(cleanQuery, request.accounts)
              const scored = deezerResults
                .map((item) => {
                  const match = scoreProviderMatch(
                    { title: request.title, artist: request.artist, duration: song?.duration },
                    item
                  )
                  return { ...item, _score: match.score }
                })
                .filter((item) => item._score >= 60)
                .sort((a, b) => b._score - a._score)

              if (scored.length > 0) {
                const deezerRequest: StartDownloadRequest = {
                  ...request,
                  source: 'deezer',
                  resultId: scored[0].id,
                  artworkUrl: scored[0].artworkUrl || request.artworkUrl
                }
                await this.executeDeezer(deezerRequest, stagingDirectory, song, signal)
                return
              }
            } catch (deezerErr) {
              console.warn('Deezer fallback error:', deezerErr)
            }
          }

          // 3. Fall back to YouTube Music with accurate song scoring
          emitProgress({
            transferId: request.transferId,
            songId: request.songId,
            title: request.title,
            artist: request.artist,
            status: 'downloading',
            progress: 15,
            message: 'Falling back to YouTube Music...'
          })
          let bestYtResult: ProviderSearchResult | null = null
          try {
            const cleanQuery = cleanSearchQuery(request.artist, request.title)
            const ytResults = await this.searchYoutube(cleanQuery)
            const scored = ytResults
              .map((item) => {
                const match = scoreProviderMatch(
                  { title: request.title, artist: request.artist, duration: song?.duration },
                  item
                )
                return { ...item, _score: match.score }
              })
              .filter((item) => item._score >= 55)
              .sort((a, b) => b._score - a._score)

            if (scored.length > 0) {
              bestYtResult = scored[0]
            }
          } catch (ytErr) {
            console.warn('YouTube search error during fallback:', ytErr)
          }

          if (bestYtResult) {
            const ytRequest: StartDownloadRequest = {
              ...request,
              source: 'youtube',
              resultId: bestYtResult.id,
              title: bestYtResult.title,
              artist: bestYtResult.artist,
              artworkUrl: bestYtResult.artworkUrl || request.artworkUrl
            }
            await this.executeYoutube(ytRequest, stagingDirectory, song, signal)
            return
          }

          throw qobuzError
        }
      }

      if (request.source === 'deezer') {
        try {
          await this.executeDeezer(request, stagingDirectory, song, signal)
          return
        } catch (deezerError: any) {
          if (signal.aborted) throw deezerError
          console.warn(`Deezer download failed: ${deezerError?.message}. Attempting fallback...`)

          // 1. Try Soulseek first (Lossless FLAC) if credentials configured
          if (request.accounts.soulseekUser?.trim() && request.accounts.soulseekPassword?.trim()) {
            emitProgress({
              transferId: request.transferId,
              songId: request.songId,
              title: request.title,
              artist: request.artist,
              status: 'downloading',
              progress: 12,
              message: 'Deezer unavailable; searching Soulseek lossless network...'
            })
            try {
              const cleanQuery = cleanSearchQuery(request.artist, request.title)
              const slskResults = await this.searchSoulseek(cleanQuery, request.accounts)
              const scored = slskResults
                .map((item) => {
                  const match = scoreProviderMatch(
                    { title: request.title, artist: request.artist, duration: song?.duration },
                    item
                  )
                  return { ...item, _score: match.score }
                })
                .filter((item) => item._score >= 60)
                .sort((a, b) => {
                  if (Math.abs(b._score - a._score) > 5) {
                    return b._score - a._score
                  }
                  if (Boolean(a.slots) !== Boolean(b.slots)) {
                    return a.slots ? -1 : 1
                  }
                  return b._score - a._score
                })

              if (scored.length > 0) {
                const bestSlsk = scored[0]
                const slskRequest: StartDownloadRequest = {
                  ...request,
                  source: 'soulseek',
                  resultId: bestSlsk.id,
                  title: bestSlsk.title,
                  artist: bestSlsk.artist
                }
                await this.executeSoulseek(slskRequest, stagingDirectory, song, signal)
                return
              }
            } catch (slskErr) {
              console.warn('Soulseek fallback error from Deezer:', slskErr)
            }
          }

          // 2. Fall back to YouTube Music
          emitProgress({
            transferId: request.transferId,
            songId: request.songId,
            title: request.title,
            artist: request.artist,
            status: 'downloading',
            progress: 15,
            message: 'Deezer unavailable; falling back to YouTube Music...'
          })
          let bestYtResult: ProviderSearchResult | null = null
          try {
            const cleanQuery = cleanSearchQuery(request.artist, request.title)
            const ytResults = await this.searchYoutube(cleanQuery)
            const scored = ytResults
              .map((item) => {
                const match = scoreProviderMatch(
                  { title: request.title, artist: request.artist, duration: song?.duration },
                  item
                )
                return { ...item, _score: match.score }
              })
              .filter((item) => item._score >= 55)
              .sort((a, b) => b._score - a._score)

            if (scored.length > 0) {
              bestYtResult = scored[0]
            }
          } catch (ytErr) {
            console.warn('YouTube search error during Deezer fallback:', ytErr)
          }

          if (bestYtResult) {
            const ytRequest: StartDownloadRequest = {
              ...request,
              source: 'youtube',
              resultId: bestYtResult.id,
              title: bestYtResult.title,
              artist: bestYtResult.artist,
              artworkUrl: bestYtResult.artworkUrl || request.artworkUrl
            }
            await this.executeYoutube(ytRequest, stagingDirectory, song, signal)
            return
          }

          throw deezerError
        }
      }
    } catch (error) {
      if (signal.aborted) {
        emitProgress({
          transferId: request.transferId,
          songId: request.songId,
          title: request.title,
          artist: request.artist,
          status: 'failed',
          progress: 0,
          message: 'Download cancelled'
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      emitProgress({
        transferId: request.transferId,
        songId: request.songId,
        title: request.title,
        artist: request.artist,
        status: 'failed',
        progress: 0,
        message: message.includes('ENOENT')
          ? `${request.source === 'youtube' ? 'yt-dlp/ffmpeg' : request.source} was not found.`
          : message
      })
    }
  }

  private static async executeYoutube(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any,
    signal: AbortSignal
  ): Promise<void> {
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 10,
      message: 'Connecting to YouTube Music...'
    })

    const { command, prefixArgs } = findYtDlp()
    const ffmpegLoc = findFfmpegLocation()
    let videoUrl: string
    if (request.resultId.startsWith('https://') || request.resultId.startsWith('http://')) {
      const parsed = new URL(request.resultId)
      if (!/(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(parsed.hostname)) {
        throw new Error('Only valid YouTube URLs are permitted for YouTube downloads.')
      }
      videoUrl = request.resultId
    } else if (request.resultId.startsWith('ytsearch')) {
      videoUrl = request.resultId
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(request.resultId)) {
      videoUrl = `https://www.youtube.com/watch?v=${request.resultId}`
    } else {
      videoUrl = `ytsearch1:${request.artist} ${request.title}`
    }

    const buildArgs = (targetUrl: string) => {
      const list = [
        ...prefixArgs,
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--no-playlist',
        '--newline',
        '--format',
        'bestaudio/best',
        '--retries',
        '3',
        '--fragment-retries',
        '3',
        '--socket-timeout',
        '30',
        '--no-warnings',
        '--no-check-certificates',
        '--extractor-args',
        'youtube:player_client=android,web',
        '--force-overwrites',
        '--embed-metadata',
        '--write-thumbnail',
        '-o',
        path.join(stagingDirectory, '%(title)s.%(ext)s')
      ]

      if (ffmpegLoc && ffmpegLoc !== 'ffmpeg') {
        list.push('--ffmpeg-location', ffmpegLoc)
      }

      list.push('--', targetUrl)
      return list
    }

    const progressHandler = (chunk: string) => {
      const percentMatch = /\[download\]\s+(\d+(?:\.\d+)?)%/i.exec(chunk)
      if (percentMatch) {
        const pct = parseFloat(percentMatch[1])
        const scaled = Math.min(90, 10 + Math.floor(pct * 0.8))
        emitProgress({
          transferId: request.transferId,
          status: 'downloading',
          progress: scaled,
          message: `Downloading YouTube audio (${pct.toFixed(0)}%)...`
        })
      } else if (chunk.includes('[ExtractAudio]')) {
        emitProgress({
          transferId: request.transferId,
          status: 'downloading',
          progress: 92,
          message: 'Converting audio with ffmpeg...'
        })
      }
    }

    let downloadSucceeded = false
    try {
      await runCommand(command, buildArgs(videoUrl), progressHandler, 180000, signal)
      const initialFiles = getAudioFiles(stagingDirectory)
      if (initialFiles.length > 0) {
        downloadSucceeded = true
      }
    } catch (primaryErr) {
      console.warn('[DownloadService] Primary YouTube attempt failed, checking fallback:', primaryErr)
    }

    if (!downloadSucceeded && !signal.aborted && !videoUrl.startsWith('ytsearch')) {
      const fallbackUrl = `ytsearch1:${request.artist} ${request.title}`
      emitProgress({
        transferId: request.transferId,
        status: 'downloading',
        progress: 15,
        message: 'Direct video unavailable, searching YouTube fallback...'
      })
      try {
        await runCommand(command, buildArgs(fallbackUrl), progressHandler, 180000, signal)
      } catch (fallbackErr) {
        console.warn('[DownloadService] YouTube search fallback also failed:', fallbackErr)
      }
    }

    if (signal.aborted) throw new Error('Download cancelled')

    const downloadedFiles = getAudioFiles(stagingDirectory).sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
    )
    if (downloadedFiles.length === 0) {
      throw new Error(
        'YouTube did not produce an audio file. The video may be unavailable, age-restricted, or require an updated yt-dlp installation.'
      )
    }

    const completed = await finalizeDownloadedFile(downloadedFiles[0], request, song, stagingDirectory)

    emitProgress({
      transferId: request.transferId,
      songId: request.songId || completed.updatedSong?.id,
      title: request.title,
      artist: request.artist,
      status: 'completed',
      progress: 100,
      message: request.storageMode === 'stream'
        ? 'Audio cached for streaming'
        : completed.replaced
          ? 'Audio replaced from YouTube successfully'
          : 'YouTube track added to library',
      filePath: completed.filePath,
      song: completed.updatedSong
    })
  }

  private static async executeSoulseek(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) throw new Error('Download cancelled')
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 8,
      message: 'Connecting to Soulseek peer network...'
    })

    const providers = await getExternalProviders()
    if (!providers?.slsk || !providers?.getSoulseekCredentials) {
      throw new Error('Soulseek P2P provider is not available in this build.')
    }
    const slsk = providers.slsk
    const formatSoulseekError = providers.formatSoulseekError || ((e: any) => String(e?.message || e))

    const credentials = providers.getSoulseekCredentials(request.accounts)

    let targetFileObj: any
    try {
      targetFileObj = JSON.parse(request.resultId)
    } catch {
      throw new Error('Invalid Soulseek file reference.')
    }

    const rawFile = String(targetFileObj.file || '').replace(/^@@/, '')
    const baseName = path
      .basename(rawFile)
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 160)
    const targetFile = path.join(stagingDirectory, baseName)

    await new Promise<void>((resolve, reject) => {
      let clientInstance: any = null
      let settled = false

      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        try {
          clientInstance?.destroy?.()
        } catch {}
        if (error) reject(error)
        else resolve()
      }

      if (signal.aborted) {
        finish(new Error('Download cancelled'))
        return
      }

      const onAbort = () => finish(new Error('Download cancelled'))
      signal.addEventListener('abort', onAbort, { once: true })

      slsk.connect({ ...credentials, timeout: 30000 }, (err: any, client: any) => {
        if (err || !client) {
          finish(new Error(formatSoulseekError(err)))
          return
        }
        clientInstance = client

        if (signal.aborted) {
          finish(new Error('Download cancelled'))
          return
        }

        try {
          client.download(
            {
              file: targetFileObj,
              path: targetFile,
              signal,
              onProgress: (_status: string, state: any) => {
                if (signal.aborted) return
                const progress = Math.max(0, Math.min(100, Math.round(Number(state?.progress || 0) * 100)))
                const speed = state?.speed ? `${Math.round(Number(state.speed) / 1024)} KB/s` : 'connecting...'
                emitProgress({
                  transferId: request.transferId,
                  status: 'downloading',
                  progress: Math.min(95, Math.max(8, progress)),
                  message: `Downloading from Soulseek peer (${speed})...`
                })
              }
            },
            (downloadErr: Error | null) => {
              signal.removeEventListener('abort', onAbort)
              if (downloadErr) finish(downloadErr)
              else finish(null)
            }
          )
        } catch (downloadEx) {
          finish(downloadEx as Error)
        }
      })
    })

    if (signal.aborted) throw new Error('Download cancelled')

    const downloadedFiles = getAudioFiles(stagingDirectory).sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
    )
    if (downloadedFiles.length === 0) {
      throw new Error('Soulseek download finished but audio file was not saved.')
    }

    const completed = await finalizeDownloadedFile(downloadedFiles[0], request, song, stagingDirectory)

    emitProgress({
      transferId: request.transferId,
      songId: request.songId || completed.updatedSong?.id,
      title: request.title,
      artist: request.artist,
      status: 'completed',
      progress: 100,
      message: request.storageMode === 'stream'
        ? 'Audio cached for streaming'
        : completed.replaced
          ? 'Audio replaced from Soulseek successfully'
          : 'Soulseek track added to library',
      filePath: completed.filePath,
      song: completed.updatedSong
    })
  }

  private static async executeQobuz(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) throw new Error('Download cancelled')
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 10,
      message: 'Connecting to Qobuz Hi-Res lossless stream...'
    })

    const providers = await getExternalProviders()
    if (!providers?.QobuzClient) {
      throw new Error('Qobuz streaming provider is not available in this build.')
    }
    const client = new providers.QobuzClient({
      authMethod: request.accounts.qobuzAuthMethod,
      user: request.accounts.qobuzUser,
      secret: request.accounts.qobuzSecret,
      appId: request.accounts.qobuzAppId,
      appSecret: request.accounts.qobuzAppSecret,
      quality: request.accounts.qobuzQuality
    })

    const safeBaseName = `${request.artist} - ${request.title}`.replace(/[<>:"/\\|?*]/g, '_').slice(0, 160)
    const stagingFilePath = path.join(stagingDirectory, safeBaseName)

    const result = await client.downloadTrack(
      request.resultId,
      stagingFilePath,
      request.accounts.qobuzQuality,
      (pct, downloadedBytes, totalBytes) => {
        if (signal.aborted) return
        const sizeMb = (downloadedBytes / 1024 / 1024).toFixed(1)
        const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : ''
        emitProgress({
          transferId: request.transferId,
          status: 'downloading',
          progress: Math.min(95, 10 + Math.floor(pct * 0.85)),
          message: totalMb
            ? `Downloading Qobuz stream (${sizeMb} MB / ${totalMb} MB)...`
            : `Downloading Qobuz stream (${sizeMb} MB)...`
        })
      },
      signal
    )

    if (signal.aborted) throw new Error('Download cancelled')

    const completed = await finalizeDownloadedFile(result.filePath, request, song, stagingDirectory)

    emitProgress({
      transferId: request.transferId,
      songId: request.songId || completed.updatedSong?.id,
      title: request.title,
      artist: request.artist,
      status: 'completed',
      progress: 100,
      message: request.storageMode === 'stream'
        ? 'Audio cached for streaming'
        : completed.replaced
          ? 'Audio replaced with Qobuz FLAC successfully'
          : 'Qobuz Hi-Res FLAC added to library',
      filePath: completed.filePath,
      song: completed.updatedSong
    })
  }

  private static async executeDeezer(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) throw new Error('Download cancelled')
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 10,
      message: 'Connecting to Deezer lossless stream...'
    })

    const providers = await getExternalProviders()
    if (!providers?.DeezerClient) {
      throw new Error('Deezer streaming provider is not available in this build.')
    }
    const client = new providers.DeezerClient({
      arl: request.accounts.deezerArl,
      quality: (request.accounts.deezerQuality as any) || 'lossless'
    })

    const safeBaseName = `${request.artist} - ${request.title}`.replace(/[<>:"/\\|?*]/g, '_').slice(0, 160)
    const isFlac = request.accounts.deezerQuality !== 'mp3-320' && request.accounts.deezerQuality !== 'mp3-128'
    const targetExt = isFlac ? '.flac' : '.mp3'
    const stagingFilePath = path.join(stagingDirectory, `${safeBaseName}${targetExt}`)

    const result = await client.downloadTrack(
      request.resultId,
      stagingFilePath,
      (request.accounts.deezerQuality as any) || 'lossless',
      (pct, downloadedBytes, totalBytes) => {
        if (signal.aborted) return
        const sizeMb = (downloadedBytes / 1024 / 1024).toFixed(1)
        const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : ''
        emitProgress({
          transferId: request.transferId,
          status: 'downloading',
          progress: Math.min(95, 10 + Math.floor(pct * 0.85)),
          message: totalMb
            ? `Downloading & decrypting Deezer stream (${sizeMb} MB / ${totalMb} MB)...`
            : `Downloading & decrypting Deezer stream (${sizeMb} MB)...`
        })
      },
      signal
    )

    if (signal.aborted) throw new Error('Download cancelled')

    const finalPath = result.filePath
    const completed = await finalizeDownloadedFile(finalPath, request, song, stagingDirectory)

    emitProgress({
      transferId: request.transferId,
      songId: request.songId || completed.updatedSong?.id,
      title: request.title,
      artist: request.artist,
      status: 'completed',
      progress: 100,
      message: request.storageMode === 'stream'
        ? 'Audio cached for streaming'
        : completed.replaced
          ? 'Audio replaced with Deezer track successfully'
          : `Deezer ${result.format} added to library`,
      filePath: completed.filePath,
      song: completed.updatedSong
    })
  }

  static async testQobuzConnection(accounts: StreamingAccounts): Promise<{ success: boolean; message: string }> {
    const providers = await getExternalProviders()
    if (!providers?.QobuzClient) {
      return { success: false, message: 'Qobuz provider is not available in this build.' }
    }
    return providers.QobuzClient.testConnection({
      authMethod: accounts.qobuzAuthMethod,
      user: accounts.qobuzUser,
      secret: accounts.qobuzSecret,
      appId: accounts.qobuzAppId,
      appSecret: accounts.qobuzAppSecret,
      quality: accounts.qobuzQuality
    })
  }

  static async testDeezerConnection(accounts: StreamingAccounts): Promise<{ success: boolean; message: string }> {
    const providers = await getExternalProviders()
    if (!providers?.DeezerClient) {
      return { success: false, message: 'Deezer provider is not available in this build.' }
    }
    return providers.DeezerClient.testConnection({
      arl: accounts.deezerArl,
      quality: (accounts.deezerQuality as any) || 'lossless'
    })
  }

  static async checkDependencies(): Promise<{
    ytDlp: { available: boolean; command?: string }
    ffmpeg: { available: boolean; path?: string }
  }> {
    const ytdlRes = findYtDlp()
    let ffmpegPath = findFfmpegLocation()

    let ytdlWorking = false
    try {
      await runCommand(ytdlRes.command, [...ytdlRes.prefixArgs, '--version'], undefined, 4000)
      ytdlWorking = true
    } catch {
      ytdlWorking = false
    }

    let ffmpegWorking = false
    if (ffmpegPath) {
      try {
        const bin = ffmpegPath.endsWith('.exe') ? ffmpegPath : path.join(ffmpegPath, 'ffmpeg.exe')
        await runCommand(bin, ['-version'], undefined, 4000)
        ffmpegWorking = true
      } catch {
        ffmpegWorking = false
      }
    }
    if (!ffmpegWorking) {
      try {
        await runCommand('ffmpeg', ['-version'], undefined, 4000)
        ffmpegWorking = true
        ffmpegPath = 'ffmpeg'
      } catch {}
    }

    return {
      ytDlp: { available: ytdlWorking, command: ytdlRes.command },
      ffmpeg: { available: ffmpegWorking, path: ffmpegPath }
    }
  }

  static async installDependencies(onOutput?: (chunk: string) => void): Promise<{ success: boolean; message: string }> {
    const scriptPath = resourcePath('downloader', 'install-download-deps.ps1')
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Installer script not found at ${scriptPath}`)
    }

    try {
      const { stdout } = await runCommand(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        onOutput,
        300000
      )
      return { success: true, message: 'Dependencies installed successfully!\n' + stdout }
    } catch (err: any) {
      return { success: false, message: err?.message || 'Installation failed' }
    }
  }
}
