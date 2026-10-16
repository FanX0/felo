import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  downloadAudioFile,
  downloadRemoteAudioFileWithRetry,
  cacheAudioBlob,
  getCachedAudioBlobUrl
} from '../../lib/jitAudioPipeline'

export interface RemotePlayerSong {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artworkUrl?: string
  lyrics?: {
    plainLyrics?: string
    syncedLyrics?: string
  }
}

export type PlaybackTarget = 'desktop' | 'mobile' | 'both'

export interface RemotePlayerState {
  ready: boolean
  playbackState: 'playing' | 'paused' | 'loading' | 'ended' | 'error' | 'stopped'
  isPlaying: boolean
  song: RemotePlayerSong | null
  position: number
  duration: number
  volume: number
  volumePercent?: number
  muted?: boolean
  outputMuted?: boolean
  queueLength?: number
  queueIndex?: number
  shuffle?: boolean
  repeat?: 'off' | 'all' | 'one'
  deviceName?: string
  connectedClients?: number
  targetDevice?: PlaybackTarget
}

export type StateListener = (state: RemotePlayerState) => void
export type ConnectionListener = (connected: boolean) => void
export type TargetListener = (target: PlaybackTarget) => void

class RemoteClient {
  private token: string = ''
  private baseUrl: string = ''
  private eventSource: EventSource | null = null
  private stateListeners = new Set<StateListener>()
  private connectionListeners = new Set<ConnectionListener>()
  private targetListeners = new Set<TargetListener>()
  private reconnectTimer: any = null
  private reconnectAttempts = 0
  private isConnected = false

  // Playback output target: 'desktop', 'mobile', or 'both' (dual synchronized playback)
  private targetDevice: PlaybackTarget = 'desktop'
  private mobileAudio: HTMLAudioElement | null = null
  private mobileIsPlaying = false
  private currentMobileSongId: string | null = null
  private targetLockUntil = 0
  private pendingMobilePlay = false

  private currentState: RemotePlayerState = {
    ready: false,
    playbackState: 'stopped',
    isPlaying: false,
    song: null,
    position: 0,
    duration: 0,
    volume: 1,
    volumePercent: 100,
    shuffle: false,
    repeat: 'off',
    queueLength: 0,
    queueIndex: 0,
    deviceName: 'Felo Desktop',
    connectedClients: 0,
    targetDevice: 'desktop'
  }

  constructor() {
    this.extractTokenAndUrl()
    if (typeof window !== 'undefined') {
      const savedTarget = localStorage.getItem('felo_playback_target') as PlaybackTarget
      if (savedTarget === 'mobile' || savedTarget === 'desktop' || savedTarget === 'both') {
        this.targetDevice = savedTarget
        this.currentState.targetDevice = savedTarget
      }

      // Reconnection & instant state refresh on tab focus / phone unlock
      window.addEventListener('visibilitychange', this.handleVisibilityChange)
      window.addEventListener('online', this.handleOnline)

      // Auto-connect on startup if pairing token and host URL are available
      if (this.token && this.baseUrl) {
        setTimeout(() => {
          this.connect()
        }, 80)
      }
    }
  }

