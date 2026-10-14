// Universal Discord Bot for Felo Music & Listen Together
// Connects any Discord server/channel to an active Felo Listen Together session via Room Code.
// Runs standalone on any Node.js host (Vercel, Railway, Fly.io, Render, or VPS).

import { createClient } from '@supabase/supabase-js'

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'

const token = process.env.DISCORD_BOT_TOKEN
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is required.')
  process.exit(1)
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_KEY environment variables are required.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// In-memory cache for channel-to-room mappings (backed by Supabase)
const channelMap = new Map()

async function getRoomForChannel(channelId) {
  if (channelMap.has(channelId)) return channelMap.get(channelId)
  try {
    const { data } = await supabase
      .from('discord_channel_bindings')
      .select('room_code')
      .eq('channel_id', channelId)
      .maybeSingle()
    if (data?.room_code) {
      channelMap.set(channelId, data.room_code)
      return data.room_code
    }
  } catch (err) {
    console.warn('Error reading channel binding:', err)
  }
  return null
}

async function setRoomForChannel(channelId, guildId, roomCode, username) {
  channelMap.set(channelId, roomCode)
  try {
    await supabase.from('discord_channel_bindings').upsert({
      channel_id: channelId,
      guild_id: guildId || null,
      room_code: roomCode,
      bound_by: username || 'Discord User',
      updated_at: new Date().toISOString()
    })
  } catch (err) {
    console.warn('Error saving channel binding:', err)
  }
}

async function clearRoomForChannel(channelId) {
  channelMap.delete(channelId)
  try {
    await supabase.from('discord_channel_bindings').delete().eq('channel_id', channelId)
  } catch (err) {
    console.warn('Error deleting channel binding:', err)
  }
}

// ─── GATEWAY CLIENT ───────────────────────────────────────────────────

let ws = null
let heartbeatTimer = null
let lastHeartbeatAck = true
let sequenceNumber = null
let botUser = null

const SLASH_COMMANDS = [
  {
    name: 'connect',
    description: 'Bind this Discord channel to a live Felo Listen Together room code',
    options: [
      {
        name: 'code',
        description: 'The 6-character Felo room code (e.g. ABC123)',
        type: 3,
        required: true
      }
    ]
  },
  {
    name: 'disconnect',
    description: 'Unbind this Discord channel from the current Listen Together session'
  },
  {
    name: 'play',
    description: 'Play or queue a track in the connected Listen Together room',
    options: [
      {
        name: 'query',
        description: 'Song title or artist to play',
        type: 3,
        required: true
      },
      {
        name: 'action',
        description: 'How to queue the song',
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
    name: 'skip',
    description: 'Skip to the next song in the connected room'
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
    name: 'nowplaying',
    description: 'Show currently playing song and progress in the connected room'
  },
  {
    name: 'invite',
    description: 'Show room code and 1-click invite link for friends'
  },
  {
    name: 'volume',
    description: 'Adjust playback volume (0 - 100)',
    options: [
      {
        name: 'percent',
        description: 'Volume percentage',
        type: 4,
        required: true,
        min_value: 0,
        max_value: 100
      }
    ]
  },
  {
    name: 'download',
    description: 'Get the official download link for Felo Music Player'
  },
  {
    name: 'help',
    description: 'Show universal Felo bot commands guide'
  }
]

async function registerCommands(appId) {
  try {
    const res = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(SLASH_COMMANDS)
    })
    if (res.ok) {
      console.log(`✅ Registered ${SLASH_COMMANDS.length} global slash commands with Discord!`)
    } else {
      console.warn(`Failed to register slash commands: ${res.status}`, await res.text())
    }
  } catch (err) {
    console.error('Error registering slash commands:', err)
  }
}

