import { create } from 'zustand'
import { Song } from '../pages/Library/Library'
import { markSongAsStarted } from '../lib/playbackEvents'

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlaybackContext {
  type: 'album' | 'playlist' | 'artist' | 'library' | 'search'
  id?: string
  title: string
  subtitle?: string
  route?: string
}

interface PlayerState {
  queue: Song[]
  originalQueue: Song[] // preserves original order when shuffle is on
  currentSongIndex: number
  isPlaying: boolean
  isBuffering: boolean
  volume: number
  currentTime: number
  duration: number
  isShuffle: boolean
  repeatMode: RepeatMode
  seekRequest: number | null // used by AudioEngine to jump to a specific time
  playbackContext: PlaybackContext | null

  // Actions
  setQueue: (queue: Song[], startPlayingIndex?: number, context?: PlaybackContext | null) => void
  setPlaybackContext: (context: PlaybackContext | null) => void
  enqueueSong: (song: Song) => void
  enqueueSongNext: (song: Song) => void
  playSong: (index: number) => void
  togglePlay: () => void
  playNext: (manual?: boolean) => void
  playPrevious: () => void
  removeSongFromQueue: (songId: string) => void
  removeSongFromQueueByIndex: (index: number) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  clearQueue: () => void
  clearUpcomingQueue: () => void
  setIsPlaying: (isPlaying: boolean) => void
  setIsBuffering: (isBuffering: boolean) => void
  setVolume: (volume: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  seek: (time: number) => void
  clearSeekRequest: () => void
  updateSong: (song: Song) => void
}

// Helper to shuffle an array (Fisher-Yates)
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export const RECENTLY_PLAYED_STORAGE_KEY = 'felo_recently_played'
export const PLAY_STATS_STORAGE_KEY = 'felo_play_stats'
export const PLAYED_SONGS_STORAGE_KEY = 'felo_played_songs'

let persistTimeout: ReturnType<typeof setTimeout> | null = null
let pendingSongToRemember: Song | null = null

function flushRememberPlayedSong(): void {
  const song = pendingSongToRemember
  if (!song) return
  pendingSongToRemember = null
  markSongAsStarted(song)
}

function rememberPlayedSong(song?: Song): void {
  if (!song) return
  pendingSongToRemember = song
  if (persistTimeout) clearTimeout(persistTimeout)
  persistTimeout = setTimeout(flushRememberPlayedSong, 150)
}

function getMigratedPreference(key: string, legacyKey: string, fallback: string): string {
  const current = localStorage.getItem(key)
  if (current !== null) return current
  const legacy = localStorage.getItem(legacyKey)
  if (legacy !== null) {
    localStorage.setItem(key, legacy)
    return legacy
  }
  return fallback
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  originalQueue: [],
  currentSongIndex: -1,
  isPlaying: false,
  isBuffering: false,
  volume: parseFloat(getMigratedPreference('felo_volume', 'fanx_volume', '1')),
  currentTime: 0,
  duration: 0,
  isShuffle: getMigratedPreference('felo_shuffle', 'fanx_shuffle', 'false') === 'true',
  repeatMode: (['off', 'all', 'one'].includes(getMigratedPreference('felo_repeat', 'fanx_repeat', 'off'))
    ? (getMigratedPreference('felo_repeat', 'fanx_repeat', 'off') as RepeatMode)
    : 'off'),
  playbackContext: null,
  seekRequest: null,

  setPlaybackContext: (playbackContext) => set({ playbackContext }),
  setIsBuffering: (isBuffering) => set({ isBuffering }),

  setQueue: (newQueue, startPlayingIndex = 0, context) => {
    const { isShuffle } = get()
    rememberPlayedSong(newQueue[startPlayingIndex] || newQueue[0])
    const contextToSet = context !== undefined ? context : get().playbackContext
    if (isShuffle && newQueue.length > 0) {
      const selectedSong = newQueue[startPlayingIndex] || newQueue[0]
      const remaining = newQueue.filter((_, idx) => idx !== startPlayingIndex)
      const shuffled = [selectedSong, ...shuffleArray(remaining)]
      set({
        originalQueue: newQueue,
        queue: shuffled,
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 0,
        seekRequest: 0,
        playbackContext: contextToSet
      })
    } else {
      set({
        originalQueue: newQueue,
        queue: newQueue,
        currentSongIndex: startPlayingIndex,
        isPlaying: true,
        currentTime: 0,
        seekRequest: 0,
        playbackContext: contextToSet
      })
    }
  },

  enqueueSong: (song) => {
    set((state) => {
      if (state.queue.some((item) => item.id === song.id)) return state
      const queue = [...state.queue, song]
      return {
        queue,
        originalQueue: [...state.originalQueue, song]
      }
    })
  },

  enqueueSongNext: (song) => {
    set((state) => {
      const existingIndex = state.queue.findIndex((item) => item.id === song.id)
      const newQueue = [...state.queue]
      if (existingIndex >= 0) {
        newQueue.splice(existingIndex, 1)
      }
      const insertIndex = Math.min(newQueue.length, state.currentSongIndex + 1)
      newQueue.splice(insertIndex, 0, song)

      // Safely insert into originalQueue without destroying original sequence
      const existingOrigIndex = state.originalQueue.findIndex((item) => item.id === song.id)
      const newOriginalQueue = [...state.originalQueue]
      if (existingOrigIndex >= 0) {
        newOriginalQueue.splice(existingOrigIndex, 1)
      }
      const currentSong = state.queue[state.currentSongIndex]
      const origCurrentIdx = currentSong
        ? newOriginalQueue.findIndex((item) => item.id === currentSong.id)
        : -1
      const origInsertIdx =
        origCurrentIdx >= 0
          ? Math.min(newOriginalQueue.length, origCurrentIdx + 1)
          : newOriginalQueue.length
      newOriginalQueue.splice(origInsertIdx, 0, song)

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue
      }
    })
  },

