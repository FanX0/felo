import { parseBlob, selectCover } from 'music-metadata'

interface CatalogSearchItem {
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
  releaseId?: string
  releaseGroupId?: string
}

type CatalogSearchResults = Record<
  'Top Results' | 'Artists' | 'Albums' | 'Songs',
  CatalogSearchItem[]
>

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

const WEB_FOLDER_TOKEN = 'felo-web-folder'
const WEB_LIBRARY_DB = 'felo-web-library'
const WEB_LIBRARY_STORE = 'roots'
const WEB_LIBRARY_FILES_STORE = 'files'
const WEB_PLAYLISTS_KEY = 'felo-web-playlists'
const supportedAudioExtensions = new Set(['mp3', 'flac', 'm4a', 'wav', 'ogg', 'opus', 'aac', 'wma'])
const audioMimeTypes: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma'
}
const browserSongs = new Map<string, any>()
interface BrowserPlaylistRecord {
  id: string
  name: string
  description: string
  songIds: string[]
  dateCreated: number
  dateModified: number
}
interface BrowserDirectoryHandle {
  kind: 'directory'
  name: string
  entries: () => AsyncIterableIterator<[string, BrowserEntryHandle]>
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
}

interface BrowserFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}

type BrowserEntryHandle = BrowserDirectoryHandle | BrowserFileHandle

interface BrowserRoot {
  id: string
  path: string
  label: string
  dateAdded: number
  handle?: BrowserDirectoryHandle
}

interface PersistedBrowserFile {
  id: string
  rootId: string
  relativePath: string
  file: File
}

const browserRoots = new Map<string, BrowserRoot>()
let pendingFiles: Array<{ file: File; relativePath: string }> = []
let pendingFolderName = 'Browser folder'
let pendingDirectoryHandle: BrowserDirectoryHandle | undefined
let databasePromise: Promise<IDBDatabase> | null = null
let browserLibraryPromise: Promise<void> | null = null

function openBrowserLibraryDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_LIBRARY_DB, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WEB_LIBRARY_STORE)) {
        request.result.createObjectStore(WEB_LIBRARY_STORE, { keyPath: 'id' })
      }
      if (!request.result.objectStoreNames.contains(WEB_LIBRARY_FILES_STORE)) {
        const filesStore = request.result.createObjectStore(WEB_LIBRARY_FILES_STORE, {
          keyPath: 'id'
        })
        filesStore.createIndex('rootId', 'rootId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}

async function readPersistedRoots(): Promise<BrowserRoot[]> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(WEB_LIBRARY_STORE, 'readonly')
      .objectStore(WEB_LIBRARY_STORE)
      .getAll()
    request.onsuccess = () => resolve(request.result as BrowserRoot[])
    request.onerror = () => reject(request.error)
  })
}

async function persistRoot(root: BrowserRoot): Promise<void> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(WEB_LIBRARY_STORE, 'readwrite')
      .objectStore(WEB_LIBRARY_STORE)
      .put(root)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function deletePersistedRoot(rootId: string): Promise<void> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [WEB_LIBRARY_STORE, WEB_LIBRARY_FILES_STORE],
      'readwrite'
    )
    transaction.objectStore(WEB_LIBRARY_STORE).delete(rootId)
    const cursorRequest = transaction
      .objectStore(WEB_LIBRARY_FILES_STORE)
      .index('rootId')
      .openKeyCursor(IDBKeyRange.only(rootId))
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      transaction.objectStore(WEB_LIBRARY_FILES_STORE).delete(cursor.primaryKey)
      cursor.continue()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

function persistedFileId(root: BrowserRoot, file: File, relativePath: string): string {
  return stableId(`${root.label}:${relativePath}:${file.size}:${file.lastModified}`)
}

async function readPersistedFiles(
  rootId: string
): Promise<Array<{ file: File; relativePath: string }>> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(WEB_LIBRARY_FILES_STORE, 'readonly')
      .objectStore(WEB_LIBRARY_FILES_STORE)
      .index('rootId')
      .getAll(IDBKeyRange.only(rootId))
    request.onsuccess = () => {
      resolve(
        (request.result as PersistedBrowserFile[]).map(({ file, relativePath }) => ({
          file,
          relativePath
        }))
      )
    }
    request.onerror = () => reject(request.error)
  })
}

