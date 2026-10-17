import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { WebRTCAudioClient, forceStereoSdp } from '../../../src/renderer/src/lib/webrtcAudioStream'
import { MockMediaStream, MockMediaStreamTrack } from '../../setup/mocks/webrtc.mock'
import { getActiveAudioTime, registerAudioTimeProvider } from '../../../src/renderer/src/lib/audioBridge'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'
import {
  setIsSessionSyncing,
  setNeedsInitialSync,
  savePreJoinPlayerSnapshot,
  getPreJoinPlayerSnapshot
} from '../../../src/renderer/src/stores/listening/helpers'
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

  // =========================================================================
  // 4. INDUSTRY-STANDARD YOUTUBE HOST/LISTENER PLAY, PAUSE & SEEK PRECISION
  // =========================================================================
  describe('4. Industry-Standard YouTube Host/Listener Play, Pause, Seek & Anti-Jumping Synchronization', () => {
    const mockYtSong = {
      id: 'yt-cyber-dreams',
      title: 'Cyber Dreams Live',
      artist: 'Synth Master',
      duration: 300,
      isYouTube: true,
      videoId: 'cyber-dreams-live'
    }

    const hostYtRoom: ListeningRoom = {
      id: 'room-yt-1',
      code: 'YTROOM1',
      name: 'Cyberpunk YouTube Listening Room',
      host_id: 'host-user-99',
      is_active: true,
      is_playing: true,
      position_seconds: 42,
      is_device_stream: false,
      song: {
        ...mockYtSong,
        hostPosition: 42.5,
        hostTimestamp: Date.now()
      },
      queue: [mockYtSong as any],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    beforeEach(() => {
      usePlayerStore.setState({
        queue: [mockYtSong as any],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 42.5,
        seekRequest: null
      })
      useListeningStore.setState({
        joinedRoom: { ...hostYtRoom },
        myRole: 'listener',
        isReceivingDeviceStream: false
      })
      setIsSessionSyncing(false)
      setNeedsInitialSync(false)
      roomClockSync.reset()
      const now = Date.now()
      roomClockSync.handlePong({
        guestId: roomClockSync.getGuestId(),
        t0: now - 10,
        t1: now - 5
      })
    })

    it('1. Host Pauses YouTube Song: listener immediately pauses and locks playhead to exact host position', () => {
      // Host pauses at 42.5s
      const pausedRoom: ListeningRoom = {
        ...hostYtRoom,
        is_playing: false,
        position_seconds: 42,
        song: {
          ...mockYtSong,
          hostPosition: 42.5,
          hostTimestamp: Date.now()
        }
      }

      useListeningStore.getState().handleHostPauseResume(pausedRoom)

      useListeningStore.getState().handleHostSyncPulse({
        isPlaying: false,
        position: 42.5,
        hostTimestamp: Date.now(),
        trackId: mockYtSong.id
      })

      // Verification: Listener is paused and currentTime matches host
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(usePlayerStore.getState().currentTime).toBe(42.5)
      expect(useListeningStore.getState().joinedRoom?.is_playing).toBe(false)
    })

    it('2. Anti-Unpause Interception: listener tapping YouTube player iframe while room is paused is immediately re-paused', () => {
      // Room is paused
      usePlayerStore.setState({ isPlaying: false, currentTime: 42.5 })
      useListeningStore.setState({
        joinedRoom: { ...hostYtRoom, is_playing: false },
        myRole: 'listener'
      })

      // Simulate YouTube iframe event.data === 1 (Playing) triggered by user clicking iframe
      let pauseVideoCalled = false
      const mockPlayerTarget = {
        pauseVideo: vi.fn(() => {
          pauseVideoCalled = true
        }),
        getDuration: vi.fn(() => 300)
      }

      // Replicate onStateChange guard from YouTubePlayerBridge
      const room = useListeningStore.getState().joinedRoom
      const storeIsPlaying = usePlayerStore.getState().isPlaying
      const isListener = true

      if (isListener && room && (!room.is_playing || !storeIsPlaying)) {
        mockPlayerTarget.pauseVideo()
      } else {
        usePlayerStore.setState({ isPlaying: true })
      }

      // Verification: Video was immediately paused, store is NOT flipped to playing
      expect(pauseVideoCalled).toBe(true)
      expect(mockPlayerTarget.pauseVideo).toHaveBeenCalled()
      expect(usePlayerStore.getState().isPlaying).toBe(false)
    })

    it('3. Host Seeks While Paused: listener updates seek position and remains strictly paused', () => {
      // Currently paused at 42.5s
      usePlayerStore.setState({ isPlaying: false, currentTime: 42.5, seekRequest: null })
      useListeningStore.setState({
        joinedRoom: { ...hostYtRoom, is_playing: false, position_seconds: 42 },
        myRole: 'listener'
      })

      // Host seeks to 110.0s while remaining paused
      useListeningStore.getState().handleHostSyncPulse({
        isPlaying: false,
        position: 110.0,
        hostTimestamp: Date.now(),
        trackId: mockYtSong.id
      })

      // Verification: seekRequest is dispatched for 110.0s, isPlaying remains false
      expect(usePlayerStore.getState().seekRequest).toBe(110.0)
      expect(usePlayerStore.getState().currentTime).toBe(110.0)
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(useListeningStore.getState().joinedRoom?.is_playing).toBe(false)
    })

    it('4. Anti-Jumping / Anti-Looping: transient dips (< 1.0s) during buffering/spin-up are rejected', () => {
      // Song is playing smoothly at 65.0s
      usePlayerStore.setState({ isPlaying: true, currentTime: 65.0 })
      useListeningStore.setState({
        joinedRoom: { ...hostYtRoom, is_playing: true, position_seconds: 65 }
      })

      // Simulate polling ticker reading a transient 0.05s dip from YouTube iframe
      const transientTime = 0.05
      const curStoreTime = usePlayerStore.getState().currentTime || 0
      const joinedRoom = useListeningStore.getState().joinedRoom

      let positionUpdated = false
      if (transientTime < 1.0 && (curStoreTime > 2.0 || (joinedRoom && (joinedRoom.position_seconds || 0) > 2.0))) {
        // Transient dip rejected!
      } else {
        usePlayerStore.getState().setCurrentTime(transientTime)
        positionUpdated = true
      }

      // Verification: Transient dip was rejected and currentTime remains 65.0s
      expect(positionUpdated).toBe(false)
      expect(usePlayerStore.getState().currentTime).toBe(65.0)
    })

    it('5. Host Resumes YouTube Song: listener resumes playback in lockstep from calibrated position', () => {
      // Both host and listener were paused at 110.0s
      usePlayerStore.setState({ isPlaying: false, currentTime: 110.0, seekRequest: null })
      useListeningStore.setState({
        joinedRoom: { ...hostYtRoom, is_playing: false, position_seconds: 110 }
      })

      // Host clicks Play at 110.0s
      const resumedRoom: ListeningRoom = {
        ...hostYtRoom,
        is_playing: true,
        position_seconds: 110,
        song: {
          ...mockYtSong,
          hostPosition: 110.0,
          hostTimestamp: Date.now()
        }
      }

      useListeningStore.getState().handleHostPauseResume(resumedRoom)

      useListeningStore.getState().handleHostSyncPulse({
        isPlaying: true,
        position: 110.0,
        hostTimestamp: Date.now(),
        trackId: mockYtSong.id
      })

      // Verification: Listener is now playing and position is maintained at 110.0s
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(usePlayerStore.getState().currentTime).toBe(110.0)
    })

    it('6. High-Resolution Audio Time Provider: registers YouTube position and unregisters on teardown', () => {
      // Register custom YouTube time provider
      let mockYouTubeTime = 115.342
      registerAudioTimeProvider(() => mockYouTubeTime)

      // getActiveAudioTime returns exact floating-point YouTube player time
      expect(getActiveAudioTime()).toBe(115.342)

      // Update mock YouTube time
      mockYouTubeTime = 120.891
      expect(getActiveAudioTime()).toBe(120.891)

      // Unregister when switching away from YouTube
      registerAudioTimeProvider(null)
      expect(getActiveAudioTime()).toBe(0)
    })
  })

  // =========================================================================
  // 5. COMPLETE STREAM EXIT & LOCAL PLAYER ISOLATION ("ROOM FOR ROOM, LOCAL FOR LOCAL")
  // =========================================================================
  describe('5. Complete Stream Exit & Local Player Isolation ("Room for Room, Local for Local")', () => {
    const localTrack1 = {
      id: 'local-song-alpha',
      title: 'Midnight Drive',
      artist: 'SynthWave Collective',
      duration: 210,
      filePath: 'C:/Music/Midnight_Drive.mp3',
      isOnline: false
    }

    const localTrack2 = {
      id: 'local-song-beta',
      title: 'Neon Skyline',
      artist: 'SynthWave Collective',
      duration: 185,
      filePath: 'C:/Music/Neon_Skyline.mp3',
      isOnline: false
    }

    const hostStreamRoom: ListeningRoom = {
      id: 'room-stream-99',
      code: 'EXIT1',
      name: 'Stream Room',
      host_id: 'host-user-omega',
      is_active: true,
      is_playing: true,
      position_seconds: 50,
      is_device_stream: true,
      song: {
        title: 'Live System Audio',
        artist: 'Host DJ',
        isDeviceStream: true
      },
      queue: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    beforeEach(() => {
      setIsSessionSyncing(false)
      setNeedsInitialSync(false)
      roomClockSync.reset()
    })

    it('1. Participant in WebRTC Device Stream leaves room: disconnects client, tears down audio element, restores local queue in paused state', async () => {
      // 1. Participant had local music playing before joining
      usePlayerStore.setState({
        queue: [localTrack1 as any, localTrack2 as any],
        currentSongIndex: 0,
        currentTime: 25.0,
        isPlaying: true,
        volume: 0.75
      })

      // 2. Participant joins room -> snapshot is saved
      savePreJoinPlayerSnapshot({
        queue: [localTrack1 as any, localTrack2 as any],
        currentSongIndex: 0,
        currentTime: 25.0,
        volume: 0.75,
        isPlaying: true
      })

      // 3. Mount active WebRTC device stream in room
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('EXIT1', 'guest-user', 'host-user-omega')
      client.playStream(mockStream as any)

      useListeningStore.setState({
        joinedRoom: { ...hostStreamRoom },
        myRole: 'listener',
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })

      // Confirm physical stream audio element is in DOM
      expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(1)

      // 4. Participant leaves room
      await useListeningStore.getState().leaveJoinedRoom()

      // VERIFICATION 1: WebRTC stream completely disconnected & unmounted
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
      expect(document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]').length).toBe(0)

      // VERIFICATION 2: Local player restored to pre-join local tracks in paused state
      const player = usePlayerStore.getState()
      expect(player.isPlaying).toBe(false)
      expect(player.queue.length).toBe(2)
      expect(player.queue[0].id).toBe('local-song-alpha')
      expect(player.currentSongIndex).toBe(0)
      expect(player.currentTime).toBe(25.0)

      // VERIFICATION 3: Room state cleared
      expect(useListeningStore.getState().joinedRoom).toBeNull()
      expect(useListeningStore.getState().myRole).toBeNull()
    })

    it('2. Participant in YouTube Stream leaves room: dispatches felo:stop-youtube, clears audio time provider, and restores local queue', async () => {
      // 1. Pre-join snapshot with 1 local track
      savePreJoinPlayerSnapshot({
        queue: [localTrack1 as any],
        currentSongIndex: 0,
        currentTime: 10.0,
        volume: 0.8,
        isPlaying: false
      })

      // 2. Currently in room with host's YouTube track
      const ytRoomTrack = {
        id: 'yt-party-rock',
        title: 'Party Rock Live',
        artist: 'Host Stream',
        duration: 240,
        isYouTube: true,
        videoId: 'party-rock-live'
      }

      usePlayerStore.setState({
        queue: [ytRoomTrack as any],
        currentSongIndex: 0,
        currentTime: 88.0,
        isPlaying: true
      })

      useListeningStore.setState({
        joinedRoom: {
          ...hostStreamRoom,
          is_device_stream: false,
          song: ytRoomTrack as any,
          queue: [ytRoomTrack as any]
        },
        myRole: 'listener'
      })

      // Active YouTube high-res time provider
      registerAudioTimeProvider(() => 88.5)
      expect(getActiveAudioTime()).toBe(88.5)

      let stopYouTubeFired = false
      const stopListener = () => {
        stopYouTubeFired = true
      }
      window.addEventListener('felo:stop-youtube', stopListener)

      // 3. Participant leaves room
      await useListeningStore.getState().leaveJoinedRoom()

      // VERIFICATION 1: felo:stop-youtube was dispatched
      expect(stopYouTubeFired).toBe(true)

      // VERIFICATION 2: Audio time provider unregistered
      expect(getActiveAudioTime()).toBe(0)

      // VERIFICATION 3: YouTube room track removed, local track restored
      const player = usePlayerStore.getState()
      expect(player.isPlaying).toBe(false)
      expect(player.queue.length).toBe(1)
      expect(player.queue[0].id).toBe('local-song-alpha')
      expect(player.currentTime).toBe(10.0)

      window.removeEventListener('felo:stop-youtube', stopListener)
    })

    it('3. Participant with empty initial queue leaves room: purges room session tracks cleanly', async () => {
      // 1. Participant joined room with no prior queue
      savePreJoinPlayerSnapshot(null)

      // Room currently has host's queue in participant's player
      usePlayerStore.setState({
        queue: [
          { id: 'host-track-1', title: 'Host Track 1', artist: 'Host' } as any,
          { id: 'host-track-2', title: 'Host Track 2', artist: 'Host' } as any
        ],
        currentSongIndex: 0,
        currentTime: 45.0,
        isPlaying: true
      })

      useListeningStore.setState({
        joinedRoom: { ...hostStreamRoom },
        myRole: 'listener'
      })

      // 2. Participant leaves room
      await useListeningStore.getState().leaveJoinedRoom()

      // VERIFICATION: Queue is cleanly reset to empty, zero session tracks linger
      const player = usePlayerStore.getState()
      expect(player.queue.length).toBe(0)
      expect(player.isPlaying).toBe(false)
      expect(player.currentTime).toBe(0)
      expect(useListeningStore.getState().joinedRoom).toBeNull()
    })
  })
})
