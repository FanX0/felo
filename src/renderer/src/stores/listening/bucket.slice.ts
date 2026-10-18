import type { StateCreator } from 'zustand'
import type { AudioBucketSlice, ListeningStoreState } from './types'
import type { Song } from '../../types/song'
import { usePlayerStore } from '../player/usePlayerStore'
import { useOnlineStore } from '../useOnlineStore'
import { getSupabase } from '../../lib/supabase'
import {
  toSharedSong,
  _nudgeReplayTimer,
  setNudgeReplayTimer,
  setLastHostPulse,
  setIsSessionSyncing,
  setNeedsInitialSync,
  setLastSyncedSongId,
  getPreJoinPlayerSnapshot,
  savePreJoinPlayerSnapshot
} from './helpers'
import {
  ensureTrackInAudioBucket,
  uploadSongToAudioBucket,
  getSongPublicBucketUrl
} from '../../lib/audioBucketService'
import {
  getAudioDuration,
  analyzeCompression,
  registerLocalSlotPoolFile,
  registerLocalSlotPoolPath,
  getLocalSlotBlobUrl,
  cacheAudioBlob
} from '../../lib/jitAudioPipeline'
import { fetchYouTubeMetadata } from '../../lib/youtubeService'
import { roomClockSync } from '../../lib/roomClockSync'
import { setAudioPlaybackRate, registerAudioTimeProvider } from '../../lib/audioBridge'

export const createAudioBucketSlice: StateCreator<
  ListeningStoreState,
  [],
  [],
  AudioBucketSlice
