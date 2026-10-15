// Cloudflare Worker: Universal Discord Bot & Web App Router for Felo Music
// Deployed at: https://felo.feloapp.workers.dev/

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
  DISCORD_PUBLIC_KEY?: string
  DISCORD_APPLICATION_ID?: string
  DISCORD_BOT_TOKEN?: string
  SUPABASE_URL?: string
  SUPABASE_KEY?: string
}

// ─── CRYPTO HELPERS (Ed25519 Verification) ───────────────────────────

function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.trim()
  if (cleanHex.length % 2 !== 0) throw new Error('Invalid hex string')
  const array = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < cleanHex.length; i += 2) {
    array[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16)
  }
  return array
}

async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string
): Promise<boolean> {
  try {
    const keyBytes = hexToUint8Array(publicKeyHex)
    const sigBytes = hexToUint8Array(signatureHex)
    const dataBytes = new TextEncoder().encode(timestamp + rawBody)

    let key: CryptoKey
    try {
      key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
    } catch {
      key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        false,
        ['verify']
      )
    }

    return await crypto.subtle.verify(key.algorithm.name || 'Ed25519', key, sigBytes, dataBytes)
  } catch (err) {
    console.error('Signature verification error:', err)
    return false
  }
}

// ─── SUPABASE DIRECT REST CLIENT ─────────────────────────────────────

class SupabaseApi {
  constructor(
    private url: string,
    private key: string
  ) {}

  private get headers(): HeadersInit {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json'
    }
  }

  async getRoom(code: string): Promise<any | null> {
    const res = await fetch(
      `${this.url}/rest/v1/listening_rooms?code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*`,
      { headers: this.headers }
    )
    if (!res.ok) return null
    const data = (await res.json()) as any[]
    return data[0] || null
  }

  async getChannelBinding(channelId: string): Promise<string | null> {
    const res = await fetch(
      `${this.url}/rest/v1/discord_channel_bindings?channel_id=eq.${encodeURIComponent(channelId)}&select=room_code`,
      { headers: this.headers }
    )
    if (!res.ok) return null
    const data = (await res.json()) as any[]
    return data[0]?.room_code || null
  }

  async setChannelBinding(channelId: string, guildId: string | null, roomCode: string, boundBy: string): Promise<boolean> {
    const res = await fetch(`${this.url}/rest/v1/discord_channel_bindings`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        channel_id: channelId,
        guild_id: guildId || null,
        room_code: roomCode,
        bound_by: boundBy,
        updated_at: new Date().toISOString()
      })
    })
    return res.ok
  }

  async removeChannelBinding(channelId: string): Promise<boolean> {
    const res = await fetch(
      `${this.url}/rest/v1/discord_channel_bindings?channel_id=eq.${encodeURIComponent(channelId)}`,
      {
        method: 'DELETE',
        headers: this.headers
      }
    )
    return res.ok
  }

  async insertRoomCommand(
    roomCode: string,
    command: string,
    payload: Record<string, unknown>,
    senderName: string
  ): Promise<boolean> {
    const res = await fetch(`${this.url}/rest/v1/listening_room_commands`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        room_code: roomCode,
        command,
        payload,
        sender_name: senderName,
        source: 'discord_universal',
        status: 'pending'
      })
    })
    return res.ok
  }

  async getChannelBindingDetails(
    channelId: string
  ): Promise<{ room_code: string; bound_by?: string; guild_id?: string } | null> {
    const res = await fetch(
      `${this.url}/rest/v1/discord_channel_bindings?channel_id=eq.${encodeURIComponent(channelId)}&select=room_code,bound_by,guild_id`,
      { headers: this.headers }
    )
    if (!res.ok) return null
    const data = (await res.json()) as any[]
    return data[0] || null
  }

  async closeRoom(roomCode: string): Promise<boolean> {
    const res = await fetch(
      `${this.url}/rest/v1/listening_rooms?code=eq.${encodeURIComponent(roomCode)}`,
      {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({
          is_active: false,
          is_playing: false
        })
      }
    )
    return res.ok
  }
}

