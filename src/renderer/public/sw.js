// Felo - Industry Standard Offline Service Worker (PWA)
// Caches application shell, assets, fonts, icons, and API fallbacks for offline music playback

const VERSION = '1.1.2'
const SHELL_CACHE = `felo-shell-v${VERSION}`
const RUNTIME_CACHE = `felo-runtime-v${VERSION}`
const IMAGES_CACHE = `felo-images-v${VERSION}`

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/icon.png',
  '/icon.svg',
  '/robots.txt'
]

// ─── LOCALHOST / DEVELOPMENT BYPASS ───────────────────────────────────────
// In local development or testing on localhost/127.0.0.1, immediately self-destruct
// to ensure Vite HMR and new code changes are never masked by service worker caches.
const isLocalhostWorker =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname.endsWith('.local')

if (isLocalhostWorker) {
  self.addEventListener('install', () => {
    self.skipWaiting()
  })
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) => Promise.all(cacheNames.map((name) => caches.delete(name))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
        .then(() => self.clients.matchAll())
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url))
        })
    )
  })
} else {
  // ─── INSTALL EVENT: PRE-CACHE APP SHELL ────────────────────────────────
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(SHELL_CACHE)
        .then(async (cache) => {
          try {
            await cache.addAll(SHELL_ASSETS)
        } catch (err) {
          console.warn('[SW] Partial pre-cache failure (assets will be cached on first request):', err)
        }
      })
  )
})

// ─── ACTIVATE EVENT: CLEAN UP OUTDATED CACHES ─────────────────────────
self.addEventListener('activate', (event) => {
  const currentCaches = [SHELL_CACHE, RUNTIME_CACHE, IMAGES_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !currentCaches.includes(name))
            .map((name) => {
              console.log('[SW] Deleting old cache:', name)
              return caches.delete(name)
            })
        )
      })
      .then(() => self.clients.claim())
  )
})

// ─── FETCH EVENT: ROUTING & CACHING STRATEGIES ─────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 1. Only handle GET requests and http/https schemes
  if (request.method !== 'GET') return
  if (!url.protocol.startsWith('http')) return

  // 2. Local audio files in IndexedDB are played via blob: URLs which bypass fetch.
  // External audio streaming or range requests pass straight to network without caching gigabytes.
  if (request.destination === 'audio' || request.headers.has('range')) {
    return
  }

  // 3. Navigation Requests (HTML / SPA Routes) -> Network-First with Cache Fallback to index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(request, 3000)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const responseClone = networkResponse.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, responseClone))
          }
          return networkResponse
        })
        .catch(async () => {
          const cachedResponse =
            (await caches.match(request)) ||
            (await caches.match('/index.html')) ||
            (await caches.match('/'))
          if (cachedResponse) return cachedResponse
          return new Response(
            '<!doctype html><html><body style="background:#111;color:#fff;font-family:sans-serif;padding:2rem;text-align:center;"><h2>Felo Offline</h2><p>You are offline and no cached shell is available. Please connect to the internet once to install the app.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          )
        })
    )
    return
  }

  // 4. Remote Images (Album Art, Artist Avatars from CDNs) -> Stale-While-Revalidate
  const isImageRequest =
    request.destination === 'image' ||
    url.hostname.includes('mzstatic.com') ||
    url.hostname.includes('scdn.co') ||
    url.hostname.includes('dzcdn.net') ||
    url.hostname.includes('coverartarchive.org') ||
    url.hostname.includes('lastfm') ||
    url.hostname.includes('archive.org')

  if (isImageRequest) {
    event.respondWith(
      caches.open(IMAGES_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => cached || createPlaceholderSvgResponse())

        return cached || networkFetch
      })
    )
    return
  }

  // 5. Static App Assets (JS, CSS, Web Fonts, Vite build chunks) -> Cache-First
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'font' ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.woff2') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg'))

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse

        return fetch(request)
          .then((networkResponse) => {
            const isScriptOrStyle =
              request.destination === 'script' ||
              request.destination === 'style' ||
              url.pathname.endsWith('.js') ||
              url.pathname.endsWith('.css')
            const contentType = networkResponse.headers.get('content-type') || ''
            const isInvalidMime = isScriptOrStyle && contentType.includes('text/html')

            if (networkResponse && networkResponse.ok && !isInvalidMime) {
              const responseClone = networkResponse.clone()
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone))
            }
            return networkResponse
          })
          .catch(() => {
            // Failed to fetch and not in cache
            return new Response('', { status: 408, statusText: 'Request timed out or offline' })
          })
      })
    )
    return
  }

  // 6. External Catalog / API calls (iTunes, Spotify, Last.fm, MusicBrainz, Supabase)
  // Network-First with graceful JSON offline fallback to avoid uncaught hangs
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('itunes.apple.com') ||
    url.hostname.includes('open.spotify.com') ||
    url.hostname.includes('musicbrainz.org') ||
    url.hostname.includes('audioscrobbler.com') ||
    url.hostname.includes('lrclib.net')
  ) {
    event.respondWith(
      fetchWithTimeout(request, 6000).catch(() => {
        return new Response(
          JSON.stringify({
            offline: true,
            message: 'You are currently offline. Connected services will resume when back online.'
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json' }
          }
        )
      })
    )
    return
  }

  // 7. Default fallback: normal network fetch with runtime cache fallback
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request).then((cached) => {
        if (cached) return cached
        return new Response('', { status: 503, statusText: 'Offline' })
      })
    })
  )
})

// ─── MESSAGE EVENT: CLIENT COMMANDS ────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (event.data?.type === 'FELO_SW_GENERATION_REQUEST') {
    const requestId = event.data.requestId
    const client = event.source
    if (client && typeof client.postMessage === 'function') {
      client.postMessage({
        type: 'FELO_SW_GENERATION_RESPONSE',
        requestId,
        version: VERSION
      })
    }
  }

  if (event.data === 'CLEAR_CACHES' || event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ success: true })
          }
        })
    )
  }
})
}

// ─── UTILITY HELPERS ──────────────────────────────────────────────────
function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Network request timed out'))
    }, timeoutMs)

    fetch(request, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timer)
        resolve(res)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

function createPlaceholderSvgResponse() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#18181b"/><circle cx="50" cy="50" r="20" fill="#27272a"/></svg>`
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }
  })
}
