import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDb } from '../database'
import { LibraryService } from './LibraryService'

// soulseek-ts is loaded as CommonJS because the Electron main process uses require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SlskClient } = require('soulseek-ts')

// Keep the existing callback-based provider code isolated from the modern
// promise/stream API used by soulseek-ts.
const slsk = {
  connect: (options: any, callback: (error: Error | null, client?: any) => void) => {
    const client = new SlskClient({
      serverAddress: {
        host: options.host || 'server.slsknet.org',
        port: options.port || 2242
      },
      listenPort: options.incomingPort || 2234
    })

    client
      .login(options.user, options.pass, options.timeout || 30000)
      .then(() => {
        callback(null, {
          search: (request: any, searchCallback: (error: Error | null, results: any[]) => void) => {
            client
              .search(request.req, { timeout: request.timeout || 6000 })
              .then((responses: any[]) => {
                const results = responses.flatMap((response) =>
                  (response.files || []).map((file: any) => ({
                    user: response.username,
                    file: file.filename,
                    size: Number(file.size),
                    slots: Boolean(response.slotsFree),
                    speed: response.avgSpeed
                  }))
                )
                searchCallback(null, results)
              })
              .catch((error: Error) => searchCallback(error, []))
          },
          download: async (request: any, downloadCallback: (error: Error | null, data?: any) => void) => {
            try {
              const download = await client.download(request.file.user, request.file.file)
              let settled = false
              const finish = (error: Error | null, data?: any) => {
                if (settled) return
                settled = true
                downloadCallback(error, data)
              }

              download.events.on('status', (status: string, data: any) => {
                request.onProgress?.(status, data)
              })
              download.events.on('progress', (data: any) => {
                request.onProgress?.('downloading', data)
              })

              const output = fs.createWriteStream(request.path)
              download.stream.pipe(output)
              output.once('finish', () => {
                finish(null, { buffer: fs.readFileSync(request.path) })
              })
              output.once('error', (error: Error) => finish(error))
              download.stream.once('error', (error: Error) => finish(error))
            } catch (error) {
              downloadCallback(error as Error)
            }
          },
          destroy: () => client.destroy()
        })
      })
      .catch((error: Error) => {
        client.destroy()
        callback(error)
      })
  }
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
}

export interface StartDownloadResult {
  started: boolean
  transferId: string
  alreadyExists?: boolean
  duplicateRequest?: boolean
}