  playSong: (index) => {
    const song = get().queue[index]
    rememberPlayedSong(song)
    set({
      currentSongIndex: index,
      isPlaying: true,
      currentTime: 0,
      seekRequest: 0
    })
  },

  togglePlay: () => {
    const { currentSongIndex, queue, isPlaying } = get()
    if (queue.length === 0 || currentSongIndex < 0 || currentSongIndex >= queue.length) {
      if (typeof window !== 'undefined' && window.api?.getSongs) {
        void window.api.getSongs().then((songs: Song[]) => {
          if (Array.isArray(songs) && songs.length > 0) {
            const sorted = [...songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
            get().setQueue(sorted, 0)
          }
        })
      }
      return
    }
    set({ isPlaying: !isPlaying })
  },

  playNext: (manual = false) => {
    const { currentSongIndex, queue, originalQueue, repeatMode, isShuffle } = get()
    if (queue.length === 0) return

    // If auto-advancing from track end and repeat mode is 'one', repeat the current track
    if (repeatMode === 'one' && !manual) {
      rememberPlayedSong(queue[currentSongIndex])
      set({ seekRequest: 0, currentTime: 0, isPlaying: true })
      return
    }

    if (currentSongIndex < queue.length - 1) {
      rememberPlayedSong(queue[currentSongIndex + 1])
      set({ currentSongIndex: currentSongIndex + 1, isPlaying: true, currentTime: 0, seekRequest: 0 })
    } else if (repeatMode === 'all') {
      if (isShuffle && originalQueue.length > 1) {
        // Generate a fresh shuffle order on queue loop so the playlist stays fresh
        const freshShuffled = shuffleArray(originalQueue)
        rememberPlayedSong(freshShuffled[0])
        set({
          queue: freshShuffled,
          currentSongIndex: 0,
          isPlaying: true,
          currentTime: 0,
          seekRequest: 0
        })
      } else {
        rememberPlayedSong(queue[0])
        set({ currentSongIndex: 0, isPlaying: true, currentTime: 0, seekRequest: 0 })
      }
    } else {
      // End of playlist
      set({ isPlaying: false, currentTime: 0 })
    }
  },

  playPrevious: () => {
    const { currentSongIndex, queue, currentTime, repeatMode } = get()
    // If we're more than 3 seconds into the song, restart it instead of going to previous
    if (currentTime > 3) {
      set({ seekRequest: 0, currentTime: 0 })
      return
    }

    if (queue.length > 0 && currentSongIndex > 0) {
      set({ currentSongIndex: currentSongIndex - 1, isPlaying: true, currentTime: 0, seekRequest: 0 })
    } else if (queue.length > 0) {
      if (repeatMode === 'all' && queue.length > 1) {
        // Wrap around to the last song in the queue
        const lastIndex = queue.length - 1
        rememberPlayedSong(queue[lastIndex])
        set({ currentSongIndex: lastIndex, isPlaying: true, currentTime: 0, seekRequest: 0 })
      } else {
        set({ seekRequest: 0, currentTime: 0 })
      }
    }
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume))
    localStorage.setItem('felo_volume', clamped.toString())
    set({ volume: clamped })
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),

  toggleShuffle: () => {
    const { isShuffle, queue, originalQueue, currentSongIndex } = get()
    const nextShuffle = !isShuffle
    localStorage.setItem('felo_shuffle', String(nextShuffle))

    if (queue.length === 0 || currentSongIndex < 0) {
      set({ isShuffle: nextShuffle })
      return
    }

    const effectiveOriginal = originalQueue.length > 0 ? originalQueue : [...queue]

    if (nextShuffle) {
      // Turn shuffle ON (Spotify-standard): preserve played history (0..currentSongIndex),
      // shuffle only upcoming tracks (currentSongIndex + 1 .. end)
      const playedHistory = queue.slice(0, currentSongIndex + 1)
      const upcoming = queue.slice(currentSongIndex + 1)
      const shuffledUpcoming = shuffleArray(upcoming)
      set({
        isShuffle: true,
        originalQueue: effectiveOriginal,
        queue: [...playedHistory, ...shuffledUpcoming]
      })
    } else {
      // Turn shuffle OFF: restore upcoming tracks in their relative original order,
      // keeping played history intact so past track navigation isn't lost
      const playedHistory = queue.slice(0, currentSongIndex + 1)
      const playedIds = new Set(playedHistory.map((s) => s.id))
      const remainingOriginal = effectiveOriginal.filter((s) => !playedIds.has(s.id))
      set({
        isShuffle: false,
        queue: [...playedHistory, ...remainingOriginal]
      })
    }
  },

  toggleRepeat: () => {
    const { repeatMode } = get()
    const nextMode: RepeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off'
    localStorage.setItem('felo_repeat', nextMode)
    set({ repeatMode: nextMode })
  },

  seek: (time) => {
    set({ seekRequest: time, currentTime: time })
  },

  clearSeekRequest: () => {
    set({ seekRequest: null })
  },

  removeSongFromQueue: (songId) => {
    set((state) => {
      const currentSong = state.queue[state.currentSongIndex]
      const removingCurrent = currentSong?.id === songId
      const queue = state.queue.filter((song) => song.id !== songId)
      const originalQueue = state.originalQueue.filter((song) => song.id !== songId)

      if (queue.length === 0) {
        return {
          queue: [],
          originalQueue: [],
          currentSongIndex: -1,
          isPlaying: false,
          isBuffering: false
        }
      }

      let newIndex = state.currentSongIndex
      if (removingCurrent) {
        newIndex = Math.min(state.currentSongIndex, queue.length - 1)
        rememberPlayedSong(queue[newIndex])
      } else {
        const foundIdx = currentSong ? queue.findIndex((s) => s.id === currentSong.id) : -1
        newIndex = foundIdx >= 0 ? foundIdx : Math.min(state.currentSongIndex, queue.length - 1)
      }

      return {
        queue,
        originalQueue,
        currentSongIndex: newIndex,
        isPlaying: removingCurrent ? true : state.isPlaying
      }
    })
  },

  removeSongFromQueueByIndex: (index: number) => {
    set((state) => {
      if (index < 0 || index >= state.queue.length) return state
      const removingCurrent = state.currentSongIndex === index
      const targetSong = state.queue[index]
      const newQueue = state.queue.filter((_, idx) => idx !== index)

      // Also remove the corresponding entry from originalQueue safely
      const origIdx = state.originalQueue.findIndex((s) => s.id === targetSong?.id)
      const newOriginalQueue =
        origIdx >= 0
          ? state.originalQueue.filter((_, idx) => idx !== origIdx)
          : [...state.originalQueue]

      if (newQueue.length === 0) {
        return {
          queue: [],
          originalQueue: [],
          currentSongIndex: -1,
          isPlaying: false,
          isBuffering: false
        }
      }

      let newIndex = state.currentSongIndex
      if (removingCurrent) {
        newIndex = Math.min(state.currentSongIndex, newQueue.length - 1)
        rememberPlayedSong(newQueue[newIndex])
      } else if (index < state.currentSongIndex) {
        newIndex = state.currentSongIndex - 1
      }

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue,
        currentSongIndex: newIndex,
        isPlaying: removingCurrent ? true : state.isPlaying
      }
    })
  },

  reorderQueue: (fromIndex: number, toIndex: number) => {
    set((state) => {
      if (
        fromIndex < 0 ||
        fromIndex >= state.queue.length ||
        toIndex < 0 ||
        toIndex >= state.queue.length ||
        fromIndex === toIndex
      ) {
        return {}
      }
      const currentSong = state.queue[state.currentSongIndex]
      const newQueue = [...state.queue]
      const [moved] = newQueue.splice(fromIndex, 1)
      newQueue.splice(toIndex, 0, moved)
      const newCurrentIndex = currentSong
        ? newQueue.findIndex((s) => s.id === currentSong.id)
        : state.currentSongIndex
      return {
        queue: newQueue,
        originalQueue: !state.isShuffle ? newQueue : state.originalQueue,
        currentSongIndex: newCurrentIndex >= 0 ? newCurrentIndex : 0
      }
    })
  },

  clearQueue: () => {
    set({
      queue: [],
      originalQueue: [],
      currentSongIndex: -1,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      playbackContext: null
    })
  },

  clearUpcomingQueue: () => {
    set((state) => {
      if (state.currentSongIndex < 0 || state.queue.length === 0) {
        return {
          queue: [],
          originalQueue: [],
          currentSongIndex: -1,
          isPlaying: false,
          isBuffering: false
        }
      }
      const currentSong = state.queue[state.currentSongIndex]
      const preserved = [currentSong]
      return {
        queue: preserved,
        originalQueue: preserved,
        currentSongIndex: 0
      }
    })
  },

  updateSong: (song) => {
    set((state) => {
      const normalize = (v?: string) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const targetTitleNorm = normalize(song.title)
      const targetArtistNorm = normalize(song.artist)

      const isMatch = (item: Song) => {
        if (item.id === song.id) return true
        if (!targetTitleNorm) return false
        const itemTitleNorm = normalize(item.title)
        const itemArtistNorm = normalize(item.artist)
        return (
          itemTitleNorm === targetTitleNorm &&
          (!targetArtistNorm || !itemArtistNorm || itemArtistNorm === targetArtistNorm)
        )
      }

      const newQueue = state.queue.map((item) => (isMatch(item) ? { ...item, ...song } : item))
      const newOriginalQueue = state.originalQueue.map((item) =>
        isMatch(item) ? { ...item, ...song } : item
      )

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue
      }
    })
  }
}))
