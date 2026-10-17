// Universal Discord Bot for Felo Music & Listen Together
// Connects any Discord server/channel to an active Felo Listen Together session via Room Code.
// Runs standalone on any Node.js host (Vercel, Railway, Fly.io, Render, or VPS).

import dotenv from 'dotenv'
dotenv.config()
dotenv.config({ path: '.env.local', override: true })

import http from 'http'
import { createClient } from '@supabase/supabase-js'
import { SLASH_COMMANDS } from './register-discord-commands.mjs'

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'

const clean = (val) => (val ? String(val).replace(/^["']|["']$/g, '').trim() : '')

const token = clean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN)
const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
const supabaseKey = clean(
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const botActivity = clean(process.env.DISCORD_BOT_ACTIVITY) || 'Listen Together | Use /help'
const botActivityType = Number(process.env.DISCORD_BOT_ACTIVITY_TYPE ?? 4)

if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is required.')
  process.exit(1)
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_KEY environment variables are required.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Lightweight HTTP Health Check Server (enables hosting on Render Web Service, Koyeb, Railway, etc.)
const PORT = process.env.PORT || process.env.HEALTH_PORT
if (PORT) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'online',
        bot: typeof botUser !== 'undefined' && botUser ? botUser.username : 'connecting',
        activity: botActivity,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
      })
    )
  })
  server.listen(Number(PORT), () => {
    console.log(`🌐 Health check HTTP server listening on port ${PORT}`)
  })
}

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

async function getBindingForChannel(channelId) {
  try {
    const { data } = await supabase
      .from('discord_channel_bindings')
      .select('room_code, bound_by, guild_id')
      .eq('channel_id', channelId)
      .maybeSingle()
    return data || null
  } catch (err) {
    console.warn('Error reading channel binding details:', err)
    return null
  }
}

function isDiscordAdminOrManager(interaction) {
  if (!interaction.guild_id) return true
  const permsStr = interaction.member?.permissions
  if (!permsStr) return false
  try {
    const perms = BigInt(permsStr)
    const ADMINISTRATOR = 1n << 3n
    const MANAGE_CHANNELS = 1n << 4n
    const MANAGE_GUILD = 1n << 5n
    return (perms & ADMINISTRATOR) !== 0n || (perms & MANAGE_CHANNELS) !== 0n || (perms & MANAGE_GUILD) !== 0n
  } catch {
    return false
  }
}

// ─── GATEWAY CLIENT ───────────────────────────────────────────────────

let ws = null
let heartbeatTimer = null
let lastHeartbeatAck = true
let sequenceNumber = null
let botUser = null
let hasRegisteredCommands = false

async function searchMusicCatalog(query) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5&country=US`
    const res = await fetch(url, { headers: { 'User-Agent': 'FeloUniversalBot/1.0' } })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data.results)) return []
    return data.results
      .map((r) => ({
        title: r.trackName || '',
        artist: r.artistName || '',
        album: r.collectionName || '',
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
        artworkUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : ''
      }))
      .filter((t) => Boolean(t.title))
  } catch {
    return []
  }
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const mins = Math.floor(s / 60)
  const secs = (s % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

function buildQueuePayload(room, roomCode, page = 1) {
  const song = room?.song
  const fullQueue = Array.isArray(room?.queue) ? room.queue : []
  const isFirstCurrent =
    fullQueue.length > 0 &&
    song &&
    fullQueue[0].title === song.title &&
    fullQueue[0].artist === song.artist

  const upcomingQueue = isFirstCurrent ? fullQueue.slice(1) : fullQueue

  const priorityTracks = upcomingQueue.filter((t) => Boolean(t.isPriority))
  const backgroundTracks = upcomingQueue.filter((t) => !t.isPriority)

  const pos = room?.position_seconds || 0
  const dur = song?.duration || 0
  const progressPercent = dur > 0 ? Math.min(100, Math.max(0, Math.floor((pos / dur) * 100))) : 0
  const totalBars = 12
  const activeBars = Math.max(0, Math.min(totalBars, Math.round((progressPercent / 100) * totalBars)))
  const progressBar =
    '▬'.repeat(Math.max(0, activeBars - 1)) +
    '🔘' +
    '▬'.repeat(Math.max(0, totalBars - activeBars))

  const posStr = formatTime(pos)
  const durStr = dur > 0 ? formatTime(dur) : '0:00'

  let queueDescription = ''

  // Tier 1: Currently Playing Box
  queueDescription += `### 🎧 Currently Playing\n`
  if (song) {
    const isCurrentPriority = Boolean(song.isPriority)
    const originTag = isCurrentPriority
      ? `🌟 Requested by @${song.requestedBy || 'Discord User'}`
      : '📁 Host Library'
    queueDescription +=
      `\`\`\`yaml\n` +
      `Track #1: ${song.title} (Playing Now)\n` +
      `Artist: ${song.artist || 'Unknown'}\n` +
      `Progress: ${posStr} / ${durStr} (${progressPercent}%) [${originTag}]\n` +
      `\`\`\`\n`
  } else {
    queueDescription += `\`\`\`text\nNothing is playing right now\n\`\`\`\n`
  }

  queueDescription += `⬇️\n\n`

  // Tier 2: 🌟 Priority / Important Requests (Discord) Box
  queueDescription += `### 🌟 Priority / Important Requests (Discord)\n`
  if (priorityTracks.length > 0) {
    const priorityLines = priorityTracks.slice(0, 5).map((t, idx) => {
      const globalIdx = 2 + idx
      const tDur = t.duration ? ` [${formatTime(t.duration)}]` : ''
      const reqBy = t.requestedBy ? ` (Requested by @${t.requestedBy})` : ' (Discord Request)'
      return `Track #${globalIdx}: 🌟 ${t.title}${reqBy}${tDur}`
    })
    queueDescription += `\`\`\`yaml\n` + priorityLines.join('\n')
    if (priorityTracks.length > 5) {
      queueDescription += `\n... (+${priorityTracks.length - 5} more priority requests)`
    }
    queueDescription += `\n\`\`\`\n`
  } else {
    queueDescription += `\`\`\`text\n(No active priority requests from Discord)\n\`\`\`\n`
  }

  queueDescription += `⬇️\n\n`

  // Tier 3: 📜 Background Local Playlist Box with Pagination
  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(backgroundTracks.length / pageSize))
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages)
  const startIdx = (currentPage - 1) * pageSize
  const pageBgTracks = backgroundTracks.slice(startIdx, startIdx + pageSize)

  const pageHeader = totalPages > 1 ? ` (Page ${currentPage} of ${totalPages} • Total ${backgroundTracks.length} Tracks)` : ''
  queueDescription += `### 📜 Background Local Playlist${pageHeader}\n`
  if (backgroundTracks.length > 0) {
    const bgLines = pageBgTracks.map((t, idx) => {
      const localIdx = startIdx + idx + 1
      const globalIdx = 2 + priorityTracks.length + startIdx + idx
      const tDur = t.duration ? ` [${formatTime(t.duration)}]` : ''
      return `Track #${globalIdx}: ${t.title} (Local #${localIdx})${tDur}`
    })
    queueDescription += `\`\`\`yaml\n` + bgLines.join('\n')
    if (totalPages > 1) {
      queueDescription += `\n... (Showing Local #${startIdx + 1}–#${startIdx + pageBgTracks.length} of ${backgroundTracks.length} • Use ◀️ / ▶️ or /queue page: <num> to view all)`
    }
    queueDescription += `\n\`\`\`\n`
  } else {
    queueDescription += `\`\`\`text\n(No background local playlist tracks queued)\n\`\`\`\n`
  }

  queueDescription += `\n💡 *Tip: Discord \`/play <song>\` automatically queues as Priority! Click \`Skip Track\` to advance.*`

  const queueActionButtons = [
    {
      type: 2,
      style: 2,
      custom_id: 'queue_skip',
      label: 'Skip Track',
      emoji: { name: '⏭️' }
    }
  ]

  if (upcomingQueue.length > 0) {
    queueActionButtons.push({
      type: 2,
      style: 1,
      custom_id: 'queue_play_now',
      label: 'Play Next Now',
      emoji: { name: '⚡' }
    })
  }

  queueActionButtons.push({
    type: 2,
    style: 5,
    label: 'Open Web Player',
    emoji: { name: '🌐' },
    url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
  })

  const components = [
    {
      type: 1,
      components: queueActionButtons
    }
  ]

  if (totalPages > 1) {
    components.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          custom_id: `queue_page_${currentPage - 1}`,
          label: 'Prev',
          emoji: { name: '◀️' },
          disabled: currentPage <= 1
        },
        {
          type: 2,
          style: 2,
          custom_id: 'queue_page_curr',
          label: `Page ${currentPage} / ${totalPages}`,
          disabled: true
        },
        {
          type: 2,
          style: 2,
          custom_id: `queue_page_${currentPage + 1}`,
          label: 'Next',
          emoji: { name: '▶️' },
          disabled: currentPage >= totalPages
        }
      ]
    })
  }

  const footerText = totalPages > 1
    ? `Page ${currentPage} of ${totalPages} • ${priorityTracks.length} priority • ${backgroundTracks.length} host track(s) • Room: ${roomCode}`
    : `${priorityTracks.length} priority request(s) • ${backgroundTracks.length} background track(s) • Room: ${roomCode}`

  return {
    embeds: [
      {
        title: `🎧 Live Session Queue • Room \`${roomCode}\``,
        description: queueDescription,
        color: priorityTracks.length > 0 ? 0xf59e0b : 0x10b981,
        footer: {
          text: footerText
        }
      }
    ],
    components
  }
}

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

