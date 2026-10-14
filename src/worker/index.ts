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
      key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        false,
        ['verify']
      )
    } catch {
      key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
    }

    return await crypto.subtle.verify(key.algorithm.name, key, sigBytes, dataBytes)
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
    description: 'Show currently playing track with progress bar and room code'
  },
  {
    name: 'invite',
    description: 'Show room code and 1-click join links for friends'
  },
  {
    name: 'volume',
    description: 'Set playback volume (0 - 100)',
    options: [
      {
        name: 'percent',
        description: 'Volume percentage (0 - 100)',
        type: 4,
        required: true,
        min_value: 0,
        max_value: 100
      }
    ]
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

  // Verify signature if public key is configured
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

  // Type 2: Application Slash Commands
  if (interaction.type === 2) {
    const supabaseUrl = env.SUPABASE_URL || 'https://jhygugvczjntjffwpxej.supabase.co'
    const supabaseKey = env.SUPABASE_KEY || ''
    const supabase = new SupabaseApi(supabaseUrl, supabaseKey)

    const name = (interaction.data?.name || '').toLowerCase()
    const options = interaction.data?.options || []
    const channelId = interaction.channel_id
    const guildId = interaction.guild_id || null
    const username = interaction.member?.user?.username || interaction.user?.username || 'Discord User'

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
                `• \`/volume <0-100>\` — Set volume\n` +
                `• \`/invite\` — Room code & invite link`,
              color: 0x10b981,
              footer: { text: `Connected by @${username} • Lossless Synchronized Audio` }
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
              title: '🎵 Universal Felo Music Bot Guide',
              description:
                `Control your **Felo desktop music player** and sync lossless audio with everyone in your Discord server!\n\n` +
                `**Step 1 — Connect your session**\n` +
                `Type \`/connect <code>\` with your Felo room code (find it in Felo Settings → Discord).\n\n` +
                `**Step 2 — Play any song**\n` +
                `Type \`/play query:Song Name\` — Felo searches your local library. If not found, it downloads online in the background and plays automatically!\n\n` +
                `**Commands:**\n` +
                `• \`/connect <code>\` — Bind this channel to your room\n` +
                `• \`/disconnect\` — Unbind this channel\n` +
                `• \`/play <query> [action]\` — Play or queue music\n` +
                `• \`/skip\` — Skip to next track\n` +
                `• \`/pause\` & \`/resume\` — Toggle playback\n` +
                `• \`/volume <0-100>\` — Set player volume\n` +
                `• \`/nowplaying\` — Show current song & progress bar\n` +
                `• \`/invite\` — Show room code for friends\n` +
                `• \`/download\` — Download Felo desktop app`,
              color: 0xf59e0b,
              footer: {
                text: boundCode ? `Currently linked to Room ${boundCode}` : 'Channel is not linked yet — use /connect <code>'
              }
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
          content:
            `⚠️ **Channel Not Connected**\n` +
            `This Discord channel is not linked to any Felo room yet.\n` +
            `Type \`/connect <code>\` (e.g. \`/connect ABC123\`) to link your session!`
        }
      })
    }

    // 5. /play <QUERY>
    if (name === 'play') {
      const query = (options.find((o: any) => o.name === 'query')?.value || '').trim()
      const action = options.find((o: any) => o.name === 'action')?.value || 'play_now'

      await supabase.insertRoomCommand(roomCode, 'play', { query, action }, username)

      const actionText =
        action === 'enqueue'
          ? 'Added to Queue'
          : action === 'play_next'
            ? 'Queued to Play Next'
            : 'Now Playing'

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: `🎶 ${actionText}`,
              description:
                `**Track:** "${query}"\n` +
                `**Target Room:** \`${roomCode}\`\n\n` +
                `⚡ *Dispatched to host player. If missing from local library, auto-downloading online via priority providers!*`,
              color: 0x10b981,
              footer: { text: `Requested by @${username} • Lossless Synchronized Audio` }
            }
          ]
        }
      })
    }

    // 6. /skip
    if (name === 'skip') {
      await supabase.insertRoomCommand(roomCode, 'skip', {}, username)
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '⏭️ Skipped Track',
              description: `Skipped to the next track in Room **\`${roomCode}\`**.`,
              color: 0x10b981,
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

    // 9. /volume <0-100>
    if (name === 'volume') {
      const percent = Number(options.find((o: any) => o.name === 'percent')?.value)
      await supabase.insertRoomCommand(roomCode, 'volume', { percent }, username)
      return jsonResponse({
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

    // 10. /nowplaying
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

      const pos = room.position_seconds || 0
      const dur = song.duration || 0
      const progress = dur > 0 ? Math.min(100, Math.floor((pos / dur) * 100)) : 0
      const posStr = `${Math.floor(pos / 60)}:${(pos % 60).toString().padStart(2, '0')}`
      const durStr = `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}`

      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: room.is_playing ? '🔊 Now Playing' : '⏸️ Currently Paused',
              description:
                `**${song.title}**\nby **${song.artist}**\n` +
                (song.album ? `*Album:* ${song.album}\n\n` : '\n') +
                `\`${posStr} / ${durStr}\` (${progress}%)\n\n` +
                `🔑 **Room Code:** \`${roomCode}\``,
              color: room.is_playing ? 0x10b981 : 0xf59e0b
            }
          ]
        }
      })
    }

    // 11. /invite
    if (name === 'invite') {
      return jsonResponse({
        type: 4,
        data: {
          embeds: [
            {
              title: '🎧 Live Listen Together Invitation',
              description:
                `Join our live synchronized music session!\n\n` +
                `🔑 **Room Code:**\n\`\`\`${roomCode}\`\`\`\n` +
                `**How to Join:**\n` +
                `1. Open **Felo** on your computer.\n` +
                `2. Click **Listen Together** in the sidebar.\n` +
                `3. Enter code \`${roomCode}\` to listen along live in lossless quality!`,
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
      return env.ASSETS.fetch(request)
    }

    return new Response('Felo Music Cloudflare Worker is Live!', { status: 200 })
  }
}
