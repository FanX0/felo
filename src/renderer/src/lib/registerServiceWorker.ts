// Client-side Service Worker registration and lifecycle management for Felo PWA

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

    // Check for updates
    registration.onupdatefound = () => {
      const installingWorker = registration.installing
      if (!installingWorker) return

      installingWorker.onstatechange = () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New content is available and will be used when all tabs are closed or updated
            console.log('[PWA] New content is available; please refresh.')
            window.dispatchEvent(new CustomEvent('felo:sw-updated', { detail: { registration } }))
          } else {
            // Content is cached for offline use
            console.log('[PWA] Content is cached for offline use.')
            window.dispatchEvent(new CustomEvent('felo:sw-offline-ready'))
          }
        }
      }
    }

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

  const waitingWorker = registrationInstance.waiting
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    window.location.reload()
  }

  waitingWorker.postMessage({ type: 'SKIP_WAITING' }, [channel.port2])
  window.setTimeout(() => window.location.reload(), 500)
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
