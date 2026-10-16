import { app, ipcMain, net } from 'electron'
import fs from 'fs'
import path from 'path'
import * as mm from 'music-metadata'
import { getDb } from '../database'
import {
  sanitizeTrackMetadata,
  SOURCE_TAG_REGEX,
  VIDEO_PROMO_TAG_REGEX,
  YOUTUBE_CHANNEL_SUFFIX_REGEX
} from '../../shared/songMatching'
import { validateWith, LyricsFetchInputSchema } from '../../shared/validators/ipcSchemas'

export interface LrclibLyrics {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string
  syncedLyrics?: string
}

export function cleanLyricsMetadata(value: string): string {
  if (!value) return ''
  let cleaned = value
    .replace(SOURCE_TAG_REGEX, '')
    .replace(VIDEO_PROMO_TAG_REGEX, '')
    .replace(YOUTUBE_CHANNEL_SUFFIX_REGEX, '')
    .normalize('NFKC')
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
    .replace(/^\s*\d{1,3}[.\-_)]+\s*/, '')
    .replace(
      /\s*[\(\[]\s*(?:explicit|official(?:\s*(?:music|lyric|lyrics)?\s*(?:video|audio|mv)?)?|lyrics?(?:\s*video)?|remaster(?:ed)?(?:\s*[\d\w]+)?|hq|hd|4k|visualizer|audio|video|mv|copyright[\s-]*free|feat\.?.*?|ft\.?.*?|prod\.?.*?|produced\s+by.*?|single\s*version|bonus\s*track|deluxe(?:\s*edition)?|live(?:\s*at\s*.*)?|\d+)\s*[\)\]]\s*/gi,
      ' '
    )
    .replace(/\s*[-|]\s*(?:official\s*(?:music\s*)?(?:video|audio|mv)|lyrics?(?:\s*video)?|audio|visualizer|mv|hd|4k)\s*$/gi, '')
    .replace(/\s+(?:official\s*)?(?:music\s*)?(?:lyric(?:s)?\s*)?(?:video|audio|mv)\s*$/gi, '')
    .replace(/\s+(?:visualizer|official\s+audio)\s*$/gi, '')
    .replace(/\s+no\.\s*\d+\s*$/gi, '')
    .replace(/\bunknown\s*artist\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  let previous = ''
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned
      .replace(SOURCE_TAG_REGEX, '')
      .replace(/\s*[-|]\s*$/gi, '')
      .trim()
  }
  return cleaned
}

export function isPlaceholderLyricsValue(value?: string): boolean {
  return /^(?:unknown|untitled|n\/?a|none|null)(?:\s+(?:artist|album|track))?$/i.test(
    value?.trim() || ''
  )
}

export function resolveLyricsMetadata(songInfo: {
  title: string
  artist?: string
  album?: string
  duration?: number
  filePath?: string
}): { title: string; artist: string; album: string; duration?: number; filePath?: string } {
  const rawArtist = isPlaceholderLyricsValue(songInfo.artist) ? '' : (songInfo.artist || '')
  const rawAlbum = isPlaceholderLyricsValue(songInfo.album) ? '' : (songInfo.album || '')
  const rawTitle = songInfo.title || ''

  // 1. Sanitize together using shared track metadata intelligence
  const sanitized = sanitizeTrackMetadata({
    title: rawTitle,
    artist: rawArtist,
    album: rawAlbum
  })

  let title = cleanLyricsMetadata(sanitized.title || rawTitle)
  let artist = cleanLyricsMetadata(sanitized.artist || rawArtist)
  const album = cleanLyricsMetadata(sanitized.album || rawAlbum)

  const titleParts = title.match(/^(.+?)\s+[-\u2013\u2014|]\s+(.+)$/)
  if (titleParts) {
    const inferredArtist = cleanLyricsMetadata(titleParts[1])
    const inferredTitle = cleanLyricsMetadata(titleParts[2])
    const normalizedArtist = normalizeForCompare(artist)
    const normalizedInferredArtist = normalizeForCompare(inferredArtist)
    const titleContainsKnownArtist =
      normalizedArtist &&
      (normalizedInferredArtist === normalizedArtist ||
        normalizedInferredArtist.includes(normalizedArtist) ||
        normalizedArtist.includes(normalizedInferredArtist))

    if (!artist || titleContainsKnownArtist) {
      artist = artist || inferredArtist
      title = inferredTitle
    }
  }

  // Detect unparenthesized feat./ft. in title
  const featMatch = title.match(/^(.+?)\s+(?:feat\.?|ft\.?)\s+(.+)$/i)
  if (featMatch) {
    title = cleanLyricsMetadata(featMatch[1])
    if (!artist) {
      artist = cleanLyricsMetadata(featMatch[2])
    }
  }

  return {
    title,
    artist,
    album,
    duration:
      Number.isFinite(songInfo.duration) && Number(songInfo.duration) > 0
        ? Math.round(Number(songInfo.duration))
        : undefined,
    filePath: songInfo.filePath
  }
}

