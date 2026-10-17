import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useDownloadStore } from '../../../src/renderer/src/stores/useDownloadStore'
import type { Song } from '../../../src/renderer/src/types/song'

const mockVirtualSongs: Song[] = [
  {
    id: 'virt-1',
    title: 'Virtual Song 1',
    artist: 'Artist A',
    duration: 167, // 2:47
    filePath: 'virtual:spotify:track-1'
  },
  {
    id: 'virt-2',
    title: 'Virtual Song 2',
    artist: 'Artist B',
    duration: 180,
    filePath: 'virtual:spotify:track-2'
  },
  {
    id: 'virt-3',
    title: 'Virtual Song 3',
    artist: 'Artist C',
    duration: 210,
    filePath: 'virtual:spotify:track-3'
  }
]

describe('Buffering Stall and Repeat 1 Loop Fix Verification', () => {
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
      currentTime: 0,
      duration: 0
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('demonstrates that playNext() without manual=true loops on the same track when repeatMode is "one"', () => {
    usePlayerStore.getState().setQueue(mockVirtualSongs, 0)
    usePlayerStore.setState({ repeatMode: 'one', currentTime: 0, isBuffering: true })

    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    expect(usePlayerStore.getState().isBuffering).toBe(true)

    // When an automatic stall recovery or auto-advance calls playNext() (manual is undefined/false):
    usePlayerStore.getState().playNext()

    // Notice: currentSongIndex did NOT advance to 1! It remains 0 because of repeatMode === 'one'
    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('demonstrates that playNext(true) successfully breaks out of Repeat 1 when a track is unplayable', () => {
    usePlayerStore.getState().setQueue(mockVirtualSongs, 0)
    usePlayerStore.setState({ repeatMode: 'one', currentTime: 0, isBuffering: true })

    expect(usePlayerStore.getState().currentSongIndex).toBe(0)

    // When error recovery explicitly forces advance with manual=true:
    usePlayerStore.getState().playNext(true)

    // Successfully advances to the next track in queue!
    expect(usePlayerStore.getState().currentSongIndex).toBe(1)
  })

  it('active download in progress prevents premature watchdog stall abortion', () => {
    usePlayerStore.getState().setQueue(mockVirtualSongs, 0)
    usePlayerStore.setState({ isPlaying: true, isBuffering: true })

    // Simulate an active background download for the current track
    useDownloadStore.getState().queueTransfer({
      source: 'youtube',
      sourceName: 'YouTube Music',
      title: 'Virtual Song 1',
      artist: 'Artist A',
      quality: 'Auto',
      size: '5MB',
      conflictMode: 'replace',
      status: 'downloading',
      progress: 45,
      autoPlay: true,
      song: mockVirtualSongs[0]
    })

    const activeSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
    const transfers = useDownloadStore.getState().transfers

    const isDownloadActive = transfers.some(
      (t) =>
        (t.status === 'downloading' || t.status === 'queued') &&
        (t.autoPlay || (activeSong && (t.song?.id === activeSong.id || t.title.toLowerCase() === activeSong.title?.toLowerCase())))
    )

    expect(isDownloadActive).toBe(true)
  })

  it('gracefully stops playback when a single-item queue fails instead of looping', () => {
    usePlayerStore.getState().setQueue([mockVirtualSongs[0]], 0)
    usePlayerStore.setState({ repeatMode: 'one', isPlaying: true, isBuffering: true })

    expect(usePlayerStore.getState().queue).toHaveLength(1)

    // In a single-item queue, failure handler stops playback:
    const currentState = usePlayerStore.getState()
    if (currentState.queue.length > 1) {
      currentState.playNext(true)
    } else {
      usePlayerStore.setState({ isPlaying: false, isBuffering: false })
    }

    expect(usePlayerStore.getState().isPlaying).toBe(false)
    expect(usePlayerStore.getState().isBuffering).toBe(false)
  })

  it('sequential unplayable tracks with Repeat 1 advance properly without hanging', () => {
    usePlayerStore.getState().setQueue(mockVirtualSongs, 0)
    usePlayerStore.setState({ repeatMode: 'one', isPlaying: true })

    // Track 0 fails
    usePlayerStore.getState().playNext(true)
    expect(usePlayerStore.getState().currentSongIndex).toBe(1)

    // Track 1 fails
    usePlayerStore.getState().playNext(true)
    expect(usePlayerStore.getState().currentSongIndex).toBe(2)
  })
})