async function respond(interactionId, interactionToken, payload) {
  try {
    await fetch(`${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    console.warn('Failed to reply to interaction:', err)
  }
}

// ─── COMMAND HANDLERS ─────────────────────────────────────────────────

async function handleCommand(interaction) {
  const name = interaction.data?.name?.toLowerCase()
  const options = interaction.data?.options || []
  const channelId = interaction.channel_id
  const guildId = interaction.guild_id
  const username = interaction.member?.user?.username || interaction.user?.username || 'User'

  if (name === 'connect') {
    const code = (options.find((o) => o.name === 'code')?.value || '').trim().toUpperCase()
    if (!code) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: '❌ Please specify a 6-character room code.' }
      })
    }

    // Verify room code in Supabase
    const { data: room, error } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !room) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '❌ Room Not Found or Inactive',
              description: `Could not find an active Listen Together session with code **\`${code}\`**.\nMake sure the host is playing music in Felo!`,
              color: 0xef4444
            }
          ]
        }
      })
    }

    await setRoomForChannel(channelId, guildId, code, username)

    const song = room.song
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: `🎧 Connected to ${room.name || 'Listen Together'}!`,
            description:
              `This Discord channel is now linked to Room **\`${code}\`**.\n\n` +
              (song ? `🎶 **Now Playing:** **${song.title}** by **${song.artist}**\n\n` : '') +
              `👉 **Everyone in this channel can now control playback using:**\n` +
              `• \`/play <song>\` — Search and queue music\n` +
              `• \`/skip\` — Skip to next song\n` +
              `• \`/pause\` & \`/resume\` — Pause or resume\n` +
              `• \`/nowplaying\` — Check current track & progress\n` +
              `• \`/invite\` — Invite more friends with link & QR code`,
            color: 0x10b981,
            footer: {
              text: `Connected by @${username} • Lossless Synchronized Audio`
            }
          }
        ]
      }
    })
  }

  if (name === 'disconnect') {
    const currentCode = await getRoomForChannel(channelId)
    if (!currentCode) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: 'ℹ️ This channel is not connected to any room.' }
      })
    }

    await clearRoomForChannel(channelId)
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '👋 Disconnected',
            description: `Unlinked this channel from Room **\`${currentCode}\`**.`,
            color: 0x6b7280
          }
        ]
      }
    })
  }

  if (name === 'download') {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⚡ Download Felo Music Player',
            description:
              `Download **Felo** to enjoy crystal-clear lossless music streaming, local library playback, and real-time Listen Together rooms with friends!\n\n` +
              `🔗 **Direct Download Link:** https://bit.ly/47iv3PK\n\n` +
              `✨ **Key Features:**\n` +
              `• 🎧 **Lossless & Hi-Res Audio** (FLAC, ALAC, MP3 320kbps)\n` +
              `• 🌐 **Listen Together** (Real-time group listening sync)\n` +
              `• 🤖 **Discord Bot Integration** (Control player from any channel)\n` +
              `• 📥 **Offline Downloads & Fast Library Tagging**`,
            color: 0x10b981,
            footer: {
              text: 'Felo Desktop Music • Available for Windows, macOS & Linux'
            }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Download Felo App',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              }
            ]
          }
        ]
      }
    })
  }

  // All other commands require an active room binding
  const roomCode = await getRoomForChannel(channelId)
  if (!roomCode) {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        embeds: [
          {
            title: '⚠️ Choose Web Player or Desktop App to Connect',
            description:
              `To play or control music in this channel, link it to an active **Felo Listen Together** session.\n\n` +
              `You can choose either option:\n\n` +
              `🌐 **Option 1: Web Player (No Download Needed)**\n` +
              `1. Click **Open Web Player** below.\n` +
              `2. Go to **Listen Together** in the sidebar to get your **6-character Room Code** (e.g. \`AB12CD\`).\n` +
              `3. Type **\`/connect code:AB12CD\`** in this channel.\n\n` +
              `💻 **Option 2: Desktop App (PC / Mac / Linux)**\n` +
              `1. Click **Download Desktop App** below.\n` +
              `2. Open Felo on your computer to get your **6-character Room Code**.\n` +
              `3. Type **\`/connect code:AB12CD\`** in this channel.\n\n` +
              `*Once connected, everyone in this server can use \`/play\` to search & queue any song!*`,
            color: 0xf59e0b
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Open Web Player (No Install)',
                emoji: { name: '🌐' },
                url: 'https://felo.feloapp.workers.dev/#/listen-together'
              },
              {
                type: 2,
                style: 5,
                label: 'Download Desktop App',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'play') {
    const query = options.find((o) => o.name === 'query')?.value || ''
    const action = options.find((o) => o.name === 'action')?.value || 'play_now'

    // Insert command into Supabase listening_room_commands
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'play',
      payload: { query, action },
      sender_name: username,
      source: 'discord_universal'
    })

    const actionText =
      action === 'enqueue'
        ? 'Added to Queue'
        : action === 'play_next'
          ? 'Queued to Play Next'
          : 'Now Playing'

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: `🎶 ${actionText}`,
            description: `**Query:** "${query}"\n**Target Room:** \`${roomCode}\`\n\n*Dispatched to the host player and syncing with friends!*`,
            color: 0x10b981,
            footer: { text: `Requested by @${username}` }
          }
        ]
      }
    })
  }

  if (name === 'skip') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'skip',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏭️ Skipped Track',
            description: `Sent skip command to Room **\`${roomCode}\`**.`,
            color: 0x10b981,
            footer: { text: `Requested by @${username}` }
          }
        ]
      }
    })
  }

  if (name === 'pause') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'pause',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏸️ Playback Paused',
            description: `Paused session for Room **\`${roomCode}\`**.`,
            color: 0xf59e0b
          }
        ]
      }
    })
  }

  if (name === 'resume') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'resume',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '▶️ Playback Resumed',
            description: `Resumed playback for Room **\`${roomCode}\`**.`,
            color: 0x10b981
          }
        ]
      }
    })
  }

  if (name === 'nowplaying') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    const song = room?.song
    if (!song) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔇 Nothing is Playing',
              description: `Room **\`${roomCode}\`** is currently idle.\nUse \`/play <song>\` to start playing!`,
              color: 0x6b7280
            }
          ]
        }
      })
    }

    const pos = room.position_seconds || 0
    const dur = song.duration || 0
    const progress = dur > 0 ? Math.min(100, Math.floor((pos / dur) * 100)) : 0

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: room.is_playing ? '🔊 Now Playing' : '⏸️ Currently Paused',
            description:
              `**${song.title}**\nby **${song.artist}**\n` +
              (song.album ? `*Album:* ${song.album}\n\n` : '\n') +
              `\`${Math.floor(pos / 60)}:${(pos % 60).toString().padStart(2, '0')} / ${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}\` (${progress}%)\n\n` +
              `🔑 **Room Code:** \`${roomCode}\``,
            color: room.is_playing ? 0x10b981 : 0xf59e0b
          }
        ]
      }
    })
  }

  if (name === 'invite') {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎧 Live Listen Together Invitation',
            description:
              `Join our live audio session in your browser or desktop app!\n\n` +
              `🔑 **Room Code:**\n\`\`\`${roomCode}\`\`\`\n` +
              `**How to Join:**\n` +
              `1. Open **Felo**\n` +
              `2. Click **Listen Together**\n` +
              `3. Enter code \`${roomCode}\` to listen along!`,
            color: 0x10b981
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Download Felo',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              },
              {
                type: 2,
                style: 5,
                label: 'Open Felo',
                emoji: { name: '🎧' },
                url: 'https://github.com/FanX0/felo'
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'volume') {
    const percent = options.find((o) => o.name === 'percent')?.value
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'volume',
      payload: { percent },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🔊 Volume Adjusted',
            description: `Set volume to **${percent}%** in Room **\`${roomCode}\`**.`,
            color: 0x10b981
          }
        ]
      }
    })
  }

  if (name === 'help') {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎵 Welcome to Felo — Music & Listen Together',
            description:
              `**What is Felo?**\n` +
              `Felo is a modern music player with synchronized **Listen Together** rooms. This Discord bot connects this server to your music session so anyone can request songs, vote to skip, and listen together in real-time!\n\n` +
              `---\n\n` +
              `### 👉 Choose How You Want to Use Felo:\n\n` +
              `#### 🌐 Option 1: Web Player (Instant • Zero Install)\n` +
              `1. Click **\`[🌐 Open Web Player]\`** below to open Felo in your web browser.\n` +
              `2. Click **Listen Together** in the sidebar to get your **6-letter Room Code** (e.g. \`AB12CD\`).\n` +
              `3. In this Discord channel, type: **\`/connect code:AB12CD\`**.\n` +
              `*(Great for listeners, Chromebooks, Mac, mobile, or anyone without installing software!)*\n\n` +
              `#### 💻 Option 2: Desktop App (PC / Mac / Linux)\n` +
              `1. Click **\`[📥 Download Desktop App]\`** below.\n` +
              `2. Open Felo, play music, and click **Listen Together** to see your **6-letter Room Code**.\n` +
              `3. In this Discord channel, type: **\`/connect code:AB12CD\`**.\n` +
              `*(Best for lossless local audio, offline library management, and streaming PC sound to Discord Voice!)*\n\n` +
              `---\n\n` +
              `### 🎧 How Do Server Members Listen?\n` +
              `• **In Web Browser:** Server members can click **Open Web Player** below or use \`/invite\` to listen in synchronized lossless audio directly in their browser.\n` +
              `• **In Discord Voice:** The desktop host can join a Discord Voice Channel and use Felo's **"Share Device Sound"** to broadcast 320kbps stereo audio to the call.\n\n` +
              `---\n\n` +
              `### ⚡ Essential Commands\n` +
              `• \`/connect <code>\` — Link channel to your active Felo room\n` +
              `• \`/play <query>\` — Search & queue any song (auto-downloads if missing!)\n` +
              `• \`/skip\` — Skip to next track\n` +
              `• \`/pause\` & \`/resume\` — Toggle playback\n` +
              `• \`/nowplaying\` — Show currently playing song & live progress\n` +
              `• \`/volume <0-100>\` — Adjust room volume\n` +
              `• \`/invite\` — Get 1-click web join link for friends\n` +
              `• \`/disconnect\` — Unlink this channel`,
            color: 0x10b981,
            footer: {
              text: roomCode
                ? `Connected to Room: ${roomCode} • Ready to play!`
                : 'Channel status: Not connected yet • Choose Web Player or App above to start!'
            }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: '1. Open Web Player (Instant)',
                emoji: { name: '🌐' },
                url: 'https://felo.feloapp.workers.dev/#/listen-together'
              },
              {
                type: 2,
                style: 5,
                label: '2. Download Desktop App',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              },
              {
                type: 2,
                style: 5,
                label: 'How It Works Guide',
                emoji: { name: '📖' },
                url: 'https://github.com/FanX0/felo'
              }
            ]
          }
        ]
      }
    })
  }
}

