import { useState, useEffect, useCallback } from 'react'

export type DetectedOS = 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// Global cached prompt so it isn't lost if user navigates pages before opening /download
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    globalDeferredPrompt = e as BeforeInstallPromptEvent
    window.dispatchEvent(new CustomEvent('felo:pwa-prompt-ready'))
  })
}

export function detectOS(): DetectedOS {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'other'

  const ua = navigator.userAgent || ''

  if (/android/i.test(ua)) {
    return 'android'
  }

  // iOS check (includes iPad on iOS 13+ reporting as Macintosh)
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
  if (isIos) {
    return 'ios'
  }

  if (/Windows/i.test(ua)) {
    return 'windows'
  }

  if (/Macintosh|Mac OS X/i.test(ua)) {
    return 'mac'
  }

  if (/Linux/i.test(ua)) {
    return 'linux'
  }

  return 'other'
}

export function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')
  )
}

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => globalDeferredPrompt
  )
  const [isStandalone, setIsStandalone] = useState<boolean>(() => checkIsStandalone())
  const [os, setOs] = useState<DetectedOS>(() => detectOS())

  useEffect(() => {
    setIsStandalone(checkIsStandalone())
    setOs(detectOS())

    const handlePromptReady = () => {
      setDeferredPrompt(globalDeferredPrompt)
    }

    const handleAppInstalled = () => {
      globalDeferredPrompt = null
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('felo:pwa-prompt-ready', handlePromptReady)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('felo:pwa-prompt-ready', handlePromptReady)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const triggerInstall = useCallback(async (): Promise<boolean> => {
    const promptEvent = deferredPrompt || globalDeferredPrompt
    if (!promptEvent) return false

    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice
      if (outcome === 'accepted') {
        globalDeferredPrompt = null
        setDeferredPrompt(null)
        setIsStandalone(true)
        return true
      }
      return false
    } catch (err) {
      console.warn('[PWA] Prompt trigger error:', err)
      return false
    }
  }, [deferredPrompt])

  return {
    os,
    isStandalone,
    isInstallable: Boolean(deferredPrompt),
    triggerInstall
  }
}