async function replacePersistedFiles(
  root: BrowserRoot,
  files: Array<{ file: File; relativePath: string }>
): Promise<void> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WEB_LIBRARY_FILES_STORE, 'readwrite')
    const store = transaction.objectStore(WEB_LIBRARY_FILES_STORE)
    const cursorRequest = store.index('rootId').openKeyCursor(IDBKeyRange.only(root.id))
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (cursor) {
        store.delete(cursor.primaryKey)
        cursor.continue()
        return
      }

      files.forEach(({ file, relativePath }) => {
        const record: PersistedBrowserFile = {
          id: persistedFileId(root, file, relativePath),
          rootId: root.id,
          relativePath,
          file
        }
        store.put(record)
      })
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

async function deletePersistedFile(songId: string): Promise<void> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(WEB_LIBRARY_FILES_STORE, 'readwrite')
      .objectStore(WEB_LIBRARY_FILES_STORE)
      .delete(songId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function stableId(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `web-${(hash >>> 0).toString(16)}`
}

function formatCatalogDuration(milliseconds: unknown): string | null {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return null
  const totalSeconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function normalizeCatalogString(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function catalogArtistMatches(candidate: string, target: string): boolean {
  const splitArtists = (value: string) =>
    value
      .replace(/\b(feat|ft|featuring)\.?\b/gi, ',')
      .split(/,|&|\+| x | × | and /i)
      .map(normalizeCatalogString)
      .filter(Boolean)
  const candidateParts = splitArtists(candidate)
  const targetParts = splitArtists(target)

  return candidateParts.some((candidatePart) =>
    targetParts.some(
      (targetPart) =>
        candidatePart === targetPart ||
        candidatePart.includes(targetPart) ||
        targetPart.includes(candidatePart)
    )
  )
}

function formatItunesSong(item: any, index: number): CatalogSearchItem | null {
  if (item?.wrapperType !== 'track' || item?.kind !== 'song') return null

  return {
    id: String(item.trackId || `${item.trackName}-${index}`),
    title: String(item.trackName || 'Unknown Track'),
    artist: String(item.artistName || ''),
    album: String(item.collectionName || ''),
    type: 'Song',
    duration: formatCatalogDuration(item.trackTimeMillis),
    trackCount: typeof item.trackCount === 'number' ? item.trackCount : null,
    url: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : '',
    thumbnail:
      typeof item.artworkUrl100 === 'string'
        ? item.artworkUrl100.replace('100x100bb', '600x600bb')
        : '',
    explicit: item.trackExplicitness === 'explicit'
  }
}

function formatItunesArtist(item: any, index: number): CatalogSearchItem | null {
  if (item?.wrapperType !== 'artist') return null

  return {
    id: String(item.artistId || `${item.artistName}-${index}`),
    title: String(item.artistName || 'Unknown Artist'),
    artist: String(item.primaryGenreName || ''),
    album: '',
    type: 'Artist',
    duration: null,
    trackCount: null,
    url: typeof item.artistLinkUrl === 'string' ? item.artistLinkUrl : '',
    thumbnail: '',
    explicit: false
  }
}

function formatItunesAlbum(item: any, index: number): CatalogSearchItem | null {
  if (item?.wrapperType !== 'collection') return null

  return {
    id: String(item.collectionId || `${item.collectionName}-${index}`),
    title: String(item.collectionName || 'Unknown Album'),
    artist: String(item.artistName || ''),
    album: String(item.primaryGenreName || 'Album'),
    type: 'Album',
    duration: null,
    trackCount: typeof item.trackCount === 'number' ? item.trackCount : null,
    url: typeof item.collectionViewUrl === 'string' ? item.collectionViewUrl : '',
    thumbnail:
      typeof item.artworkUrl100 === 'string'
        ? item.artworkUrl100.replace('100x100bb', '600x600bb')
        : '',
    explicit: item.collectionExplicitness === 'explicit'
  }
}

async function fetchJson(url: string, errorLabel: string): Promise<any> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${errorLabel} failed (${response.status})`)
    return response.json()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${errorLabel} timed out`)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

function fetchItunesJsonp(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const callbackName = `__feloItunes_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const callbackWindow = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    const separator = url.includes('?') ? '&' : '?'
    const timeout = window.setTimeout(
      () => finish(new Error('Apple Music search timed out')),
      10000
    )

    const finish = (error?: Error, data?: unknown) => {
      window.clearTimeout(timeout)
      script.remove()
      delete callbackWindow[callbackName]
      if (error) reject(error)
      else resolve(data)
    }

    callbackWindow[callbackName] = (data: unknown) => finish(undefined, data)
    script.onerror = () => finish(new Error('Apple Music search could not be loaded'))
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`
    document.head.appendChild(script)
  })
}

