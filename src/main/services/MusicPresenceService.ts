import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const DISCORD_APPLICATION_ID = '1540785679859056640'
const MUSIC_PRESENCE_RELATIVE_PATH = path.join('Music Presence')
const PLAYER_ID = 'felo'
const FELO_PLAYER = {
  id: PLAYER_ID,
  name: 'Felo',
  url: 'https://github.com/FanX0/felo',
  sources: {
    win_winrt: ['com.felo.app', 'Felo.exe', 'Felo']
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
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.trim()) return fallback
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
    if (fs.existsSync(targetPath)) fs.chmodSync(targetPath, 0o666)
  } catch {
    // Best effort: Windows may not expose POSIX mode semantics for this path.
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

  const unknownPlayers = Array.isArray(settings.players.unknown) ? settings.players.unknown : []
  settings.players.unknown = [
    ...unknownPlayers.filter(
      (item) => item?.identifier?.interface !== 'win_winrt' || item?.identifier?.id !== 'com.felo.app'
    ),
    {
      identifier: {
        interface: 'win_winrt',
        id: 'com.felo.app'
      },
      state: {
        enabled: true,
        user_modified: true
      }
    }
  ]

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
  if (!fs.existsSync(playersPath)) return

  setReadOnly(playersPath, false)

  const players = readJson<Record<string, any>>(playersPath, {
    $schema: 'https://live.musicpresence.app/v3/schemas/players.schema.json',
    version: 3,
    latest: true,
    subset: 'win',
    players: [],
    icons: {}
  })

  players.players = Array.isArray(players.players)
    ? [...players.players.filter((player) => player?.id !== PLAYER_ID), FELO_PLAYER]
    : [FELO_PLAYER]

  players.icons ??= {}
  players.icons[PLAYER_ID] = [
    { label: 'logo-128', type: 'png', url: 'felo-logo.png', md5: '' },
    { label: 'discord-large-image', type: 'png', url: 'felo-discord-large.png', md5: '' },
    { label: 'discord-small-image', type: 'png', url: 'felo-discord-small.png', md5: '' },
    { label: 'tray-menu', type: 'ico', url: 'felo.ico', md5: '' }
  ]

  writeJson(playersPath, players)
  setReadOnly(playersPath, true)
}

export function configureMusicPresenceIntegration(): void {
  if (process.platform !== 'win32') return

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
  } catch (error) {
    console.warn('Unable to configure Music Presence integration:', error)
  }
}

export function runMusicPresenceSetupScript(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ success: false, error: 'Windows only' })
    }

    try {
      const { spawn } = require('child_process')
      const scriptPath = path.join(app.getAppPath(), 'scripts', 'setup-felo-music-presence.js')
      const fallbackScript = path.join(process.cwd(), 'scripts', 'setup-felo-music-presence.js')
      const targetScript = fs.existsSync(scriptPath) ? scriptPath : fallbackScript

      if (!fs.existsSync(targetScript)) {
        return resolve({ success: false, error: 'Setup script not found' })
      }

      const child = spawn('node', [targetScript], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      resolve({ success: true })
    } catch (err: any) {
      resolve({ success: false, error: err?.message || String(err) })
    }
  })
}

export function startMusicPresenceIntegrationWatcher(): void {
  if (process.platform !== 'win32') return
  // Perform one-shot safe configuration on startup
  configureMusicPresenceIntegration()
}