// ─── GATEWAY LIFECYCLE ────────────────────────────────────────────────

function connect() {
  console.log('Connecting to Discord Gateway...')
  ws = new WebSocket(DISCORD_GATEWAY)

  ws.onopen = () => {}

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data))
      const { op, d, s, t } = payload
      if (s !== null) sequenceNumber = s

      switch (op) {
        case 10: {
          const interval = d.heartbeat_interval || 41250
          startHeartbeat(interval)
          identify()
          break
        }
        case 11:
          lastHeartbeatAck = true
          break
        case 1:
          sendHeartbeat()
          break
        case 7:
        case 9:
          ws.close()
          setTimeout(connect, 3000)
          break
        case 0:
          if (t === 'READY') {
            botUser = d.user
            console.log(`🤖 Universal Felo Bot logged in as ${botUser.username}#${botUser.discriminator || '0'} (${botUser.id})`)
            void registerCommands(botUser.id)
          } else if (t === 'INTERACTION_CREATE') {
            if (d.type === 2) {
              void handleCommand(d)
            }
          }
          break
      }
    } catch (err) {
      console.warn('Gateway message error:', err)
    }
  }

  ws.onerror = (err) => {
    console.error('WebSocket error:', err)
  }

  ws.onclose = () => {
    stopHeartbeat()
    console.log('Gateway closed. Reconnecting in 5s...')
    setTimeout(connect, 5000)
  }
}

function startHeartbeat(interval) {
  stopHeartbeat()
  lastHeartbeatAck = true
  heartbeatTimer = setInterval(() => {
    if (!lastHeartbeatAck) {
      console.warn('Heartbeat unacknowledged, reconnecting...')
      ws.close()
      return
    }
    sendHeartbeat()
  }, interval)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function sendHeartbeat() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  lastHeartbeatAck = false
  ws.send(JSON.stringify({ op: 1, d: sequenceNumber }))
}

function identify() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(
    JSON.stringify({
      op: 2,
      d: {
        token,
        intents: 1, // Guilds only (No privileged MessageContent needed!)
        properties: {
          os: process.platform,
          browser: 'felo-universal-bot',
          device: 'felo-universal-bot'
        }
      }
    })
  )
}

connect()
