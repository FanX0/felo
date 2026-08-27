import { useEffect } from 'react'
import { useDownloadStore } from '../hooks/useDownloadStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useListeningStore } from '../hooks/useListeningStore'

interface DownloadProgressEvent {
  transferId: string
  status: 'downloading' | 'completed' | 'failed'
  progress: number
  message: string
  song?: any
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
        let completedSong = event.song
        if (transfer?.autoPlay && !completedSong?.id) {
          try {
            const songs = await window.api.getSongs()
            const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
            completedSong = songs.find(
              (song) =>
                normalize(song.title || '') === normalize(transfer.title) &&
                normalize(song.artist || '') === normalize(transfer.artist)
            )
          } catch (error) {
            console.warn('Could not find completed song for autoplay:', error)
          }
        }
        if (completedSong?.id) {
          usePlayerStore.getState().updateSong(completedSong)
          
          // If the user is currently in a Listen Together room waiting for this song:
          const listeningState = useListeningStore.getState()
          const joined = listeningState.joinedRoom
          if (joined && joined.song) {
            if (listeningState.syncStatus === 'missing_song') {
              void listeningState.handleHostSongChange(joined)
            } else {
              void listeningState.preloadNextQueueTracks(joined)
            }
          } else if (transfer?.autoPlay) {
            usePlayerStore.getState().setQueue([completedSong], 0)
          }
        }
        // Refresh every library view after an import or replacement. Newly
        // downloaded tracks may not have an id in the progress payload yet.
        window.dispatchEvent(new CustomEvent('felo:library-updated'))
        window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))
      }
    })
  }, [])

  return null
}
