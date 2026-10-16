import { describe, it, expect, beforeEach } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/hooks/usePlayerStore'
import type { Song } from '../../../src/renderer/src/types/song'

const mockSongs: Song[] = [
  {
    id: '1',
    title: 'First Track',
    artist: 'Artist A',
    album: 'Album 1',
    duration: 180,
    filePath: 'path/1.mp3'
  },
  {
    id: '2',
    title: 'Second Track',
    artist: 'Artist B',
    album: 'Album 2',
    duration: 210,
    filePath: 'path/2.mp3'
  },
  {
    id: '3',
    title: 'Third Track',
    artist: 'Artist C',
    album: 'Album 3',
    duration: 240,
    filePath: 'path/3.mp3'
  }
]

describe('Renderer Integration: usePlayerStore', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      originalQueue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isShuffle: false,
      repeatMode: 'off',
      volume: 0.8,
      currentTime: 0,
      duration: 0
    })
  })

  it('sets queue and plays initial track', () => {
    usePlayerStore.getState().setQueue(mockSongs, 0)

    const state = usePlayerStore.getState()
    expect(state.queue).toHaveLength(3)
    expect(state.currentSongIndex).toBe(0)
    expect(state.queue[state.currentSongIndex]?.id).toBe('1')
    expect(state.isPlaying).toBe(true)
  })

  it('navigates through queue with playNext() and playPrevious()', () => {
    usePlayerStore.getState().setQueue(mockSongs, 0)

    usePlayerStore.getState().playNext()
    expect(usePlayerStore.getState().currentSongIndex).toBe(1)

    usePlayerStore.getState().playNext()
    expect(usePlayerStore.getState().currentSongIndex).toBe(2)

    usePlayerStore.getState().playPrevious()
    expect(usePlayerStore.getState().currentSongIndex).toBe(1)
  })

  it('toggles repeatMode across off -> all -> one -> off', () => {
    expect(usePlayerStore.getState().repeatMode).toBe('off')

    usePlayerStore.getState().toggleRepeat()
    expect(usePlayerStore.getState().repeatMode).toBe('all')

    usePlayerStore.getState().toggleRepeat()
    expect(usePlayerStore.getState().repeatMode).toBe('one')

    usePlayerStore.getState().toggleRepeat()
    expect(usePlayerStore.getState().repeatMode).toBe('off')
  })

  it('cycles back to beginning on playNext() if repeatMode is all', () => {
    usePlayerStore.getState().setQueue(mockSongs, 2) // last song
    usePlayerStore.setState({ repeatMode: 'all' })

    usePlayerStore.getState().playNext()
    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
  })

  it('enqueues and removes songs from queue', () => {
    usePlayerStore.getState().setQueue([mockSongs[0]], 0)
    expect(usePlayerStore.getState().queue).toHaveLength(1)

    usePlayerStore.getState().enqueueSong(mockSongs[1])
    expect(usePlayerStore.getState().queue).toHaveLength(2)

    usePlayerStore.getState().removeSongFromQueueByIndex(1)
    expect(usePlayerStore.getState().queue).toHaveLength(1)
  })

  it('mutes volume to 0 and restores previous volume', () => {
    usePlayerStore.getState().setVolume(0.7)
    expect(usePlayerStore.getState().volume).toBe(0.7)

    usePlayerStore.getState().toggleMute()
    expect(usePlayerStore.getState().volume).toBe(0)

    usePlayerStore.getState().toggleMute()
    expect(usePlayerStore.getState().volume).toBe(0.7)
  })
})