async function fetchBrowserItunes(url: string): Promise<any> {
  try {
    return await fetchJson(url, 'Apple Music search')
  } catch (error) {
    console.warn('Apple Music fetch failed; retrying with JSONP:', error)
    return fetchItunesJsonp(url)
  }
}

async function searchBrowserAppleMusic(query: string): Promise<CatalogSearchResults> {
  const cleanQuery = query.trim()
  const results: CatalogSearchResults = {
    'Top Results': [],
    Artists: [],
    Albums: [],
    Songs: []
  }
  if (!cleanQuery) return results

  const searchEntity = (entity: 'song' | 'musicArtist' | 'album', limit: number) => {
    const params = new URLSearchParams({
      term: cleanQuery,
      media: 'music',
      entity,
      limit: String(limit),
      country: 'US'
    })
    return fetchBrowserItunes(`https://itunes.apple.com/search?${params.toString()}`)
  }
  const responses = await Promise.allSettled([
    searchEntity('song', 35),
    searchEntity('musicArtist', 18),
    searchEntity('album', 18)
  ])
  if (responses.every((response) => response.status === 'rejected')) {
    throw new Error('Apple Music search is unavailable in this browser.')
  }

  const responseItems = (index: number): any[] => {
    const response = responses[index]
    return response.status === 'fulfilled' && Array.isArray(response.value?.results)
      ? response.value.results
      : []
  }
  const songs = responseItems(0)
    .map(formatItunesSong)
    .filter((item): item is CatalogSearchItem => Boolean(item))
  const artists = responseItems(1)
    .map(formatItunesArtist)
    .filter((item): item is CatalogSearchItem => Boolean(item))
  const albums = responseItems(2)
    .map(formatItunesAlbum)
    .filter((item): item is CatalogSearchItem => Boolean(item))

  results.Songs = songs
  results.Artists = artists
  results.Albums = albums
  results['Top Results'] = songs.slice(0, 1).length
    ? songs.slice(0, 1)
    : artists.slice(0, 1).length
      ? artists.slice(0, 1)
      : albums.slice(0, 1)

  return results
}

