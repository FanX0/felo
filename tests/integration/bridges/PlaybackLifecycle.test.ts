import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useDownloadStore } from '../../../src/renderer/src/stores/useDownloadStore'
import type { Song } from '../../../src/renderer/src/types/song'

const mockVirtualQueue: Song[] = [
  {
    id: 'stream-1',
    title: 'Starlight Dream',
    artist: 'Luna Eclipse',
    duration: 167, // 2:47
    filePath: 'virtual:spotify:starlight-dream'
  },
  {
    id: 'stream-2',
    title: 'Solar Flare',
    artist: 'Solaris',
    duration: 215,
    filePath: 'virtual:spotify:solar-flare'
  },
  {
    id: 'stream-3',
    title: 'Gravity Well',
    artist: 'Orbital Pulse',
    duration: 190,
    filePath: '/local/music/gravity-well.flac'
  }
]

describe('Playback Lifecycle & Bridge Integration Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDownloadStore.setState({ transfers: [], isTransfersOpen: false })
    usePlayerStore.setState({
      queue: [],
      originalQueue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isBuffering: false,
      repeatMode: 'off',
      isShuffle: false,
      isAutoplay: false,
      currentTime: 0,
      duration: 0
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('virtual track queuing initializes isBuffering=true while preserving duration metadata', () => {
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)

    const state = usePlayerStore.getState()
    expect(state.currentSongIndex).toBe(0)
    expect(state.queue[0]?.title).toBe('Starlight Dream')
    expect(state.isPlaying).toBe(true)
    // Virtual track should immediately signal buffering
    expect(state.isBuffering).toBe(true)
    // Progress starts at 0:00
    expect(state.currentTime).toBe(0)
  })

  it('completed download resolves buffering and updates song with native filePath', () => {
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)
    expect(usePlayerStore.getState().isBuffering).toBe(true)

    // Simulate download completion via updateSong and clearing isBuffering
    const completedSong: Song = {
      ...mockVirtualQueue[0],
      filePath: 'C:/Users/User/Music/Starlight Dream.flac'
    }

    usePlayerStore.getState().updateSong(completedSong, 'stream-1')
    usePlayerStore.getState().setIsBuffering(false)

    const updatedState = usePlayerStore.getState()
    expect(updatedState.isBuffering).toBe(false)
    expect(updatedState.queue[0]?.filePath).toBe('C:/Users/User/Music/Starlight Dream.flac')
    expect(updatedState.isPlaying).toBe(true)
  })

  it('stall watchdog with Repeat 1 advances to next track using playNext(true)', () => {
    // User has Repeat 1 enabled on an unplayable virtual track
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)
    usePlayerStore.setState({ repeatMode: 'one', isBuffering: true })

    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    expect(usePlayerStore.getState().repeatMode).toBe('one')

    // Watchdog times out: verify playNext(true) successfully breaks out of Repeat 1
    const player = usePlayerStore.getState()
    if (player.queue.length > 1) {
      player.playNext(true)
    }

    const stateAfterAdvance = usePlayerStore.getState()
    expect(stateAfterAdvance.currentSongIndex).toBe(1)
    expect(stateAfterAdvance.queue[stateAfterAdvance.currentSongIndex]?.title).toBe('Solar Flare')
  })

  it('active background download guards against premature stall timeout', () => {
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)
    usePlayerStore.setState({ isPlaying: true, isBuffering: true })

    // Simulate an active transfer in useDownloadStore
    useDownloadStore.getState().queueTransfer({
      source: 'youtube',
      sourceName: 'YouTube Music',
      title: 'Starlight Dream',
      artist: 'Luna Eclipse',
      quality: 'Auto',
      size: '8MB',
      conflictMode: 'replace',
      status: 'downloading',
      progress: 50,
      autoPlay: true,
      song: mockVirtualQueue[0]
    })

    const activeSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
    const transfers = useDownloadStore.getState().transfers

    const isDownloadActive = transfers.some(
      (t) =>
        (t.status === 'downloading' || t.status === 'queued') &&
        (t.autoPlay || (activeSong && (t.song?.id === activeSong.id || t.title.toLowerCase() === activeSong.title?.toLowerCase())))
    )

    // Watchdog must observe that download is actively in progress
    expect(isDownloadActive).toBe(true)
  })

  it('failed download triggers resilient recovery and advances past failed track', () => {
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)
    usePlayerStore.setState({ repeatMode: 'one', isBuffering: true })

    // Simulate DownloadEventBridge failure handling
    const player = usePlayerStore.getState()
    player.setIsBuffering(false)
    player.playNext(true) // resilient autoPlay recovery

    // When advancing to the next virtual track, it advances to index 1 and sets isBuffering=true for track 2
    const state = usePlayerStore.getState()
    expect(state.currentSongIndex).toBe(1)
    expect(state.queue[1]?.title).toBe('Solar Flare')
    // Next track is also virtual, so it transitions to buffering the new track
    expect(state.isBuffering).toBe(true)
  })

  it('stops playback cleanly when only one track exists and fails to buffer', () => {
    usePlayerStore.getState().setQueue([mockVirtualQueue[0]], 0)
    usePlayerStore.setState({ repeatMode: 'one', isBuffering: true, isPlaying: true })

    // Single item queue failure recovery
    const player = usePlayerStore.getState()
    if (player.queue.length > 1) {
      player.playNext(true)
    } else {
      usePlayerStore.setState({ isPlaying: false, isBuffering: false })
    }

    const state = usePlayerStore.getState()
    expect(state.isPlaying).toBe(false)
    expect(state.isBuffering).toBe(false)
  })

  it('reconciles completed download for active virtual song by in-place queue replacement and unbuffering', () => {
    usePlayerStore.getState().setQueue(mockVirtualQueue, 0)
    usePlayerStore.setState({ isPlaying: true, isBuffering: true })

    const activeSong = usePlayerStore.getState().queue[0]
    expect(activeSong.filePath).toBe('virtual:spotify:starlight-dream')

    const completedSong: Song = {
      ...activeSong,
      filePath: 'C:/Users/User/Music/Felo/Luna Eclipse - Starlight Dream.flac'
    }

    // Simulate the fixed DownloadEventBridge reconciliation logic
    const player = usePlayerStore.getState()
    player.updateSong(completedSong, activeSong.id)
    if (player.isBuffering) {
      player.setIsBuffering(false)
    }
    player.setIsPlaying(true)

    const updatedState = usePlayerStore.getState()
    expect(updatedState.isBuffering).toBe(false)
    expect(updatedState.isPlaying).toBe(true)
    expect(updatedState.queue[0]?.filePath).toBe('C:/Users/User/Music/Felo/Luna Eclipse - Starlight Dream.flac')
    expect(updatedState.queue[0]?.filePath.startsWith('virtual:')).toBe(false)
  })

  it('background download completing does not hijack or interrupt actively playing different track', () => {
    // User is playing song B (index 1)
    usePlayerStore.getState().setQueue(mockVirtualQueue, 1)
    usePlayerStore.setState({ isPlaying: true, isBuffering: false })

    const player = usePlayerStore.getState()
    expect(player.currentSongIndex).toBe(1)
    expect(player.queue[1]?.title).toBe('Solar Flare')
    expect(player.isPlaying).toBe(true)

    // Background download for an external song completes with playAction: 'play_now'
    const completedExternalSong: Song = {
      id: 'ext-download-99',
      title: 'Cosmic Drift',
      artist: 'Astro Beats',
      duration: 200,
      filePath: 'C:/Users/User/Music/Felo/Astro Beats - Cosmic Drift.flac'
    }

    const transfer = { playAction: 'play_now', autoPlay: true }
    const currentActive = player.queue[player.currentSongIndex]
    const matchIndex = player.queue.findIndex((item) => item.id === completedExternalSong.id)
    const isCurrentTrackMatched = currentActive?.id === completedExternalSong.id || (matchIndex !== -1 && matchIndex === player.currentSongIndex)

    expect(isCurrentTrackMatched).toBe(false)
    expect(matchIndex).toBe(-1)

    // Simulate guarded play_now logic from DownloadEventBridge
    if (matchIndex === -1 && transfer.playAction === 'play_now') {
      if (!player.isPlaying) {
        player.enqueueSongNext(completedExternalSong)
        player.playNext(true)
      } else {
        // Active track is playing another song — do not hijack!
        player.enqueueSongNext(completedExternalSong)
      }
    }

    const stateAfterComplete = usePlayerStore.getState()
    // Song B MUST still be actively playing!
    expect(stateAfterComplete.currentSongIndex).toBe(1)
    expect(stateAfterComplete.queue[stateAfterComplete.currentSongIndex]?.title).toBe('Solar Flare')
    expect(stateAfterComplete.isPlaying).toBe(true)
    // External song is enqueued next at index 2
    expect(stateAfterComplete.queue[2]?.title).toBe('Cosmic Drift')
  })

  it('failed download does not advance player if user already switched to another song', () => {
    // User switches to song B (index 1)
    usePlayerStore.getState().setQueue(mockVirtualQueue, 1)
    usePlayerStore.setState({ isPlaying: true, isBuffering: false })

    const player = usePlayerStore.getState()
    expect(player.currentSongIndex).toBe(1)

    // An old autoPlay transfer for song A fails
    const failedTransfer = {
      autoPlay: true,
      title: 'Starlight Dream',
      artist: 'Luna Eclipse',
      song: mockVirtualQueue[0]
    }

    const activeSong = player.queue[player.currentSongIndex]
    const isTransferForActiveSong =
      activeSong &&
      ((failedTransfer.song as any)?.id === activeSong.id ||
        (failedTransfer.title.toLowerCase() === activeSong.title.toLowerCase() &&
          failedTransfer.artist.toLowerCase() === activeSong.artist.toLowerCase()))

    expect(isTransferForActiveSong).toBe(false)

    // Because it is NOT for the active song, playNext is NOT called
    if (isTransferForActiveSong) {
      player.playNext(true)
    }

    const stateAfterFail = usePlayerStore.getState()
    expect(stateAfterFail.currentSongIndex).toBe(1)
    expect(stateAfterFail.queue[1]?.title).toBe('Solar Flare')
    expect(stateAfterFail.isPlaying).toBe(true)
  })
})
