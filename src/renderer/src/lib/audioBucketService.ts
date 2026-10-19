import { getSupabase } from './supabase'
import type { Song } from '../pages/Library/Library'
import type { SharedSong } from '../online/types'
import { isElectron } from './appConfig'
import { getLocalSlotPoolFile, registerLocalSlotPoolFile } from './jitAudioPipeline'
import { isYouTubeSong } from '../components/Audio/YouTubePlayerBridge'

const SUPABASE_STORAGE_BUCKET = 'songs'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yvmkfguclsxurlwgnvsu.supabase.co'

/**
 * Sanitizes a song ID into a safe S3 object key (alphanumeric, hyphens, and underscores only).
 * Avoids URI encoded percent signs (%20, %3A, %2F) which trigger InvalidKey or 404 NoSuchKey.
 */
export function getSongStorageKey(songId: string): string {
  const cleanId = songId.trim().replace(/^(synced|ephemeral)-/, '')
  const safeId = cleanId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeId}.mp3`
}

/**
 * Returns the permanent public CDN URL for an audio track stored in Supabase Storage.
 */
export function getSongPublicBucketUrl(songId: string): string {
  const key = getSongStorageKey(songId)
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${key}`
}

/**
 * Returns the storage key for a low-bitrate preview (64k MP3).
 */
export function getSongPreviewStorageKey(songId: string): string {
  const cleanId = songId.trim().replace(/^(synced|ephemeral)-/, '')
  const safeId = cleanId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safeId}_preview.mp3`
}

/**
 * Returns the permanent public CDN URL for an audio track's compressed preview.
 */
export function getSongPreviewBucketUrl(songId: string): string {
  const key = getSongPreviewStorageKey(songId)
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${key}`
}

const _uploadedPreviewsCache = new Set<string>()

export function isSongPreviewUploadedToBucket(songId: string): boolean {
  if (!songId) return false
  return _uploadedPreviewsCache.has(songId)
}

export function markSongPreviewUploadedToBucket(songId: string): void {
  if (songId) _uploadedPreviewsCache.add(songId)
}

export async function isSongPreviewInAudioBucket(songId: string): Promise<boolean> {
  if (!songId) return false
  if (_uploadedPreviewsCache.has(songId)) return true
  const url = getSongPreviewBucketUrl(songId)
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
    const ok = res.ok && res.status === 200
    if (ok) _uploadedPreviewsCache.add(songId)
    return ok
  } catch {
    return false
  }
}

export async function uploadSongPreviewToAudioBucket(
  songId: string,
  previewBlob: Blob,
  contentType = 'audio/mpeg'
): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const fileName = getSongPreviewStorageKey(songId)

    const { error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(fileName, previewBlob, {
        contentType,
        upsert: true
      })

    if (error) {
      console.warn('[audioBucketService] Preview upload failed:', error)
      return null
    }

    markSongPreviewUploadedToBucket(songId)
    return getSongPreviewBucketUrl(songId)
  } catch (err) {
    console.warn('[audioBucketService] Preview upload exception:', err)
    return null
  }
}

const _uploadedSongsCache = new Set<string>()

export function isSongUploadedToBucket(songId: string): boolean {
  if (!songId) return false
  return _uploadedSongsCache.has(songId)
}

export function markSongUploadedToBucket(songId: string): void {
  if (songId) _uploadedSongsCache.add(songId)
}

/**
 * Fast HEAD check to determine if a song file already exists in the cloud audio bucket.
 */
export async function isSongInAudioBucket(songId: string): Promise<boolean> {
  if (!songId) return false
  if (_uploadedSongsCache.has(songId)) return true
  const url = getSongPublicBucketUrl(songId)
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
    const ok = res.ok && res.status === 200
    if (ok) _uploadedSongsCache.add(songId)
    return ok
  } catch {
    return false
  }
}

/**
 * Uploads an audio blob to the public Supabase 'songs' bucket and returns its public HTTPS stream URL.
 */