export function hasLyrics(data: LrclibLyrics | null | undefined): data is LrclibLyrics {
  return Boolean(data?.syncedLyrics || data?.plainLyrics)
}

export async function fetchLrclib(
  endpoint: '/get' | '/search',
  params: URLSearchParams
): Promise<LrclibLyrics | LrclibLyrics[] | null> {
  try {
    const response = await net.fetch(`https://lrclib.net/api${endpoint}?${params.toString()}`, {
      headers: {
        'User-Agent': `felo ${app.getVersion()} (local desktop app)`
      },
      signal: AbortSignal.timeout(6000)
    })
    if (!response.ok) return null
    return (await response.json()) as LrclibLyrics | LrclibLyrics[]
  } catch (err) {
    console.warn(`LRCLIB ${endpoint} failed:`, err)
    return null
  }
}

export function normalizeForCompare(value?: string): string {
  return cleanLyricsMetadata(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function lyricsTextSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1

  const minLen = Math.min(left.length, right.length)
  const maxLen = Math.max(left.length, right.length)

  // Substring match requires high length ratio and min 4 chars to prevent false positives
  if (minLen >= 4 && (left.includes(right) || right.includes(left))) {
    if (minLen / maxLen >= 0.7) {
      return 0.85
    }
  }

  const leftTokens = new Set(left.split(/\s+/).filter(Boolean))
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++
  }
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union > 0 ? intersection / union : 0
}

export function scoreLyricsCandidate(
  candidate: LrclibLyrics,
  track: string,
  artist: string,
  album = '',
  duration?: number
): number {
  if (!hasLyrics(candidate)) return -1

  const candidateTrack = normalizeForCompare(candidate.trackName)
  const candidateArtist = normalizeForCompare(candidate.artistName)
  const targetTrack = normalizeForCompare(track)
  const targetArtist = normalizeForCompare(artist)
  const candidateAlbum = normalizeForCompare(candidate.albumName)
  const targetAlbum = normalizeForCompare(album)

  // Prioritize synced lyrics over plain lyrics
  let score = candidate.syncedLyrics ? 35 : 10

  const trackSim = lyricsTextSimilarity(candidateTrack, targetTrack)
  score += trackSim * 60

  if (targetArtist) {
    const artistSim = lyricsTextSimilarity(candidateArtist, targetArtist)
    score += artistSim * 45
  } else {
    // If no target artist was provided, grant modest score if candidate has an artist
    score += 15
  }

  if (targetAlbum && candidateAlbum) {
    score += lyricsTextSimilarity(candidateAlbum, targetAlbum) * 10
  }

  if (duration && candidate.duration) {
    const difference = Math.abs(candidate.duration - duration)
    if (difference <= 2) score += 20
    else if (difference <= 5) score += 12
    else if (difference <= 10) score += 5
    else if (difference >= 25) score -= 15
  }

  return score
}

