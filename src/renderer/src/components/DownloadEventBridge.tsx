import { useEffect } from 'react'
import { useDownloadStore } from '../hooks/useDownloadStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useListeningStore } from '../hooks/useListeningStore'
import { useConnectedDeviceStore } from '../stores/useConnectedDeviceStore'
import { setNeedsInitialSync } from '../stores/listening/helpers'
import { requestImmediateHostSyncPulse } from './ListeningPresenceBridge'
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

        const targetQueueId = (transfer?.song as any)?.id || (event as any).songId
        if (completedSong?.id) {
          // 2. Always update the song in the queue (whether active or upcoming prefetch)
          usePlayerStore.getState().updateSong(completedSong, targetQueueId)

          // 3. If in a Listen Together room waiting for this track:
          const listeningState = useListeningStore.getState()
          const joined = listeningState.joinedRoom
          if (joined && joined.song) {
            const isTargetRoomSong =
              completedSong.id === joined.song.localId ||
              completedSong.id === (joined.song as any).id ||
              targetQueueId === (joined.song as any).id ||
              targetQueueId === joined.song.localId ||
              (Boolean(completedSong.title && joined.song.title) &&
                completedSong.title.trim().toLowerCase() === joined.song.title.trim().toLowerCase() &&
                (!joined.song.artist || !completedSong.artist || completedSong.artist.trim().toLowerCase() === joined.song.artist.trim().toLowerCase()))

            if (isTargetRoomSong) {
              console.log('[DownloadEventBridge] Active room song downloaded. Performing 1-time sync with host...')
              useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
              useConnectedDeviceStore.getState().claimPlayback()
              usePlayerStore.getState().claimAudioOwnership()
              setNeedsInitialSync(true)
              requestImmediateHostSyncPulse()

              if (listeningState.syncStatus === 'missing_song') {
                void listeningState.handleHostSongChange(joined).then(() => {
                  listeningState.performOneTimeSyncWithHost({
                    forceSeek: true,
                    logReason: 'Download completed from missing_song'
                  })
                })
              } else {
                if (completedSong.filePath) {
                  void listeningState.hotSwapToFullQuality(completedSong.filePath)
                }
                listeningState.performOneTimeSyncWithHost({
                  forceSeek: true,
                  logReason: 'Active room song download completed'
                })
                void listeningState.preloadNextQueueTracks(joined)
              }
            } else {
              void listeningState.preloadNextQueueTracks(joined)
            }
          } else {
            // 4. Local playback reconciliation
            const player = usePlayerStore.getState()
            const activeSong = player.queue[player.currentSongIndex]
            const isCurrentVirtual = !activeSong?.filePath || activeSong.filePath.startsWith('virtual:')
            const isActiveMatch =
              Boolean(activeSong) &&
              (activeSong.id === completedSong!.id ||
                Boolean(targetQueueId && activeSong.id === targetQueueId) ||
                (isCurrentVirtual && (
                  Boolean(findMatchingLibrarySong(activeSong.title, activeSong.artist, [completedSong!])) ||
                  Boolean(
                    transfer?.song &&
                      (activeSong.id === (transfer.song as any).id ||
                        (activeSong.title.toLowerCase() === transfer.title.toLowerCase() &&
                          (!activeSong.artist || !transfer.artist || activeSong.artist.toLowerCase() === transfer.artist.toLowerCase())))
                  )
                )))

            if (isActiveMatch) {
              if (player.isBuffering) {
                player.setIsBuffering(false)
              }
              if (transfer?.autoPlay) {
                player.claimAudioOwnership()
                player.setIsPlaying(true)
              }
            } else {
              const matchIndex = player.queue.findIndex((item) => {
                if (item.id === completedSong!.id) return true
                if (targetQueueId && item.id === targetQueueId) return true
                const match = findMatchingLibrarySong(item.title, item.artist, [completedSong!])
                return Boolean(match)
              })

              if (matchIndex !== -1) {
                // Found in active queue - update the queued track with real audio file path on disk
                const matchedQueueItem = player.queue[matchIndex]
                if (matchedQueueItem) {
                  player.updateSong(completedSong, matchedQueueItem.id)
                }
                if (player.currentSongIndex === matchIndex) {
                  if (player.isBuffering) {
                    player.setIsBuffering(false)
                  }
                  if (transfer?.autoPlay) {
                    player.claimAudioOwnership()
                    player.setIsPlaying(true)
                  }
                }
              } else if (transfer?.playAction === 'enqueue') {
                player.enqueueSong(completedSong)
              } else if (transfer?.playAction === 'play_next') {
                player.enqueueSongNext(completedSong)
              } else if (transfer?.playAction === 'play_now') {
                if (player.queue.length === 0) {
                  player.setQueue([completedSong], 0)
                } else {
                  const currentActive = player.queue[player.currentSongIndex]
                  const isCurrentVirtual = !currentActive?.filePath || currentActive.filePath.startsWith('virtual:')
                  if (isCurrentVirtual && player.isBuffering) {
                    // Update the active track in-place rather than wiping the user's queue
                    player.updateSong(completedSong, currentActive?.id)
                    player.setIsBuffering(false)
                    player.claimAudioOwnership()
                    player.setIsPlaying(true)
                  } else {
                    player.enqueueSongNext(completedSong)
                    player.playNext(true)
                  }
                }
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
            player.playNext(true)
          }
        }
      }
    })
  }, [])

  return null
}
