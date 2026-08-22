import { useEffect } from 'react'
import { useDownloadStore } from '../hooks/useDownloadStore'
import { usePlayerStore } from '../hooks/usePlayerStore'

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
    return window.api.onDownloadProgress((event: DownloadProgressEvent) => {
      useDownloadStore.getState().updateTransfer(event.transferId, {
        status: event.status,
        progress: event.progress,
        message: event.message,
        song: event.song
      })

      if (event.status === 'completed' && event.song?.id) {
        usePlayerStore.getState().updateSong(event.song)
        window.dispatchEvent(new CustomEvent('felo:library-updated'))
      }
    })
  }, [])

  return null
}
