import { create } from 'zustand'
import { Song } from '../pages/Library/Library'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Song[]
  originalQueue: Song[] // preserves original order when shuffle is on
  currentSongIndex: number
  isPlaying: boolean
  volume: number
  currentTime: number
  duration: number
  isShuffle: boolean
  repeatMode: RepeatMode
  seekRequest: number | null // used by AudioEngine to jump to a specific time

  // Actions
  setQueue: (queue: Song[], startPlayingIndex?: number) => void
  playSong: (index: number) => void
  togglePlay: () => void
  playNext: () => void
  playPrevious: () => void
  setIsPlaying: (isPlaying: boolean) => void
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
  volume: parseFloat(getMigratedPreference('felo_volume', 'fanx_volume', '1')),
  currentTime: 0,
  duration: 0,
  isShuffle: getMigratedPreference('felo_shuffle', 'fanx_shuffle', 'false') === 'true',
  repeatMode: getMigratedPreference('felo_repeat', 'fanx_repeat', 'off') as RepeatMode,
  seekRequest: null,

  setQueue: (newQueue, startPlayingIndex = 0) => {
    const { isShuffle } = get()
    if (isShuffle && newQueue.length > 0) {
      const selectedSong = newQueue[startPlayingIndex] || newQueue[0]
      const remaining = newQueue.filter((_, idx) => idx !== startPlayingIndex)
      const shuffled = [selectedSong, ...shuffleArray(remaining)]
      set({
        originalQueue: newQueue,
        queue: shuffled,
        currentSongIndex: 0,
        isPlaying: true,
        currentTime: 0
      })
    } else {
      set({
        originalQueue: newQueue,
        queue: newQueue,
        currentSongIndex: startPlayingIndex,
        isPlaying: true,
        currentTime: 0
      })
    }
  },

  playSong: (index) => {
    set({
      currentSongIndex: index,
      isPlaying: true,
      currentTime: 0
    })
  },

  togglePlay: () => {
    const { currentSongIndex, queue, isPlaying } = get()
    if (queue.length === 0) return
    if (currentSongIndex === -1 && queue.length > 0) {
      set({ currentSongIndex: 0, isPlaying: true })
    } else {
      set({ isPlaying: !isPlaying })
    }
  },

  playNext: () => {
    const { currentSongIndex, queue, repeatMode } = get()
    if (queue.length === 0) return

    if (repeatMode === 'one') {
      // Replay same song
      set({ seekRequest: 0, currentTime: 0, isPlaying: true })
      return
    }

    if (currentSongIndex < queue.length - 1) {
      set({ currentSongIndex: currentSongIndex + 1, isPlaying: true, currentTime: 0 })
    } else if (repeatMode === 'all') {
      // Loop back to start
      set({ currentSongIndex: 0, isPlaying: true, currentTime: 0 })
    } else {
      // End of playlist
      set({ isPlaying: false, currentTime: 0 })
    }
  },

  playPrevious: () => {
    const { currentSongIndex, queue, currentTime } = get()
    // If we're more than 3 seconds into the song, restart it instead of going to previous
    if (currentTime > 3) {
      set({ seekRequest: 0, currentTime: 0 })
      return
    }

    if (queue.length > 0 && currentSongIndex > 0) {
      set({ currentSongIndex: currentSongIndex - 1, isPlaying: true, currentTime: 0 })
    } else if (queue.length > 0) {
      set({ seekRequest: 0, currentTime: 0 })
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

    if (queue.length === 0) {
      set({ isShuffle: nextShuffle })
      return
    }

    const currentSong = queue[currentSongIndex]

    if (nextShuffle) {
      // Turn shuffle ON: shuffle around current song
      const remaining = originalQueue.filter((s) => s.id !== currentSong?.id)
      const newQueue = currentSong
        ? [currentSong, ...shuffleArray(remaining)]
        : shuffleArray(originalQueue)
      set({
        isShuffle: true,
        queue: newQueue,
        currentSongIndex: currentSong ? 0 : 0
      })
    } else {
      // Turn shuffle OFF: restore original queue order
      const newIndex = originalQueue.findIndex((s) => s.id === currentSong?.id)
      set({
        isShuffle: false,
        queue: originalQueue.length > 0 ? originalQueue : queue,
        currentSongIndex: newIndex >= 0 ? newIndex : 0
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

  updateSong: (song) => {
    set((state) => ({
      queue: state.queue.map((item) => (item.id === song.id ? song : item)),
      originalQueue: state.originalQueue.map((item) => (item.id === song.id ? song : item))
    }))
  }
}))
