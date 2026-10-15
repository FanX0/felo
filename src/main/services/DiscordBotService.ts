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

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (reason?: any) => void
  timer: NodeJS.Timeout
}

export class DiscordBotService {
  private ws: WebSocket | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAck = true

  get isReconnecting(): boolean {
    return this.reconnectTimer !== null
  }
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
    isPrivateSession?: boolean
  } = {
    ready: false,
    isPlaying: false,
    song: null,
    position: 0,
    duration: 0,
    volume: 1,
    queueLength: 0,
    isPrivateSession: false
  }

  initialize(): void {
    // Listen for player status updates
    ipcMain.on(STATUS_CHANNEL, (event, status: any) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || event.sender !== win.webContents) return
      if (!status) return
      this.playerState = {
        ...this.playerState,
        ready: Boolean(status.ready),
        isPlaying: Boolean(status.isPlaying),
        position: Math.max(0, Number(status.position) || 0),
        duration: Math.max(0, Number(status.duration) || 0),
        volume: Math.max(0, Math.min(1, Number(status.volume) ?? 1)),
        queueLength: Number(status.queueLength) || 0,
        isPrivateSession: Boolean(status.isPrivateSession)
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

      // Check if room details were attached or updated
      if ('listeningRoomCode' in status) {
        this.playerState.listeningRoomCode = status.listeningRoomCode || undefined
      }
      if ('listeningRoomName' in status) {
        this.playerState.listeningRoomName = status.listeningRoomName || undefined
      }
      if ('listeningRoomMembers' in status) {
        this.playerState.listeningRoomMembers = Number(status.listeningRoomMembers) || 1
      }

      // Outgoing webhook auto-announce on track change (suppressed in Private Session)
      if (
        !status.isPrivateSession &&
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
      this.playerState.listeningRoomCode = info?.code || undefined
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

    ipcMain.handle('discord:register-commands', async () => {
      return this.registerSlashCommands()
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
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
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

    // Reject all pending commands and clear timeouts
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Discord Bot disconnected.'))
    }
    this.pending.clear()
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
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null
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
        case 'invite':
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

  public async registerSlashCommands(): Promise<{ success: boolean; message: string; count?: number }> {
    if (!this.token) {
      return { success: false, message: 'Please enter and save your Discord Bot Token first.' }
    }

    if (!this.botUser?.id) {
      try {
        const userRes = await fetch(`${DISCORD_API}/users/@me`, {
          headers: { Authorization: `Bot ${this.token}` }
        })
        if (userRes.ok) {
          const userData = (await userRes.json()) as any
          this.botUser = {
            id: userData.id,
            username: userData.username,
            tag: `${userData.username}#${userData.discriminator || '0'}`,
            avatar: userData.avatar
          }
        }
      } catch (err: any) {
        console.warn('[Discord Bot] Could not fetch bot user details:', err)
      }
    }

    if (!this.botUser?.id) {
      return { success: false, message: 'Could not authenticate with Discord. Please check your Bot Token.' }
    }

    const commands = [
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
        console.log(`[Discord Bot] Registered ${commands.length} slash commands with Discord for @${this.botUser.username}!`)
        return {
          success: true,
          count: commands.length,
          message: `Successfully registered ${commands.length} slash commands with Discord for @${this.botUser.username}!`
        }
      } else {
        const errText = await res.text()
        console.warn(`[Discord Bot] Failed to register slash commands (${res.status}):`, errText)
        return {
          success: false,
          message: `Discord API returned error ${res.status}: ${errText}`
        }
      }
    } catch (err: any) {
      console.warn('[Discord Bot] Error registering slash commands:', err)
      return {
        success: false,
        message: `Network error registering commands: ${err?.message || err}`
      }
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

    if (customId === 'disc_cancel') {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 7,
        data: {
          embeds: [
            {
              title: '✅ Disconnect Cancelled',
              description: `The session **\`${this.playerState.listeningRoomCode || ''}\`** remains active.`,
              color: 0x10b981
            }
          ],
          components: []
        }
      })
      return
    }

    if (customId.startsWith('disc_unlink_')) {
      const code = customId.replace('disc_unlink_', '')
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 7,
        data: {
          embeds: [
            {
              title: '👋 Channel Unlinked',
              description:
                `Discord controls unlinked from Room **\`${code}\`**.\n\n` +
                `🎶 *Playback is uninterrupted on the host desktop app and for connected listeners.*`,
              color: 0x6b7280
            }
          ],
          components: []
        }
      })
      return
    }

    if (customId.startsWith('disc_end_')) {
      const code = customId.replace('disc_end_', '')
      await this.sendPlayerCommand({ type: 'stop' })
      this.playerState.listeningRoomCode = undefined
      this.playerState.listeningRoomName = undefined
      this.playerState.listeningRoomMembers = undefined

      await this.respondInteraction(interaction.id, interaction.token, {
        type: 7,
        data: {
          embeds: [
            {
              title: '🛑 Session Ended & Disconnected',
              description:
                `The Listen Together session **\`${code}\`** has been ended.\n\n` +
                `• Host playback stopped.\n` +
                `• Room closed for all connected listeners.`,
              color: 0xef4444
            }
          ],
          components: []
        }
      })
      return
    }

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
        const isCurrentlyPlaying = Boolean(this.playerState.isPlaying && this.playerState.song)
        const actionOption =
          options.find((o: any) => o.name === 'action')?.value || (isCurrentlyPlaying ? 'play_next' : 'play_now')
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
      case 'disconnect':
        await this.handleSlashDisconnect(interaction)
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
      const username = interaction.member?.user?.username || interaction.user?.username || 'User'
      const roomCode = this.playerState.listeningRoomCode

      await this.sendPlayerCommand({
        type: 'download-and-play',
        query,
        action,
        user: username
      })

      const actionText =
        action === 'enqueue'
          ? '➕ Added to Queue'
          : action === 'play_next'
          ? '⏭️ Played Next'
          : '▶️ Played Immediately'

      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '⚡ On-Demand Download Started',
              description:
                `**"${query}"** is not in the host's local library.\n\n` +
                `🎯 **Playback Action:** ${actionText}\n` +
                `🔄 **Priority Download Order:**\n` +
                `1️⃣ **Qobuz** (24-bit Hi-Res) ➔ 2️⃣ **Deezer** (FLAC) ➔ 3️⃣ **Soulseek P2P** ➔ 4️⃣ **YouTube Music**\n\n` +
                `⏳ **Status:** Searching, buffering, and downloading in the background. Playback will begin as soon as ready and sync across Listen Together!` +
                (roomCode ? `\n\n🎧 **Listen Together Code:** \`${roomCode}\`` : ''),
              color: 0x3b82f6,
              footer: {
                text: `Felo Downloader Engine • Requested by @${username}`
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
              title: '⚠️ No Active Listen Together Session',
              description:
                'The host is not currently in an active Listen Together room.\n\n' +
                'To invite friends, please start or join a session in the Felo desktop app under **Listen Together** first.',
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

    const title = '🎧 Live Group Listen Together Invitation'
    const note = "You're invited to listen together with lossless, real-time synchronized music!\n\n"

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title,
            description:
              note +
              `🔑 **Room Code:**\n\`\`\`${code}\`\`\`\n` +
              (song ? `🎶 **Now Playing:** **${song.title}** by **${song.artist}**\n` : '') +
              `👥 **Active Members:** \`${memberCount}\` listener(s) connected\n\n` +
              `**How to Join & Listen:**\n` +
              `• **Instant Web Player (Zero Install):** Click the button below to join right in your browser!\n` +
              `• **Felo Desktop App:** Open Felo → **Listen Together** → Enter code \`${code}\` and click **Join**!\n\n` +
              `🎵 **Anyone in this server can use \`/play <song>\` to search and queue tracks!**`,
            color: 0x10b981,
            fields: [
              { name: '🔊 Audio Mode', value: 'High-Fidelity Synchronized Audio', inline: true },
              { name: '⚡ Latency', value: 'Zero Voice Channel Compression', inline: true }
            ],
            footer: {
              text: 'Felo Desktop Music • Lossless Synchronized Audio'
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
                label: 'Join in Web Player',
                emoji: { name: '🌐' },
                url: `https://felo.feloapp.workers.dev/#/online/listen?code=${code}`
              },
              {
                type: 2,
                style: 5,
                label: 'Download Felo',
                emoji: { name: '📥' },
                url: 'https://bit.ly/47iv3PK'
              }
            ]
          }
        ]
      }
    })
  }

  private async handleSlashDisconnect(interaction: any): Promise<void> {
    const code = this.playerState.listeningRoomCode
    if (!code) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          content: 'ℹ️ The host player is not currently in an active Listen Together session.'
        }
      })
      return
    }

    const hasAdmin = this.isDiscordAdminOrManager(interaction)
    if (!hasAdmin) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          flags: 64,
          embeds: [
            {
              title: '🔒 Permission Required to Disconnect',
              description:
                `Only the host or a **Server Admin** can disconnect this channel from Room **\`${code}\`**.\n\n` +
                `🎧 **Want to leave the session as a listener?**\n` +
                `• **Instant Web Player:** Simply close your browser tab.\n` +
                `• **Desktop App:** Open Felo → click **Leave Session** in the Listen Together tab.\n\n` +
                `*This prevents other members from accidentally interrupting music for the whole server.*`,
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '👋 Disconnect Listen Together Session?',
            description:
              `This channel is linked to Room **\`${code}\`**.\n\n` +
              `Choose how you want to disconnect:\n\n` +
              `1️⃣ **Unlink Channel Only (Keep Music Playing)**\n` +
              `• Removes Discord music controls.\n` +
              `• **Room stays active!** Host and listeners continue listening in the Felo app and browser.\n\n` +
              `2️⃣ **End Session For Everyone (Stop Room)**\n` +
              `• Stops host playback and **closes the room** for all connected listeners.`,
            color: 0x3b82f6,
            footer: {
              text: `Room: ${code} • Felo Desktop Music`
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
                custom_id: `disc_unlink_${code}`,
                label: 'Unlink Channel Only',
                emoji: { name: '👋' }
              },
              {
                type: 2,
                style: 4,
                custom_id: `disc_end_${code}`,
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

  private isDiscordAdminOrManager(interaction: any): boolean {
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

  private async handleSlashNowPlaying(interaction: any): Promise<void> {
    if (this.playerState.isPrivateSession) {
      await this.respondInteraction(interaction.id, interaction.token, {
        type: 4,
        data: {
          embeds: [
            {
              title: '🔒 Private Session',
              description: 'The host is currently in a Private Session. Track details and playback are private.',
              color: 0xf59e0b
            }
          ]
        }
      })
      return
    }

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
    const p = this.prefix
    const roomCode = this.playerState.listeningRoomCode

    await this.respondInteraction(interaction.id, interaction.token, {
      type: 4,
      data: {
        embeds: [
          {
            title: '🎵 Felo Music Bot — Complete Guide',
            description:
              `Felo controls your **local desktop music player** in real-time and syncs audio with everyone in your **Listen Together room** — zero voice channel lag, lossless quality.\n\n` +
              `> 💡 Slash commands (\`/play\`) and prefix commands (\`${p}play\`) both work in any channel.\n` +
              `> 🔊 Audio always plays through the **host's machine** — listeners join via the Felo app using a room code.`,
            color: 0xf59e0b
          },
          {
            title: '🚀 Setup — How to Add This Bot to Your Server',
            color: 0x5865f2,
            description:
              `Follow these steps to connect your Felo desktop app to Discord:\n\n` +
              `**Step 1 — Create a Discord Application**\n` +
              `Go to [discord.com/developers/applications](https://discord.com/developers/applications) → click **New Application** → give it a name (e.g. \`Felo\`).\n\n` +
              `**Step 2 — Create a Bot User**\n` +
              `Inside your application → open the **Bot** tab → click **Add Bot** → confirm. Under the bot's username, click **Reset Token** and **copy the token** — keep it secret!\n\n` +
              `**Step 3 — Enable Privileged Intents**\n` +
              `Still on the Bot tab, scroll to **Privileged Gateway Intents** and enable:\n` +
              `　✅ Server Members Intent　✅ Message Content Intent\n\n` +
              `**Step 4 — Paste Token into Felo**\n` +
              `Open the **Felo desktop app** → **Settings** → **Discord** → paste your bot token → toggle **Enable Bot** on. Felo will connect instantly.\n\n` +
              `**Step 5 — Invite the Bot to Your Server**\n` +
              `Go to **OAuth2 → URL Generator** in your Discord application. Under *Scopes* select \`bot\` + \`applications.commands\`. Under *Bot Permissions* select:\n` +
              `　\`Read Messages\` \`Send Messages\` \`Embed Links\` \`Use Slash Commands\`\n` +
              `Copy the generated URL, open it in a browser, and add the bot to your server.\n\n` +
              `**Step 6 — Done! 🎉**\n` +
              `Type \`/help\` in any channel — the bot will respond with this guide. Use \`/play <song>\` to start playing music!`,
            footer: {
              text: '🔒 Never share your bot token publicly — treat it like a password.'
            }
          },
          {
            title: '🎧 Playback Commands',
            color: 0x10b981,
            fields: [
              {
                name: '/play <query> — Play a Song',
                value:
                  '• Start typing and autocomplete shows matching local tracks.\n' +
                  '• Song **in library** → plays instantly at lossless quality.\n' +
                  '• Song **not in library** → bot automatically searches your priority providers (Qobuz → Deezer → Soulseek → YouTube), downloads in the background, then plays or enqueues it once ready.\n' +
                  '• Optional `action`: **Play Now** (default) | **Play Next** | **Add to Queue**\n' +
                  '*Example: `/play query:Daft Punk Get Lucky action:Play Now`*',
                inline: false
              },
              {
                name: '/search <query> — Browse & Pick',
                value:
                  '• Shows top results in an interactive dropdown menu.\n' +
                  '• Select a song → pick **▶️ Play Now**, **⏭️ Play Next**, or **➕ Add to Queue** via buttons.\n' +
                  '*Example: `/search Radiohead Creep`*',
                inline: false
              },
              {
                name: '/skip',
                value: 'Skip to the next song in the queue immediately.',
                inline: true
              },
              {
                name: '/pause & /resume',
                value: 'Pause or resume playback and sync across the Listen Together room.',
                inline: true
              },
              {
                name: '/stop',
                value: 'Stop playback entirely.',
                inline: true
              },
              {
                name: '/volume <0-100>',
                value: 'Set the local player volume. *Example: `/volume 75`*',
                inline: true
              }
            ]
          },
          {
            title: '📋 Queue & Info Commands',
            color: 0x3b82f6,
            fields: [
              {
                name: '/nowplaying',
                value: 'Shows the current track title, artist, album, and a live progress bar. Also shows the Listen Together room code if a session is active.',
                inline: false
              },
              {
                name: '/queue [page]',
                value: 'Lists upcoming tracks in the queue with positions and durations. Add a page number for longer queues.',
                inline: false
              },
              {
                name: '/invite',
                value: 'Shows your **Listen Together room code** and a 1-click join link so friends can join your session in the Felo app.',
                inline: false
              }
            ]
          },
          {
            title: '📥 On-Demand Auto-Download — How It Works',
            color: 0x8b5cf6,
            description:
              `When you request a song that is not in the host's local library:\n\n` +
              `**Step 1** — Bot replies instantly: *"Downloading via priority providers…"*\n` +
              `**Step 2** — Felo searches providers in your configured priority order:\n` +
              `　　\`Qobuz\` → \`Deezer\` → \`Soulseek P2P\` → \`YouTube Music\`\n` +
              `**Step 3** — First successful provider downloads the file at the best available quality.\n` +
              `**Step 4** — Track is automatically played or queued. If a Listen Together room is open, all listeners sync automatically.\n\n` +
              `> ⚙️ Customize provider priority order in **Felo Settings → Downloads → Priority Order**.` +
              (roomCode ? `\n\n🎧 **Current Room Code:** \`${roomCode}\`` : '')
          },
          {
            title: '🌐 App & Session Commands',
            color: 0x6366f1,
            fields: [
              {
                name: '/download',
                value: 'Sends the official Felo app download link (Windows / macOS / Linux).\n🔗 https://bit.ly/47iv3PK',
                inline: false
              },
              {
                name: '/help',
                value: 'Shows this full command guide.',
                inline: true
              },
              {
                name: `${p}room (prefix only)`,
                value: 'Shows your active Listen Together room code and member count.',
                inline: true
              }
            ]
          },
          {
            title: '💡 Tips & Best Practices',
            color: 0xf59e0b,
            description:
              `• **Autocomplete works in /play** — just start typing the song name to see matching library tracks.\n` +
              `• **Prefix commands** like \`${p}play <song>\`, \`${p}skip\`, \`${p}np\`, \`${p}queue\` work without slash syntax.\n` +
              `• **Inviting friends** — they open Felo → Listen Together → enter the room code. No bot needed on their side.\n` +
              `• **Audio quality** — Felo streams lossless FLAC/Hi-Res audio locally. Listeners sync in real-time without re-encoding.\n` +
              `• **Provider not connecting?** — configure accounts in Felo → Settings → Streaming Accounts.`,
            footer: {
              text: 'Felo Desktop Music • Lossless Local Audio • Zero Voice Channel Lag'
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

    const isCurrentlyPlaying = Boolean(this.playerState.isPlaying && this.playerState.song)
    const playAction = isCurrentlyPlaying ? 'play_next' : 'play_now'

    if (!search.results.length) {
      await this.sendPlayerCommand({
        type: 'download-and-play',
        query,
        action: playAction,
        user: 'Discord'
      })

      const roomCode = this.playerState.listeningRoomCode

      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '⚡ On-Demand Download Started',
            description:
              `**"${query}"** is not in the host's local library.\n\n` +
              `🎯 **Playback Action:** ${playAction === 'play_next' ? '⏭️ Play Next (Queued as Priority)' : '▶️ Play Now (Auto-Plays)'}\n` +
              `🔄 **Priority Download Order:**\n` +
              `1️⃣ **Qobuz** (24-bit Hi-Res) ➔ 2️⃣ **Deezer** (FLAC) ➔ 3️⃣ **Soulseek P2P** ➔ 4️⃣ **YouTube Music**\n\n` +
              `⏳ **Status:** Searching, buffering, and downloading in the background. Playback will begin as soon as ready and sync across Listen Together!` +
              (roomCode ? `\n\n🎧 **Listen Together Code:** \`${roomCode}\`` : ''),
            color: 0x3b82f6,
            footer: {
              text: 'Felo Downloader Engine • Lossless Hi-Res Audio'
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
    if (this.playerState.isPrivateSession) {
      await this.sendChannelMessage(channelId, {
        embeds: [
          {
            title: '🔒 Private Session',
            description: 'The host is currently in a Private Session. Track details and playback are private.',
            color: 0xf59e0b
          }
        ]
      })
      return
    }

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
            title: '⚠️ No Active Listen Together Session',
            description:
              'The host is not currently in an active Listen Together room.\n\n' +
              'To invite listeners, please start or join a session in the Felo desktop app under **Listen Together** first.',
            color: 0xf59e0b
          }
        ]
      })
      return
    }

    const title = '🎧 Live Group Listen Together Session'
    const note = 'Join the live audio stream directly in the Felo desktop app or web browser!\n\n'

    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title,
          description:
            note +
            `🔑 **Room Code:** \`${code}\`\n\n` +
            `**How to Join & Listen:**\n` +
            `• **Web Player (Zero Install):** https://felo.feloapp.workers.dev/#/online/listen?code=${code}\n` +
            `• **Desktop App:** Open Felo → **Listen Together** → Enter \`${code}\`\n\n` +
            (song ? `🎶 *Now Playing:* **${song.title}** - ${song.artist}\n\n` : '') +
            `🎵 Anyone can use \`${this.prefix}play <song>\` to queue music!`,
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
    const roomCode = this.playerState.listeningRoomCode

    await this.sendChannelMessage(channelId, {
      embeds: [
        {
          title: '🎵 Felo Music Bot — Complete Guide',
          description:
            `Felo controls your **local desktop music player** in real-time and syncs audio with everyone in your **Listen Together room** — zero voice channel lag, lossless quality.\n\n` +
            `> 💡 Use \`${p}command\` below, or switch to slash commands (\`/play\`, \`/help\`, etc.) for autocomplete support.\n` +
            `> 🔊 Audio plays through the **host's machine** — friends join via the Felo app using a room code.`,
          color: 0xf59e0b
        },
        {
          title: '🎧 Playback Commands',
          color: 0x10b981,
          fields: [
            {
              name: `\`${p}play <song name>\` — Play a Song`,
              value:
                `• Song **in library** → plays instantly at lossless quality.\n` +
                `• Song **not in library** → bot automatically searches your priority providers (Qobuz → Deezer → Soulseek → YouTube), downloads in the background, and plays once ready.\n` +
                `*Example: \`${p}play Daft Punk Get Lucky\`*`,
              inline: false
            },
            {
              name: `\`${p}pause\` / \`${p}resume\``,
              value: 'Pause or resume playback, synced across the Listen Together room.',
              inline: true
            },
            {
              name: `\`${p}skip\``,
              value: 'Skip to the next track in the queue.',
              inline: true
            },
            {
              name: `\`${p}stop\``,
              value: 'Stop playback entirely.',
              inline: true
            },
            {
              name: `\`${p}volume <0-100>\``,
              value: `Set the local player volume. *Example: \`${p}volume 75\`*`,
              inline: true
            }
          ]
        },
        {
          title: '📋 Queue & Info Commands',
          color: 0x3b82f6,
          fields: [
            {
              name: `\`${p}np\` — Now Playing`,
              value: 'Shows the current track title, artist, album, duration, and progress. Includes the Listen Together room code if active.',
              inline: false
            },
            {
              name: `\`${p}queue\` — View Queue`,
              value: 'Lists upcoming tracks in the queue with positions and durations.',
              inline: false
            },
            {
              name: `\`${p}room\` — Room Code`,
              value: 'Shows your active Listen Together room code and how many listeners are connected.',
              inline: false
            }
          ]
        },
        {
          title: '📥 On-Demand Auto-Download — How It Works',
          color: 0x8b5cf6,
          description:
            `When you request a song **not in the host's local library**:\n\n` +
            `**Step 1** — Bot replies: *"Downloading via priority providers…"*\n` +
            `**Step 2** — Felo searches in your configured priority order:\n` +
            `　　\`Qobuz\` → \`Deezer\` → \`Soulseek P2P\` → \`YouTube Music\`\n` +
            `**Step 3** — First successful provider downloads the file at the best quality.\n` +
            `**Step 4** — Track plays automatically. If a Listen Together room is active, all listeners sync.\n\n` +
            `> ⚙️ Change provider priority in **Felo Settings → Downloads → Priority Order**.` +
            (roomCode ? `\n\n🎧 **Current Room Code:** \`${roomCode}\`` : '')
        },
        {
          title: '💡 Tips & Best Practices',
          color: 0xf59e0b,
          description:
            `• **Slash commands** (\`/play\`, \`/search\`) give you autocomplete — try them!\n` +
            `• **Inviting friends** — they open Felo → Listen Together → enter the room code.\n` +
            `• **Audio quality** — Felo streams lossless FLAC/Hi-Res locally. Sync is real-time, no re-encoding.\n` +
            `• **\`${p}download\`** — Get the Felo app: https://bit.ly/47iv3PK\n` +
            `• **Provider not connecting?** — configure credentials in Felo → Settings → Streaming Accounts.`,
          footer: {
            text: 'Felo Desktop Music • Lossless Local Audio • Zero Voice Channel Lag'
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

      this.pending.set(requestId, { resolve, reject, timer })
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
