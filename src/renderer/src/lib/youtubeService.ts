/**
 * YouTube Metadata & Media Resolver Service
 *
 * Provides robust URL/ID extraction, HTML entity decoding, oEmbed metadata resolution,
 * and LRU/TTL caching matching MUSIXQUARE standard architecture.
 */

export interface YouTubeMetadata {
  videoId: string
  title: string
  channel: string
  thumbnailUrl: string
  url: string
}

const HTML_ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i
const HTML_ENTITY_RE_G = /&(#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi

const FALLBACK_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '\u2022',
  copy: '\u00a9',
  divide: '\u00f7',
  gt: '>',
  hellip: '\u2026',
  laquo: '\u00ab',
  ldquo: '\u201c',
  lsquo: '\u2018',
  lt: '<',
  mdash: '\u2014',
  middot: '\u00b7',
  nbsp: ' ',
  ndash: '\u2013',
  plusmn: '\u00b1',
  quot: '"',
  raquo: '\u00bb',
  rdquo: '\u201d',
  reg: '\u00ae',
  rsquo: "'",
  times: '\u00d7',
  trade: '\u2122'
}

let decoderTextArea: HTMLTextAreaElement | null = null

function decodeNumericEntity(entity: string): string | null {
  const isHex = entity.slice(0, 2).toLowerCase() === '#x'
  const raw = isHex ? entity.slice(2) : entity.slice(1)
  const codePoint = Number.parseInt(raw, isHex ? 16 : 10)
  if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return null
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return null
  }
}

export function decodeHtmlEntities(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!HTML_ENTITY_RE.test(text)) return text.trim()

  if (typeof document !== 'undefined') {
    try {
      decoderTextArea ||= document.createElement('textarea')
      decoderTextArea.innerHTML = text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      return decoderTextArea.value.trim()
    } catch {
      // Fall through to regex-based parser
    }
  }

  return text
    .replace(HTML_ENTITY_RE_G, (match, entity: string) => {
      if (entity[0] === '#') return decodeNumericEntity(entity) ?? match
      return FALLBACK_ENTITIES[entity.toLowerCase()] ?? match
    })
    .trim()
}

/**
 * Extracts standard 11-character YouTube video ID across all URL schemes:
 * - https://www.youtube.com/watch?v=...
 * - https://youtu.be/...
 * - https://youtube.com/shorts/...
 * - https://youtube.com/live/...
 * - https://youtube.com/embed/...
 * - Raw 11-char ID
 */
export function extractYouTubeVideoId(input?: string | null): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed

  const normalized = trimmed.replace(
    /^((?:[a-z][a-z0-9+.-]*:)?\/\/)?([^/?#]+)/i,
    (_auth, prefix: string | undefined, host: string) => `${prefix || ''}${host.toLowerCase()}`
  )

  const patterns = [
    /(?:(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^&]*&)*v=|youtu\.be\/|(?:www\.)?youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/i,
    /(?:www\.|m\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/i,
    /(?:www\.|m\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})(?![a-zA-Z0-9_-])/i
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match && match[1]) return match[1]
  }

  return null
}

export function isYouTubeSong(song?: any | null): boolean {
  if (!song) return false
  // A song that has a real local file path on disk or memory blob is NEVER played via YouTube
  if (
    song.filePath &&
    !song.filePath.startsWith('virtual:') &&
    !/^https?:/i.test(song.filePath) &&
    !/youtube\.com|youtu\.be/i.test(song.filePath)
  ) {
    return false
  }
  if (song.filePath && /^(blob:|data:)/i.test(song.filePath)) return false
  if (song.audioUrl && /^(blob:|data:)/i.test(song.audioUrl)) return false

  if (song.isYouTube || song.streamType === 'youtube') return true
  if (typeof song.id === 'string' && song.id.startsWith('yt-')) return true
  const audioUrl = song.audioUrl || song.filePath || ''
  return /youtube\.com|youtu\.be/i.test(audioUrl)
}

// In-memory LRU + TTL Cache (10 minutes)
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 100
const metadataCache = new Map<string, { data: YouTubeMetadata; ts: number }>()
const inFlightRequests = new Map<string, Promise<YouTubeMetadata | null>>()

/**
 * Resolves genuine title, channel/artist, and high-res thumbnail for any YouTube URL or ID.
 * Seamlessly leverages desktop Node IPC in Electron, with direct oEmbed fallback in browser/PWA.
 */
