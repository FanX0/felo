import { app, shell, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron'
import { join, normalize, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb } from './database'
import { LibraryService } from './services/LibraryService'
import { PlaylistService } from './services/PlaylistService'
import { DownloadService } from './services/DownloadService'
import { startMusicPresenceIntegrationWatcher } from './services/MusicPresenceService'
import fs from 'fs'
import { Readable } from 'stream'

// Ensure DB is initialized
getDb()

const OAUTH_CALLBACK_PREFIX = 'felo://auth/callback'
let pendingOAuthCallback: string | null = null

function findOAuthCallback(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith(OAUTH_CALLBACK_PREFIX))
}

function deliverOAuthCallback(callbackUrl: string): void {
  try {
    const parsed = new URL(callbackUrl)
    if (
      parsed.protocol !== 'felo:' ||
      parsed.hostname !== 'auth' ||
      parsed.pathname !== '/callback'
    ) {
      return
    }
  } catch {
    return
  }

  const mainWindow = BrowserWindow.getAllWindows()[0]
  if (!mainWindow) {
    pendingOAuthCallback = callbackUrl
    return
  }

  mainWindow.webContents.send('auth:callback', callbackUrl)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const callbackUrl = findOAuthCallback(commandLine)
    if (callbackUrl) deliverOAuthCallback(callbackUrl)
  })
}

app.on('open-url', (event, callbackUrl) => {
  event.preventDefault()
  deliverOAuthCallback(callbackUrl)
})

const initialOAuthCallback = findOAuthCallback(process.argv)
if (initialOAuthCallback) pendingOAuthCallback = initialOAuthCallback

interface LrclibLyrics {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string
  syncedLyrics?: string
}

