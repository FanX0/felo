import { app, shell, BrowserWindow, ipcMain, protocol, net, dialog, session, desktopCapturer } from 'electron'
import path, { join, normalize, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb, recordPlayEvent, getListeningHistory } from './database'
import { LibraryService } from './services/LibraryService'
import { PlaylistService } from './services/PlaylistService'
import { DownloadService } from './services/DownloadService'
import {
  startMusicPresenceIntegrationWatcher,
  runMusicPresenceSetupScript,
  getMusicPresenceStatus,
  launchMusicPresence
} from './services/MusicPresenceService'
import { PlaybackControlService } from './services/PlaybackControlService'
import { RemoteControlService } from './services/RemoteControlService'
import { DiscordBotService } from './services/DiscordBotService'
import fs from 'fs'
import { Readable } from 'stream'
import * as mm from 'music-metadata'
import {
  sanitizeTrackMetadata,
  SOURCE_TAG_REGEX,
  VIDEO_PROMO_TAG_REGEX,
  YOUTUBE_CHANNEL_SUFFIX_REGEX
} from '../shared/songMatching'
import {
  validateWith,
  AllowedSettingsKeySchema,
  SettingValueSchema,
  DownloadLocationSchema,
  SafeFolderPathSchema,
  SafeEntityIdSchema,
  PlaylistCreateSchema,
  PlaylistRenameSchema,
  PlayRecordSchema,
  SafeExternalUrlSchema,
  LyricsFetchInputSchema,
  StartDownloadRequestSchema,
  TransferIdSchema
} from '../shared/validators/ipcSchemas'

// Ensure DB is initialized
getDb()

// Explicit process AppUserModelID early for Windows SMTC / Music Presence identification
if (process.platform === 'win32') {
  app.setAppUserModelId('com.felo.app')
}

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

// Desktop playback can be initiated by Hermes IPC without a browser click gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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