export async function fetchYouTubeMetadata(urlOrId: string): Promise<YouTubeMetadata | null> {
  const videoId = extractYouTubeVideoId(urlOrId)
  if (!videoId) return null

  // 1. Check in-memory cache
  const cached = metadataCache.get(videoId)
  if (cached) {
    if (Date.now() - cached.ts < CACHE_TTL_MS) {
      // Move to MRU position
      metadataCache.delete(videoId)
      metadataCache.set(videoId, cached)
      return cached.data
    }
    metadataCache.delete(videoId)
  }

  // 2. Return pending in-flight promise if identical request is ongoing
  const pending = inFlightRequests.get(videoId)
  if (pending) return pending

  const fetchPromise = (async (): Promise<YouTubeMetadata | null> => {
    try {
      // 3. Prefer Electron main-process IPC (completely bypasses browser CORS & CSP restrictions)
      if (typeof window !== 'undefined' && window.api?.getYouTubeMetadata) {
        try {
          const res = await window.api.getYouTubeMetadata(videoId)
          if (res?.success && res.title) {
            const result: YouTubeMetadata = {
              videoId,
              title: decodeHtmlEntities(res.title),
              channel: decodeHtmlEntities(res.channel || 'YouTube'),
              thumbnailUrl: res.thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`
            }
            return result
          }
        } catch (ipcErr) {
          console.warn('[youtubeService] Electron IPC metadata fetch failed, falling back to direct fetch:', ipcErr)
        }
      }

      // 4. Web browser / PWA fallback via YouTube oEmbed API
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      const response = await fetch(oembedUrl, {
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId))

      if (!response.ok) return null

      const data = (await response.json()) as Record<string, any>
      const title = decodeHtmlEntities(data.title)
      if (!title) return null

      const channel = decodeHtmlEntities(data.author_name || 'YouTube')
      const thumbnailUrl =
        typeof data.thumbnail_url === 'string' && data.thumbnail_url
          ? data.thumbnail_url
          : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

      const result: YouTubeMetadata = {
        videoId,
        title,
        channel,
        thumbnailUrl,
        url: `https://www.youtube.com/watch?v=${videoId}`
      }
      return result
    } catch (err) {
      console.warn('[youtubeService] Metadata fetch failed for', videoId, err)
      return null
    } finally {
      inFlightRequests.delete(videoId)
    }
  })()

  inFlightRequests.set(videoId, fetchPromise)
  const resolved = await fetchPromise

  if (resolved) {
    if (metadataCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = metadataCache.keys().next().value
      if (oldestKey !== undefined) metadataCache.delete(oldestKey)
    }
    metadataCache.set(videoId, { data: resolved, ts: Date.now() })
  }

  return resolved
}

export interface YouTubeSearchResultItem {
  id: string
  title: string
  channel: string
  thumbnailUrl: string
  duration?: string
  url: string
}

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_CACHE_MAX_ENTRIES = 50
const searchResultsCache = new Map<string, { data: YouTubeSearchResultItem[]; ts: number }>()

export function clearYouTubeSearchCache(): void {
  searchResultsCache.clear()
}

/**
 * High-performance YouTube search resolver.
 * Handles both keyword queries (via desktop IPC) and direct YouTube URLs/IDs (via oEmbed/metadata resolver).
 * Results are cached in an in-memory LRU map for 5 minutes.
 */
export async function searchYouTubeVideos(
  query: string,
  _signal?: AbortSignal
): Promise<YouTubeSearchResultItem[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // 1. Direct YouTube link or 11-char ID detection
  const directId = extractYouTubeVideoId(trimmed)
  if (directId) {
    const meta = await fetchYouTubeMetadata(directId)
    if (meta) {
      return [
        {
          id: directId,
          title: meta.title,
          channel: meta.channel,
          thumbnailUrl: meta.thumbnailUrl,
          url: meta.url
        }
      ]
    }
    return [
      {
        id: directId,
        title: 'YouTube Track',
        channel: 'YouTube',
        thumbnailUrl: `https://img.youtube.com/vi/${directId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${directId}`
      }
    ]
  }

  // 2. Check query in cache
  const normalizedQuery = trimmed.toLowerCase()
  const cached = searchResultsCache.get(normalizedQuery)
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL_MS) {
    return cached.data
  }

  // 3. Keyword Search via Electron desktop IPC
  if (typeof window !== 'undefined' && window.api?.searchDownloadSource) {
    try {
      const raw = await window.api.searchDownloadSource('youtube', trimmed, {})
      if (Array.isArray(raw) && raw.length > 0) {
        const parsed: YouTubeSearchResultItem[] = raw.map((item: any) => {
          const rawDuration = item.meta ? item.meta.split('·')[0].trim() : ''
          const duration = /^\d+:\d+(?::\d+)?$/.test(rawDuration)
            ? rawDuration
            : rawDuration === 'YouTube Audio'
              ? ''
              : rawDuration
          return {
            id: item.id,
            title: decodeHtmlEntities(item.title || 'YouTube Track'),
            channel: decodeHtmlEntities(item.artist || 'YouTube'),
            duration,
            thumbnailUrl: item.artworkUrl || `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${item.id}`
          }
        })

        if (searchResultsCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
          const oldestKey = searchResultsCache.keys().next().value
          if (oldestKey !== undefined) searchResultsCache.delete(oldestKey)
        }
        searchResultsCache.set(normalizedQuery, { data: parsed, ts: Date.now() })

        return parsed
      }
    } catch (err) {
      console.warn('[youtubeService] Desktop YouTube search failed:', err)
    }
  }

  return []
}
