import { useState, useEffect, useRef } from 'react'

const ARTWORK_STORAGE_KEY = 'felo:artwork-cache'
const memoryCache = new Map<string, string>()
const inFlightRequests = new Map<string, Promise<string | null>>()

// Load initial persistent cache
try {
  const stored = JSON.parse(localStorage.getItem(ARTWORK_STORAGE_KEY) || '{}')
  for (const [k, v] of Object.entries(stored)) {
    if (typeof v === 'string' && v) {
      memoryCache.set(k, v)
    }
  }
} catch {
  // Ignore storage read error
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function persistCacheDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const obj: Record<string, string> = {}
      // Keep most recent 500 entries
      const entries = Array.from(memoryCache.entries()).slice(-500)
      for (const [k, v] of entries) {
        if (v) obj[k] = v
      }
      localStorage.setItem(ARTWORK_STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // Storage full or quota exceeded
    }
  }, 1000)
}

export function buildArtworkCacheKey(title?: string, artist?: string): string {
  const cleanTitle = (title || '').toLowerCase().trim().replace(/\s+/g, ' ')
  const cleanArtist = (artist || '').toLowerCase().trim().replace(/\s+/g, ' ')
  return `${cleanArtist}:::${cleanTitle}`
}

export function getCachedArtwork(title?: string, artist?: string): string | undefined {
  if (!title && !artist) return undefined
  const key = buildArtworkCacheKey(title, artist)
  return memoryCache.get(key)
}

export function setCachedArtwork(title: string, artist: string | undefined, url: string): void {
  if (!url) return
  const key = buildArtworkCacheKey(title, artist)
  memoryCache.set(key, url)
  persistCacheDebounced()
  try {
    window.dispatchEvent(
      new CustomEvent('felo:artwork-resolved', {
        detail: { key, artworkUrl: url }
      })
    )
  } catch {}
}

/**
 * Multi-provider online artwork resolver for tracks and albums.
 * Tries iTunes (high-res 600x600) then Deezer, with primary artist fallback.
 */
export async function resolveArtworkOnline(
  title?: string,
  artist?: string
): Promise<string | null> {
  const cleanTitle = (title || '')
    .replace(/\s*\([^)]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3)[^\]]*\]/gi, '')
    .replace(/\.(mp3|flac|wav|m4a|ogg|opus)$/i, '')
    .trim()

  const cleanArtist = (artist || '')
    .replace(/^unknown artist$/i, '')
    .replace(/\s*-\s*topic$/i, '')
    .trim()

  if (!cleanTitle && !cleanArtist) return null

  const cacheKey = buildArtworkCacheKey(cleanTitle, cleanArtist)
  if (memoryCache.has(cacheKey)) {
    const cached = memoryCache.get(cacheKey)
    return cached || null
  }

  // Deduplicate concurrent requests for the exact same track
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!
  }

  const promise = (async (): Promise<string | null> => {
    // 1. Try search via window.api.searchAppleMusic if running in desktop Electron
    try {
      if (typeof window !== 'undefined' && window.api?.searchAppleMusic) {
        const query = [cleanArtist, cleanTitle].filter(Boolean).join(' ').trim()
        const res = await window.api.searchAppleMusic(query)
        const match =
          res?.Songs?.find((s: { thumbnail?: string }) => Boolean(s.thumbnail))?.thumbnail ||
          res?.['Top Results']?.find((s: { thumbnail?: string }) => Boolean(s.thumbnail))?.thumbnail ||
          res?.Albums?.find((s: { thumbnail?: string }) => Boolean(s.thumbnail))?.thumbnail
        if (match) {
          setCachedArtwork(cleanTitle, cleanArtist, match)
          return match
        }
      }
    } catch {
      // Fall through to public web APIs
    }

    // 2. Direct iTunes Search API with full query and primary artist fallback
    const primaryArtist = cleanArtist.split(/[,&/]|feat\.|ft\./i)[0].trim()
    const queries = [
      [cleanArtist, cleanTitle].filter(Boolean).join(' ').trim(),
      primaryArtist !== cleanArtist ? [primaryArtist, cleanTitle].filter(Boolean).join(' ').trim() : null
    ].filter(Boolean) as string[]

    for (const q of queries) {
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=3`
        const res = await fetch(itunesUrl)
        if (res.ok) {
          const data = (await res.json()) as any
          const results = Array.isArray(data?.results) ? data.results : []
          for (const item of results) {
            const raw = item.artworkUrl100 || item.artworkUrl60
            if (typeof raw === 'string' && raw) {
              const highRes = raw.replace('100x100bb', '600x600bb')
              setCachedArtwork(cleanTitle, cleanArtist, highRes)
              return highRes
            }
          }
        }
      } catch {
        // Continue to Deezer
      }
    }

    // 3. Fallback to Deezer public search
    for (const q of queries) {
      try {
        const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=3`
        const res = await fetch(deezerUrl)
        if (res.ok) {
          const data = (await res.json()) as any
          const list = Array.isArray(data?.data) ? data.data : []
          for (const item of list) {
            const cover =
              item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium
            if (typeof cover === 'string' && cover) {
              setCachedArtwork(cleanTitle, cleanArtist, cover)
              return cover
            }
          }
        }
      } catch {
        // Deezer unavailable
      }
    }

    // Cache negative lookup so we do not spam failing requests
    memoryCache.set(cacheKey, '')
    return null
  })().finally(() => {
    inFlightRequests.delete(cacheKey)
  })

  inFlightRequests.set(cacheKey, promise)
  return promise
}

