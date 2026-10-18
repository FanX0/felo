import type { StateCreator } from 'zustand'
import type { RoomPlaybackSlice, ListeningStoreState } from './types'
import type { ListeningRoom, SharedSong } from '../../online/types'
import type { Song } from '../../types/song'
import { getSupabase } from '../../lib/supabase'
import { useOnlineStore } from '../useOnlineStore'
import { usePlayerStore } from '../player/usePlayerStore'
import { useConnectedDeviceStore } from '../useConnectedDeviceStore'
import { useDownloadStore } from '../useDownloadStore'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  STREAMING_ACCOUNTS_SETTING
} from '../../lib/downloadConfig'
import { cleanSearchQuery } from '../../lib/songMatching'
import {
  setAudioPlaybackRate,
  getAudioPlaybackRate,
  getActiveAudioElement,
  getActiveAudioTime
} from '../../lib/audioBridge'
import { roomClockSync, type SyncPulsePayload } from '../../lib/roomClockSync'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import {
  isSongInAudioBucket,
  ensureTrackInAudioBucket,
  getSongPublicBucketUrl
} from '../../lib/audioBucketService'
import {
  downloadRemoteAudioFileWithRetry,
  cacheAudioBlob,
  getCachedAudioBlobUrl
} from '../../lib/jitAudioPipeline'
import { isYouTubeSong, extractYouTubeVideoId } from '../../components/Audio/YouTubePlayerBridge'
import {
  _autoDownloadRequests,
  findSongMatchIndex,
  findBestDownloadMatch,
  normalizeSongValue,
  fromSharedSong,
  getSongKey,
  getCurrentSyncEpoch,
  setCurrentSyncEpoch,
  incrementSyncEpoch,
  isSessionSyncing,
  setIsSessionSyncing,
  needsInitialSync,
  setNeedsInitialSync,
  _lastHostPulse,
  setLastHostPulse,
  setLastSyncedSongId,
  _nudgeReplayTimer,
  setNudgeReplayTimer,
  readInitialAutoDownload,
  readInitialSubstitutes,
  readInitialManualSyncOffset,
  AUTO_DOWNLOAD_STORAGE_KEY,
  SUBSTITUTES_STORAGE_KEY,
  MANUAL_SYNC_OFFSET_STORAGE_KEY
} from './helpers'

export const createRoomPlaybackSlice: StateCreator<
  ListeningStoreState,
  [],
  [],
  RoomPlaybackSlice
