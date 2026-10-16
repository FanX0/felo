import { app, ipcMain, net } from 'electron'
import { getDb } from '../database'

export interface AppleMusicSearchItem {
  id: string
  title: string
  artist: string
  album: string
  type: string
  duration: string | null
  trackCount: number | null
  url: string
  thumbnail: string
  explicit: boolean
}

export type AppleMusicSearchResults = Record<
  'Top Results' | 'Artists' | 'Albums' | 'Songs',
  AppleMusicSearchItem[]
>

export type MusicBrainzSearchResults = AppleMusicSearchResults

export type LastFmSearchResults = AppleMusicSearchResults

export type MusicBrainzMappedItem = AppleMusicSearchItem & {
  releaseId?: string
  releaseGroupId?: string
}

export interface LastFmChartItem {
  id: string
  title: string
  artist: string
  type: 'track' | 'artist'
  playcount?: string
  listeners?: string
  artworkUrl?: string
  url?: string
  rank: number
}

export function lastFmImage(images: unknown): string {
  if (!Array.isArray(images)) return ''
  const preferred = ['extralarge', 'large', 'medium', 'small']
  for (const size of preferred) {
    const image = images.find((item: any) => item?.size === size)?.['#text']
    if (typeof image === 'string' && image.trim()) {
      return image.trim().replace(/^http:\/\//i, 'https://')
    }
  }
  return ''
}

export function formatAppleDuration(milliseconds: unknown): string | null {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return null
  const totalSeconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function appleArtworkUrl(item: any): string {
  const template = item?.artwork?.dictionary?.url
  if (typeof template !== 'string') return ''
  return template
    .replaceAll('{w}', '600')
    .replaceAll('{h}', '600')
    .replaceAll('{c}', 'bb')
    .replaceAll('{f}', 'jpg')
}

export function appleLinkedTitles(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  return links
    .map((link) => (typeof link?.title === 'string' ? link.title.trim() : ''))
    .filter(Boolean)
}

export function formatAppleMusicItem(item: any, index: number): AppleMusicSearchItem {
  const titleLinks = appleLinkedTitles(item?.titleLinks)
  const subtitleLinks = appleLinkedTitles(item?.subtitleLinks)
  const tertiaryLinks = appleLinkedTitles(item?.tertiaryLinks)
  const kind = item?.contentDescriptor?.kind || item?.itemKind || 'item'
  const type = String(kind)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
  const url = item?.contentDescriptor?.url

  return {
    id: String(item?.id || url || `${type}-${index}`),
    title: String(item?.title || titleLinks[0] || item?.headline || 'Unknown'),
    artist: String(item?.subtitle || subtitleLinks.join(', ') || ''),
    album: String(tertiaryLinks[0] || ''),
    type,
    duration: formatAppleDuration(item?.duration),
    trackCount: typeof item?.trackCount === 'number' ? item.trackCount : null,
    url: typeof url === 'string' ? url : '',
    thumbnail: appleArtworkUrl(item),
    explicit: Boolean(item?.showExplicitBadge)
  }
}

export function normalizeCatalogString(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function catalogArtistMatches(candidate: string, target: string): boolean {
  const candidateParts = candidate
    .replace(/\b(feat|ft|featuring)\.?\b/gi, ',')
    .split(/,|&|\+| x | × | and /i)
    .map(normalizeCatalogString)
    .filter(Boolean)
  const targetParts = target
    .replace(/\b(feat|ft|featuring)\.?\b/gi, ',')
    .split(/,|&|\+| x | × | and /i)
    .map(normalizeCatalogString)
    .filter(Boolean)

  return candidateParts.some((candidatePart) =>
    targetParts.some(
      (targetPart) =>
        candidatePart === targetPart ||
        candidatePart.includes(targetPart) ||
        targetPart.includes(candidatePart)
    )
  )
}

export function formatItunesSong(item: any, index: number): AppleMusicSearchItem | null {
  if (item?.wrapperType !== 'track' || item?.kind !== 'song') return null

  return {
    id: String(item.trackId || `${item.trackName}-${index}`),
    title: String(item.trackName || 'Unknown Track'),
    artist: String(item.artistName || ''),
    album: String(item.collectionName || ''),
    type: 'Song',
    duration: formatAppleDuration(item.trackTimeMillis),
    trackCount: typeof item.trackCount === 'number' ? item.trackCount : null,
    url: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : '',
    thumbnail:
      typeof item.artworkUrl100 === 'string'
        ? item.artworkUrl100.replace('100x100bb', '600x600bb')
        : '',
    explicit: item.trackExplicitness === 'explicit'
  }
}

export async function fetchItunesJson(url: string): Promise<any> {
  const response = await net.fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  })
  if (!response.ok) throw new Error(`Apple catalog fetch failed (${response.status})`)
  return response.json()
}

export async function fetchFallbackArtwork(query: string): Promise<AppleMusicSearchItem[]> {
  try {
    const response = await fetchItunesJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=50&country=US`
    )
    return (response?.results || [])
      .map(formatItunesSong)
      .filter((item: AppleMusicSearchItem | null): item is AppleMusicSearchItem =>
        Boolean(item?.thumbnail)
      )
  } catch {
    return []
  }
}

export async function searchAppleMusicArtistSongs(artistName: string): Promise<AppleMusicSearchItem[]> {
  const cleanArtist = artistName.trim()
  if (!cleanArtist) return []

  const encodedArtist = encodeURIComponent(cleanArtist)
  const allSongs: AppleMusicSearchItem[] = []

  try {
    const artistSearch = await fetchItunesJson(
      `https://itunes.apple.com/search?term=${encodedArtist}&entity=musicArtist&attribute=artistTerm&limit=10`
    )
    const artistIds = (artistSearch?.results || [])
      .filter((item: any) => catalogArtistMatches(String(item.artistName || ''), cleanArtist))
      .map((item: any) => item.artistId)
      .filter((id: unknown) => typeof id === 'number')
      .slice(0, 3)

    for (const artistId of artistIds) {
      const lookup = await fetchItunesJson(
        `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=200`
      )
      ;(lookup?.results || []).forEach((item: any, index: number) => {
        const song = formatItunesSong(item, index)
        if (song && catalogArtistMatches(song.artist, cleanArtist)) allSongs.push(song)
      })
    }
  } catch (err) {
    console.warn('Apple artist lookup failed:', err)
  }

  try {
    const songSearch = await fetchItunesJson(
      `https://itunes.apple.com/search?term=${encodedArtist}&entity=song&attribute=artistTerm&limit=200`
    )
    ;(songSearch?.results || []).forEach((item: any, index: number) => {
      const song = formatItunesSong(item, index)
      if (song && catalogArtistMatches(song.artist, cleanArtist)) allSongs.push(song)
    })
  } catch (err) {
    console.warn('Apple artist song search failed:', err)
  }

  const seen = new Set<string>()
  return allSongs.filter((song) => {
    const key =
      song.id ||
      `${normalizeCatalogString(song.title)}::${normalizeCatalogString(song.artist)}::${normalizeCatalogString(song.album)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function searchAppleMusicItunes(query: string): Promise<AppleMusicSearchResults> {
  const response = await fetchItunesJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query.trim())}&media=music&entity=song&limit=50&country=US`
  )
  const songs: AppleMusicSearchItem[] = (response?.results || [])
    .map(formatItunesSong)
    .filter((item: AppleMusicSearchItem | null): item is AppleMusicSearchItem => Boolean(item))
  const artists = Array.from(
    new Map<string, AppleMusicSearchItem>(songs.map((song) => [song.artist, song])).values()
  ).map((song) => ({
    ...song,
    id: `artist-${song.artist}`,
    title: song.artist,
    artist: 'Artist',
    album: '',
    type: 'Artist',
    duration: null,
    trackCount: null,
    url: `https://music.apple.com/us/search?term=${encodeURIComponent(song.artist)}`,
    thumbnail: ''
  }))
  const albums = Array.from(
    new Map<string, AppleMusicSearchItem>(
      songs.map((song) => [`${song.artist}-${song.album}`, song])
    ).values()
  )
    .filter((song) => song.album)
    .map((song) => ({
      ...song,
      id: `album-${song.artist}-${song.album}`,
      title: song.album,
      type: 'Album'
    }))
  return { 'Top Results': songs.slice(0, 1), Songs: songs, Artists: artists, Albums: albums }
}

export async function searchAppleMusic(query: string): Promise<AppleMusicSearchResults> {
  const emptyResults: AppleMusicSearchResults = {
    'Top Results': [],
    Artists: [],
    Albums: [],
    Songs: []
  }
  const response = await net.fetch(
    `https://music.apple.com/us/search?term=${encodeURIComponent(query.trim())}`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Apple Music search failed (${response.status})`)
  }

  const html = await response.text()
  const scriptMatch = html.match(
    /<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (!scriptMatch?.[1]) throw new Error('Apple Music returned no search data')

  const serialized = JSON.parse(scriptMatch[1])
  const page = Array.isArray(serialized)
    ? serialized[0]
    : Array.isArray(serialized?.data)
      ? serialized.data[0]
      : serialized
  const sections = page?.data?.sections
  if (!Array.isArray(sections)) return emptyResults

  for (const section of sections) {
    const header = section?.header?.item
    const sectionTitle = header?.titleLink?.title || header?.title
    if (!(sectionTitle in emptyResults) || !Array.isArray(section?.items)) continue
    emptyResults[sectionTitle as keyof AppleMusicSearchResults] =
      section.items.map(formatAppleMusicItem)
  }

  return emptyResults
}

export async function fetchLastFmSearchArtwork(query: string): Promise<Map<string, string>> {
  const artwork = new Map<string, string>()
  try {
    const response = await net.fetch(`https://www.last.fm/search?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    })
    if (!response.ok) return artwork
    const html = await response.text()
    const trackPattern =
      /<tr[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?data-track-name="([^"]+)"[\s\S]*?data-artist-name="([^"]+)"/gi
    let match: RegExpExecArray | null
    while ((match = trackPattern.exec(html)) !== null) {
      const key = `${match[2].trim().toLowerCase()}::${match[3].trim().toLowerCase()}`
      artwork.set(key, match[1].replace(/&amp;/g, '&').replace(/^http:\/\//i, 'https://'))
    }
  } catch (error) {
    console.warn('Last.fm artwork enrichment failed:', error)
  }
  return artwork
}

export async function searchLastFm(query: string, apiKey: string): Promise<LastFmSearchResults> {
  const emptyResults: LastFmSearchResults = {
    'Top Results': [],
    Artists: [],
    Albums: [],
    Songs: []
  }
  const cleanQuery = query.trim()
  if (!cleanQuery) return emptyResults
  if (!apiKey.trim()) {
    throw new Error('Last.fm API key is not configured. Add one in Settings.')
  }

  const request = async (method: string, params: Record<string, string>) => {
    const searchParams = new URLSearchParams({
      method,
      api_key: apiKey.trim(),
      format: 'json',
      limit: '25',
      ...params
    })
    const response = await net.fetch(`https://ws.audioscrobbler.com/2.0/?${searchParams}`)
    if (!response.ok) throw new Error(`Last.fm search failed (${response.status})`)
    const data = (await response.json()) as any
    if (data?.error) throw new Error(`Last.fm: ${data.message || 'request failed'}`)
    return data
  }

  const [tracks, artists, albums] = await Promise.all([
    request('track.search', { track: cleanQuery }),
    request('artist.search', { artist: cleanQuery }),
    request('album.search', { album: cleanQuery })
  ])

  const songs = (tracks?.results?.trackmatches?.track || []).map((item: any, index: number) => ({
    id: `lastfm-track-${item.mbid || `${item.artist}-${item.name}-${index}`}`,
    title: String(item.name || 'Unknown Track'),
    artist: String(item.artist || ''),
    album: '',
    type: 'Song',
    duration: null,
    trackCount: null,
    url: String(item.url || ''),
    thumbnail: lastFmImage(item.image),
    explicit: false
  }))
  const artistItems = (artists?.results?.artistmatches?.artist || []).map(
    (item: any, index: number) => ({
      id: `lastfm-artist-${item.mbid || `${item.name}-${index}`}`,
      title: String(item.name || 'Unknown Artist'),
      artist: 'Last.fm Artist',
      album: '',
      type: 'Artist',
      duration: null,
      trackCount: null,
      url: String(item.url || ''),
      thumbnail: lastFmImage(item.image),
      explicit: false
    })
  )
  const albumItems = (albums?.results?.albummatches?.album || []).map(
    (item: any, index: number) => ({
      id: `lastfm-album-${item.mbid || `${item.artist}-${item.name}-${index}`}`,
      title: String(item.name || 'Unknown Album'),
      artist: String(item.artist || ''),
      album: 'Album',
      type: 'Album',
      duration: null,
      trackCount: null,
      url: String(item.url || ''),
      thumbnail: lastFmImage(item.image),
      explicit: false
    })
  )

  const pageArtwork = await fetchLastFmSearchArtwork(cleanQuery)
  const fallbackArtwork = await fetchFallbackArtwork(cleanQuery)
  const matchingArtwork = (title: string, artist: string, album = '') => {
    const titleKey = title.toLowerCase()
    const artistKey = artist.toLowerCase()
    const pageImage = pageArtwork.get(`${titleKey}::${artistKey}`)
    if (pageImage) return pageImage
    const exact = fallbackArtwork.find(
      (item) => item.title.toLowerCase() === titleKey && item.artist.toLowerCase() === artistKey
    )
    const albumMatch = fallbackArtwork.find(
      (item) =>
        item.album.toLowerCase() === album.toLowerCase() && item.artist.toLowerCase() === artistKey
    )
    return exact?.thumbnail || albumMatch?.thumbnail || ''
  }
  songs.forEach((song: AppleMusicSearchItem) => {
    if (!song.thumbnail) song.thumbnail = matchingArtwork(song.title, song.artist)
  })
  artistItems.forEach((artist: AppleMusicSearchItem) => {
    if (!artist.thumbnail) {
      const match = fallbackArtwork.find(
        (item) => item.artist.toLowerCase() === artist.title.toLowerCase()
      )
      artist.thumbnail = match?.thumbnail || ''
    }
  })
  albumItems.forEach((album: AppleMusicSearchItem) => {
    if (!album.thumbnail) album.thumbnail = matchingArtwork(album.title, album.artist, album.title)
  })

  return {
    'Top Results': [...songs, ...artistItems, ...albumItems].slice(0, 5),
    Artists: artistItems,
    Albums: albumItems,
    Songs: songs
  }
}

export async function fetchLastFmChartData(
  category = 'tracks',
  tag = '',
  apiKey = 'b25b959554ed76058ac220b7b2e0a026'
): Promise<LastFmChartItem[]> {
  try {
    let method = 'chart.gettoptracks'
    const extraParams: Record<string, string> = { limit: '30' }

    if (category === 'artists' || category === 'top-artists') {
      method = 'chart.gettopartists'
    } else if (tag || (category !== 'tracks' && category !== 'top-tracks')) {
      method = 'tag.gettoptracks'
      extraParams.tag = tag || category
    }

    const searchParams = new URLSearchParams({
      method,
      api_key: apiKey.trim() || 'b25b959554ed76058ac220b7b2e0a026',
      format: 'json',
      ...extraParams
    })

    const response = await net.fetch(`https://ws.audioscrobbler.com/2.0/?${searchParams}`)
    if (!response.ok) return []
    const data = (await response.json()) as any

    if (category === 'artists' || category === 'top-artists') {
      const rawArtists: any[] = data?.artists?.artist || []
      return rawArtists.slice(0, 30).map((item, index) => ({
        id: `lastfm-artist-${item.mbid || index}-${item.name}`,
        title: String(item.name || 'Unknown Artist'),
        artist: 'Last.fm Top Artist',
        type: 'artist' as const,
        listeners: item.listeners ? `${Number(item.listeners).toLocaleString()} listeners` : undefined,
        playcount: item.playcount ? `${Number(item.playcount).toLocaleString()} scrobbles` : undefined,
        artworkUrl: lastFmImage(item.image),
        url: item.url,
        rank: index + 1
      }))
    }

    const rawTracks: any[] = data?.tracks?.track || []
    const items: LastFmChartItem[] = rawTracks.slice(0, 30).map((item, index) => {
      const artistName = typeof item.artist === 'string' ? item.artist : item.artist?.name || 'Unknown Artist'
      return {
        id: `lastfm-chart-${item.mbid || index}-${item.name}`,
        title: String(item.name || 'Unknown Track'),
        artist: String(artistName),
        type: 'track' as const,
        listeners: item.listeners ? `${Number(item.listeners).toLocaleString()} listeners` : undefined,
        playcount: item.playcount ? `${Number(item.playcount).toLocaleString()} scrobbles` : undefined,
        artworkUrl: lastFmImage(item.image),
        url: item.url,
        rank: index + 1
      }
    })

    return items
  } catch (err) {
    console.warn('Last.fm chart fetch failed:', err)
    return []
  }
}

export function musicBrainzArtistCredit(artistCredit: unknown): string {
  if (!Array.isArray(artistCredit)) return ''
  return artistCredit
    .map(
      (credit: any) => `${credit?.name || credit?.artist?.name || ''}${credit?.joinphrase || ''}`
    )
    .join('')
    .trim()
}

export function musicBrainzUrl(entity: 'artist' | 'recording' | 'release-group', id: unknown): string {
  return typeof id === 'string' && id
    ? `https://musicbrainz.org/${entity}/${encodeURIComponent(id)}`
    : ''
}

export function formatMusicBrainzRecording(item: any, index: number): MusicBrainzMappedItem {
  const artist = musicBrainzArtistCredit(item?.['artist-credit'])
  const releases = Array.isArray(item?.releases) ? item.releases : []
  const release = releases.find((candidate: any) => candidate?.title || candidate?.id)
  const album = release?.title || ''

  return {
    id: String(item?.id || `recording-${index}`),
    title: String(item?.title || 'Unknown Recording'),
    artist,
    album: String(album || ''),
    type: 'Song',
    duration: formatAppleDuration(item?.length),
    trackCount: null,
    url: musicBrainzUrl('recording', item?.id),
    thumbnail: '',
    explicit: false,
    releaseId: typeof release?.id === 'string' ? release.id : undefined
  }
}

export function formatMusicBrainzArtist(item: any, index: number): AppleMusicSearchItem {
  return {
    id: String(item?.id || `artist-${index}`),
    title: String(item?.name || 'Unknown Artist'),
    artist: String(item?.disambiguation || item?.country || item?.type || ''),
    album: '',
    type: 'Artist',
    duration: null,
    trackCount: null,
    url: musicBrainzUrl('artist', item?.id),
    thumbnail: '',
    explicit: false
  }
}

export function formatMusicBrainzReleaseGroup(item: any, index: number): MusicBrainzMappedItem {
  return {
    id: String(item?.id || `release-group-${index}`),
    title: String(item?.title || 'Unknown Album'),
    artist: musicBrainzArtistCredit(item?.['artist-credit']),
    album: String(item?.['primary-type'] || 'Album'),
    type: 'Album',
    duration: null,
    trackCount: null,
    url: musicBrainzUrl('release-group', item?.id),
    thumbnail: '',
    explicit: false,
    releaseGroupId: typeof item?.id === 'string' ? item.id : undefined
  }
}

export async function coverArtArchiveThumbnail(
  entity: 'release' | 'release-group',
  mbid?: string
): Promise<string> {
  if (!mbid) return ''
  try {
    const response = await net.fetch(
      `https://coverartarchive.org/${entity}/${encodeURIComponent(mbid)}`,
      {
        headers: {
          'User-Agent': `felo/${app.getVersion()} ( local desktop music search )`,
          Accept: 'application/json'
        }
      }
    )
    if (!response.ok) return ''
    const data = await response.json()
    const images = Array.isArray(data?.images) ? data.images : []
    const front = images.find((image: any) => image?.front) || images[0]
    return String(
      front?.thumbnails?.['250'] ||
        front?.thumbnails?.small ||
        front?.thumbnails?.['500'] ||
        front?.thumbnails?.large ||
        front?.image ||
        ''
    )
  } catch {
    return ''
  }
}

export async function onlineFallbackThumbnail(title?: string, artist?: string): Promise<string> {
  const cleanTitle = (title || '').trim()
  const cleanArtist = (artist || '').trim()
  if (!cleanTitle && !cleanArtist) return ''
  try {
    const q = [cleanArtist, cleanTitle].filter(Boolean).join(' ')
    const response = await fetchItunesJson(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&limit=1&country=US`
    )
    const raw = response?.results?.[0]?.artworkUrl100
    if (typeof raw === 'string' && raw) {
      return raw.replace('100x100bb', '600x600bb')
    }
  } catch {}
  return ''
}

export async function enrichMusicBrainzArtwork<T extends MusicBrainzMappedItem>(
  items: T[],
  entity: 'release' | 'release-group',
  limit: number
): Promise<T[]> {
  const cache = new Map<string, string>()
  let lookups = 0

  for (const item of items) {
    if (item.thumbnail || lookups >= limit) continue
    const mbid = entity === 'release' ? item.releaseId : item.releaseGroupId
    if (mbid) {
      if (!cache.has(mbid)) {
        lookups++
        cache.set(mbid, await coverArtArchiveThumbnail(entity, mbid))
      }
      item.thumbnail = cache.get(mbid) || ''
    }

    if (!item.thumbnail && (item.title || item.artist)) {
      const fallbackKey = `${item.artist}:::${item.title}`
      if (!cache.has(fallbackKey)) {
        lookups++
        cache.set(fallbackKey, await onlineFallbackThumbnail(item.title, item.artist))
      }
      item.thumbnail = cache.get(fallbackKey) || ''
    }
  }

  return items
}

export async function fetchMusicBrainzEntity<T>(
  entity: 'artist' | 'recording' | 'release-group',
  query: string,
  limit: number
): Promise<T[]> {
  const params = new URLSearchParams({
    query,
    fmt: 'json',
    limit: String(limit),
    dismax: 'true'
  })
  const response = await net.fetch(`https://musicbrainz.org/ws/2/${entity}?${params.toString()}`, {
    headers: {
      'User-Agent': `felo/${app.getVersion()} ( local desktop music search )`,
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    if (response.status === 429 || response.status === 502 || response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const retry = await net.fetch(`https://musicbrainz.org/ws/2/${entity}?${params.toString()}`, {
        headers: {
          'User-Agent': `felo/${app.getVersion()} ( local desktop music search )`,
          Accept: 'application/json'
        }
      })
      if (!retry.ok) throw new Error(`MusicBrainz ${entity} search failed (${retry.status})`)
      const data = await retry.json()
      const key =
        entity === 'release-group'
          ? 'release-groups'
          : entity === 'recording'
            ? 'recordings'
            : 'artists'
      return Array.isArray(data?.[key]) ? data[key] : []
    }
    throw new Error(`MusicBrainz ${entity} search failed (${response.status})`)
  }
  const data = await response.json()
  const key =
    entity === 'release-group'
      ? 'release-groups'
      : entity === 'recording'
        ? 'recordings'
        : 'artists'
  return Array.isArray(data?.[key]) ? data[key] : []
}

export async function searchMusicBrainz(query: string): Promise<MusicBrainzSearchResults> {
  const cleanQuery = query.trim()
  const emptyResults: MusicBrainzSearchResults = {
    'Top Results': [],
    Artists: [],
    Albums: [],
    Songs: []
  }
  if (!cleanQuery) return emptyResults

  const recordings = await fetchMusicBrainzEntity<any>('recording', cleanQuery, 25)
  const artists = await fetchMusicBrainzEntity<any>('artist', cleanQuery, 18)
  const releaseGroups = await fetchMusicBrainzEntity<any>('release-group', cleanQuery, 18)

  const songs = await enrichMusicBrainzArtwork(
    recordings.map(formatMusicBrainzRecording),
    'release',
    10
  )
  const mappedArtists = artists.map(formatMusicBrainzArtist)
  const albums = await enrichMusicBrainzArtwork(
    releaseGroups.map(formatMusicBrainzReleaseGroup),
    'release-group',
    12
  )

  return {
    'Top Results': songs.slice(0, 1).length ? songs.slice(0, 1) : mappedArtists.slice(0, 1),
    Songs: songs,
    Artists: mappedArtists,
    Albums: albums
  }
}

export async function fetchDeezerChartProxy(genreId?: number, limit = 50): Promise<any | null> {
  try {
    const url = genreId
      ? `https://api.deezer.com/editorial/${genreId}/charts?limit=${limit}`
      : `https://api.deezer.com/chart/0/tracks?limit=${limit}`
    const res = await net.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.warn('Deezer chart proxy error:', err)
    return null
  }
}

export async function fetchDeezerRecommendationsForArtist(artistName: string): Promise<any[]> {
  const clean = artistName.trim()
  if (!clean) return []
  try {
    const searchUrl = `https://api.deezer.com/search/artist?q=${encodeURIComponent(clean)}&limit=1`
    const searchRes = await net.fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json'
      }
    })
    if (!searchRes.ok) return []
    const searchJson = await searchRes.json()
    const artistId = searchJson?.data?.[0]?.id
    if (!artistId) return []

    const [topRes, relatedRes] = await Promise.all([
      net.fetch(`https://api.deezer.com/artist/${artistId}/top?limit=15`, {
        headers: { Accept: 'application/json' }
      }),
      net.fetch(`https://api.deezer.com/artist/${artistId}/related?limit=5`, {
        headers: { Accept: 'application/json' }
      })
    ])

    const tracks: any[] = []
    if (topRes.ok) {
      const topData = await topRes.json()
      if (Array.isArray(topData?.data)) {
        tracks.push(...topData.data)
      }
    }

    if (relatedRes.ok) {
      const relData = await relatedRes.json()
      const relArtists = (relData?.data || []).slice(0, 3)
      for (const rel of relArtists) {
        try {
          const relTop = await net.fetch(`https://api.deezer.com/artist/${rel.id}/top?limit=5`, {
            headers: { Accept: 'application/json' }
          })
          if (relTop.ok) {
            const relTopJson = await relTop.json()
            if (Array.isArray(relTopJson?.data)) {
              tracks.push(...relTopJson.data)
            }
          }
        } catch {}
      }
    }

    return tracks
  } catch (err) {
    console.warn(`Error generating Deezer recommendations for ${artistName}:`, err)
    return []
  }
}

export function decodeHtmlEntities(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  const FALLBACK_ENTITIES: Record<string, string> = {
    amp: '&',
    apos: "'",
    bull: '\u2022',
    copy: '\u00a9',
    gt: '>',
    hellip: '\u2026',
    lt: '<',
    mdash: '\u2014',
    nbsp: ' ',
    ndash: '\u2013',
    quot: '"',
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"'
  }
  return text
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = parseInt(entity.slice(2), 16)
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
      }
      if (entity.startsWith('#')) {
        const code = parseInt(entity.slice(1), 10)
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
      }
      return FALLBACK_ENTITIES[entity.toLowerCase()] ?? match
    })
    .trim()
}

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

