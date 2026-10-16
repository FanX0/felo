import type { PlayerState } from './usePlayerStore'
import type { Song } from '../../types/song'

export const selectCurrentSong = (state: PlayerState): Song | null => {
  if (state.currentSongIndex < 0 || state.currentSongIndex >= state.queue.length) {
    return null
  }
  return state.queue[state.currentSongIndex] || null
}

export const selectHasNext = (state: PlayerState): boolean => {
  return state.currentSongIndex < state.queue.length - 1 || state.repeatMode === 'all'
}

export const selectHasPrev = (state: PlayerState): boolean => {
  return state.currentSongIndex > 0 || state.currentTime > 3 || state.repeatMode === 'all'
}

export const selectQueueLength = (state: PlayerState): number => {
  return state.queue.length
}

export const selectIsQueueEmpty = (state: PlayerState): boolean => {
  return state.queue.length === 0
}

export const selectProgressPercent = (state: PlayerState): number => {
  if (!state.duration || state.duration <= 0) return 0
  return Math.min(100, Math.max(0, (state.currentTime / state.duration) * 100))
}

export const selectRemainingTime = (state: PlayerState): number => {
  if (!state.duration || state.duration <= 0) return 0
  return Math.max(0, state.duration - state.currentTime)
}

export const selectUpcomingSongs = (state: PlayerState): Song[] => {
  if (state.currentSongIndex < 0) return state.queue
  return state.queue.slice(state.currentSongIndex + 1)
}

export const selectPlaybackInfo = (state: PlayerState) => ({
  isPlaying: state.isPlaying,
  isBuffering: state.isBuffering,
  currentTime: state.currentTime,
  duration: state.duration,
  volume: state.volume,
  isShuffle: state.isShuffle,
  repeatMode: state.repeatMode
})