> = (set, get) => ({
  syncStatus: 'idle',
  missingSong: null,
  lastHostUpdate: 0,
  autoDownloadMissing: readInitialAutoDownload(),
  substitutes: readInitialSubstitutes(),
  manualSyncOffsetMs: readInitialManualSyncOffset(),
  isManualSyncModalOpen: false,
  isSyncLocked: false,
  isGuestBuffering: false,
  driftSeconds: 0,
  audioQuality: null,

  setSyncStatus: (syncStatus) => set({ syncStatus }),
  setAudioQuality: (audioQuality) => set({ audioQuality }),

  setAutoDownloadMissing: (enabled: boolean) => {
    try {
      localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, String(enabled))
    } catch {
      // ignore storage errors
    }
    set({ autoDownloadMissing: enabled })
  },

  setSubstituteSong: (hostSong: SharedSong, localSong: Song | null) => {
    const key = getSongKey(hostSong)
    if (!key) return

    set((state) => {
      const next = { ...state.substitutes }
      if (localSong) {
        next[key] = localSong
      } else {
        delete next[key]
      }
      try {
        localStorage.setItem(SUBSTITUTES_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return { substitutes: next }
    })

    // If currently joined and this was the active missing song, immediately trigger sync
    const joined = get().joinedRoom
    if (joined && getSongKey(joined.song) === key) {
      void get().handleHostSongChange(joined)
    }
  },

  setManualSyncOffsetMs: (offsetMs: number) => {
    const clamped = Math.max(-500, Math.min(500, Math.round(offsetMs)))
    try {
      localStorage.setItem(MANUAL_SYNC_OFFSET_STORAGE_KEY, String(clamped))
    } catch {
      // ignore
    }
    set({ manualSyncOffsetMs: clamped })

    if (_nudgeReplayTimer) {
      clearTimeout(_nudgeReplayTimer)
      setNudgeReplayTimer(null)
    }

    const state = get()
    const joined = state.joinedRoom
    const user = useOnlineStore.getState().user
    if (!joined || joined.host_id === user?.id) return
    if (joined.song?.isDeviceStream || joined.is_device_stream || state.isReceivingDeviceStream) return

    const ps = usePlayerStore.getState()
    if (!ps.isPlaying) return

    const manualOffsetSec = clamped / 1000
    const duration = joined.song?.duration || ps.duration || 0
    let targetTime: number
    const hostPulse = _lastHostPulse as SyncPulsePayload | null
    if (hostPulse) {
      targetTime = roomClockSync.calculateTargetTime(
        hostPulse.position,
        hostPulse.hostTimestamp,
        hostPulse.isPlaying,
        manualOffsetSec,
        duration
      )
    } else {
      const hostPos =
        typeof joined.song?.hostPosition === 'number'
          ? joined.song.hostPosition
          : (joined.position_seconds || 0)
      const hostTimestamp =
        typeof joined.song?.hostTimestamp === 'number'
          ? joined.song.hostTimestamp
          : Date.now()
      targetTime = roomClockSync.calculateTargetTime(
        hostPos,
        hostTimestamp,
        joined.is_playing,
        manualOffsetSec,
        duration
      )
    }

    setIsSessionSyncing(true)
    roomClockSync.notifyManualOffsetChanged()
    ps.seek(targetTime)
    setTimeout(() => {
      setIsSessionSyncing(false)
    }, 300)
  },

  adjustManualSyncOffsetMs: (deltaMs: number) => {
    const current = get().manualSyncOffsetMs || 0
    const next = Math.max(-500, Math.min(500, current + deltaMs))
    try {
      localStorage.setItem(MANUAL_SYNC_OFFSET_STORAGE_KEY, String(next))
    } catch {
      // ignore
    }
    set({ manualSyncOffsetMs: next })

    if (_nudgeReplayTimer) {
      clearTimeout(_nudgeReplayTimer)
    }
    const timer = setTimeout(() => {
      setNudgeReplayTimer(null)
      const state = get()
      const joined = state.joinedRoom
      const user = useOnlineStore.getState().user
      if (!joined || joined.host_id === user?.id) return
      if (joined.song?.isDeviceStream || joined.is_device_stream || state.isReceivingDeviceStream) return

      const ps = usePlayerStore.getState()
      if (!ps.isPlaying) return

      const manualOffsetSec = (state.manualSyncOffsetMs || 0) / 1000
      const duration = joined.song?.duration || ps.duration || 0
      let targetTime: number
      const hostPulse = _lastHostPulse as SyncPulsePayload | null
      if (hostPulse) {
        targetTime = roomClockSync.calculateTargetTime(
          hostPulse.position,
          hostPulse.hostTimestamp,
          hostPulse.isPlaying,
          manualOffsetSec,
          duration
        )
      } else {
        const hostPos =
          typeof joined.song?.hostPosition === 'number'
            ? joined.song.hostPosition
            : (joined.position_seconds || 0)
        const hostTimestamp =
          typeof joined.song?.hostTimestamp === 'number'
            ? joined.song.hostTimestamp
            : Date.now()
        targetTime = roomClockSync.calculateTargetTime(
          hostPos,
          hostTimestamp,
          joined.is_playing,
          manualOffsetSec,
          duration
        )
      }

      setIsSessionSyncing(true)
      roomClockSync.notifyManualOffsetChanged()
      ps.seek(targetTime)
      setTimeout(() => {
        setIsSessionSyncing(false)
      }, 300)
    }, 60)
    setNudgeReplayTimer(timer)
  },

  setIsManualSyncModalOpen: (isOpen: boolean) => {
    set({ isManualSyncModalOpen: isOpen })
  },

  setIsSyncLocked: (locked: boolean) => {
    set({ isSyncLocked: locked })
    if (locked) {
      // Mindory pattern: auto-release sync lock after 1500ms cooldown
      setTimeout(() => {
        set({ isSyncLocked: false })
      }, 1500)
    }
  },

  setIsGuestBuffering: (buffering: boolean) => {
    set({ isGuestBuffering: buffering })
  },

  handleHostSongChange: async (room: ListeningRoom): Promise<void> => {
    const user = useOnlineStore.getState().user
    if (room.host_id === user?.id) return

    // Clean teardown if host stopped playback or ended device stream
    if (!room.song) {
      setCurrentSyncEpoch(getCurrentSyncEpoch() + 1)
      setIsSessionSyncing(false)
      if (get().isReceivingDeviceStream) {
        get().disconnectFromDeviceStream()
      }
      usePlayerStore.getState().setIsPlaying(false)
      set({ syncStatus: 'idle', missingSong: null })
      return
    }

    // Monotonic Epoch: supersedes any older in-flight sync/download
    const mySyncEpoch = incrementSyncEpoch()
    setIsSessionSyncing(true)
    setNeedsInitialSync(true)
    setLastHostPulse(null)
    set({ syncStatus: 'buffering', lastHostUpdate: Date.now() })

    // Helper: Safely applies initial playback state.
    // In MUSIXQUARE, if clock is not yet calibrated (join time), seeking is deferred
    // to the incoming calibrated sync_pulse / pong burst to eliminate join jitter.
    const applyInitialPlaybackState = (
      targetRoom: ListeningRoom,
      syncedSongId: string,
      _songDuration: number
    ) => {
      setLastSyncedSongId(syncedSongId)

      if (!targetRoom.is_playing) {
        usePlayerStore.getState().setIsPlaying(false)
        set({ syncStatus: 'synced', missingSong: null })
        setNeedsInitialSync(false)
        setIsSessionSyncing(false)
        return
      }

      // MUSIXQUARE parity: Gated bootstrap deferral.
      // Changing the player queue reloads the audio element's source.
      // Seeking immediately before readyState >= HAVE_METADATA causes browser aborts,
      // resets to 0:00, and audio jumping.
      // Instead, we mark playback intent, set buffering & needsInitialSync,
      // and let handleHostSyncPulse bootstrap the single clean seek once metadata is loaded.
      usePlayerStore.getState().setIsPlaying(true)
      set({ syncStatus: 'buffering', missingSong: null })
      setNeedsInitialSync(true)
      setIsSessionSyncing(false)
    }

    try {
      // Step 0: Check if host is broadcasting live device / system audio
      if (room.song?.isDeviceStream || room.is_device_stream) {
        usePlayerStore.getState().setIsPlaying(false)
        await get().connectToDeviceStream(room)
        set({ syncStatus: 'synced', missingSong: null })
        return
      }

      // If switching away from live device broadcast to any normal track (local or YouTube), tear down WebRTC client
      if (get().isReceivingDeviceStream) {
        get().disconnectFromDeviceStream()
      }

      // Step 0.5: Check if host is playing a YouTube stream
      const isHostYouTube = Boolean(
        room.song?.isYouTube ||
        room.song?.streamType === 'youtube' ||
        room.song?.videoId ||
        isYouTubeSong(room.song)
      )
      if (isHostYouTube) {
        const videoId =
          room.song?.videoId ||
          extractYouTubeVideoId(room.song?.audioUrl) ||
          extractYouTubeVideoId(room.song?.localId) ||
          ''
        const ytSong: Song = {
          id: `yt-${videoId}`,
          title: room.song?.title || 'YouTube Track',
          artist: room.song?.artist || 'YouTube',
          album: room.song?.album || 'YouTube Stream',
          duration: room.song?.duration || 0,
          artworkPath: room.song?.artworkUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          artworkUrl: room.song?.artworkUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          filePath: `https://www.youtube.com/watch?v=${videoId}`,
          audioUrl: `https://www.youtube.com/watch?v=${videoId}`,
          isYouTube: true,
          isOnline: true
        } as any

        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
        let sessionQueue: Song[] = [ytSong]
        let targetIndex = 0
        if (room.queue && room.queue.length > 0) {
          sessionQueue = room.queue.map((shared) => fromSharedSong(shared))
          const matchIdx = sessionQueue.findIndex((s) => s.id === ytSong.id || (s.title === ytSong.title && s.artist === ytSong.artist))
          if (matchIdx >= 0) {
            targetIndex = matchIdx
            sessionQueue[matchIdx] = ytSong
          } else {
            sessionQueue = [ytSong, ...sessionQueue]
            targetIndex = 0
          }
        }
        usePlayerStore.getState().setQueue(sessionQueue, targetIndex)

        const hostPos = typeof room.song?.hostPosition === 'number' ? room.song.hostPosition : room.position_seconds || 0
        const hostTimestamp = typeof room.song?.hostTimestamp === 'number' ? room.song.hostTimestamp : new Date(room.updated_at).getTime()
        const initialTargetTime = roomClockSync.calculateTargetTime(
          hostPos,
          hostTimestamp,
          room.is_playing,
          (get().manualSyncOffsetMs || 0) / 1000,
          room.song?.duration || 0
        )
        if (initialTargetTime > 0) {
          usePlayerStore.getState().setCurrentTime(initialTargetTime)
          usePlayerStore.getState().seek(initialTargetTime)
        }

        applyInitialPlaybackState(room, ytSong.id, room.song?.duration || 0)
        return
      }

      const playerState = usePlayerStore.getState()
      const songKey = getSongKey(room.song)

      // Step 1: Check if user mapped a custom substitute song for this host track
      const substitute = get().substitutes[songKey]
      if (substitute) {
        if (get().isReceivingDeviceStream) {
          get().disconnectFromDeviceStream()
        }
        let currentQueue = playerState.queue
        let subIndex = currentQueue.findIndex((s) => s.id === substitute.id)
        if (subIndex < 0) {
          currentQueue = [substitute, ...playerState.queue]
          subIndex = 0
        }
        usePlayerStore.getState().setQueue(currentQueue, subIndex)
        applyInitialPlaybackState(room, substitute.id, substitute.duration || room.song?.duration || 0)
        return
      }

      if (!room.song) {
        set({ syncStatus: 'idle', missingSong: null })
        return
      }

      const songId = room.song.localId || (room.song as any).id || ''
      const inRamBlobUrl = songId ? getCachedAudioBlobUrl(songId) || get().losslessStreamBlobUrl : null

      // Step 1.5: MUSIXQUARE In-RAM Fast Path (Instant 0ms swap for preloaded tracks)
      if (inRamBlobUrl) {
        console.log(`[handleHostSongChange] FAST PATH: In-RAM audio blob ready for "${room.song.title}" (${songId})`)
        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
        useConnectedDeviceStore.getState().claimPlayback()
        usePlayerStore.getState().claimAudioOwnership()

        const syncedSong: Song = {
          id: songId || `synced-${Date.now()}`,
          title: room.song.title,
          artist: room.song.artist,
          album: room.song.album || 'Listen Together',
          duration: room.song.duration || 0,
          artworkPath: room.song.artworkUrl || '',
          artworkUrl: room.song.artworkUrl || '',
          filePath: inRamBlobUrl,
          audioUrl: inRamBlobUrl,
          isOnline: true
        }

        let sessionQueue: Song[] = []
        let targetIndex = 0

        if (room.queue && room.queue.length > 0) {
          sessionQueue = room.queue.map((shared, idx) => {
            const isTarget =
              (shared.localId && shared.localId === songId) ||
              ((shared as any).id && (shared as any).id === songId) ||
              (normalizeSongValue(shared.title) === normalizeSongValue(room.song!.title) &&
                normalizeSongValue(shared.artist) === normalizeSongValue(room.song!.artist))
            if (isTarget) return syncedSong
            return {
              id: `session-${idx}-${shared.localId || idx}`,
              title: shared.title,
              artist: shared.artist,
              album: shared.album || '',
              duration: shared.duration || 0,
              artworkPath: shared.artworkUrl || '',
              filePath: shared.audioUrl || ''
            } as Song
          })
          const activeIdx = sessionQueue.findIndex((s) => s.id === syncedSong.id)
          targetIndex = activeIdx >= 0 ? activeIdx : 0
        } else {
          sessionQueue = [syncedSong]
          targetIndex = 0
        }

        usePlayerStore.getState().setQueue(sessionQueue, targetIndex)

        applyInitialPlaybackState(room, syncedSong.id, room.song.duration || 0)
        void get().preloadNextQueueTracks(room)
        return
      }

      // Step 2: Search local library to find matching local track
      const allLocalSongs = ((await window.api?.getSongs?.()) || []) as Song[]
      if (mySyncEpoch !== getCurrentSyncEpoch()) return

      const matchedIndex = findSongMatchIndex(allLocalSongs, room.song.title, room.song.artist)

      // Step 3: Song not found locally - stream directly via Musixquare JIT audio pipeline
      if (matchedIndex < 0) {
        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
        useConnectedDeviceStore.getState().claimPlayback()
        usePlayerStore.getState().claimAudioOwnership()

        // 1. Check RAM cached audio blob first (if already buffered into memory)
        let blobUrl = songId ? getCachedAudioBlobUrl(songId) || '' : ''

        // 2. In-RAM JIT Blob fallback from live P2P stream
        if (!blobUrl) {
          const inMemBlob = get().losslessStreamBlobUrl
          if (inMemBlob) blobUrl = inMemBlob
        }

        // 3. If not in RAM yet, check if host is still uploading
        const isHostUploading = room.song.uploadStatus === 'UPLOADING' || room.song.uploadStatus === 'METADATA_ONLY'
        if (!blobUrl && isHostUploading) {
          // Fast check if bucket actually already has it (HEAD check)
          let ready = await isSongInAudioBucket(songId)
          if (mySyncEpoch !== getCurrentSyncEpoch()) return

          if (!ready) {
            // Host is currently uploading track to cloud — indicate buffering and wait with watchdog loop
            set({ syncStatus: 'buffering', missingSong: null })
            console.log(`[handleHostSongChange] Waiting for host upload of "${room.song.title}" (${room.song.statusText || 'Uploading...'})`)
            for (let i = 0; i < 50; i++) {
              await new Promise((r) => setTimeout(r, 800))
              if (mySyncEpoch !== getCurrentSyncEpoch()) return

              // Check if fresh broadcast or DB update already delivered the audioUrl
              const latestRoom = get().joinedRoom
              if (latestRoom?.song?.audioUrl && /^https?:\/\//i.test(latestRoom.song.audioUrl)) {
                room.song.audioUrl = latestRoom.song.audioUrl
                room.song.uploadStatus = 'UPLOADED'
                ready = true
                break
              }

              ready = await isSongInAudioBucket(songId)
              if (ready) break
            }
          }
        }

        // 4. Resolve stream URL (Progressive two-tier delivery: Preview first -> Full quality)
        const hasPreview = Boolean(room.song.previewUrl && /^https?:\/\//i.test(room.song.previewUrl))
        const fullSourceUrl =
          room.song.audioUrl && /^https?:\/\//i.test(room.song.audioUrl) && !/127\.0\.0\.1|localhost/i.test(room.song.audioUrl)
            ? room.song.audioUrl
            : songId
              ? getSongPublicBucketUrl(songId)
              : ''

        let streamSourceUrl = ''
        let isUsingPreview = false

        if (blobUrl) {
          // Already have cached full blob in RAM
          set({ audioQuality: 'full' })
        } else if (hasPreview) {
          streamSourceUrl = room.song.previewUrl!
          isUsingPreview = true
          set({ audioQuality: 'preview' })
        } else if (fullSourceUrl) {
          streamSourceUrl = fullSourceUrl
          set({ audioQuality: 'full' })
        }

        if (!streamSourceUrl && room.song.lanUrl && typeof window !== 'undefined') {
          const isHttps = window.location.protocol === 'https:'
          const isLoopback = /127\.0\.0\.1|localhost/i.test(room.song.lanUrl)
          if (!isHttps && !isLoopback) {
            streamSourceUrl = room.song.lanUrl
          }
        }

        // 5. In-Memory JIT Audio Buffer Ingestion:
        // Automatically download audio bytes into an in-RAM Blob with 90s watchdog and transient retry
        if (!blobUrl && streamSourceUrl) {
          try {
            set({ syncStatus: 'buffering' })
            const blob = await downloadRemoteAudioFileWithRetry(streamSourceUrl, {
              trackId: isUsingPreview ? `${songId}_preview` : songId,
              onProgress: (progress, details) => {
                const percent = Math.min(99, Math.round(progress * 100))
                get().setJitStatus(
                  songId,
                  percent,
                  isUsingPreview ? `Fast Join Preview... ${percent}%` : `Buffering... ${percent}%`,
                  details?.loaded,
                  details?.total
                )
              }
            })
            if (mySyncEpoch !== getCurrentSyncEpoch()) return
            if (blob && blob.size > 0) {
              blobUrl = cacheAudioBlob(isUsingPreview ? `${songId}_preview` : songId, blob)
              get().setJitStatus(songId, 100, isUsingPreview ? 'Playing (Preview)' : 'Playing (Synced)', blob.size, blob.size)
              set({ syncStatus: 'synced' })
            }
          } catch (fetchErr) {
            console.warn('[handleHostSongChange] In-RAM audio fetch failed, falling back to direct URL:', fetchErr)
          }
        }

        let directUrl = blobUrl || streamSourceUrl

        if (!directUrl && room.song.lanUrl && typeof window !== 'undefined') {
          const isHttps = window.location.protocol === 'https:'
          const isLoopback = /127\.0\.0\.1|localhost/i.test(room.song.lanUrl)
          if (!isHttps && !isLoopback) {
            directUrl = room.song.lanUrl
          }
        }

        if (!directUrl) {
          const resolved = resolveSongAudioUrl({
            id: songId,
            title: room.song.title,
            artist: room.song.artist,
            album: room.song.album || '',
            duration: room.song.duration || 0,
            filePath: '',
            audioUrl: ''
          })
          if (resolved) directUrl = resolved
        }

        if (!directUrl) {
          console.warn(`[handleHostSongChange] No valid audio URL for "${room.song.title}"`)
          set({ syncStatus: 'missing_song', missingSong: room.song })
          return
        }

        const syncedSong: Song = {
          id: songId || `synced-${Date.now()}`,
          title: room.song.title,
          artist: room.song.artist,
          album: room.song.album || 'Listen Together',
          duration: room.song.duration || 0,
          artworkPath: room.song.artworkUrl || '',
          artworkUrl: room.song.artworkUrl || '',
          filePath: directUrl,
          audioUrl: directUrl,
          isOnline: true
        }

        let sessionQueue: Song[] = []
        let targetIndex = 0

        if (room.queue && room.queue.length > 0) {
          sessionQueue = room.queue.map((shared, idx) => {
            const isTarget =
              (shared.localId && shared.localId === songId) ||
              ((shared as any).id && (shared as any).id === songId) ||
              (normalizeSongValue(shared.title) === normalizeSongValue(room.song!.title) &&
                normalizeSongValue(shared.artist) === normalizeSongValue(room.song!.artist))
            if (isTarget) return syncedSong
            const localMatchIdx = findSongMatchIndex(allLocalSongs, shared.title, shared.artist)
            if (localMatchIdx >= 0) {
              return allLocalSongs[localMatchIdx]
            }
            return {
              id: `session-${idx}-${shared.localId || idx}`,
              title: shared.title,
              artist: shared.artist,
              album: shared.album || '',
              duration: shared.duration || 0,
              artworkPath: shared.artworkUrl || '',
              filePath: shared.audioUrl || ''
            } as Song
          })
          const activeIdx = sessionQueue.findIndex((s) => s.id === syncedSong.id)
          targetIndex = activeIdx >= 0 ? activeIdx : 0
        } else {
          sessionQueue = [syncedSong]
          targetIndex = 0
        }

        usePlayerStore.getState().setQueue(sessionQueue, targetIndex)

        applyInitialPlaybackState(room, syncedSong.id, room.song.duration || 0)

        // If we started with the fast compressed preview, initiate background download of full quality track
        if (isUsingPreview && fullSourceUrl) {
          void (async () => {
            try {
              console.log(`[handleHostSongChange] Progressive upgrade: downloading full quality file for "${room.song!.title}"...`)
              const fullBlob = await downloadRemoteAudioFileWithRetry(fullSourceUrl, {
                trackId: songId
              })
              if (mySyncEpoch !== getCurrentSyncEpoch()) return
              if (fullBlob && fullBlob.size > 0) {
                const fullBlobUrl = cacheAudioBlob(songId, fullBlob)
                console.log(`[handleHostSongChange] Full quality download complete for "${room.song!.title}", hot-swapping...`)
                await get().hotSwapToFullQuality(fullBlobUrl)
              }
            } catch (err) {
              console.warn('[handleHostSongChange] Progressive upgrade download failed:', err)
            }
          })()
        }

        // Pre-load the NEXT song in queue into in-memory RAM cache for zero-latency sync
        void get().preloadNextQueueTracks(room)

        // Optional: If auto-download is enabled on desktop and window.api exists, background pre-download for future offline play
        if (get().autoDownloadMissing && room.song && typeof window !== 'undefined' && window.api?.startDownload) {
          const requestKey = `${room.id}:${songKey}`
          if (!_autoDownloadRequests.has(requestKey)) {
            _autoDownloadRequests.add(requestKey)
            void (async () => {
              try {
                const query =
                  cleanSearchQuery(room.song!.artist, room.song!.title) ||
                  `${room.song!.artist || ''} ${room.song!.title}`.trim()
                const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
                const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
                const priority = Array.isArray(savedPriority) && savedPriority.length > 0
                  ? savedPriority
                  : DEFAULT_DOWNLOAD_PRIORITY
                const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

                for (const source of priority) {
                  if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) continue
                  if (source === 'deezer' && !accounts.deezerArl) continue
                  if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) continue

                  try {
                    let timer: ReturnType<typeof setTimeout> | undefined
                    const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
                    const timeoutPromise = new Promise<never>((_, reject) => {
                      timer = setTimeout(() => reject(new Error(`Room track search timed out on ${source}`)), 12000)
                    })
                    const results = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
                      if (timer) clearTimeout(timer)
                    })
                    const bestHit = findBestDownloadMatch(
                      results,
                      room.song!.title,
                      room.song!.artist,
                      room.song!.duration
                    )
                    if (!bestHit) continue

                    const transferId = `room-${room.id}-${Date.now()}`
                    const safeArtwork =
                      bestHit.artworkUrl && /^https?:\/\//i.test(bestHit.artworkUrl)
                        ? bestHit.artworkUrl
                        : room.song?.artworkUrl && /^https?:\/\//i.test(room.song.artworkUrl)
                          ? room.song.artworkUrl
                          : undefined

                    useDownloadStore.getState().queueTransfer(
                      {
                        id: transferId,
                        source: source as any,
                        sourceName: bestHit.sourceName || source,
                        title: bestHit.title || room.song!.title,
                        artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                        quality: bestHit.quality || 'FLAC',
                        size: bestHit.size || '...',
                        conflictMode: 'keep_both',
                        status: 'downloading',
                        progress: 5,
                        message: `Downloading from ${bestHit.sourceName || source}...`,
                        autoPlay: false,
                        resultId: String(bestHit.id),
                        song: room.song ? fromSharedSong(room.song) : undefined
                      },
                      { openDrawer: false }
                    )

                    await window.api?.startDownload?.({
                      transferId,
                      source,
                      resultId: String(bestHit.id),
                      title: bestHit.title || room.song!.title,
                      artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                      songId: '',
                      conflictMode: 'keep_both',
                      accounts,
                      autoPlay: false,
                      artworkUrl: safeArtwork,
                      album: bestHit.album || room.song?.album
                    })
                    return
                  } catch (sourceErr) {
                    console.warn(`Auto-download failed on source ${source}:`, sourceErr)
                  }
                }
              } catch (autoErr) {
                console.warn('Auto-download background search attempt:', autoErr)
              } finally {
                setTimeout(() => _autoDownloadRequests.delete(requestKey), 30_000)
              }
            })()
          }
        }

        return
      }

      // Step 4: Construct the Session Queue preserving the room's shared queue
      if (get().isReceivingDeviceStream) {
        get().disconnectFromDeviceStream()
      }
      const matchedSong = allLocalSongs[matchedIndex]
      let sessionQueue: Song[] = []
      let targetIndex = 0

      if (room.queue && room.queue.length > 0) {
        sessionQueue = room.queue.map((shared, idx) => {
          const localMatchIdx = findSongMatchIndex(allLocalSongs, shared.title, shared.artist)
          if (localMatchIdx >= 0) {
            return allLocalSongs[localMatchIdx]
          }
          // Synthetic placeholder for queue items not yet on disk
          return {
            id: `session-${idx}-${shared.localId || idx}`,
            title: shared.title,
            artist: shared.artist,
            album: shared.album || '',
            duration: shared.duration || 0,
            artworkPath: shared.artworkUrl || '',
            filePath: ''
          } as Song
        })

        const activeInQueueIdx = sessionQueue.findIndex(
          (s) =>
            normalizeSongValue(s.title) === normalizeSongValue(room.song!.title) &&
            normalizeSongValue(s.artist) === normalizeSongValue(room.song!.artist)
        )
        if (activeInQueueIdx >= 0) {
          sessionQueue[activeInQueueIdx] = matchedSong
          targetIndex = activeInQueueIdx
        } else {
          sessionQueue = [matchedSong, ...sessionQueue]
          targetIndex = 0
        }
      } else {
        sessionQueue = [matchedSong]
        targetIndex = 0
      }

      // Step 5: Switch to session queue and matched song
      const currentPlaying = playerState.queue[playerState.currentSongIndex]
      if (!currentPlaying || currentPlaying.id !== matchedSong.id) {
        usePlayerStore.getState().setQueue(sessionQueue, targetIndex)
        if (!room.is_playing) {
          usePlayerStore.getState().setIsPlaying(false)
        }
      }

      // Step 6: Initial playback alignment (latency compensated via roomClockSync)
      applyInitialPlaybackState(room, matchedSong.id, matchedSong.duration || room.song?.duration || 0)
      void get().preloadNextQueueTracks(room)
    } catch (err) {
      console.error('Sync error during song change:', err)
      set({ syncStatus: 'missing_song', missingSong: room.song })
    } finally {
      if (mySyncEpoch === getCurrentSyncEpoch() && !needsInitialSync()) {
        setIsSessionSyncing(false)
      }
    }
  },

  preloadNextQueueTracks: async (room: ListeningRoom): Promise<void> => {
    if (!room || !room.queue || room.queue.length === 0) return
    const user = useOnlineStore.getState().user

    if (room.host_id === user?.id) {
      // Host: ensure upcoming 1-2 tracks in queue are pre-uploaded to Cloud CDN so guests have zero delay
      const player = usePlayerStore.getState()
      const nextTracks = player.queue.slice(player.currentSongIndex + 1, player.currentSongIndex + 3)
      for (const nextTrack of nextTracks) {
        if (nextTrack) void ensureTrackInAudioBucket(nextTrack)
      }
      return
    }

    try {
      const songs = ((await window.api?.getSongs?.()) || []) as Song[]

      // Find where the current host song sits in room.queue
      let currentIndex = -1
      if (room.song) {
        currentIndex = room.queue.findIndex(
          (s) =>
            s.localId === room.song!.localId ||
            (normalizeSongValue(s.title) === normalizeSongValue(room.song!.title) &&
              normalizeSongValue(s.artist) === normalizeSongValue(room.song!.artist))
        )
      }

      // Pre-buffer the next 1-2 tracks ahead
      const startIndex = currentIndex >= 0 ? currentIndex + 1 : 1
      const upcomingTracks = room.queue.slice(startIndex, startIndex + 2)

      for (const upcomingSong of upcomingTracks) {
        if (!upcomingSong.title || !upcomingSong.artist) continue

        const trackId = upcomingSong.localId || (upcomingSong as any).id || ''
        const songKey = `${normalizeSongValue(upcomingSong.artist)} - ${normalizeSongValue(upcomingSong.title)}`
        const requestKey = `preload:${room.id}:${trackId || songKey}`
        if (_autoDownloadRequests.has(requestKey)) continue
        _autoDownloadRequests.add(requestKey)

        // 1. Direct JIT / CDN / LAN binary pre-buffering into RAM & auto-download
        let directStreamUrl = upcomingSong.audioUrl || upcomingSong.lanUrl || ''
        if (directStreamUrl && /127\.0\.0\.1/i.test(directStreamUrl)) {
          if (typeof window !== 'undefined' && !window.location.hostname.includes('127.0.0.1')) {
            directStreamUrl = directStreamUrl.replace(/127\.0\.0\.1/g, window.location.hostname)
          }
        }
        if (!directStreamUrl && trackId) {
          directStreamUrl = getSongPublicBucketUrl(trackId)
        }

        if (directStreamUrl) {
          void (async () => {
            try {
              let isReady = true
              if (directStreamUrl.includes('songs') && trackId) {
                isReady = await isSongInAudioBucket(trackId)
                if (!isReady) {
                  for (let i = 0; i < 8; i++) {
                    await new Promise((r) => setTimeout(r, 1500))
                    isReady = await isSongInAudioBucket(trackId)
                    if (isReady) break
                  }
                }
              }
              if (!isReady) return

              const blob = await downloadRemoteAudioFileWithRetry(directStreamUrl, {
                trackId,
                onProgress: () => {}
              })
              if (blob && blob.size > 0 && trackId) {
                cacheAudioBlob(trackId, blob)
                console.log(`[preloadNextQueueTracks] Cached next track "${upcomingSong.title}" into RAM (${Math.round(blob.size / 1024)} KB)`)
              }
            } catch (err) {
              console.warn('[preloadNextQueueTracks] Binary preload failed:', err)
            }
          })()
        }

        const inLibrary = findSongMatchIndex(songs, upcomingSong.title, upcomingSong.artist) >= 0
        if (inLibrary) continue

        // Optional scraper fallback for desktop Electron
        if (!get().autoDownloadMissing || typeof window === 'undefined' || !window.api?.searchDownloadSource) continue

        void (async () => {
          try {
            const query =
              cleanSearchQuery(upcomingSong.artist, upcomingSong.title) ||
              `${upcomingSong.artist || ''} ${upcomingSong.title}`.trim()
            const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
            const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
            const priority = Array.isArray(savedPriority) && savedPriority.length > 0
              ? savedPriority
              : DEFAULT_DOWNLOAD_PRIORITY
            const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

            for (const source of priority) {
              if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) continue
              if (source === 'deezer' && !accounts.deezerArl) continue
              if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) continue

              try {
                let timer: ReturnType<typeof setTimeout> | undefined
                const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
                const timeoutPromise = new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error(`Preload track search timed out on ${source}`)), 12000)
                })
                const results = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
                  if (timer) clearTimeout(timer)
                })
                const bestHit = findBestDownloadMatch(
                  results,
                  upcomingSong.title,
                  upcomingSong.artist,
                  upcomingSong.duration
                )
                if (!bestHit) continue

                const transferId = `preload-${room.id}-${Date.now()}`
                const safeArtwork =
                  bestHit.artworkUrl && /^https?:\/\//i.test(bestHit.artworkUrl)
                    ? bestHit.artworkUrl
                    : upcomingSong.artworkUrl && /^https?:\/\//i.test(upcomingSong.artworkUrl)
                      ? upcomingSong.artworkUrl
                      : undefined

                useDownloadStore.getState().queueTransfer(
                  {
                    id: transferId,
                    source: source as any,
                    sourceName: bestHit.sourceName || source,
                    title: bestHit.title || upcomingSong.title,
                    artist: bestHit.artist || upcomingSong.artist || 'Unknown Artist',
                    quality: bestHit.quality || 'FLAC',
                    size: bestHit.size || '...',
                    conflictMode: 'keep_both',
                    status: 'downloading',
                    progress: 5,
                    message: `Pre-buffering next track for session: "${upcomingSong.title}"`,
                    autoPlay: false,
                    resultId: String(bestHit.id),
                    song: fromSharedSong(upcomingSong)
                  },
                  { openDrawer: false }
                )

                await window.api?.startDownload?.({
                  transferId,
                  source,
                  resultId: String(bestHit.id),
                  title: bestHit.title || upcomingSong.title,
                  artist: bestHit.artist || upcomingSong.artist || 'Unknown Artist',
                  songId: '',
                  conflictMode: 'keep_both',
                  accounts,
                  autoPlay: false,
                  artworkUrl: safeArtwork,
                  album: bestHit.album || upcomingSong.album
                })
                return
              } catch (err) {
                console.warn(`Pre-download failed on source ${source}:`, err)
              }
            }
          } catch (preErr) {
            console.warn('Pre-download search error:', preErr)
          } finally {
            setTimeout(() => _autoDownloadRequests.delete(requestKey), 60_000)
          }
        })()
      }
    } catch (err) {
      console.warn('preloadNextQueueTracks failed:', err)
    }
  },

  handleHostPauseResume: (room: ListeningRoom): void => {
    const user = useOnlineStore.getState().user
    if (room.host_id === user?.id) return

    // Always note host presence regardless of session sync status
    set({ lastHostUpdate: Date.now() })

    if (isSessionSyncing()) return

    // If host is streaming device audio, WebRTC handles real-time audio playback directly
    if (room.song?.isDeviceStream || room.is_device_stream || get().isReceivingDeviceStream) {
      if (room.song) {
        const hostPos = typeof room.song.hostPosition === 'number' ? room.song.hostPosition : room.position_seconds || 0
        usePlayerStore.getState().setCurrentTime(hostPos)
      }
      return
    }

    const currentStatus = get().syncStatus
    if (currentStatus === 'missing_song') {
      void get().handleHostSongChange(room)
      return
    }

    // If room is back to life, recover from host_reconnecting
    if (currentStatus === 'host_reconnecting') {
      set({ syncStatus: 'synced' })
    }

    const playerState = usePlayerStore.getState()
    if (playerState.isPlaying !== room.is_playing) {
      playerState.setIsPlaying(room.is_playing)
    }

    const activeTime = getActiveAudioTime()
    const currentGuestTime = activeTime > 0 ? activeTime : playerState.currentTime || 0
    const manualOffsetSec = (get().manualSyncOffsetMs || 0) / 1000
    const duration = room.song?.duration || 0
    const hostPos =
      typeof room.song?.hostPosition === 'number'
        ? room.song.hostPosition
        : room.position_seconds || 0
    const hostTimestamp =
      typeof room.song?.hostTimestamp === 'number'
        ? room.song.hostTimestamp
        : Date.now()

    const targetTime = roomClockSync.calculateTargetTime(
      hostPos,
      hostTimestamp,
      room.is_playing,
      manualOffsetSec,
      duration
    )

    if (room.is_playing) {
      // During active playback, playhead seeks are exclusively managed by real-time sync pulses.
      // Database positions are not evaluated here to prevent rewind jitter loops.
    } else {
      if (getAudioPlaybackRate() !== 1.0) {
        setAudioPlaybackRate(1.0)
      }
      // If host is paused, align guest position accurately (drift > 0.05s) so video frame & lyrics match host exactly
      const drift = Math.abs(currentGuestTime - targetTime)
      if (drift > 0.05) {
        setIsSessionSyncing(true)
        playerState.seek(targetTime)
        playerState.setCurrentTime(targetTime)
        setTimeout(() => {
          setIsSessionSyncing(false)
        }, 500)
      }
      if (room.song) {
        room.song.hostPosition = hostPos
        room.song.hostTimestamp = hostTimestamp
      }
      set((state) => ({
        joinedRoom: state.joinedRoom
          ? {
              ...state.joinedRoom,
              position_seconds: Math.round(targetTime),
              is_playing: false,
              song: state.joinedRoom.song
                ? {
                    ...state.joinedRoom.song,
                    hostPosition: hostPos,
                    hostTimestamp: hostTimestamp
                  }
                : null
            }
          : null
      }))
    }
  },

  handleHostSyncPulse: (pulse: SyncPulsePayload): void => {
    const user = useOnlineStore.getState().user
    const joined = get().joinedRoom
    if (!joined || joined.host_id === user?.id) return

    setLastHostPulse(pulse)

    // Always note host presence unconditionally upon arrival of sync pulse
    set({ lastHostUpdate: Date.now() })

    if (joined.song?.isDeviceStream || joined.is_device_stream || get().isReceivingDeviceStream) {
      // Even in WebRTC stream, update joinedRoom position metadata and player current time so lyrics stay in sync!
      if (joined.song) {
        joined.song.hostPosition = pulse.position
        joined.song.hostTimestamp = pulse.hostTimestamp
      }
      set((state) => ({
        joinedRoom: state.joinedRoom
          ? {
              ...state.joinedRoom,
              position_seconds: Math.round(pulse.position),
              is_playing: pulse.isPlaying,
              song: state.joinedRoom.song
                ? {
                    ...state.joinedRoom.song,
                    hostPosition: pulse.position,
                    hostTimestamp: pulse.hostTimestamp
                  }
                : null
            }
          : null
      }))
      usePlayerStore.getState().setCurrentTime(pulse.position)
      return
    }

    const currentStatus = get().syncStatus
    if (currentStatus === 'missing_song') {
      return
    }

    if (currentStatus === 'host_reconnecting') {
      set({ syncStatus: 'synced' })
    }

    const playerState = usePlayerStore.getState()
    const currentSong = playerState.queue[playerState.currentSongIndex]

    // MUSIXQUARE Track Identity Validation:
    // If pulse carries a trackId that does not match our currently playing track,
    // the host has changed songs! Do not seek the old track to the new track's position.
    if (
      pulse.trackId &&
      currentSong &&
      pulse.trackId !== currentSong.id &&
      pulse.trackId !== (currentSong as any).localId &&
      pulse.trackId !== joined.song?.localId &&
      pulse.trackId !== (joined.song as any)?.id
    ) {
      roomClockSync.notifyManualOffsetChanged()
      return
    }

    // ─── MUSIXQUARE Gated Bootstrap (Initial Join / Track Switch) ────
    // If guest just joined or switched track, do NOT seek until:
    // 1. NTP clock is calibrated via ping/pong
    // 2. Audio element has loaded metadata
    if (needsInitialSync()) {
      if (!roomClockSync.isCalibrated()) {
        return
      }

      const isYouTube = Boolean((currentSong as any)?.isYouTube || (currentSong as any)?.videoId)
      const activeEl = getActiveAudioElement()
      if (!isYouTube && activeEl && activeEl.readyState < HTMLMediaElement.HAVE_METADATA) {
        return
      }

      const manualOffsetSec = (get().manualSyncOffsetMs || 0) / 1000
      const duration = joined.song?.duration || playerState.duration || 0
      const targetTime = roomClockSync.calculateTargetTime(
        pulse.position,
        pulse.hostTimestamp,
        pulse.isPlaying,
        manualOffsetSec,
        duration
      )

      setIsSessionSyncing(true)
      if (targetTime > 0) {
        playerState.seek(targetTime)
        playerState.setCurrentTime(targetTime)
      }
      setAudioPlaybackRate(1.0)
      playerState.setIsPlaying(pulse.isPlaying)
      set({ syncStatus: 'synced', missingSong: null })
      setNeedsInitialSync(false)

      if (joined.song) {
        joined.song.hostPosition = pulse.position
        joined.song.hostTimestamp = pulse.hostTimestamp
      }

      setTimeout(() => {
        setIsSessionSyncing(false)
      }, 1000)
      return
    }

    // ─── Steady-State: Passive Drift Monitoring Only (Event-Driven Sync) ─────
    // The heartbeat is ONLY used for drift detection and play/pause state.
    // It NEVER seeks or adjusts playback rate. All active correction is handled
    // by explicit event handlers (host_seek, host_play_pause, track_change).
    if (isSessionSyncing()) return
    if (get().isSyncLocked) return
    if (get().isGuestBuffering) return
    if (playerState.seekRequest !== null) return
    if (playerState.isBuffering) return

    // Sync play/pause state from heartbeat (but not position)
    if (playerState.isPlaying !== pulse.isPlaying) {
      playerState.setIsPlaying(pulse.isPlaying)
    }

    const manualOffsetSec = (get().manualSyncOffsetMs || 0) / 1000
    const duration = joined.song?.duration || playerState.duration || 0
    const targetTime = roomClockSync.calculateTargetTime(
      pulse.position,
      pulse.hostTimestamp,
      pulse.isPlaying,
      manualOffsetSec,
      duration
    )

    const activeTime = getActiveAudioTime()
    const currentGuestTime = activeTime > 0 ? activeTime : playerState.currentTime || 0

    // If host is paused, snap position once so lyrics/frame match
    if (!pulse.isPlaying) {
      if (getAudioPlaybackRate() !== 1.0) {
        setAudioPlaybackRate(1.0)
      }
      const drift = Math.abs(currentGuestTime - targetTime)
      if (drift > 0.5) {
        // Only snap on pause if drift is significant (>500ms), not aggressive 50ms
        setIsSessionSyncing(true)
        get().setIsSyncLocked(true)
        playerState.seek(targetTime)
        playerState.setCurrentTime(targetTime)
        setTimeout(() => {
          setIsSessionSyncing(false)
        }, 500)
      }
      if (joined.song) {
        joined.song.hostPosition = pulse.position
        joined.song.hostTimestamp = pulse.hostTimestamp
      }
      set((state) => ({
        driftSeconds: 0,
        joinedRoom: state.joinedRoom
          ? {
              ...state.joinedRoom,
              position_seconds: Math.round(pulse.position),
              is_playing: false,
              song: state.joinedRoom.song
                ? {
                    ...state.joinedRoom.song,
                    hostPosition: pulse.position,
                    hostTimestamp: pulse.hostTimestamp
                  }
                : null
            }
          : null
      }))
      return
    }

    // During active playback: ONLY record drift for CatchUp HUD, never seek or adjust rate
    const drift = currentGuestTime - targetTime
    set({ driftSeconds: drift })

    // Ensure rate is always 1.0x during normal playback (no micro-adjustments from heartbeat)
    if (getAudioPlaybackRate() !== 1.0) {
      setAudioPlaybackRate(1.0)
    }

    // Update joinedRoom metadata for UI display
    if (joined.song) {
      joined.song.hostPosition = pulse.position
      joined.song.hostTimestamp = pulse.hostTimestamp
    }
    set((state) => ({
      joinedRoom: state.joinedRoom
        ? {
            ...state.joinedRoom,
            position_seconds: Math.round(pulse.position),
            is_playing: pulse.isPlaying,
            song: state.joinedRoom.song
              ? {
                  ...state.joinedRoom.song,
                  hostPosition: pulse.position,
                  hostTimestamp: pulse.hostTimestamp
                }
              : null
          }
        : null
    }))
  },

  handleHostExplicitSeek: (payload: { position: number; hostTimestamp: number; trackId?: string }): void => {
    const user = useOnlineStore.getState().user
    const joined = get().joinedRoom
    if (!joined || joined.host_id === user?.id) return

    // Always register host presence unconditionally
    set({ lastHostUpdate: Date.now() })

    if (joined.song?.isDeviceStream || joined.is_device_stream || get().isReceivingDeviceStream) {
      if (joined.song) {
        joined.song.hostPosition = payload.position
        joined.song.hostTimestamp = payload.hostTimestamp
      }
      usePlayerStore.getState().setCurrentTime(payload.position)
      return
    }

    const playerState = usePlayerStore.getState()
    const currentSong = playerState.queue[playerState.currentSongIndex]
    if (
      payload.trackId &&
      currentSong &&
      payload.trackId !== currentSong.id &&
      payload.trackId !== (currentSong as any).localId &&
      payload.trackId !== joined.song?.localId &&
      payload.trackId !== (joined.song as any)?.id
    ) {
      return
    }

    // Sync lock + buffering guard: prevent echo loop seeks
    if (get().isSyncLocked || get().isGuestBuffering) return

    const duration = joined.song?.duration || playerState.duration || 0
    const manualOffsetSec = (get().manualSyncOffsetMs || 0) / 1000
    const targetTime = roomClockSync.calculateTargetTime(
      payload.position,
      payload.hostTimestamp,
      playerState.isPlaying,
      manualOffsetSec,
      duration
    )

    setIsSessionSyncing(true)
    get().setIsSyncLocked(true)
    roomClockSync.notifyManualOffsetChanged()
    playerState.seek(targetTime)
    playerState.setCurrentTime(targetTime)

    if (joined.song) {
      joined.song.hostPosition = payload.position
      joined.song.hostTimestamp = payload.hostTimestamp
    }
    set((state) => ({
      driftSeconds: 0,
      joinedRoom: state.joinedRoom
        ? {
            ...state.joinedRoom,
            position_seconds: Math.round(targetTime),
            song: state.joinedRoom.song
              ? {
                  ...state.joinedRoom.song,
                  hostPosition: payload.position,
                  hostTimestamp: payload.hostTimestamp
                }
              : null
          }
        : null
    }))

    setTimeout(() => {
      setIsSessionSyncing(false)
    }, 800)
  },

  handleHostExplicitPlayPause: (payload: { isPlaying: boolean; position?: number; hostTimestamp: number; trackId?: string }): void => {
    const user = useOnlineStore.getState().user
    const joined = get().joinedRoom
    if (!joined || joined.host_id === user?.id) return

    // Always register host presence unconditionally
    set({ lastHostUpdate: Date.now() })

    if (joined.song?.isDeviceStream || joined.is_device_stream || get().isReceivingDeviceStream) {
      return
    }

    const playerState = usePlayerStore.getState()
    if (playerState.isPlaying !== payload.isPlaying) {
      playerState.setIsPlaying(payload.isPlaying)
    }

    if (!payload.isPlaying) {
      // Host paused: reset rate and align guest frame cleanly to paused position
      if (getAudioPlaybackRate() !== 1.0) {
        setAudioPlaybackRate(1.0)
      }
      if (typeof payload.position === 'number') {
        const activeTime = getActiveAudioTime()
        const currentGuestTime = activeTime > 0 ? activeTime : playerState.currentTime || 0
        const drift = Math.abs(currentGuestTime - payload.position)
        if (drift > 0.05) {
          setIsSessionSyncing(true)
          playerState.seek(payload.position)
          playerState.setCurrentTime(payload.position)
          setTimeout(() => {
            setIsSessionSyncing(false)
          }, 500)
        }
      }
    }

    if (joined.song && typeof payload.position === 'number') {
      joined.song.hostPosition = payload.position
      joined.song.hostTimestamp = payload.hostTimestamp
    }
    set((state) => ({
      joinedRoom: state.joinedRoom
        ? {
            ...state.joinedRoom,
            is_playing: payload.isPlaying,
            position_seconds: typeof payload.position === 'number' ? Math.round(payload.position) : state.joinedRoom.position_seconds,
            song: state.joinedRoom.song
              ? {
                  ...state.joinedRoom.song,
                  hostPosition: typeof payload.position === 'number' ? payload.position : state.joinedRoom.song.hostPosition,
                  hostTimestamp: payload.hostTimestamp
                }
              : null
          }
        : null
    }))
  },

  checkHostHealth: async (): Promise<void> => {
    const joined = get().joinedRoom
    const user = useOnlineStore.getState().user
    if (!joined || !user) return

    const now = Date.now()
    const lastUpdateTs = get().lastHostUpdate || now
    const elapsed = now - lastUpdateTs

    // 1. Stage 1: Healthy (< 30 seconds since last heartbeat)
    if (elapsed < 30_000) {
      if (get().syncStatus === 'host_reconnecting') {
        set({ syncStatus: 'synced' })
        if (joined.is_playing) {
          get().handleHostPauseResume(joined)
        }
      }
      return
    }

    // 2. Stage 2: Host lag / grace period (30s to 90s grace period)
    if (elapsed < 90_000) {
      try {
        const { data: freshRoom } = await getSupabase()
          .from('listening_rooms')
          .select('id, is_active, updated_at, host_id')
          .eq('id', joined.id)
          .maybeSingle()

        if (freshRoom && freshRoom.is_active) {
          const dbUpdated = new Date(freshRoom.updated_at).getTime()
          if (!isNaN(dbUpdated) && now - dbUpdated < 45_000) {
            set({ lastHostUpdate: now })
            if (get().syncStatus === 'host_reconnecting') {
              set({ syncStatus: 'synced' })
            }
            return
          }
        } else if (freshRoom && !freshRoom.is_active) {
          // Room was explicitly marked inactive in the database
          await get().handleHostDisconnect()
          return
        }
      } catch {
        // network issue, proceed
      }

      if (get().syncStatus !== 'host_reconnecting') {
        set({ syncStatus: 'host_reconnecting' })
        setAudioPlaybackRate(1.0)
      }
      return
    }

    // 3. Stage 3: Grace period expired (> 90s without host update). Elect new host or close.
    try {
      const { data: updatedRoom, error } = await getSupabase().rpc('elect_new_room_host', {
        target_room_id: joined.id,
        expected_old_host_id: joined.host_id
      })

      if (error) {
        if (error.code === 'PGRST202') {
          console.warn(
            '[Watchdog] Automatic failover RPC is not installed on the server yet. Apply supabase/migrations/0014_listening_room_host_failover.sql in your Supabase SQL editor.'
          )
        } else {
          console.warn('[Watchdog] elect_new_room_host RPC error:', error)
        }
        await get().handleHostDisconnect()
        return
      }

      if (!updatedRoom) {
        // Room was closed by server (no remaining members)
        await get().handleHostDisconnect()
        return
      }

      // If THIS user was elected as the new host
      if (updatedRoom.host_id === user.id) {
        set({
          hostRoom: updatedRoom as ListeningRoom,
          joinedRoom: null,
          hostRoomStopped: false,
          syncStatus: 'idle'
        })
        usePlayerStore.getState().setIsPlaying(true)
        await get().ensureHostRoom(true, false)
      } else {
        // Another member was elected as the new host
        const newHostRoom = updatedRoom as ListeningRoom
        set({
          joinedRoom: newHostRoom,
          syncStatus: 'synced',
          lastHostUpdate: Date.now()
        })
        await get().handleHostSongChange(newHostRoom)
      }
    } catch (failoverErr) {
      console.warn('[Watchdog] Failover error:', failoverErr)
      await get().handleHostDisconnect()
    }
  },

  handleHostDisconnect: async (): Promise<void> => {
    const joined = get().joinedRoom
    if (!joined) return

    usePlayerStore.getState().setIsPlaying(false)
    get().cleanupOnLeave()

    const user = useOnlineStore.getState().user
    if (user) {
      try {
        await getSupabase()
          .from('listening_room_members')
          .delete()
          .eq('room_id', joined.id)
          .eq('user_id', user.id)
      } catch {
        // best effort
      }
    }

    set({ hostRoom: null, joinedRoom: null, hostRoomStopped: true, syncStatus: 'idle' })
  },

  hotSwapToFullQuality: async (fullUrl: string): Promise<void> => {
    const state = get()
    const joined = state.joinedRoom
    if (!joined || !joined.song) return

    // 1. Acquire sync lock with cooldown to prevent drift correction from triggering during swap
    get().setIsSyncLocked(true)

    try {
      const player = usePlayerStore.getState()
      const currentSong = player.queue[player.currentSongIndex]
      if (!currentSong) return

      // Read current playback position
      const audioEl = document.querySelector('audio')
      const targetPosition = audioEl?.currentTime || player.currentTime || 0
      const wasPlaying = player.isPlaying

      console.log(`[hotSwapToFullQuality] Hot-swapping to full quality at position ${targetPosition.toFixed(2)}s`)

      // Update current song's audioUrl and filePath to full quality source
      const updatedSong: Song = {
        ...currentSong,
        filePath: fullUrl,
        audioUrl: fullUrl
      }
      player.updateSong(updatedSong, currentSong.id)

      // Align audio element position smoothly
      if (audioEl) {
        audioEl.currentTime = targetPosition
        if (wasPlaying && audioEl.paused) {
          await audioEl.play().catch(() => {})
        }
      }

      set({ audioQuality: 'full' })
      get().setJitStatus(currentSong.id, 100, 'Playing (Lossless / Full)', 0, 0)
    } catch (err) {
      console.warn('[hotSwapToFullQuality] Hot-swap failed:', err)
    } finally {
      setTimeout(() => {
        get().setIsSyncLocked(false)
      }, 800)
    }
  },

  refreshJoinedRoomState: async (): Promise<void> => {
    const joined = get().joinedRoom
    if (!joined) return
    try {
      const { data: freshRoom } = await getSupabase()
        .from('listening_rooms')
        .select('*')
        .eq('id', joined.id)
        .maybeSingle()

      if (freshRoom && freshRoom.is_active) {
        set({ joinedRoom: freshRoom as ListeningRoom, lastHostUpdate: Date.now() })
        await get().handleHostSongChange(freshRoom as ListeningRoom)
      } else if (!freshRoom || !freshRoom.is_active) {
        console.warn('[refreshJoinedRoomState] Room not found or inactive, leaving room...')
        await get().handleHostDisconnect()
      }
    } catch (err) {
      console.warn('[refreshJoinedRoomState] Error fetching room:', err)
    }
  }
})