export function pickBestLyrics(
  results: LrclibLyrics | LrclibLyrics[] | null,
  track: string,
  artist: string,
  album = '',
  duration?: number
): LrclibLyrics | null {
  if (!results) return null
  const list = Array.isArray(results) ? results : [results]

  const ranked = list
    .filter(hasLyrics)
    .map((candidate) => ({
      candidate,
      score: scoreLyricsCandidate(candidate, track, artist, album, duration)
    }))
    .sort((a, b) => b.score - a.score)

  return ranked[0] && ranked[0].score >= 38 ? ranked[0].candidate : null
}

export async function findLocalLyrics(songInfo: {
  title: string
  artist?: string
  filePath?: string
}): Promise<LrclibLyrics | null> {
  const filePath = songInfo.filePath
  if (!filePath) return null

  try {
    if (!fs.existsSync(filePath)) return null

    const dir = path.dirname(filePath)
    const ext = path.extname(filePath)
    const baseName = path.basename(filePath, ext)
    const cleanTitle = cleanLyricsMetadata(songInfo.title)

    // 1. Look for sidecar .lrc files in the same directory
    const candidateLrcFiles = [
      path.join(dir, `${baseName}.lrc`),
      path.join(dir, `${baseName}.LRC`),
      path.join(dir, `${cleanTitle}.lrc`),
      path.join(dir, `${cleanTitle}.LRC`)
    ]

    for (const lrcPath of candidateLrcFiles) {
      if (fs.existsSync(lrcPath)) {
        try {
          const content = fs.readFileSync(lrcPath, 'utf8')
          if (content.trim()) {
            const hasTimestamps = /\[\d{1,2}:\d{2}/.test(content)
            return {
              id: 0,
              trackName: songInfo.title,
              artistName: songInfo.artist || '',
              albumName: '',
              duration: 0,
              instrumental: false,
              plainLyrics: hasTimestamps
                ? content.replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, '').trim()
                : content.trim(),
              syncedLyrics: hasTimestamps ? content : undefined
            }
          }
        } catch (err) {
          console.warn('Failed to read sidecar LRC file:', lrcPath, err)
        }
      }
    }

    // 2. Check embedded lyrics via music-metadata
    try {
      const parsed = await mm.parseFile(filePath)
      const rawLyrics = parsed.common?.lyrics?.[0]
      const lyricText = typeof rawLyrics === 'string' ? rawLyrics : (rawLyrics as any)?.text || ''
      if (lyricText && lyricText.trim()) {
        const text = lyricText.trim()
        const hasTimestamps = /\[\d{1,2}:\d{2}/.test(text)
        return {
          id: 0,
          trackName: songInfo.title,
          artistName: songInfo.artist || '',
          albumName: parsed.common?.album || '',
          duration: parsed.format?.duration ? Math.round(parsed.format.duration) : 0,
          instrumental: false,
          plainLyrics: hasTimestamps ? text.replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, '').trim() : text,
          syncedLyrics: hasTimestamps ? text : undefined
        }
      }

      const nativeTags = parsed.native
      if (nativeTags) {
        for (const tagList of Object.values(nativeTags)) {
          for (const tag of tagList) {
            if (
              tag.id === 'USLT' ||
              tag.id === 'SYLT' ||
              tag.id === 'LYRICS' ||
              tag.id === 'UNSYNCEDLYRICS'
            ) {
              const textVal =
                typeof tag.value === 'string' ? tag.value : (tag.value as any)?.text
              if (textVal && typeof textVal === 'string' && textVal.trim()) {
                const text = textVal.trim()
                const hasTimestamps = /\[\d{1,2}:\d{2}/.test(text)
                return {
                  id: 0,
                  trackName: songInfo.title,
                  artistName: songInfo.artist || '',
                  albumName: parsed.common?.album || '',
                  duration: parsed.format?.duration ? Math.round(parsed.format.duration) : 0,
                  instrumental: false,
                  plainLyrics: hasTimestamps
                    ? text.replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, '').trim()
                    : text,
                  syncedLyrics: hasTimestamps ? text : undefined
                }
              }
            }
          }
        }
      }
    } catch (tagErr) {
      console.warn('Failed to parse embedded lyrics from file:', filePath, tagErr)
    }
  } catch (err) {
    console.warn('Error checking local lyrics:', err)
  }

  return null
}

