import { useEffect } from 'react'
import { useDownloadStore } from '../hooks/useDownloadStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useListeningStore } from '../hooks/useListeningStore'
import { findMatchingLibrarySong } from '../lib/songMatching'
import type { Song } from '../pages/Library/Library'

interface DownloadProgressEvent {
  transferId: string
  status: 'queued' | 'downloading' | 'completed' | 'failed'
  progress: number
  message: string
  song?: any
  title?: string
  artist?: string
}

export default function DownloadEventBridge(): null {
  useEffect(() => {
    if (!window.api?.onDownloadProgress) return
    return window.api.onDownloadProgress(async (event: DownloadProgressEvent) => {
      useDownloadStore.getState().updateTransfer(event.transferId, {
        status: event.status,
        progress: event.progress,
        message: event.message,
        song: event.song
      })

      if (event.status === 'completed') {
        const transfer = useDownloadStore.getState().transfers.find((item) => item.id === event.transferId)
        let completedSong: Song | undefined = event.song

        // 1. If payload didn't include song object with id, locate via robust fuzzy matching
        if (!completedSong?.id) {
          try {
            const songs = (await window.api.getSongs()) || []
            const targetTitle = transfer?.title || event.title || ''
            const targetArtist = transfer?.artist || event.artist || ''
            completedSong = findMatchingLibrarySong(targetTitle, targetArtist, songs)
          } catch (error) {
            console.warn('[DownloadEventBridge] Could not reconcile completed song:', error)
          }
        }

        if (completedSong?.id) {
          // 2. Always update the song in the queue (whether active or upcoming prefetch)
          usePlayerStore.getState().updateSong(completedSong)

          // 3. If in a Listen Together room waiting for this track:
          const listeningState = useListeningStore.getState()
          const joined = listeningState.joinedRoom
          if (joined && joined.song) {
            if (listeningState.syncStatus === 'missing_song') {
              void listeningState.handleHostSongChange(joined)
            } else {
              void listeningState.preloadNextQueueTracks(joined)
            }
          } else {
            // 4. Local playback reconciliation
            const player = usePlayerStore.getState()
            const matchIndex = player.queue.findIndex((item) => {
              if (item.id === completedSong!.id) return true
              // Also check fuzzy match on queue items
              const match = findMatchingLibrarySong(item.title, item.artist, [completedSong!])
              return Boolean(match)
            })

            if (matchIndex !== -1) {
              // Found in active queue
              if (player.currentSongIndex === matchIndex) {
                if (player.isBuffering) {
                  player.setIsBuffering(false)
                }
                if (transfer?.autoPlay || player.isPlaying) {
                  player.setIsPlaying(true)
                }
              }
            } else if (transfer?.autoPlay) {
              // Only auto-play if player is completely idle or waiting for an empty/virtual queue
              const currentActive = player.queue[player.currentSongIndex]
              const isCurrentVirtual = !currentActive?.filePath || currentActive.filePath.startsWith('virtual:')
              const canSafelyPlay = player.queue.length === 0 || (isCurrentVirtual && player.isBuffering)
              if (canSafelyPlay) {
                player.setQueue([completedSong], 0)
              }
            }
          }
        }
        // Refresh every library view after an import or replacement. Newly
        // downloaded tracks may not have an id in the progress payload yet.
        window.dispatchEvent(new CustomEvent('felo:library-updated'))
        window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))
      } else if (event.status === 'failed') {
        const transfer = useDownloadStore.getState().transfers.find((item) => item.id === event.transferId)
        const failDetail = {
          transferId: event.transferId,
          songId: (event as any).songId || (transfer?.song as any)?.id,
          title: transfer?.title || event.title,
          artist: transfer?.artist || event.artist,
          message: event.message
        }
        window.dispatchEvent(
          new CustomEvent('fanxmusic:download-failed', {
            detail: failDetail
          })
        )
        window.dispatchEvent(
          new CustomEvent('felo:download-failed', {
            detail: failDetail
          })
        )

        // Resilient recovery: if the failed transfer was autoPlay (active track being streamed),
        // clear the buffering state and advance to the next track so player doesn't freeze
        if (transfer?.autoPlay) {
          const player = usePlayerStore.getState()
          const activeSong = player.queue[player.currentSongIndex]
          const isVirtual = !activeSong?.filePath || activeSong.filePath.startsWith('virtual:')
          if (player.isBuffering || isVirtual) {
            player.setIsBuffering(false)
            player.playNext()
          }
        }
      }
    })
  }, [])

  return null
}
