/**
 * Shared song matching and provider scoring utilities.
 * Used by both Electron main process (DownloadService) and Vite renderer.
 */

// Junk video / tag patterns that should be stripped safely without removing version tags like (Live) or (Remix)
const TRACK_NUM_PREFIX_REGEX = /^(?:[a-z]?\d{1,3}[.\s_-]+|\d{1,2}\s*-\s*)+/i

export const UNWANTED_VERSION_KEYWORDS = [
  'remix',
  'live',
  'karaoke',
  'instrumental',
  'acoustic',
  'cover',
  'slowed',
  'reverb',
  'tribute',
  'parody',
  'reaction',
  'snippet',
  'teaser',
  'sped up',
  'nightcore',
  'bass boosted',
  'clean version',
  'ringtone',
  'tutorial',
  'mashup',
  'radio edit',
  'extended mix',
  'club mix',
  'hour loop',
  '10 hours'
]

/**
 * Regex matching source platform tags inside parentheses, brackets, or braces.
 * Handles variations like: (YouTube), [YouTube], (YouTube Music), (Qobuz), [Qobuz],
 * (Qobus), [Qobus], (Deezer), (Soulseek), [Tidal], (Spotify), (SoundCloud), (Apple Music).
 */
export const SOURCE_TAG_REGEX =
  /\s*[[({]\s*(?:qobuz|qobus|deezer|tidal|youtube(?:\s*music)?|soulseek|slsk|spotify|apple\s*music|soundcloud)\s*[\])}]/gi

/**
 * Regex matching video or promotional noise tags.
 * Preserves musical tags like (Live), (Remix), (Acoustic), (Extended Mix), (feat. X).
 */
export const VIDEO_PROMO_TAG_REGEX =
  /\s*[[({]\s*(?:(?:official|original)?\s*(?:4k\s+|hd\s+|hq\s+|music\s+|lyric\s+|lyrics\s+|visualizer\s+)*(?:video|audio|mv|visualizer|track)(?:\s*(?:hd|hq|4k|1080p|720p))?|lyrics?|letra(?:\s*[\/&]\s*lyrics?)?|audio|visualizer|official|video|mv|hd|hq|4k|1080p|720p|explicit|clean)\s*[\])}]/gi

/**
 * Regex matching remaster/release year junk tags like [2021 Remaster], (Remastered), etc.
 */
export const REMASTER_TAG_REGEX =
  /\s*[[({]\s*(?:remaster(?:ed)?|digitally\s+remastered|\b(?:19|20)\d{2}\s+remaster(?:ed)?)\s*[\])}]/gi

/**
 * Trailing noise at the end of a title string (without brackets).
 */
export const TRAILING_VIDEO_NOISE_REGEX =
  /\s+(?:(?:official|original)?\s*(?:4k\s+|hd\s+|hq\s+|music\s+|lyric\s+|lyrics\s+|visualizer\s+)*(?:video|audio|mv|visualizer|track)|lyrics?|visualizer|hd|4k|hq)\s*$/gi

/**
 * Channel noise suffixes commonly found in YouTube owner names or metadata.
 * e.g. "Coldplay - Topic", "ColdplayVEVO", "Ed Sheeran Official", "Marshmello Music"
 */
export const YOUTUBE_CHANNEL_SUFFIX_REGEX =
  /(?:\s*-\s*Topic|\s+(?:VEVO|Official|Music|TV|Records|Channel|Media)|VEVO)$/i

/**
 * Provider-specific dummy album names that should not be used as actual album titles.
 */
export const DUMMY_PROVIDER_ALBUMS = new Set([
  'youtube music',
  'youtube',
  'qobuz hi-res',
  'qobuz',
  'qobus',
  'deezer',
  'soulseek',
  'unknown album',
  'various artists'
])

const MINOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'at', 'by', 'in', 'of', 'on', 'to', 'with', 'from', 'into', 'over'
])

const PRESERVED_ACRONYMS = new Set([
  'VIP', 'DJ', 'EDM', 'OST', 'EP', 'LP', 'BBC', 'USA', 'UK', 'NYC', 'FM', 'AM', 'CD',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'HQ', 'HD', '4K', 'TV', 'ID'
])

