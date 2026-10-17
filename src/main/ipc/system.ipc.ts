import { app, BrowserWindow, dialog, desktopCapturer, ipcMain, net, shell } from 'electron'
import fs from 'fs'
import { join, resolve } from 'path'
import { DownloadService } from '../services/DownloadService'
import {
  runMusicPresenceSetupScript,
  getMusicPresenceStatus,
  launchMusicPresence
} from '../services/MusicPresenceService'
import { isPathAllowedForMedia } from '../protocols'
import { validateWith, SafeExternalUrlSchema } from '../../shared/validators/ipcSchemas'

export type UpdateCheckResult = {
  status: 'up-to-date' | 'available' | 'unavailable' | 'error'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message?: string
}

function normalizeGithubRepository(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (shorthand) return `${shorthand[1]}/${shorthand[2].replace(/\.git$/, '')}`

  const githubUrl = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[#/]|$)/i.exec(trimmed)
  return githubUrl ? `${githubUrl[1]}/${githubUrl[2].replace(/\.git$/, '')}` : null
}

function configuredGithubRepository(): string | null {
  const environmentRepository = process.env.FELO_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY
  const fromEnvironment = normalizeGithubRepository(environmentRepository)
  if (fromEnvironment) return fromEnvironment

  try {
    const metadata = JSON.parse(fs.readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    const repository =
      typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
    return (
      normalizeGithubRepository(repository) ||
      normalizeGithubRepository(metadata.homepage) ||
      normalizeGithubRepository(metadata.githubRepository)
    )
  } catch {
    return null
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (version: string) =>
    version
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const leftParts = parse(left)
  const rightParts = parse(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export async function checkGithubRelease(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const repository = configuredGithubRepository()
  if (!repository) return { status: 'unavailable', currentVersion }

  try {
    const response = await net.fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Felo/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!response.ok) {
      throw new Error(`GitHub release check failed (${response.status})`)
    }

    const release = (await response.json()) as { tag_name?: string; html_url?: string }
    const latestVersion = release.tag_name?.replace(/^v/i, '')
    if (!latestVersion) throw new Error('The latest GitHub release has no version tag')

    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'up-to-date',
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url
    }
  } catch (error) {
    return {
      status: 'error',
      currentVersion,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function registerSystemIpc(): void {
  // Library: Open directory picker
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0]

    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'Select a music folder'
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select a music folder'
        })

    if (!canceled && filePaths.length > 0) {
      return filePaths[0]
    }
    return null
  })

  // Desktop Audio Loopback: enumerate capture sources
  ipcMain.handle('desktopAudio:getSources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 200, height: 120 }
      })
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null
      }))
    } catch (err) {
      console.error('[DesktopAudio] Failed to enumerate desktop sources:', err)
      return []
    }
  })

  // System: Get app version
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion()
  })

  // System: Get app mode and active streaming providers
  ipcMain.handle('system:getAppMode', async () => {
    return DownloadService.getProviderInfo()
  })

  ipcMain.handle('system:checkForUpdates', () => checkGithubRelease())

  // System: Open external URL (strictly validated to http/https/mailto)
  ipcMain.handle('system:openExternal', (_, url: string) => {
    try {
      const validUrl = validateWith(SafeExternalUrlSchema, url)
      shell.openExternal(validUrl)
    } catch (err) {
      console.warn('[Security] Blocked attempt to open external unsafe URL:', url, err)
    }
  })

  // System: Reveal file or open directory in explorer (path containment verified)
  ipcMain.handle('system:revealFile', (_, targetPath: string) => {
    if (targetPath && typeof targetPath === 'string') {
      const cleanPath = targetPath.trim().replace(/^["']|["']$/g, '')
      if (cleanPath && fs.existsSync(cleanPath)) {
        const resolved = resolve(cleanPath)
        try {
          const stat = fs.statSync(resolved)
          if (stat.isDirectory()) {
            shell.openPath(resolved)
          } else if (isPathAllowedForMedia(resolved)) {
            shell.showItemInFolder(resolved)
          } else {
            console.warn('[Security] Blocked system:revealFile for path outside media/library:', resolved)
          }
        } catch (err) {
          console.error('[System] Failed to reveal file or folder:', err)
        }
      }
    }
  })

  // ─── Window Controls (for frameless window) ──────────────
  ipcMain.on('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  // Music Presence: Setup & Status integration IPC
  ipcMain.handle('system:setupMusicPresence', () => {
    return runMusicPresenceSetupScript()
  })
  ipcMain.handle('system:getMusicPresenceStatus', () => {
    return getMusicPresenceStatus()
  })
  ipcMain.handle('system:launchMusicPresence', () => {
    return launchMusicPresence()
  })
  ipcMain.handle('system:relaunchApp', () => {
    app.relaunch()
    app.exit(0)
  })
}