const lyricsMemoryCache = new Map<string, LrclibLyrics>()

export function getLyricsCacheKey(title: string, artist?: string): string {
  return `${cleanLyricsMetadata(title).toLowerCase()}:::${cleanLyricsMetadata(artist || '').toLowerCase()}`
}

export function getCachedLyrics(title: string, artist?: string): LrclibLyrics | null {
  const key = getLyricsCacheKey(title, artist)
  const inMem = lyricsMemoryCache.get(key)
  if (inMem) return inMem

  try {
    const db = getDb()
    const row = db.prepare('SELECT * FROM lyrics_cache WHERE id = ?').get(key) as any
    if (row && (row.plainLyrics || row.syncedLyrics)) {
      const result: LrclibLyrics = {
        id: 0,
        trackName: row.trackName || title,
        artistName: row.artistName || artist || '',
        albumName: '',
        duration: 0,
        instrumental: Boolean(row.instrumental),
        plainLyrics: row.plainLyrics || undefined,
        syncedLyrics: row.syncedLyrics || undefined
      }
      lyricsMemoryCache.set(key, result)
      return result
    }
  } catch {
    // If table not yet ready, ignore
  }
  return null
}

export function saveCachedLyrics(title: string, artist: string, lyrics: LrclibLyrics): void {
  const key = getLyricsCacheKey(title, artist)
  lyricsMemoryCache.set(key, lyrics)

  try {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO lyrics_cache (id, trackName, artistName, plainLyrics, syncedLyrics, instrumental)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      key,
      lyrics.trackName || title,
      lyrics.artistName || artist,
      lyrics.plainLyrics || null,
      lyrics.syncedLyrics || null,
      lyrics.instrumental ? 1 : 0
    )
  } catch (err) {
    console.warn('Failed to cache lyrics in database:', err)
  }
}