interface DownloadProgressEvent {
  transferId: string
  status: 'downloading' | 'completed' | 'failed'
  progress: number
  message: string
  filePath?: string
  song?: unknown
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

const SOULSEEK_CREDENTIALS_SETTING = 'download.soulseekCredentials'

type SoulseekCredentials = { user: string; pass: string }
type CommandResolution = { command: string; prefixArgs: string[] }

function getSoulseekCredentials(accounts: StreamingAccounts): SoulseekCredentials {
  const user = accounts.soulseekUser?.trim()
  const pass = accounts.soulseekPassword?.trim()

  if (user || pass) {
    if (!user || !pass) {
      throw new Error('Enter both your Soulseek username and password.')
    }
    return { user, pass }
  }

  // Soulseek accepts a new account, but the credentials must remain stable.
  // Reusing one generated account prevents every request from starting a new
  // login with a different username and avoids repeated login resets.
  const db = getDb()
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(SOULSEEK_CREDENTIALS_SETTING) as { value?: string } | undefined

  if (row?.value) {
    try {
      const saved = JSON.parse(row.value) as Partial<SoulseekCredentials>
      if (saved.user && saved.pass) return { user: saved.user, pass: saved.pass }
    } catch {}
  }

  const credentials = {
    user: `felo_${crypto.randomBytes(6).toString('hex')}`,
    pass: crypto.randomBytes(12).toString('base64url')
  }
  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updatedAt)
     VALUES (?, ?, strftime('%s', 'now'))`
  ).run(SOULSEEK_CREDENTIALS_SETTING, JSON.stringify(credentials))

  return credentials
}

function formatSoulseekError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  const normalized = raw.toLowerCase()

  if (
    normalized.includes('timeout login') ||
    normalized.includes('econnreset') ||
    normalized.includes('invalid password') ||
    normalized.includes('authentication') ||
    normalized.includes('login')
  ) {
    return 'Soulseek login failed. Check your username and password and try again.'
  }

  return raw || 'Failed to connect to Soulseek network.'
}

function emitProgress(event: DownloadProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('downloads:progress', event)
  }
}

function runCommand(
  command: string,
  args: string[],
  onProgress?: (data: string) => void,
  timeoutMs = 0
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    const timeout = timeoutMs
      ? setTimeout(() => {
          child.kill()
          reject(new Error(`Download process timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
        }, timeoutMs)
      : undefined
    const clearProcessTimeout = () => {
      if (timeout) clearTimeout(timeout)
    }
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
      reject(error)
    })
    child.on('close', (code) => {
      clearProcessTimeout()
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

function findStreamrip(): CommandResolution {
  const homeDir = app.getPath('home')

  // Static bundled locations
  const bundled = existingFile(
    resourcePath('downloader', 'bin', 'rip.exe'),
    resourcePath('downloader', 'rip.exe'),
    resourcePath('downloader', 'python', 'Scripts', 'rip.exe')
  )
  if (bundled) return { command: bundled, prefixArgs: [] }

  // Dynamically discover all installed Python versions under the standard
  // Windows install path instead of hardcoding specific versions.
  const pythonRoot = path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python')
  const dynamicCandidates: string[] = []
  try {
    for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^Python\d/i.test(entry.name)) {
        dynamicCandidates.push(path.join(pythonRoot, entry.name, 'Scripts', 'rip.exe'))
      }
    }
    // Sort descending so the newest Python version is preferred
    dynamicCandidates.sort().reverse()
  } catch {
    // pythonRoot may not exist on this machine
  }

  // pip --user installs go to AppData\Roaming\Python\PythonXYZ\Scripts
  const userPythonRoot = path.join(homeDir, 'AppData', 'Roaming', 'Python')
  try {
    for (const entry of fs.readdirSync(userPythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^Python\d/i.test(entry.name)) {
        dynamicCandidates.push(path.join(userPythonRoot, entry.name, 'Scripts', 'rip.exe'))
      }
    }
  } catch {
    // userPythonRoot may not exist
  }

  // WinGet shim link
  dynamicCandidates.push(
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'rip.exe')
  )

  const found = existingFile(...dynamicCandidates)
  if (found) return { command: found, prefixArgs: [] }

  // Fallback: invoke streamrip as a Python module (mirrors findYtDlp behaviour)
  const pythonCandidates = [
    resourcePath('downloader', 'python', 'python.exe'),
    ...discoverPythonExecutables(homeDir),
    'python.exe',
    'python'
  ]
  for (const py of pythonCandidates) {
    if (fs.existsSync(py)) {
      return { command: py, prefixArgs: ['-m', 'streamrip'] }
    }
  }

  return { command: 'rip', prefixArgs: [] }
}

