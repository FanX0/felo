const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const DISCORD_APPLICATION_ID = '1540785679859056640'
const PLAYER_ID = 'felo'

const FELO_PLAYER = {
  id: 'felo',
  name: 'Felo',
  url: 'https://github.com/FanX0/felo',

  sources: {
    win_winrt: [
      'com.felo.app',
      'Felo.exe',
      'Felo'
    ]
  },

  attributes: {
    pure: true,
    service: false
  },

  content: [
    'audio',
    'audio_music'
  ],

  extra: {
    discord_application_id: DISCORD_APPLICATION_ID
  }
}

function isWindows() {
  return process.platform === 'win32'
}

function isAdministrator() {
  try {
    execFileSync('net', ['session'], {
      stdio: 'ignore'
    })

    return true
  } catch {
    return false
  }
}

function psEscape(value) {
  return String(value).replace(/'/g, "''")
}

function restartAsAdministrator() {
  const node = psEscape(process.execPath)
  const script = psEscape(__filename)

  const command =
    `Start-Process -FilePath '${node}' ` +
    `-ArgumentList '"${script}" --elevated' ` +
    `-Verb RunAs -Wait`

  console.log('Requesting Administrator permission...')

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ],
    {
      stdio: 'inherit'
    }
  )

  process.exit(result.status ?? 0)
}

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, 'utf8')
      .replace(/^\uFEFF/, '')
  )
}

function writeJson(filePath, value) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(value, null, 2) + '\r\n',
    'utf8'
  )
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return

  const date = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')

  const destination =
    `${filePath}.felo-backup-${date}`

  fs.copyFileSync(filePath, destination)

  console.log(`Backup: ${destination}`)
}

function setReadOnly(filePath, enabled) {
  execFileSync(
    'attrib',
    [
      enabled ? '+R' : '-R',
      filePath
    ],
    {
      stdio: 'ignore'
    }
  )
}

function configurePlayers(playersPath) {
  console.log('Configuring players.json...')

  setReadOnly(playersPath, false)

  backup(playersPath)

  const database = readJson(playersPath)

  if (!Array.isArray(database.players)) {
    throw new Error(
      'players.json does not contain a players array.'
    )
  }

  const existingIndex =
    database.players.findIndex(
      player => player.id === PLAYER_ID
    )

  if (existingIndex >= 0) {
    database.players[existingIndex] = FELO_PLAYER

    console.log('Updated existing Felo player.')
  } else {
    database.players.unshift(FELO_PLAYER)

    console.log('Added Felo player.')
  }

  writeJson(playersPath, database)

  const verify = readJson(playersPath)

  const felo = verify.players.find(
    player => player.id === PLAYER_ID
  )

  if (!felo) {
    throw new Error(
      'Failed to write Felo to players.json.'
    )
  }

  console.log(
    'Player mapping:',
    'com.felo.app -> Felo'
  )
}

function ensureObject(parent, key) {
  if (
    !parent[key] ||
    typeof parent[key] !== 'object' ||
    Array.isArray(parent[key])
  ) {
    parent[key] = {}
  }

  return parent[key]
}

function configureSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) {
    console.log(
      'settings.json not found yet. Skipping settings configuration.'
    )

    return
  }

  console.log('Configuring settings.json...')

  backup(settingsPath)

  const settings = readJson(settingsPath)

  const playerOverrides =
    ensureObject(settings, 'player_overrides')

  const overridesWellKnown =
    ensureObject(playerOverrides, 'well_known')

  overridesWellKnown.felo = {
    ...(overridesWellKnown.felo ?? {}),

    activity_type: 'listening',

    display_type: 'title_line',

    profile_display_type: 'player_name',

    show_player_logo: true,

    show_media_playing_icon: false,

    show_media_paused_icon: false,

    show_album_name: true,

    show_playback_duration: true,

    no_cover_placeholder: 'player_logo',

    custom_discord_application_id: {
      valid: true,
      value: DISCORD_APPLICATION_ID
    }
  }

  const players =
    ensureObject(settings, 'players')

  const wellKnown =
    ensureObject(players, 'well_known')

  wellKnown.felo = {
    enabled: true,
    user_modified: true
  }

  if (!Array.isArray(players.unknown)) {
    players.unknown = []
  }

  // If Music Presence already detected Felo as unknown,
  // keep that session enabled too.
  for (const player of players.unknown) {
    const identifier = player?.identifier

    if (
      identifier?.interface === 'win_winrt' &&
      (
        identifier.id === 'com.felo.app' ||
        identifier.id === 'com.fanxmusic.app'
      )
    ) {
      player.state ??= {}

      player.state.enabled = true
      player.state.user_modified = true
    }
  }

  writeJson(settingsPath, settings)

  console.log('Felo Appearance override configured.')
}