async function updateApplicationBio() {
  try {
    const res = await fetch(`${DISCORD_API}/applications/@me`, {
      method: 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      }
    })
    if (!res.ok) return
    const app = await res.json()
    const currentDesc = app.description || ''
    const newDesc =
      'Official Felo Music Bot • Synchronized Listen Together!\n' +
      'https://felo.feloapp.workers.dev\n' +
      '• Link channel: /connect <code>\n' +
      '• Queue songs: /play <query>\n' +
      '• Visual queue: /queue & /nowplaying\n' +
      '• Friends join: /invite (1-click Web Player)\n' +
      'Lossless synchronized audio with zero setup needed. Type /help in your server to get started!'

    const botPerms = '2150949344'
    const patchBody = {}

    if (currentDesc !== newDesc) {
      patchBody.description = newDesc
    }

    const currentScopes = app.install_params?.scopes || []
    if (!currentScopes.includes('bot') || !currentScopes.includes('applications.commands')) {
      patchBody.install_params = {
        scopes: ['bot', 'applications.commands'],
        permissions: botPerms
      }
      patchBody.integration_types_config = {
        '0': {
          oauth2_install_params: {
            scopes: ['bot', 'applications.commands'],
            permissions: botPerms
          }
        },
        '1': {
          oauth2_install_params: {
            scopes: ['applications.commands']
          }
        }
      }
    }

    if (Object.keys(patchBody).length > 0) {
      await fetch(`${DISCORD_API}/applications/@me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(patchBody)
      })
      console.log('✅ Updated Discord bot application bio and installation scopes (bot + applications.commands)!')
    }
  } catch (err) {
    // Non-fatal, ignore
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

// ─── COMPONENT HANDLERS (BUTTONS & MENUS) ──────────────────────────────

async function handleComponent(interaction) {
  const customId = interaction.data?.custom_id || ''
  const channelId = interaction.channel_id
  const username = interaction.member?.user?.username || interaction.user?.username || 'Discord User'

  // Download button interaction handle
  if (customId === 'cmd_download' || customId === 'download_app' || customId === 'queue_download') {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        embeds: [
          {
            title: '⚡ Download & Web Access — Felo Music Player',
            description:
              `Enjoy crystal-clear lossless music streaming, local library playback, and real-time Listen Together rooms with friends!\n\n` +
              `📲 **Download Page (Android, iOS & PC):**\nhttps://felo.feloapp.workers.dev/#/download\n\n` +
              `💻 **Desktop App Setup (.exe):**\nhttps://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe\n\n` +
              `🤖 **Android APK Direct:**\nhttps://github.com/FanX0/felo/releases/latest/download/Felo.apk\n\n` +
              `🌐 **Instant Web Player (Zero Install):**\nhttps://felo.feloapp.workers.dev\n\n` +
              `✨ **Key Features:**\n` +
              `• 🎧 **Lossless & Hi-Res Audio** (Bit-perfect FLAC / 320kbps MP3)\n` +
              `• 🌐 **Listen Together** (Real-time WebRTC sync across friends)\n` +
              `• 🤖 **Discord Bot Integration** (Control player from any channel)\n` +
              `• 📥 **Offline Downloads & Fast Library Tagging**`,
            color: 0x10b981,
            footer: {
              text: 'Felo Music • Available on Web, Android, iOS & Desktop (Windows, macOS, Linux)'
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
                label: 'Download Apps (Android/iOS/PC)',
                emoji: { name: '📲' },
                url: 'https://felo.feloapp.workers.dev/#/download'
              },
              {
                type: 2,
                style: 5,
                label: 'Download PC Setup (.exe)',
                emoji: { name: '💻' },
                url: 'https://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe'
              },
              {
                type: 2,
                style: 5,
                label: 'Download Android APK',
                emoji: { name: '🤖' },
                url: 'https://github.com/FanX0/felo/releases/latest/download/Felo.apk'
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: 'https://felo.feloapp.workers.dev'
              }
            ]
          }
        ]
      }
    })
  }

  const roomCode = await getRoomForChannel(channelId)
  if (!roomCode) {
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: { flags: 64, content: '❌ This channel is not connected to any room. Use `/connect <code>` first.' }
    })
  }

  if (customId === 'disc_cancel') {
    return respond(interaction.id, interaction.token, {
      type: 7,
      data: {
        embeds: [
          {
            title: '✅ Disconnect Cancelled',
            description: `The Listen Together session **\`${roomCode}\`** remains connected to this channel.`,
            color: 0x10b981
          }
        ],
        components: []
      }
    })
  }

  if (customId.startsWith('disc_unlink_')) {
    const targetCode = customId.replace('disc_unlink_', '')
    const binding = await getBindingForChannel(channelId)
    const callerUser = interaction.member?.user || interaction.user
    const callerUsername = callerUser?.username || 'User'
    const callerId = callerUser?.id || ''
    const boundBy = (binding?.bound_by || '').toLowerCase()
    const isInitiator =
      !binding ||
      (callerUsername && callerUsername.toLowerCase() === boundBy) ||
      (callerId && callerId === binding.bound_by)

    if (!isInitiator && !isDiscordAdminOrManager(interaction)) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          content: '❌ Only the session creator or an admin can confirm unlinking.'
        }
      })
    }

    await clearRoomForChannel(channelId)
    return respond(interaction.id, interaction.token, {
      type: 7,
      data: {
        embeds: [
          {
            title: '👋 Channel Unlinked',
            description:
              `This Discord channel has been unlinked from Room **\`${targetCode}\`**.\n\n` +
              `🎶 *Playback is uninterrupted! Host and friends continue listening in the Felo desktop app and web player.*`,
            color: 0x6b7280,
            footer: { text: `Unlinked by @${callerUsername} • Room: ${targetCode}` }
          }
        ],
        components: []
      }
    })
  }

  if (customId.startsWith('disc_end_')) {
    const targetCode = customId.replace('disc_end_', '')
    const binding = await getBindingForChannel(channelId)
    const callerUser = interaction.member?.user || interaction.user
    const callerUsername = callerUser?.username || 'User'
    const callerId = callerUser?.id || ''
    const boundBy = (binding?.bound_by || '').toLowerCase()
    const isInitiator =
      !binding ||
      (callerUsername && callerUsername.toLowerCase() === boundBy) ||
      (callerId && callerId === binding.bound_by)

    if (!isInitiator && !isDiscordAdminOrManager(interaction)) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          content: '❌ Only the session creator or an admin can end the session.'
        }
      })
    }

    await supabase.from('listening_room_commands').insert({
      room_code: targetCode,
      command: 'stop',
      payload: {},
      sender_name: callerUsername,
      source: 'discord_universal',
      status: 'pending'
    })
    await supabase.from('listening_rooms').update({ is_active: false, is_playing: false }).eq('code', targetCode)
    await clearRoomForChannel(channelId)

    return respond(interaction.id, interaction.token, {
      type: 7,
      data: {
        embeds: [
          {
            title: '🛑 Session Ended & Disconnected',
            description:
              `The Listen Together session **\`${targetCode}\`** was closed by @${callerUsername}.\n\n` +
              `• Room closed and playback stopped for all listeners.\n` +
              `• Discord channel unlinked.`,
            color: 0xef4444,
            footer: { text: `Ended by @${callerUsername} • Lossless Synchronized Audio` }
          }
        ],
        components: []
      }
    })
  }

  if (customId === 'player_prev') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'previous',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: `⏮️ Playing previous track in Room **\`${roomCode}\`**.`
      }
    })
  }

  if (customId === 'player_pause_toggle') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('is_playing')
      .eq('code', roomCode)
      .maybeSingle()

    const currentlyPlaying = Boolean(room?.is_playing)
    const targetCommand = currentlyPlaying ? 'pause' : 'resume'

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: targetCommand,
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: currentlyPlaying
          ? `⏸️ Playback paused in Room **\`${roomCode}\`**.`
          : `▶️ Playback resumed in Room **\`${roomCode}\`**.`
      }
    })
  }

  if (customId === 'player_stop') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'stop',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: `⏹️ Playback stopped in Room **\`${roomCode}\`**.`
      }
    })
  }

  if (customId === 'queue_skip' || customId === 'player_skip') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    const currentTrackTitle = room?.song?.title || 'Current Track'
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const isFirstCurrent =
      fullQueue.length > 0 &&
      room?.song &&
      fullQueue[0].title === room.song.title &&
      fullQueue[0].artist === room.song.artist
    const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
    const nextTrack = upcoming[0]

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'skip',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    let nextInfo = ''
    if (nextTrack) {
      const nextDur = nextTrack.duration
        ? ` \`[${formatTime(nextTrack.duration)}]\``
        : ''
      if (nextTrack.isPriority) {
        nextInfo = `\n\n▶️ **Now Playing Next:** 🌟 **${nextTrack.title}** by **${nextTrack.artist || 'Unknown'}**${nextDur}\n*(🌟 Priority Request by @${nextTrack.requestedBy || 'Discord User'})*`
      } else {
        nextInfo = `\n\n▶️ **Now Playing Next:** **${nextTrack.title}** by **${nextTrack.artist || 'Unknown'}**${nextDur}\n*(📁 Background Local Playlist)*`
      }
    } else {
      nextInfo = `\n\n🔇 *Reached the end of the session queue.*`
    }

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏭️ Track Skipped',
            description: `Skipped **${currentTrackTitle}** in Room **\`${roomCode}\`**.${nextInfo}`,
            color: 0x10b981,
            footer: { text: `Triggered by @${username} • Felo Live Session` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'queue_skip',
                label: 'Skip Track',
                emoji: { name: '⏭️' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'queue_help_view',
                label: 'View Queue',
                emoji: { name: '📜' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          }
        ]
      }
    })
  }

  if (customId === 'queue_play_now') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const isFirstCurrent =
      fullQueue.length > 0 &&
      room?.song &&
      fullQueue[0].title === room.song.title &&
      fullQueue[0].artist === room.song.artist
    const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
    const song = upcoming[0]

    if (!song) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: 'ℹ️ No upcoming tracks to play.' }
      })
    }

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'jump',
      payload: { index: isFirstCurrent ? 1 : 0, title: song.title },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⚡ Playing Next Track Now',
            description:
              `**Track:** **${song.title}** by **${song.artist || 'Unknown'}**\n` +
              `**Room:** \`${roomCode}\`\n\n` +
              `⚡ *Playback started immediately!*`,
            color: 0x10b981,
            footer: { text: `Triggered by @${username} • Instant Play` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'queue_help_view',
                label: 'View Current Queue',
                emoji: { name: '📜' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          }
        ]
      }
    })
  }

  if (customId === 'queue_help_view') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    if (!room) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: '❌ Room is not active.' }
      })
    }
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: buildQueuePayload(room, roomCode)
    })
  }

  if (customId.startsWith('queue_page_')) {
    const pageNum = parseInt(customId.replace('queue_page_', ''), 10) || 1
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    if (!room) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: '❌ Room is not active.' }
      })
    }
    return respond(interaction.id, interaction.token, {
      type: 7,
      data: buildQueuePayload(room, roomCode, pageNum)
    })
  }

  if (customId.startsWith('queue_rel_')) {
    const relQuery = decodeURIComponent(customId.replace('queue_rel_', '')).trim()
    const onlineMatches = await searchMusicCatalog(relQuery)
    const targetTrack = onlineMatches[0] || {
      title: relQuery,
      artist: 'Selected Track',
      album: '',
      duration: 0,
      artworkUrl: ''
    }

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'play',
      payload: {
        query: relQuery,
        action: 'play_now',
        title: targetTrack.title,
        artist: targetTrack.artist,
        album: targetTrack.album || '',
        duration: targetTrack.duration || 0,
        artworkUrl: targetTrack.artworkUrl || ''
      },
      sender_name: username,
      source: 'discord_universal'
    })

    const trackDur = targetTrack.duration
      ? ` \`[${formatTime(targetTrack.duration)}]\``
      : ''

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎶 Playing Selected Track',
            description:
              `**Track:** **${targetTrack.title}** by **${targetTrack.artist}**${trackDur}\n` +
              (targetTrack.album ? `**Album:** *${targetTrack.album}*\n` : '') +
              `**Room:** \`${roomCode}\`\n\n` +
              `⚡ *Playback started automatically!*`,
            color: 0x10b981,
            thumbnail: targetTrack.artworkUrl ? { url: targetTrack.artworkUrl } : undefined,
            footer: { text: `Requested by @${username} • Felo Music` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'queue_skip',
                label: 'Skip Track',
                emoji: { name: '⏭️' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'queue_help_view',
                label: 'View Queue',
                emoji: { name: '📜' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          }
        ]
      }
    })
  }

  return respond(interaction.id, interaction.token, { type: 6 })
}

