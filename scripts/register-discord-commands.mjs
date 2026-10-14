// Helper script to register Discord Slash Commands for the Universal Felo Bot
// Usage: node scripts/register-discord-commands.mjs [APPLICATION_ID] [BOT_TOKEN]
// Or set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env

import { SLASH_COMMANDS } from '../src/worker/index.ts'

const appId = process.argv[2] || process.env.DISCORD_APPLICATION_ID
const token = process.argv[3] || process.env.DISCORD_BOT_TOKEN

if (!appId || !token) {
  console.log(`
ℹ️  Usage:
  node scripts/register-discord-commands.mjs <DISCORD_APPLICATION_ID> <DISCORD_BOT_TOKEN>

Example:
  node scripts/register-discord-commands.mjs 123456789012345678 OTk...
`)
  process.exit(1)
}

async function run() {
  console.log(`📡 Registering ${SLASH_COMMANDS.length} global slash commands with Discord for App ID: ${appId}...`)

  const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(SLASH_COMMANDS)
  })

  if (res.ok) {
    const data = await res.json()
    console.log(`✅ Successfully registered ${data.length} global slash commands with Discord!`)
    console.log('Commands:', data.map((c) => `/${c.name}`).join(', '))
  } else {
    console.error(`❌ Discord API returned error ${res.status}:`, await res.text())
  }
}

run().catch(console.error)
