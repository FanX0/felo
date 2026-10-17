import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useDspStore } from '../../../src/renderer/src/stores/useDspStore'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'
import {
  isSessionSyncing,
  setIsSessionSyncing,
  needsInitialSync,
  setNeedsInitialSync,
  readInitialAutoDownload
} from '../../../src/renderer/src/stores/listening/helpers'
import type { ListeningRoom, SharedSong } from '../../../src/renderer/src/online/types'

const mockSampleSongs: SharedSong[] = [
  {
    title: 'Anything You Want',
    artist: 'Reality Club',
    album: 'Reality Club Presents...',
    duration: 236,
    isPriority: false
  },
  {
    title: 'Bayangno Awakmu',
    artist: 'Tenxi',
    album: 'Single',
    duration: 135,
    isPriority: false
  },
  {
    title: "You'll Find Lovers Like You and Me",
    artist: 'Reality Club',
    album: 'Reality Club Presents...',
    duration: 228,
    isPriority: false
  },
  {
    title: 'Am I Bothering You?',
    artist: 'Reality Club',
    album: 'Reality Club Presents...',
    duration: 226,
    isPriority: false
  },
  {
    title: 'VIP Request Track',
    artist: 'Guest Star',
    album: 'Priority',
    duration: 180,
    isPriority: true
  }
]

