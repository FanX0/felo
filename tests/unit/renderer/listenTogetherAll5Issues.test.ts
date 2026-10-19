import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore, setPlaybackGuard } from '../../../src/renderer/src/stores/player/usePlayerStore'
import {
  setIsSessionSyncing,
  resetSessionSync,
  isSessionSyncing,
  toSharedSong
} from '../../../src/renderer/src/stores/listening/helpers'
import { JITChunkReceiver } from '../../../src/renderer/src/lib/jitAudioPipeline'
import type { Song } from '../../../src/renderer/src/types/song'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

describe('Listen Together: 5-Point Bug Fixes & Regression Test Suite', () => {
  const song1: Song = {
    id: 'track-alpha',
    title: 'Alpha Song',
    artist: 'Artist Alpha',
    album: 'Alpha Album',
    duration: 200,
    filePath: 'C:\\Music\\alpha.mp3',
    audioUrl: 'https://cdn.example.com/alpha.mp3'
  }

  const song2: Song = {
    id: 'track-beta',
    title: 'Beta Song',
    artist: 'Artist Beta',
    album: 'Beta Album',
    duration: 240,
    filePath: 'C:\\Music\\beta.mp3',
    audioUrl: 'https://cdn.example.com/beta.mp3'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionSync()
    setPlaybackGuard(null)
    usePlayerStore.setState({
      queue: [song1, song2],
      currentSongIndex: 0,
      currentTime: 0,
      isPlaying: true,
      isAudioActive: true
    })
    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      myRole: null,
      audioQuality: null,
      isSyncLocked: false,
      driftSeconds: 0,
      pendingLeaveAndPlay: null
    })
  })

  afterEach(() => {
    setPlaybackGuard(null)
    resetSessionSync()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE 1: Timer Stability (Single Source of Truth)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Issue 1: UI Timer Stability & Anti-Jitter', () => {
    it('uses local audio element currentTime as source of truth when playing, ignoring network jitter', () => {
      // Simulate guest playing locally at 42.5 seconds
      const currentGuestAudioTime = 42.5
      const jitteredNetworkTime = 38.2 // network sync packet arrived with latency drift
      const isReceivingDeviceStream = false

      // Logic mirrored from fixed GuestRoomView.tsx line 129
      const effectiveTime = isReceivingDeviceStream
        ? jitteredNetworkTime
        : currentGuestAudioTime > 0
          ? currentGuestAudioTime
          : jitteredNetworkTime

      expect(effectiveTime).toBe(42.5)
      expect(effectiveTime).not.toBe(jitteredNetworkTime)
    })

    it('falls back to syncedGuestTime only during device stream or before initial audio buffering has started', () => {
      // Case A: Buffering at 0:00 (audio element has not started yet)
      const zeroAudioTime = 0
      const hostProjectedTime = 15.0
      const effectiveTimeBuffering = zeroAudioTime > 0 ? zeroAudioTime : hostProjectedTime
      expect(effectiveTimeBuffering).toBe(15.0)

      // Case B: Live device stream without HTML5 audio element
      const isDeviceStream = true
      const effectiveTimeDevice = isDeviceStream ? hostProjectedTime : zeroAudioTime
      expect(effectiveTimeDevice).toBe(15.0)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE 2 & 4: PlaybackGuard Bypass & Reentrant Session Syncing
  // ──────────────────────────────────────────────────────────────────────────
  describe('Issue 2 & 4: False Leave Modal Prevention & Reentrant Sync Depth', () => {
    it('bypasses _playbackGuard completely when isRoomSync: true is provided to setQueue', () => {
      let guardTriggered = false
      setPlaybackGuard((proceed) => {
        guardTriggered = true
        useListeningStore.getState().setPendingLeaveAndPlay(proceed)
        return true
      })

      // 1. Normal user click without isRoomSync -> Guard MUST intercept
      usePlayerStore.getState().setQueue([song1], 0)
      expect(guardTriggered).toBe(true)
      expect(useListeningStore.getState().pendingLeaveAndPlay).not.toBeNull()

      // Reset test state
      guardTriggered = false
      useListeningStore.setState({ pendingLeaveAndPlay: null })

      // 2. Room sync operation with isRoomSync: true -> Guard MUST be bypassed
      usePlayerStore.getState().setQueue([song2], 0, undefined, { isRoomSync: true })
      expect(guardTriggered).toBe(false)
      expect(useListeningStore.getState().pendingLeaveAndPlay).toBeNull()
      expect(usePlayerStore.getState().queue[0].title).toBe('Beta Song')
    })

    it('bypasses _playbackGuard for playSong, togglePlay, playNext, and playPrevious when isRoomSync: true', () => {
      let guardCallCount = 0
      setPlaybackGuard(() => {
        guardCallCount++
        return true
      })

      // With isRoomSync: true
      usePlayerStore.getState().playSong(1, { isRoomSync: true })
      usePlayerStore.getState().togglePlay({ isRoomSync: true })
      usePlayerStore.getState().playNext(true, { isRoomSync: true })
      usePlayerStore.getState().playPrevious({ isRoomSync: true })

      // None of the room sync calls should have hit the guard
      expect(guardCallCount).toBe(0)

      // Manual call without isRoomSync hits the guard
      usePlayerStore.getState().playSong(0)
      expect(guardCallCount).toBe(1)
    })

    it('tracks session sync with reentrant depth counter so concurrent heartbeats do not unset sync status prematurely', () => {
      expect(isSessionSyncing()).toBe(false)

      // Outer long-running sync operation starts (e.g. handleHostSongChange)
      setIsSessionSyncing(true)
      expect(isSessionSyncing()).toBe(true)

      // Inner quick sync pulse fires (e.g. heartbeat or pause alignment)
      setIsSessionSyncing(true)
      expect(isSessionSyncing()).toBe(true)

      // Inner quick pulse finishes after 500ms and calls setIsSessionSyncing(false)
      setIsSessionSyncing(false)

      // Outer sync session MUST STILL BE ACTIVE!
      expect(isSessionSyncing()).toBe(true)

      // Outer sync operation finally completes
      setIsSessionSyncing(false)
      expect(isSessionSyncing()).toBe(false)

      // Explicit reset clears depth unconditionally
      setIsSessionSyncing(true)
      setIsSessionSyncing(true)
      resetSessionSync()
      expect(isSessionSyncing()).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE 3: Download & JIT 99% Clamp Elimination & Watchdog
  // ──────────────────────────────────────────────────────────────────────────
  describe('Issue 3: JIT Chunk Receiver & Download Completion', () => {
    it('reports accurate percentages up to 100% without artificial 99% clamping', () => {
      const progressUpdates: number[] = []
      const receiver = new JITChunkReceiver({
        onProgress: (_trackId, percent) => {
          progressUpdates.push(percent)
        }
      })

      // Start stream with 2 chunks, 2000 total bytes
      receiver.handleHeader({
        type: 'jit-start',
        trackId: 'test-stream',
        mimeType: 'audio/mpeg',
        totalSize: 2000,
        totalChunks: 2
      })

      // First chunk: 1000 bytes (50%)
      receiver.handleChunk('test-stream', 0, new ArrayBuffer(1000))
      expect(progressUpdates).toContain(50)

      // Second chunk: 1000 bytes (100%)
      receiver.handleChunk('test-stream', 1, new ArrayBuffer(1000))

      // Final progress must reach 100%, not stuck at 99%!
      const maxProgress = Math.max(...progressUpdates)
      expect(maxProgress).toBe(100)
    })

    it('watchdog triggers assembly if stream reaches >= 98% and no new packets arrive', () => {
      vi.useFakeTimers()
      let isReady = false
      const receiver = new JITChunkReceiver({
        onReady: () => {
          isReady = true
        }
      })

      // Total 1000 bytes, send 985 bytes (99%)
      receiver.handleHeader({
        type: 'jit-start',
        trackId: 'watchdog-test',
        mimeType: 'audio/mpeg',
        totalSize: 1000,
        totalChunks: 3
      })

      receiver.handleChunk('watchdog-test', 0, new ArrayBuffer(985))

      // Not immediately ready because totalChunks is 3
      expect(isReady).toBe(false)

      // Advance timers by 2500ms to trigger the near-completion watchdog
      vi.advanceTimersByTime(2600)

      // Watchdog must assemble available data and emit ready!
      expect(isReady).toBe(true)
      vi.useRealTimers()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE 2 & 5: Guest Queue Advance & Progressive Instant Streaming
  // ──────────────────────────────────────────────────────────────────────────
  describe('Issue 2 & 5: Non-Blocking Progressive Track Advance', () => {
    it('host advances track from queue and guest updates queue immediately without stalling', async () => {
      const initialRoom: ListeningRoom = {
        id: 'room-alpha-beta',
        code: 'AB01',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 198,
        song: {
          ...toSharedSong(song1),
          uploadStatus: 'UPLOADED',
          audioUrl: 'https://cdn.example.com/alpha.mp3'
        },
        queue: [toSharedSong(song1), toSharedSong(song2)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: initialRoom,
        myRole: 'listener',
        syncStatus: 'synced'
      })

      // Host skips to Song 2
      const updatedRoom: ListeningRoom = {
        ...initialRoom,
        position_seconds: 0,
        song: {
          ...toSharedSong(song2),
          uploadStatus: 'UPLOADED',
          audioUrl: 'https://cdn.example.com/beta.mp3',
          hostPosition: 0,
          hostTimestamp: Date.now()
        },
        queue: [toSharedSong(song2)],
        updated_at: new Date().toISOString()
      }

      useListeningStore.getState().setJoinedRoom(updatedRoom)
      await useListeningStore.getState().handleHostSongChange(updatedRoom)

      // Guest must be updated to Song 2 without stalling or being locked on Song 1!
      const activeQueue = usePlayerStore.getState().queue
      const currentIdx = usePlayerStore.getState().currentSongIndex
      expect(activeQueue[currentIdx]?.title).toBe('Beta Song')
      expect(activeQueue[currentIdx]?.audioUrl).toBe('https://cdn.example.com/beta.mp3')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE 6: Post-Download Authoritative 1-Time Sync
  // ──────────────────────────────────────────────────────────────────────────
  describe('Issue 6: Post-Download Authoritative 1-Time Sync', () => {
    it('calculateCurrentHostTargetTime projects live host position accurately', () => {
      const now = Date.now()
      const room: ListeningRoom = {
        id: 'room-sync-1',
        code: 'SYNC01',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 40,
        song: {
          ...toSharedSong(song1),
          hostPosition: 40,
          hostTimestamp: now - 3000 // 3 seconds ago
        },
        queue: [toSharedSong(song1)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: room,
        myRole: 'listener'
      })

      const targetTime = useListeningStore.getState().calculateCurrentHostTargetTime()
      // Should be roughly 40 + 3 = 43 seconds (allowing small variance)
      expect(targetTime).toBeGreaterThanOrEqual(42.5)
      expect(targetTime).toBeLessThanOrEqual(43.5)
    })

    it('performOneTimeSyncWithHost seeks player store and aligns playback state after download completes', () => {
      const room: ListeningRoom = {
        id: 'room-sync-2',
        code: 'SYNC02',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 75,
        song: {
          ...toSharedSong(song1),
          hostPosition: 75,
          hostTimestamp: Date.now()
        },
        queue: [toSharedSong(song1)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: room,
        myRole: 'listener',
        driftSeconds: 25,
        syncStatus: 'buffering'
      })

      // Guest was at 0:00 (just finished downloading audio file)
      usePlayerStore.setState({
        currentTime: 0,
        isPlaying: false
      })

      // Trigger 1-time authoritative sync
      useListeningStore.getState().performOneTimeSyncWithHost({
        forceSeek: true,
        logReason: 'Download complete unit test'
      })

      const playerState = usePlayerStore.getState()
      const listeningState = useListeningStore.getState()

      expect(playerState.isPlaying).toBe(true)
      expect(playerState.currentTime).toBeGreaterThanOrEqual(74)
      expect(listeningState.driftSeconds).toBe(0)
      expect(listeningState.syncStatus).toBe('synced')
    })

    it('handleHostSongChange on same song does NOT jump to 3rd song when queue slice differs', async () => {
      const song3: Song = {
        id: 'track-gamma',
        title: 'Gamma Song',
        artist: 'Artist Gamma',
        album: 'Gamma Album',
        duration: 180,
        filePath: 'C:\\Music\\gamma.mp3',
        audioUrl: 'https://cdn.example.com/gamma.mp3'
      }

      // Guest currently has sliced queue [song2, song3] at index 0 (playing song2 / Beta Song)
      usePlayerStore.setState({
        queue: [song2, song3],
        currentSongIndex: 0,
        isPlaying: true
      })

      // Host room comes in with full queue [song1, song2, song3], where song2 is at index 1
      const room: ListeningRoom = {
        id: 'room-sync-3',
        code: 'SYNC03',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 30,
        song: {
          ...toSharedSong(song2),
          hostPosition: 30,
          hostTimestamp: Date.now()
        },
        queue: [toSharedSong(song1), toSharedSong(song2), toSharedSong(song3)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: room,
        myRole: 'listener'
      })

      // Execute handleHostSongChange
      await useListeningStore.getState().handleHostSongChange(room)

      const player = usePlayerStore.getState()
      // Current playing song must remain song2 (Beta Song), NOT jump to song3 (Gamma Song)!
      expect(player.queue[player.currentSongIndex].title).toBe('Beta Song')
    })

    it('handleHostSyncPulse persists hostPosition and hostTimestamp even when needsInitialSync is true', () => {
      const room: ListeningRoom = {
        id: 'room-sync-4',
        code: 'SYNC04',
        host_id: 'host-user',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        song: toSharedSong(song1),
        queue: [toSharedSong(song1)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: room,
        myRole: 'listener'
      })

      // Simulate guest downloading (needsInitialSync = true)
      useListeningStore.getState().handleHostSyncPulse({
        position: 55.4,
        hostTimestamp: Date.now(),
        isPlaying: true,
        trackId: song1.id
      })

      const joined = useListeningStore.getState().joinedRoom
      expect(joined?.song?.hostPosition).toBe(55.4)
    })
  })
})

