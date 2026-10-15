import dotenv from 'dotenv'
dotenv.config()
dotenv.config({ path: '.env.local', override: true })

// Helper script to register Discord Slash Commands for the Universal Felo Bot
// Usage: npm run register:discord -- <YOUR_DISCORD_BOT_TOKEN>
// Or set DISCORD_BOT_TOKEN in .env or .env.local, then: npm run register:discord

export const SLASH_COMMANDS = [
  {
    name: 'connect',
    description: 'Link this Discord channel to your Felo desktop Listen Together room',
    options: [
      {
        name: 'code',
        description: 'Your 6-character Felo room code (shown in Felo Settings → Discord or Listen Together)',
        type: 3,
        required: true
      }
    ]
  },
  {
    name: 'disconnect',
    description: 'Unlink this Discord channel or end the Listen Together session'
  },
  {
    name: 'play',
    description: 'Play a song in the connected Felo room (auto-downloads if not in local library)',
    options: [
      {
        name: 'query',
        description: 'Song title, artist, or album to search & play',
        type: 3,
        required: true
      },
      {
        name: 'action',
        description: 'Playback action',
        type: 3,
        required: false,
        choices: [
          { name: '▶️ Play Now', value: 'play_now' },
          { name: '⏭️ Play Next', value: 'play_next' },
          { name: '➕ Add to Queue', value: 'enqueue' }
        ]
      }
    ]
  },
  {
    name: 'jumpto',
    description: 'Jump directly to a specific song number in the queue to play instantly',
    options: [
      {
        name: 'position',
        description: 'Track number in the queue to jump to (e.g. 1, 2, 5)',
        type: 4,
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'bump',
    description: 'Bump a track in the queue to Priority #1 (plays immediately next)',
    options: [
      {
        name: 'position',
        description: 'Track number in the queue to make priority',
        type: 4,
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'remove',
    description: 'Remove a specific track from the room queue',
    options: [
      {
        name: 'position',
        description: 'Track number in the queue to remove',
        type: 4,
        required: true,
        min_value: 1
      }
    ]
  },
  {
    name: 'priority',
    description: 'Toggle or configure Discord priority requests mode for this room',
    options: [
      {
        name: 'enabled',
        description: 'Enable or disable Discord priority queueing',
        type: 5,
        required: false
      }
    ]
  },
  {
    name: 'skip',
    description: 'Skip to the next song in the connected room'
  },
  {
    name: 'previous',
    description: 'Play previous song in the connected room'
  },
  {
    name: 'stop',
    description: 'Stop music playback and reset position'
  },
  {
    name: 'pause',
    description: 'Pause playback in the connected room'
  },
  {
    name: 'resume',
    description: 'Resume playback in the connected room'
  },
  {
    name: 'seek',
    description: 'Seek to a position in seconds in the current song',
    options: [
      {
        name: 'seconds',
        description: 'Position in seconds to jump to',
        type: 4,
        required: true,
        min_value: 0
      }
    ]
  },
  {
    name: 'nowplaying',
    description: 'Show currently playing track with progress bar and room code'
  },
  {
    name: 'queue',
    description: 'View the live session music queue and upcoming tracks',
    options: [
      {
        name: 'page',
        description: 'Queue page number (10 tracks per page)',
        type: 4,
        required: false,
        min_value: 1
      }
    ]
  },
  {
    name: 'invite',
    description: 'Get room code and 1-click web player invite link for the connected room'
  },
  {
    name: 'download',
    description: 'Get official download links for Felo Music Player'
  },
  {
    name: 'help',
    description: 'Complete guide for the Universal Felo Discord Bot'
  }
]

import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  const clean = (val) => (val ? String(val).replace(/^["']|["']$/g, '').trim() : '')

  let token = clean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN)
  let appId = clean(process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID)
  let guildId = clean(process.env.DISCORD_GUILD_ID)

  // 1. CLI argument parsing
  const rawArg1 = process.argv[2]?.trim()
  const rawArg2 = process.argv[3]?.trim()
  const rawArg3 = process.argv[4]?.trim()

  if (rawArg1 === '--help' || rawArg1 === '-h' || rawArg1 === 'help') {
    console.log(`
⚡ Felo Universal Discord Slash Commands Auto-Registrar

Usage:
  1️⃣  Using token from .env or .env.local:
      npm run register:discord

  2️⃣  Or passing token directly via CLI:
      npm run register:discord -- <YOUR_DISCORD_BOT_TOKEN>

  3️⃣  Optional guild-specific registration (instant propagation for 1 server):
      npm run register:discord -- <YOUR_DISCORD_BOT_TOKEN> <GUILD_ID>

Features:
  • Reads DISCORD_BOT_TOKEN from .env or .env.local
  • Auto-queries Discord API (@me) using Bot Token to resolve Application ID automatically
  • Registers all 18 commands globally across all Discord servers where the bot is invited
`)
    process.exit(0)
  }

  let cliTokenProvided = false
  if (rawArg1) {
    if (rawArg1.startsWith('--token=')) {
      token = clean(rawArg1.slice(8))
      cliTokenProvided = true
    } else if (rawArg1.startsWith('-t=')) {
      token = clean(rawArg1.slice(3))
      cliTokenProvided = true
    } else if (rawArg1.includes('.') || rawArg1.length > 35 || !/^\d+$/.test(rawArg1)) {
      // First arg is a bot token
      token = clean(rawArg1)
      guildId = clean(rawArg2) || guildId
      cliTokenProvided = true
    } else {
      // First arg is numeric App ID
      appId = clean(rawArg1)
      if (rawArg2) {
        token = clean(rawArg2)
        cliTokenProvided = true
      }
      guildId = clean(rawArg3) || guildId
    }
  }

  // 2. Fallback: Auto-detect token from Felo desktop app SQLite database
  if (!token) {
    try {
      const appData =
        process.env.APPDATA ||
        (process.platform === 'darwin'
          ? path.join(process.env.HOME || '', 'Library', 'Application Support')
          : path.join(process.env.HOME || '', '.config'))
      const feloDbPath = path.join(appData, 'felo', 'felo.db')

      if (fs.existsSync(feloDbPath)) {
        const { default: Database } = await import('better-sqlite3')
        const db = new Database(feloDbPath, { readonly: true, fileMustExist: true })
        const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get('felo_discord_bot_token')
        db.close()
        if (row?.value) {
          const parsed = JSON.parse(row.value)
          if (parsed && typeof parsed === 'string' && parsed.trim()) {
            token = clean(parsed)
            console.log('💡 Auto-loaded Discord Bot Token from Felo Desktop App settings database!')
          }
        }
      }
    } catch {
      // Ignored
    }
  }

  if (cliTokenProvided) {
    console.log('🔑 Using Discord Bot Token provided via CLI argument')
  } else if (token) {
    console.log('🔑 Auto-loaded DISCORD_BOT_TOKEN from environment (.env / .env.local)')
  }

  if (!token) {
    console.log(`
ℹ️  No Discord Bot Token found.

You can register commands in either of two simple ways:

1️⃣  Pass your token directly in the command:
    npm run register:discord -- YOUR_DISCORD_BOT_TOKEN

2️⃣  Or save your token in .env or .env.local:
    DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
    Then run:
    npm run register:discord
`)
    process.exit(1)
  }

  if (token && token.length === 64 && /^[0-9a-f]{64}$/i.test(token)) {
    console.error(`
❌ Error: The provided token is a Discord PUBLIC KEY (64 hex characters), not a Bot Token!

💡 How to get your Discord Bot Token:
  1. Open https://discord.com/developers/applications
  2. In the left menu, click the "Bot" tab (NOT "General Information").
  3. Click "Reset Token" (or "Copy").
  4. A Discord Bot Token looks like: MTU1...xxxx.xxxx
`)
    process.exit(1)
  }

  async function run() {
    // 3. Automatically fetch Application ID from Discord if not specified
    if (!appId) {
      console.log('🔍 Fetching Discord Application details from Bot Token...')
      try {
        const meRes = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(10000)
        })
        if (!meRes.ok) {
          const meErr = await meRes.text()
          throw new Error(`Discord API returned ${meRes.status}: ${meErr}`)
        }
        const botUser = await meRes.json()
        appId = botUser.id
        console.log(`🤖 Authenticated as: @${botUser.username}#${botUser.discriminator || '0'} (App ID: ${appId})`)
      } catch (err) {
        console.error(`❌ Could not authenticate with Discord API: ${err?.message || err}`)
        if (String(err).includes('401')) {
          console.error('\n💡 Tip: 401 Unauthorized means the Discord Bot Token is invalid or expired. Check your token in Discord Developer Portal -> Bot tab.')
        }
        process.exit(1)
      }
    }

    const url = guildId
      ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
      : `https://discord.com/api/v10/applications/${appId}/commands`

    const targetDesc = guildId ? `guild ${guildId}` : 'global'
    console.log(`📡 Registering ${SLASH_COMMANDS.length} ${targetDesc} slash commands with Discord for App ID: ${appId}...`)

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(SLASH_COMMANDS),
        signal: AbortSignal.timeout(12000)
      })

      if (res.ok) {
        const data = await res.json()
        console.log(`\n🎉 Successfully registered ${data.length} slash commands with Discord!`)
        console.log(`✨ Available commands:\n${data.map((c) => `   • /${c.name} — ${c.description}`).join('\n')}`)
        console.log(`\n👉 You can now type these commands in any Discord channel linked to Felo!`)
      } else {
        const errText = await res.text()
        console.error(`❌ Discord API returned error ${res.status}:`, errText)
        if (res.status === 401) {
          console.error(`
💡 Tip: 401 Unauthorized means Discord rejected your token.
• Ensure you are passing the Bot Token from Discord Developer Portal -> "Bot" tab -> "Reset Token".
• Do NOT use the Public Key or Client Secret from the "General Information" tab.
`)
        }
      }
    } catch (err) {
      console.error(`\n❌ Failed to connect to Discord API: ${err?.message || err}`)
      console.error(`
⚠️  Why did this happen?
Your local network or ISP blocked or timed out direct TCP connections to discord.com:443.

💡 Easy solutions:
  1. Turn on Cloudflare WARP (1.1.1.1) or any VPN on your computer, then re-run this command.
  2. If using a local proxy (e.g. Clash / v2ray / Fiddler), specify it when running:
     $env:HTTPS_PROXY="http://127.0.0.1:7890"; node scripts/register-discord-commands.mjs ...
  3. Deploy the Cloudflare Worker with 'npm run deploy:worker', which registers commands in the cloud with zero ISP blocking!
`)
      process.exit(1)
    }
  }

  run().catch(console.error)
}
