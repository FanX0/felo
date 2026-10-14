import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { execSync, spawn } from 'child_process'

const DISCORD_APPLICATION_ID = '1540785679859056640'
const MUSIC_PRESENCE_RELATIVE_PATH = path.join('Music Presence')
const PLAYER_ID = 'felo'

const FELO_PLAYER = {
  id: PLAYER_ID,
  name: 'Felo',
  url: 'https://github.com/FanX0/felo',
  sources: {
    win_winrt: [
      'com.felo.app',
      'com.fanxmusic.app',
      'Felo.exe',
      'felo.exe',
      'Felo',
      'felo',
      'electron.app.Felo',
      'electron.app.felo',
      'electron.app.com.felo.app',
      'electron.exe'
    ]
  },
  attributes: {
    pure: true,
    service: false
  },
  content: ['audio', 'audio_music'],
  extra: {
    discord_application_id: DISCORD_APPLICATION_ID
  }
}

function ensureDirectory(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true })
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    const content = raw.replace(/^\uFEFF/, '').trim()
    if (!content) return fallback
    return JSON.parse(content) as T
  } catch (error) {
    console.warn(`Unable to read JSON from ${filePath}:`, error)
    return fallback
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function findAssetRoot(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'music-presence'),
    path.join(app.getAppPath(), 'resources', 'music-presence'),
    path.join(process.cwd(), 'resources', 'music-presence')
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function copyAsset(assetRoot: string, sourceName: string, targetPath: string): void {
  const sourcePath = path.join(assetRoot, sourceName)
  if (!fs.existsSync(sourcePath)) return

  try {
    if (fs.existsSync(targetPath)) {
      setReadOnly(targetPath, false)
      fs.chmodSync(targetPath, 0o666)
    }
  } catch {
    // Best effort
  }

  fs.copyFileSync(sourcePath, targetPath)
}

function configureSettings(settingsPath: string): void {
  const settings = readJson<Record<string, any>>(settingsPath, {
    version: 1,
    enabled: true,
    presence: {},
    player_overrides: { well_known: {} },
    players: { well_known: {}, unknown: [] }
  })

  settings.enabled = true
  settings.presence ??= {}
  settings.presence.show_player_logo = true
  settings.presence.show_media_playing_icon = false
  settings.presence.show_media_paused_icon = false
  settings.presence.no_cover_placeholder = 'player_logo'
  settings.presence.display_type = 'title_line'
  settings.presence.profile_display_type = 'player_name'
  settings.presence.activity_type = 'listening'
  settings.presence.custom_discord_application_id = {
    valid: true,
    value: DISCORD_APPLICATION_ID
  }

  settings.player_overrides ??= {}
  settings.player_overrides.well_known ??= {}
  settings.player_overrides.well_known[PLAYER_ID] = {
    ...(settings.player_overrides.well_known[PLAYER_ID] ?? {}),
    show_media_playing_icon: false,
    show_media_paused_icon: false,
    show_player_logo: true,
    no_cover_placeholder: 'player_logo',
    display_type: 'title_line',
    profile_display_type: 'player_name',
    activity_type: 'listening',
    custom_discord_application_id: {
      valid: true,
      value: DISCORD_APPLICATION_ID
    }
  }

  settings.players ??= {}
  settings.players.well_known ??= {}
  settings.players.well_known[PLAYER_ID] = {
    enabled: true,
    user_modified: true
  }

  // Remove felo / com.felo.app from unknown so it gets identified as well-known player
  const unknownPlayers = Array.isArray(settings.players.unknown) ? settings.players.unknown : []
  settings.players.unknown = unknownPlayers.filter((item) => {
    const id = item?.identifier?.id
    return (
      id !== 'com.felo.app' &&
      id !== 'com.fanxmusic.app' &&
      id !== 'felo' &&
      id !== 'Felo.exe' &&
      id !== 'felo.exe'
    )
  })

  writeJson(settingsPath, settings)
}

function setReadOnly(filePath: string, enabled: boolean): void {
  try {
    const { execFileSync } = require('child_process')
    execFileSync('attrib', [enabled ? '+R' : '-R', filePath], { stdio: 'ignore' })
  } catch {
    // Best effort
  }
}

function configurePlayersDatabase(playersPath: string): void {
  const assetsDir = path.dirname(playersPath)
  ensureDirectory(assetsDir)

  let basePlayers: any = null
  if (fs.existsSync(playersPath)) {
    setReadOnly(playersPath, false)
    basePlayers = readJson<Record<string, any> | null>(playersPath, null)
  }

  // If players.json is missing or was wiped/truncated (<= 1 player), recover from larger backup
  if (!basePlayers || !Array.isArray(basePlayers.players) || basePlayers.players.length <= 1) {
    try {
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir)
        const backupFile = files
          .filter((f) => f.startsWith('players.json.felo-backup') || f.startsWith('players.json.bak') || f.startsWith('players.json.felo-local'))
          .sort((a, b) => {
            const statA = fs.statSync(path.join(assetsDir, a))
            const statB = fs.statSync(path.join(assetsDir, b))
            return statB.size - statA.size
          })[0]
        if (backupFile) {
          const backupPath = path.join(assetsDir, backupFile)
          const backupData = readJson<Record<string, any> | null>(backupPath, null)
          if (backupData && Array.isArray(backupData.players) && backupData.players.length > (basePlayers?.players?.length || 0)) {
            basePlayers = backupData
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const players =
    basePlayers && Array.isArray(basePlayers.players)
      ? basePlayers
      : {
          $schema: 'https://live.musicpresence.app/v3/schemas/players.schema.json',
          version: 3,
          latest: true,
          subset: 'win',
          players: [],
          icons: {}
        }

  players.players = Array.isArray(players.players)
    ? [...players.players.filter((player: any) => player?.id !== PLAYER_ID), FELO_PLAYER]
    : [FELO_PLAYER]

  players.icons = players.icons && typeof players.icons === 'object' ? players.icons : {}
  players.icons[PLAYER_ID] = [
    { label: 'logo-128', type: 'png', url: 'felo-logo.png', md5: '' },
    { label: 'discord-large-image', type: 'png', url: 'felo-discord-large.png', md5: '' },
    { label: 'discord-small-image', type: 'png', url: 'felo-discord-small.png', md5: '' },
    { label: 'tray-menu', type: 'ico', url: 'felo.ico', md5: '' }
  ]

  writeJson(playersPath, players)
  setReadOnly(playersPath, true)
}

export function findMusicPresenceExecutable(): string | null {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

  const candidates = [
    path.join(localAppData, 'Programs', 'Music Presence', 'Music Presence.exe'),
    path.join(programFiles, 'Music Presence', 'Music Presence.exe'),
    path.join(programFilesX86, 'Music Presence', 'Music Presence.exe')
  ]

  return candidates.find((cand) => fs.existsSync(cand)) ?? null
}

export function isMusicPresenceRunning(): boolean {
  if (process.platform !== 'win32') return false
  try {
    const stdout = execSync('tasklist /FI "IMAGENAME eq Music Presence.exe" /NH', {
      encoding: 'utf8',
      windowsHide: true
    })
    return stdout.toLowerCase().includes('music presence.exe')
  } catch {
    return false
  }
}

export function getMusicPresenceStatus(): {
  installed: boolean
  running: boolean
  configured: boolean
  executablePath: string | null
} {
  const execPath = findMusicPresenceExecutable()
  const running = isMusicPresenceRunning()
  const musicPresenceRoot = path.join(app.getPath('appData'), MUSIC_PRESENCE_RELATIVE_PATH)
  const playersPath = path.join(musicPresenceRoot, 'assets', 'players.json')
  const settingsPath = path.join(musicPresenceRoot, 'settings.json')

  let configured = false
  if (fs.existsSync(playersPath) && fs.existsSync(settingsPath)) {
    try {
      const players = readJson<any>(playersPath, {})
      const settings = readJson<any>(settingsPath, {})
      const hasFeloPlayer = players?.players?.some?.((p: any) => p?.id === PLAYER_ID)
      const hasFeloSettings = settings?.players?.well_known?.felo?.enabled === true
      configured = Boolean(hasFeloPlayer && hasFeloSettings)
    } catch {
      configured = false
    }
  }

  return {
    installed: Boolean(execPath || fs.existsSync(musicPresenceRoot)),
    running,
    configured,
    executablePath: execPath
  }
}

export function launchMusicPresence(): { success: boolean; error?: string } {
  const execPath = findMusicPresenceExecutable()
  if (!execPath) {
    return { success: false, error: 'Music Presence executable not found.' }
  }

  try {
    const child = spawn(execPath, [], { detached: true, stdio: 'ignore' })
    child.unref()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}

export function configureMusicPresenceIntegration(): { success: boolean; error?: string } {
  if (process.platform !== 'win32') return { success: false, error: 'Windows only' }

  try {
    const assetRoot = findAssetRoot()
    const musicPresenceRoot = path.join(app.getPath('appData'), MUSIC_PRESENCE_RELATIVE_PATH)
    const assetsRoot = path.join(musicPresenceRoot, 'assets')

    ensureDirectory(musicPresenceRoot)
    ensureDirectory(assetsRoot)

    configureSettings(path.join(musicPresenceRoot, 'settings.json'))

    if (assetRoot) {
      copyAsset(assetRoot, 'felo-logo.png', path.join(assetsRoot, 'felo-logo.png'))
      copyAsset(assetRoot, 'felo-logo.png', path.join(assetsRoot, 'felo-discord-large.png'))
      copyAsset(assetRoot, 'felo-logo.png', path.join(assetsRoot, 'felo-discord-small.png'))
      copyAsset(assetRoot, 'felo.ico', path.join(assetsRoot, 'felo.ico'))
    }

    configurePlayersDatabase(path.join(assetsRoot, 'players.json'))
    console.log('[MusicPresence] Auto-configured Felo player integration successfully.')
    return { success: true }
  } catch (error: any) {
    console.warn('Unable to configure Music Presence integration:', error)
    return { success: false, error: error?.message || String(error) }
  }
}

export function runMusicPresenceSetupScript(): Promise<{
  success: boolean
  error?: string
  status?: ReturnType<typeof getMusicPresenceStatus>
}> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ success: false, error: 'Windows only' })
    }

    try {
      // 1. Direct configuration
      const configResult = configureMusicPresenceIntegration()
      if (!configResult.success) {
        return resolve({ success: false, error: configResult.error })
      }

      // 2. Also run PowerShell install script if available to ensure system/hosts rules
      const scriptCandidates = [
        path.join(process.resourcesPath, 'music-presence', 'install-felo-music-presence.ps1'),
        path.join(app.getAppPath(), 'resources', 'music-presence', 'install-felo-music-presence.ps1'),
        path.join(process.cwd(), 'resources', 'music-presence', 'install-felo-music-presence.ps1')
      ]
      const targetScript = scriptCandidates.find((cand) => fs.existsSync(cand))
      if (targetScript) {
        try {
          const assetRoot = path.dirname(targetScript)
          const ps = spawn(
            'powershell.exe',
            ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', targetScript, '-AssetRoot', assetRoot],
            { detached: true, stdio: 'ignore' }
          )
          ps.unref()
        } catch {
          // Best effort
        }
      }

      resolve({ success: true, status: getMusicPresenceStatus() })
    } catch (err: any) {
      resolve({ success: false, error: err?.message || String(err) })
    }
  })
}

export function startMusicPresenceIntegrationWatcher(): void {
  if (process.platform !== 'win32') return
  configureMusicPresenceIntegration()
}