/**
 * Normalizes text to standard Title Case if it is detected as all-uppercase or all-lowercase.
 * Preserves recognized acronyms (VIP, DJ, EP, Roman numerals).
 */
export function normalizeTitleCase(input: string): string {
  if (!input) return ''
  const trimmed = input.trim()
  if (trimmed.length <= 2) return trimmed

  const letters = trimmed.replace(/[^\p{L}]/gu, '')
  const isAllUpper = letters.length >= 3 && letters === letters.toUpperCase()
  const isAllLower = letters.length >= 3 && letters === letters.toLowerCase()

  if (!isAllUpper && !isAllLower) {
    return trimmed
      .replace(/\bfeat\.?(?=\s|$|[)\]])/gi, 'feat.')
      .replace(/\bft\.?(?=\s|$|[)\]])/gi, 'ft.')
      .replace(/\bvs\.?(?=\s|$|[)\]])/gi, 'vs.')
  }

  return trimmed
    .replace(
      /([^\s\-_/[\]()]+)/gu,
      (word, _p1, offset) => {
        const upperWord = word.toUpperCase()
        if (PRESERVED_ACRONYMS.has(upperWord)) {
          return upperWord
        }

        const lowerWord = word.toLowerCase()
        if (offset > 0 && MINOR_WORDS.has(lowerWord)) {
          return lowerWord
        }

        return lowerWord.charAt(0).toUpperCase() + lowerWord.slice(1)
      }
    )
    .replace(/\bfeat\.?(?=\s|$|[)\]])/gi, 'feat.')
    .replace(/\bft\.?(?=\s|$|[)\]])/gi, 'ft.')
    .replace(/\bvs\.?(?=\s|$|[)\]])/gi, 'vs.')
}

export interface TrackMetadata {
  title: string
  artist: string
  album?: string
}

/**
 * Sanitizes and normalizes track metadata (title, artist, album) to industry standards.
 * Strips provider tags like (YouTube), (Qobuz), [Qobus], video promo junk, VEVO suffixes,
 * and splits "Artist - Title" embedded in titles when artist is unknown or redundant.
 */
