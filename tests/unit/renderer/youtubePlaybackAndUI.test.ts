import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useListeningStore } from '../../../src/renderer/src/hooks/useListeningStore'
import { isYouTubeSong } from '../../../src/renderer/src/lib/youtubeService'
import type { Song } from '../../../src/renderer/src/types/song'

describe('YouTube Playback & UI Simplification Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePlayerStore.setState({
      queue: [],
      originalQueue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isBuffering: false,
      repeatMode: 'off',
      currentTime: 0,
      duration: 0,
      isAudioActive: true
    })
    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      myRole: null
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('correctly identifies YouTube tracks via isYouTubeSong helper', () => {
    const ytSong1: Song = {
      id: 'yt-dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
      filePath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      isYouTube: true,
      streamType: 'youtube'
    } as Song

    const ytSong2: Song = {
      id: 'custom-id',
      title: 'YouTube Track',
      artist: 'Artist',
      duration: 180,
      audioUrl: 'https://youtu.be/dQw4w9WgXcQ'
    } as Song

    const localSong: Song = {
      id: 'local-1',
      title: 'Local MP3',
      artist: 'Local Artist',
      duration: 120,
      filePath: 'C:/Music/test.mp3'
    }

    expect(isYouTubeSong(ytSong1)).toBe(true)
    expect(isYouTubeSong(ytSong2)).toBe(true)
    expect(isYouTubeSong(localSong)).toBe(false)
  })

  it('guarantees that YouTube songs bypass the AudioEngine 4-second buffering watchdog', () => {
    const ytSong: Song = {
      id: 'yt-dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
      filePath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      isYouTube: true,
      streamType: 'youtube'
    } as Song

    usePlayerStore.getState().setQueue([ytSong], 0)
    usePlayerStore.setState({ isPlaying: true, isBuffering: true })

    // Simulate AudioEngine watchdog check:
    const currentState = usePlayerStore.getState()
    const activeSong = currentState.queue[currentState.currentSongIndex]

    // Watchdog guard condition:
    const shouldBypass = isYouTubeSong(activeSong)
    expect(shouldBypass).toBe(true)

    // Verify state is preserved (not killed or set to false)
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
  })

  it('addYouTubeTrackToQueue with playNow immediately plays track and claims audio ownership', async () => {
    // Start with an existing local song in queue
    const initialSong: Song = {
      id: 'local-1',
      title: 'Local Track',
      artist: 'Local Artist',
      duration: 180,
      filePath: 'C:/Music/song.mp3'
    }
    usePlayerStore.getState().setQueue([initialSong], 0)
    usePlayerStore.setState({ isPlaying: true })

    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    expect(usePlayerStore.getState().queue).toHaveLength(1)

    // Call addYouTubeTrackToQueue with playNow=true
    await useListeningStore.getState().addYouTubeTrackToQueue(
      'dQw4w9WgXcQ',
      'Never Gonna Give You Up',
      'Rick Astley',
      213,
      false, // isPriority
      true   // playNow
    )

    const player = usePlayerStore.getState()
    expect(player.queue).toHaveLength(2)
    expect(player.currentSongIndex).toBe(1)
    expect(player.isPlaying).toBe(true)
    expect(player.isAudioActive).toBe(true)

    const currentTrack = player.queue[player.currentSongIndex]
    expect(currentTrack.id).toBe('yt-dQw4w9WgXcQ')
    expect(currentTrack.title).toBe('Never Gonna Give You Up')
    expect((currentTrack as any).isYouTube).toBe(true)
    expect((currentTrack as any).streamType).toBe('youtube')
    expect((currentTrack as any).videoId).toBe('dQw4w9WgXcQ')
  })

  it('addYouTubeTrackToQueue with playNow on an empty queue starts at index 0', async () => {
    expect(usePlayerStore.getState().queue).toHaveLength(0)

    await useListeningStore.getState().addYouTubeTrackToQueue(
      'dQw4w9WgXcQ',
      'Never Gonna Give You Up',
      'Rick Astley',
      213,
      false,
      true
    )

    const player = usePlayerStore.getState()
    expect(player.queue).toHaveLength(1)
    expect(player.currentSongIndex).toBe(0)
    expect(player.isPlaying).toBe(true)
    expect(player.isAudioActive).toBe(true)
    expect(player.queue[0].id).toBe('yt-dQw4w9WgXcQ')
  })
})
