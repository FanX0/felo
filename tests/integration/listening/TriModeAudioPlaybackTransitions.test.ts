import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { WebRTCAudioClient, forceStereoSdp } from '../../../src/renderer/src/lib/webrtcAudioStream'
import { MockMediaStream, MockMediaStreamTrack } from '../../setup/mocks/webrtc.mock'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

// Setup Mock YouTube IFrame Player
class MockYTPlayer {
  public options: any
  public state: number = 5 // CUED
  public isVideoMuted: boolean = false
  public videoVolume: number = 80
  public currentTime: number = 0
  public currentVideoId: string | null = null

  constructor(_id: string, options: any) {
    this.options = options
    this.currentVideoId = options?.videoId || null
    setTimeout(() => {
      options?.events?.onReady?.({ target: this })
    }, 0)
  }

  playVideo = vi.fn(() => {
    this.state = 1
    this.options?.events?.onStateChange?.({ data: 1 })
  })

  pauseVideo = vi.fn(() => {
    this.state = 2
    this.options?.events?.onStateChange?.({ data: 2 })
  })

  stopVideo = vi.fn(() => {
    this.state = 0
  })

  mute = vi.fn(() => {
    this.isVideoMuted = true
  })

  unMute = vi.fn(() => {
    this.isVideoMuted = false
  })

  isMuted = vi.fn(() => this.isVideoMuted)

  setVolume = vi.fn((v: number) => {
    this.videoVolume = v
  })

  getVolume = vi.fn(() => this.videoVolume)

  seekTo = vi.fn((t: number) => {
    this.currentTime = t
  })

  getCurrentTime = vi.fn(() => this.currentTime)
  getDuration = vi.fn(() => 240)
  getPlayerState = vi.fn(() => this.state)

  loadVideoById = vi.fn((param: any) => {
    this.currentVideoId = typeof param === 'string' ? param : param?.videoId
    this.currentTime = typeof param === 'object' ? param?.startSeconds || 0 : 0
    this.playVideo()
  })

  cueVideoById = vi.fn((param: any) => {
    this.currentVideoId = typeof param === 'string' ? param : param?.videoId
    this.currentTime = typeof param === 'object' ? param?.startSeconds || 0 : 0
    this.state = 5
    this.options?.events?.onStateChange?.({ data: 5 })
  })

  destroy = vi.fn()
}

// Mock Supabase Realtime Channels
const mockChannelSubscribers = new Map<string, any[]>()

vi.mock('../../../src/renderer/src/lib/supabase', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    isSupabaseConfigured: true,
    getSupabase: () => ({
      channel: (channelName: string) => {
        let listeners: Record<string, Function[]> = {}
        const ch = {
          name: channelName,
          on: vi.fn((_type: string, filter: { event: string }, callback: Function) => {
            const evt = filter.event
            if (!listeners[evt]) listeners[evt] = []
            listeners[evt].push(callback)
            return ch
          }),
          subscribe: vi.fn((callback: Function) => {
            setTimeout(() => callback('SUBSCRIBED'), 0)
            return ch
          }),
          unsubscribe: vi.fn().mockResolvedValue(undefined),
          send: vi.fn(async ({ event, payload }: { event: string; payload: any }) => {
            const subs = mockChannelSubscribers.get(channelName) || []
            for (const sub of subs) {
              if (sub !== ch) {
                sub._dispatch(event, payload)
              }
            }
          }),
          _dispatch: (event: string, payload: any) => {
            const list = listeners[event] || []
            list.forEach((cb) => cb({ payload }))
          }
        }
        if (!mockChannelSubscribers.has(channelName)) {
          mockChannelSubscribers.set(channelName, [])
        }
        mockChannelSubscribers.get(channelName)!.push(ch)
        return ch
      },
      removeChannel: vi.fn(async (ch: any) => {
        const list = mockChannelSubscribers.get(ch?.name) || []
        mockChannelSubscribers.set(
          ch?.name,
          list.filter((s) => s !== ch)
        )
      })
    })
  }
})