export async function fetchLyricsFromLrclib(songInfo: {
  title: string
  artist?: string
  album?: string
  duration?: number
  filePath?: string
}): Promise<LrclibLyrics | null> {
  // 1. Check local sidecar .lrc or embedded audio tags first
  if (songInfo.filePath) {
    const local = await findLocalLyrics(songInfo)
    if (local) return local
  }

  const rawTrack = songInfo.title?.trim() || ''
  const rawArtist = songInfo.artist?.trim() || ''
  const resolved = resolveLyricsMetadata(songInfo)
  const cleanTrack = resolved.title
  const cleanArtist = resolved.artist
  const cleanAlbum = resolved.album

  if (!cleanTrack) return null

  // 2. Check cache
  const cached = getCachedLyrics(cleanTrack, cleanArtist)
  if (cached) return cached

  // 3. Query LRCLIB
  const attempts: Array<{
    endpoint: '/get' | '/search'
    params: URLSearchParams
    track: string
    artist: string
    album: string
    duration?: number
  }> = []

  const addAttempt = (attempt: (typeof attempts)[number]) => {
    const key = `${attempt.endpoint}?${attempt.params.toString()}`
    if (!attempts.some((item) => `${item.endpoint}?${item.params.toString()}` === key)) {
      attempts.push(attempt)
    }
  }

  if (cleanTrack && cleanArtist) {
    const exactParams = new URLSearchParams({
      track_name: cleanTrack,
      artist_name: cleanArtist
    })
    if (cleanAlbum) exactParams.set('album_name', cleanAlbum)
    if (resolved.duration) exactParams.set('duration', String(resolved.duration))
    addAttempt({
      endpoint: '/get',
      params: exactParams,
      track: cleanTrack,
      artist: cleanArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })

    addAttempt({
      endpoint: '/get',
      params: new URLSearchParams({ track_name: cleanTrack, artist_name: cleanArtist }),
      track: cleanTrack,
      artist: cleanArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })

    addAttempt({
      endpoint: '/search',
      params: new URLSearchParams({ track_name: cleanTrack, artist_name: cleanArtist }),
      track: cleanTrack,
      artist: cleanArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })

    addAttempt({
      endpoint: '/search',
      params: new URLSearchParams({ q: `${cleanArtist} ${cleanTrack}` }),
      track: cleanTrack,
      artist: cleanArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })
  }

  if (cleanTrack) {
    addAttempt({
      endpoint: '/search',
      params: new URLSearchParams({ q: cleanTrack }),
      track: cleanTrack,
      artist: cleanArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })
  }

  const cleanRawArtist = isPlaceholderLyricsValue(rawArtist) ? '' : cleanLyricsMetadata(rawArtist)
  const rawQuery = `${cleanLyricsMetadata(rawTrack)} ${cleanRawArtist}`.trim()
  if (rawQuery && rawQuery !== cleanTrack) {
    addAttempt({
      endpoint: '/search',
      params: new URLSearchParams({ q: rawQuery }),
      track: cleanTrack || rawTrack,
      artist: cleanArtist || cleanRawArtist,
      album: cleanAlbum,
      duration: resolved.duration
    })
  }

  for (const attempt of attempts) {
    const data = await fetchLrclib(attempt.endpoint, attempt.params)
    const best = pickBestLyrics(
      data,
      attempt.track,
      attempt.artist,
      attempt.album,
      attempt.duration
    )
    if (best) {
      saveCachedLyrics(cleanTrack, cleanArtist, best)
      if (songInfo.filePath && best.syncedLyrics) {
        try {
          const lrcPath = songInfo.filePath.replace(/\.[^.]+$/, '.lrc')
          if (!fs.existsSync(lrcPath)) {
            fs.writeFileSync(lrcPath, best.syncedLyrics, 'utf8')
          }
        } catch (err) {
          console.warn('Could not auto-save .lrc sidecar file:', err)
        }
      }
      return best
    }
  }

  return null
}

export type LyricsTransformMode = 'translate' | 'romanize'

const lyricTransformCache = new Map<string, string>()
const supportedTranslationLanguages = new Set([
  'en',
  'id',
  'ja',
  'ko',
  'zh-CN',
  'es',
  'fr',
  'de',
  'th'
])

function containsNonLatinLetters(value: string): boolean {
  return [...value].some(
    (character) => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)
  )
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

export async function transformLyricLine(
  text: string,
  mode: LyricsTransformMode,
  targetLanguage = 'en'
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed || (mode === 'romanize' && !containsNonLatinLetters(trimmed))) return text

  const cacheKey = `${mode}:${targetLanguage}:${trimmed}`
  const cached = lyricTransformCache.get(cacheKey)
  if (cached !== undefined) return cached

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLanguage,
    dt: mode === 'translate' ? 't' : 'rm',
    q: trimmed
  })

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await net.fetch(
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        { signal: controller.signal }
      )
      if (!response.ok) throw new Error(`Google Translate returned ${response.status}`)

      const data = await response.json()
      const segments = Array.isArray(data?.[0]) ? data[0] : []
      const transformed =
        mode === 'translate'
          ? segments.map((segment: any) => segment?.[0] || '').join('')
          : segments.map((segment: any) => segment?.[3] || '').join(' ')
      const result = transformed.trim() || text
      lyricTransformCache.set(cacheKey, result)
      return result
    } catch (error) {
      lastError = error
      if (attempt < 2) await wait(400 * 2 ** attempt)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lyrics transformation failed')
}

