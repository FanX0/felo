import { app, shell, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron'
import { join, normalize, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb } from './database'
import { LibraryService } from './services/LibraryService'
import { PlaylistService } from './services/PlaylistService'
import { DownloadService } from './services/DownloadService'
import fs from 'fs'
import { Readable } from 'stream'

// Ensure DB is initialized
getDb()

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
  if (!response.ok) throw new Error(`MusicBrainz ${entity} search failed (${response.status})`)
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
  return value
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
    .replace(
      /\s*[\(\[](?:explicit|official\s*(?:video|audio|music\s*video|lyric\s*video)?|lyrics?|remaster(?:ed)?(?:\s*[\d\w]+)?|hq|hd|visualizer|feat\.?.*?|ft\.?.*?|single\s*version|bonus\s*track|deluxe(?:\s*edition)?|live(?:\s*at\s*.*)?)[\)\]]\s*/gi,
      ' '
    )
    .replace(/\bunknown\s*artist\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
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

function scoreLyricsCandidate(candidate: LrclibLyrics, track: string, artist: string): number {
  if (!hasLyrics(candidate)) return -1

  const candidateTrack = normalizeForCompare(candidate.trackName)
  const candidateArtist = normalizeForCompare(candidate.artistName)
  const targetTrack = normalizeForCompare(track)
  const targetArtist = normalizeForCompare(artist)
  let score = candidate.syncedLyrics ? 30 : 10

  if (candidateTrack === targetTrack) score += 50
  else if (candidateTrack.includes(targetTrack) || targetTrack.includes(candidateTrack)) score += 25

  if (candidateArtist === targetArtist) score += 35
  else if (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist))
    score += 15

  return score
}

function pickBestLyrics(
  results: LrclibLyrics | LrclibLyrics[] | null,
  track: string,
  artist: string
): LrclibLyrics | null {
  if (!results) return null
  if (!Array.isArray(results)) return hasLyrics(results) ? results : null

  return (
    [...results]
      .filter(hasLyrics)
      .sort(
        (a, b) => scoreLyricsCandidate(b, track, artist) - scoreLyricsCandidate(a, track, artist)
      )[0] || null
  )
}

async function fetchLyricsFromLrclib(songInfo: {
  title: string
  artist: string
  album?: string
  duration?: number
}): Promise<LrclibLyrics | null> {
  const rawTrack = songInfo.title?.trim() || ''
  const rawArtist = songInfo.artist?.trim() || ''
  const rawAlbum = songInfo.album?.trim() || ''
  const cleanTrack = cleanLyricsMetadata(rawTrack)
  const cleanArtist = cleanLyricsMetadata(rawArtist)

  const attempts: Array<{
    endpoint: '/get' | '/get-cached' | '/search'
    params: URLSearchParams
    track: string
    artist: string
  }> = []

  if (cleanTrack && cleanArtist) {
    attempts.push({
      endpoint: '/get',
      params: new URLSearchParams({ track_name: cleanTrack, artist_name: cleanArtist }),
      track: cleanTrack,
      artist: cleanArtist
    })
    attempts.push({
      endpoint: '/get-cached',
      params: new URLSearchParams({ track_name: cleanTrack, artist_name: cleanArtist }),
      track: cleanTrack,
      artist: cleanArtist
    })
    attempts.push({
      endpoint: '/get',
      params: new URLSearchParams({ track_name: cleanArtist, artist_name: cleanTrack }),
      track: cleanArtist,
      artist: cleanTrack
    })
  }

  if ((rawTrack !== cleanTrack || rawArtist !== cleanArtist) && rawTrack && rawArtist) {
    const rawParams = new URLSearchParams({ track_name: rawTrack, artist_name: rawArtist })
    if (rawAlbum) rawParams.set('album_name', rawAlbum)
    if (songInfo.duration && songInfo.duration > 0) {
      rawParams.set('duration', String(Math.round(songInfo.duration)))
    }
    attempts.push({ endpoint: '/get', params: rawParams, track: rawTrack, artist: rawArtist })
  }

  const cleanQuery = `${cleanTrack} ${cleanArtist}`.trim()
  if (cleanQuery) {
    attempts.push({
      endpoint: '/search',
      params: new URLSearchParams({ q: cleanQuery }),
      track: cleanTrack,
      artist: cleanArtist
    })
  }

  const rawQuery = `${rawTrack} ${rawArtist}`.trim()
  if (rawQuery && rawQuery !== cleanQuery) {
    attempts.push({
      endpoint: '/search',
      params: new URLSearchParams({ q: rawQuery }),
      track: rawTrack,
      artist: rawArtist
    })
  }

  for (const attempt of attempts) {
    const data = await fetchLrclib(attempt.endpoint, attempt.params)
    const best = pickBestLyrics(data, attempt.track, attempt.artist)
    if (best) return best
  }

  return null
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

function testQobuzAccount(accounts: any) {
  const hasIdentity = isNonEmptyString(accounts?.qobuzUser)
  const hasSecret = isNonEmptyString(accounts?.qobuzSecret)
  const hasAppId = isNonEmptyString(accounts?.qobuzAppId)
  const hasAppSecret = isNonEmptyString(accounts?.qobuzAppSecret)

  if (!hasIdentity || !hasSecret) {
    return {
      status: 'error',
      message: 'Qobuz test failed: email/user ID and auth token are required.'
    }
  }

  if (!hasAppId || !hasAppSecret) {
    return {
      status: 'error',
      message: 'Qobuz test failed: App ID and App Secret are required.'
    }
  }

  return {
    status: 'success',
    message: 'Qobuz configuration is complete. Ready for an authorized connector.'
  }
}

function testDeezerAccount(accounts: any) {
  const arl = typeof accounts?.deezerArl === 'string' ? accounts.deezerArl.trim() : ''

  if (!arl) {
    return {
      status: 'error',
      message: 'Deezer test failed: ARL cookie token is required.'
    }
  }

  if (arl.length < 64) {
    return {
      status: 'error',
      message: 'Deezer test failed: ARL token looks too short.'
    }
  }

  return {
    status: 'success',
    message: 'Deezer configuration is complete. Ready for an authorized connector.'
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
    ...(process.platform === 'linux' ? { icon } : {}),
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
  ipcMain.handle('playlists:delete', (_, playlistId: string) =>
    PlaylistService.deletePlaylist(playlistId)
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
    return searchAppleMusic(query)
  })

  // Apple Music: fetch a fuller song catalog for one artist page.
  ipcMain.handle('search:appleMusicArtistSongs', async (_, artistName: string) => {
    if (typeof artistName !== 'string' || !artistName.trim()) return []
    return searchAppleMusicArtistSongs(artistName)
  })

  // MusicBrainz: search recordings, artists, and release groups in the main process.
  ipcMain.handle('search:musicBrainz', async (_, query: string) => {
    if (typeof query !== 'string' || !query.trim()) {
      return { 'Top Results': [], Artists: [], Albums: [], Songs: [] }
    }
    return searchMusicBrainz(query)
  })

  // Lyrics: Fetch from LRCLIB in the main process to avoid renderer CORS failures
  ipcMain.handle(
    'lyrics:fetch',
    async (_, songInfo: { title: string; artist: string; album?: string; duration?: number }) => {
      if (!songInfo?.title || !songInfo?.artist) return null
      return fetchLyricsFromLrclib(songInfo)
    }
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
      return { status: 'success', message: 'Qobuz authentication and provider search succeeded.' }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('streaming:testDeezer', async (_, accounts: any) => {
    const validation = testDeezerAccount(accounts)
    if (validation.status === 'error') return validation
    try {
      await DownloadService.search('deezer', 'Daft Punk One More Time', accounts)
      return { status: 'success', message: 'Deezer authentication and provider search succeeded.' }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(
    'downloads:search',
    async (_, source: 'qobuz' | 'deezer', query: string, accounts: any) => {
      if (source !== 'qobuz' && source !== 'deezer') {
        throw new Error(`The ${source} download connector is not available.`)
      }
      return DownloadService.search(source, query, accounts || {})
    }
  )

  ipcMain.handle('downloads:start', (_, request: any) => {
    if (!request || (request.source !== 'qobuz' && request.source !== 'deezer')) {
      throw new Error('Invalid streaming download request.')
    }
    return DownloadService.start(request)
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

  // System: Reveal file in explorer
  ipcMain.handle('system:revealFile', (_, filePath: string) => {
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      shell.showItemInFolder(resolve(filePath))
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