export function sanitizeTrackMetadata(raw: TrackMetadata, _source?: string): TrackMetadata {
  let title = (raw.title || '').trim()
  let artist = (raw.artist || '').trim()
  let album = raw.album !== undefined ? raw.album.trim() : undefined

  // 0. Normalize unicode dashes and quotes
  title = title
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
    .replace(/[‘’“”]/g, "'")
  if (artist) {
    artist = artist
      .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
      .replace(/[‘’“”]/g, "'")
  }
  if (album) {
    album = album
      .replace(/[\u2010-\u2015\u2212\uFF0D]/g, '-')
      .replace(/[‘’“”]/g, "'")
  }

  // 1. Strip provider source tags (e.g. (YouTube), (Qobuz), [Qobus]) and video junk from title
  title = title
    .replace(SOURCE_TAG_REGEX, '')
    .replace(VIDEO_PROMO_TAG_REGEX, '')
    .replace(REMASTER_TAG_REGEX, '')
    .replace(TRAILING_VIDEO_NOISE_REGEX, '')
    .replace(TRACK_NUM_PREFIX_REGEX, '')
    .replace(/\s*\(\d+\)\s*$/g, '') // remove duplicate suffixes like (1), (2)
    .replace(/\bfeat\.?(?=\s|$|[)\]])/gi, 'feat.')
    .replace(/\bft\.?(?=\s|$|[)\]])/gi, 'ft.')
    .replace(/\bvs\.?(?=\s|$|[)\]])/gi, 'vs.')
    .replace(/\s+/g, ' ')
    .trim()

  // 2. Clean artist string (remove YouTube channel noise, provider tags, etc.)
  if (artist) {
    artist = artist
      .replace(SOURCE_TAG_REGEX, '')
      .replace(YOUTUBE_CHANNEL_SUFFIX_REGEX, '')
      .replace(/[‘’“”]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  const isGenericArtist =
    !artist ||
    /^(?:unknown\s+artist|unknown|various\s+artists|youtube|youtube\s+music|-)$/i.test(artist)

  // 3. Intelligently handle "Artist - Title" inside the title string
  if (title.includes(' - ')) {
    const parts = title.split(' - ').map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const candidateArtist = parts[0]
      const candidateTitle = parts.slice(1).join(' - ')

      if (isGenericArtist && candidateArtist.length > 0 && candidateArtist.length <= 80) {
        // If artist was unknown or generic channel, extract artist from title
        artist = candidateArtist
          .replace(YOUTUBE_CHANNEL_SUFFIX_REGEX, '')
          .replace(SOURCE_TAG_REGEX, '')
          .trim()
        title = candidateTitle
      } else if (!isGenericArtist) {
        // If artist is already known, check if title starts with the artist name
        const normCand = candidateArtist.toLowerCase()
        const normArt = artist.toLowerCase()
        if (normCand === normArt || normArt.startsWith(normCand) || normCand.startsWith(normArt)) {
          // Remove the duplicate artist prefix from title
          title = candidateTitle
        }
      }
    }
  }

  // 4. Secondary cleanup of title after possible splitting
  title = title
    .replace(SOURCE_TAG_REGEX, '')
    .replace(VIDEO_PROMO_TAG_REGEX, '')
    .replace(TRAILING_VIDEO_NOISE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Remove empty dangling parentheses or brackets like "Song ()" or "Song []"
  title = title.replace(/\s*\(\s*\)/g, '').replace(/\s*\[\s*\]/g, '').trim()

  // 5. Apply Title Casing if all-caps or all-lowercase
  title = normalizeTitleCase(title)
  if (artist && !isGenericArtist) {
    artist = normalizeTitleCase(artist)
  }

  // 6. Clean album
  if (album) {
    album = album
      .replace(SOURCE_TAG_REGEX, '')
      .replace(/\s*\[(?:flac|mp3|wav|24bit|16bit|lossless|cd|web)[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (DUMMY_PROVIDER_ALBUMS.has(album.toLowerCase()) || album === '') {
      album = undefined
    } else {
      album = normalizeTitleCase(album)
    }
  }

  return {
    title: title || raw.title?.trim() || '',
    artist: isGenericArtist && !artist ? (artist || raw.artist?.trim() || '') : artist,
    album
  }
}

/**
 * Strips bracketed and parenthesized junk (e.g. [Official Video 4K], (Lyrics))
 * while carefully preserving version tags like (Live), (Remix), (Acoustic).
 */
export function stripJunkTags(text: string): string {
  if (!text) return ''
  return text
    .replace(/\s*([[(][^\])]*[\])])\s*/g, (match, inner) => {
      const lower = inner.toLowerCase()
      // If it contains a version keyword, KEEP it so we can accurately match versions
      const hasVersionKeyword = UNWANTED_VERSION_KEYWORDS.some((kw) => lower.includes(kw))
      if (hasVersionKeyword) {
        return match
      }
      // If it contains video/tag noise, provider tags, or remaster/year info, STRIP it
      const isJunk =
        /(?:official|video|audio|visualizer|lyrics?|4k|hd|hq|explicit|clean|mv|clip|remaster|youtube|qobuz|qobus|deezer|tidal|spotify|apple\s*music|soundcloud|soulseek|\b(?:19|20)\d{2}\b)/i.test(
          lower
        )
      if (isJunk) {
        return ' '
      }
      return match
    })
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|visualizer|hd|4k)\s*$/gi,
      ''
    )
}

/**
 * Normalizes text for matching while carefully preserving version indicators
 * (e.g. live, remix, acoustic) so they can be accurately compared.
 */