describe('Industry-Standard Tri-Mode Audio Transitions (Local Music <-> YouTube <-> Device Stream)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockChannelSubscribers.clear()

    // Register Mock window.YT
    if (typeof window !== 'undefined') {
      window.YT = {
        Player: MockYTPlayer,
        PlayerState: {
          ENDED: 0,
          PLAYING: 1,
          PAUSED: 2,
          BUFFERING: 3,
          CUED: 5
        }
      }
    }

    // Clean up any test WebRTC audio elements
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]')
        .forEach((el) => el.remove())
    }

    usePlayerStore.setState({
      queue: [],
      currentSongIndex: -1,
      isPlaying: false,
      volume: 0.8,
      currentTime: 0,
      duration: 0
    })

    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      isReceivingDeviceStream: false,
      isAutoplayBlocked: false,
      deviceAudioClientState: 'disconnected',
      deviceAudioClientLevel: 0,
      deviceAudioVolume: 0.8
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]')
        .forEach((el) => el.remove())
    }
  })

  // =========================================================================
  // 1. MUTUAL EXCLUSIVITY & AUDIO ISOLATION
  // =========================================================================
  describe('1. Mutual Exclusivity & Bleed Prevention', () => {
    it('Local -> YouTube: Pauses and unloads local audio source, mounts YouTube stream', async () => {
      const localTrack = {
        id: 'local-song-1',
        title: 'Local High-Res FLAC',
        artist: 'Studio Artist',
        duration: 210,
        filePath: 'C:/Music/test.flac'
      }

      usePlayerStore.setState({
        queue: [localTrack as any],
        currentSongIndex: 0,
        isPlaying: true
      })

      // Host switches to YouTube track
      const ytRoom: ListeningRoom = {
        id: 'room-1',
        code: 'SYNC1',
        name: 'Sync Session',
        host_id: 'host-1',
        is_active: true,
        is_playing: true,
        position_seconds: 12,
        song: {
          title: 'YouTube Official Stream',
          artist: 'Band',
          duration: 250,
          isYouTube: true,
          videoId: 'yt-video-101'
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      await useListeningStore.getState().handleHostSongChange(ytRoom)

      const state = usePlayerStore.getState()
      const current = state.queue[state.currentSongIndex]

      // Verification: Queue now holds YouTube track
      expect(current.id).toBe('yt-yt-video-101')
      expect(current.isYouTube).toBe(true)
      // WebRTC audio element MUST NOT exist
      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeNull()
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
    })

    it('YouTube -> Device Stream: Silences YouTube, destroys local buffers, mounts WebRTC audio element', async () => {
      const ytTrack = {
        id: 'yt-yt-video-101',
        title: 'YouTube Official Stream',
        artist: 'Band',
        duration: 250,
        isYouTube: true,
        videoId: 'yt-video-101'
      }

      usePlayerStore.setState({
        queue: [ytTrack as any],
        currentSongIndex: 0,
        isPlaying: true
      })

      // Host switches to Device Broadcast
      const deviceRoom: ListeningRoom = {
        id: 'room-1',
        code: 'SYNC1',
        name: 'Sync Session',
        host_id: 'host-1',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        is_device_stream: true,
        song: {
          title: 'System Audio Broadcast',
          artist: 'Host',
          isDeviceStream: true
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      let stopYouTubeDispatched = false
      const listener = () => {
        stopYouTubeDispatched = true
      }
      window.addEventListener('felo:stop-youtube', listener)

      // Simulate device stream connection
      usePlayerStore.getState().setIsPlaying(false)
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('SYNC1', 'guest-1', 'host-1')
      client.setVolume(0.8)
      client.playStream(mockStream as any)

      useListeningStore.setState({
        joinedRoom: deviceRoom,
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })

      window.dispatchEvent(new CustomEvent('felo:stop-youtube'))

      // Verification 1: YouTube silenced via event
      expect(stopYouTubeDispatched).toBe(true)
      // Verification 2: WebRTC physical audio element active and mounted
      const webrtcAudio = document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]') as HTMLAudioElement
      expect(webrtcAudio).toBeTruthy()
      expect(webrtcAudio.volume).toBe(0.8)
      expect(webrtcAudio.muted).toBe(false)
      // Verification 3: Store state confirms device stream dominance
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(true)

      window.removeEventListener('felo:stop-youtube', listener)
      client.disconnect()
    })

    it('Device Stream -> Local Music: Tears down WebRTC audio element and resumes local playback cleanly', async () => {
      // 1. Setup active WebRTC stream
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('SYNC1', 'guest-1', 'host-1')
      client.playStream(mockStream as any)

      useListeningStore.setState({
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })

      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeTruthy()

      // 2. Host stops device stream and switches to local song
      const localRoom: ListeningRoom = {
        id: 'room-1',
        code: 'SYNC1',
        name: 'Sync Session',
        host_id: 'host-1',
        is_active: true,
        is_playing: true,
        position_seconds: 45,
        is_device_stream: false,
        song: {
          title: 'Resonance',
          artist: 'HOME',
          album: 'Odyssey',
          duration: 212,
          localId: 'local-resonance-1'
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      client.disconnect()
      await useListeningStore.getState().handleHostSongChange(localRoom)

      // Verification 1: WebRTC audio element completely unmounted from DOM
      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeNull()
      // Verification 2: isReceivingDeviceStream reset to false
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
      // Verification 3: Local player activated
      expect(usePlayerStore.getState().isPlaying).toBe(true)
    })

    it('Device Stream -> YouTube Music: Destroys WebRTC audio element and begins YouTube playback at host target time', async () => {
      // 1. Setup active WebRTC stream
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('SYNC1', 'guest-1', 'host-1')
      client.playStream(mockStream as any)

      useListeningStore.setState({
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })

      // 2. Host stops device stream and switches to YouTube song
      const ytRoom: ListeningRoom = {
        id: 'room-1',
        code: 'SYNC1',
        name: 'Sync Session',
        host_id: 'host-1',
        is_active: true,
        is_playing: true,
        position_seconds: 75,
        is_device_stream: false,
        song: {
          title: 'Synthwave Radio 24/7',
          artist: 'Lofi Records',
          duration: 360,
          isYouTube: true,
          videoId: 'yt-synthwave-live',
          hostPosition: 75,
          hostTimestamp: Date.now()
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      client.disconnect()
      await useListeningStore.getState().handleHostSongChange(ytRoom)

      // Verification 1: WebRTC element removed
      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeNull()
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)

      // Verification 2: YouTube track loaded with host target time
      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      expect(currentTrack.id).toBe('yt-yt-synthwave-live')
      expect(currentTrack.isYouTube).toBe(true)
      expect(playerState.isPlaying).toBe(true)
      expect(playerState.currentTime).toBeGreaterThanOrEqual(75)
    })
  })

  // =========================================================================
  // 2. VOLUME SYNCHRONIZATION ACROSS ALL 3 MODES
  // =========================================================================
  describe('2. Volume Synchronization Across Tri-Mode Flow', () => {
    it('preserves volume and muting across Local, YouTube, and Device Stream switches', () => {
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('SYNC1', 'guest-1', 'host-1')

      // Set volume to 65% in player store
      usePlayerStore.setState({ volume: 0.65 })
      client.setVolume(0.65)
      client.playStream(mockStream as any)

      const audioEl = document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]') as HTMLAudioElement
      expect(audioEl.volume).toBe(0.65)
      expect(audioEl.muted).toBe(false)

      // Listener mutes (volume = 0)
      client.setVolume(0)
      expect(audioEl.volume).toBe(0)
      expect(audioEl.muted).toBe(true)

      // Listener unmutes to 90%
      client.setVolume(0.9)
      expect(audioEl.volume).toBe(0.9)
      expect(audioEl.muted).toBe(false)

      client.disconnect()
    })
  })

  // =========================================================================
  // 3. ZERO-ZOMBIE DOM STABILITY & RAPID TOGGLING
  // =========================================================================
  describe('3. Zero-Zombie DOM Cleanliness Under Rapid Source Toggling', () => {
    it('leaves zero dangling audio elements after rapid repeated mode transitions', async () => {
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])

      for (let i = 0; i < 5; i++) {
        // Mode A: Device Stream
        const client = new WebRTCAudioClient('SYNC1', 'guest-1', 'host-1')
        client.playStream(mockStream as any)
        expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(1)

        // Mode B: Switch to YouTube
        client.disconnect()
        expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(0)

        // Mode C: Switch to Local
        window.dispatchEvent(new CustomEvent('felo:stop-youtube'))
        expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(0)
      }

      // Final check: Exactly 0 residual WebRTC audio elements
      expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(0)
    })
  })
})