/** Discover python.exe across all installed Python versions. */
function discoverPythonExecutables(homeDir: string): string[] {
  const pythonRoot = path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python')
  const results: string[] = []
  try {
    for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^Python\d/i.test(entry.name)) {
        results.push(path.join(pythonRoot, entry.name, 'python.exe'))
      }
    }
    results.sort().reverse()
  } catch {
    // pythonRoot may not exist
  }
  return results
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

  // Dynamically discover yt-dlp across all installed Python versions
  const pythonRoot = path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python')
  const dynamicCandidates: string[] = []
  try {
    for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^Python\d/i.test(entry.name)) {
        dynamicCandidates.push(path.join(pythonRoot, entry.name, 'Scripts', 'yt-dlp.exe'))
      }
    }
    dynamicCandidates.sort().reverse()
  } catch {
    // pythonRoot may not exist
  }

  dynamicCandidates.push('yt-dlp.exe', 'yt-dlp')

  for (const candidate of dynamicCandidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, prefixArgs: [] }
    }
  }

  // Fallback: invoke via python -m yt_dlp
  const pythonCandidates = [
    resourcePath('downloader', 'python', 'python.exe'),
    ...discoverPythonExecutables(homeDir),
    'python.exe',
    'python'
  ]
  for (const py of pythonCandidates) {
    if (fs.existsSync(py)) {
      return { command: py, prefixArgs: ['-m', 'yt_dlp'] }
    }
  }

  return { command: 'yt-dlp', prefixArgs: [] }
}


function findFfmpegLocation(): string | undefined {
  const homeDir = app.getPath('home')
  const candidates = [
    resourcePath('downloader', 'bin', 'ffmpeg.exe'),
    resourcePath('downloader', 'ffmpeg.exe'),
    resourcePath('downloader', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    resourcePath('downloader', 'ffmpeg', 'bin'),
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function patchTomlSection(
  input: string,
  section: string,
  values: Record<string, string | number | boolean | string[]>
): string {
  const newline = input.includes('\r\n') ? '\r\n' : '\n'
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headerPattern = new RegExp(`^\\[${escapedSection}\\]\\s*$`, 'm')
  const headerMatch = headerPattern.exec(input)
  const encodedValues = Object.entries(values).map(([key, value]) => {
    const encoded = Array.isArray(value)
      ? `[${value.map((item) => tomlString(item)).join(', ')}]`
      : typeof value === 'string'
        ? tomlString(value)
        : String(value)
    return { key, line: `${key} = ${encoded}` }
  })

  if (!headerMatch) {
    const lines = encodedValues.map(({ line }) => line).join(newline)
    return `${input.trimEnd()}${newline}${newline}[${section}]${newline}${lines}${newline}`
  }

  const bodyStart = headerMatch.index + headerMatch[0].length
  const nextHeaderPattern = /^\[[^\]]+\]\s*$/gm
  nextHeaderPattern.lastIndex = bodyStart
  const nextHeader = nextHeaderPattern.exec(input)
  const bodyEnd = nextHeader?.index ?? input.length
  let body = input.slice(bodyStart, bodyEnd)

  for (const { key } of encodedValues) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    body = body.replace(new RegExp(`^\\s*${escapedKey}\\s*=.*(?:\\r?\\n|$)`, 'gm'), '')
  }

  const replacementBody = `${body.trimEnd()}${newline}${encodedValues
    .map(({ line }) => line)
    .join(newline)}${newline}${newline}`
  return `${input.slice(0, bodyStart)}${replacementBody}${input.slice(bodyEnd)}`
}

function sanitizeToken(value?: string): string {
  return (value || '').replace(/\s+/g, '')
}

function sanitizeText(value?: string): string {
  return (value || '').trim()
}

const DEFAULT_STREAMRIP_TOML = `[downloads]
source_subdirectories = false
disc_subdirectories = true
concurrency = true
max_connections = 6
requests_per_minute = 60
verify_ssl = true

[qobuz]
quality = 4
download_booklets = true
use_auth_token = true
email_or_userid = ""
password_or_token = ""
app_id = ""
secrets = []

[deezer]
quality = 2
arl = ""
use_deezloader = true
deezloader_warnings = true

[artwork]
embed = true
embed_size = "large"
save_artwork = true

[filepaths]
add_singles_to_folder = false
folder_format = "{albumartist} - {title} ({year})"
track_format = "{tracknumber:02}. {artist} - {title}"
restrict_characters = false
`

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

function ensureStreamripConfig(accounts: StreamingAccounts): string {
  const configPath = path.join(app.getPath('userData'), 'streamrip-config.toml')
  const standardConfig = path.join(app.getPath('appData'), 'streamrip', 'config.toml')

  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(standardConfig)) {
      fs.copyFileSync(standardConfig, configPath)
    } else {
      fs.writeFileSync(configPath, DEFAULT_STREAMRIP_TOML, 'utf8')
    }
  }

  let config = fs.readFileSync(configPath, 'utf8')
  const customFolder = getCustomDownloadDirectory()
  config = patchTomlSection(config, 'downloads', {
    folder: customFolder
  })

  if (accounts.qobuzUser || accounts.qobuzSecret) {
    const quality =
      accounts.qobuzQuality === 'hires-max'
        ? 4
        : accounts.qobuzQuality === 'hires'
          ? 3
          : accounts.qobuzQuality === 'cd'
            ? 2
            : 1
    const cleanUser = sanitizeText(accounts.qobuzUser)
    const cleanSecret =
      accounts.qobuzAuthMethod === 'password'
        ? sanitizeText(accounts.qobuzSecret)
        : sanitizeToken(accounts.qobuzSecret)
    const cleanAppId = sanitizeText(accounts.qobuzAppId)
    const cleanAppSecret = sanitizeText(accounts.qobuzAppSecret)

    config = patchTomlSection(config, 'qobuz', {
      quality,
      use_auth_token: accounts.qobuzAuthMethod !== 'password',
      email_or_userid: cleanUser,
      password_or_token: cleanSecret,
      app_id: cleanAppId,
      secrets: cleanAppSecret ? [cleanAppSecret] : []
    })
  }
  if (accounts.deezerArl) {
    const cleanArl = sanitizeToken(accounts.deezerArl)
    const quality =
      accounts.deezerQuality === 'lossless' ? 2 : accounts.deezerQuality === 'mp3-320' ? 1 : 0
    config = patchTomlSection(config, 'deezer', {
      quality,
      arl: cleanArl,
      use_deezloader: true
    })
  }
  fs.writeFileSync(configPath, config, 'utf8')
  return configPath
}

