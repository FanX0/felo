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
  source: 'apple' | 'deezer' | 'genre'
  countryCode?: string
  genreId?: number
  icon?: string
}

export const CHART_CATEGORIES: ChartCategory[] = [
  // Top Country Charts
  { id: 'apple-global', name: 'Global Top 50', source: 'apple', countryCode: 'us', icon: '🌎' },
  { id: 'apple-id', name: 'Indonesia Top 50', source: 'apple', countryCode: 'id', icon: '🇮🇩' },
  { id: 'apple-us', name: 'USA Top 50', source: 'apple', countryCode: 'us', icon: '🇺🇸' },
  { id: 'apple-gb', name: 'UK Top 50', source: 'apple', countryCode: 'gb', icon: '🇬🇧' },
  { id: 'apple-jp', name: 'Japan Top 50', source: 'apple', countryCode: 'jp', icon: '🇯🇵' },
  { id: 'apple-kr', name: 'South Korea Top 50', source: 'apple', countryCode: 'kr', icon: '🇰🇷' },

  // Genre Charts
  { id: 'deezer-pop', name: 'Pop Hits', source: 'genre', genreId: 14, icon: '🎤' },
  { id: 'deezer-rap', name: 'Hip-Hop / Rap', source: 'genre', genreId: 18, icon: '🎧' },
  { id: 'deezer-dance', name: 'Dance & EDM', source: 'genre', genreId: 17, icon: '⚡' },
  { id: 'deezer-rock', name: 'Rock Classics', source: 'genre', genreId: 21, icon: '🎸' },
  { id: 'deezer-rnb', name: 'R&B / Soul', source: 'genre', genreId: 15, icon: '💜' },
  { id: 'deezer-latin', name: 'Latin Music', source: 'genre', genreId: 12, icon: '🌴' }
]

/** Source suffixes that may appear in track titles downloaded via streaming services. */
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

function upgradeArtwork(url?: string): string | undefined {
  if (!url) return undefined
  return url
    .replace(/\/\d+x\d+bb\./, '/600x600bb.')
    .replace(/\/\d+x\d+-\d+\./, '/600x600-000000-80-0-0.')
    .replace(/100x100bb/, '600x600bb')
}

export class ChartsService {
  /**
   * Fetch Apple Music country top songs via official fast iTunes RSS feed with fallbacks.
   */
  static async fetchAppleMusicTopSongs(countryCode = 'us', limit = 50, genreId?: number): Promise<ChartTrack[]> {
    const code = (countryCode || 'us').toLowerCase()
    const urls = genreId
      ? [
          `https://itunes.apple.com/${code}/rss/topsongs/limit=${limit}/genre=${genreId}/json`,
          `https://itunes.apple.com/us/rss/topsongs/limit=${limit}/genre=${genreId}/json`
        ]
      : [
          `https://itunes.apple.com/${code}/rss/topsongs/limit=${limit}/json`,
          `https://rss.applemarketingtools.com/api/v2/${code}/music/most-played/${limit}/songs.json`,
          `https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`
        ]

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) continue

        const data = await res.json()

        // Handle itunes.apple.com feed
        if (data?.feed?.entry) {
          const entries: any[] = Array.isArray(data.feed.entry) ? data.feed.entry : [data.feed.entry]
          if (entries.length > 0) {
            return entries.slice(0, limit).map((entry, index) => {
              const rawTitle = (entry?.['im:name']?.label || entry?.title?.label || '') as string
              const rawArtist = (entry?.['im:artist']?.label || '') as string
              const artist = resolveArtist(rawArtist, rawTitle)
              const title = resolveTitle(rawTitle, artist)
              const rawImages = entry?.['im:image'] || []
              const rawArtwork = rawImages[rawImages.length - 1]?.label
              const albumName = entry?.['im:collection']?.['im:name']?.label || ''

              return {
                id: entry?.id?.attributes?.['im:id'] ? `apple-${entry.id.attributes['im:id']}` : `apple-${code}-${index}`,
                title: title || 'Unknown Track',
                artist,
                album: stripSourceSuffix(albumName),
                artworkUrl: upgradeArtwork(rawArtwork),
                rank: index + 1,
                source: 'apple' as const,
                externalUrl: entry?.link?.[0]?.attributes?.href
              }
            })
          }
        }

        // Handle applemarketingtools feed
        if (data?.feed?.results && Array.isArray(data.feed.results)) {
          const items: any[] = data.feed.results
          if (items.length > 0) {
            return items.slice(0, limit).map((item, index) => {
              const rawTitle = (item.name as string) || ''
              const artist = resolveArtist(item.artistName, rawTitle)
              const title = resolveTitle(rawTitle, artist)
              const artworkRaw: string = item.artworkUrl100 || ''

              return {
                id: `apple-${(item.id as string | number) || index}`,
                title: title || 'Unknown Track',
                artist,
                album: stripSourceSuffix((item.collectionName as string) || ''),
                artworkUrl: upgradeArtwork(artworkRaw),
                rank: index + 1,
                source: 'apple' as const,
                externalUrl: item.url as string | undefined
              }
            })
          }
        }
      } catch (err) {
        console.warn(`Chart fetch attempt failed for ${url}:`, err)
      }
    }

    return []
  }

  /**
   * Fetch Deezer Top tracks or Genre Top tracks.
   */
  static async fetchDeezerChart(genreId?: number, limit = 50): Promise<ChartTrack[]> {
    try {
      const url = genreId
        ? `https://api.deezer.com/editorial/${genreId}/charts?limit=${limit}`
        : `https://api.deezer.com/chart/0/tracks?limit=${limit}`

      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const items: any[] = data.tracks?.data || data.data || []

        if (items.length > 0) {
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
        }
      }
    } catch {
      // Deezer API might be restricted by CORS in browser, fall back to iTunes
    }

    // Fallback to genre on iTunes if Deezer is unreachable
    if (genreId) {
      return this.fetchAppleMusicTopSongs('us', limit, genreId)
    }

    return this.fetchAppleMusicTopSongs('us', limit)
  }

  /**
   * Fetch charts based on selected Category.
   */
  static async fetchCategoryTracks(category: ChartCategory, limit = 50): Promise<ChartTrack[]> {
    if (category.source === 'genre' && category.genreId) {
      return this.fetchAppleMusicTopSongs(category.countryCode || 'us', limit, category.genreId)
    }
    if (category.source === 'deezer') {
      return this.fetchDeezerChart(category.genreId, limit)
    }
    return this.fetchAppleMusicTopSongs(category.countryCode || 'us', limit)
  }
}
