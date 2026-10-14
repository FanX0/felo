import { useEffect, useRef } from 'react'
import { useLibraryScanStore, type LibraryScanProgress } from '../hooks/useLibraryScanStore'

export default function LibraryScanEventBridge(): null {
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!window.api?.onLibraryScanProgress) return

    const unsubscribe = window.api.onLibraryScanProgress((event: LibraryScanProgress) => {
      useLibraryScanStore.getState().updateProgress(event)

      if (event.status === 'completed') {
        window.dispatchEvent(new CustomEvent('felo:library-updated'))
        window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))

        // Auto-dismiss completed status after 8 seconds
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = setTimeout(() => {
          useLibraryScanStore.getState().dismiss()
        }, 8000)
      } else if (event.status === 'cancelled' || event.status === 'error') {
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = setTimeout(() => {
          useLibraryScanStore.getState().dismiss()
        }, 6000)
      }
    })

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      unsubscribe()
    }
  }, [])

  return null
}