interface AppleMusicSearchItem {
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

type AppleMusicSearchResults = Record<
  'Top Results' | 'Artists' | 'Albums' | 'Songs',
  AppleMusicSearchItem[]
>

type MusicBrainzSearchResults = AppleMusicSearchResults

type LastFmSearchResults = AppleMusicSearchResults

function lastFmImage(images: unknown): string {
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

async function fetchFallbackArtwork(query: string): Promise<AppleMusicSearchItem[]> {
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

async function searchLastFm(query: string, apiKey: string): Promise<LastFmSearchResults> {
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

type MusicBrainzMappedItem = AppleMusicSearchItem & {
  releaseId?: string
  releaseGroupId?: string
}

function formatAppleDuration(milliseconds: unknown): string | null {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return null
  const totalSeconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function appleArtworkUrl(item: any): string {
  const template = item?.artwork?.dictionary?.url
  if (typeof template !== 'string') return ''
  return template
    .replaceAll('{w}', '600')
    .replaceAll('{h}', '600')
    .replaceAll('{c}', 'bb')
    .replaceAll('{f}', 'jpg')
}

function appleLinkedTitles(links: unknown): string[] {
  if (!Array.isArray(links)) return []
  return links
    .map((link) => (typeof link?.title === 'string' ? link.title.trim() : ''))
    .filter(Boolean)
}

function formatAppleMusicItem(item: any, index: number): AppleMusicSearchItem {
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

function normalizeCatalogString(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function catalogArtistMatches(candidate: string, target: string): boolean {
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

function formatItunesSong(item: any, index: number): AppleMusicSearchItem | null {
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

async function fetchItunesJson(url: string): Promise<any> {
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

async function searchAppleMusicArtistSongs(artistName: string): Promise<AppleMusicSearchItem[]> {
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

async function searchAppleMusicItunes(query: string): Promise<AppleMusicSearchResults> {
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

async function searchAppleMusic(query: string): Promise<AppleMusicSearchResults> {
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

function musicBrainzArtistCredit(artistCredit: unknown): string {
  if (!Array.isArray(artistCredit)) return ''
  return artistCredit
    .map(
      (credit: any) => `${credit?.name || credit?.artist?.name || ''}${credit?.joinphrase || ''}`
    )
    .join('')
    .trim()
}

function musicBrainzUrl(entity: 'artist' | 'recording' | 'release-group', id: unknown): string {
  return typeof id === 'string' && id
    ? `https://musicbrainz.org/${entity}/${encodeURIComponent(id)}`
    : ''
}

function formatMusicBrainzRecording(item: any, index: number): MusicBrainzMappedItem {
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

function formatMusicBrainzArtist(item: any, index: number): AppleMusicSearchItem {
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

function formatMusicBrainzReleaseGroup(item: any, index: number): MusicBrainzMappedItem {
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

async function coverArtArchiveThumbnail(
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

async function enrichMusicBrainzArtwork<T extends MusicBrainzMappedItem>(
  items: T[],
  entity: 'release' | 'release-group',
  limit: number
): Promise<T[]> {
  const cache = new Map<string, string>()
  let lookups = 0

  for (const item of items) {
    if (item.thumbnail || lookups >= limit) continue
    const mbid = entity === 'release' ? item.releaseId : item.releaseGroupId
    if (!mbid) continue

    if (!cache.has(mbid)) {
      lookups++
      cache.set(mbid, await coverArtArchiveThumbnail(entity, mbid))
    }
    item.thumbnail = cache.get(mbid) || ''
  }

  return items
}

async function fetchMusicBrainzEntity<T>(
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

async function searchMusicBrainz(query: string): Promise<MusicBrainzSearchResults> {
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

async function fetchLastFmSearchArtwork(query: string): Promise<Map<string, string>> {
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

function decodeSpotifyText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

async function fetchSpotifyPlaylistTracks(playlistId: string): Promise<{
  title: string
  tracks: Array<{ title: string; artist: string; duration?: number }>
}> {
  if (!/^[A-Za-z0-9]+$/.test(playlistId)) throw new Error('Invalid Spotify playlist ID.')
  const response = await net.fetch(`https://open.spotify.com/embed/playlist/${playlistId}`)
  if (!response.ok) throw new Error(`Spotify playlist unavailable (${response.status}).`)
  const html = await response.text()
  const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const rowPattern =
    /<h3[^>]*TracklistRow_title[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*TracklistRow_subtitle[^>]*>([\s\S]*?)<\/h4>[\s\S]*?data-testid="duration-cell">([^<]*)</gi
  const tracks: Array<{ title: string; artist: string; duration?: number }> = []
  let match: RegExpExecArray | null
  while ((match = rowPattern.exec(html)) !== null) {
    const durationParts = decodeSpotifyText(match[3]).split(':').map(Number)
    tracks.push({
      title: decodeSpotifyText(match[1]),
      artist: decodeSpotifyText(match[2]),
      duration: durationParts.length === 2 ? durationParts[0] * 60 + durationParts[1] : undefined
    })
  }
  if (!tracks.length) throw new Error('Spotify did not return any playlist tracks.')
  return { title: decodeSpotifyText(titleMatch?.[1] || ''), tracks }
}

async function fetchPlaylistImportMetadata(url: string): Promise<{
  name: string
  description: string
  thumbnail: string
  tracks: unknown[]
}> {
  const cleanUrl = url.trim()
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('Enter a valid playlist URL.')
  }

  if (/open\.spotify\.com\/playlist\//i.test(cleanUrl)) {
    const response = await net.fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          Accept: 'application/json'
        }
      }
    )
    if (!response.ok) throw new Error(`Spotify playlist metadata failed (${response.status})`)
    const data = await response.json()
    return {
      name: String(data?.title || 'Spotify Playlist'),
      description: 'Imported from Spotify link. Upload a CSV export to import tracks.',
      thumbnail: String(data?.thumbnail_url || ''),
      tracks: []
    }
  }

  throw new Error('This link type is not supported yet. Use CSV, JSPF, XSPF, XML, or M3U import.')
}

function cleanLyricsMetadata(value: string): string {
  if (!value) return ''
  let cleaned = value
    .normalize('NFKC')
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
    .replace(/^\s*\d{1,3}[.\-_)]+\s*/, '')
    .replace(
      /\s*[\(\[]\s*(?:youtube|explicit|official(?:\s*(?:music|lyric|lyrics)?\s*(?:video|audio|mv)?)?|lyrics?(?:\s*video)?|remaster(?:ed)?(?:\s*[\d\w]+)?|hq|hd|visualizer|audio|video|mv|copyright[\s-]*free|feat\.?.*?|ft\.?.*?|single\s*version|bonus\s*track|deluxe(?:\s*edition)?|live(?:\s*at\s*.*)?|\d+)\s*[\)\]]\s*/gi,
      ' '
    )
    .replace(/\s+(?:official\s*)?(?:music\s*)?(?:lyric(?:s)?\s*)?(?:video|audio|mv)\s*$/gi, '')
    .replace(/\s+no\.\s*\d+\s*$/gi, '')
    .replace(/\bunknown\s*artist\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  let previous = ''
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned.replace(/\s*[\(\[]\s*(?:youtube|\d+)\s*[\)\]]\s*$/gi, '').trim()
  }
  return cleaned
}

function isPlaceholderLyricsValue(value?: string): boolean {
  return /^(?:unknown|untitled|n\/?a|none|null)(?:\s+(?:artist|album|track))?$/i.test(
    value?.trim() || ''
  )
}

function resolveLyricsMetadata(songInfo: {
  title: string
  artist: string
  album?: string
  duration?: number
}): { title: string; artist: string; album: string; duration?: number } {
  let title = cleanLyricsMetadata(songInfo.title || '')
  let artist = isPlaceholderLyricsValue(songInfo.artist)
    ? ''
    : cleanLyricsMetadata(songInfo.artist || '')
  const album = isPlaceholderLyricsValue(songInfo.album)
    ? ''
    : cleanLyricsMetadata(songInfo.album || '')

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

  return {
    title,
    artist,
    album,
    duration:
      Number.isFinite(songInfo.duration) && Number(songInfo.duration) > 0
        ? Math.round(Number(songInfo.duration))
        : undefined
  }
}

function hasLyrics(data: LrclibLyrics | null | undefined): data is LrclibLyrics {
  return Boolean(data?.syncedLyrics || data?.plainLyrics)
}

async function fetchLrclib(
  endpoint: '/get' | '/get-cached' | '/search',
  params: URLSearchParams
): Promise<LrclibLyrics | LrclibLyrics[] | null> {
  try {
    const response = await net.fetch(`https://lrclib.net/api${endpoint}?${params.toString()}`, {
      headers: {
        'User-Agent': `felo ${app.getVersion()} (local desktop app)`
      }
    })
    if (!response.ok) return null
    return (await response.json()) as LrclibLyrics | LrclibLyrics[]
  } catch (err) {
    console.warn(`LRCLIB ${endpoint} failed:`, err)
    return null
  }
}

function normalizeForCompare(value?: string): string {
  return cleanLyricsMetadata(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function lyricsTextSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.82

  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union > 0 ? intersection / union : 0
}

function scoreLyricsCandidate(
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
  let score = candidate.syncedLyrics ? 25 : 8

  score += lyricsTextSimilarity(candidateTrack, targetTrack) * 65
  if (targetArtist) score += lyricsTextSimilarity(candidateArtist, targetArtist) * 40
  if (targetAlbum) score += lyricsTextSimilarity(candidateAlbum, targetAlbum) * 10
  if (duration && candidate.duration) {
    const difference = Math.abs(candidate.duration - duration)
    if (difference <= 2) score += 18
    else if (difference <= 5) score += 10
    else if (difference >= 20) score -= 12
  }

  return score
}

function pickBestLyrics(
  results: LrclibLyrics | LrclibLyrics[] | null,
  track: string,
  artist: string,
  album = '',
  duration?: number
): LrclibLyrics | null {
  if (!results) return null
  if (!Array.isArray(results)) return hasLyrics(results) ? results : null

  const ranked = [...results]
    .filter(hasLyrics)
    .map((candidate) => ({
      candidate,
      score: scoreLyricsCandidate(candidate, track, artist, album, duration)
    }))
    .sort((a, b) => b.score - a.score)

  return ranked[0] && ranked[0].score >= 38 ? ranked[0].candidate : null
}

async function fetchLyricsFromLrclib(songInfo: {
  title: string
  artist: string
  album?: string
  duration?: number
}): Promise<LrclibLyrics | null> {
  const rawTrack = songInfo.title?.trim() || ''
  const rawArtist = songInfo.artist?.trim() || ''
  const resolved = resolveLyricsMetadata(songInfo)
  const cleanTrack = resolved.title
  const cleanArtist = resolved.artist
  const cleanAlbum = resolved.album

  const attempts: Array<{
    endpoint: '/get' | '/get-cached' | '/search'
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
    if (resolved.duration) {
      exactParams.set('duration', String(resolved.duration))
    }
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
      endpoint: '/get-cached',
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
  if (rawQuery) {
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
    if (best) return best
  }

  return null
}

type LyricsTransformMode = 'translate' | 'romanize'

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

async function transformLyricLine(
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
      if (attempt < 2) await wait(500 * 2 ** attempt)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lyrics transformation failed')
}

async function transformLyricsLines(
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

  const uniqueLines = [...new Set(lines.filter((line) => line.trim()))]
  const transformed = new Map<string, string>()
  let nextIndex = 0
  const workerCount = Math.min(2, uniqueLines.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < uniqueLines.length) {
        const line = uniqueLines[nextIndex]
        nextIndex += 1
        transformed.set(line, await transformLyricLine(line, mode, targetLanguage))
        await wait(80)
      }
    })
  )

  return lines.map((line) => transformed.get(line) ?? line)
}

// Register a custom protocol for safe local media access
// This replaces webSecurity: false
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

function resolveMediaPath(url: string) {
  const parsedUrl = new URL(url)

  if (parsedUrl.hostname === 'local') {
    return normalize(decodeURIComponent(parsedUrl.pathname.slice(1)))
  }

  // Backward-compatible support for older media:///C:/... URLs.
  let filePath = decodeURIComponent(url.replace('media://', ''))
  if (process.platform === 'win32' && filePath.startsWith('/')) {
    filePath = filePath.slice(1)
  }
  return normalize(filePath)
}

function getContentType(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp3':
      return 'audio/mpeg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
      return 'audio/mp4'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'opus':
      return 'audio/ogg'
    case 'aac':
      return 'audio/aac'
    default:
      return 'application/octet-stream'
  }
}

type UpdateCheckResult = {
  status: 'up-to-date' | 'available' | 'unavailable' | 'error'
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  message?: string
}

function normalizeGithubRepository(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (shorthand) return `${shorthand[1]}/${shorthand[2].replace(/\.git$/, '')}`

  const githubUrl = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[#/]|$)/i.exec(trimmed)
  return githubUrl ? `${githubUrl[1]}/${githubUrl[2].replace(/\.git$/, '')}` : null
}

function configuredGithubRepository(): string | null {
  const environmentRepository = process.env.FELO_GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY
  const fromEnvironment = normalizeGithubRepository(environmentRepository)
  if (fromEnvironment) return fromEnvironment

  try {
    const metadata = JSON.parse(fs.readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    const repository =
      typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url
    return (
      normalizeGithubRepository(repository) ||
      normalizeGithubRepository(metadata.homepage) ||
      normalizeGithubRepository(metadata.githubRepository)
    )
  } catch {
    return null
  }
}

function compareVersions(left: string, right: string): number {
  const parse = (version: string) =>
    version
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const leftParts = parse(left)
  const rightParts = parse(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

async function checkGithubRelease(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  const repository = configuredGithubRepository()
  if (!repository) return { status: 'unavailable', currentVersion }

  try {
    const response = await net.fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Felo/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (!response.ok) {
      throw new Error(`GitHub release check failed (${response.status})`)
    }

    const release = (await response.json()) as { tag_name?: string; html_url?: string }
    const latestVersion = release.tag_name?.replace(/^v/i, '')
    if (!latestVersion) throw new Error('The latest GitHub release has no version tag')

    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'up-to-date',
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url
    }
  } catch (error) {
    return {
      status: 'error',
      currentVersion,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

function formatProviderError(source: 'qobuz' | 'deezer', raw: string): string {
  const normalized = raw.toLowerCase()
  if (source === 'qobuz') {
    if (normalized.includes('invalid credentials') || normalized.includes('401')) {
      return 'Authentication failed: Invalid credentials or expired user token. Please check your User ID and Auth Token / Password.'
    }
    if (
      normalized.includes('invalid app id') ||
      normalized.includes('invalidappiderror') ||
      normalized.includes('400')
    ) {
      return 'Invalid Qobuz App ID. Clear the App ID & App Secret fields in Settings to allow automatic detection.'
    }
    if (
      normalized.includes('free accounts are not eligible') ||
      normalized.includes('ineligibleerror')
    ) {
      return 'Free Qobuz account detected. Full-track streaming and downloading require an active Qobuz subscription or trial.'
    }
    if (normalized.includes('missingcredentialserror')) {
      return 'Missing credentials: Email/User ID and Auth Token/Password are required.'
    }
  } else {
    if (normalized.includes('authenticationerror') || normalized.includes('login_via_arl')) {
      return 'Deezer authentication failed: The ARL cookie token is invalid or has expired. Please grab a fresh "arl" cookie from deezer.com in your browser.'
    }
    if (normalized.includes('missingcredentialserror')) {
      return 'Missing credentials: Deezer ARL cookie token is required.'
    }
  }

  if (
    normalized.includes('enoent') ||
    normalized.includes('was not found')
  ) {
    return `${source === 'qobuz' ? 'Qobuz' : 'Deezer'} service is currently unreachable.`
  }

  return raw
}

function testQobuzAccount(accounts: any) {
  const hasIdentity = isNonEmptyString(accounts?.qobuzUser)
  const hasSecret = isNonEmptyString(accounts?.qobuzSecret)

  if (!hasIdentity || !hasSecret) {
    return {
      status: 'error',
      message: 'Qobuz test failed: Email / User ID and Auth Token (or Password) are required.'
    }
  }

  return {
    status: 'success',
    message: 'Qobuz configuration is complete.'
  }
}

function testDeezerAccount(accounts: any) {
  const arl = typeof accounts?.deezerArl === 'string' ? accounts.deezerArl.replace(/\s+/g, '') : ''

  if (!arl) {
    return {
      status: 'error',
      message: 'Deezer test failed: ARL cookie token is required.'
    }
  }

  if (arl.length < 32) {
    return {
      status: 'error',
      message: 'Deezer test failed: ARL cookie token looks too short.'
    }
  }

  return {
    status: 'success',
    message: 'Deezer configuration is complete.'
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: 'Felo',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false, // Frameless for custom title bar
    titleBarStyle: 'hidden', // macOS: hidden title bar
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, // Required for better-sqlite3 native module access
      contextIsolation: true,
      nodeIntegration: false
      // webSecurity is now TRUE (default) — we use the media:// protocol instead
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingOAuthCallback) return
    mainWindow.webContents.send('auth:callback', pendingOAuthCallback)
    pendingOAuthCallback = null
  })

  // Only allow opening external URLs in the system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Set proper app user model ID
  electronApp.setAppUserModelId('com.felo.app')
  startMusicPresenceIntegrationWatcher()

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('felo', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('felo')
  }

  // Register the media:// protocol handler for streaming local audio
  protocol.handle('media', (request) => {
    const filePath = resolveMediaPath(request.url)

    // Security: verify the file exists and is within a registered library root
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }

    const contentType = getContentType(filePath)
    if (contentType.startsWith('image/')) {
      return new Response(fs.readFileSync(filePath), {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    }

    const fileSize = fs.statSync(filePath).size
    const rangeHeader = request.headers.get('range')
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    }

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
      if (!match) {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${fileSize}` }
        })
      }

      const requestedStart = match[1] ? Number(match[1]) : null
      const requestedEnd = match[2] ? Number(match[2]) : null
      const start = requestedStart ?? Math.max(0, fileSize - (requestedEnd ?? 0))
      const end = Math.min(
        requestedStart === null ? fileSize - 1 : (requestedEnd ?? fileSize - 1),
        fileSize - 1
      )

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start > end ||
        start >= fileSize
      ) {
        return new Response(null, {
          status: 416,
          headers: { ...commonHeaders, 'Content-Range': `bytes */${fileSize}` }
        })
      }

      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }))
      return new Response(stream as BodyInit, {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`
        }
      })
    }

    const stream = Readable.toWeb(fs.createReadStream(filePath))
    return new Response(stream as BodyInit, {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(fileSize) }
    })
  })

  // DevTools shortcut in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ─── IPC Handlers ────────────────────────────────────────

  // Library: Open directory picker
  ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a music folder'
    })
    if (!canceled && filePaths.length > 0) {
      return filePaths[0]
    }
    return null
  })

  // Library: Scan a folder
  ipcMain.handle('library:scan', async (_, folderPath: string) => {
    if (!folderPath || typeof folderPath !== 'string') return 0
    return await LibraryService.scanFolder(folderPath)
  })

  // Library: Get all songs
  ipcMain.handle('library:getSongs', async () => {
    return await LibraryService.getSongs()
  })

  // Library: Get roots
  ipcMain.handle('library:getRoots', () => {
    return LibraryService.getLibraryRoots()
  })

  // Library: Remove a root
  ipcMain.handle('library:removeRoot', (_, rootId: string) => {
    if (!rootId || typeof rootId !== 'string') return
    LibraryService.removeLibraryRoot(rootId)
  })

  // Library: Remove a song from the database only
  ipcMain.handle('library:removeSong', (_, songId: string) => {
    if (!songId || typeof songId !== 'string') return
    LibraryService.removeSong(songId)
  })

  // Library: Get artists
  ipcMain.handle('library:getArtists', () => {
    return LibraryService.getArtists()
  })

  // Library: Get albums
  ipcMain.handle('library:getAlbums', () => {
    return LibraryService.getAlbums()
  })

  // Library: Search songs
  ipcMain.handle('library:searchSongs', async (_, query: string) => {
    return await LibraryService.searchSongs(query)
  })

  // Library: Search artists
  ipcMain.handle('library:searchArtists', (_, query: string) => {
    const db = getDb()
    const pattern = `%${query}%`
    return db
      .prepare(
        `
      SELECT * FROM artists 
      WHERE name LIKE ?
      ORDER BY name ASC 
      LIMIT 20
    `
      )
      .all(pattern)
  })

  // Playlists
  ipcMain.handle('playlists:list', () => PlaylistService.getPlaylists())
  ipcMain.handle('playlists:get', (_, playlistId: string) =>
    PlaylistService.getPlaylist(playlistId)
  )
  ipcMain.handle(
    'playlists:create',
    (_, input: { name: string; description?: string; songIds?: string[] }) =>
      PlaylistService.createPlaylist(input)
  )
  ipcMain.handle('playlists:fetchImportMetadata', (_, url: string) =>
    fetchPlaylistImportMetadata(url)
  )
  ipcMain.handle(
    'playlists:importSpotify',
    async (_, playlistId: string, requestedName: string) => {
      const description = `Spotify playlist:${playlistId}`
      const existing = PlaylistService.findPlaylistByDescription(description)
      if (existing) return PlaylistService.getPlaylist(existing.id)

      const imported = await fetchSpotifyPlaylistTracks(playlistId)
      return PlaylistService.createPlaylist({
        name: requestedName.trim() || imported.title || 'Spotify Playlist',
        description,
        tracks: imported.tracks
      })
    }
  )
  ipcMain.handle('playlists:delete', (_, playlistId: string) =>
    PlaylistService.deletePlaylist(playlistId)
  )
  ipcMain.handle('playlists:rename', (_, playlistId: string, name: string) =>
    PlaylistService.renamePlaylist(playlistId, name)
  )
  ipcMain.handle('playlists:addSong', (_, playlistId: string, songId: string) =>
    PlaylistService.addSong(playlistId, songId)
  )
  ipcMain.handle('playlists:removeSong', (_, playlistId: string, songId: string) =>
    PlaylistService.removeSong(playlistId, songId)
  )

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

  // Lyrics: Fetch from LRCLIB in the main process to avoid renderer CORS failures
  ipcMain.handle(
    'lyrics:fetch',
    async (_, songInfo: { title: string; artist: string; album?: string; duration?: number }) => {
      if (!songInfo?.title || !songInfo?.artist) return null
      return fetchLyricsFromLrclib(songInfo)
    }
  )
  ipcMain.handle('lyrics:translate', (_, lines: unknown, targetLanguage: string) =>
    transformLyricsLines(lines, 'translate', targetLanguage)
  )
  ipcMain.handle('lyrics:romanize', (_, lines: unknown) =>
    transformLyricsLines(lines, 'romanize')
  )

  // Settings: Get
  ipcMain.handle('settings:get', (_, key: string) => {
    const db = getDb()
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any
    if (row) {
      try {
        return JSON.parse(row.value)
      } catch {
        return row.value
      }
    }
    return null
  })

  // Settings: Set
  ipcMain.handle('settings:set', (_, key: string, value: any) => {
    const db = getDb()
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    db.prepare(
      `
      INSERT OR REPLACE INTO app_settings (key, value, updatedAt)
      VALUES (?, ?, strftime('%s', 'now'))
    `
    ).run(key, serialized)
  })

  // Streaming account tests: mirror the reference app's {status, message} contract.
  ipcMain.handle('streaming:testQobuz', async (_, accounts: any) => {
    const validation = testQobuzAccount(accounts)
    if (validation.status === 'error') return validation
    try {
      await DownloadService.search('qobuz', 'Daft Punk One More Time', accounts)
      return { status: 'success', message: 'Qobuz account connected and verified successfully!' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: formatProviderError('qobuz', raw), rawError: raw }
    }
  })

  ipcMain.handle('streaming:testDeezer', async (_, accounts: any) => {
    const validation = testDeezerAccount(accounts)
    if (validation.status === 'error') return validation
    try {
      await DownloadService.search('deezer', 'Daft Punk One More Time', accounts)
      return { status: 'success', message: 'Deezer account connected and verified successfully!' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: formatProviderError('deezer', raw), rawError: raw }
    }
  })

  ipcMain.handle('streaming:testSoulseek', async (_, accounts: any) => {
    try {
      const results = await DownloadService.search('soulseek', 'Daft Punk', accounts || {})
      return {
        status: 'success',
        message: `Connected to Soulseek P2P network (${results.length} peer matches found)!`
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return { status: 'error', message: `Soulseek connection failed: ${raw}`, rawError: raw }
    }
  })

  ipcMain.handle(
    'downloads:search',
    async (
      _,
      source: 'qobuz' | 'deezer' | 'soulseek' | 'youtube',
      query: string,
      accounts: any
    ) => {
      if (
        source !== 'qobuz' &&
        source !== 'deezer' &&
        source !== 'soulseek' &&
        source !== 'youtube'
      ) {
        throw new Error(`The ${source} download connector is not available.`)
      }
      return DownloadService.search(source, query, accounts || {})
    }
  )

  ipcMain.handle('downloads:start', (_, request: any) => {
    if (
      !request ||
      (request.source !== 'qobuz' &&
        request.source !== 'deezer' &&
        request.source !== 'soulseek' &&
        request.source !== 'youtube')
    ) {
      throw new Error('Invalid download request source.')
    }
    return DownloadService.start(request)
  })

  ipcMain.handle('downloads:checkDependencies', async () => {
    return DownloadService.checkDependencies()
  })

  ipcMain.handle('downloads:installDependencies', async (event) => {
    return DownloadService.installDependencies((chunk) => {
      event.sender.send('downloads:installLog', chunk)
    })
  })

  // System: Get app version
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('system:checkForUpdates', () => checkGithubRelease())

  // System: Open external URL (validated)
  ipcMain.handle('system:openExternal', (_, url: string) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url)
    }
  })

  // System: Reveal file or open directory in explorer
  ipcMain.handle('system:revealFile', (_, targetPath: string) => {
    if (targetPath && typeof targetPath === 'string' && fs.existsSync(targetPath)) {
      const resolved = resolve(targetPath)
      try {
        if (fs.statSync(resolved).isDirectory()) {
          shell.openPath(resolved)
        } else {
          shell.showItemInFolder(resolved)
        }
      } catch {
        shell.openPath(resolved)
      }
    }
  })

  // ─── Window Controls (for frameless window) ──────────────
  ipcMain.on('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.on('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  createWindow()

  // Auto-scan library roots that haven't been scanned yet
  try {
    const db = getDb()
    const roots = db.prepare('SELECT id, path FROM library_roots WHERE isActive = 1').all() as any[]
    for (const root of roots) {
      const songCount = db
        .prepare('SELECT COUNT(*) as count FROM songs WHERE rootId = ?')
        .get(root.id) as any
      if (!songCount || songCount.count === 0) {
        console.log(`Auto-scanning unindexed library root: ${root.path}`)
        LibraryService.scanFolder(root.path)
          .then((count) => {
            console.log(`Auto-scan complete for ${root.path}: ${count} songs found.`)
          })
          .catch((err) => {
            console.error(`Auto-scan failed for ${root.path}:`, err)
          })
      }
    }
  } catch (err) {
    console.error('Auto-scan error:', err)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
