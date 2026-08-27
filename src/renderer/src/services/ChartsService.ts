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
      const items = data.feed?.results || []

      return items.map((item: any, index: number) => ({
        id: `apple-${item.id || index}`,
        title: item.name || 'Unknown Track',
        artist: item.artistName || 'Unknown Artist',
        album: item.collectionName || '',
        artworkUrl: (item.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        rank: index + 1,
        source: 'apple',
        externalUrl: item.url
      }))
    } catch (err) {
      console.warn(`Failed to fetch Apple Music charts for ${countryCode}:`, err)
      return []
    }
  }

  /**
   * Fetch Deezer Top tracks or Genre Top tracks via 100% free Deezer Public API.
   */
  static async fetchDeezerChart(genreId?: number, limit = 50): Promise<ChartTrack[]> {
    try {
      const url = genreId
        ? `https://api.deezer.com/editorial/${genreId}/charts?limit=${limit}`
        : `https://api.deezer.com/chart/0/tracks?limit=${limit}`

      const res = await fetch(url)
      if (!res.ok) throw new Error(`Deezer API error: ${res.statusText}`)

      const data = await res.json()
      const items = data.tracks?.data || data.data || []

      return items.slice(0, limit).map((item: any, index: number) => ({
        id: `deezer-${item.id}`,
        title: item.title || item.title_short || 'Unknown Track',
        artist: item.artist?.name || 'Unknown Artist',
        album: item.album?.title || '',
        artworkUrl: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || '',
        rank: index + 1,
        source: 'deezer',
        duration: item.duration,
        previewUrl: item.preview,
        externalUrl: item.link
      }))
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
