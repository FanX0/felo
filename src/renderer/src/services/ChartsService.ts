export interface ChartTrack {
  id: string
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  rank: number
  source: 'apple' | 'deezer' | 'shazam' | 'lastfm'
  duration?: number
  previewUrl?: string
  externalUrl?: string
}

export interface ChartCategory {
  id: string
  name: string
  source: 'apple' | 'deezer' | 'shazam'
  countryCode?: string
  genreId?: number
  icon?: string
}

export const CHART_CATEGORIES: ChartCategory[] = [
  // Apple Music Country Charts
  { id: 'apple-global', name: 'Apple Music Global Top 50', source: 'apple', countryCode: 'us', icon: '🌎' },
  { id: 'apple-id', name: 'Apple Music Indonesia Top 50', source: 'apple', countryCode: 'id', icon: '🇮🇩' },
  { id: 'apple-us', name: 'Apple Music USA Top 50', source: 'apple', countryCode: 'us', icon: '🇺🇸' },
  { id: 'apple-gb', name: 'Apple Music UK Top 50', source: 'apple', countryCode: 'gb', icon: '🇬🇧' },
  { id: 'apple-jp', name: 'Apple Music Japan Top 50', source: 'apple', countryCode: 'jp', icon: '🇯🇵' },
  { id: 'apple-kr', name: 'Apple Music South Korea Top 50', source: 'apple', countryCode: 'kr', icon: '🇰🇷' },

  // Deezer Live Charts & Genres
  { id: 'deezer-global', name: 'Deezer Top 50 Global', source: 'deezer', icon: '🔥' },
  { id: 'deezer-pop', name: 'Deezer Pop Hits', source: 'deezer', genreId: 132, icon: '🎤' },
  { id: 'deezer-rap', name: 'Deezer Hip-Hop / Rap', source: 'deezer', genreId: 116, icon: '🎧' },
  { id: 'deezer-dance', name: 'Deezer Dance & EDM', source: 'deezer', genreId: 113, icon: '⚡' },
  { id: 'deezer-rock', name: 'Deezer Rock Classics', source: 'deezer', genreId: 152, icon: '🎸' },
  { id: 'deezer-rnb', name: 'Deezer R&B / Soul', source: 'deezer', genreId: 165, icon: '💜' },
  { id: 'deezer-latin', name: 'Deezer Latin Music', source: 'deezer', genreId: 197, icon: '🌴' }
]

/** Source suffixes that may appear in track titles downloaded via Felo or streaming services. */
const SOURCE_SUFFIX_RE = /\s*\(\s*(?:qobuz|deezer|tidal|youtube|youtube music|soundcloud|spotify|apple music)\s*\)\s*$/i

/**
 * Strip known source suffixes like "(Qobuz)" or "(Deezer)" from a title string.
 */
export function stripSourceSuffix(str: string): string {
  return str.replace(SOURCE_SUFFIX_RE, '').trim()
}

/**
 * Try to extract { artist, title } from a raw title that may be in "Artist - Title" format.
 * Returns null if no clear split is found (i.e. no " - " present).
 */
export function parseArtistFromTitle(rawTitle: string): { artist: string; title: string } | null {
  const clean = stripSourceSuffix(rawTitle)
  const separatorIdx = clean.indexOf(' - ')
  if (separatorIdx <= 0) return null

  const maybeArtist = clean.slice(0, separatorIdx).trim()
  const maybeTitle = clean.slice(separatorIdx + 3).trim()

  // Sanity: artist part should be <= 60 chars and not contain another separator
  if (!maybeArtist || !maybeTitle || maybeArtist.length > 60) return null

  return { artist: maybeArtist, title: maybeTitle }
}

/**
 * Resolve best artist string. Falls back to parsing the title if the
 * provided artist is empty, null, or a generic placeholder.
 */
