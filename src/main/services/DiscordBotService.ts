import { BrowserWindow, ipcMain } from 'electron'
import { randomBytes } from 'crypto'
import fs from 'fs'
import { getDb } from '../database'
import { searchLibrary, type LibraryTrack } from './playbackControlCore'
import { DiscordWebhookUrlSchema, DiscordSettingsSchema, validateWith } from '../../shared/validators/ipcSchemas'

const BOT_TOKEN_KEY = 'felo_discord_bot_token'
const BOT_ENABLED_KEY = 'felo_discord_bot_enabled'
const BOT_PREFIX_KEY = 'felo_discord_bot_prefix'
const BOT_CHANNEL_KEY = 'felo_discord_bot_channel_id'
const WEBHOOK_URL_KEY = 'felo_discord_webhook_url'
const WEBHOOK_ENABLED_KEY = 'felo_discord_webhook_enabled'

const STATUS_CHANNEL = 'external-player:status'
const COMMAND_CHANNEL = 'external-player:command'
const RESULT_CHANNEL = 'external-player:result'

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json'

export interface DiscordBotStatus {
  enabled: boolean
  connected: boolean
  botUser: { id: string; username: string; tag?: string; avatar?: string } | null
  prefix: string
  channelId: string
  webhookUrl: string
  webhookEnabled: boolean
  error: string | null
}

type PendingCommand = { resolve: (value: unknown) => void; timer: NodeJS.Timeout }

export class DiscordBotService {
  private ws: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAck = true
  private sequenceNumber: number | null = null
  private token = ''
  private prefix = '!'
  private allowedChannelId = ''
  private enabled = false
  private connected = false
  private botUser: { id: string; username: string; tag?: string; avatar?: string } | null = null
  private error: string | null = null

  // Outgoing webhook settings
  private webhookUrl = ''
  private webhookEnabled = false
  private lastAnnouncedSongId: string | null = null

  // Playback state tracking
  private pending = new Map<string, PendingCommand>()
  private playerState: {
    ready: boolean
    isPlaying: boolean
    song: { id: string; title: string; artist: string; album: string; duration: number } | null
    position: number
    duration: number
    volume: number
    queueLength: number
    listeningRoomCode?: string
    listeningRoomName?: string
    listeningRoomMembers?: number
  } = {
    ready: false,
    isPlaying: false,
    song: null,
    position: 0,
    duration: 0,
    volume: 1,
    queueLength: 0
  }

  initialize(): void {
    // Listen for player status updates
    ipcMain.on(STATUS_CHANNEL, (_event, status: any) => {
      if (!status) return
      this.playerState = {
        ...this.playerState,
        ready: Boolean(status.ready),
        isPlaying: Boolean(status.isPlaying),
        position: Math.max(0, Number(status.position) || 0),
        duration: Math.max(0, Number(status.duration) || 0),
        volume: Math.max(0, Math.min(1, Number(status.volume) ?? 1)),
        queueLength: Number(status.queueLength) || 0
      }

      if (status.song) {
        this.playerState.song = {
          id: String(status.song.id),
          title: String(status.song.title || 'Unknown title'),
          artist: String(status.song.artist || 'Unknown artist'),
          album: String(status.song.album || ''),
          duration: Number(status.song.duration || 0)
        }
      } else {
        this.playerState.song = null
      }

      // Check if room details were attached
      if (status.listeningRoomCode) {
        this.playerState.listeningRoomCode = status.listeningRoomCode
      }
      if (status.listeningRoomMembers !== undefined) {
        this.playerState.listeningRoomMembers = status.listeningRoomMembers
      }

      // Outgoing webhook auto-announce on track change
      if (
        this.webhookEnabled &&
        this.webhookUrl &&
        status.isPlaying &&
        this.playerState.song &&
        this.playerState.song.id !== this.lastAnnouncedSongId
      ) {
        this.lastAnnouncedSongId = this.playerState.song.id
        void this.sendNowPlayingWebhook(this.webhookUrl, this.playerState.song)
      }
    })

    // Listen for command results from renderer
    ipcMain.on(RESULT_CHANNEL, (_event, requestId: string, result: unknown) => {
      const pending = this.pending.get(requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.resolve(result)
    })

    // Listen for active Listen Together room info reported by renderer
    ipcMain.on('discord:update-room-info', (_event, info: { code: string; name?: string; members?: number }) => {
      if (info?.code) {
        this.playerState.listeningRoomCode = info.code
      }
      if (info?.name) {
        this.playerState.listeningRoomName = info.name
      }
      if (typeof info?.members === 'number') {
        this.playerState.listeningRoomMembers = info.members
      }
    })

    // Register IPC Handlers
    ipcMain.handle('discord:get-status', () => this.getStatus())

    ipcMain.handle(
      'discord:update-settings',
      async (
        _event,
        rawSettings: unknown
      ) => {
        const settings = validateWith(DiscordSettingsSchema, rawSettings)
        const db = getDb()

        if (settings.token !== undefined) {
          this.token = settings.token.trim()
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(BOT_TOKEN_KEY, JSON.stringify(this.token))
        }

        if (settings.prefix !== undefined) {
          this.prefix = settings.prefix.trim() || '!'
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(BOT_PREFIX_KEY, JSON.stringify(this.prefix))
        }

        if (settings.channelId !== undefined) {
          this.allowedChannelId = settings.channelId.trim()
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(BOT_CHANNEL_KEY, JSON.stringify(this.allowedChannelId))
        }

        if (settings.webhookUrl !== undefined) {
          this.webhookUrl = settings.webhookUrl.trim()
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(WEBHOOK_URL_KEY, JSON.stringify(this.webhookUrl))
        }

        if (settings.webhookEnabled !== undefined) {
          this.webhookEnabled = Boolean(settings.webhookEnabled)
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(WEBHOOK_ENABLED_KEY, JSON.stringify(this.webhookEnabled))
        }

        if (settings.enabled !== undefined) {
          this.enabled = Boolean(settings.enabled)
          db.prepare(
            "INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, strftime('%s', 'now'))"
          ).run(BOT_ENABLED_KEY, JSON.stringify(this.enabled))

          if (this.enabled) {
            await this.connect()
          } else {
            this.disconnect()
          }
        } else if (this.enabled && settings.token !== undefined) {
          // Reconnect with new token
          await this.connect()
        }

        return this.getStatus()
      }
    )

    ipcMain.handle('discord:test-webhook', async (_event, url: string) => {
      return this.testWebhook(url || this.webhookUrl)
    })

    // Load persisted configurations
    try {
      const db = getDb()
      const tokenRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOT_TOKEN_KEY) as any
      if (tokenRow?.value) this.token = JSON.parse(tokenRow.value)

      const enabledRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOT_ENABLED_KEY) as any
      if (enabledRow?.value) this.enabled = JSON.parse(enabledRow.value) === true

      const prefixRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOT_PREFIX_KEY) as any
      if (prefixRow?.value) this.prefix = JSON.parse(prefixRow.value) || '!'