export async function transformLyricBatch(
  batch: string[],
  targetLanguage = 'en'
): Promise<string[]> {
  if (batch.length === 0) return []
  const joinedText = batch.join('\n')

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLanguage,
    dt: 't',
    q: joinedText
  })

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await net.fetch(
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        { signal: controller.signal }
      )
      if (!response.ok) throw new Error(`Google Translate returned ${response.status}`)

      const data = await response.json()
      const segments = Array.isArray(data?.[0]) ? data[0] : []
      const translatedFullText = segments.map((segment: any) => segment?.[0] || '').join('')
      const translatedLines = translatedFullText.split('\n')

      return batch.map((originalLine, i) => {
        const trans = translatedLines[i]
        return (trans && trans.trim()) || originalLine
      })
    } catch (error) {
      lastError = error
      if (attempt < 2) await wait(400 * 2 ** attempt)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lyrics translation batch failed')
}

export async function transformLyricsLines(
  input: unknown,
  mode: LyricsTransformMode,
  targetLanguage = 'en'
): Promise<string[]> {
  if (!Array.isArray(input)) throw new Error('Lyrics lines must be an array')
  if (mode === 'translate' && !supportedTranslationLanguages.has(targetLanguage)) {
    throw new Error('Unsupported translation language')
  }

  const lines = input.map((line) => (typeof line === 'string' ? line : ''))
  if (lines.length > 300 || lines.reduce((total, line) => total + line.length, 0) > 50000) {
    throw new Error('Lyrics are too large to transform')
  }

  // Strip inline word timestamps like <00:12.34> so Google Translate doesn't mangle them
  const sanitizeForTransform = (line: string) => line.replace(/<[^>]+>/g, '').trim()
  const transformed = new Map<string, string>()

  if (mode === 'translate') {
    // Process unique non-empty lines in batches of 25 lines
    const uniqueCleanLines = [...new Set(lines.map(sanitizeForTransform).filter(Boolean))]
    const BATCH_SIZE = 25

    for (let i = 0; i < uniqueCleanLines.length; i += BATCH_SIZE) {
      const chunk = uniqueCleanLines.slice(i, i + BATCH_SIZE)
      const uncachedChunk = chunk.filter((l) => !lyricTransformCache.has(`translate:${targetLanguage}:${l}`))

      if (uncachedChunk.length > 0) {
        try {
          const results = await transformLyricBatch(uncachedChunk, targetLanguage)
          uncachedChunk.forEach((line, idx) => {
            const res = results[idx] || line
            lyricTransformCache.set(`translate:${targetLanguage}:${line}`, res)
          })
        } catch (err) {
          console.warn('Batch translation failed, falling back to line-by-line:', err)
          for (const line of uncachedChunk) {
            const res = await transformLyricLine(line, 'translate', targetLanguage).catch(() => line)
            lyricTransformCache.set(`translate:${targetLanguage}:${line}`, res)
          }
        }
      }

      chunk.forEach((l) => {
        transformed.set(l, lyricTransformCache.get(`translate:${targetLanguage}:${l}`) || l)
      })
    }

    return lines.map((line) => {
      const clean = sanitizeForTransform(line)
      return transformed.get(clean) ?? line
    })
  }

  // Romanize mode
  const uniqueLines = [...new Set(lines.map(sanitizeForTransform).filter(Boolean))]
  let nextIndex = 0
  const workerCount = Math.min(3, uniqueLines.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < uniqueLines.length) {
        const line = uniqueLines[nextIndex]
        nextIndex += 1
        transformed.set(line, await transformLyricLine(line, mode, targetLanguage))
        await wait(30)
      }
    })
  )

  return lines.map((line) => {
    const clean = sanitizeForTransform(line)
    return transformed.get(clean) ?? line
  })
}

export function registerLyricsIpc(): void {
  ipcMain.handle('lyrics:fetch', async (_, songInfo: unknown) => {
    try {
      const validated = validateWith(LyricsFetchInputSchema, songInfo)
      return fetchLyricsFromLrclib(validated)
    } catch {
      return null
    }
  })

  ipcMain.handle('lyrics:translate', (_, lines: unknown, targetLanguage: string) =>
    transformLyricsLines(lines, 'translate', targetLanguage)
  )

  ipcMain.handle('lyrics:romanize', (_, lines: unknown) =>
    transformLyricsLines(lines, 'romanize')
  )
}