function splitDescription(description: string): { title: string; artist: string } {
  const separator = description.lastIndexOf(' by ')
  if (separator < 0) return { title: description, artist: '' }
  return {
    title: description.slice(0, separator).trim(),
    artist: description.slice(separator + 4).trim()
  }
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

function getDirectorySize(root: string): number {
  return getAudioFiles(root).reduce((total, filePath) => {
    try {
      return total + fs.statSync(filePath).size
    } catch {
      return total
    }
  }, 0)
}

function cleanYoutubeTitle(value: string): string {
  return value
    .replace(/\bunknown\s+artist\b/gi, '')
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
  const songs = getDb().prepare('SELECT * FROM songs').all() as any[]
  const normalizedTitle = normalizeDuplicateValue(title)
  const normalizedArtist = normalizeDuplicateValue(artist)
  return songs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false
    const songTitle = normalizeDuplicateValue(String(song.title || ''))
    const songArtist = normalizeDuplicateValue(String(song.artist || ''))
    const artistMatches =
      songArtist === normalizedArtist ||
      !normalizedArtist ||
      normalizedArtist === 'unknown artist' ||
      songArtist === 'unknown artist'
    return songTitle === normalizedTitle && artistMatches
  })
}

function getStreamCacheDirectory(): string {
  const directory = path.join(app.getPath('userData'), 'stream-cache')
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

function getStreamCacheLimit(): number {
  try {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get('download.streamCacheLimit') as { value?: string } | undefined
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

  const files = getAudioFiles(getStreamCacheDirectory()).sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  files.slice(getStreamCacheLimit()).forEach((file) => {
    try { fs.unlinkSync(file) } catch {}
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
  conflictMode: 'replace' | 'keep_both'
): { filePath: string; replaced: boolean; oldPath?: string } {
  const sourceLabel =
    source === 'qobuz'
      ? 'Qobuz'
      : source === 'deezer'
        ? 'Deezer'
        : source === 'soulseek'
          ? 'Soulseek'
          : 'YouTube'
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

  if (conflictMode === 'replace' && !isVirtual && song?.filePath) {
    const oldPath = path.resolve(song.filePath)
    const directTargetPath = path.join(
      targetDirectory,
      `${path.basename(oldPath, path.extname(oldPath))}${downloadedExtension}`
    )
    const targetPath =
      path.normalize(oldPath).toLowerCase() === path.normalize(directTargetPath).toLowerCase() ||
      fs.existsSync(directTargetPath)
        ? uniquePath(
            path.join(
              targetDirectory,
              `${path.basename(oldPath, path.extname(oldPath))} (${sourceLabel})${downloadedExtension}`
            )
          )
        : directTargetPath
    const incomingPath = `${targetPath}.felo-incoming`
    fs.copyFileSync(downloadedPath, incomingPath)

    fs.renameSync(incomingPath, targetPath)
    return { filePath: targetPath, replaced: true, oldPath }
  }

  const downloadedBase = path.basename(downloadedPath, downloadedExtension)
  const cleanBase = source === 'youtube' ? cleanYoutubeTitle(downloadedBase) : downloadedBase
  const sourceSuffix = source === 'youtube' ? '' : ` (${sourceLabel})`
  const targetPath = uniquePath(
    path.join(targetDirectory, `${cleanBase}${sourceSuffix}${downloadedExtension}`)
  )
  fs.copyFileSync(downloadedPath, targetPath)
  return { filePath: targetPath, replaced: false }
}

async function finalizeDownloadedFile(
  downloadedPath: string,
  request: StartDownloadRequest,
  song: any
): Promise<{ filePath: string; updatedSong: any; replaced: boolean; oldPath?: string }> {
  if (request.storageMode === 'stream') {
    const updatedSong = cacheDownloadedFile(downloadedPath, request, song)
    return { filePath: updatedSong.filePath, updatedSong, replaced: false }
  }

  const completed = moveCompletedFile(downloadedPath, request.source, song, request.conflictMode)
  const updatedSong = completed.replaced
    ? await LibraryService.replaceSongFile(request.songId, completed.filePath)
    : await LibraryService.importDownloadedFile(completed.filePath, song?.rootId)
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

export class DownloadService {
  private static readonly activeDownloadKeys = new Set<string>()

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

    return this.searchStreamrip(source, query, accounts)
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
          const title =
            vr.title?.runs?.map((r: any) => r.text).join('') ||
            vr.title?.simpleText ||
            'YouTube Track'
          const owner =
            vr.ownerText?.runs?.map((r: any) => r.text).join('') || 'YouTube'
          const duration = vr.lengthText?.simpleText || ''
          results.push({
            id: vr.videoId,
            source: 'youtube',
            mediaType: 'track',
            title,
            artist: owner,
            album: 'YouTube Music',
            quality: 'Opus / MP3 256k',
            description: `${owner}${duration ? ` · ${duration}` : ''}`,
            size: 'Standard Audio',
            meta: duration ? `${duration} · YouTube Audio` : 'YouTube Audio'
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

  private static async searchSoulseek(
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    return new Promise((resolve, reject) => {
      let credentials: { user: string; pass: string }
      try {
        credentials = getSoulseekCredentials(accounts)
      } catch (error) {
        reject(error)
        return
      }

      // Sonosano query normalization
      const cleanQuery = query
        .replace(/\s*\(feat\.[^)]*\)/gi, '')
        .replace(/\s*\(ft\.[^)]*\)/gi, '')
        .replace(/\s*\[feat\.[^\]]*\]/gi, '')
        .replace(/\s*\[ft\.[^\]]*\]/gi, '')
        .replace(/\s*feat\..*/gi, '')
        .replace(/\s*ft\..*/gi, '')
        .replace(/\s*\(remaster[^)]*\)/gi, '')
        .replace(/\s*\[remaster[^\]]*\]/gi, '')
        .replace(/\s*\(official[^)]*\)/gi, '')
        .replace(/\s*\[official[^\]]*\]/gi, '')
        .replace(/,/g, ' ')
        .replace(/[[\]"'(){}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const searchTerm = cleanQuery || query.trim()

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

          // Deduplicate identical files (same filename and size) like Sonosano
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

          // Sonosano ranking: Lossless FIRST, followed by combined Quality + Slots + Speed
          deduplicated.sort((a, b) => {
            const extA = path.extname(a.file).toLowerCase()
            const extB = path.extname(b.file).toLowerCase()
            const lossA = DownloadService.isLosslessFormat(extA, a.file) ? 1 : 0
            const lossB = DownloadService.isLosslessFormat(extB, b.file) ? 1 : 0
            if (lossA !== lossB) {
              return lossB - lossA
            }
            const scoreA = DownloadService.calculateSoulseekQualityScore(a, extA)
            const scoreB = DownloadService.calculateSoulseekQualityScore(b, extB)
            if (scoreA !== scoreB) {
              return scoreB - scoreA
            }
            return (b.speed || 0) - (a.speed || 0)
          })

          const mapped: ProviderSearchResult[] = deduplicated.slice(0, 30).map((item) => {
            const rawFile = String(item.file || '').replace(/^@@/, '')
            const parts = rawFile.split(/[/\\]/).filter(Boolean)
            const fileName = parts[parts.length - 1] || rawFile
            const cleanTitle = fileName
              .replace(/\.[^.]+$/, '')
              .replace(/^[\d\s._-]+/, '')
            const folderName = parts.length > 1 ? parts[parts.length - 2] : ''
            const ext = path.extname(fileName).toLowerCase()
            const isLossless = DownloadService.isLosslessFormat(ext, fileName)
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

            return {
              id: JSON.stringify({ user: item.user, file: item.file, size: item.size }),
              source: 'soulseek',
              mediaType: 'track',
              title: cleanTitle || fileName,
              artist: item.user ? `Peer: ${item.user}` : 'Soulseek Peer',
              album: folderName || 'Soulseek P2P',
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

  private static async searchStreamrip(
    source: 'qobuz' | 'deezer',
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    const configPath = ensureStreamripConfig(accounts)
    const outputPath = path.join(app.getPath('temp'), `felo-${source}-${crypto.randomUUID()}.json`)

    try {
      const { command, prefixArgs } = findStreamrip()
      await runCommand(command, [
        ...prefixArgs,
        '--config-path',
        configPath,
        'search',
        source,
        'track',
        query.trim(),
        '-n',
        '8',
        '-o',
        outputPath
      ])
      const raw = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as any[]
      return raw.map((item) => {
        const description = String(item.desc || '')
        const parsed = splitDescription(description)
        return {
          id: String(item.id),
          source,
          mediaType: 'track' as const,
          title: parsed.title,
          artist: parsed.artist,
          description,
          quality: source === 'qobuz' ? 'FLAC up to 24-bit/192kHz' : 'FLAC up to 16-bit/44.1kHz'
        }
      })
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    }
  }

  static start(request: StartDownloadRequest): StartDownloadResult {
    const downloadKey = `${request.source}:${request.resultId}`
    if (this.activeDownloadKeys.has(downloadKey)) {
      return { started: false, transferId: request.transferId, duplicateRequest: true }
    }

    this.activeDownloadKeys.add(downloadKey)
    void this.execute(request).finally(() => this.activeDownloadKeys.delete(downloadKey))
    return { started: true, transferId: request.transferId }
  }

  private static async execute(request: StartDownloadRequest): Promise<void> {
    if (request.skipIfExists) {
      const existingSong = findExistingLibrarySong(request.title, request.artist)
      if (existingSong) {
        emitProgress({
          transferId: request.transferId,
          status: 'completed',
          progress: 100,
          message: 'Song already exists in your library; using the existing file.',
          filePath: existingSong.filePath,
          song: existingSong
        })
        return
      }
    }

    const stagingRoot = path.join(app.getPath('userData'), 'download-staging')
    const stagingDirectory = path.join(stagingRoot, request.transferId)
    const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(request.songId) as any

    try {
      fs.mkdirSync(stagingDirectory, { recursive: true })

      if (request.source === 'youtube') {
        await this.executeYoutube(request, stagingDirectory, song)
        return
      }

      if (request.source === 'soulseek') {
        await this.executeSoulseek(request, stagingDirectory, song)
        return
      }

      await this.executeStreamrip(request, stagingDirectory, song)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitProgress({
        transferId: request.transferId,
        status: 'failed',
        progress: 0,
        message: message.includes('ENOENT')
          ? `${request.source === 'youtube' ? 'yt-dlp/ffmpeg' : 'Streamrip'} was not found in bundled resources or system PATH.`
          : message
      })
    }
  }

  private static async executeYoutube(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any
  ): Promise<void> {
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 10,
      message: 'Connecting to YouTube Music...'
    })

    const { command, prefixArgs } = findYtDlp()
    const ffmpegLoc = findFfmpegLocation()
    const videoUrl = request.resultId.startsWith('http')
      ? request.resultId
      : `https://www.youtube.com/watch?v=${request.resultId}`

    const args = [
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
      '--force-overwrites',
      '-o',
      path.join(stagingDirectory, '%(title)s.%(ext)s')
    ]

    if (ffmpegLoc) {
      args.push('--ffmpeg-location', ffmpegLoc)
    }

    args.push(videoUrl)

    await runCommand(command, args, (chunk) => {
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
    }, 180000)

    const downloadedFiles = getAudioFiles(stagingDirectory).sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
    )
    if (downloadedFiles.length === 0) {
      throw new Error(
        'YouTube did not produce an audio file. The video may be unavailable, age-restricted, or require an updated yt-dlp installation.'
      )
    }

    const completed = await finalizeDownloadedFile(downloadedFiles[0], request, song)

    if (completed.oldPath && fs.existsSync(completed.oldPath)) {
      try {
        fs.unlinkSync(completed.oldPath)
      } catch (err) {
        console.warn('Could not delete old file:', err)
      }
    }

    emitProgress({
      transferId: request.transferId,
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
    song: any
  ): Promise<void> {
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 8,
      message: 'Connecting to Soulseek peer network...'
    })

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
    const stagingFilePath = path.join(stagingDirectory, baseName)

    const credentials = getSoulseekCredentials(request.accounts)

    await new Promise<void>((resolve, reject) => {
      let clientInstance: any = null
      const downloadTimeout = setTimeout(() => {
        try {
          clientInstance?.destroy?.()
        } catch {}
        reject(new Error('Soulseek peer did not send file within timeout.'))
      }, 90000)

      slsk.connect({ ...credentials, timeout: 30000 }, (err: any, client: any) => {
        if (err || !client) {
          clearTimeout(downloadTimeout)
          reject(new Error(formatSoulseekError(err)))
          return
        }
        clientInstance = client

        emitProgress({
          transferId: request.transferId,
          status: 'downloading',
          progress: 20,
          message: `Requesting "${baseName}" from peer ${targetFileObj.user}...`
        })

        client.download(
          {
            file: targetFileObj,
            path: stagingFilePath,
            onProgress: (status: string, data: any) => {
              const progress = Number(data?.progress || 0)
              const scaledProgress = status === 'downloading'
                ? 20 + Math.min(70, Math.max(0, progress * 70))
                : status === 'complete'
                  ? 90
                  : 20
              const message =
                status === 'requested'
                  ? `Requesting "${baseName}" from peer ${targetFileObj.user}...`
                  : status === 'queued'
                    ? `Queued by peer ${targetFileObj.user}; waiting for a slot...`
                    : status === 'connected'
                      ? `Connected to peer ${targetFileObj.user}; starting transfer...`
                      : `Downloading "${baseName}" from peer ${targetFileObj.user}...`
              emitProgress({
                transferId: request.transferId,
                status: 'downloading',
                progress: scaledProgress,
                message
              })
            }
          },
          (downloadErr: any, data: any) => {
            clearTimeout(downloadTimeout)
            try {
              client.destroy?.()
            } catch {}

            if (downloadErr) {
              reject(new Error(downloadErr.message || 'Soulseek peer transfer failed.'))
              return
            }

            // If file was not written to disk yet, write data buffer
            if (!fs.existsSync(stagingFilePath) && data?.buffer) {
              fs.writeFileSync(stagingFilePath, data.buffer)
            }
            resolve()
          }
        )
      })
    })

    const downloadedFiles = getAudioFiles(stagingDirectory).sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
    )
    if (downloadedFiles.length === 0) {
      throw new Error('Soulseek download finished but audio file was not saved.')
    }

    const completed = await finalizeDownloadedFile(downloadedFiles[0], request, song)

    if (completed.oldPath && fs.existsSync(completed.oldPath)) {
      try {
        fs.unlinkSync(completed.oldPath)
      } catch (err) {
        console.warn('Could not delete old file:', err)
      }
    }

    emitProgress({
      transferId: request.transferId,
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

  private static async executeStreamrip(
    request: StartDownloadRequest,
    stagingDirectory: string,
    song: any
  ): Promise<void> {
    const configPath = ensureStreamripConfig(request.accounts)
    emitProgress({
      transferId: request.transferId,
      status: 'downloading',
      progress: 8,
      message: `Connecting to ${request.source === 'qobuz' ? 'Qobuz' : 'Deezer'}...`
    })

    const startedAt = Date.now()
    const progressTimer = setInterval(() => {
      const bytes = getDirectorySize(stagingDirectory)
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      emitProgress({
        transferId: request.transferId,
        status: 'downloading',
        progress:
          bytes > 0
            ? Math.min(92, 28 + Math.floor(bytes / 1024 / 1024))
            : Math.min(24, 8 + elapsed),
        message:
          bytes > 0
            ? `Downloading audio (${(bytes / 1024 / 1024).toFixed(1)} MB)`
            : 'Resolving track...'
      })
    }, 600)

    try {
      const { command, prefixArgs } = findStreamrip()
      await runCommand(command, [
        ...prefixArgs,
        '--config-path',
        configPath,
        '--folder',
        stagingDirectory,
        '-ndb',
        '--no-progress',
        'id',
        request.source,
        'track',
        request.resultId
      ])
    } finally {
      clearInterval(progressTimer)
    }

    const downloadedFiles = getAudioFiles(stagingDirectory).sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
    )
    if (downloadedFiles.length === 0)
      throw new Error('Streamrip completed without an audio file.')

    const completed = await finalizeDownloadedFile(downloadedFiles[0], request, song)

    if (completed.oldPath && fs.existsSync(completed.oldPath)) {
      try {
        fs.unlinkSync(completed.oldPath)
      } catch (error) {
        console.warn(
          `Downloaded replacement is active, but the old file could not be removed: ${completed.oldPath}`,
          error
        )
      }
    }

    emitProgress({
      transferId: request.transferId,
      status: 'completed',
      progress: 100,
      message: request.storageMode === 'stream'
        ? 'Audio cached for streaming'
        : completed.replaced
          ? 'Audio replaced successfully'
          : 'Download added to library',
      filePath: completed.filePath,
      song: completed.updatedSong
    })
  }
}