export async function uploadSongToAudioBucket(
  songId: string,
  audioBlob: Blob,
  contentType = 'audio/mpeg'
): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const fileName = getSongStorageKey(songId)

    const { error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKET)
      .upload(fileName, audioBlob, {
        contentType,
        upsert: true
      })

    if (error) {
      console.warn('[audioBucketService] Upload failed:', error)
      return null
    }

    return getSongPublicBucketUrl(songId)
  } catch (err) {
    console.warn('[audioBucketService] Upload exception:', err)
    return null
  }
}

const _pendingUploads = new Set<string>()

/**
 * Ensures a host's current track is cached in the public cloud audio bucket.
 * If already cached or online, returns the public URL immediately.
 * If local on desktop or in JIT slot pool, background-streams to the cloud bucket so listeners on any device
 * (mobile web, cellular, Wi-Fi) can stream high-fidelity audio over HTTPS.
 */
export async function ensureTrackInAudioBucket(song: Song): Promise<string | null> {
  if (!song || !song.id) return null

  // YouTube tracks stream directly via YouTube IFrame API and should not be uploaded
  if (isYouTubeSong(song)) {
    return song.audioUrl || `https://www.youtube.com/watch?v=${song.id}`
  }

  const cloudUrl = getSongPublicBucketUrl(song.id)

  // 1. If song already has an active HTTPS public URL that is NOT the unverified cloud bucket URL
  const isSupabaseBucketUrl =
    (song.audioUrl && (song.audioUrl.includes(SUPABASE_STORAGE_BUCKET) || song.audioUrl.includes(SUPABASE_URL))) || false
  if (
    song.audioUrl &&
    /^https?:\/\//i.test(song.audioUrl) &&
    !song.audioUrl.includes('127.0.0.1') &&
    !isSupabaseBucketUrl
  ) {
    return song.audioUrl
  }

  // 2. Check if already uploaded to the bucket
  const alreadyInCloud = await isSongInAudioBucket(song.id)
  if (alreadyInCloud) {
    markSongUploadedToBucket(song.id)
    try {
      const { useListeningStore } = await import('../hooks/useListeningStore')
      const hostRoom = useListeningStore.getState().hostRoom
      if (hostRoom?.id && hostRoom.song && (hostRoom.song.localId === song.id || (hostRoom.song as any).id === song.id)) {
        const updatedSong = {
          ...hostRoom.song,
          audioUrl: cloudUrl,
          uploadStatus: 'UPLOADED' as const,
          uploadProgress: 100,
          statusText: 'Ready (Cloud CDN)'
        }
        useListeningStore.setState((prev) => ({
          hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: updatedSong } : null
        }))
        await getSupabase()
          .from('listening_rooms')
          .update({ song: updatedSong, updated_at: new Date().toISOString() })
          .eq('id', hostRoom.id)
        try {
          const { broadcastHostTrackChange } = await import('../components/ListeningPresenceBridge')
          broadcastHostTrackChange(updatedSong)
        } catch {}
      }
    } catch {}
    return cloudUrl
  }

  // 3. Resolve audio blob from host environment (RAM slot pool, browser blob: URL, or desktop)
  let audioBlob: Blob | null = null
  let contentType = 'audio/mpeg'

  const slotFile = getLocalSlotPoolFile(song.id)
  if (slotFile) {
    audioBlob = slotFile
    contentType = slotFile.type || 'audio/mpeg'
  } else if (song.filePath && song.filePath.startsWith('blob:')) {
    try {
      const res = await fetch(song.filePath)
      if (res.ok) {
        contentType = res.headers.get('content-type') || 'audio/mpeg'
        audioBlob = await res.blob()
        if (audioBlob) registerLocalSlotPoolFile(song.id, audioBlob)
      }
    } catch {}
  } else if (song.audioUrl && song.audioUrl.startsWith('blob:')) {
    try {
      const res = await fetch(song.audioUrl)
      if (res.ok) {
        contentType = res.headers.get('content-type') || 'audio/mpeg'
        audioBlob = await res.blob()
        if (audioBlob) registerLocalSlotPoolFile(song.id, audioBlob)
      }
    } catch {}
  }

  // If we found an audio blob in browser memory (slot pool or web library blob)
  if (audioBlob && audioBlob.size > 0) {
    if (_pendingUploads.has(song.id)) return null
    _pendingUploads.add(song.id)
    void (async () => {
      try {
        const { useListeningStore } = await import('../hooks/useListeningStore')
        ;(useListeningStore.getState() as any).setHostTrackUploadProgress?.(song.id, 25, 'Uploading to Cloud (25%)...')

        // Update room status to UPLOADING in Supabase ONLY IF this is the active playing song!
        const hostRoom = useListeningStore.getState().hostRoom
        const isCurrentSong = Boolean(
          hostRoom?.id &&
          hostRoom.song &&
          (hostRoom.song.localId === song.id || (hostRoom.song as any).id === song.id)
        )

        if (isCurrentSong && hostRoom?.song) {
          const uploadingSong = {
            ...hostRoom.song,
            uploadStatus: 'UPLOADING' as const,
            uploadProgress: 25,
            statusText: 'Uploading to Cloud...'
          }
          await getSupabase()
            .from('listening_rooms')
            .update({ song: uploadingSong, updated_at: new Date().toISOString() })
            .eq('id', hostRoom.id)
        }

        const uploadedUrl = await uploadSongToAudioBucket(song.id, audioBlob, contentType)
        if (uploadedUrl) {
          console.log(`[audioBucketService] Track "${song.title}" uploaded to cloud audio bucket:`, uploadedUrl)
          markSongUploadedToBucket(song.id)
          ;(useListeningStore.getState() as any).setHostTrackUploadProgress?.(song.id, 100, 'Ready (Cloud CDN)')
          void pruneAudioBucket(3)

          try {
            const { usePlayerStore } = await import('../hooks/usePlayerStore')
            const ps = usePlayerStore.getState()
            ps.queue.forEach((qSong) => {
              if (qSong.id === song.id || (qSong as any).localId === song.id) {
                ;(qSong as any).uploadStatus = 'UPLOADED'
                ;(qSong as any).uploadProgress = 100
                qSong.audioUrl = uploadedUrl
              }
            })
          } catch {}

          const freshHostRoom = useListeningStore.getState().hostRoom
          if (freshHostRoom?.id) {
            const isNowCurrent = Boolean(
              freshHostRoom.song &&
              (freshHostRoom.song.localId === song.id || (freshHostRoom.song as any).id === song.id)
            )

            if (isNowCurrent && freshHostRoom.song) {
              const updatedSong = {
                ...freshHostRoom.song,
                audioUrl: uploadedUrl,
                uploadStatus: 'UPLOADED' as const,
                uploadProgress: 100,
                statusText: 'Ready (Cloud CDN)'
              }
              useListeningStore.setState((prev) => ({
                hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: updatedSong } : null
              }))
              await getSupabase()
                .from('listening_rooms')
                .update({
                  song: updatedSong,
                  updated_at: new Date().toISOString()
                })
                .eq('id', freshHostRoom.id)
              try {
                const { broadcastHostTrackChange } = await import('../components/ListeningPresenceBridge')
                broadcastHostTrackChange(updatedSong)
              } catch {}
            } else {
              // Upcoming queue track (N+1): notify room participants of upgraded audio URL
              try {
                const { broadcastHostTrackUpgrade } = await import('../components/ListeningPresenceBridge')
                broadcastHostTrackUpgrade(song.id, uploadedUrl)
              } catch {}
            }
          }
        }
      } catch (err) {
        console.warn('[audioBucketService] Browser blob upload exception:', err)
      } finally {
        _pendingUploads.delete(song.id)
      }
    })()
    return null
  }

  // 4. Fallback for Web mode: Check window.api.getSongs() for browser indexed song blob
  if (!isElectron) {
    if (typeof window !== 'undefined' && (window as any).api?.getSongs) {
      void (async () => {
        try {
          const songs = await (window as any).api.getSongs()
          const matched = songs?.find((s: any) => s.id === song.id)
          if (matched?.filePath && matched.filePath.startsWith('blob:')) {
            const res = await fetch(matched.filePath)
            if (res.ok) {
              const b = await res.blob()
              if (b && b.size > 0) {
                registerLocalSlotPoolFile(song.id, b)
                void ensureTrackInAudioBucket(song)
              }
            }
          }
        } catch {}
      })()
    }
    return null
  }

  // Prevent duplicate concurrent uploads for the same track
  if (_pendingUploads.has(song.id)) {
    return null
  }

  _pendingUploads.add(song.id)

  // Asynchronous background upload to avoid blocking UI playback
  void (async () => {
    try {
      // Mark UPLOADING immediately so guests don't see 0% stuck (ONLY IF active song)
      const { useListeningStore } = await import('../hooks/useListeningStore')
      const initialHostRoom = useListeningStore.getState().hostRoom
      const isCurrentSong = Boolean(
        initialHostRoom?.id &&
        initialHostRoom.song &&
        (initialHostRoom.song.localId === song.id || (initialHostRoom.song as any).id === song.id)
      )

      if (isCurrentSong && initialHostRoom?.song) {
        const uploadingSong = {
          ...initialHostRoom.song,
          uploadStatus: 'UPLOADING' as const,
          uploadProgress: 20,
          statusText: 'Uploading to Cloud (20%)...'
        }
        await getSupabase()
          .from('listening_rooms')
          .update({ song: uploadingSong, updated_at: new Date().toISOString() })
          .eq('id', initialHostRoom.id)
      }

      let blob: Blob | null = null
      let contentType = 'audio/mpeg'

      // 1. Direct Electron IPC file read (100% reliable, zero network/token/path issues)
      if (typeof window !== 'undefined' && (window as any).api?.readAudioFile) {
        try {
          const res = await (window as any).api.readAudioFile(song.id, song.filePath)
          if (res?.success && res.data) {
            contentType = res.contentType || 'audio/mpeg'
            blob = new Blob([res.data], { type: contentType })
            console.log(`[audioBucketService] Read local audio bytes via IPC for "${song.title}":`, blob.size, 'bytes')
          } else if (res?.error) {
            console.warn(`[audioBucketService] IPC readAudioFile error for "${song.title}":`, res.error)
          }
        } catch (ipcErr) {
          console.warn('[audioBucketService] IPC readAudioFile failed:', ipcErr)
        }
      }

      // 2. Fallback: Try local HTTP server endpoint
      if (!blob || blob.size === 0) {
        try {
          const localStreamUrl = `http://127.0.0.1:4788/v1/audio/${encodeURIComponent(song.id)}`
          const res = await fetch(localStreamUrl)
          if (res.ok) {
            contentType = res.headers.get('content-type') || 'audio/mpeg'
            blob = await res.blob()
          }
        } catch {}
      }

      // 3. Fallback: Try reading via media:// protocol if localStreamUrl was unreachable
      if (!blob || blob.size === 0) {
        if (song.filePath) {
          try {
            const { toMediaUrl } = await import('./media')
            const mediaUrl = toMediaUrl(song.filePath)
            if (mediaUrl) {
              const res = await fetch(mediaUrl)
              if (res.ok) {
                contentType = res.headers.get('content-type') || 'audio/mpeg'
                blob = await res.blob()
              }
            }
          } catch {}
        }
      }

      if (!blob || blob.size === 0) {
        console.warn(`[audioBucketService] Could not read local track stream for: ${song.title}`)
        try {
          const failRoom = useListeningStore.getState().hostRoom
          const isFailCurrent = Boolean(
            failRoom?.id &&
            failRoom.song &&
            (failRoom.song.localId === song.id || (failRoom.song as any).id === song.id)
          )
          if (isFailCurrent && failRoom?.song) {
            const failedSong: SharedSong = {
              ...failRoom.song,
              uploadStatus: 'ERROR',
              statusText: 'Local file inaccessible'
            }
            useListeningStore.setState((prev: any) => ({
              hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: failedSong } : null
            }))
            await getSupabase()
              .from('listening_rooms')
              .update({ song: failedSong, updated_at: new Date().toISOString() })
              .eq('id', failRoom.id)
          }
        } catch {}
        return
      }

      registerLocalSlotPoolFile(song.id, blob)

      // Generate and upload high-fidelity compressed preview (256k MP3) first so join users start playing in 2-3 seconds with full frequency spectrum
      let previewUrl: string | null = null
      if (typeof window !== 'undefined' && (window as any).api?.compressAudio) {
        try {
          const compRes = await (window as any).api.compressAudio(song.id, {
            bitrate: '256k',
            format: 'mp3',
            explicitPath: song.filePath
          })
          if (compRes?.success && compRes.data) {
            const previewBlob = new Blob([compRes.data], { type: compRes.contentType || 'audio/mpeg' })
            previewUrl = await uploadSongPreviewToAudioBucket(song.id, previewBlob)
            if (previewUrl) {
              console.log(`[audioBucketService] Fast preview uploaded for "${song.title}":`, previewUrl)
              const currentHostRoom = useListeningStore.getState().hostRoom
              const isPreviewCurrent = Boolean(
                currentHostRoom?.id &&
                currentHostRoom.song &&
                (currentHostRoom.song.localId === song.id || (currentHostRoom.song as any).id === song.id)
              )
              if (isPreviewCurrent && currentHostRoom?.song) {
                const previewReadySong = {
                  ...currentHostRoom.song,
                  previewUrl,
                  uploadStatus: 'PREVIEW_READY' as const,
                  statusText: 'Preview Ready (Fast Join)'
                }
                useListeningStore.setState((prev) => ({
                  hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: previewReadySong } : null
                }))
                await getSupabase()
                  .from('listening_rooms')
                  .update({ song: previewReadySong, updated_at: new Date().toISOString() })
                  .eq('id', currentHostRoom.id)

                try {
                  const { broadcastHostTrackChange } = await import('../components/ListeningPresenceBridge')
                  broadcastHostTrackChange(previewReadySong)
                } catch {}
              }
            }
          }
        } catch (compErr) {
          console.warn('[audioBucketService] Preview compression skipped:', compErr)
        }
      }

      const uploadedUrl = await uploadSongToAudioBucket(song.id, blob, contentType)
      if (uploadedUrl) {
        console.log(`[audioBucketService] Successfully cached track "${song.title}" (${contentType}) to cloud audio bucket:`, uploadedUrl)
        markSongUploadedToBucket(song.id)
        void pruneAudioBucket(3)

        try {
          const { usePlayerStore } = await import('../hooks/usePlayerStore')
          const ps = usePlayerStore.getState()
          ps.queue.forEach((qSong) => {
            if (qSong.id === song.id || (qSong as any).localId === song.id) {
              ;(qSong as any).uploadStatus = 'UPLOADED'
              ;(qSong as any).uploadProgress = 100
              qSong.audioUrl = uploadedUrl
            }
          })
        } catch {}

        try {
          const freshHostRoom = useListeningStore.getState().hostRoom
          if (freshHostRoom?.id) {
            const isNowCurrent = Boolean(
              freshHostRoom.song &&
              (freshHostRoom.song.localId === song.id || (freshHostRoom.song as any).id === song.id)
            )

            if (isNowCurrent && freshHostRoom.song) {
              const updatedSong = {
                ...freshHostRoom.song,
                audioUrl: uploadedUrl,
                previewUrl: previewUrl || freshHostRoom.song.previewUrl,
                uploadStatus: 'UPLOADED' as const,
                uploadProgress: 100,
                statusText: 'Ready (Cloud CDN)'
              }
              useListeningStore.setState((prev) => ({
                hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: updatedSong } : null
              }))
              await getSupabase()
                .from('listening_rooms')
                .update({
                  song: updatedSong,
                  updated_at: new Date().toISOString()
                })
                .eq('id', freshHostRoom.id)
              try {
                const { broadcastHostTrackChange, broadcastHostTrackUpgrade } = await import('../components/ListeningPresenceBridge')
                broadcastHostTrackChange(updatedSong)
                broadcastHostTrackUpgrade(song.id, uploadedUrl)
              } catch {}
            } else {
              // Upcoming queue track (N+1): only upgrade track in background, NEVER overwrite current song!
              try {
                const { broadcastHostTrackUpgrade } = await import('../components/ListeningPresenceBridge')
                broadcastHostTrackUpgrade(song.id, uploadedUrl)
              } catch {}
            }
          }
        } catch {}
      } else {
        try {
          const freshHostRoom = useListeningStore.getState().hostRoom
          const isFailCurrent = Boolean(
            freshHostRoom?.id &&
            freshHostRoom.song &&
            (freshHostRoom.song.localId === song.id || (freshHostRoom.song as any).id === song.id)
          )
          if (isFailCurrent && freshHostRoom?.song) {
            const failedSong: SharedSong = {
              ...freshHostRoom.song,
              uploadStatus: 'ERROR',
              statusText: 'Cloud upload failed'
            }
            useListeningStore.setState((prev: any) => ({
              hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: failedSong } : null
            }))
            await getSupabase()
              .from('listening_rooms')
              .update({ song: failedSong, updated_at: new Date().toISOString() })
              .eq('id', freshHostRoom.id)
          }
        } catch {}
      }
    } catch (err) {
      console.warn('[audioBucketService] Background cache upload failed:', err)
      try {
        const { useListeningStore } = await import('../hooks/useListeningStore')
        const failRoom = useListeningStore.getState().hostRoom
        if (failRoom?.id && failRoom.song) {
          const failedSong: SharedSong = {
            ...failRoom.song,
            uploadStatus: 'ERROR',
            statusText: 'Upload error'
          }
          useListeningStore.setState((prev: any) => ({
            hostRoom: prev.hostRoom ? { ...prev.hostRoom, song: failedSong } : null
          }))
        }
      } catch {}
    } finally {
      _pendingUploads.delete(song.id)
    }
  })()

  return null
}