// ─── AUTOCOMPLETE HANDLER ─────────────────────────────────────────────

async function handleAutocomplete(interaction) {
  try {
    const options = interaction.data?.options || []
    const focused = options.find((o) => o.focused)
    const query = (focused?.value || '').trim()
    const channelId = interaction.channel_id
    const roomCode = await getRoomForChannel(channelId)

    let choices = []

    if (query.length >= 2) {
      const matches = await searchMusicCatalog(query)
      choices = matches.slice(0, 5).map((m) => {
        const durStr = m.duration ? ` [${formatTime(m.duration)}]` : ''
        const label = `${m.title} - ${m.artist || 'Unknown'}${durStr}`.slice(0, 100)
        const val = `${m.title} ${m.artist || ''}`.slice(0, 100).trim()
        return { name: label, value: val }
      })
    } else if (roomCode) {
      const { data: room } = await supabase
        .from('listening_rooms')
        .select('queue, song')
        .eq('code', roomCode)
        .maybeSingle()

      const fullQueue = Array.isArray(room?.queue) ? room.queue : []
      if (room?.song) {
        const durStr = room.song.duration ? ` [${formatTime(room.song.duration)}]` : ''
        choices.push({
          name: `▶️ Now: ${room.song.title} - ${room.song.artist || 'Unknown'}${durStr}`.slice(0, 100),
          value: `${room.song.title} ${room.song.artist || ''}`.slice(0, 100).trim()
        })
      }
      for (const t of fullQueue.slice(0, 4)) {
        const durStr = t.duration ? ` [${formatTime(t.duration)}]` : ''
        choices.push({
          name: `🎵 ${t.title} - ${t.artist || 'Unknown'}${durStr}`.slice(0, 100),
          value: `${t.title} ${t.artist || ''}`.slice(0, 100).trim()
        })
      }
    }

    await respond(interaction.id, interaction.token, {
      type: 8,
      data: { choices: choices.slice(0, 25) }
    })
  } catch (err) {
    console.warn('Error handling autocomplete:', err)
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
              description:
                `Could not find an active Listen Together session with code **\`${code}\`**.\n\n` +
                `Make sure the host is playing music in Felo or start a room directly in the Web Player:\n` +
                `🌐 **Web Player:** https://felo.feloapp.workers.dev`,
              color: 0xef4444
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: 'Open Web Player',
                  emoji: { name: '🌐' },
                  url: 'https://felo.feloapp.workers.dev/#/listen-together'
                }
              ]
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
              `🌐 **Instant Web Player:** https://felo.feloapp.workers.dev/#/online/listen?code=${code}\n\n` +
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
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${code}`
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'disconnect') {
    const binding = await getBindingForChannel(channelId)
    if (!binding || !binding.room_code) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: 'ℹ️ This channel is not connected to any room.' }
      })
    }

    const callerUser = interaction.member?.user || interaction.user
    const callerUsername = callerUser?.username || 'User'
    const callerId = callerUser?.id || ''
    const boundBy = (binding.bound_by || '').toLowerCase()
    const isInitiator =
      (callerUsername && callerUsername.toLowerCase() === boundBy) ||
      (callerId && callerId === binding.bound_by)
    const hasAdmin = isDiscordAdminOrManager(interaction)

    // If user is a guest (neither the session creator nor an admin)
    if (!isInitiator && !hasAdmin) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64, // Ephemeral to caller only
          embeds: [
            {
              title: '🔒 Permission Required to Disconnect',
              description:
                `Only **@${binding.bound_by || 'the session creator'}** or a **Server Admin** can disconnect this channel from Room **\`${binding.room_code}\`**.\n\n` +
                `🎧 **Want to leave the session as a listener?**\n` +
                `• **Instant Web Player:** Simply close your browser tab.\n` +
                `• **Desktop App:** Open Felo → click **Leave Session** in the Listen Together tab.\n\n` +
                `*This prevents other members from accidentally interrupting music for the whole server.*`,
              color: 0xf59e0b
            }
          ]
        }
      })
    }

    // If authorized (session creator or admin), present confirmation choice
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '👋 Disconnect Listen Together Session?',
            description:
              `This channel is linked to Room **\`${binding.room_code}\`**.\n\n` +
              `Choose how you want to disconnect:\n\n` +
              `1️⃣ **Unlink Channel Only (Keep Music Playing)**\n` +
              `• Removes this Discord channel's music controls.\n` +
              `• **Room stays active!** Host and listeners continue listening in the Felo desktop app and web browser.\n\n` +
              `2️⃣ **End Session For Everyone (Stop Room)**\n` +
              `• Unlinks this Discord channel and **closes the room**.\n` +
              `• Stops audio playback for all connected listeners.`,
            color: 0x3b82f6,
            footer: {
              text: `Requested by @${callerUsername} • Room: ${binding.room_code}`
            }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: `disc_unlink_${binding.room_code}`,
                label: 'Unlink Channel Only',
                emoji: { name: '👋' }
              },
              {
                type: 2,
                style: 4,
                custom_id: `disc_end_${binding.room_code}`,
                label: 'End Session For Everyone',
                emoji: { name: '🛑' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'disc_cancel',
                label: 'Cancel',
                emoji: { name: '✖️' }
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'web' || name === 'webapp' || name === 'online') {
    const activeCode = await getRoomForChannel(channelId)
    const webUrl = activeCode
      ? `https://felo.feloapp.workers.dev/#/online/listen?code=${activeCode}`
      : 'https://felo.feloapp.workers.dev'

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🌐 Felo Web Player — Instant Access',
            description:
              `Access **Felo** directly in your web browser with zero installation needed!\n\n` +
              `🔗 **Web App Link:** https://felo.feloapp.workers.dev\n\n` +
              (activeCode
                ? `🎧 **Active Channel Session:** Room \`${activeCode}\`\nClick **Open Web Player** below to join and sync live with this room!\n\n`
                : `💡 *Tip: Start or join a Listen Together room online to sync audio in real-time with friends!*\n\n`) +
              `✨ **Browser Features:**\n` +
              `• 🎧 Real-time group music listening with friends\n` +
              `• 📱 Fully responsive on mobile, desktop, and Chromebook\n` +
              `• 🚀 Zero setup required — simply open and enjoy`,
            color: 0x10b981,
            footer: {
              text: 'Felo Web Music • felo.feloapp.workers.dev'
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
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: webUrl
              },
              {
                type: 2,
                style: 5,
                label: 'Download Apps (Android/iOS/PC)',
                emoji: { name: '📥' },
                url: 'https://felo.feloapp.workers.dev/#/download'
              }
            ]
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
            title: '⚡ Download & Web Access — Felo Music Player',
            description:
              `Enjoy crystal-clear lossless music streaming, local library playback, and real-time Listen Together rooms with friends!\n\n` +
              `📲 **Download Page (Android, iOS & PC):**\nhttps://felo.feloapp.workers.dev/#/download\n\n` +
              `💻 **Desktop App Setup (.exe):**\nhttps://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe\n\n` +
              `🤖 **Android APK Direct:**\nhttps://github.com/FanX0/felo/releases/latest/download/Felo.apk\n\n` +
              `🌐 **Instant Web Player (Zero Install):**\nhttps://felo.feloapp.workers.dev\n\n` +
              `✨ **Key Features:**\n` +
              `• 🎧 **Lossless & Hi-Res Audio** (Bit-perfect FLAC / 320kbps MP3)\n` +
              `• 🌐 **Listen Together** (Real-time WebRTC sync across friends)\n` +
              `• 🤖 **Discord Bot Integration** (Control player from any channel)\n` +
              `• 📥 **Offline Downloads & Fast Library Tagging**`,
            color: 0x10b981,
            footer: {
              text: 'Felo Music • Available on Web, Android, iOS & Desktop (Windows, macOS, Linux)'
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
                label: 'Download Apps (Android/iOS/PC)',
                emoji: { name: '📲' },
                url: 'https://felo.feloapp.workers.dev/#/download'
              },
              {
                type: 2,
                style: 5,
                label: 'Download PC Setup (.exe)',
                emoji: { name: '💻' },
                url: 'https://github.com/FanX0/felo/releases/latest/download/Felo-Setup.exe'
              },
              {
                type: 2,
                style: 5,
                label: 'Download Android APK',
                emoji: { name: '🤖' },
                url: 'https://github.com/FanX0/felo/releases/latest/download/Felo.apk'
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: 'https://felo.feloapp.workers.dev'
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'invite') {
    const activeCode = await getRoomForChannel(channelId)
    let room = null

    if (activeCode) {
      const { data } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('code', activeCode)
        .eq('is_active', true)
        .maybeSingle()
      room = data
    }

    // Only show invite link if user/channel is already connected to an active room
    if (!activeCode || !room || !room.is_active) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '⚠️ No Active Listen Together Session Connected',
              description:
                'This Discord channel is not connected to an active Listen Together session.\n\n' +
                'To invite friends, a host must first connect this channel to an active room:\n\n' +
                '1️⃣ **Start or Join a Room in Felo:**\n' +
                '• Open the **Felo Desktop App** or **Web Player** and visit **Listen Together**.\n' +
                '• Start a room or join one to get your 6-character room code.\n\n' +
                '2️⃣ **Link This Channel:**\n' +
                '• Type `/connect code:<ROOM_CODE>` in this channel.\n\n' +
                '3️⃣ **Invite Friends:**\n' +
                '• Once connected, type `/invite` here to get your 1-click web player link and share it!',
              color: 0xf59e0b,
              footer: { text: 'Felo Music • Connect a room first to generate invite links' }
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: 'Open Web Player',
                  emoji: { name: '🌐' },
                  url: 'https://felo.feloapp.workers.dev/#/listen-together'
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Download Apps (Android/iOS/PC)',
                  emoji: { name: '📥' },
                  url: 'https://felo.feloapp.workers.dev/#/download'
                }
              ]
            }
          ]
        }
      })
    }

    const song = room.song
    const currentTrack = song ? `🎶 **Now Playing:** **${song.title}** by **${song.artist}**\n\n` : ''
    const memberCount = room.listener_count || (Array.isArray(room.members) ? room.members.length : 1)

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎧 Live Listen Together Invitation',
            description:
              "You're invited to listen along live with synchronized lossless audio!\n\n" +
              currentTrack +
              `🔑 **Room Code:**\n\`\`\`${activeCode}\`\`\`\n` +
              `👥 **Active Members:** \`${memberCount}\` listener(s) connected\n\n` +
              `👉 **Choose How to Join & Listen:**\n\n` +
              `**🌐 Option 1: Instant Web Player (Zero Install)**\n` +
              `• Click **\`[🌐 1-Click Join in Web Browser]\`** below.\n` +
              `• Works immediately on mobile, Mac, Windows, or Chromebook!\n\n` +
              `**💻 Option 2: Felo Desktop App (PC / Mac / Linux)**\n` +
              `• Open Felo → Click **Listen Together** in the sidebar.\n` +
              `• Enter code **\`${activeCode}\`** to sync playback!`,
            color: 0x10b981,
            footer: { text: `Room: ${activeCode} • Lossless Synchronized Audio • Requested by @${username}` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: '1-Click Join in Web Browser',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${activeCode}`
              },
              {
                type: 2,
                style: 5,
                label: 'Download Apps (Android/iOS/PC)',
                emoji: { name: '📥' },
                url: 'https://felo.feloapp.workers.dev/#/download'
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
              `💻 **Option 2: Native App (PC, Android, iOS)**\n` +
              `1. Click **Download App** below to get the PC setup, Android APK, or iOS Web App.\n` +
              `2. Open Felo to get your **6-character Room Code**.\n` +
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
                label: 'Download Apps (Android/iOS/PC)',
                emoji: { name: '📥' },
                url: 'https://felo.feloapp.workers.dev/#/download'
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'play') {
    const query = (options.find((o) => o.name === 'query')?.value || '').trim()
    const explicitAction = options.find((o) => o.name === 'action')?.value

    if (!query) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: { flags: 64, content: '❌ Please provide a song title or artist to play.' }
      })
    }

    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    const action = explicitAction || 'play_now'
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const cleanQ = query.toLowerCase()

    // 1. Search in published room queue (exact or substring match)
    const queueExactMatches = fullQueue.filter(
      (t) =>
        t.title?.toLowerCase().includes(cleanQ) ||
        (t.artist && t.artist.toLowerCase().includes(cleanQ))
    )

    let primaryTrack = null
    let relatedTracks = []

    if (queueExactMatches.length > 0) {
      const best = queueExactMatches[0]
      primaryTrack = {
        title: best.title,
        artist: best.artist || 'Host Library',
        album: best.album || '',
        duration: best.duration || 0,
        artworkUrl: best.artworkUrl || ''
      }
      relatedTracks = queueExactMatches.slice(1, 4).map((t) => ({
        title: t.title,
        artist: t.artist || '',
        album: t.album || '',
        duration: t.duration || 0,
        artworkUrl: t.artworkUrl || ''
      }))
    } else {
      // Query online music catalog (iTunes Search API)
      const onlineMatches = await searchMusicCatalog(query)
      if (onlineMatches.length > 0) {
        primaryTrack = onlineMatches[0]
        relatedTracks = onlineMatches.slice(1, 4)
      } else {
        const words = cleanQ.split(/\s+/).filter((w) => w.length >= 3)
        if (words.length > 0) {
          const partialQueue = fullQueue.filter((t) => {
            const tStr = `${t.title || ''} ${t.artist || ''}`.toLowerCase()
            return words.some((w) => tStr.includes(w))
          })
          if (partialQueue.length > 0) {
            relatedTracks = partialQueue.slice(0, 4).map((t) => ({
              title: t.title,
              artist: t.artist || '',
              album: t.album || '',
              duration: t.duration || 0,
              artworkUrl: t.artworkUrl || ''
            }))
          }
        }
      }
    }

    // Branch 3: No track found AND no related songs
    if (!primaryTrack && relatedTracks.length === 0) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '❌ Song Not Found',
              description:
                `We couldn't find any songs matching **"${query}"** in this room or catalog.\n\n` +
                `ℹ️ **What you can do:**\n` +
                `• 🔍 **Check Spelling:** Make sure the song name or artist is spelled correctly.\n` +
                `• 📜 **Browse Queue:** Run \`/queue\` to view available songs in the host's playlist.\n` +
                `• 📥 **Import to Felo:** Host can download or add this track in the desktop app.\n` +
                `• 🌐 **Listen Live:** Tune in to the active room via the web player.`,
              color: 0xef4444,
              footer: { text: `Searched for "${query}" • Felo Music` }
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 2,
                  custom_id: 'queue_help_view',
                  label: 'View Current Queue',
                  emoji: { name: '📜' }
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Open Web Player',
                  emoji: { name: '🌐' },
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Download Apps (Android/iOS/PC)',
                  emoji: { name: '📥' },
                  url: 'https://felo.feloapp.workers.dev/#/download'
                }
              ]
            }
          ]
        }
      })
    }

    // Branch 2: No exact match, but related songs were found
    if (!primaryTrack && relatedTracks.length > 0) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔍 Related Songs Found',
              description:
                `We couldn't find an exact track for **"${query}"**, but found these related songs:\n\n` +
                relatedTracks
                  .map((r, i) => {
                    const rDur = r.duration ? ` \`[${formatTime(r.duration)}]\`` : ''
                    return `\`${i + 1}.\` **${r.title}** by *${r.artist || 'Unknown'}*${rDur}`
                  })
                  .join('\n') +
                `\n\n👉 *Click a button below to play any of these songs!*`,
              color: 0xf59e0b,
              footer: { text: `Searched for "${query}" • Tap a song below to play` }
            }
          ],
          components: [
            {
              type: 1,
              components: relatedTracks.slice(0, 4).map((r, i) => ({
                type: 2,
                style: 1,
                custom_id: `queue_rel_${encodeURIComponent(r.title.slice(0, 35))}`,
                label: `Play #${i + 1}: ${r.title.slice(0, 20)}`,
                emoji: { name: '▶️' }
              }))
            }
          ]
        }
      })
    }

    // Branch 1: Primary Song Found
    const songToPlay = primaryTrack

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'play',
      payload: {
        query,
        action,
        title: songToPlay.title,
        artist: songToPlay.artist,
        album: songToPlay.album || '',
        duration: songToPlay.duration || 0,
        artworkUrl: songToPlay.artworkUrl || ''
      },
      sender_name: username,
      source: 'discord_universal'
    })

    const displayTitle = songToPlay.title
    const displayArtist = songToPlay.artist ? `by **${songToPlay.artist}**` : ''
    const trackDur = songToPlay.duration ? ` \`[${formatTime(songToPlay.duration)}]\`` : ''
    const albumLine = songToPlay.album ? `💿 **Album:** *${songToPlay.album}*\n` : ''

    let relatedSection = ''
    if (relatedTracks.length > 0) {
      relatedSection =
        `\n\n🔍 **Related Songs:**\n` +
        relatedTracks
          .slice(0, 3)
          .map((r, i) => {
            const rDur = r.duration ? ` \`[${formatTime(r.duration)}]\`` : ''
            return `\`${i + 1}.\` **${r.title}** — ${r.artist || 'Unknown'}${rDur}`
          })
          .join('\n')
    }

    const relatedButtonsRow =
      relatedTracks.length > 0
        ? [
            {
              type: 1,
              components: relatedTracks.slice(0, 3).map((r, i) => ({
                type: 2,
                style: 2,
                custom_id: `queue_rel_${encodeURIComponent(r.title.slice(0, 35))}`,
                label: `#${i + 1}: ${r.title.slice(0, 20)}`,
                emoji: { name: '▶️' }
              }))
            }
          ]
        : []

    if (action === 'play_now') {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🎶 Playing Now Automatically',
              description:
                `**Track:** **${displayTitle}** ${displayArtist}${trackDur}\n` +
                albumLine +
                `**Room:** \`${roomCode}\`\n\n` +
                `⚡ *Playback started automatically!*` +
                relatedSection,
              color: 0x10b981,
              thumbnail: songToPlay.artworkUrl ? { url: songToPlay.artworkUrl } : undefined,
              footer: { text: `Requested by @${username} • Felo Music` }
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 2,
                  custom_id: 'queue_skip',
                  label: 'Skip Track',
                  emoji: { name: '⏭️' }
                },
                {
                  type: 2,
                  style: 2,
                  custom_id: 'queue_help_view',
                  label: 'View Queue',
                  emoji: { name: '📜' }
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Open Web Player',
                  emoji: { name: '🌐' },
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
                }
              ]
            },
            ...relatedButtonsRow
          ]
        }
      })
    }

    // Next up / Enqueued
    const isPriorityEnabled =
      room?.song?.discordPriorityEnabled !== undefined
        ? Boolean(room?.song?.discordPriorityEnabled)
        : fullQueue[0]?.discordPriorityEnabled !== undefined
          ? Boolean(fullQueue[0]?.discordPriorityEnabled)
          : true

    const curRemaining = Math.max(0, Math.round((room?.song?.duration || 0) - (room?.position_seconds || 0)))
    const waitMin = Math.floor(curRemaining / 60)
    const waitSec = (curRemaining % 60).toString().padStart(2, '0')
    const waitStr = curRemaining > 0 ? `~${waitMin}m ${waitSec}s` : 'Moments'
    const existingPriorities = fullQueue.filter((t) => t.isPriority).length
    const priorityPos = existingPriorities + 1
    const positionText = isPriorityEnabled
      ? `Priority #${priorityPos} (Plays next after current track)`
      : `Playlist #${fullQueue.length + 1} (End of queue • Priority disabled by Host)`
    const currentPlayingInfo = isCurrentlyPlaying
      ? `▶️ **Currently Playing:** **${room?.song?.title}** by ${room?.song?.artist || 'Unknown'}\n`
      : ''
    const statusNotice = isPriorityEnabled
      ? `🌟 *Marked as Priority Request! It will play right after the current song automatically.*`
      : `ℹ️ *Added to the end of the host's background playlist (Host has disabled priority jump).*`

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: isPriorityEnabled ? '🌟 Added as Priority Request' : '🎶 Added to Host Queue',
            description:
              `🎶 **Track:** **${displayTitle}** ${displayArtist}${trackDur}\n` +
              albumLine +
              `📍 **Queue Position:** \`${positionText}\`\n` +
              (isCurrentlyPlaying ? `⏳ **Estimated Wait:** \`${waitStr}\`\n` : '') +
              currentPlayingInfo +
              `🔑 **Room:** \`${roomCode}\`\n\n` +
              statusNotice +
              relatedSection,
            color: isPriorityEnabled ? 0xf59e0b : 0x3b82f6,
            thumbnail: songToPlay.artworkUrl ? { url: songToPlay.artworkUrl } : undefined,
            footer: { text: `Requested by @${username} • Lossless Synchronized Audio` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                custom_id: 'queue_play_now',
                label: 'Play Instantly Now',
                emoji: { name: '⚡' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'queue_skip',
                label: 'Skip Current Track',
                emoji: { name: '⏭️' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          },
          ...relatedButtonsRow
        ]
      }
    })
  }

  if (name === 'jumpto' || name === 'skipto') {
    const pos = Math.max(1, Number(options.find((o) => o.name === 'position')?.value) || 1)
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const song = fullQueue[pos - 1]

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'jump',
      payload: { index: pos - 1, title: song?.title },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⚡ Instant Jump Initiated',
            description:
              `Jumping directly to track **#${pos}** in Room **\`${roomCode}\`**.\n\n` +
              (song ? `🎶 **Track:** **${song.title}** by **${song.artist || 'Unknown'}**\n\n` : '') +
              `⚡ *Playback will interrupt and start this song right now!*`,
            color: 0x10b981,
            footer: { text: `Requested by @${username} • Instant Play` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'queue_help_view',
                label: 'View Current Queue',
                emoji: { name: '📜' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'bump') {
    const pos = Math.max(1, Number(options.find((o) => o.name === 'position')?.value) || 1)
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const song = fullQueue[pos - 1]

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'bump',
      payload: { index: pos - 1, title: song?.title },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🌟 Promoted to Priority Request',
            description:
              `Track **#${pos}** promoted to **Priority Next Up** in Room **\`${roomCode}\`**!\n\n` +
              (song ? `🎶 **Track:** **${song.title}** by **${song.artist || 'Unknown'}**\n\n` : '') +
              `🌟 *Marked as Priority Request! It will play immediately after the current song before background tracks.*`,
            color: 0xf59e0b,
            footer: { text: `Requested by @${username} • Priority Bump` }
          }
        ]
      }
    })
  }

  if (name === 'remove') {
    const pos = Math.max(1, Number(options.find((o) => o.name === 'position')?.value) || 1)
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const song = fullQueue[pos - 1]

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'remove',
      payload: { index: pos - 1, title: song?.title },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🗑️ Removed from Queue',
            description:
              `Removed track **#${pos}** from Room **\`${roomCode}\`** queue.\n\n` +
              (song ? `🎶 **Track:** **${song.title}** by **${song.artist || 'Unknown'}**` : ''),
            color: 0xef4444,
            footer: { text: `Removed by @${username}` }
          }
        ]
      }
    })
  }

  if (name === 'priority') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()
    const currentSetting =
      room?.song?.discordPriorityEnabled !== undefined
        ? Boolean(room?.song?.discordPriorityEnabled)
        : true
    const explicitEnabled = options.find((o) => o.name === 'enabled')?.value
    const newEnabled = explicitEnabled !== undefined ? Boolean(explicitEnabled) : !currentSetting

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'priority',
      payload: { enabled: newEnabled },
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: newEnabled ? '🌟 Discord Priority Queue: ENABLED' : '📁 Discord Priority Queue: DISABLED',
            description: newEnabled
              ? `Songs requested via Discord \`/play\` will jump to **Priority Next Up** and play right after the current track!`
              : `Songs requested via Discord \`/play\` will be placed at the **end of the host's background playlist**.`,
            color: newEnabled ? 0xf59e0b : 0x6b7280,
            footer: { text: `Configured by @${username} • Room: ${roomCode}` }
          }
        ]
      }
    })
  }

  if (name === 'skip') {
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    const currentTrackTitle = room?.song?.title || 'Current Track'
    const fullQueue = Array.isArray(room?.queue) ? room.queue : []
    const isFirstCurrent =
      fullQueue.length > 0 &&
      room?.song &&
      fullQueue[0].title === room.song.title &&
      fullQueue[0].artist === room.song.artist
    const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
    const nextTrack = upcoming[0]

    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'skip',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    let nextInfo = ''
    if (nextTrack) {
      const nextDur = nextTrack.duration ? ` \`[${formatTime(nextTrack.duration)}]\`` : ''
      if (nextTrack.isPriority) {
        nextInfo = `\n\n▶️ **Now Playing Next:** 🌟 **${nextTrack.title}** by **${nextTrack.artist || 'Unknown'}**${nextDur}\n*(🌟 Priority Request by @${nextTrack.requestedBy || 'Discord User'})*`
      } else {
        nextInfo = `\n\n▶️ **Now Playing Next:** **${nextTrack.title}** by **${nextTrack.artist || 'Unknown'}**${nextDur}\n*(📁 Background Local Playlist)*`
      }
    } else {
      nextInfo = `\n\n🔇 *Reached the end of the session queue.*`
    }

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏭️ Track Skipped',
            description: `Skipped **${currentTrackTitle}** in Room **\`${roomCode}\`**.${nextInfo}`,
            color: 0x10b981,
            footer: { text: `Requested by @${username} • Felo Live Session` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'queue_skip',
                label: 'Skip Track',
                emoji: { name: '⏭️' }
              },
              {
                type: 2,
                style: 1,
                custom_id: 'queue_help_view',
                label: 'View Queue',
                emoji: { name: '📜' }
              },
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
              }
            ]
          }
        ]
      }
    })
  }

  if (name === 'previous') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'previous',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏮️ Previous Track',
            description: `Skipped to previous track in Room **\`${roomCode}\`**.`,
            color: 0x10b981,
            footer: { text: `Requested by @${username}` }
          }
        ]
      }
    })
  }

  if (name === 'stop') {
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'stop',
      payload: {},
      sender_name: username,
      source: 'discord_universal'
    })

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏹️ Playback Stopped',
            description: `Stopped playback and reset track in Room **\`${roomCode}\`**.`,
            color: 0xef4444,
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

  if (name === 'seek') {
    const seconds = Number(options.find((o) => o.name === 'seconds')?.value)
    await supabase.from('listening_room_commands').insert({
      room_code: roomCode,
      command: 'seek',
      payload: { seconds },
      sender_name: username,
      source: 'discord_universal'
    })

    const s = Math.max(0, Math.round(seconds))
    const seekMin = Math.floor(s / 60)
    const seekSec = (s % 60).toString().padStart(2, '0')
    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏩ Seeked Position',
            description: `Jumped to **${seekMin}:${seekSec}** in Room **\`${roomCode}\`**.`,
            color: 0x10b981,
            footer: { text: `Requested by @${username}` }
          }
        ]
      }
    })
  }

  if (name === 'queue') {
    const page = Math.max(1, Number(options?.find((o) => o.name === 'page')?.value) || 1)
    const { data: room } = await supabase
      .from('listening_rooms')
      .select('*')
      .eq('code', roomCode)
      .maybeSingle()

    if (!room) {
      return respond(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '❌ Room Not Active',
              description: `Could not find an active session with code **\`${roomCode}\`**.`,
              color: 0xef4444
            }
          ]
        }
      })
    }

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: buildQueuePayload(room, roomCode, page)
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
              description:
                `Room **\`${roomCode}\`** is currently idle.\n\n` +
                `Use \`/play <song>\` to start playing or open the Web Player:\n` +
                `🌐 **Web Player:** https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`,
              color: 0x6b7280
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: 'Open Web Player',
                  emoji: { name: '🌐' },
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
                }
              ]
            }
          ]
        }
      })
    }

    const pos = room.position_seconds || 0
    const dur = song.duration || 0
    const progress = dur > 0 ? Math.min(100, Math.floor((pos / dur) * 100)) : 0
    const posStr = formatTime(pos)
    const durStr = dur > 0 ? formatTime(dur) : '0:00'

    const totalBars = 12
    const activeBars = Math.max(0, Math.min(totalBars, Math.round((progress / 100) * totalBars)))
    const progressBar =
      '▬'.repeat(Math.max(0, activeBars - 1)) +
      '🔘' +
      '▬'.repeat(Math.max(0, totalBars - activeBars))

    const fullQueue = Array.isArray(room.queue) ? room.queue : []
    const isFirstCurrent =
      fullQueue.length > 0 &&
      fullQueue[0].title === song.title &&
      fullQueue[0].artist === song.artist
    const upcomingQueue = isFirstCurrent ? fullQueue.slice(1) : fullQueue
    const nextSong = upcomingQueue[0]

    const isCurrentPriority = Boolean(song.isPriority)
    const originBadge = isCurrentPriority
      ? `🌟 **Priority Request**${song.requestedBy ? ` by @${song.requestedBy}` : ''}`
      : '📁 **Host Library Playlist**'

    let upNextText = ''
    if (nextSong) {
      const nextDur = nextSong.duration ? ` \`[${formatTime(nextSong.duration)}]\`` : ''
      const nextReq = nextSong.requestedBy ? ` • *by @${nextSong.requestedBy}*` : ''
      const nextStar = nextSong.isPriority ? '🌟 ' : ''
      upNextText = `\n\n⏭️ **Up Next:** ${nextStar}**${nextSong.title}** by **${nextSong.artist || 'Unknown'}**${nextDur}${nextReq}`
    }

    return respond(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: room.is_playing ? '🔊 Now Playing' : '⏸️ Currently Paused',
            description:
              `**${song.title}**\nby **${song.artist || 'Unknown'}**\n` +
              (song.album ? `*Album:* ${song.album}\n` : '') +
              `\`${progressBar}\` \`${posStr} / ${durStr}\` (${progress}%)\n\n` +
              `🏷️ **Origin:** ${originBadge}` +
              upNextText +
              `\n\n🔑 **Room Code:** \`${roomCode}\``,
            color: room.is_playing ? 0x10b981 : 0xf59e0b,
            thumbnail: song.artworkUrl ? { url: song.artworkUrl } : undefined,
            footer: { text: `Room: ${roomCode} • Lossless Audio • Requested by @${username}` }
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'player_prev',
                label: 'Previous',
                emoji: { name: '⏮️' }
              },
              {
                type: 2,
                style: room.is_playing ? 2 : 3,
                custom_id: 'player_pause_toggle',
                label: room.is_playing ? 'Pause' : 'Resume',
                emoji: { name: room.is_playing ? '⏸️' : '▶️' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'queue_skip',
                label: 'Skip',
                emoji: { name: '⏭️' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'player_stop',
                label: 'Stop',
                emoji: { name: '⏹️' }
              },
              {
                type: 2,
                style: 2,
                custom_id: 'queue_help_view',
                label: 'Queue',
                emoji: { name: '📜' }
              }
            ]
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'Open Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
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
              `1. Click **\`[🌐 Open Web Player]\`** below or open **https://felo.feloapp.workers.dev** in your browser.\n` +
              `2. Click **Listen Together** in the sidebar to get your **6-letter Room Code** (e.g. \`AB12CD\`).\n` +
              `3. In this Discord channel, type: **\`/connect code:AB12CD\`**.\n` +
              `*(Great for listeners, Chromebooks, Mac, mobile, or anyone without installing software!)*\n\n` +
              `#### 💻 Option 2: Mobile or Desktop App (Android / iOS / PC / Mac / Linux)\n` +
              `1. Click **\`[📲 Download Apps (Android, iOS & PC)]\`** below.\n` +
              `2. Open Felo, play music, and click **Listen Together** to see your **6-letter Room Code**.\n` +
              `3. In this Discord channel, type: **\`/connect code:AB12CD\`**.\n` +
              `*(Best for lossless local audio, offline library management, and streaming PC sound to Discord Voice!)*\n\n` +
              `---\n\n` +
              `### 🎧 How Do Server Members Listen?\n` +
              `• **In Web Browser:** Server members can click **Open Web Player** below, visit **https://felo.feloapp.workers.dev**, or use \`/invite\` to listen in synchronized lossless audio directly in their browser.\n` +
              `• **In Discord Voice:** The desktop host can join a Discord Voice Channel and use Felo's **"Share Device Sound"** to broadcast 320kbps stereo audio to the call.\n\n` +
              `---\n\n` +
              `### ⚡ Essential Commands\n` +
              `• \`/web\` — Instant link to open Felo Web Player (felo.feloapp.workers.dev)\n` +
              `• \`/download\` — Web Player & Desktop App download links\n` +
              `• \`/connect <code>\` — Link channel to your active Felo room\n` +
              `• \`/play <query>\` — Search & queue any song (auto-downloads if missing!)\n` +
              `• \`/queue\` — View the 3-tier visual queue (Now Playing, Priority, Local Playlist)\n` +
              `• \`/priority [true/false]\` — Toggle automatic priority jump for Discord requests\n` +
              `• \`/jumpto <pos>\` — Jump directly to track #N in the queue\n` +
              `• \`/bump <pos>\` — Bump track #N to Priority #1 (plays immediately next)\n` +
              `• \`/remove <pos>\` — Remove track #N from the room queue\n` +
              `• \`/skip\` — Skip to next track\n` +
              `• \`/previous\` & \`/stop\` — Previous track or stop playback\n` +
              `• \`/pause\` & \`/resume\` — Toggle playback\n` +
              `• \`/seek <seconds>\` — Jump to time in current track\n` +
              `• \`/nowplaying\` — Show currently playing song & live progress bar\n` +
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
                label: '2. Download Apps (Android/iOS/PC)',
                emoji: { name: '📥' },
                url: 'https://felo.feloapp.workers.dev/#/download'
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
          try {
            ws.close()
          } catch (_) {}
          break
        case 0:
          if (t === 'READY') {
            botUser = d.user
            console.log(`🤖 Universal Felo Bot logged in as ${botUser.username}#${botUser.discriminator || '0'} (${botUser.id})`)
            if (!hasRegisteredCommands) {
              hasRegisteredCommands = true
              void registerCommands(botUser.id)
              void updateApplicationBio()
            }
          } else if (t === 'INTERACTION_CREATE') {
            if (d.type === 2) {
              void handleCommand(d)
            } else if (d.type === 3) {
              void handleComponent(d)
            } else if (d.type === 4) {
              void handleAutocomplete(d)
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

  const FATAL_GATEWAY_CODES = {
    4004: 'Authentication failed. The DISCORD_BOT_TOKEN is invalid, expired, or was reset.',
    4010: 'Invalid shard configuration.',
    4011: 'Sharding required.',
    4012: 'Invalid API version.',
    4013: 'Invalid intent(s).',
    4014: 'Disallowed intent(s). Verify Privileged Gateway Intents in Discord Developer Portal.'
  }

  ws.onclose = (event) => {
    stopHeartbeat()
    const code = event?.code
    const reason = event?.reason || ''

    if (code && FATAL_GATEWAY_CODES[code]) {
      console.error(`\n❌ Fatal Discord Gateway error (code: ${code}): ${FATAL_GATEWAY_CODES[code]}`)
      console.error(`👉 Action required: Check DISCORD_BOT_TOKEN in .env and .env.local, or regenerate it at https://discord.com/developers/applications\n`)
      process.exit(1)
    }

    console.log(`Gateway closed (code: ${code}, reason: "${reason}"). Reconnecting in 5s...`)
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
        },
        presence: {
          activities: [
            botActivityType === 4
              ? {
                  name: 'Custom Status',
                  type: 4,
                  state: botActivity
                }
              : {
                  name: botActivity,
                  type: botActivityType
                }
          ],
          status: 'online',
          afk: false
        }
      }
    })
  )
}

connect()
