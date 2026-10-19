import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useOnlineStore } from '../../../src/renderer/src/stores/useOnlineStore'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'
import {
  setNeedsInitialSync,
  needsInitialSync,
  setLastHostPulse
} from '../../../src/renderer/src/stores/listening/helpers'
import { registerActiveAudioElement } from '../../../src/renderer/src/lib/audioBridge'
import type { ListeningRoom } from '../../../src/renderer/src/types/listening'
import type { Song } from '../../../src/renderer/src/pages/Library/Library'

describe('Join Sync, N+1 Track Transition & Bilateral Pause Handling Suite', () => {
  let mockAudio: any

  beforeEach(() => {
    vi.useFakeTimers()
    useListeningStore.setState({
      joinedRoom: null,
      hostRoom: null,
      syncStatus: 'idle',
      isSyncLocked: false,
      isGuestBuffering: false,
      manualSyncOffsetMs: 0,
      driftSeconds: 0
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
})
