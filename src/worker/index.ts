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

    if (customId === 'queue_skip') {
      await supabase.insertRoomCommand(roomCode, 'skip', {}, username)
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '⏭️ Track Skipped',
              description: `Skipped to the next track in Room **\`${roomCode}\`**.`,
              color: 0x10b981,
              footer: { text: `Triggered by @${username}` }
            }
          ]
        }
      })
    }

    if (customId === 'queue_bump_1') {
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
          data: { flags: 64, content: 'ℹ️ No upcoming tracks to bump.' }
        })
      }

      await supabase.insertRoomCommand(roomCode, 'bump', { index: isFirstCurrent ? 1 : 0, title: song.title }, username)
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '🌟 Promoted to Priority Request',
              description:
                `**Track:** **${song.title}** by **${song.artist || 'Unknown'}**\n` +
                `**Room:** \`${roomCode}\`\n\n` +
                `🌟 *Bumped to Priority #1 by @${username}! It will play immediately after the current song.*`,
              color: 0xf59e0b,
              footer: { text: `Requested by @${username} • Priority Bump` }
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
                `• \`/play <song>\` — Search & play (auto-downloads if missing!)\n` +
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

    // 2. /disconnect
    if (name === 'disconnect') {
      const currentCode = await supabase.getChannelBinding(channelId)
      if (!currentCode) {
        return jsonResponse({
          type: 4,
          data: { flags: 64, content: 'ℹ️ This channel is not connected to any room.' }
        })
      }
      await supabase.removeChannelBinding(channelId)
      return jsonResponse({
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
                `• 📥 **On-Demand Auto-Download & Fast Audio Tagging**`,
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
                `• \`/play <query>\` — Search & queue any song (auto-downloads if missing!)\n` +
                `• \`/jumpto <pos>\` — Jump to track #N and play immediately\n` +
                `• \`/bump <pos>\` — Bump track #N to Priority #1 (plays next)\n` +
                `• \`/remove <pos>\` — Remove track #N from queue\n` +
                `• \`/skip\` — Skip to next track\n` +
                `• \`/pause\` & \`/resume\` — Toggle playback\n` +
                `• \`/nowplaying\` — Show currently playing song & live progress\n` +
                `• \`/queue [page]\` — View active session queue & interactive controls\n` +
                `• \`/invite\` — Room code & invite link\n` +
                `• \`/join\` — 1-click web player link & easy guide to join\n` +
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

      const room = await supabase.getRoom(roomCode)
      // When a user runs /play, default to play_now so it plays automatically,
      // while allowing explicit action: 'play_next' or 'enqueue' if specified.
      const action = explicitAction || 'play_now'

      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const cleanQ = query.toLowerCase()

      // Search if track exists in room's published queue
      const matchInQueue = fullQueue.find(
        (t: any) =>
          t.title?.toLowerCase().includes(cleanQ) ||
          (t.artist && t.artist.toLowerCase().includes(cleanQ))
      )

      await supabase.insertRoomCommand(
        roomCode,
        'play',
        {
          query,
          action,
          title: matchInQueue?.title || query,
          artist: matchInQueue?.artist || '',
          duration: matchInQueue?.duration || 0
        },
        username
      )

      const displayTitle = matchInQueue?.title || query
      const displayArtist = matchInQueue?.artist ? `by **${matchInQueue.artist}**` : ''
      const trackDur = matchInQueue?.duration
        ? ` \`[${Math.floor(matchInQueue.duration / 60)}:${(matchInQueue.duration % 60).toString().padStart(2, '0')}]\``
        : ''

      if (action === 'play_now') {
        return jsonResponse({
          type: 4,
          data: {
            embeds: [
              {
                title: '🎶 Playing Now Automatically',
                description:
                  `**Track:** **${displayTitle}** ${displayArtist}${trackDur}\n` +
                  `**Room:** \`${roomCode}\`\n\n` +
                  `⚡ *Playback started automatically!*`,
                color: 0x10b981,
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
                    style: 1,
                    custom_id: 'queue_bump_1',
                    label: 'Move to Next Up',
                    emoji: { name: '🌟' }
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

      // Next up / Enqueued
      const isPriorityEnabled =
        (room?.song as any)?.discordPriorityEnabled !== undefined
          ? Boolean((room?.song as any)?.discordPriorityEnabled)
          : (fullQueue[0] as any)?.discordPriorityEnabled !== undefined
            ? Boolean((fullQueue[0] as any)?.discordPriorityEnabled)
            : true

      const isCurrentlyPlaying = Boolean(room?.is_playing && room?.song)
      const curRemaining = Math.max(0, (room?.song?.duration || 0) - (room?.position_seconds || 0))
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
                `📍 **Queue Position:** \`${positionText}\`\n` +
                (isCurrentlyPlaying ? `⏳ **Estimated Wait:** \`${waitStr}\`\n` : '') +
                currentPlayingInfo +
                `🔑 **Room:** \`${roomCode}\`\n\n` +
                statusNotice,
              color: isPriorityEnabled ? 0xf59e0b : 0x3b82f6,
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
            }
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

    // 6. /skip
    if (name === 'skip') {
      const room = await supabase.getRoom(roomCode)
      await supabase.insertRoomCommand(roomCode, 'skip', {}, username)

      const fullQueue: any[] = Array.isArray(room?.queue) ? room.queue : []
      const isFirstCurrent =
        fullQueue.length > 0 &&
        room?.song &&
        fullQueue[0].title === room.song.title &&
        fullQueue[0].artist === room.song.artist

      const nextSong = isFirstCurrent ? fullQueue[1] : fullQueue[0]

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '⏭️ Skipped Track',
              description: nextSong
                ? `Skipped track in Room **\`${roomCode}\`**.\n` +
                  `🎶 **Now Playing:** **${nextSong.title}** by **${nextSong.artist || 'Unknown'}**`
                : `Skipped to the next track in Room **\`${roomCode}\`**.`,
              color: 0x10b981,
              footer: { text: `Requested by @${username}` }
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
      const seekMin = Math.floor(seconds / 60)
      const seekSec = (seconds % 60).toString().padStart(2, '0')
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
      const posStr = `${Math.floor(pos / 60)}:${(pos % 60).toString().padStart(2, '0')}`
      const durStr = `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}`

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
        const nextDur = nextSong.duration
          ? ` \`[${Math.floor(nextSong.duration / 60)}:${(nextSong.duration % 60).toString().padStart(2, '0')}]\``
          : ''
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
                  style: 5,
                  label: 'Join in Web Player',
                  emoji: { name: '🎧' },
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

      const posStr = `${Math.floor(pos / 60)}:${(pos % 60).toString().padStart(2, '0')}`
      const durStr = dur > 0 ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}` : '0:00'

      let totalRemainingSec = Math.max(0, dur - pos)
      for (const track of upcomingQueue) {
        totalRemainingSec += Number(track.duration) || 0
      }
      const totalHours = Math.floor(totalRemainingSec / 3600)
      const totalMins = Math.floor((totalRemainingSec % 3600) / 60)
      const totalTimeStr = totalHours > 0 ? `${totalHours}h ${totalMins}m` : `${totalMins}m`

      const isPriorityEnabled =
        (room?.song as any)?.discordPriorityEnabled !== undefined
          ? Boolean((room?.song as any)?.discordPriorityEnabled)
          : (fullQueue[0] as any)?.discordPriorityEnabled !== undefined
            ? Boolean((fullQueue[0] as any)?.discordPriorityEnabled)
            : true

      let queueDescription = ''

      // Tier 1: Now Playing Showcase
      if (song) {
        const isCurrentPriority = Boolean(song.isPriority)
        const originTag = isCurrentPriority
          ? `🌟 *Requested by @${song.requestedBy || 'Discord User'}*`
          : '📁 *Host Library*'
        queueDescription +=
          `🔊 **NOW PLAYING:**\n` +
          `▶️ **${song.title}** — *${song.artist || 'Unknown'}*\n` +
          `\`${progressBar}\` \`${posStr} / ${durStr}\` (${progressPercent}%) • ${originTag}\n\n`
      } else {
        queueDescription += `🔊 **NOW PLAYING:** *Nothing is playing right now*\n\n`
      }

      queueDescription += `⚡ **Discord Priority:** \`${isPriorityEnabled ? 'Enabled (Requests Play Next)' : 'Disabled by Host (Requests Placed at End)'}\`\n\n`

      // Tier 2: 🌟 Up Next from Discord (Priority Requests)
      if (priorityTracks.length > 0) {
        queueDescription += `🌟 **UP NEXT FROM DISCORD (${priorityTracks.length} Request${priorityTracks.length > 1 ? 's' : ''}):**\n`
        const priorityLines = priorityTracks.slice(0, 5).map((t, idx) => {
          const tDur = t.duration || 0
          const tDurStr = `${Math.floor(tDur / 60)}:${(tDur % 60).toString().padStart(2, '0')}`
          const reqBy = t.requestedBy ? ` • *by @${t.requestedBy}*` : ''
          return `\`★ ${idx + 1}.\` **${t.title}** — ${t.artist || 'Unknown'} \`[${tDurStr}]\`${reqBy}`
        })
        queueDescription += priorityLines.join('\n')
        if (priorityTracks.length > 5) {
          queueDescription += `\n*...and ${priorityTracks.length - 5} more priority requests*`
        }
        queueDescription += '\n\n'
      }

      // Tier 3: 📜 Background Playlist (Resumes automatically)
      queueDescription += `📜 **BACKGROUND PLAYLIST (${backgroundTracks.length} tracks • Resumes automatically):**\n`

      if (backgroundTracks.length === 0) {
        if (priorityTracks.length === 0) {
          queueDescription += `*No upcoming tracks in queue. Use \`/play <song>\` to add requests!*`
        } else {
          queueDescription += `*No background playlist tracks queued.*`
        }
      } else {
        const previewLimit = 4
        const previewTracks = backgroundTracks.slice(0, previewLimit)
        const lines = previewTracks.map((t, idx) => {
          const tDur = t.duration || 0
          const tDurStr = `${Math.floor(tDur / 60)}:${(tDur % 60).toString().padStart(2, '0')}`
          return `\`${(idx + 1).toString().padStart(2, ' ')}.\` **${t.title}** — ${t.artist || 'Unknown'} \`[${tDurStr}]\``
        })
        queueDescription += lines.join('\n')
        if (backgroundTracks.length > previewLimit) {
          queueDescription += `\n*(+${backgroundTracks.length - previewLimit} more background songs in playlist)*`
        }
      }

      queueDescription += `\n\n💡 *Tip: Use \`/play <song>\` to request songs • Buttons below control playback!*`

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

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: `🎧 Live Session Queue • Room \`${roomCode}\``,
              description: queueDescription,
              color: priorityTracks.length > 0 ? 0xf59e0b : 0x10b981,
              footer: {
                text: `${priorityTracks.length} priority request(s) • ${backgroundTracks.length} background track(s) • Est. total queue: ${totalTimeStr}`
              }
            }
          ],
          components: [
            {
              type: 1,
              components: queueActionButtons
            }
          ]
        }
      })
    }

    // 12. /invite
    if (name === 'invite') {
      const room = await supabase.getRoom(roomCode)
      const currentTrack = room?.song
        ? `🎶 **Now Playing:** **${room.song.title}** by **${room.song.artist}**\n\n`
        : ''

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '🎧 Live Listen Together Invitation',
              description:
                `You're invited to listen along live with synchronized lossless audio!\n\n` +
                currentTrack +
                `🔑 **Room Code:**\n\`\`\`${roomCode}\`\`\`\n` +
                `👉 **Choose How to Join:**\n\n` +
                `**🌐 Option 1: Instant Web Player (No Download Needed)**\n` +
                `• Click **\`[🌐 1-Click Join in Web Browser]\`** below.\n` +
                `• Works immediately in Chrome, Safari, Edge, or on your phone!\n\n` +
                `**💻 Option 2: Felo Desktop App (PC / Mac / Linux)**\n` +
                `• Open Felo → Click **Listen Together** in the sidebar.\n` +
                `• Enter code **\`${roomCode}\`** and click Join!`,
              color: 0x10b981,
              footer: { text: `Room: ${roomCode} • Lossless Synchronized Audio` }
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
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Download Desktop App',
                  emoji: { name: '💻' },
                  url: 'https://bit.ly/47iv3PK'
                }
              ]
            }
          ]
        }
      })
    }

    // 13. /join
    if (name === 'join') {
      const room = await supabase.getRoom(roomCode)
      const isPlaying = Boolean(room?.is_playing && room?.song)

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '🚀 How to Join as a New User',
              description:
                `Joining this session is super fast and requires **no installation** if you use the web player!\n\n` +
                `🔑 **Room Code:** \`${roomCode}\`\n\n` +
                (isPlaying ? `🎶 **Now Playing:** **${room.song.title}** by **${room.song.artist}**\n\n` : '') +
                `### 📖 Step-by-Step Guide:\n\n` +
                `**1️⃣ Step 1: Open the Player**\n` +
                `• **In Browser:** Click the **\`[🌐 1-Click Join in Web Browser]\`** button below.\n` +
                `• **In Desktop App:** Open Felo and click **Listen Together** in the sidebar.\n\n` +
                `**2️⃣ Step 2: Connect to Room**\n` +
                `• With the web button below, you're connected automatically!\n` +
                `• In the app, type code **\`${roomCode}\`** into the box and click **Join Session**.\n\n` +
                `**3️⃣ Step 3: Listen in Sync**\n` +
                `• You'll immediately hear the music synchronized to the second in studio lossless quality.\n` +
                `• Chat with everyone in the room and use \`/play\` right here to request songs!`,
              color: 0x10b981,
              footer: { text: `Room: ${roomCode} • Compatible with PC, Mac, Linux & Mobile` }
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
                  url: `https://felo.feloapp.workers.dev/#/online/listen?code=${roomCode}`
                },
                {
                  type: 2,
                  style: 5,
                  label: 'Download Desktop App',
                  emoji: { name: '💻' },
                  url: 'https://bit.ly/47iv3PK'
                }
              ]
            }
          ]
        }
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

    // Optional: Slash command auto-registration endpoint
    if (request.method === 'POST' && url.pathname === '/api/register-commands') {
      if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_BOT_TOKEN) {
        return new Response('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN required in worker secrets', {
          status: 400
        })
      }
      const res = await fetch(
        `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(SLASH_COMMANDS)
        }
      )
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
