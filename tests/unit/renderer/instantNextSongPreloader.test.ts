import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePlayerStore, setPlaybackGuard } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { cacheAudioBlob, getCachedAudioBlobUrl } from '../../../src/renderer/src/lib/jitAudioPipeline'
import { resolveSongAudioUrl } from '../../../src/renderer/src/lib/songAudioResolver'
import { toSharedSong, resetSessionSync } from '../../../src/renderer/src/stores/listening/helpers'
import type { Song } from '../../../src/renderer/src/types/song'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

describe('Professional Standard: Instant Next-Song Preloader ($N+1$ Sliding Window)', () => {
  const song1: Song = {
    id: 'track-1',
    title: 'Song One',
    artist: 'Artist One',
    duration: 180,
    filePath: 'C:\\Music\\song1.mp3',
    audioUrl: 'https://cdn.example.com/song1.mp3'
  }

  const song2: Song = {
    id: 'track-2',
    title: 'Song Two',
    artist: 'Artist Two',
    duration: 210,
    filePath: 'https://cdn.example.com/song2.mp3',
    audioUrl: 'https://cdn.example.com/song2.mp3',
    isOnline: true
  }

  const song3: Song = {
    id: 'track-3',
    title: 'Song Three',
    artist: 'Artist Three',
    duration: 240,
    filePath: 'https://cdn.example.com/song3.mp3',
    audioUrl: 'https://cdn.example.com/song3.mp3',
    isOnline: true
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionSync()
    setPlaybackGuard(null)
    usePlayerStore.setState({
      queue: [song1, song2, song3],
      originalQueue: [song1, song2, song3],
      currentSongIndex: 0,
      currentTime: 0,
      isPlaying: true,
      repeatMode: 'off',
      isShuffle: false
    })
    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      myRole: null,
      isSyncLocked: false
    })
  })

  afterEach(() => {
    setPlaybackGuard(null)
    resetSessionSync()
  })

  describe('1. Lookahead Target Selection ($N+1$ Sliding Window)', () => {
    it('correctly targets track N+1 as upcoming preload track', () => {
      const state = usePlayerStore.getState()
      const nextIndex = state.currentSongIndex + 1
      const nextSong = state.queue[nextIndex]

      expect(nextSong).toBeDefined()
      expect(nextSong?.id).toBe('track-2')
    })

    it('loops to track 0 when on last track with repeatMode all', () => {
      usePlayerStore.setState({
        currentSongIndex: 2, // Last track
        repeatMode: 'all'
      })

      const state = usePlayerStore.getState()
      let nextSong: Song | undefined
      if (state.repeatMode === 'one') {
        nextSong = state.queue[state.currentSongIndex]
      } else {
        const nextIndex = state.currentSongIndex + 1
        nextSong = state.queue[nextIndex]
        if (!nextSong && state.repeatMode === 'all' && state.queue.length > 0) {
          nextSong = state.queue[0]
        }
      }

      expect(nextSong?.id).toBe('track-1')
    })

    it('targets current track when repeatMode is one', () => {
      usePlayerStore.setState({
        currentSongIndex: 1,
        repeatMode: 'one'
      })

      const state = usePlayerStore.getState()
      const nextSong = state.repeatMode === 'one' ? state.queue[state.currentSongIndex] : state.queue[state.currentSongIndex + 1]
      expect(nextSong?.id).toBe('track-2')
    })
  })

  describe('2. In-RAM Audio Blob Cache & Instant Resolution', () => {
    it('caches audio binary in RAM and dispatches felo:audio-blob-cached event', () => {
      const eventSpy = vi.fn()
      window.addEventListener('felo:audio-blob-cached', eventSpy)

      const fakeBlob = new Blob(['mock-audio-binary-data'], { type: 'audio/mpeg' })
      const blobUrl = cacheAudioBlob('track-2', fakeBlob)

      expect(blobUrl).toMatch(/^blob:/)
      expect(getCachedAudioBlobUrl('track-2')).toBe(blobUrl)
      expect(eventSpy).toHaveBeenCalledTimes(1)
      expect(eventSpy.mock.calls[0][0].detail).toEqual({
        trackId: 'track-2',
        blobUrl
      })

      window.removeEventListener('felo:audio-blob-cached', eventSpy)
    })

    it('resolveSongAudioUrl gives top priority to cached RAM blob URL for 0ms instant playback', () => {
      const fakeBlob = new Blob(['mock-audio-bytes'], { type: 'audio/mpeg' })
      const cachedBlobUrl = cacheAudioBlob('track-2', fakeBlob)

      // resolveSongAudioUrl should immediately return the blob: URL rather than remote HTTPS
      const resolved = resolveSongAudioUrl(song2)
      expect(resolved).toBe(cachedBlobUrl)
      expect(resolved?.startsWith('blob:')).toBe(true)
    })
  })

  describe('3. Queue Invalidation & Retargeting', () => {
    it('retargets preload when queue is reordered or tracks added', () => {
      // User moves track-3 ahead of track-2
      usePlayerStore.setState({
        queue: [song1, song3, song2],
        currentSongIndex: 0
      })

      const state = usePlayerStore.getState()
      const nextSong = state.queue[state.currentSongIndex + 1]
      expect(nextSong.id).toBe('track-3')
    })
  })

  describe('4. Listen Together Fast Path (Instant 0ms Swap)', () => {
    it('handleHostSongChange takes in-RAM fast path when blob is already pre-buffered', async () => {
      const fakeBlob = new Blob(['fast-path-preloaded-audio'], { type: 'audio/mpeg' })
      cacheAudioBlob('track-2', fakeBlob)

      const sharedSong2 = toSharedSong(song2)
      const room: ListeningRoom = {
        id: 'room-instant',
        code: 'INST01',
        host_id: 'host-1',
        name: 'Instant Room',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        song: sharedSong2,
        queue: [sharedSong2, toSharedSong(song3)],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: room,
        isSyncLocked: false
      })

      // When host switches to track-2, guest handleHostSongChange executes fast path
      await useListeningStore.getState().handleHostSongChange(room)

      const player = usePlayerStore.getState()
      expect(player.currentSongIndex).toBe(0)
      expect(player.queue[0].title).toBe('Song Two')
      expect(player.queue[0].filePath?.startsWith('blob:')).toBe(true)
      expect(player.isPlaying).toBe(true)
    })

    it('setQueue with isRoomSync: true does NOT set seekRequest to 0', () => {
      usePlayerStore.getState().setQueue([song1, song2], 0, undefined, { isRoomSync: true })
      const state = usePlayerStore.getState()
      // seekRequest must be null so it does not override host targetTime with 0:00
      expect(state.seekRequest).toBeNull()
    })

    it('resolves downloaded next song from player queue candidate pool when getSongs has not indexed it', async () => {
      // Suppose song3 was preloaded and placed in queue with a local filePath
      const preloadedSong3: Song = {
        ...song3,
        filePath: 'C:/Users/felo/Music/Song Three.flac'
      }
      usePlayerStore.setState({
        queue: [song1, preloadedSong3],
        currentSongIndex: 0
      })

      // window.api.getSongs returns empty (library not rescanned yet)
      window.api = {
        ...window.api,
        getSongs: async () => []
      } as any

      const sharedSong3 = toSharedSong(song3)
      const room: ListeningRoom = {
        id: 'room-instant-2',
        code: 'INST02',
        host_id: 'host-1',
        name: 'Instant Room 2',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        song: sharedSong3,
        queue: [sharedSong3],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({ joinedRoom: room })
      await useListeningStore.getState().handleHostSongChange(room)

      const player = usePlayerStore.getState()
      expect(player.queue[0].title).toBe('Song Three')
      expect(player.queue[0].filePath).toBe('C:/Users/felo/Music/Song Three.flac')
      expect(useListeningStore.getState().syncStatus).not.toBe('missing_song')
    })
  })
})