function blockOnlinePlayerDatabase(hostsPath) {
  console.log(
    'Protecting local Music Presence player database...'
  )

  const rule =
    '127.0.0.1 live.musicpresence.app'

  const content =
    fs.readFileSync(hostsPath, 'utf8')

  const alreadyExists =
    /^\s*127\.0\.0\.1\s+live\.musicpresence\.app\s*$/mi
      .test(content)

  if (!alreadyExists) {
    fs.appendFileSync(
      hostsPath,
      `\r\n# Felo local Music Presence player\r\n${rule}\r\n`,
      'utf8'
    )

    console.log(
      'Blocked live.musicpresence.app.'
    )
  } else {
    console.log(
      'Music Presence player database already blocked.'
    )
  }

  execFileSync(
    'ipconfig',
    ['/flushdns'],
    {
      stdio: 'ignore'
    }
  )
}

function verify(playersPath, settingsPath) {
  console.log('')
  console.log('===== FELO SETUP RESULT =====')

  const players = readJson(playersPath)

  const felo =
    players.players.find(
      player => player.id === 'felo'
    )

  console.log(
    'Felo player:',
    felo ? 'OK' : 'MISSING'
  )

  console.log(
    'Identifier:',
    felo?.sources?.win_winrt?.includes(
      'com.felo.app'
    )
      ? 'OK'
      : 'MISSING'
  )

  if (fs.existsSync(settingsPath)) {
    const settings =
      readJson(settingsPath)

    console.log(
      'Felo enabled:',
      settings?.players?.well_known?.felo
        ?.enabled === true
        ? 'YES'
        : 'NO'
    )

    console.log(
      'Discord App ID:',
      settings
        ?.player_overrides
        ?.well_known
        ?.felo
        ?.custom_discord_application_id
        ?.value ?? 'MISSING'
    )
  }

  console.log(
    'players.json read-only:',
    (() => {
      try {
        const output =
          execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `(Get-Item '${psEscape(playersPath)}').IsReadOnly`
            ],
            {
              encoding: 'utf8'
            }
          )

        return output.trim()
      } catch {
        return 'UNKNOWN'
      }
    })()
  )

  console.log('')
  console.log('Setup complete.')
  console.log('')
  console.log(
    'Start Music Presence first.'
  )
  console.log(
    'Then start Felo and play a song.'
  )
}

function main() {
  if (!isWindows()) {
    throw new Error(
      'This setup currently supports Windows only.'
    )
  }

  if (
    !isAdministrator() &&
    !process.argv.includes('--elevated')
  ) {
    restartAsAdministrator()
    return
  }

  const appData = process.env.APPDATA

  if (!appData) {
    throw new Error(
      'APPDATA environment variable is unavailable.'
    )
  }

  const musicPresenceRoot =
    path.join(
      appData,
      'Music Presence'
    )

  const playersPath =
    path.join(
      musicPresenceRoot,
      'assets',
      'players.json'
    )

  const settingsPath =
    path.join(
      musicPresenceRoot,
      'settings.json'
    )

  const hostsPath =
    path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'drivers',
      'etc',
      'hosts'
    )

  if (!fs.existsSync(playersPath)) {
    console.error('')
    console.error(
      'Music Presence has not created players.json yet.'
    )
    console.error('')
    console.error(
      '1. Open Music Presence once.'
    )
    console.error(
      '2. Wait a few seconds.'
    )
    console.error(
      '3. Close Music Presence.'
    )
    console.error(
      '4. Run this setup again.'
    )

    process.exit(1)
  }

  // Close Music Presence before modifying files.
  try {
    execFileSync(
      'taskkill',
      [
        '/IM',
        'Music Presence.exe',
        '/F'
      ],
      {
        stdio: 'ignore'
      }
    )
  } catch {
    // Not running.
  }

  configurePlayers(playersPath)

  configureSettings(settingsPath)

  blockOnlinePlayerDatabase(hostsPath)

  // Critical:
  // prevent Music Presence from replacing Felo
  // with the downloaded official player database.
  setReadOnly(playersPath, true)

  verify(
    playersPath,
    settingsPath
  )
}

try {
  main()
} catch (error) {
  console.error('')
  console.error('Felo setup failed:')
  console.error(error)
  process.exit(1)
}