/**
 * Automatically purges old room audio tracks to keep Supabase Free Tier storage safely under 60-100 MB (limit is 1,000 MB).
 * Keeps only the most recent 3 tracks and deletes any tracks older than 2 hours.
 */
export async function pruneAudioBucket(maxKeep = 3): Promise<void> {
  try {
    const supabase = getSupabase()
    const { data: files, error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).list('', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' }
    })
    if (error || !files || files.length <= maxKeep) return

    const now = Date.now()
    const twoHoursAgo = now - 2 * 60 * 60 * 1000

    const toDelete: string[] = []

    // Files beyond maxKeep
    files.slice(maxKeep).forEach((f) => {
      if (f.name) toDelete.push(f.name)
    })

    // Also delete any track older than 2 hours (except top 2 active tracks)
    files.slice(2, maxKeep).forEach((f) => {
      if (f.created_at && new Date(f.created_at).getTime() < twoHoursAgo && f.name) {
        toDelete.push(f.name)
      }
    })

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove(toDelete)
      if (!delErr) {
        console.log(`[audioBucketService] Auto-pruned ${toDelete.length} expired tracks from 'songs' bucket.`)
      }
    }
  } catch (err) {
    console.warn('[audioBucketService] pruneAudioBucket ignored:', err)
  }
}