/**
 * React hook to safely resolve artwork with offline-first memory caching,
 * live online fallback, and inter-component synchronized state updates.
 */
export function useResolvedArtwork({
  src,
  title,
  artist
}: {
  src?: string | null
  title?: string
  artist?: string
}) {
  const cacheKey = buildArtworkCacheKey(title, artist)
  const initialCached = getCachedArtwork(title, artist)
  const effectiveInitial = src || initialCached || ''

  const [artworkUrl, setArtworkUrl] = useState<string>(effectiveInitial)
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(src) || (!effectiveInitial && Boolean(title || artist)))
  const [hasFailed, setHasFailed] = useState<boolean>(!effectiveInitial && !title && !artist)
  const attemptedOnline = useRef<boolean>(false)

  useEffect(() => {
    const cached = getCachedArtwork(title, artist)
    const nextSrc = src || cached || ''
    setArtworkUrl(nextSrc)
    attemptedOnline.current = false

    if (nextSrc) {
      setIsLoading(true)
      setHasFailed(false)
    } else if (title || artist) {
      setIsLoading(true)
      setHasFailed(false)
      void resolveArtworkOnline(title, artist).then((resolved) => {
        if (resolved) {
          setArtworkUrl(resolved)
          setIsLoading(false)
          setHasFailed(false)
        } else {
          setIsLoading(false)
          setHasFailed(true)
        }
      })
    } else {
      setIsLoading(false)
      setHasFailed(true)
    }
  }, [src, title, artist, cacheKey])

  // Listen for global resolution events across other components
  useEffect(() => {
    const handleResolved = (e: Event) => {
      const custom = e as CustomEvent<{ key: string; artworkUrl: string }>
      if (custom.detail?.key === cacheKey && custom.detail?.artworkUrl) {
        setArtworkUrl(custom.detail.artworkUrl)
        setIsLoading(false)
        setHasFailed(false)
      }
    }
    window.addEventListener('felo:artwork-resolved', handleResolved)
    return () => window.removeEventListener('felo:artwork-resolved', handleResolved)
  }, [cacheKey])

  const handleError = () => {
    if (!attemptedOnline.current && (title || artist)) {
      attemptedOnline.current = true
      setIsLoading(true)
      void resolveArtworkOnline(title, artist).then((resolved) => {
        if (resolved && resolved !== artworkUrl) {
          setArtworkUrl(resolved)
          setIsLoading(false)
          setHasFailed(false)
        } else {
          setIsLoading(false)
          setHasFailed(true)
        }
      })
    } else {
      setIsLoading(false)
      setHasFailed(true)
    }
  }

  const handleLoad = () => {
    setIsLoading(false)
    setHasFailed(false)
  }

  return {
    artworkUrl,
    isLoading,
    hasFailed,
    handleError,
    handleLoad
  }
}