> = (set, get) => ({
  jitStatus: {},

  setJitStatus: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => {
    set((state) => ({
      jitStatus: {
        ...state.jitStatus,
        [trackId]: { percent, statusText, receivedBytes, totalBytes }
      }
    }))
  },

  addLocalFilesToQueue: async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (!fileArray.length) return

    const newSongs: Song[] = []
    for (const file of fileArray) {
      const trackId = `jit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      registerLocalSlotPoolFile(trackId, file)

      const duration = await getAudioDuration(file)
      const profile = analyzeCompression(file.size, duration, file.name, file.type)
      const rawName = file.name.replace(/\.[^/.]+$/, '')
      let cleanArtist = 'Local Track'
      let cleanTitle = rawName

      // Check if filename has "01 - Artist - Title" or "Artist - Title" format
      const cleanedPrefix = rawName.replace(/^\d+[\s.-]+/, '').trim()
      if (cleanedPrefix.includes(' - ')) {
        const parts = cleanedPrefix.split(' - ')
        cleanArtist = parts[0].trim() || 'Local Track'
        cleanTitle = parts.slice(1).join(' - ').trim() || cleanedPrefix
      } else {
        cleanTitle = cleanedPrefix || rawName
      }

      const electronPath = (file as any).path || ''
      const blobUrl = getLocalSlotBlobUrl(trackId) || URL.createObjectURL(file)
      cacheAudioBlob(trackId, file)

      const song: Song = {
        id: trackId,
        title: cleanTitle,
        artist: cleanArtist,
        album: 'MUSIXQUARE Queue',
        duration,
        size: file.size,
        bitrate: profile.estimatedBitrateKbps,
        filePath: electronPath || blobUrl,
        audioUrl: blobUrl,
        isOnline: false
      }
      newSongs.push(song)
    }

    const player = usePlayerStore.getState()
    const currentQueue = [...player.queue]
    const updatedQueue = [...currentQueue, ...newSongs]

    if (currentQueue.length === 0) {
      player.setQueue(updatedQueue, 0)
      player.setIsPlaying(true)
    } else {
      player.setQueue(updatedQueue, player.currentSongIndex)
    }

    const hostRoom = get().hostRoom
    const joinedRoom = get().joinedRoom

    if (hostRoom?.id) {
      const sharedQueue = updatedQueue.map((s) => toSharedSong(s))
      const currentTrack = updatedQueue[player.currentSongIndex >= 0 ? player.currentSongIndex : 0]
      const currentShared = currentTrack ? toSharedSong(currentTrack) : null

      if (currentTrack) {
        void ensureTrackInAudioBucket(currentTrack)
      }

      await getSupabase()
        .from('listening_rooms')
        .update({
          queue: sharedQueue,
          song: currentShared,
          updated_at: new Date().toISOString()
        })
        .eq('id', hostRoom.id)

      set((state) => ({
        hostRoom: state.hostRoom
          ? {
              ...state.hostRoom,
              queue: sharedQueue,
              song: currentShared || state.hostRoom.song
            }
          : null
      }))
    } else if (joinedRoom?.code) {
      // Participant Uplink (MUSIXQUARE operator-file-uplink pattern)
      // Upload local audio file directly to Cloud Bucket and dispatch add_song command
      const user = useOnlineStore.getState().user
      const senderName = user?.user_metadata?.full_name || user?.email || 'Member'

      for (let i = 0; i < newSongs.length; i++) {
        const song = newSongs[i]
        const file = fileArray[i]
        void (async () => {
          try {
            get().setJitStatus(song.id, 20, 'Uploading track to cloud...')
            const uploadUrl = await uploadSongToAudioBucket(song.id, file, file.type || 'audio/mpeg')
            const finalAudioUrl = uploadUrl || getSongPublicBucketUrl(song.id)
            get().setJitStatus(song.id, 100, 'Shared to room')

            await getSupabase()
              .from('listening_room_commands')
              .insert({
                room_code: joinedRoom.code,
                command: 'add_song',
                sender_name: senderName,
                source: 'web',
                payload: {
                  id: song.id,
                  title: song.title,
                  artist: song.artist,
                  album: song.album,
                  duration: song.duration,
                  audioUrl: finalAudioUrl,
                  action: currentQueue.length === 0 ? 'play_now' : 'enqueue',
                  sizeBytes: file.size
                }
              })
          } catch (err) {
            console.warn('[addLocalFilesToQueue] Participant upload failed:', err)
            get().setJitStatus(song.id, 0, 'Upload failed')
          }
        })()
      }
    }
  },

  addYouTubeTrackToQueue: async (videoId: string, title?: string, channel?: string, duration?: number, isPriority?: boolean) => {
    if (!videoId) return
    const cleanTitle = title?.trim() || 'YouTube Track'
    const cleanArtist = channel?.trim() || 'YouTube'
    const trackId = `yt-${videoId}`
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`
    const artwork = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

    const song: Song = {
      id: trackId,
      title: cleanTitle,
      artist: cleanArtist,
      album: 'YouTube Stream',
      duration: duration || 180,
      artworkUrl: artwork,
      artworkPath: artwork,
      audioUrl: ytUrl,
      filePath: ytUrl,
      isPriority: Boolean(isPriority),
      isOnline: true
    }

    const player = usePlayerStore.getState()
    const currentQueue = [...player.queue]
    let updatedQueue: Song[]

    if (isPriority && currentQueue.length > 0) {
      const insertIdx = Math.max(0, player.currentSongIndex + 1)
      updatedQueue = [...currentQueue]
      updatedQueue.splice(insertIdx, 0, song)
    } else {
      updatedQueue = [...currentQueue, song]
    }

    if (currentQueue.length === 0) {
      player.setQueue(updatedQueue, 0)
      player.setIsPlaying(true)
    } else {
      player.setQueue(updatedQueue, player.currentSongIndex)
    }

    const hostRoom = get().hostRoom
    const joinedRoom = get().joinedRoom

    if (hostRoom?.id) {
      const sharedQueue = updatedQueue.map((s) => toSharedSong(s))
      const currentTrack = updatedQueue[player.currentSongIndex >= 0 ? player.currentSongIndex : 0]
      const currentShared = currentTrack ? toSharedSong(currentTrack) : null

      await getSupabase()
        .from('listening_rooms')
        .update({
          queue: sharedQueue,
          song: currentShared,
          updated_at: new Date().toISOString()
        })
        .eq('id', hostRoom.id)

      set((state) => ({
        hostRoom: state.hostRoom
          ? {
              ...state.hostRoom,
              queue: sharedQueue,
              song: currentShared || state.hostRoom.song
            }
          : null
      }))
    } else if (joinedRoom?.code) {
      const user = useOnlineStore.getState().user
      const senderName = user?.user_metadata?.full_name || user?.email || 'Member'

      await getSupabase()
        .from('listening_room_commands')
        .insert({
          room_code: joinedRoom.code,
          command: 'add_song',
          sender_name: senderName,
          source: 'web',
          payload: {
            id: trackId,
            title: cleanTitle,
            artist: cleanArtist,
            album: 'YouTube Stream',
            duration: duration || 180,
            audioUrl: ytUrl,
            artworkUrl: artwork,
            isPriority: Boolean(isPriority),
            action: currentQueue.length === 0 ? 'play_now' : isPriority ? 'play_next' : 'enqueue'
          }
        })
    }

    // Background Metadata Fallback (matches MUSIXQUARE _refreshYouTubeTitle pattern):
    // If the track was queued with default "YouTube Track" title, resolve the actual title from YouTube
    if (!title || cleanTitle === 'YouTube Track') {
      void fetchYouTubeMetadata(videoId).then((meta) => {
        if (meta && meta.title && meta.title !== 'YouTube Track') {
          const updatedSong: Song = {
            ...song,
            title: meta.title,
            artist: meta.channel || cleanArtist,
            artworkUrl: meta.thumbnailUrl || artwork,
            artworkPath: meta.thumbnailUrl || artwork
          }
          usePlayerStore.getState().updateSong(updatedSong, trackId)

          const currentHost = get().hostRoom
          if (currentHost?.id) {
            const freshQueue = usePlayerStore.getState().queue
            const sharedQueue = freshQueue.map((s) => toSharedSong(s))
            const currentTrack = freshQueue[usePlayerStore.getState().currentSongIndex >= 0 ? usePlayerStore.getState().currentSongIndex : 0] || null
            void getSupabase()
              .from('listening_rooms')
              .update({
                queue: sharedQueue,
                song: currentTrack ? toSharedSong(currentTrack) : null,
                updated_at: new Date().toISOString()
              })
              .eq('id', currentHost.id)
          }
        }
      })
    }
  },

  addLibrarySongsToQueue: async (songs: Song[]) => {
    if (!songs.length) return

    for (const song of songs) {
      if (song.id && song.filePath) {
        registerLocalSlotPoolPath(song.id, song.filePath)
      }
    }

    const player = usePlayerStore.getState()
    const currentQueue = [...player.queue]
    const existingIds = new Set(currentQueue.map((s) => s.id))
    const freshSongs = songs.filter((s) => !existingIds.has(s.id))
    if (!freshSongs.length && currentQueue.length > 0) return

    const updatedQueue = [...currentQueue, ...freshSongs]

    if (currentQueue.length === 0) {
      player.setQueue(updatedQueue, 0)
      player.setIsPlaying(true)
    } else {
      player.setQueue(updatedQueue, player.currentSongIndex)
    }

    const hostRoom = get().hostRoom
    const joinedRoom = get().joinedRoom

    if (hostRoom?.id) {
      const sharedQueue = updatedQueue.map((s) => toSharedSong(s))
      const currentTrack = updatedQueue[player.currentSongIndex >= 0 ? player.currentSongIndex : 0]
      const currentShared = currentTrack ? toSharedSong(currentTrack) : null

      if (currentTrack) {
        void ensureTrackInAudioBucket(currentTrack)
      }

      await getSupabase()
        .from('listening_rooms')
        .update({
          queue: sharedQueue,
          song: currentShared,
          updated_at: new Date().toISOString()
        })
        .eq('id', hostRoom.id)

      set((state) => ({
        hostRoom: state.hostRoom
          ? {
              ...state.hostRoom,
              queue: sharedQueue,
              song: currentShared || state.hostRoom.song
            }
          : null
      }))
    } else if (joinedRoom?.code) {
      const user = useOnlineStore.getState().user
      const senderName = user?.user_metadata?.full_name || user?.email || 'Member'

      for (const song of freshSongs) {
        void (async () => {
          try {
            const bucketUrl = await ensureTrackInAudioBucket(song)
            const finalAudioUrl = bucketUrl || song.audioUrl || (song.id ? getSongPublicBucketUrl(song.id) : '')
            await getSupabase()
              .from('listening_room_commands')
              .insert({
                room_code: joinedRoom.code,
                command: 'add_song',
                sender_name: senderName,
                source: 'web',
                payload: {
                  id: song.id,
                  title: song.title,
                  artist: song.artist,
                  album: song.album,
                  duration: song.duration,
                  audioUrl: finalAudioUrl,
                  action: currentQueue.length === 0 ? 'play_now' : 'enqueue'
                }
              })
          } catch (err) {
            console.warn('[addLibrarySongsToQueue] Participant add failed:', err)
          }
        })()
      }
    }
  },

  syncPlayerQueueToRoom: async () => {
    const hostRoom = get().hostRoom
    if (!hostRoom?.id) return

    const player = usePlayerStore.getState()
    if (player.queue.length === 0) return

    for (const song of player.queue) {
      if (song.id && song.filePath) {
        registerLocalSlotPoolPath(song.id, song.filePath)
      }
    }

    const sharedQueue = player.queue.map((s) => toSharedSong(s))
    const currentTrack = player.queue[player.currentSongIndex >= 0 ? player.currentSongIndex : 0]
    const currentShared = currentTrack ? toSharedSong(currentTrack) : null

    if (currentTrack) {
      void ensureTrackInAudioBucket(currentTrack)
    }

    await getSupabase()
      .from('listening_rooms')
      .update({
        queue: sharedQueue,
        song: currentShared,
        is_playing: player.isPlaying,
        position_seconds: Math.round(player.currentTime || 0),
        updated_at: new Date().toISOString()
      })
      .eq('id', hostRoom.id)

    set((state) => ({
      hostRoom: state.hostRoom
        ? {
            ...state.hostRoom,
            queue: sharedQueue,
            song: currentShared || state.hostRoom.song,
            is_playing: player.isPlaying
          }
        : null
    }))
  },

  cleanupOnLeave: () => {
    if (_nudgeReplayTimer) {
      clearTimeout(_nudgeReplayTimer)
      setNudgeReplayTimer(null)
    }
    setLastHostPulse(null)
    setIsSessionSyncing(false)
    setNeedsInitialSync(true)
    roomClockSync.reset()

    // 1. Unconditionally disconnect WebRTC device stream and sweep physical audio elements
    get().disconnectFromDeviceStream()
    if (typeof document !== 'undefined') {
      try {
        const streamElements = document.querySelectorAll('audio[data-felo-system-audio="webrtc-stream-player"]')
        streamElements.forEach((el) => {
          try {
            (el as HTMLAudioElement).pause()
            ;(el as HTMLAudioElement).srcObject = null
            el.remove()
          } catch {}
        })
      } catch {}
    }

    // 2. Unconditionally stop and tear down YouTube stream playback
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('felo:stop-youtube'))
      } catch {}
    }
    registerAudioTimeProvider(null)

    // 3. Clear room state so playbackGuard immediately unlocks local player actions
    set({
      joinedRoom: null,
      syncStatus: 'idle',
      missingSong: null,
      lastHostUpdate: 0,
      isAutoplayBlocked: false,
      deviceAudioStats: null,
      deviceAudioClientLevel: 0,
      losslessStreamBlobUrl: null,
      isLosslessMasterActive: false,
      jitStatus: {},
      myRole: null,
      members: [],
      pendingLeaveAndPlay: null
    })

    // 4. Queue isolation: restore pre-join local player snapshot or purge room session tracks
    const snapshot = getPreJoinPlayerSnapshot()
    savePreJoinPlayerSnapshot(null)
    const player = usePlayerStore.getState()
    if (snapshot && snapshot.queue && snapshot.queue.length > 0) {
      player.setQueue(snapshot.queue, snapshot.currentSongIndex)
      if (snapshot.currentTime > 0) {
        player.seek(snapshot.currentTime)
        player.setCurrentTime(snapshot.currentTime)
      }
      player.setIsPlaying(false)
    } else {
      player.clearQueue()
    }

    setAudioPlaybackRate(1.0)
    setLastSyncedSongId(null)
    const currentBlob = get().losslessStreamBlobUrl
    if (currentBlob) {
      try {
        URL.revokeObjectURL(currentBlob)
      } catch {}
    }
  }
})
