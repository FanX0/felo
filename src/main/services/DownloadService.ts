import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getDb } from '../database'
import { LibraryService } from './LibraryService'

export type StreamingSource = 'qobuz' | 'deezer'

export interface StreamingAccounts {
  qobuzAuthMethod?: 'token' | 'password'
  qobuzUser?: string
  qobuzSecret?: string
  qobuzAppId?: string
  qobuzAppSecret?: string
  qobuzQuality?: string
  deezerArl?: string
  deezerQuality?: string
}

export interface ProviderSearchResult {
  id: string
  source: StreamingSource
  mediaType: 'track'
  title: string
  artist: string
  description: string
  quality: string
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
}

interface DownloadProgressEvent {
  transferId: string
  status: 'downloading' | 'completed' | 'failed'
  progress: number
  message: string
  filePath?: string
  song?: unknown
}

const AUDIO_EXTENSIONS = new Set(['.flac', '.mp3', '.m4a', '.wav', '.ogg', '.opus', '.aac'])

function emitProgress(event: DownloadProgressEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('downloads:progress', event)
  }
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `Streamrip exited with code ${code}`))
    })
  })
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

function ensureStreamripConfig(accounts: StreamingAccounts): string {
  const configPath = path.join(app.getPath('userData'), 'streamrip-config.toml')
  const standardConfig = path.join(app.getPath('appData'), 'streamrip', 'config.toml')

  if (!fs.existsSync(configPath)) {
    if (!fs.existsSync(standardConfig)) {
      throw new Error('Streamrip is not configured. Run `rip config` once, then test the account.')
    }
    fs.copyFileSync(standardConfig, configPath)
  }

  let config = fs.readFileSync(configPath, 'utf8')
  if (accounts.qobuzUser || accounts.qobuzSecret) {
    const quality =
      accounts.qobuzQuality === 'hires-max'
        ? 4
        : accounts.qobuzQuality === 'hires'
          ? 3
          : accounts.qobuzQuality === 'cd'
            ? 2
            : 1
    config = patchTomlSection(config, 'qobuz', {
      quality,
      use_auth_token: accounts.qobuzAuthMethod !== 'password',
      email_or_userid: accounts.qobuzUser || '',
      password_or_token: accounts.qobuzSecret || '',
      app_id: accounts.qobuzAppId || '',
      secrets: accounts.qobuzAppSecret ? [accounts.qobuzAppSecret] : []
    })
  }
  if (accounts.deezerArl) {
    const quality =
      accounts.deezerQuality === 'lossless' ? 2 : accounts.deezerQuality === 'mp3-320' ? 1 : 0
    config = patchTomlSection(config, 'deezer', {
      quality,
      arl: accounts.deezerArl,
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

function uniquePath(candidate: string): string {
  if (!fs.existsSync(candidate)) return candidate
  const directory = path.dirname(candidate)
  const extension = path.extname(candidate)
  const base = path.basename(candidate, extension)
  let number = 2
  while (fs.existsSync(path.join(directory, `${base} (${number})${extension}`))) number++
  return path.join(directory, `${base} (${number})${extension}`)
}

function moveCompletedFile(
  downloadedPath: string,
  source: StreamingSource,
  song: any,
  conflictMode: 'replace' | 'keep_both'
): { filePath: string; replaced: boolean; oldPath?: string } {
  const sourceLabel = source === 'qobuz' ? 'Qobuz' : 'Deezer'
  const downloadedExtension = path.extname(downloadedPath).toLowerCase()
  const libraryRoot = song?.rootId
    ? (getDb().prepare('SELECT path FROM library_roots WHERE id = ?').get(song.rootId) as any)?.path
    : null
  const targetDirectory = song?.filePath
    ? path.dirname(song.filePath)
    : libraryRoot || path.join(app.getPath('music'), 'Felo')
  fs.mkdirSync(targetDirectory, { recursive: true })

  if (conflictMode === 'replace' && song?.filePath) {
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
  const targetPath = uniquePath(
    path.join(targetDirectory, `${downloadedBase} (${sourceLabel})${downloadedExtension}`)
  )
  fs.copyFileSync(downloadedPath, targetPath)
  return { filePath: targetPath, replaced: false }
}

export class DownloadService {
  static async search(
    source: StreamingSource,
    query: string,
    accounts: StreamingAccounts
  ): Promise<ProviderSearchResult[]> {
    if (!query.trim()) return []
    const configPath = ensureStreamripConfig(accounts)
    const outputPath = path.join(app.getPath('temp'), `felo-${source}-${crypto.randomUUID()}.json`)

    try {
      await runCommand('rip', [
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

  static start(request: StartDownloadRequest): { started: true; transferId: string } {
    void this.execute(request)
    return { started: true, transferId: request.transferId }
  }

  private static async execute(request: StartDownloadRequest): Promise<void> {
    const stagingRoot = path.join(app.getPath('userData'), 'download-staging')
    const stagingDirectory = path.join(stagingRoot, request.transferId)
    const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(request.songId) as any

    try {
      const configPath = ensureStreamripConfig(request.accounts)
      fs.mkdirSync(stagingDirectory, { recursive: true })
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
        await runCommand('rip', [
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

      const completed = moveCompletedFile(
        downloadedFiles[0],
        request.source,
        song,
        request.conflictMode
      )
      const updatedSong = completed.replaced
        ? await LibraryService.replaceSongFile(request.songId, completed.filePath)
        : await LibraryService.importDownloadedFile(completed.filePath, song?.rootId)

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
        message: completed.replaced ? 'Audio replaced successfully' : 'Download added to library',
        filePath: completed.filePath,
        song: updatedSong
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emitProgress({
        transferId: request.transferId,
        status: 'failed',
        progress: 0,
        message: message.includes('ENOENT')
          ? 'Streamrip was not found. Install it and ensure `rip` is available in PATH.'
          : message
      })
    }
  }
}
