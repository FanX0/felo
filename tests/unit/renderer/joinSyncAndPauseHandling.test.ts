import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useOnlineStore } from '../../../src/renderer/src/stores/useOnlineStore'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'
import {
  setNeedsInitialSync,
  needsInitialSync,
  setLastHostPulse,
  _autoDownloadRequests
} from '../../../src/renderer/src/stores/listening/helpers'
import { registerActiveAudioElement } from '../../../src/renderer/src/lib/audioBridge'
import { audioDspEngine } from '../../../src/renderer/src/lib/audioDspEngine'
import { downloadWholeObjectWithWatchdog } from '../../../src/renderer/src/lib/jitAudioPipeline'
import type { ListeningRoom } from '../../../src/renderer/src/types/listening'
import type { Song } from '../../../src/renderer/src/pages/Library/Library'

const realTriggerRoomTrackDownload = useListeningStore.getState().triggerRoomTrackDownload

describe('Join Sync, N+1 Track Transition & Bilateral Pause Handling Suite', () => {
  let mockAudio: any

  beforeEach(() => {
    vi.useFakeTimers()
    _autoDownloadRequests.clear()
    useListeningStore.setState({
      joinedRoom: null,
      hostRoom: null,
      syncStatus: 'idle',
      isSyncLocked: false,
      isGuestBuffering: false,
      manualSyncOffsetMs: 0,
      driftSeconds: 0,
      triggerRoomTrackDownload: realTriggerRoomTrackDownload
    })
    usePlayerStore.setState({
      queue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 200,
      seekRequest: null
    })
    useOnlineStore.setState({
      user: { id: 'guest-user-123', email: 'guest@example.com' } as any
    })
    setLastHostPulse(null)
    setNeedsInitialSync(false)

    mockAudio = {
      paused: true,
      currentTime: 0,
      duration: 200,
      readyState: 4, // HAVE_ENOUGH_DATA
      play: vi.fn().mockImplementation(() => {
        mockAudio.paused = false
        return Promise.resolve()
      }),
      pause: vi.fn().mockImplementation(() => {
        mockAudio.paused = true
      })
    }
    registerActiveAudioElement(mockAudio)
  })

  afterEach(() => {
    registerActiveAudioElement(null)
    vi.useRealTimers()
  })

  // ─── 1. Track Identity Validation (Normalized Meta Parity) ───────────

  describe('1. Track Identity Validation in handleHostSyncPulse', () => {
    it('accepts host sync_pulse with different raw ID if song title and artist match', () => {
      const guestSong: Song = {
        id: 'guest-local-db-999',
        title: 'Starboy',
        artist: 'The Weeknd',
        duration: 230,
        filePath: 'C:/Music/Starboy.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 10
      })

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Weekend Party',
        code: 'STAR',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-db-111',
          title: 'Starboy',
          artist: 'The Weeknd',
          duration: 230
        } as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      // Seed NTP calibration
      roomClockSync.handlePong({
        guestId: roomClockSync.getGuestId(),
        t0: Date.now() - 20,
        t1: Date.now() - 10
      })
      setNeedsInitialSync(true)

      // Host emits sync pulse with host's own localId and metadata
      useListeningStore.getState().handleHostSyncPulse({
        position: 45.5,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: 'host-db-111',
        title: 'Starboy',
        artist: 'The Weeknd'
      })

      // Must NOT be dropped! Guest should bootstrap-seek to host target time
      const player = usePlayerStore.getState()
      expect(player.currentTime).toBeGreaterThan(40)
      expect(player.seekRequest).toBeGreaterThan(40)
      expect(needsInitialSync()).toBe(false)
    })

    it('rejects pulse if both trackId AND song title differ (true song mismatch)', () => {
      const guestSong: Song = {
        id: 'guest-local-db-999',
        title: 'Starboy',
        artist: 'The Weeknd',
        duration: 230,
        filePath: 'C:/Music/Starboy.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 10
      })

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-db-111',
          title: 'Starboy',
          artist: 'The Weeknd',
          duration: 230
        } as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      setNeedsInitialSync(true)
      // Pulse arrives for completely different track
      useListeningStore.getState().handleHostSyncPulse({
        position: 120.0,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: 'host-db-OTHER',
        title: 'Blinding Lights',
        artist: 'The Weeknd'
      })

      // Must be dropped
      expect(usePlayerStore.getState().currentTime).toBe(10)
      expect(needsInitialSync()).toBe(true)
    })
  })

  // ─── 2. usePlayerStore.setQueue initialTime Support ──────────────────

  describe('2. usePlayerStore.setQueue initialTime Option', () => {
    it('initializes currentTime and seekRequest when initialTime is provided with isRoomSync', () => {
      const song: Song = {
        id: 's1',
        title: 'Song One',
        artist: 'Artist One',
        duration: 180,
        filePath: 'C:/audio.mp3'
      }

      usePlayerStore.getState().setQueue([song], 0, undefined, {
        isRoomSync: true,
        initialTime: 65.4
      })

      const state = usePlayerStore.getState()
      expect(state.currentTime).toBe(65.4)
      expect(state.seekRequest).toBe(65.4)
      expect(state.isPlaying).toBe(true)
    })

    it('defaults currentTime to 0 and seekRequest to null if initialTime is 0 or omitted', () => {
      const song: Song = {
        id: 's1',
        title: 'Song One',
        artist: 'Artist One',
        duration: 180,
        filePath: 'C:/audio.mp3'
      }

      usePlayerStore.getState().setQueue([song], 0, undefined, {
        isRoomSync: true
      })

      const state = usePlayerStore.getState()
      expect(state.currentTime).toBe(0)
      expect(state.seekRequest).toBeNull()
    })
  })

  // ─── 3. performOneTimeSyncWithHost Gating Resilience ─────────────────

  describe('3. performOneTimeSyncWithHost Gating Resilience', () => {
    it('keeps needsInitialSync=true when targetTime <= 0.1 while host is playing with uncalibrated pulse', () => {
      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-song-1',
          title: 'Awaiting Song',
          artist: 'Artist',
          duration: 200,
          hostPosition: 0
        } as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })
      setNeedsInitialSync(true)
      setLastHostPulse(null)

      // When download finishes or track mounts before host pulse is known:
      useListeningStore.getState().performOneTimeSyncWithHost({
        forceSeek: true,
        logReason: 'Early lifecycle test'
      })

      // Gate MUST remain open because host is playing and we only had 0.00s!
      expect(needsInitialSync()).toBe(true)

      // When host pulse actually arrives with live time:
      roomClockSync.handlePong({
        guestId: roomClockSync.getGuestId(),
        t0: Date.now() - 10,
        t1: Date.now() - 5
      })
      useListeningStore.getState().handleHostSyncPulse({
        position: 50.0,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: 'host-song-1',
        title: 'Awaiting Song',
        artist: 'Artist'
      })

      // Now it cleanly bootstraps and closes the gate
      expect(usePlayerStore.getState().currentTime).toBeGreaterThan(45)
      expect(needsInitialSync()).toBe(false)
    })

    it('closes needsInitialSync when host is paused at 0:00', () => {
      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: false, // PAUSED
        position_seconds: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-song-1',
          title: 'Paused Song',
          artist: 'Artist',
          duration: 200,
          hostPosition: 0
        } as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })
      setNeedsInitialSync(true)

      useListeningStore.getState().performOneTimeSyncWithHost({
        forceSeek: true,
        logReason: 'Host paused test'
      })

      // Because host is paused, 0:00 is authoritative! Gate should close.
      expect(needsInitialSync()).toBe(false)
      expect(usePlayerStore.getState().isPlaying).toBe(false)
    })
  })

  // ─── 4. Bilateral Pause and Resume Parity ────────────────────────────

  describe('4. Bilateral Pause and Resume Parity', () => {
    it('handleHostExplicitPlayPause pauses audio element and snaps position on host pause', () => {
      const guestSong: Song = {
        id: 'song-1',
        title: 'Test Song',
        artist: 'Artist',
        duration: 200,
        filePath: 'C:/audio.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 30
      })
      mockAudio.paused = false
      mockAudio.currentTime = 30

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      // Host toggles pause at 32.5s
      useListeningStore.getState().handleHostExplicitPlayPause({
        isPlaying: false,
        position: 32.5,
        hostTimestamp: Date.now()
      })

      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(mockAudio.pause).toHaveBeenCalled()
      expect(usePlayerStore.getState().currentTime).toBe(32.5)
      expect(mockAudio.currentTime).toBe(32.5)
    })

    it('handleHostExplicitPlayPause resumes audio element on host resume', () => {
      const guestSong: Song = {
        id: 'song-1',
        title: 'Test Song',
        artist: 'Artist',
        duration: 200,
        filePath: 'C:/audio.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: false,
        currentTime: 32.5
      })
      mockAudio.paused = true
      mockAudio.currentTime = 32.5

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      // Host resumes playback
      useListeningStore.getState().handleHostExplicitPlayPause({
        isPlaying: true,
        position: 32.5,
        hostTimestamp: Date.now()
      })

      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(mockAudio.play).toHaveBeenCalled()
    })

    it('handleHostSyncPulse updates play/pause immediately even if sync locked', () => {
      const guestSong: Song = {
        id: 'song-1',
        title: 'Test Song',
        artist: 'Artist',
        duration: 200,
        filePath: 'C:/audio.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 50
      })
      mockAudio.paused = false

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'song-1',
          title: 'Test Song',
          artist: 'Artist',
          duration: 200
        } as any
      }
      useListeningStore.setState({
        joinedRoom: dummyRoom,
        isSyncLocked: true // Sync locked by recent scrub
      })

      // Pulse arrives indicating host paused
      useListeningStore.getState().handleHostSyncPulse({
        position: 50,
        hostTimestamp: Date.now(),
        isPlaying: false,
        trackId: 'song-1',
        title: 'Test Song',
        artist: 'Artist'
      })

      // Player must be paused immediately!
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(mockAudio.pause).toHaveBeenCalled()
    })
  })

  // ─── 5. N+1 Track Transition & Pulse Preservation ────────────────────

  describe('5. N+1 Track Transition & Pulse Preservation', () => {
    it('preserves _lastHostPulse during handleHostSongChange if pulse belongs to incoming room.song', async () => {
      const roomSong = {
        localId: 'song-next-456',
        title: 'Next Track',
        artist: 'Next Artist',
        duration: 210,
        audioUrl: 'https://cdn.example.com/audio.mp3'
      }
      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: roomSong as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      // Host sent pulse for this new track
      setLastHostPulse({
        position: 18.2,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: 'song-next-456',
        title: 'Next Track',
        artist: 'Next Artist'
      })

      // Guest runs handleHostSongChange (e.g. download finished or transition)
      await useListeningStore.getState().handleHostSongChange(dummyRoom)

      // calculateCurrentHostTargetTime should reflect the preserved pulse (>= 18s), NOT drop to 0!
      const targetTime = useListeningStore.getState().calculateCurrentHostTargetTime()
      expect(targetTime).toBeGreaterThanOrEqual(18)
    })
  })

  // ─── 6. Unsynced Lag Recovery & Arbitrary Track Acquisition ───────────

  describe('6. Unsynced Lag Recovery & Arbitrary Track Acquisition', () => {
    it('snaps guest from near-zero (< 1.5s) to host target (> 2.5s) even when needsInitialSync is false', () => {
      const guestSong: Song = {
        id: 'guest-local-db-123',
        title: 'Arbitrary Track',
        artist: 'Some Artist',
        duration: 200,
        filePath: 'C:/Music/Arbitrary.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 0.2 // Guest just downloaded and started at 0.2s
      })
      mockAudio.currentTime = 0.2
      mockAudio.paused = false

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-123',
          title: 'Arbitrary Track',
          artist: 'Some Artist',
          duration: 200
        } as any
      }
      useListeningStore.setState({
        joinedRoom: dummyRoom,
        isSyncLocked: false
      })
      setNeedsInitialSync(false) // Gate was closed early, but guest is lagging at 0.2s while host is at 25s

      useListeningStore.getState().handleHostSyncPulse({
        position: 25.0,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: 'host-123',
        title: 'Arbitrary Track',
        artist: 'Some Artist'
      })

      // Must execute initial sync bootstrap seek to ~25s!
      expect(mockAudio.currentTime).toBeGreaterThanOrEqual(24.5)
      expect(usePlayerStore.getState().currentTime).toBeGreaterThanOrEqual(24.5)
      expect(needsInitialSync()).toBe(false)
    })

    it('snaps playhead accurately to paused position when host pauses, even with sync lock active', () => {
      const guestSong: Song = {
        id: 'guest-local-db-123',
        title: 'Arbitrary Track',
        artist: 'Some Artist',
        duration: 200,
        filePath: 'C:/Music/Arbitrary.mp3'
      }
      usePlayerStore.setState({
        queue: [guestSong],
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 5.0
      })
      mockAudio.currentTime = 5.0
      mockAudio.paused = false

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'host-123',
          title: 'Arbitrary Track',
          artist: 'Some Artist',
          duration: 200
        } as any
      }
      useListeningStore.setState({
        joinedRoom: dummyRoom,
        isSyncLocked: true // Sync locked by previous operation
      })

      useListeningStore.getState().handleHostSyncPulse({
        position: 32.5,
        hostTimestamp: Date.now(),
        isPlaying: false,
        trackId: 'host-123',
        title: 'Arbitrary Track',
        artist: 'Some Artist'
      })

      // Audio must pause and snap position to 32.5s despite isSyncLocked
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(mockAudio.pause).toHaveBeenCalled()
      expect(mockAudio.currentTime).toBe(32.5)
      expect(usePlayerStore.getState().currentTime).toBe(32.5)
    })

    it('triggers room track download on arbitrary song change when !directUrl on desktop', async () => {
      const triggerSpy = vi.fn().mockResolvedValue(undefined)
      useListeningStore.setState({
        triggerRoomTrackDownload: triggerSpy,
        autoDownloadMissing: false // Disabled in settings, but !directUrl must still download!
      })

      const targetSong = {
        title: 'Brand New Arbitrary Song',
        artist: 'Surprise Artist',
        duration: 180
        // No localId, no audioUrl, no blobUrl, no lanUrl
      }
      const room: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: targetSong as any
      }

      // Mock desktop window.api
      ;(window as any).api = {
        getSongs: vi.fn().mockResolvedValue([])
      }

      await useListeningStore.getState().handleHostSongChange(room)

      expect(useListeningStore.getState().syncStatus).toBe('missing_song')
      expect(triggerSpy).toHaveBeenCalledWith(room, targetSong)
    })

    it('triggers room track download on arbitrary song change even when streamUrl exists for lossless quality parity', async () => {
      const triggerSpy = vi.fn().mockResolvedValue(undefined)
      useListeningStore.setState({
        triggerRoomTrackDownload: triggerSpy,
        autoDownloadMissing: false
      })

      const targetSong = {
        localId: 'host-arbitrary-999',
        title: 'Lossless Track',
        artist: 'Hi-Res Artist',
        duration: 210
      }
      const room: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: targetSong as any
      }

      ;(window as any).api = {
        getSongs: vi.fn().mockResolvedValue([])
      }

      await useListeningStore.getState().handleHostSongChange(room)

      expect(useListeningStore.getState().syncStatus).toBe('buffering')
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(triggerSpy).toHaveBeenCalledWith(room, targetSong)
    })
  })

  // ─── 7. Unverified Bucket URL Guard, 88-Byte Error Rejection & Web Audio Buffer Sync ───

  describe('7. Unverified Bucket URL Guard, 88-Byte Error Rejection & Web Audio Buffer Sync', () => {
    it('sets queue with empty filePath and buffering status when host song is uploading (no unverified bucket URL)', async () => {
      vi.useRealTimers()
      try {
        const uploadingSong = {
          localId: 'song-crayola-123',
          title: 'crayola',
          artist: 'crayola artist',
          duration: 230,
          uploadStatus: 'UPLOADING'
        }
        const room: ListeningRoom = {
          id: 'room-1',
          host_id: 'host-user-888',
          name: 'Party',
          code: 'XYZ',
          is_active: true,
          is_playing: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          song: uploadingSong as any
        }

        await useListeningStore.getState().handleHostSongChange(room)

        const listeningState = useListeningStore.getState()
        const playerState = usePlayerStore.getState()
        const currentTrack = playerState.queue[playerState.currentSongIndex]

        // 1. syncStatus must be buffering (NOT stuck 100% or playing a 404 URL)
        expect(listeningState.syncStatus).toBe('buffering')
        // 2. Queue contains track with empty filePath so HTML audio doesn't attempt 404 download
        expect(currentTrack).toBeDefined()
        expect(currentTrack.title).toBe('crayola')
        expect(currentTrack.filePath).toBe('')
        expect(currentTrack.audioUrl).toBe('')
        // 3. JIT status indicates buffering from host with 0 bytes (NOT 88 B / 88 B)
        const jit = listeningState.jitStatus['song-crayola-123']
        expect(jit).toBeDefined()
        expect(jit.percent).toBe(0)
        expect(jit.receivedBytes).toBe(0)
        expect(jit.totalBytes).toBe(0)
        expect(jit.statusText).toBe('Buffering stream from host...')
      } finally {
        vi.useFakeTimers()
      }
    })

    it('rejects payloads under 512 bytes as invalid audio in downloadWholeObjectWithWatchdog and suppresses progress', async () => {
      const origXHR = globalThis.XMLHttpRequest
      let capturedOnProgress: any
      let capturedOnLoad: any
      let progressReported = false

      class MockXHR {
        open = vi.fn()
        setRequestHeader = vi.fn()
        abort = vi.fn()
        status = 200
        response = new ArrayBuffer(88) // 88-byte error JSON
        set onprogress(fn: any) {
          capturedOnProgress = fn
        }
        set onload(fn: any) {
          capturedOnLoad = fn
        }
        send = vi.fn().mockImplementation(() => {
          // Trigger progress with 88 bytes
          capturedOnProgress?.({ loaded: 88, total: 88, lengthComputable: true })
          // Trigger load
          capturedOnLoad?.()
        })
      }

      ;(globalThis as any).XMLHttpRequest = MockXHR

      try {
        await expect(
          downloadWholeObjectWithWatchdog('https://example.com/missing.mp3', {
            onProgress: () => {
              progressReported = true
            }
          })
        ).rejects.toThrow('REMOTE_SHARE_DOWNLOAD_INVALID_AUDIO')

        // Progress must NOT be reported for < 512 bytes error payloads!
        expect(progressReported).toBe(false)
      } finally {
        globalThis.XMLHttpRequest = origXHR
      }
    })

    it('pauses and resumes audioDspEngine buffer channels in handleHostExplicitPlayPause', () => {
      const pauseSpyA = vi.spyOn(audioDspEngine, 'pauseBuffer').mockReturnValue(10)
      const isBufferActiveSpy = vi.spyOn(audioDspEngine, 'isBufferActive').mockReturnValue(true)
      const isBufferPlayingSpy = vi.spyOn(audioDspEngine, 'isBufferPlaying').mockReturnValue(false)
      const mockBuf = {} as any
      const getBufferSpy = vi.spyOn(audioDspEngine, 'getCurrentAudioBuffer').mockReturnValue(mockBuf)
      const playBufferSpy = vi.spyOn(audioDspEngine, 'playBuffer').mockImplementation(() => {})

      const dummyRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party',
        code: 'XYZ',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: { localId: 's1', title: 'Buffer Track', artist: 'Artist', duration: 200 } as any
      }
      useListeningStore.setState({ joinedRoom: dummyRoom })

      // Host pauses:
      useListeningStore.getState().handleHostExplicitPlayPause({
        isPlaying: false,
        position: 42.0,
        hostTimestamp: Date.now()
      })

      expect(pauseSpyA).toHaveBeenCalledWith('A')
      expect(usePlayerStore.getState().isPlaying).toBe(false)

      // Host resumes:
      useListeningStore.getState().handleHostExplicitPlayPause({
        isPlaying: true,
        position: 42.0,
        hostTimestamp: Date.now()
      })

      expect(playBufferSpy).toHaveBeenCalledWith(mockBuf, 42.0, undefined, 'A')
      expect(usePlayerStore.getState().isPlaying).toBe(true)

      pauseSpyA.mockRestore()
      isBufferActiveSpy.mockRestore()
      isBufferPlayingSpy.mockRestore()
      getBufferSpy.mockRestore()
      playBufferSpy.mockRestore()
    })
  })

  // ─── 8. Immediate Track Change on Download Completion Without Host Pause ───────────

  describe('8. Immediate Track Change on Download Completion Without Host Pause', () => {
    it('sets queue and transitions from placeholder to downloaded song when download completes while buffering', async () => {
      const hostRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party Room',
        code: 'SYNC',
        is_active: true,
        is_playing: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'song-target-999',
          title: 'Blinding Lights',
          artist: 'The Weeknd',
          duration: 200,
          hostPosition: 45,
          hostTimestamp: Date.now()
        } as any
      }

      // Guest starts with buffering placeholder (empty filePath)
      const placeholder: Song = {
        id: 'song-target-999',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        duration: 200,
        filePath: '',
        audioUrl: ''
      }
      usePlayerStore.setState({
        queue: [placeholder],
        currentSongIndex: 0,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0
      })
      useListeningStore.setState({
        joinedRoom: hostRoom,
        syncStatus: 'buffering'
      })

      // Download finishes: window.api.getSongs now returns the downloaded file on disk
      const downloadedSong: Song = {
        id: 'song-target-999',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        duration: 200,
        filePath: 'C:/Music/Blinding_Lights.flac',
        audioUrl: ''
      }
      ;(window as any).api = {
        getSongs: vi.fn().mockResolvedValue([downloadedSong])
      }

      // Guest calls handleHostSongChange (as triggered by DownloadEventBridge on completion)
      await useListeningStore.getState().handleHostSongChange(hostRoom)

      // Verify player queue was updated with the real downloaded filePath
      const updatedQueue = usePlayerStore.getState().queue
      expect(updatedQueue[0].filePath).toBe('C:/Music/Blinding_Lights.flac')
      expect(usePlayerStore.getState().currentSongIndex).toBe(0)

      // Verify playback is active and time was aligned to host (approx 45s, not 0s)
      expect(usePlayerStore.getState().isPlaying).toBe(true)
      expect(usePlayerStore.getState().currentTime).toBeGreaterThanOrEqual(44)
      expect(usePlayerStore.getState().currentTime).toBeLessThanOrEqual(46)
    })

    it('preserves paused state when host is paused during song change', async () => {
      const pausedHostRoom: ListeningRoom = {
        id: 'room-1',
        host_id: 'host-user-888',
        name: 'Party Room',
        code: 'SYNC',
        is_active: true,
        is_playing: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        song: {
          localId: 'song-paused-123',
          title: 'Save Your Tears',
          artist: 'The Weeknd',
          duration: 215,
          hostPosition: 12,
          hostTimestamp: Date.now()
        } as any
      }

      const downloadedSong: Song = {
        id: 'song-paused-123',
        title: 'Save Your Tears',
        artist: 'The Weeknd',
        duration: 215,
        filePath: 'C:/Music/Save_Your_Tears.flac',
        audioUrl: ''
      }
      ;(window as any).api = {
        getSongs: vi.fn().mockResolvedValue([downloadedSong])
      }

      await useListeningStore.getState().handleHostSongChange(pausedHostRoom)

      // isPlaying must be false because host is paused!
      expect(usePlayerStore.getState().isPlaying).toBe(false)
      expect(usePlayerStore.getState().queue[0].filePath).toBe('C:/Music/Save_Your_Tears.flac')
    })
  })

  describe('Mid-Song Jumping Prevention & Niche Track Fallback', () => {
    it('triggerRoomTrackDownload queries YouTube fallback when studio providers return no hits', async () => {
      vi.useRealTimers()
      try {
        const room: ListeningRoom = {
          id: 'room-niche-1',
          host_id: 'host-1',
          name: 'Room',
          code: 'NICHE1',
          is_active: true,
          is_playing: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          song: {
            localId: 'niche-song-1',
            title: 'ライラック',
            artist: 'BGM channel',
            duration: 141
          } as any
        }

        const searchDownloadSourceMock = vi.fn().mockImplementation((source: string) => {
          if (source === 'qobuz' || source === 'deezer' || source === 'soulseek') {
            return Promise.resolve([])
          }
          if (source === 'youtube') {
            return Promise.resolve([
              {
                id: 'yt-lilac-123',
                title: 'ライラック',
                artist: 'BGM channel',
                duration: 141,
                source: 'youtube',
                sourceName: 'YouTube'
              }
            ])
          }
          return Promise.resolve([])
        })

        const startDownloadMock = vi.fn().mockResolvedValue({ success: true })

        ;(window as any).api = {
          getSetting: vi.fn().mockImplementation((key: string) => {
            if (key === 'download.priority') return Promise.resolve(['qobuz', 'deezer'])
            return Promise.resolve({})
          }),
          searchDownloadSource: searchDownloadSourceMock,
          startDownload: startDownloadMock
        }

        await useListeningStore.getState().triggerRoomTrackDownload(room, room.song!)

        // Expect searchDownloadSource was called for youtube as guaranteed fallback
        expect(searchDownloadSourceMock).toHaveBeenCalledWith('youtube', expect.any(String), expect.any(Object))
        expect(startDownloadMock).toHaveBeenCalledWith(
          expect.objectContaining({
            source: 'youtube',
            resultId: 'yt-lilac-123',
            title: 'ライラック'
          })
        )
      } finally {
        vi.useFakeTimers()
      }
    })

    it('transitions to missing_song when all download providers fail to find audio', async () => {
      vi.useRealTimers()
      try {
        const room: ListeningRoom = {
          id: 'room-niche-2',
          host_id: 'host-1',
          name: 'Room',
          code: 'NICHE2',
          is_active: true,
          is_playing: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          song: {
            localId: 'unfindable-song-1',
            title: 'Totally Unknown Obscure Song',
            artist: 'No One',
            duration: 120
          } as any
        }

        useListeningStore.setState({ syncStatus: 'buffering', joinedRoom: room })

        ;(window as any).api = {
          getSetting: vi.fn().mockImplementation((key: string) => {
            if (key === 'download.priority') return Promise.resolve(['qobuz', 'youtube'])
            return Promise.resolve({})
          }),
          searchDownloadSource: vi.fn().mockResolvedValue([]),
          startDownload: vi.fn()
        }

        await useListeningStore.getState().triggerRoomTrackDownload(room, room.song!)

        expect(useListeningStore.getState().syncStatus).toBe('missing_song')
        expect(useListeningStore.getState().missingSong).toEqual(room.song)
      } finally {
        vi.useFakeTimers()
      }
    })
  })
})