export function normalizeForMatching(value?: string): string {
  if (!value) return ''
  const cleaned = stripJunkTags(value)
  return cleaned
    .toLowerCase()
    .replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(TRACK_NUM_PREFIX_REGEX, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strips noise and formats a high-precision search query for streaming providers.
 */
export function cleanSearchQuery(artist?: string, title?: string, fallbackQuery?: string): string {
  const cleanTitle = stripJunkTags(title || '')
    .replace(TRACK_NUM_PREFIX_REGEX, '')
    .replace(/\s*\([^)]*feat\.[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*feat\.[^\]]*\]/gi, '')
    .replace(/\s+feat\..*/gi, '')
    .replace(/\s+ft\..*/gi, '')
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  const cleanArtist = (artist || '')
    .replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, '')
    .replace(/\s*feat\..*/gi, '')
    .replace(/\s*ft\..*/gi, '')
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  if (cleanTitle && cleanArtist) {
    // If title already starts with or contains the artist, avoid duplicate tokens
    const normT = cleanTitle.toLowerCase()
    const normA = cleanArtist.toLowerCase()
    if (normT.startsWith(`${normA} - `) || normT.startsWith(`${normA} `)) {
      return cleanTitle
    }
    return `${cleanArtist} ${cleanTitle}`
  }

  if (cleanTitle) return cleanTitle
  if (cleanArtist) return cleanArtist

  if (fallbackQuery) {
    return stripJunkTags(fallbackQuery)
      .replace(TRACK_NUM_PREFIX_REGEX, '')
      .replace(/\b(?:song|songs|lagu|track|audio|music)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return ''
}

export interface SmartParsedQuery {
  title: string
  artist: string
  cleanQuery: string
  isCollaboration: boolean
}

/**
 * Parses user input queries into canonical title, artist, and collaboration metadata.
 * Handles natural connectors like "by", "-", "feat.", "ft.", "&", "with".
 */
export function parseSmartQuery(raw: string, explicitArtist?: string): SmartParsedQuery {
  if (!raw) {
    return { title: '', artist: explicitArtist?.trim() || '', cleanQuery: '', isCollaboration: false }
  }

  let text = stripJunkTags(raw)
    .replace(/^(?:play|putar|dengarkan|listen to|put on)\s+(?:this|that|the|a|song|track|lagu)?\s*/i, '')
    .replace(/^(?:play|putar|dengarkan|listen to|put on)\s+/i, '')
    .replace(/^(?:this|that)\s+/i, '')
    .replace(TRACK_NUM_PREFIX_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()

  const cleanQuery = text
    .replace(/\b(?:song|songs|lagu|track|audio|music)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (explicitArtist && explicitArtist.trim()) {
    const artist = explicitArtist.trim()
    const title = cleanQuery.replace(new RegExp(`\\b${artist}\\b`, 'gi'), '').trim() || cleanQuery
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`.trim(),
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    }
  }

  // 1. Connector: "Title by/from Artist" (e.g. "Shape of You by Ed Sheeran", "Yellow from Coldplay")
  const byMatch = cleanQuery.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i)
  if (byMatch) {
    const title = byMatch[1].trim()
    const artist = byMatch[2].trim()
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`,
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    }
  }

  // 2. Connector: "Artist - Title" (e.g. "Coldplay - Yellow")
  const dashMatch = cleanQuery.match(/^(.+?)\s*-\s*(.+)$/i)
  if (dashMatch) {
    const artist = dashMatch[1].trim()
    const title = dashMatch[2].trim()
    return {
      title,
      artist,
      cleanQuery: `${artist} ${title}`,
      isCollaboration: /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(artist)
    }
  }

  const isCollaboration = /\b(?:feat\.?|ft\.?|&|\bwith\b|\bvs\.?\b)\b/i.test(cleanQuery)

  return {
    title: cleanQuery,
    artist: '',
    cleanQuery,
    isCollaboration
  }
}

/**
 * Parses a Soulseek or local file path into extracted artist, title, and album metadata.
 */
export function parseAudioFilePath(rawPath: string): { title: string; artist: string; album: string } {
  if (!rawPath) return { title: '', artist: '', album: '' }

  const normalized = rawPath.replace(/^@@/, '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const rawFileName = parts[parts.length - 1] || normalized
  const fileNameWithoutExt = rawFileName.replace(/\.[^.]+$/, '').trim()
  const cleanBase = fileNameWithoutExt.replace(TRACK_NUM_PREFIX_REGEX, '').trim()

  let title = cleanBase
  let artist = ''
  let album = ''

  // 1. Check if filename has "Artist - Title" format
  if (cleanBase.includes(' - ')) {
    const subParts = cleanBase.split(' - ').map((s) => s.trim()).filter(Boolean)
    if (subParts.length === 2) {
      artist = subParts[0]
      title = subParts[1]
    } else if (subParts.length >= 3) {
      // Could be TrackNum - Artist - Title or Artist - Album - Title
      artist = subParts[0]
      title = subParts[subParts.length - 1]
      album = subParts.slice(1, -1).join(' - ')
    }
  }

  // 2. If artist not in filename, derive from directory structure:
  // e.g. /Music/Artist/Album/01 - Title.flac or /Music/Artist - Album/01. Title.mp3
  if (!artist && parts.length > 1) {
    const parentFolder = parts[parts.length - 2]
    if (parentFolder.includes(' - ')) {
      const folderParts = parentFolder.split(' - ').map((s) => s.trim()).filter(Boolean)
      if (folderParts.length >= 2) {
        artist = folderParts[0]
        album = folderParts.slice(1).join(' - ')
      }
    } else if (parts.length > 2) {
      const grandParentFolder = parts[parts.length - 3]
      artist = grandParentFolder.replace(/^[0-9_.\s-]+/, '').trim()
      album = parentFolder.replace(/^[0-9_.\s-]+/, '').trim()
    } else {
      album = parentFolder
    }
  }

  // Clean trailing technical details like [FLAC], (2021 Remaster), [24bit-96kHz]
  title = title.replace(/\s*\[(?:flac|mp3|wav|24bit|16bit|lossless|cd|web)[^\]]*\]/gi, '').trim()
  album = album.replace(/\s*\[(?:flac|mp3|wav|24bit|16bit|lossless|cd|web)[^\]]*\]/gi, '').trim()

  const sanitized = sanitizeTrackMetadata({ title: title || cleanBase, artist, album })
  return {
    title: sanitized.title || cleanBase,
    artist: sanitized.artist,
    album: sanitized.album || ''
  }
}

function getWordTokens(text: string): Set<string> {
  const norm = normalizeForMatching(text)
  return new Set(norm.split(/\s+/).filter((word) => word.length >= 2))
}

function tokenSimilarity(a: string, b: string): number {
  const setA = getWordTokens(a)
  const setB = getWordTokens(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union > 0 ? intersection / union : 0
}

/**
 * Calculates normalized Levenshtein similarity between two strings (0.0 to 1.0).
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0

  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > Math.max(m, n) * 0.7) {
    return 0
  }

  let prev = new Array(n + 1)
  let curr = new Array(n + 1)

  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const charA = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const temp = prev
    prev = curr
    curr = temp
  }

  const distance = prev[n]
  const maxLen = Math.max(m, n)
  return maxLen === 0 ? 1 : Math.max(0, 1 - distance / maxLen)
}

export function parseDurationToSeconds(duration: string | number | undefined | null): number {
  if (!duration) return 0
  if (typeof duration === 'number') return Number.isFinite(duration) ? duration : 0
  const match = duration.match(/(?:(\d+):)?(\d{1,2}):(\d{2})/)
  if (!match) {
    const numeric = parseFloat(duration)
    return Number.isFinite(numeric) ? numeric : 0
  }
  const hours = match[1] ? parseInt(match[1], 10) : 0
  const minutes = parseInt(match[2], 10)
  const seconds = parseInt(match[3], 10)
  return hours * 3600 + minutes * 60 + seconds
}

export function findMatchingLibrarySong<T extends { title?: string; artist?: string; filePath?: string }>(
  targetTitle: string,
  targetArtist: string,
  librarySongs: T[]
): T | undefined {
  if (!librarySongs || librarySongs.length === 0) return undefined

  const normTargetTitle = normalizeForMatching(targetTitle)
  const normTargetArtist = normalizeForMatching(targetArtist)
  if (!normTargetTitle) return undefined

  const targetFull = normalizeForMatching(`${targetArtist} ${targetTitle}`)
  const targetFullRev = normalizeForMatching(`${targetTitle} ${targetArtist}`)

  return librarySongs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false

    const normLocalTitle = normalizeForMatching(song.title || '')
    const normLocalArtist = normalizeForMatching(song.artist || '')
    if (!normLocalTitle) return false

    // 1. Exact match on normalized title
    if (normLocalTitle === normTargetTitle) {
      if (!normTargetArtist || !normLocalArtist || normLocalArtist === normTargetArtist) {
        return true
      }
      if (normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist)) {
        return true
      }
    }

    // 2. Full combined string match (handles "Artist - Title" stored in title field)
    const localFull = normalizeForMatching(`${song.artist || ''} ${song.title || ''}`)
    const localFullRev = normalizeForMatching(`${song.title || ''} ${song.artist || ''}`)

    if (
      localFull === targetFull ||
      localFull === targetFullRev ||
      localFullRev === targetFull ||
      localFullRev === targetFullRev
    ) {
      return true
    }

    // 3. Substring match ONLY if artist strictly matches and target title is at least 4 characters
    if (normTargetTitle.length >= 4 && normLocalTitle.includes(normTargetTitle)) {
      const hasArtistMatch =
        normTargetArtist &&
        normLocalArtist &&
        (normTargetArtist === normLocalArtist ||
          normTargetArtist.includes(normLocalArtist) ||
          normLocalArtist.includes(normTargetArtist) ||
          normLocalTitle.includes(normTargetArtist))
      if (hasArtistMatch) {
        return true
      }
    }

    // 4. Reverse substring: target title contains local title (only with verified artist match)
    if (normLocalTitle.length >= 4 && normTargetTitle.includes(normLocalTitle)) {
      const hasArtistMatch =
        normTargetArtist &&
        normLocalArtist &&
        (normTargetArtist === normLocalArtist ||
          normTargetArtist.includes(normLocalArtist) ||
          normLocalArtist.includes(normTargetArtist) ||
          normTargetTitle.includes(normLocalArtist))
      if (hasArtistMatch) {
        return true
      }
    }

    return false
  })
}

export function isSongInLibrary(
  targetTitle: string,
  targetArtist: string,
  librarySongs: Array<{ title?: string; artist?: string; filePath?: string }>
): boolean {
  return Boolean(findMatchingLibrarySong(targetTitle, targetArtist, librarySongs))
}

export interface MatchScore {
  score: number
  confidence: 'Exact match' | 'High match' | 'Provider match' | 'Low match' | 'Mismatched'
  isAcceptable: boolean
  durationDelta?: number | null
  isStudioMatch?: boolean
  rejectReason?: string
}

const TRIBUTE_COVER_PATTERNS = [
  /\btribute\b/i,
  /\boriginally performed by\b/i,
  /\bin the style of\b/i,
  /\bmade famous by\b/i,
  /\bkaraoke version\b/i,
  /\bpiano tribute\b/i,
  /\bstring quartet tribute\b/i,
  /\bbacking track\b/i
]

export function cleanProviderArtist(artist?: string): string {
  if (!artist) return ''
  return artist
    .replace(/\s*-\s*topic\b/gi, '')
    .replace(/\bvevo\b/gi, '')
    .replace(/\s+official\s+(?:channel|artist\s+channel)?\b/gi, '')
    .replace(/\s*\((?:official|topic|audio)\)\s*$/gi, '')
    .trim()
}

export function scoreProviderMatch(
  target: { title: string; artist?: string; duration?: number | string | null },
  candidate: { title: string; artist?: string; meta?: string; description?: string; duration?: number | string | null }
): MatchScore {
  const normTargetTitle = normalizeForMatching(target.title)
  const normTargetArtist = normalizeForMatching(cleanProviderArtist(target.artist || ''))

  // Decompose candidate if candidate title embeds "Artist - Title"
  let candTitle = candidate.title
  let candArtist = cleanProviderArtist(candidate.artist || '')

  if (candTitle.includes(' - ') && (!candArtist || candArtist.startsWith('Peer:'))) {
    const sub = candTitle.split(' - ')
    if (sub.length === 2) {
      candArtist = cleanProviderArtist(sub[0].trim())
      candTitle = sub[1].trim()
    }
  }

  const normCandTitle = normalizeForMatching(candTitle)
  const normCandArtist = normalizeForMatching(candArtist)
  const candExtra = normalizeForMatching(`${candidate.meta || ''} ${candidate.description || ''}`)
  const rawCombinedCand = `${candidate.title} ${candidate.artist || ''} ${candidate.meta || ''} ${candidate.description || ''}`

  let score = 0
  let rejectReason: string | undefined

  // 0. Tribute / Cover / Karaoke fatal check
  for (const pattern of TRIBUTE_COVER_PATTERNS) {
    if (pattern.test(rawCombinedCand) && !pattern.test(target.title)) {
      return {
        score: 0,
        confidence: 'Mismatched',
        isAcceptable: false,
        rejectReason: 'Candidate is a tribute, cover, or karaoke recording'
      }
    }
  }

  // 1. Title & Query Similarity (up to 55 points)
  if (normTargetTitle) {
    if (normTargetTitle === normCandTitle) {
      score += 55
    } else {
      const tokenSim = tokenSimilarity(normTargetTitle, normCandTitle)
      const editSim = stringSimilarity(normTargetTitle, normCandTitle)
      let combinedSim = 0.4 * tokenSim + 0.6 * editSim

      // If target.artist was not provided, target.title may represent artist(s) or combined query
      if (!normTargetArtist) {
        const normCandCombined = `${normCandArtist} ${normCandTitle}`.trim()
        const combTokenSim = tokenSimilarity(normTargetTitle, normCandCombined)
        const combEditSim = stringSimilarity(normTargetTitle, normCandCombined)
        const combSim = 0.4 * combTokenSim + 0.6 * combEditSim

        // Calculate token coverage on combined candidate (with fuzzy word matching e.g. hussein/husein)
        const targetTokens = normTargetTitle.split(' ').filter(Boolean)
        const candWords = `${normCandCombined} ${candExtra}`.split(' ').filter(Boolean)
        const matchedCount = targetTokens.filter((token) =>
          candWords.some((w) => w === token || stringSimilarity(w, token) >= 0.75)
        ).length
        const tokenCoverage = targetTokens.length > 0 ? matchedCount / targetTokens.length : 0

        combinedSim = Math.max(combinedSim, combSim, tokenCoverage * 0.95)
      }

      if (normCandTitle.includes(normTargetTitle)) {
        score += Math.max(42, Math.round(combinedSim * 52))
      } else {
        score += Math.round(combinedSim * 48)
      }
    }
  }

  // 2. Artist Similarity (up to 35 points)
  if (normTargetArtist) {
    const isPeerArtist = normCandArtist.startsWith('peer') || normCandArtist.includes('soulseek')
    if (
      normCandArtist &&
      !isPeerArtist &&
      (normCandArtist === normTargetArtist ||
        normCandArtist.includes(normTargetArtist) ||
        normTargetArtist.includes(normCandArtist))
    ) {
      score += 35
    } else if (normCandTitle.includes(normTargetArtist) || candExtra.includes(normTargetArtist)) {
      score += 30
    } else if (normCandArtist && !isPeerArtist && normCandArtist !== 'youtube') {
      // Truly different musical artist
      score -= 45
      rejectReason = 'Different musical artist'
    } else {
      // Neutral if artist is unparsed peer or missing, but give partial points if title matched well
      score += 15
    }
  } else {
    // Freeform query without explicit target.artist: reward artist coverage from query tokens
    const targetTokens = normTargetTitle.split(' ').filter(Boolean)
    const candArtistWords = normCandArtist.split(' ').filter(Boolean)
    const matchedArtistCount = targetTokens.filter((token) =>
      candArtistWords.some((w) => w === token || stringSimilarity(w, token) >= 0.75)
    ).length
    if (matchedArtistCount > 0) {
      score += Math.min(35, 20 + matchedArtistCount * 8)
    } else {
      score += 20
    }
  }

  // 3. Strict Duration Penalty / Bonus
  const targetSeconds = parseDurationToSeconds(target.duration)
  const candDurationStr = candidate.meta?.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/)?.[1]
  const candSeconds = candidate.duration
    ? parseDurationToSeconds(candidate.duration)
    : candDurationStr
      ? parseDurationToSeconds(candDurationStr)
      : 0

  let durationDelta: number | null = null
  if (targetSeconds > 0 && candSeconds > 0) {
    durationDelta = Math.abs(targetSeconds - candSeconds)
    if (durationDelta <= 3) {
      score += 20
    } else if (durationDelta <= 8) {
      score += 15
    } else if (durationDelta <= 14) {
      score += 8
    } else if (durationDelta > 90) {
      score -= 90
      rejectReason = `Duration delta excessive (${durationDelta}s)`
    } else if (durationDelta > 35) {
      score -= 70
      rejectReason = `Duration delta high (${durationDelta}s)`
    } else if (durationDelta > 18) {
      score -= 40
      rejectReason = `Duration delta suspicious (${durationDelta}s)`
    }
  }

  // 4. Strict Version Alignment & Unwanted Cut Penalties
  let isStudioMatch = true
  const fullCandText = `${normCandTitle} ${normCandArtist} ${candExtra}`
  for (const kw of UNWANTED_VERSION_KEYWORDS) {
    const targetHasKw = normTargetTitle.includes(kw)
    const candHasKw = fullCandText.includes(kw)

    if (candHasKw && !targetHasKw) {
      const isFatalJunk = [
        'karaoke',
        'instrumental',
        'slowed',
        'reverb',
        'tribute',
        'parody',
        'reaction',
        'snippet',
        'teaser',
        'sped up',
        'nightcore',
        'bass boosted',
        'ringtone',
        'tutorial',
        'mashup'
      ].includes(kw)

      if (isFatalJunk) {
        score -= 65
        isStudioMatch = false
        rejectReason = `Candidate contains unwanted version tag "${kw}"`
      } else if (kw === 'live' || kw === 'acoustic') {
        // If query is freeform or candidate is an official session/acoustic cut, do not fatally reject
        const isSession = /\b(?:session|special live|studio live|colors|acoustic)\b/i.test(fullCandText)
        if (!normTargetArtist || isSession) {
          score -= 10
        } else {
          score -= 40
          isStudioMatch = false
          rejectReason = `Candidate contains unwanted version tag "${kw}"`
        }
      } else {
        score -= 30
        isStudioMatch = false
      }
    } else if (targetHasKw && candHasKw) {
      // Both specifically want this version (e.g. acoustic or remix)
      score += 20
    } else if (targetHasKw && !candHasKw) {
      // Target explicitly asked for remix/live, but candidate is regular
      score -= 35
      rejectReason = `Target requested "${kw}" version but candidate is regular`
    }
  }

  score = Math.max(0, Math.min(100, score))

  let confidence: MatchScore['confidence'] = 'Low match'
  if (score >= 85) confidence = 'Exact match'
  else if (score >= 70) confidence = 'High match'
  else if (score >= 60) confidence = 'Provider match'
  else if (score < 50) confidence = 'Mismatched'

  return {
    score,
    confidence,
    isAcceptable: score >= 60 && !rejectReason,
    durationDelta,
    isStudioMatch,
    rejectReason
  }
}

export function validateTrackIdentity(
  target: { title: string; artist?: string; duration?: number | string | null },
  candidate: { title: string; artist?: string; meta?: string; description?: string; duration?: number | string | null }
): { isValid: boolean; score: number; reason?: string } {
  const result = scoreProviderMatch(target, candidate)
  return {
    isValid: result.isAcceptable,
    score: result.score,
    reason: result.rejectReason
  }
}