export function resolveArtist(rawArtist: string | undefined | null, rawTitle: string): string {
  const cleaned = (rawArtist || '').trim()
  const isUnknown =
    !cleaned ||
    cleaned.toLowerCase() === 'unknown artist' ||
    cleaned.toLowerCase() === 'unknown' ||
    cleaned === '-'

  if (!isUnknown) return cleaned

  const parsed = parseArtistFromTitle(rawTitle)
  return parsed ? parsed.artist : 'Unknown Artist'
}

/**
 * Resolve best title string, stripping source suffix and optionally
 * stripping the artist prefix if it was embedded.
 */
export function resolveTitle(rawTitle: string, resolvedArtist: string): string {
  const clean = stripSourceSuffix(rawTitle)
  // If the title starts with "Artist - ", strip the artist prefix to get a clean title
  const prefix = `${resolvedArtist} - `
  if (clean.startsWith(prefix)) {
    return clean.slice(prefix.length).trim()
  }
  return clean
}

export class ChartsService {
  /**
   * Fetch Apple Music country top songs via official 100% free RSS feed.
   */
  static async fetchAppleMusicTopSongs(countryCode = 'us', limit = 50): Promise<ChartTrack[]> {
    try {
      const code = countryCode.toLowerCase()
      const url = `https://rss.applemarketingtools.com/api/v2/${code}/music/most-played/${limit}/songs.json`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Apple Music RSS error: ${res.statusText}`)

      const data = await res.json()
      const items: any[] = data.feed?.results || []

      return items.map((item, index) => {
        const rawTitle = (item.name as string) || ''
        const artist = resolveArtist(item.artistName, rawTitle)
        const title = resolveTitle(rawTitle, artist)
        const artworkRaw: string = item.artworkUrl100 || ''

        return {
          id: `apple-${(item.id as string | number) || index}`,
          title: title || 'Unknown Track',
          artist,
          album: (item.collectionName as string) || '',
          artworkUrl: artworkRaw.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
          rank: index + 1,
          source: 'apple' as const,
          externalUrl: item.url as string | undefined
        }
      })
    } catch (err) {
      console.warn(`Failed to fetch Apple Music charts for ${countryCode}:`, err)
      return []
    }
  }

  /**
   * Fetch Deezer Top tracks or Genre Top tracks via 100% free Deezer Public API.
   * Deezer always returns a proper artist object, so Unknown Artist here means
   * the API truly has no artist — we fall back to title parsing as a last resort.
   */
  static async fetchDeezerChart(genreId?: number, limit = 50): Promise<ChartTrack[]> {
    try {
      const url = genreId
        ? `https://api.deezer.com/editorial/${genreId}/charts?limit=${limit}`
        : `https://api.deezer.com/chart/0/tracks?limit=${limit}`

      const res = await fetch(url)
      if (!res.ok) throw new Error(`Deezer API error: ${res.statusText}`)

      const data = await res.json()
      const items: any[] = data.tracks?.data || data.data || []

      return items.slice(0, limit).map((item, index) => {
        const rawTitle = (item.title || item.title_short || '') as string
        const artist = resolveArtist(item.artist?.name, rawTitle)
        const title = resolveTitle(rawTitle, artist)

        return {
          id: `deezer-${item.id as number}`,
          title: title || 'Unknown Track',
          artist,
          album: (item.album?.title as string) || '',
          artworkUrl: (item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || '') as string,
          rank: index + 1,
          source: 'deezer' as const,
          duration: item.duration as number | undefined,
          previewUrl: item.preview as string | undefined,
          externalUrl: item.link as string | undefined
        }
      })
    } catch (err) {
      console.warn('Failed to fetch Deezer charts:', err)
      return []
    }
  }

  /**
   * Fetch charts based on selected Category.
   */
  static async fetchCategoryTracks(category: ChartCategory, limit = 50): Promise<ChartTrack[]> {
    if (category.source === 'apple') {
      return this.fetchAppleMusicTopSongs(category.countryCode || 'us', limit)
    }
    if (category.source === 'deezer') {
      return this.fetchDeezerChart(category.genreId, limit)
    }
    return []
  }
}