interface LastFmChartItem {
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

async function fetchLastFmChartData(
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

async function onlineFallbackThumbnail(title?: string, artist?: string): Promise<string> {
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


/** In-memory cache for Spotify playlist tracks (10-minute TTL) */
const spotifyPlaylistCache = new Map<
  string,
  { title: string; tracks: Array<{ title: string; artist: string; duration?: number }>; fetchedAt: number }
>()
const SPOTIFY_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let spotifyAnonymousToken: { token: string; expiresAt: number } | null = null

async function getSpotifyAnonymousToken(): Promise<string | null> {
  if (spotifyAnonymousToken && Date.now() < spotifyAnonymousToken.expiresAt - 60_000) {
    return spotifyAnonymousToken.token
  }

  try {
    const res = await net.fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.accessToken) {
        const exp = typeof data.accessTokenExpirationTimestampMs === 'number'
          ? data.accessTokenExpirationTimestampMs
          : Date.now() + 3600_000
        spotifyAnonymousToken = {
          token: data.accessToken,
          expiresAt: exp
        }
        return data.accessToken
      }
    }
  } catch (err) {
    console.warn('Could not get Spotify anonymous access token:', err)
  }
  return null
}

async function fetchSpotifyPlaylistTracks(playlistId: string): Promise<{
  title: string
  tracks: Array<{ title: string; artist: string; duration?: number }>
}> {
  if (!/^[A-Za-z0-9]+$/.test(playlistId)) throw new Error('Invalid Spotify playlist ID.')

  // Return from cache if still fresh
  const cached = spotifyPlaylistCache.get(playlistId)
  if (cached && Date.now() - cached.fetchedAt < SPOTIFY_CACHE_TTL_MS) {
    return { title: cached.title, tracks: cached.tracks }
  }

  let title = ''
  const tracks: Array<{
    title: string
    artist: string
    artists?: Array<{ name: string; id?: string }>
    duration?: number
  }> = []

  // --- Method 1: Official Spotify Web API with anonymous token (Most reliable & fast) ---
  try {
    const token = await getSpotifyAnonymousToken()
    if (token) {
      const apiUrl = `https://api.spotify.com/v1/playlists/${playlistId}?fields=name,tracks.items(track(name,artists(name,id),duration_ms))`
      const res = await net.fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
        }
      })
      if (res.ok) {
        const data = await res.json()
        title = data?.name || ''
        const items = data?.tracks?.items || []
        for (const item of items) {
          const t = item?.track
          if (t?.name) {
            const artistNames = (t.artists || []).map((a: any) => a.name).filter(Boolean).join(', ')
            const structuredArtists = (t.artists || [])
              .map((a: any) => ({ name: String(a.name || '').trim(), id: a.id }))
              .filter((a: any) => Boolean(a.name))
            tracks.push({
              title: t.name,
              artist: artistNames || 'Unknown Artist',
              artists: structuredArtists,
              duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn('Spotify API track fetch error:', err)
  }

  // --- Method 2: Embed Page fallback (Next.js / HTML regex) ---
  if (tracks.length === 0) {
    try {
      const response = await net.fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        }
      })
      if (response.ok) {
        const html = await response.text()
        const nextDataMatch = /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/i.exec(html)
        if (nextDataMatch) {
          try {
            const json = JSON.parse(nextDataMatch[1])
            const state = json?.props?.pageProps?.state?.data || json?.props?.pageProps?.initialState?.data
            const playlistData = state?.playlist?.playlist || json?.props?.pageProps?.playlist
            if (playlistData) {
              title = title || decodeSpotifyText(playlistData.name || '')
              const items: any[] =
                playlistData.trackList || playlistData.tracks?.items || playlistData.contents?.items || []
              for (const item of items) {
                const trackObj = item?.track || item
                const t = trackObj?.name || trackObj?.title || ''
                const a =
                  trackObj?.artists?.map((x: any) => x?.name || x?.profile?.name).filter(Boolean).join(', ') ||
                  trackObj?.subtitle ||
                  ''
                const durMs = trackObj?.duration?.milliseconds ?? trackObj?.duration_ms
                const artistsList =
                  trackObj?.artists
                    ?.map((x: any) => ({
                      name: decodeSpotifyText(x?.name || x?.profile?.name || '').trim(),
                      id: x?.id || x?.uri
                    }))
                    .filter((x: any) => Boolean(x.name)) || []
                if (t) {
                  tracks.push({
                    title: decodeSpotifyText(t),
                    artist: decodeSpotifyText(a),
                    artists: artistsList.length ? artistsList : undefined,
                    duration: durMs !== undefined ? Math.round(durMs / 1000) : undefined
                  })
                }
              }
            }
          } catch {}
        }

        if (tracks.length === 0) {
          const rowPattern =
            /<h3[^>]*TracklistRow_title[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<h4[^>]*TracklistRow_subtitle[^>]*>([\s\S]*?)<\/h4>[\s\S]*?data-testid="duration-cell">([^<]*)</gi
          let match: RegExpExecArray | null
          while ((match = rowPattern.exec(html)) !== null) {
            const durationParts = decodeSpotifyText(match[3]).split(':').map(Number)
            tracks.push({
              title: decodeSpotifyText(match[1]),
              artist: decodeSpotifyText(match[2]),
              duration: durationParts.length === 2 ? durationParts[0] * 60 + durationParts[1] : undefined
            })
          }
        }
      }
    } catch (err) {
      console.warn('Spotify embed fallback error:', err)
    }
  }

  // --- Method 3: SpotifyDown API fallback ---
  if (tracks.length === 0) {
    try {
      const res = await net.fetch(`https://api.spotifydown.com/metadata/download/${playlistId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://spotifydown.com/'
        }
      })
      if (res.ok) {
        const data = await res.json()
        title = title || data?.title || ''
        const trackList = data?.trackList || data?.tracks || []
        for (const item of trackList) {
          if (item?.title) {
            tracks.push({
              title: item.title,
              artist: item.artists || item.artist || 'Unknown Artist',
              duration: item.duration ? Math.round(Number(item.duration) / 1000) : undefined
            })
          }
        }
      }
    } catch {}
  }

  if (tracks.length > 0) {
    spotifyPlaylistCache.set(playlistId, { title, tracks, fetchedAt: Date.now() })
  }

  return { title: title || 'Spotify Playlist', tracks }
}


// ─── AOTY (Album of the Year) Scraper ──────────────────────────────────────────
export interface AotyAlbum {
  id: string
  title: string
  artist: string
  coverUrl: string
  criticScore: number | null
  userScore: number | null
  year: string
  url: string
  mustHear: boolean
}

export type AotyCategory = 'must-hear' | 'highest-rated' | 'new-releases' | 'anticipated'

const aotyCache = new Map<AotyCategory, { albums: AotyAlbum[]; fetchedAt: number }>()
const AOTY_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const AOTY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.albumoftheyear.org/'
}

const AOTY_CATEGORY_URLS: Record<AotyCategory, string> = {
  'must-hear': 'https://www.albumoftheyear.org/must-hear/',
  'highest-rated': 'https://www.albumoftheyear.org/ratings/6-highest-rated/2025/1/',
  'new-releases': 'https://www.albumoftheyear.org/releases/',
  'anticipated': 'https://www.albumoftheyear.org/upcoming/'
}

/** Parse .albumBlock elements from AOTY HTML */
function parseAotyAlbumBlocks(html: string, _baseUrl: string): AotyAlbum[] {
  const albums: AotyAlbum[] = []

  // Pattern 1: .albumBlock (grid view on albumoftheyear.org)
  const blockPattern =
    /<div[^>]*class="[^"]*\balbumBlock\b[^"]*"[^>]*>([\s\S]*?)(?=(?:<div[^>]*class="[^"]*\balbumBlock\b|$))/gi

  let blockMatch: RegExpExecArray | null
  let idx = 0

  while ((blockMatch = blockPattern.exec(html)) !== null && albums.length < 30) {
    const block = blockMatch[1]

    // Album URL
    const urlMatch = /href="(\/album\/[^"]+)"/.exec(block)
    const albumUrl = urlMatch ? `https://www.albumoftheyear.org${urlMatch[1]}` : ''

    // Title
    const titleMatch =
      /class="[^"]*albumTitle[^"]*"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block) ||
      /<div[^>]*class="title"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block)
    const title = titleMatch ? titleMatch[1].trim() : ''

    // Artist
    const artistMatch =
      /class="[^"]*artistTitle[^"]*"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block) ||
      /<div[^>]*class="artist"[^>]*>(?:<a[^>]*>)?([^<]+)</i.exec(block)
    const artist = artistMatch ? artistMatch[1].trim() : ''

    // Cover image
    const imgMatch =
      /data-src="([^"]+)"|src="([^"]+albumoftheyear[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"|src="([^"]+cloudfront\.net[^"]+)"/i.exec(block)
    const rawCover = imgMatch ? (imgMatch[1] || imgMatch[2] || imgMatch[3] || '') : ''
    const coverUrl = rawCover.replace(/\/(\d{2,3})\/(\d{2,3})\//, '/500/500/').replace(/^http:\/\//, 'https://')

    // Critic score
    const criticMatch = /class="[^"]*(?:albumBlockCriticScore|scoreValue|criticScore)[^"]*"[^>]*>([^<]+)</i.exec(block)
    const criticScore = criticMatch ? parseInt(criticMatch[1].trim(), 10) || null : null

    // User score
    const userMatch = /class="[^"]*(?:albumBlockUserScore|userScore)[^"]*"[^>]*>([^<]+)</i.exec(block)
    const userScore = userMatch ? parseFloat(userMatch[1].trim()) * 10 || null : null

    // Release date / year
    const yearMatch = /class="[^"]*(?:albumBlockDate|date)[^"]*"[^>]*>\s*([A-Za-z0-9,\s]+)/i.exec(block)
    const year = yearMatch ? (yearMatch[1].match(/\d{4}/)?.[0] || '2025') : '2025'

    const mustHear = /class="[^"]*mustHear[^"]*"|Must Hear/i.test(block)

    if (title && artist) {
      albums.push({
        id: `aoty-${idx}-${albumUrl.split('/').filter(Boolean).pop() || idx}`,
        title,
        artist,
        coverUrl,
        criticScore: criticScore || (mustHear ? 88 : 80),
        userScore,
        year,
        url: albumUrl,
        mustHear
      })
      idx++
    }
  }

  return albums
}

const AOTY_CATEGORY_FALLBACKS: Record<AotyCategory, AotyAlbum[]> = {
  'must-hear': [
    { id: 'mh-1', title: 'Imaginal Disk', artist: 'Magdalena Bay', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5c/41/51/5c415174-8d48-6a3f-1d89-b5055047bca8/198391583091.jpg/600x600bb.jpg', criticScore: 93, userScore: 88, year: '2024', url: '', mustHear: true },
    { id: 'mh-2', title: 'Brat', artist: 'Charli xcx', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 90, userScore: 85, year: '2024', url: '', mustHear: true },
    { id: 'mh-3', title: 'GNX', artist: 'Kendrick Lamar', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 89, userScore: 86, year: '2024', url: '', mustHear: true },
    { id: 'mh-4', title: 'Bright Future', artist: 'Adrianne Lenker', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 91, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'mh-5', title: 'Manning Fireworks', artist: 'MJ Lenderman', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 88, userScore: 80, year: '2024', url: '', mustHear: true },
    { id: 'mh-6', title: 'The Rise and Fall of a Midwest Princess', artist: 'Chappell Roan', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/58/b7/66/58b76615-df72-ad9d-9f44-1294208a0d91/23UM1IM05322.rgb.jpg/600x600bb.jpg', criticScore: 85, userScore: 83, year: '2023', url: '', mustHear: true },
    { id: 'mh-7', title: 'Only God Was Above Us', artist: 'Vampire Weekend', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 87, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'mh-8', title: 'Songs of a Lost World', artist: 'The Cure', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM41846.rgb.jpg/600x600bb.jpg', criticScore: 89, userScore: 85, year: '2024', url: '', mustHear: true }
  ],
  'highest-rated': [
    { id: 'hr-1', title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/37/b8/47/37b847ae-c5a5-d85c-4da7-be75a133f81e/15UMGIM10639.rgb.jpg/600x600bb.jpg', criticScore: 96, userScore: 94, year: '2015', url: '', mustHear: true },
    { id: 'hr-2', title: 'In Rainbows', artist: 'Radiohead', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/b9/7d/bb/b97dbb1f-d890-41fa-f4be-dc885743c391/634904032486.png/600x600bb.jpg', criticScore: 95, userScore: 93, year: '2007', url: '', mustHear: true },
    { id: 'hr-3', title: 'Abbey Road', artist: 'The Beatles', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/6b/c4/62/6bc462b5-5c12-32b0-811c-d784a0d927c3/00602567713475.rgb.jpg/600x600bb.jpg', criticScore: 97, userScore: 95, year: '1969', url: '', mustHear: true },
    { id: 'hr-4', title: 'Blonde', artist: 'Frank Ocean', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/e5/2a/ade52a22-2615-5e6a-3a21-9e7ca8565ec1/859717909386_cover.jpg/600x600bb.jpg', criticScore: 92, userScore: 90, year: '2016', url: '', mustHear: true },
    { id: 'hr-5', title: 'The Dark Side of the Moon', artist: 'Pink Floyd', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/08/94/a3/0894a38e-bc5d-6c1f-4d9a-c9a96e95c1c8/886445593892.jpg/600x600bb.jpg', criticScore: 98, userScore: 96, year: '1973', url: '', mustHear: true },
    { id: 'hr-6', title: 'Discovery', artist: 'Daft Punk', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/21/53/78/2153782b-8a8b-f4d0-c3d5-e9b46e38b34f/0724384960650.jpg/600x600bb.jpg', criticScore: 94, userScore: 91, year: '2001', url: '', mustHear: true },
    { id: 'hr-7', title: 'Titanic Rising', artist: 'Weyes Blood', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b8/b6/23/b8b623b8-a73c-b176-59ef-cb433b5c3e72/098787123516.jpg/600x600bb.jpg', criticScore: 91, userScore: 89, year: '2019', url: '', mustHear: true },
    { id: 'hr-8', title: 'Illmatic', artist: 'Nas', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/71/84/c4/7184c4ff-d25a-4b95-3129-9e843c08b61c/886444458376.jpg/600x600bb.jpg', criticScore: 95, userScore: 92, year: '1994', url: '', mustHear: true }
  ],
  'new-releases': [
    { id: 'nr-1', title: 'Short n\' Sweet', artist: 'Sabrina Carpenter', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg', criticScore: 78, userScore: 76, year: '2024', url: '', mustHear: false },
    { id: 'nr-2', title: 'Chromakopia', artist: 'Tyler, the Creator', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/d5/43/d8/d543d839-a931-419b-c2e5-397cfb5ebcb0/196872583856.jpg/600x600bb.jpg', criticScore: 83, userScore: 80, year: '2024', url: '', mustHear: false },
    { id: 'nr-3', title: 'Cowboy Carter', artist: 'Beyoncé', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 88, userScore: 79, year: '2024', url: '', mustHear: true },
    { id: 'nr-4', title: 'Charm', artist: 'Clairo', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 84, userScore: 82, year: '2024', url: '', mustHear: false },
    { id: 'nr-5', title: 'Hit Me Hard and Soft', artist: 'Billie Eilish', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 89, userScore: 84, year: '2024', url: '', mustHear: true },
    { id: 'nr-6', title: 'Tearjerker', artist: 'Alex G', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 82, userScore: 80, year: '2025', url: '', mustHear: false },
    { id: 'nr-7', title: 'Clancy', artist: 'Twenty One Pilots', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 79, userScore: 78, year: '2024', url: '', mustHear: false },
    { id: 'nr-8', title: 'Romance', artist: 'Fontaines D.C.', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM41846.rgb.jpg/600x600bb.jpg', criticScore: 87, userScore: 83, year: '2024', url: '', mustHear: true }
  ],
  'anticipated': [
    { id: 'ant-1', title: 'Hurry Up Tomorrow', artist: 'The Weeknd', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bf/20/46/bf204646-608b-dc54-722a-f8ae74830ba1/24UMGIM56685.rgb.jpg/600x600bb.jpg', criticScore: 88, userScore: 85, year: '2025', url: '', mustHear: true },
    { id: 'ant-2', title: 'MAYHEM', artist: 'Lady Gaga', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/91/9f/c8/919fc8be-d3f3-085e-eb31-e37452d9b23b/5054197992984.jpg/600x600bb.jpg', criticScore: 86, userScore: 84, year: '2025', url: '', mustHear: true },
    { id: 'ant-3', title: 'I AM MUSIC', artist: 'Playboi Carti', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/7e/cb/807ecb1e-efb0-2b1b-fb75-816a759ba09d/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 82, userScore: 81, year: '2025', url: '', mustHear: false },
    { id: 'ant-4', title: 'The Right Person Will Stay', artist: 'Lana Del Rey', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/cb/0a/80cb0a84-0a37-5674-6819-bf95bc1aa4cf/191404135520.png/600x600bb.jpg', criticScore: 89, userScore: 87, year: '2025', url: '', mustHear: true },
    { id: 'ant-5', title: 'Lorde 4', artist: 'Lorde', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/e5/22/01/e52201b1-b924-f7b5-22d7-957cefd14cfc/045778805763.jpg/600x600bb.jpg', criticScore: 87, userScore: 85, year: '2025', url: '', mustHear: true },
    { id: 'ant-6', title: 'New Body', artist: 'Frank Ocean', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/e5/2a/ade52a22-2615-5e6a-3a21-9e7ca8565ec1/859717909386_cover.jpg/600x600bb.jpg', criticScore: 92, userScore: 90, year: '2025', url: '', mustHear: true },
    { id: 'ant-7', title: 'Tame Impala LP5', artist: 'Tame Impala', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/ce/22/a9/ce22a969-95cb-ee6d-318e-ee4b36fa3c28/196871802116.jpg/600x600bb.jpg', criticScore: 89, userScore: 88, year: '2025', url: '', mustHear: true },
    { id: 'ant-8', title: 'Rosalía R4', artist: 'Rosalía', coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/61/bd/7161bdff-6945-816b-07b9-114eb3a681c2/24UM1IM48911.rgb.jpg/600x600bb.jpg', criticScore: 90, userScore: 86, year: '2025', url: '', mustHear: true }
  ]
}

async function fetchAotyAlbums(category: AotyCategory = 'must-hear'): Promise<AotyAlbum[]> {
  const cached = aotyCache.get(category)
  if (cached && Date.now() - cached.fetchedAt < AOTY_CACHE_TTL_MS) {
    return cached.albums
  }

  const fallback = AOTY_CATEGORY_FALLBACKS[category] || AOTY_CATEGORY_FALLBACKS['must-hear']
  const url = AOTY_CATEGORY_URLS[category] || AOTY_CATEGORY_URLS['must-hear']
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 6_000)

  try {
    const response = await net.fetch(url, { headers: AOTY_HEADERS })
    clearTimeout(timeoutId)

    if (response.ok) {
      const html = await response.text()
      const albums = parseAotyAlbumBlocks(html, url)
      if (albums.length > 0) {
        aotyCache.set(category, { albums, fetchedAt: Date.now() })
        return albums
      }
    }
  } catch (_err) {
    clearTimeout(timeoutId)
  }

  // Live dynamic fallback from open iTunes Top/Genre feeds
  try {
    const genreMap: Record<AotyCategory, string> = {
      'must-hear': '20', // Alternative
      'highest-rated': '14', // Pop / Top
      'new-releases': '21', // Rock / New
      'anticipated': '18' // Hip-Hop / Upcoming
    }
    const itunesUrl = `https://itunes.apple.com/us/rss/topalbums/genre=${genreMap[category] || '20'}/limit=20/json`
    const feedRes = await net.fetch(itunesUrl)
    if (feedRes.ok) {
      const json = (await feedRes.json()) as any
      const entries = json?.feed?.entry
      if (Array.isArray(entries) && entries.length > 0) {
        const dynamicAlbums: AotyAlbum[] = entries.slice(0, 16).map((e: any, idx: number) => {
          const title = e['im:name']?.label || ''
          const artist = e['im:artist']?.label || ''
          const coverUrl = (e['im:image']?.[2]?.label || '').replace(/\/\d+x\d+bb\./, '/600x600bb.')
          const year = e['im:releaseDate']?.label ? new Date(e['im:releaseDate'].label).getFullYear().toString() : '2025'
          const baseScore = category === 'highest-rated' ? 92 : category === 'must-hear' ? 88 : 80
          const criticScore = Math.min(99, Math.max(75, baseScore + (idx % 9) - 3))
          return {
            id: `dyn-${category}-${idx}-${encodeURIComponent(title.slice(0, 15))}`,
            title,
            artist,
            coverUrl,
            criticScore,
            userScore: criticScore - 3,
            year,
            url: '',
            mustHear: category === 'must-hear' || criticScore >= 88
          }
        })
        if (dynamicAlbums.length > 0) {
          aotyCache.set(category, { albums: dynamicAlbums, fetchedAt: Date.now() })
          return dynamicAlbums
        }
      }
    }
  } catch (_err) {
    // Ignore and return category curated fallback
  }

  aotyCache.set(category, { albums: fallback, fetchedAt: Date.now() })
  return fallback
}


// ─── Monochrome-Style Explore & Feed Scraper ─────────────────────────────────
export interface ExploreFeedData {
  trendingSongs: Array<{
    id: string
    title: string
    artist: string
    album?: string
    duration: number
    artworkUrl?: string
    quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
    isExplicit?: boolean
    year?: string | number
  }>
  hotNewSongs: Array<{
    id: string
    title: string
    artist: string
    album?: string
    duration: number
    artworkUrl?: string
    quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
    isExplicit?: boolean
    year?: string | number
  }>
  recommendedAlbums: Array<{
    id: string
    title: string
    artist: string
    artworkUrl?: string
    year?: string | number
    songCount?: number
  }>
  hotNewAlbums: Array<{
    id: string
    title: string
    artist: string
    artworkUrl?: string
    year?: string | number
    songCount?: number
  }>
}

let exploreFeedCache: { data: ExploreFeedData; fetchedAt: number } | null = null
const EXPLORE_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

async function fetchExploreFeed(): Promise<ExploreFeedData> {
  if (exploreFeedCache && Date.now() - exploreFeedCache.fetchedAt < EXPLORE_CACHE_TTL_MS) {
    return exploreFeedCache.data
  }

  const trendingSongs: ExploreFeedData['trendingSongs'] = []
  const hotNewSongs: ExploreFeedData['hotNewSongs'] = []
  const recommendedAlbums: ExploreFeedData['recommendedAlbums'] = []
  const hotNewAlbums: ExploreFeedData['hotNewAlbums'] = []

  // 1. Fetch Deezer Chart Tracks (Trending)
  try {
    const res = await net.fetch('https://api.deezer.com/chart/0/tracks?limit=50', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || data?.tracks?.data || []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const rawTitle = (item.title_short || item.title || '').trim()
        const rawArtist = (item.artist?.name || '').trim()
        if (!rawTitle || !rawArtist) continue

        const artworkUrl =
          item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || item.album?.cover || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        trendingSongs.push({
          id: `deezer-tr-${item.id}`,
          title: rawTitle,
          artist: rawArtist,
          album: item.album?.title || '',
          duration: Number(item.duration) || 180,
          artworkUrl,
          quality: i % 2 === 0 ? 'Hi-Res' : 'FLAC',
          isExplicit: Boolean(item.explicit_lyrics),
          year
        })
      }
    }
  } catch (err) {
    console.warn('Deezer trending chart fetch error:', err)
  }

  // 2. Fetch Deezer Editorial Releases (Hot & New Releases)
  try {
    const res = await net.fetch('https://api.deezer.com/editorial/0/releases?limit=50', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const title = (item.title || '').trim()
        const artist = (item.artist?.name || '').trim()
        if (!title || !artist) continue

        const artworkUrl = item.cover_xl || item.cover_big || item.cover_medium || item.cover || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        if (item.record_type === 'single' || item.nb_tracks <= 2) {
          hotNewSongs.push({
            id: `deezer-rel-${item.id}`,
            title,
            artist,
            album: title,
            duration: 195,
            artworkUrl,
            quality: 'Hi-Res',
            isExplicit: Boolean(item.explicit_lyrics),
            year
          })
        } else {
          hotNewAlbums.push({
            id: `deezer-alb-${item.id}`,
            title,
            artist,
            artworkUrl,
            year,
            songCount: Number(item.nb_tracks) || 10
          })
        }
      }
    }
  } catch (err) {
    console.warn('Deezer editorial releases fetch error:', err)
  }

  // 3. Fetch Deezer Chart Albums (Recommended Albums)
  try {
    const res = await net.fetch('https://api.deezer.com/chart/0/albums?limit=30', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      const list = data?.data || []
      for (const item of list) {
        const title = (item.title || '').trim()
        const artist = (item.artist?.name || '').trim()
        if (!title || !artist) continue

        const artworkUrl = item.cover_xl || item.cover_big || item.cover_medium || ''
        const year = item.release_date ? new Date(item.release_date).getFullYear() : new Date().getFullYear()

        recommendedAlbums.push({
          id: `deezer-chart-alb-${item.id}`,
          title,
          artist,
          artworkUrl,
          year,
          songCount: 12
        })
      }
    }
  } catch (err) {
    console.warn('Deezer chart albums fetch error:', err)
  }

  // 4. Apple Music Fallback if Deezer was blocked or incomplete
  if (trendingSongs.length === 0) {
    try {
      const itunesRes = await net.fetch('https://itunes.apple.com/us/rss/topsongs/limit=50/json')
      if (itunesRes.ok) {
        const data = await itunesRes.json()
        const entries = data?.feed?.entry || []
        entries.forEach((entry: any, i: number) => {
          const rawTitle = entry?.['im:name']?.label || entry?.title?.label || ''
          const rawArtist = entry?.['im:artist']?.label || ''
          const rawImages = entry?.['im:image'] || []
          const rawArtwork = rawImages[rawImages.length - 1]?.label || ''
          const artworkUrl = rawArtwork.replace(/\/\d+x\d+bb\./, '/600x600bb.')

          trendingSongs.push({
            id: entry?.id?.attributes?.['im:id'] || `itunes-${i}`,
            title: rawTitle,
            artist: rawArtist,
            album: entry?.['im:collection']?.['im:name']?.label || '',
            duration: 180 + ((i * 13) % 90),
            artworkUrl,
            quality: 'FLAC',
            year: '2025'
          })
        })
      }
    } catch (err) {
      console.warn('Apple Music trending fallback failed:', err)
    }
  }

  if (hotNewSongs.length === 0) {
    hotNewSongs.push(...trendingSongs.slice(0, 20))
  }

  if (recommendedAlbums.length === 0) {
    try {
      const itunesAlbRes = await net.fetch('https://itunes.apple.com/us/rss/topalbums/limit=30/json')
      if (itunesAlbRes.ok) {
        const data = await itunesAlbRes.json()
        const entries = data?.feed?.entry || []
        entries.forEach((entry: any, i: number) => {
          const rawTitle = entry?.['im:name']?.label || ''
          const rawArtist = entry?.['im:artist']?.label || ''
          const rawImages = entry?.['im:image'] || []
          const rawArtwork = rawImages[rawImages.length - 1]?.label || ''
          const artworkUrl = rawArtwork.replace(/\/\d+x\d+bb\./, '/600x600bb.')

          recommendedAlbums.push({
            id: entry?.id?.attributes?.['im:id'] || `itunes-alb-${i}`,
            title: rawTitle,
            artist: rawArtist,
            artworkUrl,
            year: '2025',
            songCount: Number(entry?.['im:itemCount']?.label) || 12
          })
        })
      }
    } catch (err) {
      console.warn('Apple Music albums fallback failed:', err)
    }
  }

  if (hotNewAlbums.length === 0) {
    hotNewAlbums.push(...recommendedAlbums.slice(0, 12))
  }

  const result: ExploreFeedData = {
    trendingSongs,
    hotNewSongs,
    recommendedAlbums,
    hotNewAlbums
  }

  exploreFeedCache = { data: result, fetchedAt: Date.now() }
  return result
}

async function fetchDeezerChartProxy(genreId?: number, limit = 50): Promise<any | null> {
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

async function fetchDeezerRecommendationsForArtist(artistName: string): Promise<any[]> {
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

function isPlaceholderLyricsValue(value?: string): boolean {
  return /^(?:unknown|untitled|n\/?a|none|null)(?:\s+(?:artist|album|track))?$/i.test(
    value?.trim() || ''
  )
}

function resolveLyricsMetadata(songInfo: {
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

function hasLyrics(data: LrclibLyrics | null | undefined): data is LrclibLyrics {
  return Boolean(data?.syncedLyrics || data?.plainLyrics)
}

async function fetchLrclib(
  endpoint: '/get' | '/search',
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

function pickBestLyrics(
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

async function findLocalLyrics(songInfo: {
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

function getLyricsCacheKey(title: string, artist?: string): string {
  return `${cleanLyricsMetadata(title).toLowerCase()}:::${cleanLyricsMetadata(artist || '').toLowerCase()}`
}

function getCachedLyrics(title: string, artist?: string): LrclibLyrics | null {
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

function saveCachedLyrics(title: string, artist: string, lyrics: LrclibLyrics): void {
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

async function fetchLyricsFromLrclib(songInfo: {
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
      if (attempt < 2) await wait(400 * 2 ** attempt)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Lyrics transformation failed')
}

async function transformLyricBatch(
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
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.hostname === 'local') {
      let rawPath = decodeURIComponent(parsedUrl.pathname.slice(1))
      if (process.platform !== 'win32' && !rawPath.startsWith('/')) {
        rawPath = '/' + rawPath
      }
      return normalize(rawPath)
    }
  } catch {}

  // Backward-compatible support for older media:///C:/... URLs.
  let filePath = decodeURIComponent(url.replace(/^media:\/\//i, ''))
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

function isInsideDirectory(targetPath: string, parentDir: string): boolean {
  try {
    const normTarget = normalize(resolve(targetPath)).toLowerCase()
    const normParent = normalize(resolve(parentDir)).toLowerCase()
    const withSep = normParent.endsWith(path.sep) ? normParent : normParent + path.sep
    return normTarget === normParent || normTarget.startsWith(withSep)
  } catch {
    return false
  }
}

export function isPathAllowedForMedia(targetPath: string): boolean {
  try {
    const resolvedTarget = resolve(targetPath)
    const normalizedTarget = normalize(resolvedTarget).toLowerCase()
    const normalizedForward = normalizedTarget.replace(/\\/g, '/')
    const normalizedBackward = normalizedTarget.replace(/\//g, '\\')

    const userData = app.getPath('userData')
    if (isInsideDirectory(resolvedTarget, userData)) return true

    const resourcesDir = app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
    if (isInsideDirectory(resolvedTarget, resourcesDir)) return true

    try {
      const musicDir = app.getPath('music')
      if (isInsideDirectory(resolvedTarget, musicDir)) return true
    } catch {}

    const db = getDb()

    try {
      const row = db
        .prepare("SELECT value FROM app_settings WHERE key = 'download.location'")
        .get() as { value?: string } | undefined
      if (row?.value) {
        let parsed = row.value
        try {
          parsed = JSON.parse(row.value)
        } catch {
          parsed = row.value.replace(/^"|"$/g, '')
        }
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          if (isInsideDirectory(resolvedTarget, parsed.trim())) return true
        }
      }
    } catch {}

    const roots = db
      .prepare('SELECT path FROM library_roots WHERE isActive = 1')
      .all() as Array<{ path: string }>
    for (const root of roots) {
      if (root.path && isInsideDirectory(resolvedTarget, root.path)) {
        return true
      }
    }

    const song = db
      .prepare(
        'SELECT id FROM songs WHERE filePath = ? OR filePath = ? OR filePath = ? LIMIT 1'
      )
      .get(targetPath, normalizedForward, normalizedBackward)
    if (song) return true

    const songArtwork = db
      .prepare(
        'SELECT id FROM songs WHERE artworkPath = ? OR artworkPath = ? OR artworkPath = ? LIMIT 1'
      )
      .get(targetPath, normalizedForward, normalizedBackward)
    if (songArtwork) return true

    const album = db
      .prepare(
        'SELECT id FROM albums WHERE artworkPath = ? OR artworkPath = ? OR artworkPath = ? LIMIT 1'
      )
      .get(targetPath, normalizedForward, normalizedBackward)
    if (album) return true

    const contentType = getContentType(targetPath)
    if (contentType.startsWith('image/')) {
      const parentDirBackward = normalize(path.dirname(resolvedTarget)).toLowerCase().replace(/\//g, '\\')
      const songInSameDir = db
        .prepare(
          "SELECT id FROM songs WHERE LOWER(REPLACE(filePath, '/', '\\')) LIKE ? || '\\%' LIMIT 1"
        )
        .get(parentDirBackward)
      if (songInSameDir) return true
    }

    return false
  } catch {
    return false
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
      // Keep authenticated playback commands and status responsive while minimized.
      backgroundThrottling: false,
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

  // Only allow opening safe external URLs (http/https/mailto) in the system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
        shell.openExternal(details.url)
      } else {
        console.warn('[Security] Blocked window.open with unsafe protocol:', details.url)
      }
    } catch {
      console.warn('[Security] Blocked invalid window.open URL:', details.url)
    }
    return { action: 'deny' }
  })

  // Prevent renderer window from navigating away from the bundled app origin
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      if (navigationUrl.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    }
    event.preventDefault()
    console.warn('[Security] Intercepted and blocked unexpected navigation to:', navigationUrl)
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
  DownloadService.getProviderInfo().then((info) => {
    console.log(`[Felo Engine] Mode: ${info.mode.toUpperCase()} · Sources: [${info.sources.join(' | ')}]`)
  })

  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('felo', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('felo')
  }

  // Register display media request handler for system audio loopback capture
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' })
        } else {
          callback({})
        }
      })
      .catch((err) => {
        console.error('[DesktopAudio] Failed to get desktop sources for display media:', err)
        callback({})
      })
  })

  // Register the media:// protocol handler for streaming local audio
  protocol.handle('media', (request) => {
    const filePath = resolveMediaPath(request.url)

    // Security: verify the file exists and is within a registered library root or asset folder
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }

    if (!isPathAllowedForMedia(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }

    const contentType = getContentType(filePath)
    if (contentType.startsWith('image/')) {
      try {
        const imageBuffer = fs.readFileSync(filePath)
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        })
      } catch {
        return new Response('Error reading image', { status: 500 })
      }
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
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const win =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0]

    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'Select a music folder'
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select a music folder'
        })

    if (!canceled && filePaths.length > 0) {
      return filePaths[0]
    }
    return null
  })

  // Desktop Audio Loopback: enumerate capture sources
  ipcMain.handle('desktopAudio:getSources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 200, height: 120 }
      })
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null
      }))
    } catch (err) {
      console.error('[DesktopAudio] Failed to enumerate desktop sources:', err)
      return []
    }
  })

  let currentScanAbortController: AbortController | null = null

  // Library: Scan a folder
  ipcMain.handle('library:scan', async (event, folderPath: string) => {
    try {
      const validatedPath = validateWith(SafeFolderPathSchema, folderPath)
      const resolved = resolve(validatedPath)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        console.warn('[Library] Folder does not exist or is not a directory:', resolved)
        if (!event.sender.isDestroyed()) {
          event.sender.send('library:scan-progress', {
            status: 'error',
            folderPath: resolved,
            folderName: path.basename(resolved),
            totalFiles: 0,
            processedFiles: 0,
            addedCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            percent: 0,
            error: 'Selected folder does not exist or is not a directory.'
          })
        }
        return 0
      }
      currentScanAbortController?.abort()
      const abortController = new AbortController()
      currentScanAbortController = abortController

      const onProgress = (progress: any) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('library:scan-progress', progress)
          }
        } catch {
          // window destroyed/closed
        }
      }

      try {
        return await LibraryService.scanFolder(resolved, onProgress, abortController.signal)
      } finally {
        if (currentScanAbortController === abortController) {
          currentScanAbortController = null
        }
      }
    } catch (err: any) {
      console.warn('[Library] Blocked invalid scan folder path:', err)
      if (!event.sender.isDestroyed()) {
        event.sender.send('library:scan-progress', {
          status: 'error',
          folderPath: typeof folderPath === 'string' ? folderPath : '',
          folderName: typeof folderPath === 'string' ? path.basename(folderPath) : 'Folder',
          totalFiles: 0,
          processedFiles: 0,
          addedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          percent: 0,
          error: err?.message || 'Folder path could not be validated.'
        })
      }
      return 0
    }
  })

  // Library: Cancel active scan
  ipcMain.handle('library:cancel-scan', async () => {
    if (currentScanAbortController) {
      currentScanAbortController.abort()
      currentScanAbortController = null
      return true
    }
    return false
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
    try {
      const validRootId = validateWith(SafeEntityIdSchema, rootId)
      LibraryService.removeLibraryRoot(validRootId)
    } catch (err) {
      console.warn('[Library] Blocked invalid root ID for removal:', err)
    }
  })

  // Library: Remove a song from the database only
  ipcMain.handle('library:removeSong', (_, songId: string) => {
    try {
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      LibraryService.removeSong(validSongId)
    } catch (err) {
      console.warn('[Library] Blocked invalid song ID for removal:', err)
    }
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
    return LibraryService.searchArtists(query)
  })

  // Library: Search albums
  ipcMain.handle('library:searchAlbums', (_, query: string) => {
    return LibraryService.searchAlbums(query)
  })

  // Playlists
  ipcMain.handle('playlists:list', () => PlaylistService.getPlaylists())
  ipcMain.handle('playlists:get', (_, playlistId: string) => {
    try {
      const validId = validateWith(SafeEntityIdSchema, playlistId)
      return PlaylistService.getPlaylist(validId)
    } catch {
      return null
    }
  })
  ipcMain.handle(
    'playlists:create',
    (_, input: any) => {
      const validatedInput = validateWith(PlaylistCreateSchema, input)
      return PlaylistService.createPlaylist(validatedInput)
    }
  )
  ipcMain.handle('playlists:fetchImportMetadata', (_, url: string) =>
    fetchPlaylistImportMetadata(url)
  )
  ipcMain.handle(
    'playlists:fetchSpotifyTracks',
    async (_, playlistId: string) => {
      return fetchSpotifyPlaylistTracks(playlistId)
    }
  )
  ipcMain.handle(
    'home:fetchAotyAlbums',
    async (_, category: string) => {
      return fetchAotyAlbums((category as any) || 'must-hear')
    }
  )
  ipcMain.handle('home:fetchExploreFeed', async () => {
    return fetchExploreFeed()
  })
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
  ipcMain.handle('playlists:delete', (_, playlistId: string) => {
    try {
      const validId = validateWith(SafeEntityIdSchema, playlistId)
      return PlaylistService.deletePlaylist(validId)
    } catch {
      return false
    }
  })
  ipcMain.handle('playlists:rename', (_, playlistId: string, name: string) => {
    const validated = validateWith(PlaylistRenameSchema, { playlistId, name })
    return PlaylistService.renamePlaylist(validated.playlistId, validated.name)
  })
  ipcMain.handle('playlists:addSong', (_, playlistId: string, songId: string) => {
    try {
      const validPlaylistId = validateWith(SafeEntityIdSchema, playlistId)
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      return PlaylistService.addSong(validPlaylistId, validSongId)
    } catch {
      return null
    }
  })
  ipcMain.handle('playlists:removeSong', (_, playlistId: string, songId: string) => {
    try {
      const validPlaylistId = validateWith(SafeEntityIdSchema, playlistId)
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      return PlaylistService.removeSong(validPlaylistId, validSongId)
    } catch {
      return null
    }
  })

  // Playback Ledger & History (Industry Standard Scrobble)
  ipcMain.handle('playback:recordPlay', async (_, payload: any) => {
    try {
      const validatedPayload = validateWith(PlayRecordSchema, payload)
      return recordPlayEvent(validatedPayload)
    } catch (err) {
      console.warn('[Playback] Blocked invalid play record:', err)
      return { success: false, playCount: 0 }
    }
  })
  ipcMain.handle('playback:getListeningHistory', async (_, limit?: number) => {
    return getListeningHistory(limit)
  })

  // Online Charts & Deezer Recommendations Proxy (bypasses browser CORS & adds resilience)
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

  // Lyrics: Fetch from LRCLIB/local in the main process to avoid renderer CORS failures
  ipcMain.handle(
    'lyrics:fetch',
    async (
      _,
      songInfo: unknown
    ) => {
      try {
        const validated = validateWith(LyricsFetchInputSchema, songInfo)
        return fetchLyricsFromLrclib(validated)
      } catch {
        return null
      }
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
    if (typeof key !== 'string') return null
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

  // Settings: Set (Whitelisted and validated keys only)
  ipcMain.handle('settings:set', (_, key: string, value: any) => {
    try {
      const validatedKey = validateWith(AllowedSettingsKeySchema, key)
      let serialized: string
      if (validatedKey === 'download.location') {
        const validatedLocation = validateWith(
          DownloadLocationSchema,
          typeof value === 'string' ? value : ''
        )
        serialized = JSON.stringify(validatedLocation)
      } else {
        const validatedValue = validateWith(SettingValueSchema, value)
        serialized = typeof validatedValue === 'string' ? validatedValue : JSON.stringify(validatedValue)
      }
      const db = getDb()
      db.prepare(
        `
        INSERT OR REPLACE INTO app_settings (key, value, updatedAt)
        VALUES (?, ?, strftime('%s', 'now'))
      `
      ).run(validatedKey, serialized)
    } catch (err) {
      console.warn(`[Settings] Rejected disallowed or invalid setting "${key}":`, err)
      throw new Error(`Invalid or protected setting key: ${key}`)
    }
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
    const validatedRequest = validateWith(StartDownloadRequestSchema, request)
    return DownloadService.start(validatedRequest)
  })

  ipcMain.handle('downloads:cancel', (_, transferId: string) => {
    try {
      const validTransferId = validateWith(TransferIdSchema, transferId)
      return DownloadService.cancel(validTransferId)
    } catch {
      return false
    }
  })

  ipcMain.handle('downloads:checkDependencies', async () => {
    return DownloadService.checkDependencies()
  })

  ipcMain.handle('downloads:installDependencies', async (event) => {
    return DownloadService.installDependencies((chunk) => {
      event.sender.send('downloads:installLog', chunk)
    })
  })

  ipcMain.handle('downloads:acquireAndDownload', async (_, query: string, artist?: string) => {
    return DownloadService.acquireAndDownload(query, artist)
  })

  // System: Get app version
  ipcMain.handle('system:getVersion', () => {
    return app.getVersion()
  })

  // System: Get app mode and active streaming providers
  ipcMain.handle('system:getAppMode', async () => {
    return DownloadService.getProviderInfo()
  })

  ipcMain.handle('system:checkForUpdates', () => checkGithubRelease())

  // System: Open external URL (strictly validated to http/https/mailto)
  ipcMain.handle('system:openExternal', (_, url: string) => {
    try {
      const validUrl = validateWith(SafeExternalUrlSchema, url)
      shell.openExternal(validUrl)
    } catch (err) {
      console.warn('[Security] Blocked attempt to open external unsafe URL:', url, err)
    }
  })

  // System: Reveal file or open directory in explorer (path containment verified)
  ipcMain.handle('system:revealFile', (_, targetPath: string) => {
    if (targetPath && typeof targetPath === 'string' && fs.existsSync(targetPath)) {
      const resolved = resolve(targetPath)
      if (isPathAllowedForMedia(resolved)) {
        try {
          if (fs.statSync(resolved).isDirectory()) {
            shell.openPath(resolved)
          } else {
            shell.showItemInFolder(resolved)
          }
        } catch {
          // Do not execute shell.openPath on files
        }
      } else {
        console.warn('[Security] Blocked system:revealFile for path outside media/library:', resolved)
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
  // Music Presence: Setup & Status integration IPC
  ipcMain.handle('system:setupMusicPresence', () => {
    return runMusicPresenceSetupScript()
  })
  ipcMain.handle('system:getMusicPresenceStatus', () => {
    return getMusicPresenceStatus()
  })
  ipcMain.handle('system:launchMusicPresence', () => {
    return launchMusicPresence()
  })

  const playbackControl = new PlaybackControlService()
  playbackControl.initialize()
  app.on('before-quit', () => playbackControl.stop())

  const remoteControl = new RemoteControlService()
  remoteControl.initialize()
  app.on('before-quit', () => remoteControl.stop())

  const discordBot = new DiscordBotService()
  discordBot.initialize()
  app.on('before-quit', () => discordBot.disconnect())
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
        LibraryService.scanFolder(root.path, (progress) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('library:scan-progress', progress)
          }
        })
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