export function registerSearchIpc(): void {
  // YouTube Metadata & oEmbed resolver (bypasses browser CORS/CSP restrictions)
  ipcMain.handle('youtube:get-metadata', async (_event, urlOrId: string) => {
    try {
      const videoId = extractYouTubeVideoId(urlOrId)
      if (!videoId) {
        return { success: false, error: 'Invalid YouTube link or video ID' }
      }
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(oembedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      }).finally(() => clearTimeout(timeout))

      if (!res.ok) {
        return {
          success: false,
          videoId,
          error: `YouTube oEmbed returned HTTP ${res.status}`
        }
      }

      const data = (await res.json()) as Record<string, any>
      const title = decodeHtmlEntities(data.title || 'YouTube Track')
      const channel = decodeHtmlEntities(data.author_name || 'YouTube')
      const thumbnailUrl =
        typeof data.thumbnail_url === 'string' && data.thumbnail_url
          ? data.thumbnail_url
          : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

      return {
        success: true,
        videoId,
        title,
        channel,
        thumbnailUrl,
        url: `https://www.youtube.com/watch?v=${videoId}`
      }
    } catch (err: any) {
      console.warn('[YouTube] Failed to fetch oEmbed metadata:', err?.message)
      return { success: false, error: err?.message || 'Failed to fetch YouTube metadata' }
    }
  })

  ipcMain.handle('charts:fetchDeezerChart', async (_, genreId?: number, limit = 50) => {
    return fetchDeezerChartProxy(genreId, limit)
  })

  ipcMain.handle('charts:fetchDeezerRecommendations', async (_, artistName: string) => {
    return fetchDeezerRecommendationsForArtist(artistName)
  })

  // Apple Music: parse the public web search payload, matching the reference app.
  ipcMain.handle('search:appleMusic', async (_, query: string) => {
    if (typeof query !== 'string' || !query.trim()) {
      return { 'Top Results': [], Artists: [], Albums: [], Songs: [] }
    }
    try {
      return await searchAppleMusic(query)
    } catch (error) {
      console.warn('Apple Music web search failed; using iTunes fallback:', error)
      return searchAppleMusicItunes(query)
    }
  })

  // Apple Music: fetch a fuller song catalog for one artist page.
  ipcMain.handle('search:appleMusicArtistSongs', async (_, artistName: string) => {
    if (typeof artistName !== 'string' || !artistName.trim()) return []
    return searchAppleMusicArtistSongs(artistName)
  })

  // Last.fm: metadata search used for the global catalog browser.
  ipcMain.handle('search:lastFm', async (_, query: string, configuredApiKey?: string) => {
    const db = getDb()
    const row = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('search.lastFmApiKey') as { value?: string } | undefined
    let savedApiKey = row?.value || ''
    try {
      savedApiKey = JSON.parse(savedApiKey)
    } catch {
      // Keep legacy plain-text setting values.
    }
    return searchLastFm(query, configuredApiKey || savedApiKey || process.env.LASTFM_API_KEY || '')
  })

  // Last.fm: fetch top charts & tag tracks
  ipcMain.handle('lastfm:getCharts', async (_, category: string = 'tracks', tag?: string) => {
    const db = getDb()
    const row = db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('search.lastFmApiKey') as { value?: string } | undefined
    let savedApiKey = row?.value || ''
    try {
      savedApiKey = JSON.parse(savedApiKey)
    } catch {
      // Keep legacy plain-text setting values.
    }
    return fetchLastFmChartData(category, tag, savedApiKey || process.env.LASTFM_API_KEY || '')
  })

  // MusicBrainz: search recordings, artists, and release groups in the main process.
  ipcMain.handle('search:musicBrainz', async (_, query: string) => {
    if (typeof query !== 'string' || !query.trim()) {
      return { 'Top Results': [], Artists: [], Albums: [], Songs: [] }
    }
    try {
      return await searchMusicBrainz(query)
    } catch (error) {
      console.warn('MusicBrainz search unavailable:', error)
      return { 'Top Results': [], Artists: [], Albums: [], Songs: [] }
    }
  })
}