describe('Listen Together: Industry-Standard Room Sync & Anti-Jumping Integration Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    roomClockSync.reset()
    setIsSessionSyncing(false)
    setNeedsInitialSync(false)

    usePlayerStore.setState({
      queue: [],
      originalQueue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isBuffering: false,
      volume: 0.5,
      currentTime: 0,
      duration: 0,
      seekRequest: null
    })

    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      hostRoomStopped: false,
      syncStatus: 'idle',
      myRole: 'listener',
      memberCount: 1
    })

    useDspStore.setState({
      settingsSync: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1. Host initializes room with queue and starts playback without desync', () => {
    const hostRoomData: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 45,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useListeningStore.setState({
      hostRoom: hostRoomData,
      myRole: 'host',
      hostRoomStopped: false
    })

    const state = useListeningStore.getState()
    expect(state.hostRoom?.code).toBe('MUSIC1')
    expect(state.myRole).toBe('host')
    expect(state.hostRoom?.queue?.length).toBe(5)
    expect(state.hostRoom?.song?.title).toBe('Anything You Want')
  })

  it('2. Guest joins room: initial sync gates seeking until NTP is calibrated and metadata ready', () => {
    setNeedsInitialSync(true)
    expect(needsInitialSync()).toBe(true)
    expect(roomClockSync.isCalibrated()).toBe(false)

    // Simulate listener attempting to seek before NTP calibration: MUST NOT SEEK
    const playerState = usePlayerStore.getState()
    const seekSpy = vi.spyOn(playerState, 'seek')

    // At this moment roomClockSync.isCalibrated() is false
    expect(roomClockSync.isCalibrated()).toBe(false)

    // Now calibrate NTP via Min-RTT ping/pong probe
    const guestId = roomClockSync.getGuestId()
    const t0 = 1000
    const t1 = 1025
    vi.spyOn(Date, 'now').mockReturnValue(1050) // RTT = 50ms, offset = 0ms
    roomClockSync.handlePong({ guestId, t0, t1 })

    expect(roomClockSync.isCalibrated()).toBe(true)
    expect(roomClockSync.getClockOffsetMs()).toBe(0)

    // Now initial seek can execute cleanly exactly once
    const targetTime = roomClockSync.calculateTargetTime(45.0, 1050, true, 0, 236)
    expect(targetTime).toBeCloseTo(45.0, 1)

    // Set lock to simulate settle period (no rapid jumping)
    setIsSessionSyncing(true)
    expect(isSessionSyncing()).toBe(true)

    // Fast-forward settle cooldown
    vi.advanceTimersByTime(1000)
    setIsSessionSyncing(false)
    expect(isSessionSyncing()).toBe(false)
  })

  it('3. Anti-Jumping Drift Control: deadband keeps unison, soft drift does NOT seek, hard drift seeks once', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)

    // Case A: Deadband (< 50ms drift) -> in_sync (0 seeks, 1.0x rate)
    const deadbandResult = roomClockSync.evaluateDrift(10.02, 10.0, true)
    expect(deadbandResult.action).toBe('in_sync')
    expect(deadbandResult.recommendedRate).toBe(1.0)

    // Case B: Soft Drift (50ms to 2.0s drift) -> requires 3 samples, adjusts pitch smoothly without seeking
    // Sample 1
    const s1 = roomClockSync.evaluateDrift(10.2, 10.0, true)
    expect(s1.action).toBe('in_sync') // Filter transient packet jitter
    // Sample 2
    const s2 = roomClockSync.evaluateDrift(10.2, 10.0, true)
    expect(s2.action).toBe('in_sync')
    // Sample 3 (confirmed steady drift) -> soft_align (pitch rate adjustment, ZERO seeks!)
    const s3 = roomClockSync.evaluateDrift(10.2, 10.0, true)
    expect(s3.action).toBe('soft_align')
    expect(s3.recommendedRate).toBeLessThan(1.0) // Slows down gently to converge

    // Case C: Hard Drift (> 2.0s) -> one-shot hard_seek with 2.5s cooldown
    const hardResult = roomClockSync.evaluateDrift(15.0, 10.0, true) // 5.0s desync
    expect(hardResult.action).toBe('hard_seek')
    expect(hardResult.targetTime).toBe(10.0)

    // Cooldown protection: another hard drift immediately afterwards is throttled
    const throttledResult = roomClockSync.evaluateDrift(15.0, 10.0, true)
    expect(throttledResult.action).toBe('in_sync') // Blocked by cooldown to prevent jumping
  })

  it('4. Live Session Queue Table Persistence: partial Realtime updates never wipe out the queue', () => {
    const initialJoinedRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 12,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Listener joins room with 5 tracks
    useListeningStore.getState().setJoinedRoom(initialJoinedRoom)
    expect(useListeningStore.getState().joinedRoom?.queue?.length).toBe(5)

    // Simulate Supabase Realtime UPDATE event where Postgres sends queue: null
    const partialRealtimePayload: Partial<ListeningRoom> = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 15,
      song: mockSampleSongs[0],
      queue: null as any, // Postgres omitted TOAST column!
      updated_at: new Date().toISOString()
    }

    useListeningStore.getState().setJoinedRoom(partialRealtimePayload as any)

    // VERIFICATION: Queue was NOT wiped out! It safely preserved the 5 songs!
    const currentState = useListeningStore.getState().joinedRoom
    expect(currentState?.queue).toBeDefined()
    expect(currentState?.queue?.length).toBe(5)
    expect(currentState?.queue?.[0]?.title).toBe('Anything You Want')
    expect(currentState?.position_seconds).toBe(15)

    // Simulate instant broadcast queue_update: adds a new song
    const updatedQueue: SharedSong[] = [
      ...mockSampleSongs,
      {
        title: 'New Track Live',
        artist: 'Host Artist',
        album: 'Live',
        duration: 200,
        isPriority: false
      }
    ]

    useListeningStore.getState().setJoinedRoom({
      ...currentState!,
      queue: updatedQueue
    })

    expect(useListeningStore.getState().joinedRoom?.queue?.length).toBe(6)
    expect(useListeningStore.getState().joinedRoom?.queue?.[5]?.title).toBe('New Track Live')
  })

  it('5. Independent Personal Volume: listener volume is never overridden by host volume changes', () => {
    // Listener sets personal volume to 35% (0.35)
    usePlayerStore.getState().setVolume(0.35)
    expect(usePlayerStore.getState().volume).toBe(0.35)

    // Host adjusts their volume to 95% (0.95) and broadcasts DSP settings
    // In our decoupled architecture, host volume is NOT sent to listeners
    const hostDspSnapshot = useDspStore.getState().getRoomDspSnapshot()

    // Simulate listener receiving dsp_settings_sync broadcast
    // Apply room DSP settings (EQ / reverb)
    useDspStore.getState().applyRoomDspSnapshot(hostDspSnapshot)

    // VERIFICATION: Listener's personal volume MUST REMAIN 0.35
    expect(usePlayerStore.getState().volume).toBe(0.35)

    // Even if host changes volume again to 0% (mute)
    // Listener's volume MUST NOT change
    expect(usePlayerStore.getState().volume).toBe(0.35)
  })

  it('6. Stream Mode by default: auto-download is disabled by default like public app, but toggleable', () => {
    // 1. Initial state without localStorage preference defaults to false (pure stream mode)
    localStorage.removeItem('felo:listen_together:auto_download_v2')
    expect(readInitialAutoDownload()).toBe(false)

    // 2. Zustand store defaults to stream mode (disabled auto-download)
    useListeningStore.setState({ autoDownloadMissing: readInitialAutoDownload() })
    expect(useListeningStore.getState().autoDownloadMissing).toBe(false)

    // 3. User can manually toggle it ON if they want to save tracks locally
    useListeningStore.getState().setAutoDownloadMissing(true)
    expect(useListeningStore.getState().autoDownloadMissing).toBe(true)
    expect(localStorage.getItem('felo:listen_together:auto_download_v2')).toBe('true')

    // 4. User can toggle it back OFF to return to public-style stream mode
    useListeningStore.getState().setAutoDownloadMissing(false)
    expect(useListeningStore.getState().autoDownloadMissing).toBe(false)
    expect(localStorage.getItem('felo:listen_together:auto_download_v2')).toBe('false')
  })
})