function isDiscordAdminOrManager(interaction: any): boolean {
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

// ─── MUSIC CATALOG & QUEUE PAYLOAD HELPERS ───────────────────────────

interface CatalogTrack {
  title: string
  artist: string
  album?: string
  duration?: number
  artworkUrl?: string
}

async function searchMusicCatalog(query: string): Promise<CatalogTrack[]> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5&country=US`
    const res = await fetch(url, { headers: { 'User-Agent': 'FeloWorker/1.0' } })
    if (!res.ok) return []
    const data: any = await res.json()
    if (!Array.isArray(data.results)) return []
    return data.results
      .map((r: any) => ({
        title: r.trackName || '',
        artist: r.artistName || '',
        album: r.collectionName || '',
        duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
        artworkUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : ''
      }))
      .filter((t: any) => Boolean(t.title))
  } catch {
    return []
  }
}

function formatTime(seconds: number | undefined | null): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  const mins = Math.floor(s / 60)
  const secs = (s % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

function buildQueuePayload(room: any, roomCode: string, page: number = 1) {
  const song = room.song
  const fullQueue: any[] = Array.isArray(room.queue) ? room.queue : []
  const isFirstCurrent =
    fullQueue.length > 0 &&
    song &&
    fullQueue[0].title === song.title &&
    fullQueue[0].artist === song.artist

  const upcomingQueue = isFirstCurrent ? fullQueue.slice(1) : fullQueue

  const priorityTracks = upcomingQueue.filter((t: any) => Boolean(t.isPriority))
  const backgroundTracks = upcomingQueue.filter((t: any) => !t.isPriority)

  const pos = room.position_seconds || 0
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

  const isPriorityEnabled =
    (room?.song as any)?.discordPriorityEnabled !== undefined
      ? Boolean((room?.song as any)?.discordPriorityEnabled)
      : (fullQueue[0] as any)?.discordPriorityEnabled !== undefined
        ? Boolean((fullQueue[0] as any)?.discordPriorityEnabled)
        : true

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
    const priorityLines = priorityTracks.slice(0, 5).map((t: any, idx: number) => {
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
    const bgLines = pageBgTracks.map((t: any, idx: number) => {
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

  const queueActionButtons: any[] = [
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

  const components: any[] = [
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

// ─── SLASH COMMAND SCHEMAS ───────────────────────────────────────────

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
    description: 'Play a song in the connected Felo room',
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

// ─── DISCORD INTERACTION ROUTER ──────────────────────────────────────

async function handleDiscordInteractions(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')
  const rawBody = await request.text()

  // Verify signature using bot's public key (Mandatory for Discord interactions verification)
  if (env.DISCORD_PUBLIC_KEY) {
    if (!signature || !timestamp) {
      return new Response('Missing Discord signature headers', { status: 401 })
    }
    const isValid = await verifyDiscordSignature(
      env.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      rawBody
    )
    if (!isValid) {
      return new Response('Invalid Discord signature', { status: 401 })
    }
  } else {
    // If DISCORD_PUBLIC_KEY is not configured, we MUST reject with 401.
    // Discord sends an invalid signature test probe during verification;
    // returning 401 is required for Discord verification handshake security.
    return new Response('DISCORD_PUBLIC_KEY is not configured on Cloudflare Worker', { status: 401 })
  }

  let interaction: any
  try {
    interaction = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON payload', { status: 400 })
  }

  // Type 1: Discord PING / Health Check
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const supabaseUrl = env.SUPABASE_URL || 'https://yvmkfguclsxurlwgnvsu.supabase.co'
  const supabaseKey =
    env.SUPABASE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2bWtmZ3VjbHN4dXJsd2dudnN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MDUxNjksImV4cCI6MjEwMjk4MTE2OX0.vVF5dt1vpLseBDXd2KSIzzazOQKdb9D7RXxcs7aMnuU'
  const supabase = new SupabaseApi(supabaseUrl, supabaseKey)
  const channelId = interaction.channel_id
  const guildId = interaction.guild_id || null
  const username = interaction.member?.user?.username || interaction.user?.username || 'Discord User'

  // Type 3: Message Component Interactions (Buttons, Select Menus)
  if (interaction.type === 3) {
    const customId = interaction.data?.custom_id || ''
    const roomCode = await supabase.getChannelBinding(channelId)
    if (!roomCode) {
      return jsonResponse({
        type: 4,
        data: { flags: 64, content: '❌ This channel is not connected to any room. Use `/connect <code>` first.' }
      })
    }

    if (customId === 'disc_cancel') {
      return jsonResponse({
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
      const binding = await supabase.getChannelBindingDetails(channelId)
      const callerUser = interaction.member?.user || interaction.user
      const callerUsername = callerUser?.username || 'User'
      const callerId = callerUser?.id || ''
      const boundBy = (binding?.bound_by || '').toLowerCase()
      const isInitiator =
        !binding ||
        (callerUsername && callerUsername.toLowerCase() === boundBy) ||
        (callerId && callerId === binding.bound_by)

      if (!isInitiator && !isDiscordAdminOrManager(interaction)) {
        return jsonResponse({
          type: 4,
          data: {
            flags: 64,
            content: '❌ Only the session creator or an admin can confirm unlinking.'
          }
        })
      }

      await supabase.removeChannelBinding(channelId)
      return jsonResponse({
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
      const binding = await supabase.getChannelBindingDetails(channelId)
      const callerUser = interaction.member?.user || interaction.user
      const callerUsername = callerUser?.username || 'User'
      const callerId = callerUser?.id || ''
      const boundBy = (binding?.bound_by || '').toLowerCase()
      const isInitiator =
        !binding ||
        (callerUsername && callerUsername.toLowerCase() === boundBy) ||
        (callerId && callerId === binding.bound_by)

      if (!isInitiator && !isDiscordAdminOrManager(interaction)) {
        return jsonResponse({
          type: 4,
          data: {
            flags: 64,
            content: '❌ Only the session creator or an admin can end the session.'
          }
        })
      }

      await supabase.insertRoomCommand(targetCode, 'stop', {}, callerUsername)
      await supabase.closeRoom(targetCode)
      await supabase.removeChannelBinding(channelId)

      return jsonResponse({
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

    if (customId === 'queue_skip') {
      const room = await supabase.getRoom(roomCode)
      const currentTrackTitle = room?.song?.title || 'Current Track'
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const isFirstCurrent =
        fullQueue.length > 0 &&
        room?.song &&
        fullQueue[0].title === room.song.title &&
        fullQueue[0].artist === room.song.artist
      const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
      const nextTrack = upcoming[0]

      await supabase.insertRoomCommand(roomCode, 'skip', {}, username)

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

      return jsonResponse({
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
      const room = await supabase.getRoom(roomCode)
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const isFirstCurrent =
        fullQueue.length > 0 &&
        room?.song &&
        fullQueue[0].title === room.song.title &&
        fullQueue[0].artist === room.song.artist
      const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
      const song = upcoming[0]

      if (!song) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: 'ℹ️ No upcoming tracks to play.' }
        })
      }

      await supabase.insertRoomCommand(
        roomCode,
        'jump',
        { index: isFirstCurrent ? 1 : 0, title: song.title },
        username
      )
      return jsonResponse({
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
      const room = await supabase.getRoom(roomCode)
      if (!room) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: '❌ Room is not active.' }
        })
      }
      return jsonResponse({
        type: 4,
        data: buildQueuePayload(room, roomCode)
      })
    }

    if (customId.startsWith('queue_page_')) {
      const pageNum = parseInt(customId.replace('queue_page_', ''), 10) || 1
      const room = await supabase.getRoom(roomCode)
      if (!room) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: '❌ Room is not active.' }
        })
      }
      return jsonResponse({
        type: 7,
        data: buildQueuePayload(room, roomCode, pageNum)
      })
    }

    if (customId.startsWith('queue_rel_')) {
      const relQuery = decodeURIComponent(customId.replace('queue_rel_', '')).trim()
      const room = await supabase.getRoom(roomCode)

      // Search catalog or queue for this exact related track
      const onlineMatches = await searchMusicCatalog(relQuery)
      const targetTrack = onlineMatches[0] || {
        title: relQuery,
        artist: 'Selected Track',
        album: '',
        duration: 0,
        artworkUrl: ''
      }

      await supabase.insertRoomCommand(
        roomCode,
        'play',
        {
          query: relQuery,
          action: 'play_now',
          title: targetTrack.title,
          artist: targetTrack.artist,
          album: targetTrack.album || '',
          duration: targetTrack.duration || 0,
          artworkUrl: targetTrack.artworkUrl || ''
        },
        username
      )

      const trackDur = targetTrack.duration ? ` \`[${formatTime(targetTrack.duration)}]\`` : ''

      return jsonResponse({
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

    return jsonResponse({ type: 6 })
  }

  // Type 2: Application Slash Commands
  if (interaction.type === 2) {
    const name = (interaction.data?.name || '').toLowerCase()
    const options = interaction.data?.options || []

    // 1. /connect <CODE>
    if (name === 'connect') {
      const code = (options.find((o: any) => o.name === 'code')?.value || '').trim().toUpperCase()
      if (!code || code.length < 3) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: '❌ Please enter a valid 6-character room code.' }
        })
      }

      const room = await supabase.getRoom(code)
      if (!room) {
        return jsonResponse({
          type: 4,
          data: {
            embeds: [
              {
                title: '❌ Room Not Found or Inactive',
                description:
                  `Could not find an active Listen Together session with code **\`${code}\`**.\n\n` +
                  `💡 **How to activate:**\n` +
                  `1. Open the **Felo desktop app** on your computer.\n` +
                  `2. Start playing any song or open **Listen Together**.\n` +
                  `3. Your active code will appear in Felo Settings → Discord or in the bottom player bar!`,
                color: 0xef4444
              }
            ]
          }
        })
      }

      await supabase.setChannelBinding(channelId, guildId, code, username)

      const song = room.song
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: `🎧 Connected to ${room.name || 'Listen Together'}!`,
              description:
                `This Discord channel is now linked to Room **\`${code}\`**.\n\n` +
                (song ? `🎶 **Now Playing:** **${song.title}** by **${song.artist}**\n\n` : '') +
                `👉 **Anyone in this channel can now control music with:**\n` +
                `• \`/play <song>\` — Search & play in the room\n` +
                `• \`/skip\` — Skip to next song\n` +
                `• \`/pause\` & \`/resume\` — Pause or resume\n` +
                `• \`/nowplaying\` — Show active track & progress bar\n` +
                `• \`/invite\` — Room code & invite link`,
              color: 0x10b981,
              footer: { text: `Connected by @${username} • Lossless Synchronized Audio` }
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: 'Join in Web Player (Instant)',
                  emoji: { name: '🌐' },
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${code}`
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

    // 2. /disconnect - Permission-checked channel unlink or session end
    if (name === 'disconnect') {
      const binding = await supabase.getChannelBindingDetails(channelId)
      if (!binding || !binding.room_code) {
        return jsonResponse({
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
        return jsonResponse({
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
      return jsonResponse({
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

    // 3. /download
    if (name === 'download') {
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '⚡ Download Felo Music Player',
              description:
                `Experience crystal-clear lossless music streaming, personal library management, and real-time Listen Together sessions with friends!\n\n` +
                `🔗 **Direct Download Link:** https://bit.ly/47iv3PK\n\n` +
                `✨ **Key Features:**\n` +
                `• 🎧 **Lossless Hi-Res Audio** (FLAC / 320kbps MP3)\n` +
                `• 🌐 **Listen Together** (Real-time P2P sync across friends)\n` +
                `• 🤖 **Universal Discord Bot** (Control player from any server)\n` +
                `• ⚡ **Real-Time Synchronized Playback & Queue Control**`,
              color: 0x10b981,
              footer: { text: 'Felo Desktop Music • Windows, macOS & Linux' }
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

    // 4. /help
    if (name === 'help') {
      const boundCode = await supabase.getChannelBinding(channelId)
      return jsonResponse({
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
                `• \`/play <query>\` — Search & queue any song in the room\n` +
                `• \`/jumpto <pos>\` — Jump to track #N and play immediately\n` +
                `• \`/bump <pos>\` — Bump track #N to Priority #1 (plays next)\n` +
                `• \`/remove <pos>\` — Remove track #N from queue\n` +
                `• \`/skip\` — Skip to next track\n` +
                `• \`/pause\` & \`/resume\` — Toggle playback\n` +
                `• \`/nowplaying\` — Show currently playing song & live progress\n` +
                `• \`/queue [page]\` — View active session queue & interactive controls\n` +
                `• \`/invite\` — Room code & 1-click web/app join link\n` +
                `• \`/disconnect\` — Unlink this channel`,
              color: 0x10b981,
              footer: {
                text: boundCode
                  ? `Connected to Room: ${boundCode} • Ready to play!`
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

    // 5. /invite - Show active room code and 1-click web player invite link
    if (name === 'invite') {
      const activeCode = await supabase.getChannelBinding(channelId)
      const room = activeCode ? await supabase.getRoom(activeCode) : null

      // Only show invite link if user/channel is already connected to an active room
      if (!activeCode || !room || !room.is_active) {
        return jsonResponse({
          type: 4,
          data: {
            embeds: [
              {
                title: '⚠️ No Active Listen Together Session Connected',
                description:
                  `This Discord channel is not connected to an active Listen Together session.\n\n` +
                  `To invite friends, a host must first connect this channel to an active room:\n\n` +
                  `1️⃣ **Start or Join a Room in Felo:**\n` +
                  `• Open the **Felo Desktop App** or **Web Player** and visit **Listen Together**.\n` +
                  `• Start a room or join one to get your 6-character room code.\n\n` +
                  `2️⃣ **Link This Channel:**\n` +
                  `• Type \`/connect code:<ROOM_CODE>\` in this channel.\n\n` +
                  `3️⃣ **Invite Friends:**\n` +
                  `• Once connected, type \`/invite\` here to get your 1-click web player link and share it!`,
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

      const currentTrack = room.song
        ? `🎶 **Now Playing:** **${room.song.title}** by **${room.song.artist}**\n\n`
        : ''

      const memberCount = room.listener_count || (Array.isArray(room.members) ? room.members.length : 1)

      return jsonResponse({
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

    // All remaining commands require an active room binding
    const roomCode = await supabase.getChannelBinding(channelId)
    if (!roomCode) {
      return jsonResponse({
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

    // 5. /play <QUERY>
    if (name === 'play') {
      const query = (options.find((o: any) => o.name === 'query')?.value || '').trim()
      const explicitAction = options.find((o: any) => o.name === 'action')?.value

      if (!query) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: '❌ Please provide a song title or artist to play.' }
        })
      }

      const room = await supabase.getRoom(roomCode)
      const isCurrentlyPlaying = Boolean(room?.is_playing && room?.song)
      const action = explicitAction || (isCurrentlyPlaying ? 'play_next' : 'play_now')
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const cleanQ = query.toLowerCase()

      // 1. Search in published room queue (exact or substring match)
      const queueExactMatches = fullQueue.filter(
        (t: any) =>
          t.title?.toLowerCase().includes(cleanQ) ||
          (t.artist && t.artist.toLowerCase().includes(cleanQ))
      )

      let primaryTrack: CatalogTrack | null = null
      let relatedTracks: CatalogTrack[] = []

      if (queueExactMatches.length > 0) {
        const best = queueExactMatches[0]
        primaryTrack = {
          title: best.title,
          artist: best.artist || 'Host Library',
          album: best.album || '',
          duration: best.duration || 0,
          artworkUrl: best.artworkUrl || ''
        }
        relatedTracks = queueExactMatches.slice(1, 4).map((t: any) => ({
          title: t.title,
          artist: t.artist || '',
          album: t.album || '',
          duration: t.duration || 0,
          artworkUrl: t.artworkUrl || ''
        }))
      } else {
        // Not in room queue, query online music catalog (iTunes Search API)
        const onlineMatches = await searchMusicCatalog(query)
        if (onlineMatches.length > 0) {
          primaryTrack = onlineMatches[0]
          relatedTracks = onlineMatches.slice(1, 4)
        } else {
          // Check partial word match against queue (if query was multi-word)
          const words = cleanQ.split(/\s+/).filter((w) => w.length >= 3)
          if (words.length > 0) {
            const partialQueue = fullQueue.filter((t: any) => {
              const tStr = `${t.title || ''} ${t.artist || ''}`.toLowerCase()
              return words.some((w) => tStr.includes(w))
            })
            if (partialQueue.length > 0) {
              relatedTracks = partialQueue.slice(0, 4).map((t: any) => ({
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
        return jsonResponse({
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
                  `• 🎵 **Queue in Felo:** Host can play or add this track in the room.\n` +
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
                    label: 'Download App',
                    emoji: { name: '📥' },
                    url: 'https://bit.ly/47iv3PK'
                  }
                ]
              }
            ]
          }
        })
      }

      // Branch 2: No exact match, but related songs were found
      if (!primaryTrack && relatedTracks.length > 0) {
        return jsonResponse({
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

      // Branch 1: Exact / Primary Song Found
      const songToPlay = primaryTrack!

      await supabase.insertRoomCommand(
        roomCode,
        'play',
        {
          query,
          action,
          title: songToPlay.title,
          artist: songToPlay.artist,
          album: songToPlay.album || '',
          duration: songToPlay.duration || 0,
          artworkUrl: songToPlay.artworkUrl || ''
        },
        username
      )

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
        return jsonResponse({
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
        (room?.song as any)?.discordPriorityEnabled !== undefined
          ? Boolean((room?.song as any)?.discordPriorityEnabled)
          : (fullQueue[0] as any)?.discordPriorityEnabled !== undefined
            ? Boolean((fullQueue[0] as any)?.discordPriorityEnabled)
            : true

      const curRemaining = Math.max(0, Math.round((room?.song?.duration || 0) - (room?.position_seconds || 0)))
      const waitMin = Math.floor(curRemaining / 60)
      const waitSec = (curRemaining % 60).toString().padStart(2, '0')
      const waitStr = curRemaining > 0 ? `~${waitMin}m ${waitSec}s` : 'Moments'
      const existingPriorities = fullQueue.filter((t: any) => t.isPriority).length
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

      return jsonResponse({
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

    // /jumpto <position>
    if (name === 'jumpto' || name === 'skipto') {
      const pos = Math.max(1, Number(options.find((o: any) => o.name === 'position')?.value) || 1)
      const room = await supabase.getRoom(roomCode)
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const song = fullQueue[pos - 1]

      await supabase.insertRoomCommand(
        roomCode,
        'jump',
        { index: pos - 1, title: song?.title },
        username
      )

      return jsonResponse({
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

    // /bump <position>
    if (name === 'bump') {
      const pos = Math.max(1, Number(options.find((o: any) => o.name === 'position')?.value) || 1)
      const room = await supabase.getRoom(roomCode)
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const song = fullQueue[pos - 1]

      await supabase.insertRoomCommand(
        roomCode,
        'bump',
        { index: pos - 1, title: song?.title },
        username
      )

      return jsonResponse({
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

    // /remove <position>
    if (name === 'remove') {
      const pos = Math.max(1, Number(options.find((o: any) => o.name === 'position')?.value) || 1)
      const room = await supabase.getRoom(roomCode)
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const song = fullQueue[pos - 1]

      await supabase.insertRoomCommand(
        roomCode,
        'remove',
        { index: pos - 1, title: song?.title },
        username
      )

      return jsonResponse({
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

    // /priority [enabled]
    if (name === 'priority') {
      const room = await supabase.getRoom(roomCode)
      const currentSetting =
        (room?.song as any)?.discordPriorityEnabled !== undefined
          ? Boolean((room?.song as any)?.discordPriorityEnabled)
          : true
      const explicitEnabled = options.find((o: any) => o.name === 'enabled')?.value
      const newEnabled = explicitEnabled !== undefined ? Boolean(explicitEnabled) : !currentSetting

      await supabase.insertRoomCommand(roomCode, 'priority', { enabled: newEnabled }, username)

      return jsonResponse({
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

    // 6. /skip
    if (name === 'skip') {
      const room = await supabase.getRoom(roomCode)
      const currentTrackTitle = room?.song?.title || 'Current Track'
      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const isFirstCurrent =
        fullQueue.length > 0 &&
        room?.song &&
        fullQueue[0].title === room.song.title &&
        fullQueue[0].artist === room.song.artist
      const upcoming = isFirstCurrent ? fullQueue.slice(1) : fullQueue
      const nextTrack = upcoming[0]

      await supabase.insertRoomCommand(roomCode, 'skip', {}, username)

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

      return jsonResponse({
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

    // /previous
    if (name === 'previous') {
      await supabase.insertRoomCommand(roomCode, 'previous', {}, username)
      return jsonResponse({
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

    // /stop
    if (name === 'stop') {
      await supabase.insertRoomCommand(roomCode, 'stop', {}, username)
      return jsonResponse({
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

    // 7. /pause
    if (name === 'pause') {
      await supabase.insertRoomCommand(roomCode, 'pause', {}, username)
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '⏸️ Playback Paused',
              description: `Paused playback in Room **\`${roomCode}\`**.`,
              color: 0xf59e0b
            }
          ]
        }
      })
    }

    // 8. /resume
    if (name === 'resume') {
      await supabase.insertRoomCommand(roomCode, 'resume', {}, username)
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '▶️ Playback Resumed',
              description: `Resumed playback in Room **\`${roomCode}\`**.`,
              color: 0x10b981
            }
          ]
        }
      })
    }

    // /seek <seconds>
    if (name === 'seek') {
      const seconds = Number(options.find((o: any) => o.name === 'seconds')?.value)
      await supabase.insertRoomCommand(roomCode, 'seek', { seconds }, username)
      const s = Math.max(0, Math.round(seconds))
      const seekMin = Math.floor(s / 60)
      const seekSec = (s % 60).toString().padStart(2, '0')
      return jsonResponse({
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

    // /nowplaying
    if (name === 'nowplaying') {
      const room = await supabase.getRoom(roomCode)
      const song = room?.song
      if (!song) {
        return jsonResponse({
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

      if (song.isDeviceStream || room.is_device_stream) {
        return jsonResponse({
          type: 4,
          data: {
            embeds: [
              {
                title: '🔴 Live System Audio Stream',
                description:
                  `**320 kbps Opus Full-Stereo • Studio Fidelity**\n\n` +
                  `🎙️ **Broadcasting:** Host is streaming device loopback audio live!\n` +
                  `📡 **Protocol:** Ephemeral WebRTC Real-Time Stream\n\n` +
                  `🔑 **Room Code:** \`${roomCode}\`\n\n` +
                  `*Open Felo app → Listen Together → Code to tune in live!*`,
                color: 0xef4444,
                footer: { text: 'Real-time Ephemeral Audio • Mode A Compliant' }
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

      const fullQueue: any[] = Array.isArray(room.queue) ? room.queue : []
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

      return jsonResponse({
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
              color: room.is_playing ? 0x10b981 : 0xf59e0b
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

    // 11. /queue
    if (name === 'queue') {
      const page = Math.max(1, Number(options.find((o: any) => o.name === 'page')?.value) || 1)
      const room = await supabase.getRoom(roomCode)
      if (!room) {
        return jsonResponse({
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

      return jsonResponse({
        type: 4,
        data: buildQueuePayload(room, roomCode, page)
      })
    }
  }

  return new Response('Unhandled interaction', { status: 400 })
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' }
  })
}

// ─── WORKER FETCH HANDLER ────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Discord Slash Commands Webhook Endpoint
    // Discord sends POST to the Interaction URL configured in Discord Portal
    if (
      request.method === 'POST' &&
      (url.pathname === '/interactions' || url.pathname === '/api/interactions' || url.pathname === '/')
    ) {
      return handleDiscordInteractions(request, env)
    }

    // Slash command registration endpoint (supports worker secrets or direct client dispatch)
    if (request.method === 'POST' && url.pathname === '/api/register-commands') {
      let targetAppId = env.DISCORD_APPLICATION_ID
      let targetBotToken = env.DISCORD_BOT_TOKEN
      let targetGuildId = env.DISCORD_GUILD_ID

      try {
        const body: any = await request.json()
        if (body?.appId) targetAppId = String(body.appId).trim()
        if (body?.botToken) targetBotToken = String(body.botToken).trim()
        if (body?.guildId) targetGuildId = String(body.guildId).trim()
      } catch {}

      if (!targetAppId || !targetBotToken) {
        return new Response(
          JSON.stringify({
            error:
              'DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN required in worker secrets or request body ({ appId, botToken })'
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const discordUrl = targetGuildId
        ? `https://discord.com/api/v10/applications/${targetAppId}/guilds/${targetGuildId}/commands`
        : `https://discord.com/api/v10/applications/${targetAppId}/commands`

      const res = await fetch(discordUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${targetBotToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(SLASH_COMMANDS)
      })

      const data = await res.text()
      return new Response(data, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Default: Fall through to static SPA assets (Felo web player)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      const assetRes = await env.ASSETS.fetch(request)
      // Guard against SPA fallback serving index.html (200 OK) for missing JS/CSS/static file requests
      const isStaticExt = /\.(js|mjs|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|json|map)$/i.test(url.pathname)
      if (isStaticExt && assetRes.headers.get('content-type')?.includes('text/html')) {
        return new Response(`Asset Not Found: ${url.pathname}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
      return assetRes
    }

    return new Response('Felo Music Cloudflare Worker is Live!', { status: 200 })
  }
}
