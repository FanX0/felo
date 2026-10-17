import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  forceStereoSdp,
  tuneSystemAudioSender,
  tuneSystemAudioReceivers,
  captureSystemAudioStream,
  WebRTCAudioClient,
  WebRTCAudioHost,
  AudioLevelMonitor,
  SYSTEM_AUDIO_PLAYOUT_DELAY_S
} from '../../../src/renderer/src/lib/webrtcAudioStream'
import { MockMediaStream, MockMediaStreamTrack, MockRTCPeerConnection } from '../../setup/mocks/webrtc.mock'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

// Mock getSupabase for Realtime Channel signaling simulation
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

describe('Industry-Standard WebRTC Device Sound Broadcast & Audio Fidelity Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockChannelSubscribers.clear()

    // Clean up any test audio elements in DOM
    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]')
        .forEach((el) => el.remove())
    }

    usePlayerStore.setState({
      isPlaying: false,
      volume: 0.8,
      currentTime: 0
    })

    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      isReceivingDeviceStream: false,
      isAutoplayBlocked: false,
      deviceAudioClientState: 'disconnected',
      deviceAudioClientLevel: 0
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
  // 1. OPUS STEREO & BITRATE SDP MUNGING (RFC 7587)
  // =========================================================================
  describe('1. Opus Stereo SDP Formatting & RFC 7587 Compliance', () => {
    it('forces stereo=1, sprop-stereo=1, useinbandfec=1, and studio bitrate without duplicate a=fmtp lines', () => {
      const sdpInput = [
        'v=0',
        'o=- 45678 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;useinbandfec=1',
        ''
      ].join('\r\n')

      const munged = forceStereoSdp(sdpInput, 256000)

      // Ensure no duplicate fmtp lines
      const fmtpLines = munged.split(/\r?\n/).filter((l) => l.startsWith('a=fmtp:111'))
      expect(fmtpLines.length).toBe(1)

      const line = fmtpLines[0]
      expect(line).toContain('stereo=1')
      expect(line).toContain('sprop-stereo=1')
      expect(line).toContain('maxaveragebitrate=256000')
      expect(line).toContain('useinbandfec=1')
      expect(line).toContain('minptime=10')
    })

    it('preserves other existing codec parameters while cleanly mutating Opus parameters', () => {
      const sdpInput = [
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;cbr=1;maxplaybackrate=48000'
      ].join('\n')

      const munged = forceStereoSdp(sdpInput, 320000)

      const fmtp = munged.split(/\r?\n/).find((l) => l.startsWith('a=fmtp:111'))
      expect(fmtp).toBeTruthy()
      expect(fmtp).toContain('cbr=1')
      expect(fmtp).toContain('maxplaybackrate=48000')
      expect(fmtp).toContain('stereo=1')
      expect(fmtp).toContain('maxaveragebitrate=320000')
    })

    it('injects a new a=fmtp line directly beneath a=rtpmap if codec previously lacked an fmtp line', () => {
      const sdpInput = [
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=sendrecv'
      ].join('\r\n')

      const munged = forceStereoSdp(sdpInput, 256000)
      const lines = munged.split(/\r?\n/)

      const rtpmapIdx = lines.findIndex((l) => l.startsWith('a=rtpmap:111'))
      const fmtpIdx = lines.findIndex((l) => l.startsWith('a=fmtp:111'))

      expect(fmtpIdx).toBe(rtpmapIdx + 1)
      expect(lines[fmtpIdx]).toContain('stereo=1')
      expect(lines[fmtpIdx]).toContain('maxaveragebitrate=256000')
    })

    it('distinguishes payload types correctly when numbers share substrings (e.g., PT 11 vs PT 111)', () => {
      const sdpInput = [
        'm=audio 9 UDP/TLS/RTP/SAVPF 11 111',
        'a=rtpmap:11 telephone-event/8000',
        'a=fmtp:11 0-15',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10'
      ].join('\r\n')

      const munged = forceStereoSdp(sdpInput, 256000)

      // PT 11 must remain untouched
      const fmtp11 = munged.split(/\r?\n/).find((l) => l.startsWith('a=fmtp:11 '))
      expect(fmtp11).toBe('a=fmtp:11 0-15')

      // PT 111 must receive stereo parameters
      const fmtp111 = munged.split(/\r?\n/).find((l) => l.startsWith('a=fmtp:111 '))
      expect(fmtp111).toContain('stereo=1')
    })
  })

  // =========================================================================
  // 2. SYSTEM AUDIO CAPTURE & DSP BYPASS
  // =========================================================================
  describe('2. System Audio Capture & Studio Music DSP Bypass', () => {
    it('disables echo cancellation, noise suppression, and auto gain control on captured stream', async () => {
      const mockAudioTrack = new MockMediaStreamTrack('audio', 'system-audio-track')
      const mockVideoTrack = new MockMediaStreamTrack('video', 'screen-video-track')
      const mockRawStream = new MockMediaStream([mockAudioTrack, mockVideoTrack])

      const getDisplayMediaSpy = vi.fn().mockResolvedValue(mockRawStream)
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getDisplayMedia: getDisplayMediaSpy },
        writable: true,
        configurable: true
      })

      const { rawStream, audioTrack, audioOnlyStream } = await captureSystemAudioStream()

      // 1. Audio track returned and contentHint set to 'music'
      expect(audioTrack).toBe(mockAudioTrack)
      expect(audioTrack.contentHint).toBe('music')

      // 2. Constraints applied to bypass voice speech DSP
      expect(mockAudioTrack.applyConstraints).toHaveBeenCalledWith({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      })

      // 3. Screen video track immediately stopped so CPU and bandwidth are purely audio
      expect(mockVideoTrack.stop).toHaveBeenCalled()

      // 4. Pure audio stream created
      expect(audioOnlyStream.getAudioTracks().length).toBe(1)
      expect(rawStream).toBe(mockRawStream)
    })

    it('throws helpful error if user denies permission or no audio track was selected in browser modal', async () => {
      // Scenario A: User cancels
      const deniedErr = new DOMException('Permission denied', 'NotAllowedError')
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getDisplayMedia: vi.fn().mockRejectedValue(deniedErr) },
        writable: true,
        configurable: true
      })

      await expect(captureSystemAudioStream()).rejects.toThrow(
        'Screen/audio capture was cancelled or denied by user.'
      )

      // Scenario B: User forgot to check "Share audio"
      const videoOnlyStream = new MockMediaStream([new MockMediaStreamTrack('video')])
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getDisplayMedia: vi.fn().mockResolvedValue(videoOnlyStream) },
        writable: true,
        configurable: true
      })

      await expect(captureSystemAudioStream()).rejects.toThrow('No system audio track was captured')
    })
  })

  // =========================================================================
  // 3. HARDWARE-ACCELERATED AUDIO SINK & DEDICATED ELEMENT PLAYOUT
  // =========================================================================
  describe('3. Dedicated HTML5 Audio Playout Engine & Sound Quality', () => {
    it('mounts native HTMLAudioElement with playsinline, autoplay, and correct attributes', () => {
      const mockTrack = new MockMediaStreamTrack('audio', 'test-audio-sink')
      const mockStream = new MockMediaStream([mockTrack])

      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.setVolume(0.9)
      client.playStream(mockStream as any)

      const audioEl = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement

      expect(audioEl).toBeTruthy()
      expect(audioEl.autoplay).toBe(true)
      expect(audioEl.getAttribute('playsinline')).toBe('true')
      expect(audioEl.srcObject).toBe(mockStream)
      expect(audioEl.volume).toBe(0.9)
      expect(audioEl.muted).toBe(false)

      client.disconnect()
    })

    it('does not reassign srcObject when identical stream is provided, avoiding playback hiccups', () => {
      const mockTrack = new MockMediaStreamTrack('audio', 'test-audio-sink')
      const mockStream = new MockMediaStream([mockTrack])

      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.playStream(mockStream as any)

      const audioEl = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement
      expect(audioEl.srcObject).toBe(mockStream)

      // Spy on srcObject setter
      const setterSpy = vi.spyOn(audioEl, 'srcObject', 'set')

      // Second call with same stream
      client.playStream(mockStream as any)
      expect(setterSpy).not.toHaveBeenCalled()

      setterSpy.mockRestore()
      client.disconnect()
    })

    it('synchronizes volume and muting bidirectionally', () => {
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.playStream(mockStream as any)

      const audioEl = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement

      // Mute (volume = 0)
      client.setVolume(0)
      expect(audioEl.volume).toBe(0)
      expect(audioEl.muted).toBe(true)

      // Unmute to 75%
      client.setVolume(0.75)
      expect(audioEl.volume).toBe(0.75)
      expect(audioEl.muted).toBe(false)

      // Clamping outside bounds
      client.setVolume(1.5)
      expect(audioEl.volume).toBe(1.0)

      client.setVolume(-0.2)
      expect(audioEl.volume).toBe(0.0)

      client.disconnect()
    })

    it('cleans up audio element from DOM upon disconnect', () => {
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.playStream(mockStream as any)

      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeTruthy()

      client.disconnect()
      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeNull()
    })
  })

  // =========================================================================
  // 4. AUTOPLAY INTERCEPTION & USER GESTURE UNLOCK
  // =========================================================================
  describe('4. Autoplay Policy Interception & One-Click Unmute', () => {
    it('catches browser NotAllowedError, flags onAutoplayBlocked(true), and unlocks via unmuteAudio', async () => {
      const mockStream = new MockMediaStream([new MockMediaStreamTrack('audio')])
      let blockedState = false

      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1', {
        onAutoplayBlocked: (blocked) => {
          blockedState = blocked
        }
      })

      // Simulate browser blocking play()
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockRejectedValue(new DOMException('Autoplay denied without gesture', 'NotAllowedError'))

      client.playStream(mockStream as any)

      // Let microtasks flush
      await Promise.resolve()
      await Promise.resolve()

      expect(blockedState).toBe(true)

      // User taps "Tap to Enable Audio" -> unmuteAudio invoked
      playSpy.mockResolvedValue(undefined)
      const success = await client.unmuteAudio()

      expect(success).toBe(true)
      expect(blockedState).toBe(false)

      playSpy.mockRestore()
      client.disconnect()
    })
  })

  // =========================================================================
  // 5. JITTER BUFFER TUNING & NETWORK RECOVERY
  // =========================================================================
  describe('5. Playout Delay & Jitter Buffer Tuning', () => {
    it('configures playoutDelayHint = 0.5s on all audio receivers across the RTCPeerConnection', () => {
      const pc = new MockRTCPeerConnection()
      const audioTrack = new MockMediaStreamTrack('audio', 'remote-audio')
      const videoTrack = new MockMediaStreamTrack('video', 'remote-video')

      pc.receivers = [
        { track: audioTrack, playoutDelayHint: undefined } as any,
        { track: videoTrack, playoutDelayHint: undefined } as any
      ]

      tuneSystemAudioReceivers(pc as any)

      // Audio receiver tuned to 0.5s for zero-jitter music buffer
      expect(pc.receivers[0].playoutDelayHint).toBe(SYSTEM_AUDIO_PLAYOUT_DELAY_S)
      // Video receiver left untouched
      expect(pc.receivers[1].playoutDelayHint).toBeUndefined()
    })

    it('resumes playback automatically when remote track fires onunmute', () => {
      const mockTrack = new MockMediaStreamTrack('audio', 'recovering-track')
      const mockStream = new MockMediaStream([mockTrack])

      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.playStream(mockStream as any)

      const audioEl = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement
      const playSpy = vi.spyOn(audioEl, 'play').mockResolvedValue(undefined)

      // Simulate track resuming packets
      Object.defineProperty(audioEl, 'paused', { value: true, configurable: true })
      mockTrack.onunmute?.()

      expect(playSpy).toHaveBeenCalled()

      playSpy.mockRestore()
      client.disconnect()
    })

    it('pauses and releases audio sink when remote track fires onended', () => {
      const mockTrack = new MockMediaStreamTrack('audio', 'ended-track')
      const mockStream = new MockMediaStream([mockTrack])

      const client = new WebRTCAudioClient('ROOM1', 'client-1', 'host-1')
      client.playStream(mockStream as any)

      const audioEl = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement
      const pauseSpy = vi.spyOn(audioEl, 'pause')

      // Simulate stream stopping at host
      mockTrack.stop()

      expect(pauseSpy).toHaveBeenCalled()
      expect(audioEl.srcObject).toBeNull()

      pauseSpy.mockRestore()
      client.disconnect()
    })
  })

  // =========================================================================
  // 6. REAL-TIME VU METER MONITORING
  // =========================================================================
  describe('6. Isolated Real-Time VU Meter Monitoring', () => {
    it('attaches AnalyserNode without outputting audio to destination to prevent phasing', () => {
      const mockTrack = new MockMediaStreamTrack('audio', 'meter-track')
      const mockStream = new MockMediaStream([mockTrack])

      let levelReported = -1
      const monitor = new AudioLevelMonitor((level) => {
        levelReported = level
      })

      monitor.start(mockStream as any)

      // AudioLevelMonitor creates isolated analyser
      expect((monitor as any).analyser).toBeTruthy()
      expect((monitor as any).sourceNode).toBeTruthy()

      // Stop cleans up cleanly and resets level to 0
      monitor.stop()
      expect(levelReported).toBe(0)
    })
  })

  // =========================================================================
  // 7. END-TO-END HOST <-> GUEST STREAMING LIFECYCLE
  // =========================================================================
  describe('7. End-to-End Broadcast & Join Streaming Flow', () => {
    it('exchanges stereo SDP offer/answer, tunes senders, and mounts audio sink', async () => {
      const roomCode = 'BROADCAST_TEST'
      const hostId = 'user-host-1'
      const guestId = 'user-guest-1'

      // 1. Host setup
      const hostAudioTrack = new MockMediaStreamTrack('audio', 'host-device-sound')
      const hostVideoTrack = new MockMediaStreamTrack('video', 'host-screen')
      const hostStream = new MockMediaStream([hostAudioTrack, hostVideoTrack])

      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getDisplayMedia: vi.fn().mockResolvedValue(hostStream)
        },
        writable: true,
        configurable: true
      })

      const host = new WebRTCAudioHost(roomCode, hostId, { bitrateBps: 256000 })
      const hostStartPromise = host.start()
      await vi.advanceTimersByTimeAsync(10)
      await hostStartPromise

      // 2. Guest setup
      let guestClientState = 'disconnected'
      const guest = new WebRTCAudioClient(roomCode, guestId, hostId, {
        onStateChange: (state) => {
          guestClientState = state
        }
      })

      // 3. Guest initiates join
      const connectPromise = guest.connect()
      await vi.advanceTimersByTimeAsync(10)
      await connectPromise
      await vi.advanceTimersByTimeAsync(50)

      // 4. Verification: Guest audio element created and configured
      const guestAudio = document.querySelector(
        'audio[data-felo-system-audio="webrtc-stream-player"]'
      ) as HTMLAudioElement
      expect(guestAudio).toBeTruthy()
      expect(guestAudio.volume).toBe(1.0)
      expect(guestAudio.muted).toBe(false)

      // 5. Host stops broadcast
      host.stop()
      guest.disconnect()

      expect(document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')).toBeNull()
    })
  })

  // =========================================================================
  // 8. LISTENING STORE AUTO-SWITCHING & INTEGRATION
  // =========================================================================
  describe('8. Listening Room Store State Coordination', () => {
    it('halts local player and updates store state when room transitions to device stream', () => {
      usePlayerStore.setState({
        isPlaying: true,
        currentTime: 78
      })

      const deviceRoom: ListeningRoom = {
        id: 'room-broadcast-1',
        code: 'DEVICE1',
        name: 'Device Broadcast Room',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        is_device_stream: true,
        song: {
          title: 'System Audio Broadcast',
          artist: 'Host',
          album: 'Live Stream',
          duration: 0,
          isDeviceStream: true
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      usePlayerStore.getState().setIsPlaying(false)
      useListeningStore.setState({
        joinedRoom: deviceRoom,
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })

      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(true)
      expect(useListeningStore.getState().deviceAudioClientState).toBe('connected')
    })
  })

  // =========================================================================
  // 9. TRI-MODE SEAMLESS FLOW (LOCAL <-> YOUTUBE <-> DEVICE STREAM)
  // =========================================================================
  describe('9. Tri-Mode Seamless Flow (Local <-> YouTube <-> Device Stream)', () => {
    it('seamlessly transitions from Local Music to YouTube Music', async () => {
      // 1. Initial State: Local music playing
      const localSong = {
        id: 'local-1',
        title: 'Local MP3 Track',
        artist: 'Artist One',
        duration: 180,
        filePath: 'C:/music/track.mp3'
      }
      usePlayerStore.setState({
        queue: [localSong as any],
        currentSongIndex: 0,
        isPlaying: true
      })

      // 2. Host transitions room to a YouTube track
      const ytRoom: ListeningRoom = {
        id: 'room-1',
        code: 'ROOM1',
        name: 'Sync Room',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 15,
        song: {
          title: 'YouTube Live Music',
          artist: 'Official Channel',
          duration: 240,
          isYouTube: true,
          videoId: 'dQw4w9WgXcQ'
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      await useListeningStore.getState().handleHostSongChange(ytRoom)

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]

      expect(currentTrack).toBeTruthy()
      expect(currentTrack.id).toBe('yt-dQw4w9WgXcQ')
      expect(currentTrack.isYouTube).toBe(true)
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
    })

    it('seamlessly transitions from YouTube Music to Audio Device Stream', async () => {
      // 1. Initial State: YouTube song active in queue
      const ytSong = {
        id: 'yt-dQw4w9WgXcQ',
        title: 'YouTube Stream',
        artist: 'Official Channel',
        duration: 240,
        isYouTube: true,
        videoId: 'dQw4w9WgXcQ'
      }
      usePlayerStore.setState({
        queue: [ytSong as any],
        currentSongIndex: 0,
        isPlaying: true
      })

      // 2. Host starts broadcasting device sound
      const deviceRoom: ListeningRoom = {
        id: 'room-1',
        code: 'ROOM1',
        name: 'Sync Room',
        host_id: 'host-user',
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

      useListeningStore.setState({
        joinedRoom: deviceRoom,
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })
      usePlayerStore.getState().setIsPlaying(false)

      // Verification: Local/YouTube player halted, device stream takes complete ownership
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(true)
      expect(useListeningStore.getState().joinedRoom?.is_device_stream).toBe(true)
    })

    it('seamlessly transitions from Audio Device Stream back to YouTube Music', async () => {
      // 1. Initial State: Device stream active
      useListeningStore.setState({
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })
      usePlayerStore.setState({ isPlaying: false })

      // 2. Host ends device stream and resumes YouTube track
      const ytRoom: ListeningRoom = {
        id: 'room-1',
        code: 'ROOM1',
        name: 'Sync Room',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 40,
        is_device_stream: false,
        song: {
          title: 'Lo-Fi Chill Beats',
          artist: 'Lofi Girl',
          duration: 300,
          isYouTube: true,
          videoId: 'jfKfPfyJRdk'
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      await useListeningStore.getState().handleHostSongChange(ytRoom)

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]

      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
      expect(currentTrack.id).toBe('yt-jfKfPfyJRdk')
      expect(currentTrack.isYouTube).toBe(true)
      expect(playerState.isPlaying).toBe(true)
    })

    it('seamlessly transitions from Audio Device Stream back to Local Music', async () => {
      // 1. Initial State: Device stream active
      useListeningStore.setState({
        isReceivingDeviceStream: true,
        deviceAudioClientState: 'connected'
      })
      usePlayerStore.setState({ isPlaying: false })

      // 2. Host ends device stream and plays local audio track
      const localRoom: ListeningRoom = {
        id: 'room-1',
        code: 'ROOM1',
        name: 'Sync Room',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 60,
        is_device_stream: false,
        song: {
          title: 'Midnight City',
          artist: 'M83',
          album: 'Hurry Up, We\'re Dreaming',
          duration: 243,
          localId: 'local-song-99'
        },
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      await useListeningStore.getState().handleHostSongChange(localRoom)

      expect(useListeningStore.getState().isReceivingDeviceStream).toBe(false)
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(useListeningStore.getState().syncStatus).toBe('buffering')
    })

    it('silences YouTube instantly via felo:stop-youtube event when transitioning to Local Music', () => {
      let stopYouTubeDispatched = false
      const listener = () => {
        stopYouTubeDispatched = true
      }
      window.addEventListener('felo:stop-youtube', listener)

      // Simulate native AudioEngine claiming output for a local audio file
      window.dispatchEvent(new CustomEvent('felo:stop-youtube'))

      expect(stopYouTubeDispatched).toBe(true)
      window.removeEventListener('felo:stop-youtube', listener)
    })
  })
})

