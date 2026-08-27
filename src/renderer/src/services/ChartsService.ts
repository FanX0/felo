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

export type AppleChartSection = 'all' | 'charts' | 'pop' | 'hiphop' | 'rock' | 'alternative' | 'electronic' | 'rnb' | 'genres'

export interface ChartCategory {
  id: string
  name: string
  section: AppleChartSection
  source: 'apple' | 'deezer' | 'genre'
  countryCode?: string
  genreId?: number
  icon?: string
  description?: string
  badge?: string
  coverUrl?: string
}

export const CHART_CATEGORIES: ChartCategory[] = [
  // Top Charts
  {
    id: 'apple-global',
    name: 'Top 100: Global',
    section: 'charts',
    source: 'apple',
    countryCode: 'us',
    icon: '🌎',
    description: 'The most played songs around the world today.',
    badge: 'Global #1',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-us',
    name: 'Top 100: USA',
    section: 'charts',
    source: 'apple',
    countryCode: 'us',
    icon: '🇺🇸',
    description: 'The most popular songs across the United States.',
    badge: 'USA Top',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-gb',
    name: 'Top 100: UK',
    section: 'charts',
    source: 'apple',
    countryCode: 'gb',
    icon: '🇬🇧',
    description: 'The biggest songs right now in the United Kingdom.',
    badge: 'UK Official',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-id',
    name: 'Top 100: Indonesia',
    section: 'charts',
    source: 'apple',
    countryCode: 'id',
    icon: '🇮🇩',
    description: 'Daily updated top tracks across Indonesia.',
    badge: 'Indonesia',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/0d/16/e0/0d16e0b7-4b72-f1df-29bb-432d6fb601ab/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-jp',
    name: 'Top 100: Japan',
    section: 'charts',
    source: 'apple',
    countryCode: 'jp',
    icon: '🇯🇵',
    description: 'Top anime, J-Pop and viral tracks in Japan.',
    badge: 'Japan',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/df/e3/37/dfe337e7-37fb-a1e4-8025-a13cb244e83f/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-kr',
    name: 'Top 100: South Korea',
    section: 'charts',
    source: 'apple',
    countryCode: 'kr',
    icon: '🇰🇷',
    description: 'The most streamed K-Pop and local hits in South Korea.',
    badge: 'K-Charts',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d5/43/e7/d543e742-b062-8418-5a21-987819ea2bcf/artwork.jpg/600x600bb.jpg'
  },

  // Pop
  {
    id: 'apple-pop',
    name: "Today's Pop Hits",
    section: 'pop',
    source: 'genre',
    genreId: 14,
    icon: '🎤',
    description: 'The biggest pop anthems and chart toppers right now.',
    badge: 'Pop Heavy',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-pop-gold',
    name: 'Pop Essentials',
    section: 'pop',
    source: 'genre',
    genreId: 14,
    countryCode: 'gb',
    icon: '✨',
    description: 'Essential modern pop hits from global superstars.',
    badge: 'Essential',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/58/b7/66/58b76615-df72-ad9d-9f44-1294208a0d91/23UM1IM05322.rgb.jpg/600x600bb.jpg'
  },

  // Hip-Hop
  {
    id: 'apple-rap',
    name: 'Hip-Hop / Rap Top 100',
    section: 'hiphop',
    source: 'genre',
    genreId: 18,
    icon: '🎧',
    description: 'The definitive sound of modern hip-hop and rap culture.',
    badge: 'Rap Life',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-trap',
    name: 'Heavy Trap & Beats',
    section: 'hiphop',
    source: 'genre',
    genreId: 18,
    countryCode: 'us',
    icon: '🔥',
    description: 'Hard-hitting 808s, street anthems and trap bangers.',
    badge: 'Bangers',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/d5/43/d8/d543d839-a931-419b-c2e5-397cfb5ebcb0/196872583856.jpg/600x600bb.jpg'
  },

  // Rock
  {
    id: 'apple-rock',
    name: 'Rock Classics & Modern',
    section: 'rock',
    source: 'genre',
    genreId: 21,
    icon: '🎸',
    description: 'Riffs, powerhouse vocals, and landmark rock tracks.',
    badge: 'Rock Anthem',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/94/a3/0894a38e-bc5d-6c1f-4d9a-c9a96e95c1c8/886445593892.jpg/600x600bb.jpg'
  },

  // Alternative
  {
    id: 'apple-alt',
    name: 'Alt-Ctrl & Indie Waves',
    section: 'alternative',
    source: 'genre',
    genreId: 20,
    icon: '🌀',
    description: 'Fresh alternative cuts, dream pop, and indie gold.',
    badge: 'Alt Hits',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5c/41/51/5c415174-8d48-6a3f-1d89-b5055047bca8/198391583091.jpg/600x600bb.jpg'
  },

  // Electronic / Dance
  {
    id: 'apple-dance',
    name: 'Dance & Electronic Top',
    section: 'electronic',
    source: 'genre',
    genreId: 17,
    icon: '⚡',
    description: 'Peak-time festival anthems, house, and club bangers.',
    badge: 'Club Room',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/21/53/78/2153782b-8a8b-f4d0-c3d5-e9b46e38b34f/0724384960650.jpg/600x600bb.jpg'
  },

  // R&B / Soul
  {
    id: 'apple-rnb',
    name: 'R&B / Soul Now',
    section: 'rnb',
    source: 'genre',
    genreId: 15,
    icon: '💜',
    description: 'Smooth vocals, midnight grooves, and contemporary soul.',
    badge: 'Smooth',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/e5/2a/ade52a22-2615-5e6a-3a21-9e7ca8565ec1/859717909386_cover.jpg/600x600bb.jpg'
  },

  // Other Genres
  {
    id: 'apple-kpop',
    name: 'K-Pop Today',
    section: 'genres',
    source: 'genre',
    genreId: 51,
    icon: '🌟',
    description: 'The top chart-topping hits from Korean superstars.',
    badge: 'K-Pop',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/58/63/12/58631248-cb58-2940-d9d8-9477eb372767/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-latin',
    name: 'Latin Fire Top Hits',
    section: 'genres',
    source: 'genre',
    genreId: 12,
    icon: '🌴',
    description: 'Reggaeton, urbano, and the biggest Latin chart hits.',
    badge: 'Fuego',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM48911.rgb.jpg/600x600bb.jpg'
  },
  {
    id: 'apple-country',
    name: 'Country Hits USA',
    section: 'genres',
    source: 'genre',
    genreId: 6,
    icon: '🤠',
    description: 'Today’s chart-topping country music stories and melodies.',
    badge: 'Country',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg'
  }
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
