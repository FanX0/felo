import 'dotenv/config'

// Helper script to register Discord Slash Commands for the Universal Felo Bot
// Usage: node scripts/register-discord-commands.mjs [APPLICATION_ID] [BOT_TOKEN] [GUILD_ID]
// Or set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN (and optional DISCORD_GUILD_ID) in .env

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
    description: 'Unlink this Discord channel from the connected Felo room'
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
    description: 'Show room code and 1-click join links for friends'
  },
  {
    name: 'join',
    description: '1-click web player link and step-by-step guide to join the room'
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

const appId = process.argv[2] || process.env.DISCORD_APPLICATION_ID
const token = process.argv[3] || process.env.DISCORD_BOT_TOKEN
const guildId = process.argv[4] || process.env.DISCORD_GUILD_ID

if (!appId || !token) {
  console.log(`
ℹ️  Usage:
  node scripts/register-discord-commands.mjs <DISCORD_APPLICATION_ID> <DISCORD_BOT_TOKEN> [DISCORD_GUILD_ID]

Or configure in your .env file:
  DISCORD_APPLICATION_ID=123456789012345678
  DISCORD_BOT_TOKEN=your_bot_token_here
  # DISCORD_GUILD_ID=your_server_id (optional, for instant guild registration)

Then run:
  npm run register:discord
`)
  process.exit(1)
}

async function run() {
  const url = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`

  const targetDesc = guildId ? `guild ${guildId}` : 'global'
  console.log(`📡 Registering ${SLASH_COMMANDS.length} ${targetDesc} slash commands with Discord for App ID: ${appId}...`)

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(SLASH_COMMANDS)
  })

  if (res.ok) {
    const data = await res.json()
    console.log(`✅ Successfully registered ${data.length} ${targetDesc} slash commands with Discord!`)
    console.log('Commands:', data.map((c) => `/${c.name}`).join(', '))
  } else {
    console.error(`❌ Discord API returned error ${res.status}:`, await res.text())
  }
}

run().catch(console.error)
