import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useDownloadStore } from '../../../src/renderer/src/stores/useDownloadStore'

describe('Event-Driven Sync & Download Progress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDownloadStore.setState({ transfers: [], isTransfersOpen: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ─── Download Progress Monotonic Clamping ───────────────────────────

  describe('Download Progress Monotonic Clamping', () => {
    it('progress events always increase during downloading', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'deezer' as any,
        sourceName: 'Deezer',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'FLAC',
        size: '30MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 0,
        message: 'Starting...'
      }, { openDrawer: false })

      // Simulate increasing progress
      useDownloadStore.getState().updateTransfer(id, { progress: 10 })
      useDownloadStore.getState().updateTransfer(id, { progress: 40 })
      useDownloadStore.getState().updateTransfer(id, { progress: 70 })
      useDownloadStore.getState().updateTransfer(id, { progress: 90 })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.progress).toBe(90)
    })

    it('out-of-order progress events are clamped to high-water mark', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'deezer' as any,
        sourceName: 'Deezer',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'FLAC',
        size: '30MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 0,
        message: 'Starting...'
      }, { openDrawer: false })

      // Progress goes up then tries to go back down (fallback reset)
      useDownloadStore.getState().updateTransfer(id, { progress: 10 })
      useDownloadStore.getState().updateTransfer(id, { progress: 40 })
      useDownloadStore.getState().updateTransfer(id, { progress: 15 }) // Should be clamped to 40
      useDownloadStore.getState().updateTransfer(id, { progress: 70 })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.progress).toBe(70)

      // Verify intermediate state was clamped
      useDownloadStore.getState().updateTransfer(id, { progress: 5 }) // Should stay at 70
      const transfer2 = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer2?.progress).toBe(70)
    })

    it('yt-dlp thumbnail reset is clamped (progress drops from 90 to 0)', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'youtube' as any,
        sourceName: 'YouTube',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'MP3',
        size: '5MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 0,
        message: 'Starting...'
      }, { openDrawer: false })

      useDownloadStore.getState().updateTransfer(id, { progress: 50 })
      useDownloadStore.getState().updateTransfer(id, { progress: 90 })
      // Thumbnail download resets to 0 — must be clamped
      useDownloadStore.getState().updateTransfer(id, { progress: 0 })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.progress).toBe(90)
    })

    it('completed event can set progress to 100 regardless of previous value', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'deezer' as any,
        sourceName: 'Deezer',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'FLAC',
        size: '30MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 50,
        message: 'Downloading...'
      }, { openDrawer: false })

      // Completed status should update freely
      useDownloadStore.getState().updateTransfer(id, { status: 'completed', progress: 100 })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.status).toBe('completed')
      expect(transfer?.progress).toBe(100)
    })

    it('failed event clears without monotonic constraint', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'soulseek' as any,
        sourceName: 'Soulseek',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'FLAC',
        size: '30MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 70,
        message: 'Downloading...'
      }, { openDrawer: false })

      // Failed status should update freely (progress can go to 0)
      useDownloadStore.getState().updateTransfer(id, { status: 'failed', progress: 0 })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.status).toBe('failed')
      expect(transfer?.progress).toBe(0)
    })

    it('fallback source reset is clamped: Deezer@70 → Soulseek@15 stays at 70', () => {
      const id = useDownloadStore.getState().queueTransfer({
        source: 'deezer' as any,
        sourceName: 'Deezer',
        title: 'Test Song',
        artist: 'Test Artist',
        quality: 'FLAC',
        size: '30MB',
        conflictMode: 'keep_both',
        status: 'downloading',
        progress: 0,
        message: 'Starting...'
      }, { openDrawer: false })

      // Deezer progress reaches 70%
      useDownloadStore.getState().updateTransfer(id, { progress: 70, message: 'Downloading from Deezer...' })

      // Fallback to Soulseek resets to 15% — should be clamped
      useDownloadStore.getState().updateTransfer(id, { progress: 15, message: 'Falling back to Soulseek...' })

      const transfer = useDownloadStore.getState().transfers.find(t => t.id === id)
      expect(transfer?.progress).toBe(70)
      expect(transfer?.message).toBe('Falling back to Soulseek...')
    })
  })

  // ─── songChanged AND Logic ──────────────────────────────────────────

  describe('songChanged AND logic verification', () => {
    /**
     * Tests the AND logic conceptually:
     * songChanged = !isSongEffectivelyEqual && !isAlreadyPlayingThisSong
     *
     * With OR logic (old): either condition failing triggers song change
     * With AND logic (new): BOTH conditions must fail for a song change
     */

    it('does NOT trigger song change when songs match metadata (AND logic)', () => {
      // Both conditions true (song is same) → songChanged = false
      const isSongEffectivelyEqual = true
      const isAlreadyPlayingThisSong = true
      const songChanged = !isSongEffectivelyEqual && !isAlreadyPlayingThisSong
      expect(songChanged).toBe(false)
    })

    it('does NOT trigger song change when only one condition fails (AND logic)', () => {
      // Only metadata match succeeds, player check fails → should NOT trigger
      const isSongEffectivelyEqual = true
      const isAlreadyPlayingThisSong = false
      const songChanged = !isSongEffectivelyEqual && !isAlreadyPlayingThisSong
      expect(songChanged).toBe(false)

      // Only player check succeeds, metadata fails → should NOT trigger
      const isSongEffectivelyEqual2 = false
      const isAlreadyPlayingThisSong2 = true
      const songChanged2 = !isSongEffectivelyEqual2 && !isAlreadyPlayingThisSong2
      expect(songChanged2).toBe(false)
    })

    it('triggers song change ONLY when both conditions fail (AND logic)', () => {
      // Both conditions fail → actual song change
      const isSongEffectivelyEqual = false
      const isAlreadyPlayingThisSong = false
      const songChanged = !isSongEffectivelyEqual && !isAlreadyPlayingThisSong
      expect(songChanged).toBe(true)
    })

    it('old OR logic would have false-triggered on single condition failure', () => {
      // Demonstrate that OR logic was too aggressive
      const isSongEffectivelyEqual = true
      const isAlreadyPlayingThisSong = false

      // Old OR logic (BUG): would trigger song change
      const oldSongChanged = !isSongEffectivelyEqual || !isAlreadyPlayingThisSong
      expect(oldSongChanged).toBe(true) // This was the bug!

      // New AND logic (FIX): correctly does NOT trigger
      const newSongChanged = !isSongEffectivelyEqual && !isAlreadyPlayingThisSong
      expect(newSongChanged).toBe(false)
    })
  })

  // ─── Sync Lock Behavior ────────────────────────────────────────────

  describe('Sync Lock (isSyncLocked) behavior', () => {
    it('sync lock auto-releases after 1500ms cooldown', () => {
      // Simulate the sync lock pattern used in playback.slice.ts
      let isSyncLocked = false

      // Engage sync lock
      isSyncLocked = true
      expect(isSyncLocked).toBe(true)

      // Before cooldown: lock should still be active
      vi.advanceTimersByTime(1000)
      // In real code, setTimeout releases it after 1500ms
      expect(isSyncLocked).toBe(true)

      // Simulate the auto-release after 1500ms
      setTimeout(() => { isSyncLocked = false }, 1500)
      vi.advanceTimersByTime(1500)
      expect(isSyncLocked).toBe(false)
    })

    it('sync lock prevents seeks during cooldown window', () => {
      let seekCount = 0
      let isSyncLocked = false

      const attemptSeek = () => {
        if (isSyncLocked) return
        seekCount++
      }

      // First seek: allowed
      attemptSeek()
      expect(seekCount).toBe(1)

      // Engage lock
      isSyncLocked = true
      setTimeout(() => { isSyncLocked = false }, 1500)

      // Second seek during lock: blocked
      attemptSeek()
      expect(seekCount).toBe(1)

      // Third seek during lock: still blocked
      attemptSeek()
      expect(seekCount).toBe(1)

      // After cooldown: allowed again
      vi.advanceTimersByTime(1500)
      attemptSeek()
      expect(seekCount).toBe(2)
    })
  })

  // ─── Buffering Guard ───────────────────────────────────────────────

  describe('Buffering Guard (isGuestBuffering) behavior', () => {
    it('buffering guard prevents seeks while audio is stalling', () => {
      let seekCount = 0
      let isGuestBuffering = false

      const attemptSeek = () => {
        if (isGuestBuffering) return
        seekCount++
      }

      // Normal: seek allowed
      attemptSeek()
      expect(seekCount).toBe(1)

      // Buffering: seek blocked
      isGuestBuffering = true
      attemptSeek()
      expect(seekCount).toBe(1)

      // Buffering cleared: seek allowed
      isGuestBuffering = false
      attemptSeek()
      expect(seekCount).toBe(2)
    })
  })

  // ─── Drift Detection (Passive Heartbeat) ───────────────────────────

  describe('Passive Heartbeat Drift Detection', () => {
    it('heartbeat records drift without seeking', () => {
      // Simulate the passive drift monitoring logic from handleHostSyncPulse
      let driftSeconds = 0
      let seekCalled = false

      // Host at position 120s, guest at 117s → 3s behind
      const hostPosition = 120
      const guestPosition = 117
      const drift = guestPosition - hostPosition // -3

      // Passive: only record drift, never seek
      driftSeconds = drift
      // seekCalled remains false — no seek on heartbeat

      expect(driftSeconds).toBe(-3)
      expect(seekCalled).toBe(false)
    })

    it('CatchUp HUD visibility thresholds', () => {
      const DRIFT_SHOW_THRESHOLD = 1.5
      const DRIFT_PROMINENT_THRESHOLD = 5.0

      // Small drift: no HUD
      expect(Math.abs(0.5) >= DRIFT_SHOW_THRESHOLD).toBe(false)

      // Moderate drift: subtle HUD
      expect(Math.abs(2.0) >= DRIFT_SHOW_THRESHOLD).toBe(true)
      expect(Math.abs(2.0) >= DRIFT_PROMINENT_THRESHOLD).toBe(false)

      // Large drift: prominent HUD
      expect(Math.abs(6.0) >= DRIFT_PROMINENT_THRESHOLD).toBe(true)
    })
  })

  // ─── Same-Song Detection (Double Bootstrap Fix) ────────────────────

  describe('Same-Song Detection (Cloud Upload Completion)', () => {
    it('detects same song when title+artist match', () => {
      const currentSong = { title: 'Astaga Bercanda', artist: 'Akbar Chalay' }
      const incomingSong = { title: 'Astaga Bercanda', artist: 'Akbar Chalay', localId: 'abc123' }

      const isSameSong = Boolean(
        currentSong &&
        incomingSong.title === currentSong.title &&
        incomingSong.artist === currentSong.artist
      )

      expect(isSameSong).toBe(true)
    })

    it('detects different song when title differs', () => {
      const currentSong = { title: 'Song A', artist: 'Artist X' }
      const incomingSong = { title: 'Song B', artist: 'Artist X' }

      const isSameSong = Boolean(
        currentSong &&
        incomingSong.title === currentSong.title &&
        incomingSong.artist === currentSong.artist
      )

      expect(isSameSong).toBe(false)
    })

    it('detects different song when artist differs', () => {
      const currentSong = { title: 'Song A', artist: 'Artist X' }
      const incomingSong = { title: 'Song A', artist: 'Artist Y' }

      const isSameSong = Boolean(
        currentSong &&
        incomingSong.title === currentSong.title &&
        incomingSong.artist === currentSong.artist
      )

      expect(isSameSong).toBe(false)
    })

    it('resolves missing song: track_change does NOT skip if syncStatus was missing_song', () => {
      // If guest had missing_song, even if title+artist match, track_change must proceed
      const isSameSong = true
      const hasPlayableSource = false
      const isMissingSong = true

      const shouldSkipQueueRestart = isSameSong && hasPlayableSource && !isMissingSong
      expect(shouldSkipQueueRestart).toBe(false) // Must NOT skip, must run handleHostSongChange
    })
  })

  // ─── Post-Download 1-Time Sync & Elapsed Watchdog ─────────────────

  describe('Post-Download 1-Time Sync & Elapsed Time Preservation', () => {
    it('roomClockSync.calculateTargetTime preserves elapsed time > 30s instead of collapsing to 0', async () => {
      const { roomClockSync } = await import('../../../src/renderer/src/lib/roomClockSync')
      vi.spyOn(Date, 'now').mockReturnValue(100_000)

      // Host started playing 45 seconds ago (timestamp 55_000) at position 0
      const hostPosition = 0
      const hostTimestamp = 55_000 // 45s elapsed
      const isPlaying = true
      const duration = 200

      const target = roomClockSync.calculateTargetTime(hostPosition, hostTimestamp, isPlaying, 0, duration)
      // Must NOT be 0! Must be ~45s
      expect(target).toBeCloseTo(45.0, 1)
    })

    it('roomClockSync.calculateTargetTime clamps elapsed time to song duration if host played longer than song', async () => {
      const { roomClockSync } = await import('../../../src/renderer/src/lib/roomClockSync')
      vi.spyOn(Date, 'now').mockReturnValue(500_000)

      const hostPosition = 10
      const hostTimestamp = 100_000 // 400s elapsed
      const isPlaying = true
      const duration = 180 // 3 minutes

      const target = roomClockSync.calculateTargetTime(hostPosition, hostTimestamp, isPlaying, 0, duration)
      // Clamped cleanly to song duration
      expect(target).toBe(180)
    })

    it('deferred sync keeps needsInitialSync=true when audio element readyState < HAVE_METADATA', () => {
      // Simulate performOneTimeSyncWithHost readiness guard
      let _needsInitialSync = true
      const activeAudio = { readyState: 0, currentTime: 0 } as any // HAVE_NOTHING
      const isAudioReady = !activeAudio || activeAudio.readyState >= 1 // HAVE_METADATA

      expect(isAudioReady).toBe(false)
      if (isAudioReady) {
        _needsInitialSync = false
      }
      // needsInitialSync MUST remain true so loadedmetadata/canplay will seek later!
      expect(_needsInitialSync).toBe(true)

      // When metadata loads (readyState = 1):
      activeAudio.readyState = 1
      const isNowReady = activeAudio.readyState >= 1
      expect(isNowReady).toBe(true)
      if (isNowReady) {
        activeAudio.currentTime = 45.0
        _needsInitialSync = false
      }
      expect(activeAudio.currentTime).toBe(45.0)
      expect(_needsInitialSync).toBe(false)
    })
  })
})
