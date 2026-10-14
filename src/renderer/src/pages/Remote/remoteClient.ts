export interface RemotePlayerSong {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artworkUrl?: string
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
  private isConnected = false

  // Playback output target: 'desktop', 'mobile', or 'both' (dual synchronized playback)
  private targetDevice: PlaybackTarget = 'desktop'
  private mobileAudio: HTMLAudioElement | null = null
  private mobileIsPlaying = false
  private currentMobileSongId: string | null = null

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
            isPlaying: data.isPlaying || this.mobileIsPlaying,
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

  public getTargetDevice(): PlaybackTarget {
    return this.targetDevice
  }

  public async setTargetDevice(target: PlaybackTarget): Promise<void> {
    if (this.targetDevice === target) return
    this.targetDevice = target
    this.currentState.targetDevice = target
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
        audio.src = this.getAudioStreamUrl(currentSong.id)
        audio.currentTime = currentPos
        if (wasPlaying) {
          try {
            await audio.play()
          } catch (e) {
            console.warn('[RemoteClient] Autoplay prevented, waiting for user click:', e)
          }
        }
      }
    } else if (target === 'both') {
      // 2. Target: PLAY ON BOTH (Dual Playback)
      // Resume desktop playback AND start phone/browser audio at current position
      const audio = this.initMobileAudio()

      if (currentSong?.id) {
        this.currentMobileSongId = currentSong.id
        audio.src = this.getAudioStreamUrl(currentSong.id)
        audio.currentTime = currentPos
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

        try {
          await audio.play()
          this.mobileIsPlaying = true
        } catch (e) {
          console.warn('[RemoteClient] Both target mobile audio autoplay prevented:', e)
        }
      }
    } else {
      // 3. Target: DESKTOP ONLY
      // Pause mobile audio and resume desktop playback at current time
      if (this.mobileAudio) {
        const currentPos = this.mobileAudio.currentTime
        const wasPlaying = this.mobileIsPlaying
        this.mobileAudio.pause()
        this.mobileIsPlaying = false

        if (wasPlaying && this.currentState.song) {
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

    const url = `${this.getBaseUrl()}/v1/events?token=${encodeURIComponent(this.token)}`

    try {
      this.eventSource = new EventSource(url)

      this.eventSource.onopen = () => {
        this.isConnected = true
        this.notifyConnection()
      }

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (this.targetDevice === 'both') {
            // Target: PLAY ON BOTH (Dual Playback Sync)
            if (data.song?.id && data.song.id !== this.currentMobileSongId) {
              this.currentMobileSongId = data.song.id
              const audio = this.initMobileAudio()
              audio.src = this.getAudioStreamUrl(data.song.id)
              audio.currentTime = data.position || 0
              if (data.isPlaying) {
                void audio.play().catch(() => undefined)
              }
            } else if (this.mobileAudio) {
              if (data.isPlaying && this.mobileAudio.paused) {
                void this.mobileAudio.play().catch(() => undefined)
              } else if (!data.isPlaying && !this.mobileAudio.paused) {
                this.mobileAudio.pause()
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
            // If phone target is active and desktop starts playing, ensure desktop stays paused
            if (data.isPlaying) {
              void this.request('/v1/player/pause', {
                method: 'POST',
                body: JSON.stringify({})
              }).catch(() => undefined)
            }

            // Detect if desktop queue advanced or changed song
            if (data.song?.id && data.song.id !== this.currentMobileSongId) {
              this.currentMobileSongId = data.song.id
              const audio = this.initMobileAudio()
              audio.src = this.getAudioStreamUrl(data.song.id)
              audio.currentTime = 0
              if (this.mobileIsPlaying) {
                void audio.play().catch(() => undefined)
              }
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
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
    if (this.targetDevice === 'both') {
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
        audio.src = this.getAudioStreamUrl(targetSongId)
        audio.currentTime = this.currentState.position || 0
      }
      try {
        await audio.play()
        this.mobileIsPlaying = true
      } catch (e) {
        console.warn('[RemoteClient] Mobile audio play failed:', e)
      }

      this.currentState = { ...this.currentState, isPlaying: true, playbackState: 'playing' }
      this.notifyState()
      return { ok: true }
    }

    if (this.targetDevice === 'mobile') {
      const audio = this.initMobileAudio()
      if (songId) {
        this.currentMobileSongId = songId
        audio.src = this.getAudioStreamUrl(songId)
        audio.currentTime = 0
        // Also tell desktop to sync current song metadata/queue while staying paused
        void this.request('/v1/player/play', {
          method: 'POST',
          body: JSON.stringify({ song_id: songId, volume_percent: volumePercent })
        }).then(() => {
          return this.request('/v1/player/pause', { method: 'POST', body: JSON.stringify({}) })
        }).catch(() => undefined)
      }
      await audio.play()
      this.mobileIsPlaying = true
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
    if (this.targetDevice === 'both') {
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
    if (this.targetDevice === 'both') {
      return this.request('/v1/player/next', {
        method: 'POST',
        body: JSON.stringify({})
      })
    }

    if (this.targetDevice === 'mobile') {
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
    if (this.targetDevice === 'both') {
      return this.request('/v1/player/previous', {
        method: 'POST',
        body: JSON.stringify({})
      })
    }

    if (this.targetDevice === 'mobile') {
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
    return this.request('/v1/player/mode', {
      method: 'POST',
      body: JSON.stringify({ shuffle, repeat })
    })
  }

  public async playIndex(index: number) {
    if (this.targetDevice === 'both') {
      return this.request('/v1/player/play-index', {
        method: 'POST',
        body: JSON.stringify({ index })
      })
    }

    if (this.targetDevice === 'mobile') {
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

  public downloadSong(songId: string): void {
    const url = this.getDownloadUrl(songId)
    const a = document.createElement('a')
    a.href = url
    a.setAttribute('download', '')
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

export const remoteClient = new RemoteClient()