  private handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      if (!this.isConnected || !this.eventSource) {
        this.connect()
      }
      void this.refreshStatus()
    }
  }

  private handleOnline = () => {
    if (!this.isConnected) {
      this.connect()
    }
    void this.refreshStatus()
  }

  public async refreshStatus(): Promise<void> {
    try {
      const data = await this.request('/v1/status')
      if (data && typeof data === 'object') {
        if (this.targetDevice === 'mobile') {
          // If mobile is NOT playing audio locally, but desktop is actively playing, do NOT hijack or mask desktop!
          // Respect active PC playback and switch to desktop target (only if target lock is expired).
          if (Date.now() >= this.targetLockUntil && data.isPlaying && !this.mobileIsPlaying) {
            this.targetDevice = 'desktop'
            localStorage.setItem('felo_playback_target', 'desktop')
            this.notifyTarget()
            this.currentState = {
              ...this.currentState,
              ...data,
              targetDevice: 'desktop'
            }
            this.notifyState()
            return
          }

          this.currentState = {
            ...this.currentState,
            ...data,
            isPlaying: this.mobileIsPlaying,
            playbackState: this.mobileIsPlaying ? 'playing' : 'paused',
            position: this.mobileAudio?.currentTime ?? this.currentState.position,
            targetDevice: 'mobile'
          }
        } else if (this.targetDevice === 'both') {
          this.currentState = {
            ...this.currentState,
            ...data,
            isPlaying: Boolean(data.isPlaying || this.mobileIsPlaying),
            playbackState: data.isPlaying || this.mobileIsPlaying ? 'playing' : 'paused',
            targetDevice: 'both'
          }
        } else {
          this.currentState = {
            ...this.currentState,
            ...data,
            targetDevice: 'desktop'
          }
        }
        this.notifyState()
      }
    } catch {
      // ignore
    }
  }

  private extractTokenAndUrl() {
    if (typeof window === 'undefined') return

    // 1. Try URL search params (?host=...&server=...&token=...)
    const searchParams = new URLSearchParams(window.location.search)
    let token = searchParams.get('token')
    let host = searchParams.get('host') || searchParams.get('server')

    // 2. Try hash query params (#/remote?host=...&token=...)
    if (window.location.hash.includes('?')) {
      const hashQuery = window.location.hash.split('?')[1]
      const hashParams = new URLSearchParams(hashQuery)
      if (!token) token = hashParams.get('token')
      if (!host) host = hashParams.get('host') || hashParams.get('server')
    }

    if (host) {
      this.baseUrl = host.replace(/\/+$/, '')
      localStorage.setItem('felo_remote_base_url', this.baseUrl)
    } else {
      const savedBaseUrl = localStorage.getItem('felo_remote_base_url')
      if (savedBaseUrl) {
        this.baseUrl = savedBaseUrl
      } else {
        this.baseUrl = window.location.origin
      }
    }

    if (token) {
      this.token = token
      localStorage.setItem('felo_remote_token', token)
    } else {
      this.token = localStorage.getItem('felo_remote_token') || ''
    }
  }

  private initMobileAudio(): HTMLAudioElement {
    if (this.mobileAudio) return this.mobileAudio

    const audio = new Audio()
    audio.preload = 'auto'

    audio.addEventListener('play', () => {
      this.mobileIsPlaying = true
      // Prevent overlapping playback: pause renderer audio engine if active
      const playerStore = usePlayerStore.getState()
      if (playerStore.isPlaying) {
        playerStore.setIsPlaying(false)
      }
      this.currentState = {
        ...this.currentState,
        isPlaying: true,
        playbackState: 'playing'
      }
      this.notifyState()
    })

    audio.addEventListener('pause', () => {
      this.mobileIsPlaying = false
      this.currentState = {
        ...this.currentState,
        isPlaying: false,
        playbackState: 'paused'
      }
      this.notifyState()
    })

    audio.addEventListener('timeupdate', () => {
      this.currentState = {
        ...this.currentState,
        position: audio.currentTime
      }
      this.notifyState()
    })

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration && Number.isFinite(audio.duration) ? audio.duration : this.currentState.duration
      this.currentState = {
        ...this.currentState,
        duration: dur
      }
      this.notifyState()
    })

    audio.addEventListener('ended', () => {
      void this.next()
    })

    audio.addEventListener('error', (e) => {
      console.warn('[RemoteClient] Mobile HTML5 audio error:', e)
      this.mobileIsPlaying = false
      this.currentState = {
        ...this.currentState,
        isPlaying: false,
        playbackState: 'error'
      }
      this.notifyState()
    })

    this.mobileAudio = audio
    return audio
  }

  private async prepareAudioSource(songId: string): Promise<string> {
    const rawUrl = this.getAudioStreamUrl(songId)
    // 1. Check RAM cache first (same-file / preload match)
    const cached = getCachedAudioBlobUrl(songId)
    if (cached) return cached

    // 2. MUSIXQUARE Auto-download whole audio object into RAM with 90s watchdog & transient retry
    try {
      const blob = await downloadRemoteAudioFileWithRetry(rawUrl, {
        trackId: songId,
        authToken: this.token
      })
      return cacheAudioBlob(songId, blob)
    } catch (err) {
      console.warn('[RemoteClient] Auto-download into RAM failed, fallback to direct stream URL:', err)
      return rawUrl
    }
  }

  public getTargetDevice(): PlaybackTarget {
    return this.targetDevice
  }

  public async setTargetDevice(target: PlaybackTarget): Promise<void> {
    if (this.targetDevice === target) return
    this.targetDevice = target
    this.currentState.targetDevice = target
    this.targetLockUntil = Date.now() + 4000
    localStorage.setItem('felo_playback_target', target)
    this.notifyTarget()

    const wasPlaying = this.currentState.isPlaying || this.mobileIsPlaying
    const currentPos = this.currentState.position || this.mobileAudio?.currentTime || 0
    const currentSong = this.currentState.song

    if (target === 'mobile') {
      // 1. Target: MOBILE ONLY
      // Pause desktop playback so both devices do not play concurrently
      try {
        await this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        })
      } catch {
        // ignore
      }

      const audio = this.initMobileAudio()
      if (currentSong?.id) {
        this.currentMobileSongId = currentSong.id
        void this.prepareAudioSource(currentSong.id).then((sourceUrl) => {
          if (this.targetDevice !== 'mobile' || this.currentMobileSongId !== currentSong.id) return
          audio.src = sourceUrl

          const seekAndPlay = async () => {
            if (currentPos > 0) {
              audio.currentTime = currentPos
            }
            if (wasPlaying) {
              try {
                await audio.play()
                this.mobileIsPlaying = true
                this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
                this.notifyState()
              } catch (e) {
                console.warn('[RemoteClient] Autoplay prevented, waiting for user click:', e)
              }
            }
          }

          if (audio.readyState >= 1) {
            void seekAndPlay()
          } else {
            audio.addEventListener('loadedmetadata', () => {
              void seekAndPlay()
            }, { once: true })
          }
        })
      }
    } else if (target === 'both') {
      // 2. Target: PLAY ON BOTH (Dual Playback)
      // Resume desktop playback AND start phone/browser audio at current position
      const audio = this.initMobileAudio()

      if (currentSong?.id) {
        this.currentMobileSongId = currentSong.id
        void this.prepareAudioSource(currentSong.id).then((sourceUrl) => {
          if (this.targetDevice !== 'both' || this.currentMobileSongId !== currentSong.id) return
          audio.src = sourceUrl

          const seekAndPlayMobile = async () => {
            if (currentPos > 0) {
              audio.currentTime = currentPos
            }
            if (wasPlaying) {
              try {
                await audio.play()
                this.mobileIsPlaying = true
                this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
                this.notifyState()
              } catch (e) {
                console.warn('[RemoteClient] Both target mobile audio autoplay prevented:', e)
              }
            }
          }

          if (audio.readyState >= 1) {
            void seekAndPlayMobile()
          } else {
            audio.addEventListener('loadedmetadata', () => {
              void seekAndPlayMobile()
            }, { once: true })
          }
        })
      }

      if (wasPlaying && currentSong) {
        try {
          await this.request('/v1/player/play', {
            method: 'POST',
            body: JSON.stringify({})
          })
          await this.request('/v1/player/seek', {
            method: 'POST',
            body: JSON.stringify({ seconds: Math.max(0, currentPos) })
          })
        } catch {
          // ignore
        }
      }
    } else {
      // 3. Target: DESKTOP ONLY
      // Pause mobile audio and resume desktop playback at current time
      if (this.mobileAudio) {
        const capturedPos = this.mobileAudio.currentTime || currentPos
        const wasMobilePlaying = this.mobileIsPlaying || wasPlaying
        this.mobileAudio.pause()
        this.mobileIsPlaying = false

        if (wasMobilePlaying && this.currentState.song) {
          try {
            await this.request('/v1/player/play', {
              method: 'POST',
              body: JSON.stringify({})
            })
            await this.request('/v1/player/seek', {
              method: 'POST',
              body: JSON.stringify({ seconds: Math.max(0, capturedPos) })
            })
          } catch {
            // ignore
          }
        }
      }
    }

    this.notifyState()
  }

  public setToken(token: string) {
    this.token = token.trim()
    localStorage.setItem('felo_remote_token', this.token)
    this.reconnect()
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '')
    localStorage.setItem('felo_remote_base_url', this.baseUrl)
    this.reconnect()
  }

  public configure(url: string, token: string) {
    this.baseUrl = url.replace(/\/+$/, '')
    this.token = token.trim()
    localStorage.setItem('felo_remote_base_url', this.baseUrl)
    localStorage.setItem('felo_remote_token', this.token)
    this.reconnect()
  }

  public getToken(): string {
    return this.token
  }

  public getBaseUrl(): string {
    return this.baseUrl || window.location.origin
  }

  public getState(): RemotePlayerState {
    return this.currentState
  }

  public getIsConnected(): boolean {
    return this.isConnected
  }

  public subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.currentState)
    return () => this.stateListeners.delete(listener)
  }

  public subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    listener(this.isConnected)
    return () => this.connectionListeners.delete(listener)
  }

  public subscribeTarget(listener: TargetListener): () => void {
    this.targetListeners.add(listener)
    listener(this.targetDevice)
    return () => this.targetListeners.delete(listener)
  }

  public connect() {
    if (this.eventSource) return

    // Guard 1: Do not connect without a token configured
    if (!this.token) {
      this.isConnected = false
      this.notifyConnection()
      return
    }

    // Guard 2: If running on a remote web domain (e.g. workers.dev, vercel.app)
    // and baseUrl points to the web domain itself (not a desktop LAN IP or tunnel),
    // there is no desktop HTTP/SSE server running here.
    if (
      typeof window !== 'undefined' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1' &&
      (!this.baseUrl || this.baseUrl === window.location.origin)
    ) {
      this.isConnected = false
      this.notifyConnection()
      return
    }

    const url = `${this.getBaseUrl()}/v1/events?token=${encodeURIComponent(this.token)}`

    try {
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = () => {
        this.isConnected = true
        this.reconnectAttempts = 0
        this.notifyConnection()
      }

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (this.targetDevice === 'both') {
            // Target: PLAY ON BOTH (Dual Playback Sync)
            if (data.song?.id && data.song.id !== this.currentMobileSongId) {
              const songId = data.song.id
              this.currentMobileSongId = songId
              const audio = this.initMobileAudio()
              void this.prepareAudioSource(songId).then((sourceUrl) => {
                if (this.targetDevice !== 'both' || this.currentMobileSongId !== songId) return
                audio.src = sourceUrl
                const targetPos = data.position || 0
                const handleLoaded = () => {
                  if (targetPos > 0) {
                    audio.currentTime = targetPos
                  }
                  if (data.isPlaying) {
                    void audio.play().then(() => {
                      this.mobileIsPlaying = true
                      this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
                      this.notifyState()
                    }).catch(() => undefined)
                  }
                }
                if (audio.readyState >= 1) {
                  handleLoaded()
                } else {
                  audio.addEventListener('loadedmetadata', handleLoaded, { once: true })
                }
              })
            } else if (this.mobileAudio) {
              if (data.isPlaying && this.mobileAudio.paused) {
                void this.mobileAudio.play().then(() => {
                  this.mobileIsPlaying = true
                  this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
                  this.notifyState()
                }).catch(() => undefined)
              } else if (!data.isPlaying && !this.mobileAudio.paused) {
                this.mobileAudio.pause()
                this.mobileIsPlaying = false
              }

              // Synchronization drift correction: if phone audio drifts > 400ms from desktop, gently align
              if (typeof data.position === 'number' && data.isPlaying && !this.mobileAudio.paused) {
                const drift = Math.abs(this.mobileAudio.currentTime - data.position)
                if (drift > 0.4) {
                  this.mobileAudio.currentTime = data.position
                }
              }
            }

            this.currentState = {
              ...this.currentState,
              ...data,
              isPlaying: Boolean(data.isPlaying || this.mobileIsPlaying),
              playbackState: data.isPlaying || this.mobileIsPlaying ? 'playing' : 'paused',
              targetDevice: 'both'
            }
          } else if (this.targetDevice === 'mobile') {
            // If mobile is NOT playing audio locally, but desktop is actively playing, do NOT hijack or pause desktop!
            // Respect active PC playback and reflect desktop as the master target (only if target lock is expired).
            if (Date.now() >= this.targetLockUntil && data.isPlaying && !this.mobileIsPlaying) {
              this.targetDevice = 'desktop'
              localStorage.setItem('felo_playback_target', 'desktop')
              this.notifyTarget()
              this.currentState = {
                ...this.currentState,
                ...data,
                targetDevice: 'desktop'
              }
              this.notifyState()
              return
            }

            // Only if mobile is actively playing its own local audio, keep desktop paused
            if (data.isPlaying && this.mobileIsPlaying) {
              void this.request('/v1/player/pause', {
                method: 'POST',
                body: JSON.stringify({})
              }).catch(() => undefined)
            }

            // Detect if desktop queue advanced or changed song
            if (data.song?.id && data.song.id !== this.currentMobileSongId) {
              const songId = data.song.id
              this.currentMobileSongId = songId
              const audio = this.initMobileAudio()
              void this.prepareAudioSource(songId).then((sourceUrl) => {
                if (this.targetDevice !== 'mobile' || this.currentMobileSongId !== songId) return
                audio.src = sourceUrl
                audio.currentTime = 0
                const shouldPlay = this.mobileIsPlaying || this.pendingMobilePlay
                this.pendingMobilePlay = false
                if (shouldPlay) {
                  this.mobileIsPlaying = true
                  void audio.play().catch((e) => {
                    console.warn('[RemoteClient] Mobile autoplay next song failed:', e)
                  })
                }
              })
            }

            this.currentState = {
              ...this.currentState,
              ...data,
              isPlaying: this.mobileIsPlaying,
              playbackState: this.mobileIsPlaying ? 'playing' : 'paused',
              position: this.mobileAudio?.currentTime ?? this.currentState.position,
              targetDevice: 'mobile'
            }
          } else {
            this.currentState = {
              ...this.currentState,
              ...data,
              targetDevice: 'desktop'
            }
          }

          this.notifyState()
        } catch (e) {
          console.error('Failed to parse SSE data:', e)
        }
      }

      this.eventSource.onerror = () => {
        this.isConnected = false
        this.notifyConnection()
        this.cleanupEventSource()
        this.scheduleReconnect()
      }
    } catch {
      this.isConnected = false
      this.notifyConnection()
      this.scheduleReconnect()
    }
  }

  public disconnect() {
    this.reconnectAttempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.cleanupEventSource()
    this.isConnected = false
    this.notifyConnection()
  }

  private cleanupEventSource() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  private reconnect() {
    this.disconnect()
    this.connect()
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = Math.min(30000, 3000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 6)))
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private notifyState() {
    this.stateListeners.forEach((fn) => fn(this.currentState))
  }

  private notifyConnection() {
    this.connectionListeners.forEach((fn) => fn(this.isConnected))
  }

  private notifyTarget() {
    this.targetListeners.forEach((fn) => fn(this.targetDevice))
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.getBaseUrl()}${endpoint}`
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...options.headers
    }

    try {
      const res = await fetch(url, { ...options, headers })
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}))
        throw new Error(errorBody.error || `HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err: any) {
      console.warn(`[RemoteClient] Error calling ${endpoint}:`, err)
      throw err
    }
  }

  // --- Playback Commands ---

  public async play(songId?: string, volumePercent?: number) {
    if (!this.isConnected) {
      const player = usePlayerStore.getState()
      if (songId) {
        const idx = player.queue.findIndex((s) => s.id === songId)
        if (idx !== -1) {
          player.playSong(idx)
        } else {
          player.setIsPlaying(true)
        }
      } else {
        player.setIsPlaying(true)
      }
      if (volumePercent !== undefined) {
        player.setVolume(Math.max(0, Math.min(100, volumePercent)) / 100)
      }
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      this.targetLockUntil = Date.now() + 4000
      // 1. Tell desktop to play
      try {
        await this.request('/v1/player/play', {
          method: 'POST',
          body: JSON.stringify({ song_id: songId, volume_percent: volumePercent })
        })
      } catch (e) {
        console.warn('[RemoteClient] Desktop play command failed:', e)
      }

      // 2. Start phone / browser audio
      const audio = this.initMobileAudio()
      const targetSongId = songId || this.currentState.song?.id
      if (targetSongId && targetSongId !== this.currentMobileSongId) {
        this.currentMobileSongId = targetSongId
        const targetPos = songId ? 0 : (this.currentState.position || 0)
        void this.prepareAudioSource(targetSongId).then((sourceUrl) => {
          if (this.targetDevice !== 'both' || this.currentMobileSongId !== targetSongId) return
          audio.src = sourceUrl
          const handleLoaded = () => {
            if (targetPos > 0) {
              audio.currentTime = targetPos
            }
            void audio.play().then(() => {
              this.mobileIsPlaying = true
              this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
              this.notifyState()
            }).catch((e) => {
              console.warn('[RemoteClient] Mobile audio play failed:', e)
            })
          }
          if (audio.readyState >= 1) {
            handleLoaded()
          } else {
            audio.addEventListener('loadedmetadata', handleLoaded, { once: true })
          }
        })
      } else {
        try {
          await audio.play()
          this.mobileIsPlaying = true
        } catch (e) {
          console.warn('[RemoteClient] Mobile audio play failed:', e)
        }
      }

      this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
      this.notifyState()
      return { ok: true }
    }

    if (this.targetDevice === 'mobile') {
      this.targetLockUntil = Date.now() + 4000
      const audio = this.initMobileAudio()
      const targetSongId = songId || this.currentState.song?.id

      if (targetSongId && targetSongId !== this.currentMobileSongId) {
        this.currentMobileSongId = targetSongId
        const targetPos = songId ? 0 : (this.currentState.position || 0)
        void this.prepareAudioSource(targetSongId).then((sourceUrl) => {
          if (this.targetDevice !== 'mobile' || this.currentMobileSongId !== targetSongId) return
          audio.src = sourceUrl
          const handleLoaded = () => {
            if (targetPos > 0) {
              audio.currentTime = targetPos
            }
            void audio.play().then(() => {
              this.mobileIsPlaying = true
              this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
              this.notifyState()
            }).catch((e) => {
              console.warn('[RemoteClient] Mobile audio play failed:', e)
            })
          }
          if (audio.readyState >= 1) {
            handleLoaded()
          } else {
            audio.addEventListener('loadedmetadata', handleLoaded, { once: true })
          }
        })
      } else {
        try {
          await audio.play()
          this.mobileIsPlaying = true
        } catch (e) {
          console.warn('[RemoteClient] Mobile audio play failed:', e)
        }
      }

      if (songId) {
        // Also tell desktop to sync current song metadata/queue while staying paused
        void this.request('/v1/player/play', {
          method: 'POST',
          body: JSON.stringify({ song_id: songId, volume_percent: volumePercent })
        }).then(() => {
          return this.request('/v1/player/pause', { method: 'POST', body: JSON.stringify({}) })
        }).catch(() => undefined)
      } else {
        // Ensure desktop stays paused
        void this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        }).catch(() => undefined)
      }

      this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
      this.notifyState()
      return { ok: true }
    }

    return this.request('/v1/player/play', {
      method: 'POST',
      body: JSON.stringify({ song_id: songId, volume_percent: volumePercent })
    })
  }

  public async pause() {
    if (!this.isConnected) {
      usePlayerStore.getState().setIsPlaying(false)
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      this.targetLockUntil = Date.now() + 4000
      try {
        await this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        })
      } catch {
        // ignore
      }

      if (this.mobileAudio) {
        this.mobileAudio.pause()
      }
      this.mobileIsPlaying = false
      this.currentState = { ...this.currentState, isPlaying: false, playbackState: 'paused' }
      this.notifyState()
      return { ok: true }
    }

    if (this.targetDevice === 'mobile') {
      this.targetLockUntil = Date.now() + 4000
      if (this.mobileAudio) {
        this.mobileAudio.pause()
      }
      this.mobileIsPlaying = false
      this.currentState = { ...this.currentState, isPlaying: false, playbackState: 'paused' }
      this.notifyState()
      return { ok: true }
    }

    return this.request('/v1/player/pause', {
      method: 'POST',
      body: JSON.stringify({})
    })
  }

  public async togglePlay() {
    if (!this.isConnected) {
      usePlayerStore.getState().togglePlay()
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      if (this.currentState.isPlaying || this.mobileIsPlaying) {
        return this.pause()
      } else {
        return this.play()
      }
    }

    if (this.targetDevice === 'mobile') {
      if (this.mobileIsPlaying) {
        return this.pause()
      } else {
        return this.play()
      }
    }

    if (this.currentState.isPlaying) {
      return this.pause()
    } else {
      return this.play()
    }
  }

  public async next() {
    if (!this.isConnected) {
      usePlayerStore.getState().playNext(true)
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      return this.request('/v1/player/next', {
        method: 'POST',
        body: JSON.stringify({})
      })
    }

    if (this.targetDevice === 'mobile') {
      this.targetLockUntil = Date.now() + 4000
      this.pendingMobilePlay = true
      // Advance desktop queue and pause desktop
      try {
        await this.request('/v1/player/next', {
          method: 'POST',
          body: JSON.stringify({})
        })
        await this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        })
      } catch {
        // ignore
      }
      return { ok: true }
    }

    return this.request('/v1/player/next', {
      method: 'POST',
      body: JSON.stringify({})
    })
  }

  public async previous() {
    if (!this.isConnected) {
      usePlayerStore.getState().playPrevious()
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      return this.request('/v1/player/previous', {
        method: 'POST',
        body: JSON.stringify({})
      })
    }

    if (this.targetDevice === 'mobile') {
      this.targetLockUntil = Date.now() + 4000
      this.pendingMobilePlay = true
      // Step back on desktop queue and pause desktop
      try {
        await this.request('/v1/player/previous', {
          method: 'POST',
          body: JSON.stringify({})
        })
        await this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        })
      } catch {
        // ignore
      }
      return { ok: true }
    }

    return this.request('/v1/player/previous', {
      method: 'POST',
      body: JSON.stringify({})
    })
  }

  public async seek(seconds: number) {
    const safeSeconds = Math.max(0, seconds)
    if (!this.isConnected) {
      usePlayerStore.getState().seek(safeSeconds)
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      if (this.mobileAudio) {
        this.mobileAudio.currentTime = safeSeconds
      }
      try {
        await this.request('/v1/player/seek', {
          method: 'POST',
          body: JSON.stringify({ seconds: safeSeconds })
        })
      } catch {
        // ignore
      }
      this.currentState = { ...this.currentState, position: safeSeconds }
      this.notifyState()
      return { ok: true }
    }

    if (this.targetDevice === 'mobile') {
      if (this.mobileAudio) {
        this.mobileAudio.currentTime = safeSeconds
      }
      this.currentState = { ...this.currentState, position: safeSeconds }
      this.notifyState()
      return { ok: true }
    }

    return this.request('/v1/player/seek', {
      method: 'POST',
      body: JSON.stringify({ seconds: safeSeconds })
    })
  }

  public async setVolume(percent: number) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)))
    if (!this.isConnected) {
      usePlayerStore.getState().setVolume(safePercent / 100)
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      if (this.mobileAudio) {
        this.mobileAudio.volume = safePercent / 100
      }
      this.currentState = {
        ...this.currentState,
        volume: safePercent / 100,
        volumePercent: safePercent
      }
      this.notifyState()
      return this.request('/v1/player/volume', {
        method: 'POST',
        body: JSON.stringify({ percent: safePercent })
      })
    }

    if (this.targetDevice === 'mobile') {
      if (this.mobileAudio) {
        this.mobileAudio.volume = safePercent / 100
      }
      this.currentState = {
        ...this.currentState,
        volume: safePercent / 100,
        volumePercent: safePercent
      }
      this.notifyState()
      return { ok: true }
    }

    return this.request('/v1/player/volume', {
      method: 'POST',
      body: JSON.stringify({ percent: safePercent })
    })
  }

  public async setMode(shuffle?: boolean, repeat?: 'off' | 'all' | 'one') {
    if (!this.isConnected) {
      const player = usePlayerStore.getState()
      if (shuffle !== undefined && player.isShuffle !== shuffle) {
        player.toggleShuffle()
      }
      if (repeat !== undefined && player.repeatMode !== repeat) {
        player.toggleRepeat()
        if (player.repeatMode !== repeat) {
          player.toggleRepeat()
        }
      }
      return { ok: true }
    }

    return this.request('/v1/player/mode', {
      method: 'POST',
      body: JSON.stringify({ shuffle, repeat })
    })
  }

  public async playIndex(index: number) {
    if (!this.isConnected) {
      usePlayerStore.getState().playSong(index)
      return { ok: true }
    }

    if (this.targetDevice === 'both') {
      return this.request('/v1/player/play-index', {
        method: 'POST',
        body: JSON.stringify({ index })
      })
    }

    if (this.targetDevice === 'mobile') {
      this.targetLockUntil = Date.now() + 4000
      this.pendingMobilePlay = true
      try {
        await this.request('/v1/player/play-index', {
          method: 'POST',
          body: JSON.stringify({ index })
        })
        await this.request('/v1/player/pause', {
          method: 'POST',
          body: JSON.stringify({})
        })
      } catch {
        // ignore
      }
      return { ok: true }
    }

    return this.request('/v1/player/play-index', {
      method: 'POST',
      body: JSON.stringify({ index })
    })
  }

  public async enqueue(songId: string) {
    return this.request('/v1/player/enqueue', {
      method: 'POST',
      body: JSON.stringify({ song_id: songId })
    })
  }

  public async removeFromQueue(songId: string) {
    return this.request('/v1/player/remove', {
      method: 'POST',
      body: JSON.stringify({ song_id: songId })
    })
  }

  public async getQueue(offset = 0, limit = 50) {
    return this.request(`/v1/player/queue?offset=${offset}&limit=${limit}&token=${encodeURIComponent(this.token)}`)
  }

  public async searchLibrary(query: string) {
    return this.request(
      `/v1/library/search?q=${encodeURIComponent(query)}&limit=25&token=${encodeURIComponent(this.token)}`
    )
  }

  public async getLyrics(songId: string): Promise<{ plainLyrics?: string; syncedLyrics?: string } | null> {
    try {
      return await this.request(`/v1/lyrics/${encodeURIComponent(songId)}?token=${encodeURIComponent(this.token)}`)
    } catch {
      return null
    }
  }

  public getFullArtworkUrl(pathOrUrl?: string): string {
    if (!pathOrUrl) return ''
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
    if (pathOrUrl.startsWith('/v1/artwork/')) {
      return `${this.getBaseUrl()}${pathOrUrl}`
    }
    return `${this.getBaseUrl()}/v1/artwork/${encodeURIComponent(pathOrUrl)}?token=${this.token}`
  }

  public getAudioStreamUrl(songId: string): string {
    return `${this.getBaseUrl()}/v1/audio/${encodeURIComponent(songId)}?token=${encodeURIComponent(this.token)}`
  }

  public getDownloadUrl(songId: string): string {
    return `${this.getBaseUrl()}/v1/download/${encodeURIComponent(songId)}?token=${encodeURIComponent(this.token)}`
  }

  public pauseMobileAudio(): void {
    if (this.mobileAudio && !this.mobileAudio.paused) {
      this.mobileAudio.pause()
      this.mobileIsPlaying = false
    }
  }

  public async downloadSong(
    songId: string,
    songTitle?: string,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    const url = this.getDownloadUrl(songId)
    const fileName = songTitle || this.currentState.song?.title || `Track-${songId}`
    return await downloadAudioFile(url, fileName, {
      trackId: songId,
      authToken: this.token,
      onProgress
    })
  }
}

export const remoteClient = new RemoteClient()
