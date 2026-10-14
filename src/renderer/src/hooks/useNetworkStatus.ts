import { useState, useEffect, useCallback } from 'react'

export interface NetworkStatus {
  isOnline: boolean
  wasOffline: boolean
  isOfflineReady: boolean
  checkConnectivity: () => Promise<boolean>
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true
  })
  const [wasOffline, setWasOffline] = useState<boolean>(false)
  const [isOfflineReady, setIsOfflineReady] = useState<boolean>(false)

  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false)
      return false
    }

    try {
      // Fast HEAD/GET ping to check real internet connectivity
      const response = await fetch('/robots.txt', {
        method: 'HEAD',
        cache: 'no-store'
      })
      const online = response.ok
      setIsOnline(online)
      return online
    } catch {
      setIsOnline(false)
      return false
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      setIsOnline(true)
      setWasOffline(true)
      // Auto-clear wasOffline indicator after 4 seconds
      setTimeout(() => {
        setWasOffline(false)
      }, 4000)
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    const handleOfflineReady = () => {
      setIsOfflineReady(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('felo:sw-offline-ready', handleOfflineReady)

    // Re-verify connectivity when page gains focus
    const handleFocus = () => {
      if (typeof navigator !== 'undefined') {
        setIsOnline(navigator.onLine)
      }
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('felo:sw-offline-ready', handleOfflineReady)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  return {
    isOnline,
    wasOffline,
    isOfflineReady,
    checkConnectivity
  }
}
