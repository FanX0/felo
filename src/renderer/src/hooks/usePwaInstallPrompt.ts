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

  // 1. User-Agent Client Hints (modern Chromium, Chrome, Edge, Android)
  const clientHintPlatform = ((navigator as any).userAgentData?.platform || '').toLowerCase()
  if (clientHintPlatform.includes('win')) return 'windows'
  if (clientHintPlatform.includes('android')) return 'android'
  if (clientHintPlatform.includes('mac') && (navigator.maxTouchPoints || 0) <= 1) return 'mac'
  if (clientHintPlatform.includes('linux')) return 'linux'

  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''

  if (/android/i.test(ua) || /android/i.test(platform)) {
    return 'android'
  }

  // iOS check (iPhone, iPod, iPad, and iPadOS 13+ which masks as MacIntel with touch points)
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    /iPad|iPhone|iPod/.test(platform) ||
    ((platform === 'MacIntel' || /Macintosh/i.test(ua)) && (navigator.maxTouchPoints || 0) > 1)
  if (isIos) {
    return 'ios'
  }

  if (/Windows/i.test(ua) || /Win/i.test(platform)) {
    return 'windows'
  }

  if (/Macintosh|Mac OS X/i.test(ua) || /Mac/i.test(platform)) {
    return 'mac'
  }

  if (/Linux/i.test(ua) || /Linux/i.test(platform)) {
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
