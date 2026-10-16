import { create } from 'zustand'
import type { ListeningStoreState } from './types'
import { createRoomSlice } from './room.slice'
import { createRoomPlaybackSlice } from './playback.slice'
import { createWebRTCSlice } from './webrtc.slice'
import { createAudioBucketSlice } from './bucket.slice'
import { getSupabase } from '../../lib/supabase'
import { usePlayerStore } from '../player/usePlayerStore'
import { ensureTrackInAudioBucket } from '../../lib/audioBucketService'
import { registerLocalSlotPoolPath } from '../../lib/jitAudioPipeline'
import {
  registerListeningStoreStateGetter,
  _activeAudioHost,
  broadcastHostLosslessTrack,
  toSharedSong,
  normalizeSongValue,
  getSongKey,
  _lastSyncedSongId,
  setLastSyncedSongId,
  isSessionSyncing
} from './helpers'

export const useListeningStore = create<ListeningStoreState>()((...a) => ({
  ...createRoomSlice(...a),
  ...createRoomPlaybackSlice(...a),
  ...createWebRTCSlice(...a),
  ...createAudioBucketSlice(...a)
}))

// Register store getter for helper modules
registerListeningStoreStateGetter(() => useListeningStore.getState())

export function useIsPlayerLocked(): boolean {
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const myRole = useListeningStore((s) => s.myRole)
  return Boolean(joinedRoom && myRole === 'listener')
}

// Global listener: when a downloaded song arrives into local library, automatically sync joined room
if (typeof window !== 'undefined') {
  const onLibraryUpdated = () => {
    const state = useListeningStore.getState()
    const joined = state.joinedRoom
    if (joined && joined.song && state.syncStatus === 'missing_song') {
      void state.handleHostSongChange(joined)
    }
  }
  window.addEventListener('felo:library-updated', onLibraryUpdated)
  window.addEventListener('fanxmusic:library-updated', onLibraryUpdated)
}

// ─── AUTO-LEAVE: when the listener manually changes the song, exit the session ───
if (typeof window !== 'undefined') {
  let _leaving = false

  usePlayerStore.subscribe((playerState, prevPlayerState) => {
    const state = useListeningStore.getState()
    if (isSessionSyncing() || state.isReceivingDeviceStream || state.syncStatus === 'host_reconnecting') return

    const joined = state.joinedRoom
    if (!joined) {
      setLastSyncedSongId(null)
      return
    }

    // Track what song the store last synced us to
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const prevSong = prevPlayerState.queue[prevPlayerState.currentSongIndex]

    // Only react if the *index or id* changed — not just position/play-state ticks
    const indexChanged = playerState.currentSongIndex !== prevPlayerState.currentSongIndex
    const idChanged = currentSong?.id !== prevSong?.id
    if (!indexChanged && !idChanged) return

    // First time we see a sync, record it and don't auto-leave
    if (_lastSyncedSongId === null) {
      setLastSyncedSongId(currentSong?.id ?? null)
      return
    }

    // If the new song is still the same as the last one the store synced → no-op
    if (currentSong?.id === _lastSyncedSongId) return

    // Check if the current song matches the host's active song (by metadata)
    const hostSongKey = getSongKey(joined.song)
    const currentSongKey = currentSong
      ? `${normalizeSongValue(currentSong.artist)} - ${normalizeSongValue(currentSong.title)}`
      : ''
    if (hostSongKey && currentSongKey && hostSongKey === currentSongKey) {
      setLastSyncedSongId(currentSong?.id ?? null)
      return
    }

    // Check if the current song is part of the host's active session queue
    const isInSessionQueue = joined.queue?.some((qs) => {
      const qKey = `${normalizeSongValue(qs.artist)} - ${normalizeSongValue(qs.title)}`
      return qKey === currentSongKey
    })
    if (isInSessionQueue) {
      setLastSyncedSongId(currentSong?.id ?? null)
      return
    }

    // The user manually changed to a completely DIFFERENT song outside the session — auto-leave
    if (!_leaving) {
      _leaving = true
      setLastSyncedSongId(null)
      void useListeningStore.getState().leaveJoinedRoom().finally(() => {
        _leaving = false
      })
    }
  })

  // When host changes track, starts playback, or modifies queue, auto-sync room queue & stream to listeners
  usePlayerStore.subscribe((playerState, prevPlayerState) => {
    const state = useListeningStore.getState()
    const hostRoom = state.hostRoom
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const prevSong = prevPlayerState.queue[prevPlayerState.currentSongIndex]
    const trackChanged = currentSong && currentSong.id !== prevSong?.id
    const playStarted = playerState.isPlaying && !prevPlayerState.isPlaying
    const playToggled = playerState.isPlaying !== prevPlayerState.isPlaying
    const queueChanged = playerState.queue.length !== prevPlayerState.queue.length

    // Automatically synchronize host room state to Supabase so listeners always stay in sync
    if (hostRoom?.id && (trackChanged || playToggled || queueChanged)) {
      if (currentSong?.id && currentSong.filePath) {
        registerLocalSlotPoolPath(currentSong.id, currentSong.filePath)
      }
      if (currentSong) {
        void ensureTrackInAudioBucket(currentSong)
      }
      const nextSong = playerState.queue[playerState.currentSongIndex + 1]
      if (nextSong) {
        void ensureTrackInAudioBucket(nextSong)
      }
      const sharedSong = currentSong ? toSharedSong(currentSong) : null
      const sharedQueue = playerState.queue.map((s) => toSharedSong(s))

      void getSupabase()
        .from('listening_rooms')
        .update({
          song: sharedSong,
          queue: sharedQueue,
          is_playing: playerState.isPlaying,
          position_seconds: Math.round(playerState.currentTime || 0),
          updated_at: new Date().toISOString()
        })
        .eq('id', hostRoom.id)

      useListeningStore.setState((prev) => ({
        hostRoom: prev.hostRoom
          ? {
              ...prev.hostRoom,
              song: sharedSong,
              queue: sharedQueue,
              is_playing: playerState.isPlaying
            }
          : null
      }))
    }

    if ((trackChanged || playStarted) && _activeAudioHost) {
      _activeAudioHost.refreshTrack()
      if (trackChanged) {
        broadcastHostLosslessTrack(currentSong)
      }
    }
  })
}

export * from './types'
export * from './helpers'
export { createRoomSlice } from './room.slice'
export { createRoomPlaybackSlice } from './playback.slice'
export { createWebRTCSlice } from './webrtc.slice'
export { createAudioBucketSlice } from './bucket.slice'