async function searchBrowserAppleMusicArtistSongs(
  artistName: string
): Promise<CatalogSearchItem[]> {
  const cleanArtist = artistName.trim()
  if (!cleanArtist) return []

  const artistParams = new URLSearchParams({
    term: cleanArtist,
    entity: 'musicArtist',
    attribute: 'artistTerm',
    limit: '10',
    country: 'US'
  })
  const allSongs: CatalogSearchItem[] = []

  try {
    const artistSearch = await fetchBrowserItunes(
      `https://itunes.apple.com/search?${artistParams.toString()}`
    )
    const artistIds = (Array.isArray(artistSearch?.results) ? artistSearch.results : [])
      .filter((item: any) => catalogArtistMatches(String(item.artistName || ''), cleanArtist))
      .map((item: any) => item.artistId)
      .filter((id: unknown) => typeof id === 'number')
      .slice(0, 3)

    for (const artistId of artistIds) {
      const lookupParams = new URLSearchParams({
        id: String(artistId),
        entity: 'song',
        limit: '200',
        country: 'US'
      })
      const lookup = await fetchBrowserItunes(
        `https://itunes.apple.com/lookup?${lookupParams.toString()}`
      )
      ;(Array.isArray(lookup?.results) ? lookup.results : []).forEach(
        (item: any, index: number) => {
          const song = formatItunesSong(item, index)
          if (song && catalogArtistMatches(song.artist, cleanArtist)) allSongs.push(song)
        }
      )
    }
  } catch (error) {
    console.warn('Browser Apple Music artist lookup failed:', error)
  }

  const songParams = new URLSearchParams({
    term: cleanArtist,
    entity: 'song',
    attribute: 'artistTerm',
    limit: '200',
    country: 'US'
  })
  try {
    const songSearch = await fetchBrowserItunes(
      `https://itunes.apple.com/search?${songParams.toString()}`
    )
    ;(Array.isArray(songSearch?.results) ? songSearch.results : []).forEach(
      (item: any, index: number) => {
        const song = formatItunesSong(item, index)
        if (song && catalogArtistMatches(song.artist, cleanArtist)) allSongs.push(song)
      }
    )
  } catch (error) {
    console.warn('Browser Apple Music artist song search failed:', error)
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

function formatMusicBrainzRecording(item: any, index: number): CatalogSearchItem {
  const releases = Array.isArray(item?.releases) ? item.releases : []
  const release = releases.find((candidate: any) => candidate?.title || candidate?.id)

  return {
    id: String(item?.id || `recording-${index}`),
    title: String(item?.title || 'Unknown Recording'),
    artist: musicBrainzArtistCredit(item?.['artist-credit']),
    album: String(release?.title || ''),
    type: 'Song',
    duration: formatCatalogDuration(item?.length),
    trackCount: null,
    url: musicBrainzUrl('recording', item?.id),
    thumbnail:
      typeof release?.id === 'string'
        ? `https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-250`
        : '',
    explicit: false,
    releaseId: typeof release?.id === 'string' ? release.id : undefined
  }
}

function formatMusicBrainzArtist(item: any, index: number): CatalogSearchItem {
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

async function fetchMusicBrainzEntity(
  entity: 'artist' | 'recording' | 'release-group',
  query: string,
  limit: number
): Promise<any[]> {
  const params = new URLSearchParams({
    query,
    fmt: 'json',
    limit: String(limit),
    dismax: 'true'
  })
  const data = await fetchJson(
    `https://musicbrainz.org/ws/2/${entity}?${params.toString()}`,
    `MusicBrainz ${entity} search`
  )
  const key =
    entity === 'release-group'
      ? 'release-groups'
      : entity === 'recording'
        ? 'recordings'
        : 'artists'
  return Array.isArray(data?.[key]) ? data[key] : []
}

async function searchBrowserMusicBrainz(query: string): Promise<CatalogSearchResults> {
  const cleanQuery = query.trim()
  const results: CatalogSearchResults = {
    'Top Results': [],
    Artists: [],
    Albums: [],
    Songs: []
  }
  if (!cleanQuery) return results

  const recordings = await fetchMusicBrainzEntity('recording', cleanQuery, 25)
  const songs = recordings.map(formatMusicBrainzRecording)

  const artistMap = new Map<string, any>()
  const albumMap = new Map<string, CatalogSearchItem>()
  recordings.forEach((recording: any) => {
    ;(Array.isArray(recording?.['artist-credit']) ? recording['artist-credit'] : []).forEach(
      (credit: any) => {
        const artist = credit?.artist
        if (artist?.id && !artistMap.has(artist.id)) artistMap.set(artist.id, artist)
      }
    )

    ;(Array.isArray(recording?.releases) ? recording.releases : []).forEach((release: any) => {
      if (!release?.id || albumMap.has(release.id)) return
      const releaseGroupId = release?.['release-group']?.id
      albumMap.set(release.id, {
        id: String(release.id),
        title: String(release.title || 'Unknown Album'),
        artist: musicBrainzArtistCredit(recording?.['artist-credit']),
        album: String(release?.['release-group']?.['primary-type'] || 'Album'),
        type: 'Album',
        duration: null,
        trackCount: null,
        url: releaseGroupId
          ? musicBrainzUrl('release-group', releaseGroupId)
          : `https://musicbrainz.org/release/${encodeURIComponent(release.id)}`,
        thumbnail: `https://coverartarchive.org/release/${encodeURIComponent(release.id)}/front-250`,
        explicit: false,
        releaseId: String(release.id),
        releaseGroupId: typeof releaseGroupId === 'string' ? releaseGroupId : undefined
      })
    })
  })
  const mappedArtists = [...artistMap.values()].map(formatMusicBrainzArtist)
  const albums = [...albumMap.values()].slice(0, 18)

  try {
    const artworkParams = new URLSearchParams({
      term: cleanQuery,
      media: 'music',
      entity: 'song',
      limit: '50',
      country: 'US'
    })
    const artworkData = await fetchBrowserItunes(
      `https://itunes.apple.com/search?${artworkParams.toString()}`
    )
    const artworkItems = (Array.isArray(artworkData?.results) ? artworkData.results : [])
      .map(formatItunesSong)
      .filter((item): item is CatalogSearchItem => Boolean(item?.thumbnail))

    const matchingArtwork = (title: string, artist: string): string => {
      const normalizedTitle = normalizeCatalogString(title)
      const normalizedArtist = normalizeCatalogString(artist)
      const exact = artworkItems.find(
        (item) =>
          normalizeCatalogString(item.title) === normalizedTitle &&
          catalogArtistMatches(item.artist, normalizedArtist)
      )
      const titleMatch = artworkItems.find(
        (item) => normalizeCatalogString(item.title) === normalizedTitle
      )
      return exact?.thumbnail || titleMatch?.thumbnail || ''
    }

    songs.forEach((song) => {
      song.thumbnail = matchingArtwork(song.title, song.artist) || song.thumbnail
    })
    albums.forEach((album) => {
      const match = artworkItems.find(
        (item) => normalizeCatalogString(item.album) === normalizeCatalogString(album.title)
      )
      album.thumbnail = match?.thumbnail || album.thumbnail
    })
  } catch (error) {
    console.warn('MusicBrainz artwork fallback failed:', error)
  }

  return {
    'Top Results': songs.slice(0, 1).length ? songs.slice(0, 1) : mappedArtists.slice(0, 1),
    Songs: songs,
    Artists: mappedArtists,
    Albums: albums
  }
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
    const response = await fetch(`https://lrclib.net/api${endpoint}?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return null
    return (await response.json()) as LrclibLyrics | LrclibLyrics[]
  } catch (error) {
    console.warn(`LRCLIB ${endpoint} failed:`, error)
    return null
  }
}

function normalizeLyricsCompare(value?: string): string {
  return cleanLyricsMetadata(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreLyricsCandidate(candidate: LrclibLyrics, track: string, artist: string): number {
  if (!hasLyrics(candidate)) return -1

  const candidateTrack = normalizeLyricsCompare(candidate.trackName)
  const candidateArtist = normalizeLyricsCompare(candidate.artistName)
  const targetTrack = normalizeLyricsCompare(track)
  const targetArtist = normalizeLyricsCompare(artist)
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

async function fetchBrowserLyrics(songInfo: {
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
    const exactParams = new URLSearchParams({
      track_name: cleanTrack,
      artist_name: cleanArtist
    })
    if (rawAlbum) exactParams.set('album_name', cleanLyricsMetadata(rawAlbum))
    if (songInfo.duration && songInfo.duration > 0) {
      exactParams.set('duration', String(Math.round(songInfo.duration)))
    }
    attempts.push({
      endpoint: '/get',
      params: exactParams,
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
      params: new URLSearchParams({ track_name: cleanTrack, artist_name: cleanArtist }),
      track: cleanTrack,
      artist: cleanArtist
    })
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

function isAudioFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return file.type.startsWith('audio/') || supportedAudioExtensions.has(extension)
}

async function collectDirectoryFiles(
  directory: BrowserDirectoryHandle,
  parentPath = ''
): Promise<Array<{ file: File; relativePath: string }>> {
  const files: Array<{ file: File; relativePath: string }> = []
  for await (const [name, entry] of directory.entries()) {
    const relativePath = parentPath ? `${parentPath}/${name}` : name
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      if (isAudioFile(file)) files.push({ file, relativePath })
    } else if (entry.kind === 'directory') {
      files.push(...(await collectDirectoryFiles(entry, relativePath)))
    }
  }
  return files
}

function pickDirectoryWithInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.style.display = 'none'
    input.addEventListener(
      'change',
      () => {
        resolve(input.files)
        input.remove()
      },
      { once: true }
    )
    document.body.appendChild(input)
    input.click()
  })
}

async function selectBrowserFolder(): Promise<string | null> {
  try {
    const browserWindow = window as Window & {
      showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>
    }
    if (browserWindow.showDirectoryPicker) {
      const directory = await browserWindow.showDirectoryPicker()
      if (navigator.storage?.persist) {
        void navigator.storage.persist().catch(() => false)
      }
      pendingDirectoryHandle = directory
      pendingFolderName = directory.name || 'Browser folder'
      pendingFiles = await collectDirectoryFiles(directory)
    } else {
      pendingDirectoryHandle = undefined
      const files = await pickDirectoryWithInput()
      if (!files?.length) return null
      pendingFiles = Array.from(files)
        .filter(isAudioFile)
        .map((file) => ({
          file,
          relativePath:
            (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        }))
      pendingFolderName = pendingFiles[0]?.relativePath.split('/')[0] || 'Browser folder'
    }
    return pendingFiles.length ? WEB_FOLDER_TOKEN : null
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

function clearSongsForRoot(rootId: string): void {
  for (const [songId, song] of browserSongs) {
    if (song.rootId !== rootId) continue
    revokeBlobUrl(song.filePath)
    revokeBlobUrl(song.artworkPath)
    browserSongs.delete(songId)
  }
}

function revokeBlobUrl(url?: string): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

function readBrowserPlaylists(): BrowserPlaylistRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(WEB_PLAYLISTS_KEY) || '[]')
    return Array.isArray(value) ? (value as BrowserPlaylistRecord[]) : []
  } catch {
    return []
  }
}

function writeBrowserPlaylists(playlists: BrowserPlaylistRecord[]): void {
  localStorage.setItem(WEB_PLAYLISTS_KEY, JSON.stringify(playlists))
}

function browserPlaylistSummary(playlist: BrowserPlaylistRecord): any {
  const firstArtwork = playlist.songIds
    .map((songId) => browserSongs.get(songId)?.artworkPath)
    .find(Boolean)
  return {
    ...playlist,
    artworkPath: firstArtwork || null,
    songCount: playlist.songIds.filter((songId) => browserSongs.has(songId)).length
  }
}

function getBrowserPlaylist(playlistId: string): any | null {
  const playlist = readBrowserPlaylists().find((item) => item.id === playlistId)
  if (!playlist) return null
  return {
    ...browserPlaylistSummary(playlist),
    songs: playlist.songIds.flatMap((songId, index) => {
      const song = browserSongs.get(songId)
      return song
        ? [{ ...song, playlistDateAdded: playlist.dateModified, playlistSortOrder: index }]
        : []
    })
  }
}

function createBrowserPlaylist(input: {
  name: string
  description?: string
  songIds?: string[]
}): any {
  const name = input.name.trim()
  if (!name) throw new Error('Playlist name is required')
  const now = Math.floor(Date.now() / 1000)
  const playlist: BrowserPlaylistRecord = {
    id: crypto.randomUUID(),
    name,
    description: input.description?.trim() || '',
    songIds: [...new Set(input.songIds || [])].filter((songId) => browserSongs.has(songId)),
    dateCreated: now,
    dateModified: now
  }
  writeBrowserPlaylists([playlist, ...readBrowserPlaylists()])
  return getBrowserPlaylist(playlist.id)
}

function updateBrowserPlaylistSongs(
  playlistId: string,
  update: (songIds: string[]) => string[]
): any | null {
  const playlists = readBrowserPlaylists()
  const playlist = playlists.find((item) => item.id === playlistId)
  if (!playlist) return null
  playlist.songIds = update(playlist.songIds)
  playlist.dateModified = Math.floor(Date.now() / 1000)
  writeBrowserPlaylists(playlists)
  return getBrowserPlaylist(playlistId)
}

async function createBrowserSong(
  root: BrowserRoot,
  file: File,
  relativePath: string
): Promise<any> {
  const extension = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
    : ''
  const baseName = file.name.replace(/\.[^/.]+$/, '')
  const separator = baseName.indexOf(' - ')
  const fallbackArtist = separator >= 0 ? baseName.slice(0, separator).trim() : 'Unknown Artist'
  const fallbackTitle = separator >= 0 ? baseName.slice(separator + 3).trim() : baseName
  const pathParts = relativePath.split('/')
  const fallbackAlbum = pathParts.length > 2 ? pathParts[pathParts.length - 2] : 'Unknown Album'
  const id = persistedFileId(root, file, relativePath)
  const canonicalMimeType = audioMimeTypes[extension]
  const playableBlob =
    canonicalMimeType && file.type !== canonicalMimeType
      ? new Blob([file], { type: canonicalMimeType })
      : file

  let metadata: Awaited<ReturnType<typeof parseBlob>> | null = null
  try {
    metadata = await parseBlob(file, { duration: true })
  } catch (error) {
    console.warn(`Unable to read metadata for ${file.name}:`, error)
  }

  const picture = selectCover(metadata?.common.picture)
  const artworkPath = picture
    ? URL.createObjectURL(
        new Blob([picture.data as BlobPart], {
          type: picture.format || 'image/jpeg'
        })
      )
    : undefined

  return {
    id,
    title: metadata?.common.title?.trim() || fallbackTitle,
    artist: metadata?.common.artist?.trim() || fallbackArtist,
    album: metadata?.common.album?.trim() || fallbackAlbum,
    duration: metadata?.format.duration || 0,
    filePath: URL.createObjectURL(playableBlob),
    artworkPath,
    rootId: root.id,
    trackNumber: metadata?.common.track?.no || undefined,
    genre: metadata?.common.genre?.[0],
    size: file.size,
    bitrate: metadata?.format.bitrate || 0,
    sampleRate: metadata?.format.sampleRate || 0,
    bitDepth: metadata?.format.bitsPerSample,
    channels: metadata?.format.numberOfChannels,
    codec: metadata?.format.codec || extension.toUpperCase(),
    container: metadata?.format.container || extension.toUpperCase(),
    dateAdded: root.dateAdded
  }
}

async function addBrowserFiles(
  root: BrowserRoot,
  files: Array<{ file: File; relativePath: string }>
): Promise<number> {
  clearSongsForRoot(root.id)

  let nextFileIndex = 0
  const workerCount = Math.min(6, files.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextFileIndex < files.length) {
        const fileIndex = nextFileIndex++
        const { file, relativePath } = files[fileIndex]
        const song = await createBrowserSong(root, file, relativePath)
        browserSongs.set(song.id, song)
      }
    })
  )

  return files.length
}

async function scanBrowserFolder(folderToken: string): Promise<number> {
  if (folderToken !== WEB_FOLDER_TOKEN) return 0
  const rootId = stableId(`root:${pendingFolderName}`)
  const root: BrowserRoot = {
    id: rootId,
    path: pendingFolderName,
    label: pendingFolderName,
    dateAdded: browserRoots.get(rootId)?.dateAdded || Math.floor(Date.now() / 1000),
    handle: pendingDirectoryHandle
  }
  browserRoots.set(rootId, root)
  try {
    await persistRoot(root)
  } catch (error) {
    if (!root.handle) throw error
    console.warn('The browser could not persist the folder handle; using the file cache.', error)
    await persistRoot({ ...root, handle: undefined })
  }

  const count = await addBrowserFiles(root, pendingFiles)
  try {
    await replacePersistedFiles(root, pendingFiles)
  } catch (error) {
    console.warn('Unable to cache the browser library for offline restoration:', error)
  }
  pendingFiles = []
  pendingDirectoryHandle = undefined
  window.dispatchEvent(new CustomEvent('felo:library-updated'))
  return count
}

async function initializeBrowserLibrary(): Promise<void> {
  if (browserLibraryPromise) return browserLibraryPromise
  browserLibraryPromise = (async () => {
    try {
      const roots = await readPersistedRoots()
      roots.forEach((root) => browserRoots.set(root.id, root))

      await Promise.all(
        roots.map(async (root) => {
          if (root.handle) {
            try {
              const permission = root.handle.queryPermission
                ? await root.handle.queryPermission({ mode: 'read' })
                : 'granted'
              if (permission === 'granted') {
                const files = await collectDirectoryFiles(root.handle)
                await addBrowserFiles(root, files)
                try {
                  await replacePersistedFiles(root, files)
                } catch (error) {
                  console.warn(`Unable to refresh the cached files for ${root.label}.`, error)
                }
                return
              }
            } catch (error) {
              console.warn(`Unable to reopen ${root.label}; restoring its cached files.`, error)
            }
          }

          const cachedFiles = await readPersistedFiles(root.id)
          if (cachedFiles.length > 0) await addBrowserFiles(root, cachedFiles)
        })
      )
    } catch (error) {
      console.warn('Unable to restore the browser library:', error)
    }
  })()
  return browserLibraryPromise
}

function desktopOnly(): never {
  throw new Error('This feature is available in the Felo desktop app.')
}

const webApi: Window['api'] = {
  selectFolder: selectBrowserFolder,
  scanLibrary: scanBrowserFolder,
  getSongs: async () => {
    await initializeBrowserLibrary()
    return [...browserSongs.values()]
  },
  getLibraryRoots: async () => {
    await initializeBrowserLibrary()
    return [...browserRoots.values()].map(({ handle: _handle, ...root }) => root)
  },
  removeLibraryRoot: async (rootId) => {
    await initializeBrowserLibrary()
    browserRoots.delete(rootId)
    clearSongsForRoot(rootId)
    await deletePersistedRoot(rootId)
    window.dispatchEvent(new CustomEvent('felo:library-updated'))
  },
  removeSong: async (songId) => {
    const song = browserSongs.get(songId)
    if (song) {
      revokeBlobUrl(song.filePath)
      revokeBlobUrl(song.artworkPath)
    }
    browserSongs.delete(songId)
    await deletePersistedFile(songId)
    window.dispatchEvent(new CustomEvent('felo:library-updated'))
  },
  getArtists: async () => {
    const counts = new Map<string, number>()
    for (const song of browserSongs.values()) {
      counts.set(song.artist, (counts.get(song.artist) || 0) + 1)
    }
    return [...counts].map(([name, songCount]) => ({ id: stableId(name), name, songCount }))
  },
  getAlbums: async () => [],
  searchSongs: async (query) => {
    const normalized = query.toLowerCase()
    return [...browserSongs.values()].filter((song) =>
      [song.title, song.artist, song.album].some((value) =>
        value.toLowerCase().includes(normalized)
      )
    )
  },
  searchArtists: async (query) => {
    const artists = await webApi.getArtists()
    return artists.filter((artist) => artist.name.toLowerCase().includes(query.toLowerCase()))
  },
  searchAppleMusic: searchBrowserAppleMusic,
  searchAppleMusicArtistSongs: searchBrowserAppleMusicArtistSongs,
  searchMusicBrainz: searchBrowserMusicBrainz,
  getPlaylists: async () => {
    await initializeBrowserLibrary()
    return readBrowserPlaylists()
      .map(browserPlaylistSummary)
      .sort((left, right) => right.dateModified - left.dateModified)
  },
  getPlaylist: async (playlistId) => {
    await initializeBrowserLibrary()
    return getBrowserPlaylist(playlistId)
  },
  createPlaylist: async (input) => {
    await initializeBrowserLibrary()
    return createBrowserPlaylist(input)
  },
  fetchPlaylistImportMetadata: async () => desktopOnly(),
  deletePlaylist: async (playlistId) => {
    writeBrowserPlaylists(readBrowserPlaylists().filter((playlist) => playlist.id !== playlistId))
  },
  addSongToPlaylist: async (playlistId, songId) => {
    await initializeBrowserLibrary()
    if (!browserSongs.has(songId)) return getBrowserPlaylist(playlistId)
    return updateBrowserPlaylistSongs(playlistId, (songIds) =>
      songIds.includes(songId) ? songIds : [...songIds, songId]
    )
  },
  removeSongFromPlaylist: async (playlistId, songId) =>
    updateBrowserPlaylistSongs(playlistId, (songIds) =>
      songIds.filter((candidateId) => candidateId !== songId)
    ),
  fetchLyrics: fetchBrowserLyrics,
  getSetting: async (key) => {
    const value = localStorage.getItem(`felo-web-setting:${key}`)
    if (value === null) return null
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  },
  setSetting: async (key, value) => {
    localStorage.setItem(`felo-web-setting:${key}`, JSON.stringify(value))
  },
  testQobuzAccount: async () => ({
    status: 'error',
    message: 'Qobuz account testing requires the Felo desktop app.'
  }),
  testDeezerAccount: async () => ({
    status: 'error',
    message: 'Deezer account testing requires the Felo desktop app.'
  }),
  searchDownloadSource: async () => [],
  startDownload: async () => desktopOnly(),
  onDownloadProgress: () => () => undefined,
  getAppVersion: async () => 'web',
  checkForUpdates: async () => ({ status: 'unavailable', currentVersion: 'web' }),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  onAuthCallback: () => () => undefined,
  revealInExplorer: async () => desktopOnly(),
  minimizeWindow: () => undefined,
  maximizeWindow: () => undefined,
  closeWindow: () => undefined
}

export function installWebApi(): void {
  if (!window.api) {
    window.api = webApi
    void initializeBrowserLibrary().then(() => {
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
    })
  }
}
