// Client-side Service Worker registration and lifecycle management for Felo PWA
// Enhanced with context-aware, zero-disruption update logic (MUSIXQUARE pattern)

import {
  handleWaitingWorker,
  armDeferredPromptRetry,
  handlePassiveControllerChange,
  activateWorkerAndReload
} from './swUpdateCoordinator'
import { useListeningStore } from '../hooks/useListeningStore'
import { usePlayerStore } from '../hooks/usePlayerStore'

export interface ServiceWorkerStatus {
  supported: boolean
  registered: boolean
  active: boolean
  waitingUpdate: boolean
  scope?: string
}

let registrationInstance: ServiceWorkerRegistration | null = null

export function isElectronEnvironment(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).electron)
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  // Do not register in Electron desktop app where local node/better-sqlite3 is used
  if (isElectronEnvironment()) {
    return null
  }

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.info('[PWA] Service Worker not supported in this browser environment.')
    return null
  }

  // In development mode or local host environment, unregister any active service worker and clear cache to prevent stale builds from lingering
  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.local'))

  if (import.meta.env.DEV || isLocalHost) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const reg of registrations) {
        await reg.unregister()
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        for (const key of keys) {
          await caches.delete(key)
        }
      }
    } catch (err) {
      console.warn('[PWA] Dev mode service worker cleanup notice:', err)
    }
    return null
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    })
    registrationInstance = registration

    console.log('[PWA] Service Worker registered successfully with scope:', registration.scope)
    window.dispatchEvent(new CustomEvent('felo:sw-registered', { detail: { scope: registration.scope } }))

    // If there is already an active worker on page load, offline shell is ready
    if (registration.active) {
      window.dispatchEvent(new CustomEvent('felo:sw-offline-ready'))
    }

    // 1. Passive controllerchange listener:
    // If another tab accepted an update, or a waiting worker activates, this tab receives controllerchange.
    // We pass it to handlePassiveControllerChange() so tabs with active rooms/playback won't reload!
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      handlePassiveControllerChange()
    })

    // 2. Check for waiting worker already installed before this document loaded
    if (registration.waiting && navigator.serviceWorker.controller) {
      void handleWaitingWorker(registration.waiting, registration)
    }

    // 3. Listen for future incoming worker updates
    registration.onupdatefound = () => {
      const installingWorker = registration.installing
      if (!installingWorker) return

      installingWorker.onstatechange = () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            console.log('[PWA] New content is available; coordinating update presentation...')
            window.dispatchEvent(new CustomEvent('felo:sw-updated', { detail: { registration } }))
            void handleWaitingWorker(registration.waiting || installingWorker, registration)
          } else {
            console.log('[PWA] Content is cached for offline use.')
            window.dispatchEvent(new CustomEvent('felo:sw-offline-ready'))
          }
        }
      }
    }

    // 4. Lifecycle listeners: When returning from a room or pausing playback to idle,
    // re-evaluate any deferred prompt after a 1-second settle timer.
    useListeningStore.subscribe((state, prev) => {
      const hadRoom = Boolean(prev.hostRoom || prev.joinedRoom || prev.isJoiningRoom)
      const hasRoom = Boolean(state.hostRoom || state.joinedRoom || state.isJoiningRoom)
      if (hadRoom && !hasRoom) {
        armDeferredPromptRetry(registration)
      }
    })

    usePlayerStore.subscribe((state, prev) => {
      if (prev.isPlaying && !state.isPlaying) {
        armDeferredPromptRetry(registration)
      }
    })

    // 5. Periodic update check (every 60 minutes when tab is visible and online)
    const UPDATE_INTERVAL_MS = 60 * 60 * 1000
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
        registration.update().catch(() => {
          // Ignore background update errors
        })
      }
    }, UPDATE_INTERVAL_MS)

    // Immediate update check on boot if visible and online
    if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
      registration.update().catch(() => {
        // Ignore initial check errors
      })
    }

    window.addEventListener('beforeunload', () => {
      clearInterval(intervalId)
    })

    return registration
  } catch (error) {
    console.warn('[PWA] Service Worker registration failed:', error)
    return null
  }
}

export function skipWaitingAndReload(): void {
  if (!registrationInstance?.waiting) {
    window.location.reload()
    return
  }

  activateWorkerAndReload(registrationInstance.waiting)
}

export async function clearAppCache(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }

    if (registrationInstance) {
      await registrationInstance.unregister()
    } else if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((reg) => reg.unregister()))
    }

    return true
  } catch (err) {
    console.warn('[PWA] Failed to clear app cache:', err)
    return false
  }
}

export async function getServiceWorkerStatus(): Promise<ServiceWorkerStatus> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || isElectronEnvironment()) {
    return {
      supported: false,
      registered: false,
      active: false,
      waitingUpdate: false
    }
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return {
      supported: true,
      registered: Boolean(reg),
      active: Boolean(reg?.active),
      waitingUpdate: Boolean(reg?.waiting),
      scope: reg?.scope
    }
  } catch {
    return {
      supported: true,
      registered: false,
      active: false,
      waitingUpdate: false
    }
  }
}
