import { create } from 'zustand'
import type { Song } from '../../types/song'
import { markSongAsStarted } from '../../lib/playbackEvents'
import { findMatchingLibrarySong } from '../../lib/songMatching'
import { PersonalizationService } from '../../services/PersonalizationService'
import { getTabInstanceId, type PlayerSyncSnapshot } from '../../lib/crossTabSync'

export type PlaybackGuard = (proceed: () => void) => boolean
let _playbackGuard: PlaybackGuard | null = null

export function setPlaybackGuard(guard: PlaybackGuard | null): void {
  _playbackGuard = guard
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface PlaybackContext {
  type: 'album' | 'playlist' | 'artist' | 'library' | 'search' | 'radio'
  id?: string
  title: string
  subtitle?: string
  route?: string
}

export interface PlaybackActionOptions {
  preservePriority?: boolean
  isRoomSync?: boolean
  initialTime?: number
  isPlaying?: boolean
}

export interface PlayerState {
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
  isAutoplay: boolean
  crossfadeEnabled: boolean
  crossfadeDuration: number
  seekRequest: number | null // used by AudioEngine to jump to a specific time
  playbackContext: PlaybackContext | null

  // Cross-tab single playback sync
  isAudioActive: boolean
  activeInstanceId: string | null

  // Actions
  setIsAudioActive: (isAudioActive: boolean, activeInstanceId?: string | null) => void
  claimAudioOwnership: () => void
  syncFromExternal: (snapshot: Partial<PlayerSyncSnapshot>) => void
  setQueue: (
    queue: Song[],
    startPlayingIndex?: number,
    context?: PlaybackContext | null,
    options?: PlaybackActionOptions
  ) => void
  setPlaybackContext: (context: PlaybackContext | null) => void
  enqueueSong: (song: Song) => void
  enqueueSongNext: (song: Song) => void
  enqueueSongPriority: (song: Song) => void
  bumpSongToPriority: (index: number) => void
  playSong: (index: number, options?: PlaybackActionOptions) => void
  togglePlay: (options?: any) => void
  playNext: (manual?: boolean, options?: any) => void
  playPrevious: (options?: any) => void
  removeSongFromQueue: (songId: string) => void
  removeSongFromQueueByIndex: (index: number) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  clearQueue: () => void
  clearUpcomingQueue: (keepPriority?: boolean) => void
  setIsPlaying: (isPlaying: boolean) => void
  setIsBuffering: (isBuffering: boolean) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  skipTime: (seconds: number) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  toggleAutoplay: () => void
  setCrossfadeEnabled: (enabled: boolean) => void
  setCrossfadeDuration: (duration: number) => void
  toggleCrossfade: () => void
  seek: (time: number) => void
  clearSeekRequest: () => void
  updateSong: (song: Song, targetQueueId?: string) => void
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

export {
  RECENTLY_PLAYED_STORAGE_KEY,
  PLAY_STATS_STORAGE_KEY,
  PLAYED_SONGS_STORAGE_KEY
} from '../../lib/playbackConstants'

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
  isAutoplay: getMigratedPreference('felo_autoplay', 'fanx_autoplay', 'true') === 'true',
  crossfadeEnabled: getMigratedPreference('felo_crossfade_enabled', 'fanx_crossfade_enabled', 'true') === 'true',
  crossfadeDuration: Math.max(
    1,
    Math.min(12, parseInt(getMigratedPreference('felo_crossfade_duration', 'fanx_crossfade_duration', '4'), 10) || 4)
  ),
  playbackContext: null,
  seekRequest: null,

  isAudioActive: true,
  activeInstanceId: typeof window !== 'undefined' ? getTabInstanceId() : null,

  setIsAudioActive: (isAudioActive, activeInstanceId) => {
    set({
      isAudioActive,
      activeInstanceId: activeInstanceId !== undefined ? activeInstanceId : get().activeInstanceId
    })
  },

  claimAudioOwnership: () => {
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null
    set({ isAudioActive: true, activeInstanceId: tabId })
  },

  syncFromExternal: (snapshot) => {
    const current = get()
    const updates: Partial<PlayerState> = {}

    if (snapshot.activeInstanceId !== undefined) {
      updates.activeInstanceId = snapshot.activeInstanceId
      updates.isAudioActive = snapshot.activeInstanceId === getTabInstanceId()
    }
    if (snapshot.queue !== undefined) updates.queue = snapshot.queue
    if (snapshot.originalQueue !== undefined) updates.originalQueue = snapshot.originalQueue
    if (snapshot.currentSongIndex !== undefined) updates.currentSongIndex = snapshot.currentSongIndex
    if (snapshot.isPlaying !== undefined) updates.isPlaying = snapshot.isPlaying
    if (snapshot.isBuffering !== undefined) updates.isBuffering = snapshot.isBuffering
    if (snapshot.volume !== undefined && Math.abs(snapshot.volume - current.volume) > 0.001) {
      updates.volume = snapshot.volume
      localStorage.setItem('felo_volume', snapshot.volume.toString())
    }
    if (snapshot.currentTime !== undefined) updates.currentTime = snapshot.currentTime
    if (snapshot.duration !== undefined) updates.duration = snapshot.duration
    if (snapshot.isShuffle !== undefined) updates.isShuffle = snapshot.isShuffle
    if (snapshot.repeatMode !== undefined) updates.repeatMode = snapshot.repeatMode
    if (snapshot.playbackContext !== undefined) updates.playbackContext = snapshot.playbackContext

    set(updates)
  },

  setPlaybackContext: (playbackContext) => set({ playbackContext }),
  setIsBuffering: (isBuffering) => set({ isBuffering }),

  setQueue: (newQueue, startPlayingIndex = 0, context, options) => {
    if (!options?.isRoomSync && _playbackGuard && _playbackGuard(() => get().setQueue(newQueue, startPlayingIndex, context, options))) {
      return
    }
    if (!newQueue || newQueue.length === 0) {
      get().clearQueue()
      return
    }

    const contextToSet = context !== undefined ? context : get().playbackContext
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null

    // Room Sync Fast Path: Host session queue is authoritative.
    // NEVER shuffle room queue with guest's personal shuffle setting, and NEVER inject stale local priorities.
    if (options?.isRoomSync) {
      const safeIndex = Math.max(0, Math.min(newQueue.length - 1, startPlayingIndex))
      const selectedSong = newQueue[safeIndex] || newQueue[0]
      rememberPlayedSong(selectedSong)
      const isVirtual = !selectedSong?.filePath || selectedSong.filePath.startsWith('virtual:')
      const startTime =
        typeof options?.initialTime === 'number' && !isNaN(options.initialTime) && options.initialTime >= 0
          ? options.initialTime
          : 0
      set({
        originalQueue: newQueue,
        queue: newQueue,
        currentSongIndex: safeIndex,
        isPlaying: typeof options?.isPlaying === 'boolean' ? options.isPlaying : true,
        isBuffering: isVirtual,
        currentTime: startTime,
        seekRequest: startTime > 0 ? startTime : null,
        playbackContext: contextToSet,
        isAudioActive: true,
        activeInstanceId: tabId
      })
      return
    }

    const { isShuffle, queue: currentQueue, currentSongIndex: currentIdx } = get()
    const preservePriority = options?.preservePriority !== false
    const pendingPriorities =
      preservePriority && currentIdx >= 0 && currentQueue.length > 0
        ? currentQueue.slice(currentIdx + 1).filter((s) => Boolean(s?.isPriority))
        : []
    const pendingPriorityIds = new Set(pendingPriorities.map((s) => s.id))

    const selectedSong = newQueue[startPlayingIndex] || newQueue[0]
    rememberPlayedSong(selectedSong)
    const isVirtual = !selectedSong?.filePath || selectedSong.filePath.startsWith('virtual:')

    // Deduplicate any priority tracks from newQueue that already exist in pendingPriorities
    const filteredNewQueue = newQueue.filter((s) => !pendingPriorityIds.has(s.id))
    const selectedIndexInFiltered = filteredNewQueue.findIndex((s) => s.id === selectedSong?.id)
    const safeStartIndex = selectedIndexInFiltered >= 0 ? selectedIndexInFiltered : 0

    if (isShuffle && filteredNewQueue.length > 0) {
      const remaining = filteredNewQueue.filter((_, idx) => idx !== safeStartIndex)
      const shuffled = [selectedSong, ...pendingPriorities, ...shuffleArray(remaining)]
      const orderedOriginal = [selectedSong, ...pendingPriorities, ...remaining]
      set({
        originalQueue: orderedOriginal,
        queue: shuffled,
        currentSongIndex: 0,
        isPlaying: true,
        isBuffering: isVirtual,
        currentTime: 0,
        seekRequest: null,
        playbackContext: contextToSet,
        isAudioActive: true,
        activeInstanceId: tabId
      })
    } else {
      const beforeTracks = filteredNewQueue.slice(0, safeStartIndex)
      const afterTracks = filteredNewQueue.slice(safeStartIndex + 1)
      const unifiedQueue = [...beforeTracks, selectedSong, ...pendingPriorities, ...afterTracks]
      const newCurrentIndex = beforeTracks.length

      set({
        originalQueue: unifiedQueue,
        queue: unifiedQueue,
        currentSongIndex: newCurrentIndex,
        isPlaying: true,
        isBuffering: isVirtual,
        currentTime: 0,
        seekRequest: null,
        playbackContext: contextToSet,
        isAudioActive: true,
        activeInstanceId: tabId
      })
    }
  },

  enqueueSong: (song) => {
    set((state) => {
      if (state.queue.some((item) => item.id === song.id)) return state
      const queue = [...state.queue, song]
      const currentSongIndex = state.currentSongIndex === -1 ? 0 : state.currentSongIndex
      return {
        queue,
        originalQueue: [...state.originalQueue, song],
        currentSongIndex
      }
    })
  },

  enqueueSongNext: (song) => {
    set((state) => {
      const existingIndex = state.queue.findIndex((item) => item.id === song.id)
      const newQueue = [...state.queue]
      let adjustedCurrentIndex = state.currentSongIndex

      if (existingIndex >= 0) {
        newQueue.splice(existingIndex, 1)
        if (existingIndex < state.currentSongIndex) {
          adjustedCurrentIndex = Math.max(0, adjustedCurrentIndex - 1)
        }
      }

      const insertIndex =
        adjustedCurrentIndex === -1
          ? 0
          : Math.min(newQueue.length, adjustedCurrentIndex + 1)
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
        originalQueue: newOriginalQueue,
        currentSongIndex: adjustedCurrentIndex === -1 ? 0 : adjustedCurrentIndex
      }
    })
  },

  enqueueSongPriority: (song) => {
    set((state) => {
      const prioritySong: Song = { ...song, isPriority: true }
      const existingIndex = state.queue.findIndex((item) => item.id === song.id)
      const newQueue = [...state.queue]
      let adjustedCurrentIndex = state.currentSongIndex

      if (existingIndex >= 0) {
        newQueue.splice(existingIndex, 1)
        if (existingIndex < state.currentSongIndex) {
          adjustedCurrentIndex = Math.max(0, adjustedCurrentIndex - 1)
        }
      }

      // Priority requests are placed after the currently playing song AND after any previous priority requests!
      let insertIndex = adjustedCurrentIndex === -1 ? 0 : adjustedCurrentIndex + 1
      while (insertIndex < newQueue.length && newQueue[insertIndex]?.isPriority) {
        insertIndex++
      }

      newQueue.splice(insertIndex, 0, prioritySong)

      // Also safely update originalQueue
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
      newOriginalQueue.splice(origInsertIdx, 0, prioritySong)

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue,
        currentSongIndex: adjustedCurrentIndex === -1 ? 0 : adjustedCurrentIndex
      }
    })
  },

  bumpSongToPriority: (index) => {
    set((state) => {
      if (index < 0 || index >= state.queue.length) return state
      if (index === state.currentSongIndex) {
        if (!state.queue[index].isPriority) {
          const updatedQueue = [...state.queue]
          updatedQueue[index] = { ...updatedQueue[index], isPriority: true }
          return { queue: updatedQueue }
        }
        return state
      }

      const songToBump: Song = { ...state.queue[index], isPriority: true }
      const newQueue = [...state.queue]
      let adjustedCurrentIndex = state.currentSongIndex

      // Remove from current position
      newQueue.splice(index, 1)
      if (index < state.currentSongIndex) {
        adjustedCurrentIndex = Math.max(0, adjustedCurrentIndex - 1)
      }

      // Priority requests are placed after the currently playing song AND after any previous priority requests
      let insertIndex = adjustedCurrentIndex === -1 ? 0 : adjustedCurrentIndex + 1
      while (insertIndex < newQueue.length && newQueue[insertIndex]?.isPriority) {
        insertIndex++
      }

      newQueue.splice(insertIndex, 0, songToBump)

      // Also safely update originalQueue
      const existingOrigIndex = state.originalQueue.findIndex((item) => item.id === songToBump.id)
      const newOriginalQueue = [...state.originalQueue]
      if (existingOrigIndex >= 0) {
        newOriginalQueue.splice(existingOrigIndex, 1)
      }
      const currentSong = newQueue[adjustedCurrentIndex]
      const origCurrentIdx = currentSong
        ? newOriginalQueue.findIndex((item) => item.id === currentSong.id)
        : -1
      const origInsertIdx =
        origCurrentIdx >= 0
          ? Math.min(newOriginalQueue.length, origCurrentIdx + 1)
          : newOriginalQueue.length
      newOriginalQueue.splice(origInsertIdx, 0, songToBump)

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue,
        currentSongIndex: adjustedCurrentIndex === -1 ? 0 : adjustedCurrentIndex
      }
    })
  },

  playSong: (index, options) => {
    if (!options?.isRoomSync && _playbackGuard && _playbackGuard(() => get().playSong(index, options))) {
      return
    }
    const song = get().queue[index]
    rememberPlayedSong(song)
    const isVirtual = !song?.filePath || song.filePath.startsWith('virtual:')
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null
    set({
      currentSongIndex: index,
      isPlaying: true,
      isBuffering: isVirtual,
      currentTime: 0,
      seekRequest: null,
      isAudioActive: true,
      activeInstanceId: tabId
    })
  },

  togglePlay: (options?: any) => {
    const isRoomSync = Boolean(options?.isRoomSync)
    if (!isRoomSync && !get().isPlaying && _playbackGuard && _playbackGuard(() => get().togglePlay(options))) {
      return
    }
    const { currentSongIndex, queue, isPlaying } = get()
    if (queue.length === 0 || currentSongIndex < 0 || currentSongIndex >= queue.length) {
      if (typeof window !== 'undefined' && window.api?.getSongs) {
        void window.api.getSongs().then((songs: Song[]) => {
          if (Array.isArray(songs) && songs.length > 0) {
            const sorted = [...songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
            get().setQueue(sorted, 0, {
              type: 'library',
              title: 'Your Library',
              route: '/library'
            })
          }
        })
      }
      return
    }
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null
    if (!isPlaying) {
      set({ isPlaying: true, isAudioActive: true, activeInstanceId: tabId })
    } else {
      set({ isPlaying: false })
    }
  },

  playNext: (manual = false, options?: any) => {
    const isRoomSync = Boolean(options?.isRoomSync)
    if (!isRoomSync && manual && _playbackGuard && _playbackGuard(() => get().playNext(true, options))) {
      return
    }
    const { currentSongIndex, queue, originalQueue, repeatMode, isShuffle } = get()
    if (queue.length === 0) return
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null
    const audioActiveUpdates = manual ? { isAudioActive: true, activeInstanceId: tabId } : {}

    // If auto-advancing from track end and repeat mode is 'one', repeat the current track
    if (repeatMode === 'one' && !manual) {
      rememberPlayedSong(queue[currentSongIndex])
      set({ seekRequest: 0, currentTime: 0, isPlaying: true })
      return
    }

    if (currentSongIndex < queue.length - 1) {
      const nextSong = queue[currentSongIndex + 1]
      const isVirtual = !nextSong?.filePath || nextSong.filePath.startsWith('virtual:')
      rememberPlayedSong(nextSong)
      set({
        currentSongIndex: currentSongIndex + 1,
        isPlaying: true,
        isBuffering: isVirtual,
        currentTime: 0,
        seekRequest: null,
        ...audioActiveUpdates
      })
    } else if (repeatMode === 'all') {
      if (isShuffle && originalQueue.length > 1) {
        // Generate a fresh shuffle order on queue loop so the playlist stays fresh
        const freshShuffled = shuffleArray(originalQueue)
        const firstSong = freshShuffled[0]
        const isVirtual = !firstSong?.filePath || firstSong.filePath.startsWith('virtual:')
        rememberPlayedSong(firstSong)
        set({
          queue: freshShuffled,
          currentSongIndex: 0,
          isPlaying: true,
          isBuffering: isVirtual,
          currentTime: 0,
          seekRequest: null,
          ...audioActiveUpdates
        })
      } else {
        const firstSong = queue[0]
        const isVirtual = !firstSong?.filePath || firstSong.filePath.startsWith('virtual:')
        rememberPlayedSong(firstSong)
        set({
          currentSongIndex: 0,
          isPlaying: true,
          isBuffering: isVirtual,
          currentTime: 0,
          seekRequest: null,
          ...audioActiveUpdates
        })
      }
    } else if (get().isAutoplay) {
      // Seamless Autoplay / Infinity mode: seed recommendations from the last played track
      const lastSong = queue[currentSongIndex]
      if (lastSong && typeof window !== 'undefined' && Boolean(window.api?.fetchDeezerRecommendations)) {
        set({ isBuffering: true })
        void (async () => {
          try {
            let libSongs: Song[] = []
            if (window.api?.getSongs) {
              libSongs = (await window.api.getSongs()) || []
            }
            const recommendations = await PersonalizationService.generateRadioStation(
              {
                title: lastSong.title,
                artist: lastSong.artist,
                album: lastSong.album,
                artworkUrl: lastSong.artworkPath,
                filePath: lastSong.filePath,
                id: lastSong.id
              },
              libSongs
            )
            const existingIds = new Set(get().queue.map((s) => s.id))
            const newTracks = recommendations.filter((r) => !existingIds.has(r.id))
            if (newTracks.length > 0) {
              const currentQ = get().queue
              const nextIndex = currentQ.length
              const updatedQueue = [...currentQ, ...newTracks]
              const nextTrack = updatedQueue[nextIndex]
              rememberPlayedSong(nextTrack)
              const isVirtual = !nextTrack?.filePath || nextTrack.filePath.startsWith('virtual:')
              set({
                queue: updatedQueue,
                originalQueue: [...get().originalQueue, ...newTracks],
                currentSongIndex: nextIndex,
                isPlaying: true,
                isBuffering: isVirtual,
                currentTime: 0,
                seekRequest: null,
                playbackContext: {
                  type: 'radio',
                  title: `Autoplay · ${lastSong.title}`
                }
              })
              return
            }
          } catch (autoplayErr) {
            console.warn('Smart autoplay could not fetch additional tracks:', autoplayErr)
          }
          set({ isPlaying: false, isBuffering: false, currentTime: 0 })
        })()
      } else {
        set({ isPlaying: false, isBuffering: false, currentTime: 0 })
      }
    } else {
      // End of playlist
      set({ isPlaying: false, isBuffering: false, currentTime: 0 })
    }
  },

  playPrevious: (options?: any) => {
    const isRoomSync = Boolean(options?.isRoomSync)
    if (!isRoomSync && _playbackGuard && _playbackGuard(() => get().playPrevious(options))) {
      return
    }
    const { currentSongIndex, queue, currentTime, repeatMode } = get()
    const tabId = typeof window !== 'undefined' ? getTabInstanceId() : null
    // If we're more than 3 seconds into the song, restart it instead of going to previous
    if (currentTime > 3) {
      set({ seekRequest: 0, currentTime: 0, isAudioActive: true, activeInstanceId: tabId })
      return
    }

    if (queue.length > 0 && currentSongIndex > 0) {
      const prevSong = queue[currentSongIndex - 1]
      const isVirtual = !prevSong?.filePath || prevSong.filePath.startsWith('virtual:')
      set({
        currentSongIndex: currentSongIndex - 1,
        isPlaying: true,
        isBuffering: isVirtual,
        currentTime: 0,
        seekRequest: null,
        isAudioActive: true,
        activeInstanceId: tabId
      })
    } else if (queue.length > 0) {
      if (repeatMode === 'all' && queue.length > 1) {
        // Wrap around to the last song in the queue
        const lastIndex = queue.length - 1
        const lastSong = queue[lastIndex]
        const isVirtual = !lastSong?.filePath || lastSong.filePath.startsWith('virtual:')
        rememberPlayedSong(lastSong)
        set({
          currentSongIndex: lastIndex,
          isPlaying: true,
          isBuffering: isVirtual,
          currentTime: 0,
          seekRequest: null,
          isAudioActive: true,
          activeInstanceId: tabId
        })
      } else {
        set({ seekRequest: 0, currentTime: 0, isAudioActive: true, activeInstanceId: tabId })
      }
    }
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume))
    if (clamped > 0) {
      localStorage.setItem('felo_pre_mute_volume', clamped.toString())
    }
    localStorage.setItem('felo_volume', clamped.toString())
    set({ volume: clamped })
  },

  toggleMute: () => {
    const { volume } = get()
    if (volume > 0) {
      localStorage.setItem('felo_pre_mute_volume', volume.toString())
      set({ volume: 0 })
      localStorage.setItem('felo_volume', '0')
    } else {
      const saved = parseFloat(localStorage.getItem('felo_pre_mute_volume') || '0.5')
      const restored = Number.isFinite(saved) && saved > 0 ? Math.min(1, saved) : 0.5
      set({ volume: restored })
      localStorage.setItem('felo_volume', restored.toString())
    }
  },

  skipTime: (seconds) => {
    const { currentTime, seek } = get()
    const target = (Number.isFinite(currentTime) ? currentTime : 0) + (Number.isFinite(seconds) ? seconds : 0)
    seek(target)
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
      // keep active priority requests pinned right after currentSong, shuffle only local background tracks
      const playedHistory = queue.slice(0, currentSongIndex + 1)
      const upcoming = queue.slice(currentSongIndex + 1)
      const upcomingPriorities = upcoming.filter((s) => Boolean(s?.isPriority))
      const upcomingNonPriorities = upcoming.filter((s) => !s?.isPriority)
      const shuffledUpcoming = shuffleArray(upcomingNonPriorities)
      set({
        isShuffle: true,
        originalQueue: effectiveOriginal,
        queue: [...playedHistory, ...upcomingPriorities, ...shuffledUpcoming]
      })
    } else {
      // Turn shuffle OFF: restore upcoming tracks in their relative original order,
      // keeping played history intact so past track navigation isn't lost
      const playedHistory = queue.slice(0, currentSongIndex + 1)
      const playedIds = new Set(playedHistory.map((s) => s.id))
      const remainingOriginal = effectiveOriginal.filter((s) => !playedIds.has(s.id))
      const remainingPriorities = remainingOriginal.filter((s) => Boolean(s?.isPriority))
      const remainingNonPriorities = remainingOriginal.filter((s) => !s?.isPriority)
      set({
        isShuffle: false,
        queue: [...playedHistory, ...remainingPriorities, ...remainingNonPriorities]
      })
    }
  },

  toggleRepeat: () => {
    const { repeatMode } = get()
    const nextMode: RepeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off'
    localStorage.setItem('felo_repeat', nextMode)
    set({ repeatMode: nextMode })
  },

  toggleAutoplay: () => {
    const nextMode = !get().isAutoplay
    localStorage.setItem('felo_autoplay', String(nextMode))
    set({ isAutoplay: nextMode })
  },

  setCrossfadeEnabled: (crossfadeEnabled) => {
    localStorage.setItem('felo_crossfade_enabled', String(crossfadeEnabled))
    set({ crossfadeEnabled })
  },

  setCrossfadeDuration: (duration) => {
    const clamped = Math.max(1, Math.min(12, duration))
    localStorage.setItem('felo_crossfade_duration', String(clamped))
    set({ crossfadeDuration: clamped })
  },

  toggleCrossfade: () => {
    const next = !get().crossfadeEnabled
    localStorage.setItem('felo_crossfade_enabled', String(next))
    set({ crossfadeEnabled: next })
  },

  seek: (time) => {
    const { duration } = get()
    const parsed = Number(time)
    let validTime = Number.isFinite(parsed) ? Math.max(0, parsed) : 0
    if (Number.isFinite(duration) && duration > 0 && validTime > duration) {
      validTime = Math.max(0, duration - 0.1)
    }
    set({ seekRequest: validTime, currentTime: validTime })
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
          isBuffering: false,
          currentTime: 0,
          seekRequest: null
        }
      }

      let newIndex = state.currentSongIndex
      let isBuffering = state.isBuffering
      let currentTime = state.currentTime
      let seekRequest = state.seekRequest

      if (removingCurrent) {
        newIndex = Math.min(state.currentSongIndex, queue.length - 1)
        const nextSong = queue[newIndex]
        const isVirtual = !nextSong?.filePath || nextSong.filePath.startsWith('virtual:')
        isBuffering = isVirtual
        currentTime = 0
        seekRequest = null
        rememberPlayedSong(nextSong)
      } else {
        const foundIdx = currentSong ? queue.findIndex((s) => s.id === currentSong.id) : -1
        newIndex = foundIdx >= 0 ? foundIdx : Math.min(state.currentSongIndex, queue.length - 1)
      }

      return {
        queue,
        originalQueue,
        currentSongIndex: newIndex,
        isPlaying: removingCurrent ? true : state.isPlaying,
        isBuffering,
        currentTime,
        seekRequest
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
          isBuffering: false,
          currentTime: 0,
          seekRequest: null
        }
      }

      let newIndex = state.currentSongIndex
      let isBuffering = state.isBuffering
      let currentTime = state.currentTime
      let seekRequest = state.seekRequest

      if (removingCurrent) {
        newIndex = Math.min(state.currentSongIndex, newQueue.length - 1)
        const nextSong = newQueue[newIndex]
        const isVirtual = !nextSong?.filePath || nextSong.filePath.startsWith('virtual:')
        isBuffering = isVirtual
        currentTime = 0
        seekRequest = null
        rememberPlayedSong(nextSong)
      } else if (index < state.currentSongIndex) {
        newIndex = state.currentSongIndex - 1
      }

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue,
        currentSongIndex: newIndex,
        isPlaying: removingCurrent ? true : state.isPlaying,
        isBuffering,
        currentTime,
        seekRequest
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

  clearUpcomingQueue: (keepPriority = true) => {
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
      const upcomingPriorities = keepPriority
        ? state.queue.slice(state.currentSongIndex + 1).filter((s) => Boolean(s?.isPriority))
        : []
      const preserved = [currentSong, ...upcomingPriorities]
      return {
        queue: preserved,
        originalQueue: preserved,
        currentSongIndex: 0
      }
    })
  },

  updateSong: (song, targetQueueId) => {
    set((state) => {
      const normalize = (v?: string) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const targetTitleNorm = normalize(song.title)
      const targetArtistNorm = normalize(song.artist)

      const isMatch = (item: Song) => {
        if (targetQueueId && item.id === targetQueueId) return true
        if (item.id === song.id) return true
        if (findMatchingLibrarySong(item.title, item.artist, [song])) return true
        if (!targetTitleNorm) return false
        const itemTitleNorm = normalize(item.title)
        const itemArtistNorm = normalize(item.artist)
        return (
          itemTitleNorm === targetTitleNorm &&
          (!targetArtistNorm || !itemArtistNorm || itemArtistNorm === targetArtistNorm)
        )
      }

      const mergeSong = (item: Song): Song => {
        const isLocalNow = Boolean(
          (song.filePath && !song.filePath.startsWith('virtual:') && !/^https?:/i.test(song.filePath)) ||
          (song.audioUrl && /^(blob:|data:)/i.test(song.audioUrl))
        )
        const merged: Song = { ...item, ...song }
        if (isLocalNow) {
          delete (merged as any).isYouTube
          delete (merged as any).videoId
          delete (merged as any).streamType
          merged.isOnline = false
          delete (merged as any).previewUrl
          if (merged.audioUrl && (/youtube\.com|youtu\.be/i.test(merged.audioUrl) || /^https?:/i.test(merged.audioUrl))) {
            delete (merged as any).audioUrl
          }
        }
        return merged
      }

      const newQueue = state.queue.map((item) => (isMatch(item) ? mergeSong(item) : item))
      const newOriginalQueue = state.originalQueue.map((item) =>
        isMatch(item) ? mergeSong(item) : item
      )

      return {
        queue: newQueue,
        originalQueue: newOriginalQueue
      }
    })
  }
}))