      const channelRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(BOT_CHANNEL_KEY) as any
      if (channelRow?.value) this.allowedChannelId = JSON.parse(channelRow.value) || ''

      const webhookUrlRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WEBHOOK_URL_KEY) as any
      if (webhookUrlRow?.value) this.webhookUrl = JSON.parse(webhookUrlRow.value) || ''

      const webhookEnabledRow = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WEBHOOK_ENABLED_KEY) as any
      if (webhookEnabledRow?.value) this.webhookEnabled = JSON.parse(webhookEnabledRow.value) === true

      if (this.enabled && this.token) {
        void this.connect().catch((err) => console.warn('Discord Bot startup connect failed:', err))
      }
    } catch (e) {
      console.warn('Error reading Discord Bot settings:', e)
    }
  }

  getStatus(): DiscordBotStatus {
    return {
      enabled: this.enabled,
      connected: this.connected,
      botUser: this.botUser,
      prefix: this.prefix,
      channelId: this.allowedChannelId,
      webhookUrl: this.webhookUrl,
      webhookEnabled: this.webhookEnabled,
      error: this.error
    }
  }

  async connect(): Promise<void> {
    this.disconnect()
    this.error = null

    if (!this.token) {
      this.error = 'No bot token provided.'
      return
    }

    try {
      this.ws = new WebSocket(DISCORD_GATEWAY)

      this.ws.onopen = () => {
        // Connected to gateway socket; awaiting Hello opcode 10
      }

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data))
          this.handleGatewayPayload(payload)
        } catch (err) {
          console.warn('Discord Gateway JSON parse error:', err)
        }
      }

      this.ws.onerror = (err) => {
        console.warn('Discord Gateway WebSocket error:', err)
        this.error = 'Discord WebSocket connection error.'
        this.connected = false
      }

      this.ws.onclose = (event) => {
        this.connected = false
        this.botUser = null
        this.stopHeartbeat()
        if (event.code === 4004) {
          this.error = 'Invalid Discord Bot Token. Please check your token in Settings.'
        } else if (this.enabled) {
          // Attempt reconnect after 5s if still enabled
          setTimeout(() => {
            if (this.enabled) void this.connect()
          }, 5000)
        }
      }
    } catch (err: any) {
      this.error = err?.message || 'Failed to initialize Discord Gateway.'
      this.connected = false
    }
  }

  disconnect(): void {
    this.stopHeartbeat()
    if (this.ws) {
      try {
        this.ws.close(1000)
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.connected = false
    this.botUser = null
  }

  private handleGatewayPayload(payload: { op: number; d: any; s: number | null; t: string | null }): void {
    const { op, d, s, t } = payload
    if (s !== null) this.sequenceNumber = s

    switch (op) {
      case 10: {
        // Hello: start heartbeating & identify
        const heartbeatInterval = d.heartbeat_interval || 41250
        this.startHeartbeat(heartbeatInterval)
        this.identify()
        break
      }
      case 11:
        // Heartbeat ACK
        this.lastHeartbeatAck = true
        break
      case 1:
        // Heartbeat requested by Discord
        this.sendHeartbeat()
        break
      case 7:
        // Reconnect requested
        void this.connect()
        break
      case 9:
        // Invalid session
        this.disconnect()
        setTimeout(() => {
          if (this.enabled) void this.connect()
        }, 3000)
        break
      case 0:
        // Dispatch event
        this.handleDispatch(t, d)
        break
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat()
    this.lastHeartbeatAck = true
    this.heartbeatTimer = setInterval(() => {
      if (!this.lastHeartbeatAck) {
        console.warn('Discord Gateway heartbeat unacknowledged, reconnecting...')
        void this.connect()
        return
      }
      this.sendHeartbeat()
    }, intervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.lastHeartbeatAck = false
    this.ws.send(JSON.stringify({ op: 1, d: this.sequenceNumber }))
  }

  private identify(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const payload = {
      op: 2,
      d: {
        token: this.token,
        intents: 33280, // Guilds (1) + GuildMessages (512) + MessageContent (32768)
        properties: {
          os: process.platform,
          browser: 'felo-desktop',
          device: 'felo-desktop'
        }
      }
    }
    this.ws.send(JSON.stringify(payload))
  }

  private handleDispatch(event: string | null, data: any): void {
    if (event === 'READY') {
      this.connected = true
      this.error = null
      this.botUser = {
        id: data.user.id,
        username: data.user.username,
        tag: `${data.user.username}#${data.user.discriminator || '0'}`,
        avatar: data.user.avatar
      }
      console.log(`[Discord Bot] Logged in as ${this.botUser.username} (${this.botUser.id})`)
      void this.registerSlashCommands()
      return
    }

    if (event === 'MESSAGE_CREATE') {
      void this.handleMessage(data)
    }

    if (event === 'INTERACTION_CREATE') {
      void this.handleInteraction(data)
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    // Ignore bot messages
    if (msg.author?.bot) return

    // If channel lock is set, ignore other channels
    if (this.allowedChannelId && msg.channel_id !== this.allowedChannelId) return

    const content = (msg.content || '').trim()
    if (!content.startsWith(this.prefix)) return

    const rawArgs = content.slice(this.prefix.length).trim().split(/\s+/)
    const command = (rawArgs[0] || '').toLowerCase()
    const args = rawArgs.slice(1).join(' ').trim()
    const channelId = msg.channel_id

    try {
      switch (command) {
        case 'play':
        case 'p':
          await this.cmdPlay(channelId, args)
          break
        case 'pause':
          await this.cmdPause(channelId)
          break
        case 'resume':
        case 'unpause':
          await this.cmdResume(channelId)
          break
        case 'skip':
        case 'next':
        case 's':
          await this.cmdSkip(channelId)
          break
        case 'stop':
          await this.cmdStop(channelId)
          break
        case 'np':
        case 'nowplaying':
          await this.cmdNowPlaying(channelId)
          break
        case 'queue':
        case 'q':
          await this.cmdQueue(channelId)
          break
        case 'room':
        case 'session':
          await this.cmdRoom(channelId)
          break
        case 'volume':
        case 'vol':
          await this.cmdVolume(channelId, args)
          break
        case 'download':
        case 'getapp':
          await this.cmdDownload(channelId)
          break
        case 'help':
        case 'commands':
          await this.cmdHelp(channelId)
          break
      }
    } catch (err: any) {
      console.warn(`Error running command "${command}":`, err)
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '❌ Command Error',
            description: err?.message || 'Failed to execute command.',
            color: 0xef4444
          }
        ]
      })
    }
  }

  // ─── SLASH COMMANDS & INTERACTIONS ─────────────────────────────────

  private async registerSlashCommands(): Promise<void> {
    if (!this.botUser?.id || !this.token) return
    const commands = [
      {
        name: 'play',
        description: 'Play a track locally in Felo and sync with your Listen Together group',
        options: [
          {
            name: 'query',
            description: 'Song title, artist, or album to play',
            type: 3,
            required: true,
            autocomplete: true
          },
          {
            name: 'action',
            description: 'How to play this track',
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
        name: 'search',
        description: 'Search tracks and customize selection with interactive buttons',
        options: [
          {
            name: 'query',
            description: 'Song title or artist to search',
            type: 3,
            required: true
          }
        ]
      },
      {
        name: 'invite',
        description: 'Get Listen Together room code, 1-click join link, and QR code to invite friends'
      },
      {
        name: 'nowplaying',
        description: 'Show currently playing track with progress bar and room code'
      },
      {
        name: 'queue',
        description: 'Show upcoming songs in the player queue',
        options: [
          {
            name: 'page',
            description: 'Queue page number (default: 1)',
            type: 4,
            required: false
          }
        ]
      },
      {
        name: 'skip',
        description: 'Skip to next track in queue'
      },
      {
        name: 'pause',
        description: 'Pause playback'
      },
      {
        name: 'resume',
        description: 'Resume playback'
      },
      {
        name: 'stop',
        description: 'Stop playback'
      },
      {
        name: 'volume',
        description: 'Adjust local Felo playback volume',
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
        description: 'Get the official download link for Felo Music Player'
      },
      {
        name: 'help',
        description: 'Show Felo music player commands and guide'
      }
    ]

    try {
      const res = await fetch(`${DISCORD_API}/applications/${this.botUser.id}/commands`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(commands)
      })
      if (res.ok) {
        console.log(`[Discord Bot] Registered ${commands.length} slash commands with Discord!`)
      } else {
        const errText = await res.text()
        console.warn(`[Discord Bot] Failed to register slash commands (${res.status}):`, errText)
      }
    } catch (err) {
      console.warn('[Discord Bot] Error registering slash commands:', err)
    }
  }

  private async respondInteraction(
    interactionId: string,
    interactionToken: string,
    payload: { type: number; data?: any }
  ): Promise<boolean> {
    try {
      const res = await fetch(
        `${DISCORD_API}/interactions/${interactionId}/${interactionToken}/callback`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      )
      if (!res.ok) {
        const errText = await res.text()
        console.warn(`[Discord Bot] Interaction callback error (${res.status}):`, errText)
        return false
      }
      return true
    } catch (err) {
      console.warn('[Discord Bot] Failed to respond to interaction:', err)
      return false
    }
  }

  private async handleInteraction(interaction: any): Promise<void> {
    if (!interaction) return

    if (this.allowedChannelId && interaction.channel_id !== this.allowedChannelId) {
      if (interaction.type === 2) {
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 4,
          data: {
            flags: 64,
            content: `⚠️ Bot commands are restricted to <#${this.allowedChannelId}>.`
          }
        })
      }
      return
    }

    try {
      switch (interaction.type) {
        case 4:
          await this.handleAutocomplete(interaction)
          break
        case 3:
          await this.handleMessageComponent(interaction)
          break
        case 2:
          await this.handleApplicationCommand(interaction)
          break
      }
    } catch (err: any) {
      console.warn('Error handling Discord interaction:', err)
      try {
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 4,
          data: {
            flags: 64,
            content: `❌ Command Error: ${err?.message || 'Failed to process command'}`
          }
        })
      } catch {
        // ignore
      }
    }
  }

  private async handleAutocomplete(interaction: any): Promise<void> {
    const options = interaction.data?.options || []
    const focused = options.find((o: any) => o.focused)
    const query = (focused?.value || '').trim()

    let choices: Array<{ name: string; value: string }> = []
    const songs = getDb()
      .prepare(
        "SELECT id,title,artist,album,duration,filePath FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%'"
      )
      .all() as LibraryTrack[]

    if (query) {
      const search = searchLibrary(songs, query, '', 15, fs.existsSync)
      choices = search.results.map((s) => {
        const dur = this.formatDuration(s.duration || 0)
        const label = `${s.title} - ${s.artist} (${dur})`.slice(0, 100)
        return { name: label, value: s.id }
      })
    } else {
      const playable = songs.filter((s) => fs.existsSync(s.filePath)).slice(0, 15)
      choices = playable.map((s) => {
        const dur = this.formatDuration(s.duration || 0)
        const label = `${s.title} - ${s.artist} (${dur})`.slice(0, 100)
        return { name: label, value: s.id }
      })
    }

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 8,
      data: { choices }
    })
  }

  private async handleMessageComponent(interaction: any): Promise<void> {
    const customId = interaction.data?.custom_id || ''

    if (customId === 'select_custom_song') {
      const selectedId = interaction.data?.values?.[0]
      if (!selectedId) return

      const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(selectedId) as any
      if (!song) {
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 7,
          data: {
            embeds: [
              {
                title: '❌ Track Unavailable',
                description: 'The selected track is no longer available.',
                color: 0xef4444
              }
            ],
            components: []
          }
        })
        return
      }

      const durStr = this.formatDuration(song.duration || 0)

      await this.respondInteraction(interaction.id, interaction.token, {
        type: 7,
        data: {
          embeds: [
            {
              title: '🎵 Song Customizer',
              description:
                `**Track:** **${song.title}**\n` +
                `**Artist:** **${song.artist}**\n` +
                `*Album:* ${song.album || 'Single'}\n` +
                `*Duration:* \`${durStr}\`\n\n` +
                `*Click an action button below to play now, queue next, or add to queue:*`,
              color: 0x10b981
            }
          ],
          components: [
            interaction.message.components[0],
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: 'Play Now',
                  emoji: { name: '▶️' },
                  custom_id: `act_play_${song.id}`
                },
                {
                  type: 2,
                  style: 1,
                  label: 'Play Next',
                  emoji: { name: '⏭️' },
                  custom_id: `act_next_${song.id}`
                },
                {
                  type: 2,
                  style: 2,
                  label: 'Add to Queue',
                  emoji: { name: '➕' },
                  custom_id: `act_queue_${song.id}`
                }
              ]
            }
          ]
        }
      })
      return
    }

    if (customId.startsWith('act_')) {
      const parts = customId.split('_')
      const mode = parts[1]
      const songId = parts.slice(2).join('_')

      const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(songId) as any
      if (!song) {
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 7,
          data: {
            embeds: [
              {
                title: '❌ Track Not Found',
                description: 'The selected track could not be loaded from local library.',
                color: 0xef4444
              }
            ],
            components: []
          }
        })
        return
      }

      let actionDesc = ''
      let actionTitle = ''
      if (mode === 'play') {
        await this.sendPlayerCommand({ type: 'play-song', song })
        actionTitle = '🎶 Playing Now'
        actionDesc = `Playing **${song.title}** by **${song.artist}** locally and syncing with friends!`
      } else if (mode === 'next') {
        await this.sendPlayerCommand({ type: 'enqueue-next', song })
        actionTitle = '⏭️ Queued Next'
        actionDesc = `**${song.title}** by **${song.artist}** will play right after the current song.`
      } else if (mode === 'queue') {
        await this.sendPlayerCommand({ type: 'enqueue', song })
        actionTitle = '➕ Added to Queue'
        actionDesc = `Added **${song.title}** by **${song.artist}** to the end of the room queue.`
      }

      const roomCode = this.playerState.listeningRoomCode

      await this.respondInteraction(interaction.id, interaction.token, {
        type: 7,
        data: {
          embeds: [
            {
              title: actionTitle,
              description:
                `${actionDesc}\n\n` +
                (roomCode
                  ? `🎧 **Listen Together Code:** \`${roomCode}\`\n*Listen along in real-time in Felo!*`
                  : ''),
              color: 0x10b981,
              footer: {
                text: `Felo Desktop Music • Requested by ${interaction.member?.user?.username || interaction.user?.username || 'User'}`
              }
            }
          ],
          components: []
        }
      })
      return
    }
  }

  private async handleApplicationCommand(interaction: any): Promise<void> {
    const name = (interaction.data?.name || '').toLowerCase()
    const options = interaction.data?.options || []

    switch (name) {
      case 'play': {
        const queryOption = options.find((o: any) => o.name === 'query')?.value || ''
        const actionOption = options.find((o: any) => o.name === 'action')?.value || 'play_now'
        await this.handleSlashPlay(interaction, queryOption, actionOption)
        break
      }
      case 'search': {
        const queryOption = options.find((o: any) => o.name === 'query')?.value || ''
        await this.handleSlashSearch(interaction, queryOption)
        break
      }
      case 'invite':
        await this.handleSlashInvite(interaction)
        break
      case 'nowplaying':
        await this.handleSlashNowPlaying(interaction)
        break
      case 'queue': {
        const pageOption = options.find((o: any) => o.name === 'page')?.value || 1
        await this.handleSlashQueue(interaction, Number(pageOption) || 1)
        break
      }
      case 'skip':
        await this.handleSlashSkip(interaction)
        break
      case 'pause':
        await this.handleSlashPause(interaction)
        break
      case 'resume':
        await this.handleSlashResume(interaction)
        break
      case 'stop':
        await this.handleSlashStop(interaction)
        break
      case 'volume': {
        const percent = options.find((o: any) => o.name === 'percent')?.value
        await this.handleSlashVolume(interaction, percent)
        break
      }
      case 'download':
        await this.handleSlashDownload(interaction)
        break
      case 'help':
        await this.handleSlashHelp(interaction)
        break
      default:
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 4,
          data: {
            flags: 64,
            content: `Unknown slash command: /${name}`
          }
        })
    }
  }

  private async handleSlashPlay(interaction: any, query: string, action: string): Promise<void> {
    if (!query) {
      await this.sendPlayerCommand({ type: 'play' })
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '▶️ Playback Resumed',
              description: 'Resumed local playback and synced across Listen Together.',
              color: 0x10b981
            }
          ]
        }
      })
      return
    }

    let targetSong: any = null
    const songById = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(query) as any
    if (songById && fs.existsSync(songById.filePath)) {
      targetSong = songById
    } else {
      const songs = getDb()
        .prepare(
          "SELECT id,title,artist,album,duration,filePath FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%'"
        )
        .all() as LibraryTrack[]
      const search = searchLibrary(songs, query, '', 5, fs.existsSync)
      if (search.results.length) {
        targetSong = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(search.results[0].id) as any
      }
    }

    if (!targetSong) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔍 Track Not Found Locally',
              description: `Could not find **"${query}"** in the host\'s local library.\n\n*Tip:* Add the song to Felo or download it via Deezer/Qobuz in Felo to play!`,
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

    let actionTitle = '🎶 Playing Track'
    let actionDesc = `**[${targetSong.title}](https://github.com/FanX0/felo)**\nby **${targetSong.artist}**`

    if (action === 'enqueue') {
      await this.sendPlayerCommand({ type: 'enqueue', song: targetSong })
      actionTitle = '➕ Added to Queue'
      actionDesc = `Added **${targetSong.title}** by **${targetSong.artist}** to the queue.`
    } else if (action === 'play_next') {
      await this.sendPlayerCommand({ type: 'enqueue-next', song: targetSong })
      actionTitle = '⏭️ Queued to Play Next'
      actionDesc = `**${targetSong.title}** by **${targetSong.artist}** will play next!`
    } else {
      await this.sendPlayerCommand({ type: 'play-song', song: targetSong })
    }

    const durationStr = this.formatDuration(targetSong.duration || 0)
    const roomCode = this.playerState.listeningRoomCode

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: actionTitle,
            description:
              `${actionDesc}\n\n` +
              `*Album:* ${targetSong.album || 'Single'}\n` +
              `*Duration:* \`${durationStr}\`\n\n` +
              (roomCode
                ? `🎧 **Listen Together Code:** \`${roomCode}\`\n*Join in Felo with this code to listen along in real-time!*`
                : `🎧 *Playing locally on host player*`),
            color: 0x10b981,
            footer: {
              text: `Felo Desktop Music • Requested by ${interaction.member?.user?.username || interaction.user?.username || 'User'}`
            }
          }
        ]
      }
    })
  }

  private async handleSlashSearch(interaction: any, query: string): Promise<void> {
    if (!query) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          content: '❌ Please provide a song title or artist to search for.'
        }
      })
      return
    }

    const songs = getDb()
      .prepare(
        "SELECT id,title,artist,album,duration,filePath FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%'"
      )
      .all() as LibraryTrack[]

    const search = searchLibrary(songs, query, '', 5, fs.existsSync)

    if (!search.results.length) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔍 No Tracks Found',
              description: `Could not find any songs matching **"${query}"** in the host\'s library.`,
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

    const selectOptions = search.results.slice(0, 5).map((song, idx) => ({
      label: `${idx + 1}. ${song.title}`.slice(0, 100),
      value: song.id,
      description: `${song.artist} • ${song.album || 'Single'} (${this.formatDuration(song.duration || 0)})`.slice(0, 100)
    }))

    const firstSong = search.results[0]

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: `🔍 Song Customizer: "${query}"`,
            description:
              `Found **${search.results.length}** matching versions in host library.\n\n` +
              `**Selected:** **${firstSong.title}** by **${firstSong.artist}**\n` +
              `*Duration:* \`${this.formatDuration(firstSong.duration || 0)}\` • *Album:* ${firstSong.album || 'Single'}\n\n` +
              `*Pick a track version from the dropdown, then select an action button:*`,
            color: 0x3b82f6
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: 'select_custom_song',
                placeholder: 'Select track version...',
                options: selectOptions
              }
            ]
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: 'Play Now',
                emoji: { name: '▶️' },
                custom_id: `act_play_${firstSong.id}`
              },
              {
                type: 2,
                style: 1,
                label: 'Play Next',
                emoji: { name: '⏭️' },
                custom_id: `act_next_${firstSong.id}`
              },
              {
                type: 2,
                style: 2,
                label: 'Add to Queue',
                emoji: { name: '➕' },
                custom_id: `act_queue_${firstSong.id}`
              }
            ]
          }
        ]
      }
    })
  }

  private async handleSlashInvite(interaction: any): Promise<void> {
    const code = this.playerState.listeningRoomCode
    const memberCount = this.playerState.listeningRoomMembers || 1
    const song = this.playerState.song

    if (!code) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🎧 Listen Together Session',
              description: 'No active Listen Together room is hosted right now.\nStart playing music in Felo and visit **Listen Together** to activate your room code!',
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

    const joinUrl = `https://github.com/FanX0/felo`

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎧 Live Group Listen Together Invitation',
            description:
              `You\'re invited to listen together with lossless, real-time synchronized music!\n\n` +
              `🔑 **Room Code:**\n\`\`\`${code}\`\`\`\n` +
              (song ? `🎶 **Now Playing:** **${song.title}** by **${song.artist}**\n` : '') +
              `👥 **Active Members:** \`${memberCount}\` listener(s) connected\n\n` +
              `**How to Join:**\n` +
              `1. Open **Felo** on your computer or browser\n` +
              `2. Go to **Listen Together**\n` +
              `3. Enter code \`${code}\` and click **Join**!`,
            color: 0x10b981,
            fields: [
              { name: '🔊 Audio Mode', value: 'High-Fidelity Synchronized Audio', inline: true },
              { name: '⚡ Lag', value: 'Zero Voice Channel Compression', inline: true }
            ],
            footer: {
              text: 'Felo Desktop Music • Click the button below to view Felo'
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
                label: 'Download Felo',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              },
              {
                type: 2,
                style: 5,
                label: 'Join Listen Together',
                emoji: { name: '🎧' },
                url: joinUrl
              }
            ]
          }
        ]
      }
    })
  }

  private async handleSlashNowPlaying(interaction: any): Promise<void> {
    const song = this.playerState.song
    if (!song) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔇 Nothing is currently playing',
              description: 'Use `/play <song>` or `/search <song>` to play music!',
              color: 0x6b7280
            }
          ]
        }
      })
      return
    }

    const pos = Math.floor(this.playerState.position)
    const dur = Math.floor(song.duration)
    const progressPercent = dur > 0 ? Math.min(100, Math.floor((pos / dur) * 100)) : 0
    const progressBar = this.renderProgressBar(pos, dur)
    const roomCode = this.playerState.listeningRoomCode

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: this.playerState.isPlaying ? '🔊 Now Playing' : '⏸️ Currently Paused',
            description:
              `**${song.title}**\nby **${song.artist}**\n*Album:* ${song.album || 'Single'}\n\n` +
              `${progressBar}\n\`${this.formatDuration(pos)} / ${this.formatDuration(dur)}\` (${progressPercent}%)\n\n` +
              (roomCode
                ? `🎧 **Listen Together Room Code:** \`${roomCode}\`\n*Join with code in Felo to listen along!*`
                : `🎧 *Playing locally in Felo desktop*`),
            color: this.playerState.isPlaying ? 0x10b981 : 0xf59e0b,
            footer: {
              text: `Felo Music Player • ${this.playerState.listeningRoomMembers || 1} Listener(s)`
            }
          }
        ]
      }
    })
  }

  private async handleSlashQueue(interaction: any, page = 1): Promise<void> {
    try {
      const offset = Math.max(0, (page - 1) * 10)
      const result: any = await this.sendPlayerCommand({ type: 'queue', offset, limit: 10 })
      const queueList = result?.queue || []

      if (!queueList.length) {
        await this.respondInteraction(interaction.id, interaction.token, {
          type: 4,
          data: {
            embeds: [
              {
                title: '📜 Up Next Queue',
                description: 'The queue is currently empty.',
                color: 0x6b7280
              }
            ]
          }
        })
        return
      }

      const lines = queueList.map((item: any) => {
        const prefix = item.current ? '▶️ **' : `${item.index + 1}. `
        const suffix = item.current ? '**' : ''
        return `${prefix}${item.title} - ${item.artist}${suffix} (\`${this.formatDuration(item.duration || 0)}\`)`
      })

      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: `📜 Current Queue (Page ${page})`,
              description: lines.join('\n'),
              color: 0x10b981,
              footer: {
                text: `Total Queue Length: ${result.total || queueList.length} tracks`
              }
            }
          ]
        }
      })
    } catch (err: any) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '❌ Could not retrieve queue',
              description: err?.message || 'Player did not respond.',
              color: 0xef4444
            }
          ]
        }
      })
    }
  }

  private async handleSlashSkip(interaction: any): Promise<void> {
    await this.sendPlayerCommand({ type: 'next' })
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏭️ Skipped Track',
            description: 'Skipped to the next track in queue.',
            color: 0x10b981
          }
        ]
      }
    })
  }

  private async handleSlashPause(interaction: any): Promise<void> {
    await this.sendPlayerCommand({ type: 'pause' })
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏸️ Playback Paused',
            description: 'Paused the local Felo audio player and synchronized group session.',
            color: 0xf59e0b
          }
        ]
      }
    })
  }

  private async handleSlashResume(interaction: any): Promise<void> {
    await this.sendPlayerCommand({ type: 'play' })
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '▶️ Playback Resumed',
            description: 'Resumed local playback and synced across Listen Together.',
            color: 0x10b981
          }
        ]
      }
    })
  }

  private async handleSlashStop(interaction: any): Promise<void> {
    await this.sendPlayerCommand({ type: 'pause' })
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⏹️ Playback Stopped',
            description: 'Stopped local playback.',
            color: 0x6b7280
          }
        ]
      }
    })
  }

  private async handleSlashVolume(interaction: any, percent: any): Promise<void> {
    const val = parseInt(percent, 10)
    if (isNaN(val) || val < 0 || val > 100) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          content: '❌ Please specify a volume percentage between 0 and 100.'
        }
      })
      return
    }

    await this.sendPlayerCommand({ type: 'volume', percent: val })
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🔊 Volume Adjusted',
            description: `Local Felo playback volume set to **${val}%**.`,
            color: 0x10b981
          }
        ]
      }
    })
  }

  private async handleSlashDownload(interaction: any): Promise<void> {
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '⚡ Download Felo Music Player',
            description:
              `Experience crystal-clear lossless music streaming, local library management, and real-time Listen Together sessions with your friends!\n\n` +
              `🔗 **Direct Download Link:** https://bit.ly/47iv3PK\n\n` +
              `✨ **Key Features:**\n` +
              `• 🎧 **Lossless Audio Quality** (Hi-Res FLAC / 320kbps MP3)\n` +
              `• 🌐 **Listen Together** (Real-time P2P sync across friends)\n` +
              `• 🤖 **Discord Bot Integration** (Control player via slash commands)\n` +
              `• 📥 **Offline Download & Smart Audio Tagging**`,
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

  private async handleSlashHelp(interaction: any): Promise<void> {
    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎵 Felo Music Slash Commands',
            description:
              `Control local Felo desktop music and your Listen Together session right from Discord!\n\n` +
              `**/play** \`<query>\` — Autocomplete and play any song\n` +
              `**/search** \`<query>\` — Search & customize tracks with interactive buttons\n` +
              `**/invite** — Get room code and 1-click link to invite friends\n` +
              `**/download** — Direct link to download the Felo desktop app\n` +
              `**/nowplaying** — Show current track with progress bar\n` +
              `**/queue** — View upcoming tracks in the queue\n` +
              `**/skip** — Skip to next song\n` +
              `**/pause** & **/resume** — Pause or resume playback\n` +
              `**/volume** \`<0-100>\` — Set volume\n` +
              `**/help** — Show this guide\n\n` +
              `*Prefix commands like \`${this.prefix}play\` are also supported.*`,
            color: 0x10b981,
            footer: {
              text: 'Felo Desktop Music • Zero Voice Channel Lag'
            }
          }
        ]
      }
    })
  }

  // ─── COMMAND HANDLERS ───────────────────────────────────────────────

  private async cmdPlay(channelId: string, query: string): Promise<void> {
    if (!query) {
      // If query is empty, resume if paused
      await this.cmdResume(channelId)
      return
    }

    // Search local database songs
    const songs = getDb()
      .prepare(
        "SELECT id,title,artist,album,duration,filePath FROM songs WHERE filePath IS NOT NULL AND filePath != '' AND filePath NOT LIKE 'virtual:%'"
      )
      .all() as LibraryTrack[]

    const search = searchLibrary(songs, query, '', 5, fs.existsSync)

    if (!search.results.length) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '🔍 Track Not Found Locally',
            description: `Could not find **"${query}"** in the host's local library.\n\n*Tip:* Add the song to Felo or download it via Soulseek/Deezer/Qobuz in Felo to play!`,
            color: 0xf59e0b
          }
        ]
      })
      return
    }

    const targetSong = search.results[0]
    const fullSong = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(targetSong.id) as any

    // Dispatch play-song command to local Felo player
    await this.sendPlayerCommand({ type: 'play-song', song: fullSong })

    const durationStr = this.formatDuration(fullSong.duration || 0)
    const roomCode = this.playerState.listeningRoomCode

    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '🎶 Playing Track Locally',
          description: `**[${fullSong.title}](https://github.com/FanX0/felo)**\nby **${fullSong.artist}**\n\n` +
            `*Album:* ${fullSong.album || 'Single'}\n` +
            `*Duration:* \`${durationStr}\`\n\n` +
            (roomCode
              ? `🎧 **Listen Together Code:** \`${roomCode}\`\n*Join in Felo with this code to listen along in real-time!*`
              : `🎧 *Playing locally on host player*`),
          color: 0x10b981,
          footer: {
            text: `Felo Desktop Music • Requested via Discord • ${this.playerState.listeningRoomMembers || 1} Listener(s)`
          }
        }
      ]
    })
  }

  private async cmdPause(channelId: string): Promise<void> {
    await this.sendPlayerCommand({ type: 'pause' })
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '⏸️ Playback Paused',
          description: 'Paused the local Felo audio player and synchronized group session.',
          color: 0xf59e0b
        }
      ]
    })
  }

  private async cmdResume(channelId: string): Promise<void> {
    await this.sendPlayerCommand({ type: 'play' })
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '▶️ Playback Resumed',
          description: 'Resumed local playback and synced across Listen Together.',
          color: 0x10b981
        }
      ]
    })
  }

  private async cmdSkip(channelId: string): Promise<void> {
    await this.sendPlayerCommand({ type: 'next' })
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '⏭️ Skipped Track',
          description: 'Skipped to the next track in queue.',
          color: 0x10b981
        }
      ]
    })
  }

  private async cmdStop(channelId: string): Promise<void> {
    await this.sendPlayerCommand({ type: 'pause' })
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '⏹️ Playback Stopped',
          description: 'Stopped local playback.',
          color: 0x6b7280
        }
      ]
    })
  }

  private async cmdNowPlaying(channelId: string): Promise<void> {
    const song = this.playerState.song
    if (!song) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '🔇 Nothing is currently playing',
            description: `Type \`${this.prefix}play <song name>\` to play a song!`,
            color: 0x6b7280
          }
        ]
      })
      return
    }

    const pos = Math.floor(this.playerState.position)
    const dur = Math.floor(song.duration)
    const progressPercent = dur > 0 ? Math.min(100, Math.floor((pos / dur) * 100)) : 0
    const progressBar = this.renderProgressBar(pos, dur)
    const roomCode = this.playerState.listeningRoomCode

    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: this.playerState.isPlaying ? '🔊 Now Playing' : '⏸️ Currently Paused',
          description: `**${song.title}**\nby **${song.artist}**\n*Album:* ${song.album || 'Single'}\n\n` +
            `${progressBar}\n\`${this.formatDuration(pos)} / ${this.formatDuration(dur)}\` (${progressPercent}%)\n\n` +
            (roomCode
              ? `🎧 **Listen Together Room Code:** \`${roomCode}\`\n*Enter this code in Felo to listen along live!*`
              : `🎧 *Playing locally in Felo desktop*`),
          color: this.playerState.isPlaying ? 0x10b981 : 0xf59e0b,
          footer: {
            text: `Felo Music Player • ${this.playerState.listeningRoomMembers || 1} Listener(s)`
          }
        }
      ]
    })
  }

  private async cmdQueue(channelId: string): Promise<void> {
    try {
      const result: any = await this.sendPlayerCommand({ type: 'queue', offset: 0, limit: 10 })
      const queueList = result?.queue || []

      if (!queueList.length) {
        await this.sendChannelMessage(channelId, {
          embeds: [
            {
              title: '📜 Up Next Queue',
              description: 'The queue is currently empty.',
              color: 0x6b7280
            }
          ]
        })
        return
      }

      const lines = queueList.map((item: any, idx: number) => {
        const prefix = item.current ? '▶️ **' : `${idx + 1}. `
        const suffix = item.current ? '**' : ''
        return `${prefix}${item.title} - ${item.artist}${suffix} (\`${this.formatDuration(item.duration || 0)}\`)`
      })

      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: `📜 Current Queue (${queueList.length} Tracks Shown)`,
            description: lines.join('\n'),
            color: 0x10b981,
            footer: {
              text: `Total Queue Length: ${result.total || queueList.length}`
            }
          }
        ]
      })
    } catch (err: any) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '❌ Could not retrieve queue',
            description: err?.message || 'Player did not respond.',
            color: 0xef4444
          }
        ]
      })
    }
  }

  private async cmdRoom(channelId: string): Promise<void> {
    const code = this.playerState.listeningRoomCode
    const memberCount = this.playerState.listeningRoomMembers || 1
    const song = this.playerState.song

    if (!code) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '🎧 Listen Together Session',
            description: 'No active Listen Together room code found on the host.\nStart playing music in Felo to activate your session code!',
            color: 0xf59e0b
          }
        ]
      })
      return
    }

    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '🎧 Live Group Listen Together Session',
          description:
            `Join the live audio stream directly in the Felo desktop app!\n\n` +
            `🔑 **Room Code:** \`${code}\`\n\n` +
            `**How to Join:**\n` +
            `1. Open **Felo** on your computer.\n` +
            `2. Go to **Listen Together**.\n` +
            `3. Enter code \`${code}\` and click **Join**.\n\n` +
            (song ? `🎶 *Now Playing:* **${song.title}** - ${song.artist}` : ''),
          color: 0x10b981,
          fields: [
            { name: '👥 Connected Listeners', value: `${memberCount}`, inline: true },
            { name: '🔊 Audio Mode', value: 'Lossless Local P2P Sync', inline: true }
          ],
          footer: {
            text: 'Felo Desktop Player • High-fidelity Synchronized Audio'
          }
        }
      ]
    })
  }

  private async cmdVolume(channelId: string, args: string): Promise<void> {
    const percent = parseInt(args, 10)
    if (isNaN(percent) || percent < 0 || percent > 100) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '🔊 Volume Setting',
            description: `Please specify a volume percentage between 0 and 100.\n*Example:* \`${this.prefix}volume 80\``,
            color: 0xf59e0b
          }
        ]
      })
      return
    }

    await this.sendPlayerCommand({ type: 'volume', percent })
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '🔊 Volume Adjusted',
          description: `Local Felo playback volume set to **${percent}%**.`,
          color: 0x10b981
        }
      ]
    })
  }

  private async cmdDownload(channelId: string): Promise<void> {
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '⚡ Download Felo Music Player',
          description:
            `Download Felo for desktop to enjoy lossless music and real-time Listen Together rooms!\n\n` +
            `🔗 **Direct Download Link:** https://bit.ly/47iv3PK\n\n` +
            `• 🎧 **Lossless & Hi-Res Audio** (FLAC, ALAC, MP3 320kbps)\n` +
            `• 🌐 **Real-Time Group Listening**\n` +
            `• 🤖 **Discord Bot Music Control**`,
          color: 0x10b981,
          footer: { text: 'Felo Desktop Player • Available for Windows, macOS & Linux' }
        }
      ]
    })
  }

  private async cmdHelp(channelId: string): Promise<void> {
    const p = this.prefix
    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '🎵 Felo Music Bot Commands',
          description:
            `Control the local Felo desktop player directly from Discord chat.\n` +
            `*Music plays in high quality on the host machine and synchronizes with everyone in the room! (No voice channel lag)*\n\n` +
            `\`${p}play <song>\` — Search and play track\n` +
            `\`${p}pause\` — Pause music\n` +
            `\`${p}resume\` — Resume music\n` +
            `\`${p}skip\` — Skip to next song\n` +
            `\`${p}stop\` — Stop playback\n` +
            `\`${p}np\` — Show currently playing track\n` +
            `\`${p}queue\` — Show upcoming songs in queue\n` +
            `\`${p}room\` — Show Listen Together room code\n` +
            `\`${p}download\` — Get link to download Felo app\n` +
            `\`${p}volume <0-100>\` — Set player volume\n` +
            `\`${p}help\` — Show this command guide`,
          color: 0x10b981,
          footer: {
            text: 'Felo • Desktop Music Player & Library'
          }
        }
      ]
    })
  }

  // ─── OUTGOING DISCORD WEBHOOK ──────────────────────────────────────

  async sendNowPlayingWebhook(url: string, song: { title: string; artist: string; album?: string; duration?: number }): Promise<boolean> {
    const validated = DiscordWebhookUrlSchema.safeParse(url)
    if (!validated.success) return false
    const targetUrl = validated.data
    const roomCode = this.playerState.listeningRoomCode
    const durationStr = this.formatDuration(song.duration || 0)

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [
            {
              title: '🎶 Now Playing on Felo',
              description:
                `**${song.title}**\nby **${song.artist}**\n` +
                (song.album ? `*Album:* ${song.album}\n` : '') +
                `*Duration:* \`${durationStr}\`\n\n` +
                (roomCode
                  ? `🎧 **Listen Together Code:** \`${roomCode}\`\n*Join in Felo with code to listen along in real-time!*`
                  : ''),
              color: 0x10b981,
              footer: {
                text: 'Felo Desktop Music Player'
              }
            }
          ]
        })
      })
      return response.ok
    } catch (err) {
      console.warn('Failed to send Discord webhook:', err)
      return false
    }
  }

  async testWebhook(url: string): Promise<{ success: boolean; message: string }> {
    const validated = DiscordWebhookUrlSchema.safeParse(url)
    if (!validated.success) {
      return {
        success: false,
        message: 'Invalid Discord Webhook URL. It must be an HTTPS URL on discord.com/api/webhooks/ or discordapp.com/api/webhooks/'
      }
    }
    const targetUrl = validated.data

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '✅ **Felo Music Player** connected successfully! Webhook notifications are active.'
        })
      })

      if (response.ok) {
        return { success: true, message: 'Webhook test message delivered successfully!' }
      } else {
        const text = await response.text()
        return { success: false, message: `Discord rejected webhook: ${response.status} ${text}` }
      }
    } catch (err: any) {
      return { success: false, message: err?.message || 'Network error reaching Discord webhook.' }
    }
  }

  // ─── INTERNAL UTILITIES ───────────────────────────────────────────

  private async sendChannelMessage(channelId: string, payload: any): Promise<void> {
    if (!this.token || !channelId) return
    try {
      await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (err) {
      console.warn(`Failed to send message to Discord channel ${channelId}:`, err)
    }
  }

  private sendPlayerCommand(command: Record<string, unknown>, deadline = Date.now() + 7_000): Promise<any> {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || win.isDestroyed()) throw new Error('Felo desktop player window is not ready.')

    const requestId = `discord-${randomBytes(16).toString('hex')}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Player command timed out.'))
      }, Math.max(1, deadline - Date.now()))

      this.pending.set(requestId, { resolve, timer })
      win.webContents.send(COMMAND_CHANNEL, { requestId, command, deadline })
    })
  }

  private formatDuration(seconds: number): string {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
    const mins = Math.floor(safe / 60)
    const secs = safe % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  private renderProgressBar(current: number, total: number, barLength = 14): string {
    if (total <= 0) return '🔘' + '▬'.repeat(barLength)
    const progress = Math.min(1, Math.max(0, current / total))
    const dotIndex = Math.min(barLength, Math.floor(progress * barLength))
    let bar = ''
    for (let i = 0; i <= barLength; i++) {
      if (i === dotIndex) bar += '🔘'
      else bar += '▬'
    }
    return bar
  }
}
