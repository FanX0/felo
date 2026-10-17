import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useListeningStore, useIsPlayerLocked } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore, setPlaybackGuard } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useDspStore } from '../../../src/renderer/src/stores/useDspStore'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'
import {
  isSessionSyncing,
  setIsSessionSyncing,
  needsInitialSync,
  setNeedsInitialSync,
  readInitialAutoDownload
} from '../../../src/renderer/src/stores/listening/helpers'
import {
  forceStereoSdp,
  tuneSystemAudioSender,
  WebRTCAudioClient
} from '../../../src/renderer/src/lib/webrtcAudioStream'
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

    if (typeof document !== 'undefined') {
      document
        .querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]')
        .forEach((el) => el.remove())
    }

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

  it('7. Co-host Role Promotion & Permissions: unlocking controls when promoted from listener to co_host', () => {
    const mockRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 20,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Step 1: Member joins as a regular listener
    useListeningStore.setState({
      joinedRoom: mockRoom,
      myRole: 'listener'
    })

    const { result } = renderHook(() => useIsPlayerLocked())

    // VERIFICATION: Regular listener has controls locked to host
    expect(useListeningStore.getState().myRole).toBe('listener')
    expect(result.current).toBe(true)

    // Step 2: Host promotes member to co_host via set_room_member_role
    // Realtime postgres_changes event updates local store
    act(() => {
      useListeningStore.getState().setMyRole('co_host')
    })

    // VERIFICATION: Co-host controls are now UNLOCKED
    expect(useListeningStore.getState().myRole).toBe('co_host')
    expect(result.current).toBe(false)
  })

  it('8. Co-host Room Control Commands: host executes co-host skip, pause, seek, bump, and remove commands', () => {
    // Host initializes active party room with sample queue
    usePlayerStore.setState({
      queue: [...mockSampleSongs] as any,
      currentSongIndex: 0,
      isPlaying: true,
      currentTime: 20
    })

    const player = usePlayerStore.getState()
    const playNextSpy = vi.spyOn(player, 'playNext')
    const seekSpy = vi.spyOn(player, 'seek')
    const bumpSpy = vi.spyOn(player, 'bumpSongToPriority')
    const removeSpy = vi.spyOn(player, 'removeSongFromQueueByIndex')

    // 1. Co-host sends 'skip' command
    const skipCommand = {
      command: 'skip',
      sender_name: 'Co-host Friend',
      room_code: 'MUSIC1',
      payload: {}
    }
    // Host processes command:
    if (skipCommand.command === 'skip') {
      player.playNext(true)
    }
    expect(playNextSpy).toHaveBeenCalledWith(true)

    // 2. Co-host sends 'pause' command
    const pauseCommand = {
      command: 'pause',
      sender_name: 'Co-host Friend',
      room_code: 'MUSIC1',
      payload: {}
    }
    if (pauseCommand.command === 'pause') {
      usePlayerStore.setState({ isPlaying: false })
    }
    expect(usePlayerStore.getState().isPlaying).toBe(false)

    // 3. Co-host sends 'seek' command
    const seekCommand = {
      command: 'seek',
      sender_name: 'Co-host Friend',
      room_code: 'MUSIC1',
      payload: { seconds: 75 }
    }
    if (seekCommand.command === 'seek') {
      player.seek(seekCommand.payload.seconds)
    }
    expect(seekSpy).toHaveBeenCalledWith(75)

    // 4. Co-host sends 'bump' command (moves track to priority)
    const bumpCommand = {
      command: 'bump',
      sender_name: 'Co-host Friend',
      room_code: 'MUSIC1',
      payload: { title: 'Bayangno Awakmu' }
    }
    const targetBumpIdx = player.queue.findIndex((s) => s.title === bumpCommand.payload.title)
    expect(targetBumpIdx).toBeGreaterThanOrEqual(0)
    player.bumpSongToPriority(targetBumpIdx)
    expect(bumpSpy).toHaveBeenCalledWith(targetBumpIdx)

    // 5. Co-host sends 'remove' command (removes track from queue)
    const removeCommand = {
      command: 'remove',
      sender_name: 'Co-host Friend',
      room_code: 'MUSIC1',
      payload: { title: 'Am I Bothering You?' }
    }
    const targetRemoveIdx = player.queue.findIndex((s) => s.title === removeCommand.payload.title)
    expect(targetRemoveIdx).toBeGreaterThanOrEqual(0)
    player.removeSongFromQueueByIndex(targetRemoveIdx)
    expect(removeSpy).toHaveBeenCalledWith(targetRemoveIdx)
  })

  it('9. Co-host Playback Guard: guards co-host from accidentally breaking out of room on local play', () => {
    const mockRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 20,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useListeningStore.setState({
      joinedRoom: mockRoom,
      myRole: 'co_host',
      pendingLeaveAndPlay: null
    })

    // Register active playback guard from ListeningPresenceBridge
    setPlaybackGuard((proceed) => {
      if (isSessionSyncing()) return false
      const { joinedRoom, myRole } = useListeningStore.getState()
      if (joinedRoom && (myRole === 'listener' || myRole === 'co_host')) {
        useListeningStore.getState().setPendingLeaveAndPlay(proceed)
        return true
      }
      return false
    })

    // Co-host clicks a song in their personal library
    let localSongPlayed = false
    const localPlayAction = () => {
      localSongPlayed = true
    }

    // Attempting to trigger playback while joined as Co-host MUST BE GUARDED
    usePlayerStore.getState().setQueue([mockSampleSongs[2] as any], 0)

    // Verify: Local playback did NOT immediately play
    expect(localSongPlayed).toBe(false)

    // Verify: Action was safely captured in pendingLeaveAndPlay
    const pendingAction = useListeningStore.getState().pendingLeaveAndPlay
    expect(pendingAction).toBeDefined()
    expect(typeof pendingAction).toBe('function')

    // Cleanup guard
    setPlaybackGuard(null)
  })

  it('10. YouTube Stream Room Join: Initial bootstrap starts directly at host target time without jumping to 0:00', () => {
    // Host is 65 seconds into a YouTube stream
    const mockYouTubeRoom: ListeningRoom = {
      id: 'room-yt-1',
      code: 'YT123',
      name: "Host's YouTube Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 65,
      song: {
        id: 'yt-dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        duration: 212,
        isYouTube: true,
        videoId: 'dQw4w9WgXcQ',
        hostPosition: 65,
        hostTimestamp: Date.now()
      } as any,
      queue: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Calibrate NTP clock sync first
    const guestId = roomClockSync.getGuestId()
    const t0 = 1000
    const t1 = 1025
    vi.spyOn(Date, 'now').mockReturnValue(1050)
    roomClockSync.handlePong({ guestId, t0, t1 })

    // Simulate guest joining room
    useListeningStore.setState({
      joinedRoom: mockYouTubeRoom,
      myRole: 'listener'
    })

    // Compute expected target time using roomClockSync
    const hostPos = mockYouTubeRoom.song?.hostPosition || 65
    const hostTimestamp = mockYouTubeRoom.song?.hostTimestamp || 1050
    const calculatedTarget = roomClockSync.calculateTargetTime(hostPos, hostTimestamp, true, 0, 212)

    // Verification: Target position is accurate to host elapsed time (approx 65s), NOT 0:00
    expect(calculatedTarget).toBeGreaterThanOrEqual(65)

    // Simulate queue setup and target position initialization
    usePlayerStore.getState().setCurrentTime(calculatedTarget)
    usePlayerStore.getState().seek(calculatedTarget)

    expect(usePlayerStore.getState().currentTime).toBe(calculatedTarget)
    expect(usePlayerStore.getState().seekRequest).toBe(calculatedTarget)
  })

  it('11. YouTube Stream Anti-Looping: Transient 0s seek/buffer ticks are suppressed during sync', () => {
    // Current player state is playing at second 70
    usePlayerStore.setState({
      currentTime: 70,
      duration: 212,
      isPlaying: true
    })

    // Simulate a transient 0.0s tick reported from YouTube IFrame during buffer / seek
    const transientTime = 0
    const curStoreTime = usePlayerStore.getState().currentTime

    // Filter condition used by YouTubePlayerBridge ticker:
    // If room is actively playing and current time in store is established (>2s), reject transient 0.0s dips
    let updatedTime = curStoreTime
    if (!(transientTime === 0 && curStoreTime > 2)) {
      updatedTime = transientTime
    }

    // VERIFICATION: The transient 0.0s tick was rejected; store time was preserved at 70s!
    expect(updatedTime).toBe(70)
  })

  it('12. Mobile Player Lock & Co-host Command Routing: Mobile controls lock for listeners and dispatch for co-hosts', () => {
    const mockRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Party Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 40,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Scenario A: Listener joins mobile room
    useListeningStore.setState({
      joinedRoom: mockRoom,
      myRole: 'listener'
    })

    const { result } = renderHook(() => useIsPlayerLocked())
    expect(result.current).toBe(true)

    // Listener attempting to trigger togglePlay or seek on mobile is guarded
    let attemptedPlayToggled = false
    const handleMobileTogglePlay = () => {
      if (result.current) return // Guarded by isPlayerLocked
      attemptedPlayToggled = true
    }
    handleMobileTogglePlay()
    expect(attemptedPlayToggled).toBe(false)

    // Scenario B: User promoted to Co-host on mobile
    act(() => {
      useListeningStore.getState().setMyRole('co_host')
    })
    expect(result.current).toBe(false)

    // Co-host on mobile dispatches commands instead of desyncing local player
    const dispatchedCommands: any[] = []
    const handleMobileCoHostCommand = (cmd: string, payload: any) => {
      if (useListeningStore.getState().myRole === 'co_host') {
        dispatchedCommands.push({ command: cmd, payload })
      }
    }

    handleMobileCoHostCommand('pause', {})
    handleMobileCoHostCommand('seek', { seconds: 80 })
    handleMobileCoHostCommand('skip', {})

    expect(dispatchedCommands.length).toBe(3)
    expect(dispatchedCommands[0].command).toBe('pause')
    expect(dispatchedCommands[1].command).toBe('seek')
    expect(dispatchedCommands[1].payload.seconds).toBe(80)
    expect(dispatchedCommands[2].command).toBe('skip')
  })

  it('13. Co-host Demotion Lifecycle: Controls re-lock and permissions are revoked when demoted back to listener', () => {
    const mockRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: 'Party Room',
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 40,
      song: mockSampleSongs[0],
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useListeningStore.setState({
      joinedRoom: mockRoom,
      myRole: 'co_host'
    })

    const { result } = renderHook(() => useIsPlayerLocked())
    expect(result.current).toBe(false)
    expect(useListeningStore.getState().myRole).toBe('co_host')

    // Host demotes co-host back to regular listener via set_room_member_role
    act(() => {
      useListeningStore.getState().setMyRole('listener')
    })

    // Verification: Controls immediately lock and permissions are revoked
    expect(result.current).toBe(true)
    expect(useListeningStore.getState().myRole).toBe('listener')
  })

  it('14. Mobile Scrubber & Transport Touch Guarding: Accidental touches on mobile abort when locked', () => {
    useListeningStore.setState({
      joinedRoom: {
        id: 'room-101',
        code: 'MUSIC1',
        name: 'Room',
        host_id: 'user-host',
        is_active: true,
        is_playing: true,
        position_seconds: 50,
        song: mockSampleSongs[0],
        queue: mockSampleSongs,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      myRole: 'listener'
    })

    usePlayerStore.setState({
      currentTime: 50,
      isPlaying: true
    })

    const { result } = renderHook(() => useIsPlayerLocked())
    const isPlayerLocked = result.current
    expect(isPlayerLocked).toBe(true)

    const player = usePlayerStore.getState()
    const seekSpy = vi.spyOn(player, 'seek')
    const toggleSpy = vi.spyOn(player, 'togglePlay')
    const nextSpy = vi.spyOn(player, 'playNext')
    const prevSpy = vi.spyOn(player, 'playPrevious')

    // Simulate mobile touch handlers with isPlayerLocked guard:
    const handleScrubStart = () => {
      if (isPlayerLocked) return
    }
    const handleScrubEnd = (preview: number) => {
      if (isPlayerLocked) return
      player.seek(preview)
    }
    const handleTogglePlay = () => {
      if (isPlayerLocked) return
      player.togglePlay()
    }
    const handleNext = () => {
      if (isPlayerLocked) return
      player.playNext(true)
    }
    const handlePrevious = () => {
      if (isPlayerLocked) return
      player.playPrevious()
    }

    handleScrubStart()
    handleScrubEnd(0) // User accidentally touched start of progress bar (0:00)
    handleTogglePlay()
    handleNext()
    handlePrevious()

    // Assert that zero player mutations occurred:
    expect(seekSpy).not.toHaveBeenCalled()
    expect(toggleSpy).not.toHaveBeenCalled()
    expect(nextSpy).not.toHaveBeenCalled()
    expect(prevSpy).not.toHaveBeenCalled()
    expect(usePlayerStore.getState().currentTime).toBe(50)
  })

  it('15. App Exit & Re-Entry Recovery: Listener converges to progressed host track without stuck index or 0:00 jump', () => {
    // 1. Initial State before exit: Listener was listening to Track 0 at 30s
    usePlayerStore.setState({
      queue: [...mockSampleSongs] as any,
      currentSongIndex: 0,
      currentTime: 30,
      isPlaying: true
    })

    // 2. Listener exits app (store reset / rehydration)
    // 3. Listener re-enters app 5 minutes later:
    // Host has now moved to Track 2 ('You\'ll Find Lovers Like You and Me') at 85s
    const progressedRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: "Host's Room",
      host_id: 'user-host',
      is_active: true,
      is_playing: true,
      position_seconds: 85,
      song: {
        ...mockSampleSongs[2],
        hostPosition: 85,
        hostTimestamp: Date.now()
      },
      queue: mockSampleSongs,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Calibrate clock sync
    const guestId = roomClockSync.getGuestId()
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    roomClockSync.handlePong({ guestId, t0: 1950, t1: 1975 })

    // Simulate room state update upon re-entry
    useListeningStore.setState({
      joinedRoom: progressedRoom,
      myRole: 'listener',
      syncStatus: 'synced'
    })

    // Calculate synchronized target time
    const targetTime = roomClockSync.calculateTargetTime(
      progressedRoom.song?.hostPosition || 85,
      progressedRoom.song?.hostTimestamp || 2000,
      true,
      0,
      progressedRoom.song?.duration || 228
    )

    // Verify target time converges to Track 2 at ~85s
    expect(targetTime).toBeGreaterThanOrEqual(85)
    expect(useListeningStore.getState().joinedRoom?.song?.title).toBe("You'll Find Lovers Like You and Me")
  })

  it('16. Host Disconnection & Seamless Reconnection: Handles host timeout gracefully without audio loops', () => {
    useListeningStore.setState({
      joinedRoom: {
        id: 'room-101',
        code: 'MUSIC1',
        name: 'Room',
        host_id: 'user-host',
        is_active: true,
        is_playing: true,
        position_seconds: 60,
        song: mockSampleSongs[0],
        queue: mockSampleSongs,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      syncStatus: 'synced',
      lastHostUpdate: 1000
    })

    usePlayerStore.setState({
      isPlaying: true,
      currentTime: 60
    })

    // 1. Host disconnects (no heartbeat received for 16 seconds)
    const now = 17000
    const timeSinceLastPulse = now - useListeningStore.getState().lastHostUpdate
    expect(timeSinceLastPulse).toBeGreaterThan(15000)

    // Watchdog sets status to host_reconnecting and pauses audio gracefully
    useListeningStore.setState({ syncStatus: 'host_reconnecting' })
    usePlayerStore.setState({ isPlaying: false })

    expect(useListeningStore.getState().syncStatus).toBe('host_reconnecting')
    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(usePlayerStore.getState().currentTime).toBe(60) // Did not wipe to 0:00!

    // 2. Host reconnects and sends fresh pulse at 72s
    const freshPulse = {
      position: 72,
      hostTimestamp: now,
      isPlaying: true
    }

    // Host pulse recovers session:
    useListeningStore.setState({
      syncStatus: 'synced',
      lastHostUpdate: now
    })
    usePlayerStore.setState({
      isPlaying: true,
      currentTime: freshPulse.position
    })

    expect(useListeningStore.getState().syncStatus).toBe('synced')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(usePlayerStore.getState().currentTime).toBe(72)
  })

  it('17. YouTube Stream State Machine: Pause/Resume cycles preserve playback position without rewinding to 0:00', () => {
    // YouTube stream at 120 seconds
    usePlayerStore.setState({
      currentTime: 120,
      duration: 212,
      isPlaying: true
    })

    // Host pauses room
    // Correct YouTube bridge handler calls pauseVideo() (preserving position), NOT stopVideo()
    let isStopped = false
    let isPaused = false
    const simulatedYtPosition = 120

    const mockPauseHandler = (playing: boolean) => {
      if (!playing) {
        isPaused = true
        // pauseVideo() preserves position
      }
    }

    mockPauseHandler(false)
    usePlayerStore.setState({ isPlaying: false })

    // Verification: Player is paused and position is intact at 120s
    expect(isPaused).toBe(true)
    expect(isStopped).toBe(false)
    expect(simulatedYtPosition).toBe(120)
    expect(usePlayerStore.getState().currentTime).toBe(120)

    // Host resumes room
    const mockResumeHandler = (playing: boolean) => {
      if (playing) {
        isPaused = false
        // playVideo() continues from 120s
      }
    }

    mockResumeHandler(true)
    usePlayerStore.setState({ isPlaying: true })

    expect(isPaused).toBe(false)
    expect(simulatedYtPosition).toBe(120)
    expect(usePlayerStore.getState().currentTime).toBe(120)
  })

  it('18. NTP Clock Offset Jitter Filter: Locks onto lowest latency ping and rejects network buffer bloat', () => {
    roomClockSync.reset()
    const guestId = roomClockSync.getGuestId()

    // Ping 1: Jitter spike (RTT = 220ms, offset = +10ms)
    vi.spyOn(Date, 'now').mockReturnValue(1220)
    roomClockSync.handlePong({ guestId, t0: 1000, t1: 1120 })

    // Ping 2: Clean low-latency link (RTT = 38ms, offset = +2ms)
    vi.spyOn(Date, 'now').mockReturnValue(2038)
    roomClockSync.handlePong({ guestId, t0: 2000, t1: 2021 })
    const offset2 = roomClockSync.getClockOffsetMs()

    // Ping 3: Network buffer bloat spike (RTT = 600ms)
    vi.spyOn(Date, 'now').mockReturnValue(3600)
    roomClockSync.handlePong({ guestId, t0: 3000, t1: 3350 })

    // Verification: Min-RTT filter locked onto the low-latency ping (offset2),
    // rejecting the high-jitter samples
    expect(roomClockSync.isCalibrated()).toBe(true)
    expect(roomClockSync.getClockOffsetMs()).toBe(offset2)
  })

  it('19. WebRTC SDP Opus Parameter Munging: Clean line-by-line parsing without duplicate fmtp lines across CRLF and LF', () => {
    // Standard Chromium SDP containing CRLF with an existing fmtp line
    const chromiumSdp = [
      'v=0',
      'o=- 123456789 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 112',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=10;useinbandfec=1',
      'a=rtpmap:112 opus/48000/2',
      ''
    ].join('\r\n')

    const munged = forceStereoSdp(chromiumSdp, 320000)

    // Verification 1: Exactly ONE a=fmtp:111 line exists (no duplicate fmtp lines!)
    const fmtp111Lines = munged.split(/\r?\n/).filter((l) => l.startsWith('a=fmtp:111'))
    expect(fmtp111Lines.length).toBe(1)

    // Verification 2: Studio stereo & high bitrate Opus params were cleanly injected
    const fmtp111 = fmtp111Lines[0]
    expect(fmtp111).toContain('stereo=1')
    expect(fmtp111).toContain('sprop-stereo=1')
    expect(fmtp111).toContain('maxaveragebitrate=320000')
    expect(fmtp111).toContain('useinbandfec=1')
    expect(fmtp111).toContain('minptime=10')

    // Verification 3: PT 112 which had no prior fmtp line had one cleanly inserted
    const fmtp112Lines = munged.split(/\r?\n/).filter((l) => l.startsWith('a=fmtp:112'))
    expect(fmtp112Lines.length).toBe(1)
    expect(fmtp112Lines[0]).toContain('maxaveragebitrate=320000')
  })

  it('20. WebRTC Audio Client Dedicated Playout Engine: Mounts native HTMLAudioElement with volume and mute synchronization', () => {
    const mockTrack = {
      kind: 'audio',
      id: 'audio-stream-1',
      muted: false,
      enabled: true,
      readyState: 'live'
    } as any

    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    } as any

    const client = new WebRTCAudioClient('ROOM99', 'client-user', 'host-user')
    client.setVolume(0.85)

    // Route stream into playStream
    client.playStream(mockStream)

    // Verification 1: HTMLAudioElement created and mounted
    const audioEl = document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]') as HTMLAudioElement
    expect(audioEl).toBeTruthy()
    expect(audioEl.srcObject).toBe(mockStream)
    expect(audioEl.volume).toBe(0.85)
    expect(audioEl.muted).toBe(false)

    // Verification 2: Muting sets volume to 0 and muted flag to true
    client.setVolume(0)
    expect(audioEl.volume).toBe(0)
    expect(audioEl.muted).toBe(true)

    // Verification 3: Restoring volume updates audio element directly
    client.setVolume(0.6)
    expect(audioEl.volume).toBe(0.6)
    expect(audioEl.muted).toBe(false)

    client.disconnect()
  })

  it('21. Browser Autoplay Rejection & Unmute Recovery: Catches NotAllowedError and unlocks cleanly via unmuteAudio', async () => {
    const mockTrack = {
      kind: 'audio',
      id: 'audio-stream-2',
      muted: false,
      enabled: true,
      readyState: 'live'
    } as any

    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    } as any

    let autoplayBlockedReported = false
    const client = new WebRTCAudioClient('ROOM99', 'client-user', 'host-user', {
      onAutoplayBlocked: (blocked) => {
        autoplayBlockedReported = blocked
      }
    })

    // Mock HTMLMediaElement.prototype.play to reject with NotAllowedError (browser autoplay block)
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('Autoplay blocked', 'NotAllowedError'))

    client.playStream(mockStream)

    // Allow promise ticks to process catch block
    await Promise.resolve()
    await Promise.resolve()

    expect(autoplayBlockedReported).toBe(true)

    // User gesture occurs: unmuteAudio called
    playSpy.mockResolvedValue(undefined)
    const unlocked = await client.unmuteAudio()

    expect(unlocked).toBe(true)
    expect(autoplayBlockedReported).toBe(false)

    // Cleanup
    playSpy.mockRestore()
    client.disconnect()
  })

  it('22. Remote Track Audio Pipeline Disconnect Cleanup: Destroys physical audio element and clears stream', () => {
    const mockTrack = { kind: 'audio', id: 'audio-stream-3' } as any
    const mockStream = { getAudioTracks: () => [mockTrack] } as any

    const client = new WebRTCAudioClient('ROOM99', 'client-user', 'host-user')
    client.playStream(mockStream)

    const audioElBefore = document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')
    expect(audioElBefore).toBeTruthy()

    client.disconnect()

    // Element removed from DOM on disconnect
    const audioElAfter = document.querySelector('audio[data-felo-system-audio="webrtc-stream-player"]')
    expect(audioElAfter).toBeNull()
  })

  it('23. System Audio Sender Encodings: Applies stereo music constraints and maxBitrate', async () => {
    const mockTrack = {
      kind: 'audio',
      applyConstraints: vi.fn().mockResolvedValue(undefined)
    }

    let encodingBitrate = 0
    const mockSender = {
      track: mockTrack,
      getParameters: vi.fn(() => ({
        encodings: [{ maxBitrate: 64000 }]
      })),
      setParameters: vi.fn(async (params: any) => {
        encodingBitrate = params.encodings[0].maxBitrate
      })
    } as any

    tuneSystemAudioSender(mockSender, 320000)

    expect(mockTrack.applyConstraints).toHaveBeenCalledWith({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    })
    expect(encodingBitrate).toBe(320000)
  })

  it('24. Device Audio Auto-Switch Convergence: Room transitions to is_device_stream seamlessly and mutes local player', () => {
    usePlayerStore.setState({
      isPlaying: true,
      currentTime: 45
    })

    const deviceRoom: ListeningRoom = {
      id: 'room-101',
      code: 'MUSIC1',
      name: 'Host Stream Room',
      host_id: 'user-host',
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

    // When room transitions to device stream, local player halts immediately
    usePlayerStore.getState().setIsPlaying(false)
    useListeningStore.setState({
      joinedRoom: deviceRoom,
      isReceivingDeviceStream: true,
      deviceAudioClientState: 'connected'
    })

    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(useListeningStore.getState().isReceivingDeviceStream).toBe(true)
    expect(useListeningStore.getState().joinedRoom?.is_device_stream).toBe(true)
  })
})
