import { parseBlob, selectCover } from 'music-metadata'
import {
  AUDIO_FILE_ACCEPT,
  isAudioFileCandidate,
  stripRecognizedAudioFileExtension,
  resolveAudioMime,
  probeAudioDuration,
  filenameExtension
} from './audioFile'
import { fmtTime } from './songUtils'
import { probeAudioChannelCount } from './audioHeader'
import { registerLocalSlotPoolFile } from './jitAudioPipeline'

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
const WEB_FAVORITES_KEY = 'felo-web-favorites'

function readBrowserFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(WEB_FAVORITES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function writeBrowserFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(WEB_FAVORITES_KEY, JSON.stringify([...favorites]))
  } catch (err) {
    console.warn('Failed to persist browser favorites:', err)
  }
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
    try {
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
      request.onerror = () => {
        databasePromise = null
        reject(request.error)
      }
      request.onblocked = () => {
        console.warn('IndexedDB library database open was blocked by an active tab.')
      }
    } catch (e) {
      databasePromise = null
      reject(e)
    }
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

async function readPersistedFileById(fileId: string): Promise<PersistedBrowserFile | null> {
  try {
    const database = await openBrowserLibraryDatabase()
    return new Promise((resolve) => {
      const request = database
        .transaction(WEB_LIBRARY_FILES_STORE, 'readonly')
        .objectStore(WEB_LIBRARY_FILES_STORE)
        .get(fileId)
      request.onsuccess = () => resolve((request.result as PersistedBrowserFile) || null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function replacePersistedFiles(
  root: BrowserRoot,
  files: Array<{ file: File; relativePath: string }>,
  append = true
): Promise<void> {
  const database = await openBrowserLibraryDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WEB_LIBRARY_FILES_STORE, 'readwrite')
    const store = transaction.objectStore(WEB_LIBRARY_FILES_STORE)

    const saveFiles = () => {
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

    if (append) {
      saveFiles()
    } else {
      const cursorRequest = store.index('rootId').openKeyCursor(IDBKeyRange.only(root.id))
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          store.delete(cursor.primaryKey)
          cursor.continue()
          return
        }
        saveFiles()
      }
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
  return fmtTime(Math.floor(milliseconds / 1000))
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
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return results
  }

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
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return results
  }

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

async function searchBrowserLastFm(_query: string): Promise<CatalogSearchResults> {
  // Last.fm search is restricted to the private desktop application
  return {
    'Top Results': [],
    Songs: [],
    Artists: [],
    Albums: []
  }
}

function cleanLyricsMetadata(value: string): string {
  if (!value) return ''
  let cleaned = value
    .normalize('NFKC')
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
    .replace(/^\s*\d{1,3}[.\-_)]+\s*/, '')
    .replace(
      /\s*[\(\[]\s*(?:youtube|explicit|official(?:\s*(?:music|lyric|lyrics)?\s*(?:video|audio|mv)?)?|lyrics?(?:\s*video)?|remaster(?:ed)?(?:\s*[\d\w]+)?|hq|hd|4k|visualizer|audio|video|mv|copyright[\s-]*free|feat\.?.*?|ft\.?.*?|prod\.?.*?|produced\s+by.*?|single\s*version|bonus\s*track|deluxe(?:\s*edition)?|live(?:\s*at\s*.*)?|\d+)\s*[\)\]]\s*/gi,
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
      .replace(/\s*[\(\[]\s*(?:youtube|\d+)\s*[\)\]]\s*$/gi, '')
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
  let title = cleanLyricsMetadata(songInfo.title || '')
  let artist = isPlaceholderLyricsValue(songInfo.artist || '')
    ? ''
    : cleanLyricsMetadata(songInfo.artist || '')
  const album = isPlaceholderLyricsValue(songInfo.album)
    ? ''
    : cleanLyricsMetadata(songInfo.album || '')

  const titleParts = title.match(/^(.+?)\s+[-\u2013\u2014|]\s+(.+)$/)
  if (titleParts) {
    const inferredArtist = cleanLyricsMetadata(titleParts[1])
    const inferredTitle = cleanLyricsMetadata(titleParts[2])
    const normalizedArtist = normalizeLyricsCompare(artist)
    const normalizedInferredArtist = normalizeLyricsCompare(inferredArtist)
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
    const response = await fetch(`https://lrclib.net/api${endpoint}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
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

  const candidateTrack = normalizeLyricsCompare(candidate.trackName)
  const candidateArtist = normalizeLyricsCompare(candidate.artistName)
  const targetTrack = normalizeLyricsCompare(track)
  const targetArtist = normalizeLyricsCompare(artist)
  const candidateAlbum = normalizeLyricsCompare(candidate.albumName)
  const targetAlbum = normalizeLyricsCompare(album)

  // Prioritize synced lyrics over plain lyrics
  let score = candidate.syncedLyrics ? 35 : 10

  const trackSim = lyricsTextSimilarity(candidateTrack, targetTrack)
  score += trackSim * 60

  if (targetArtist) {
    const artistSim = lyricsTextSimilarity(candidateArtist, targetArtist)
    score += artistSim * 45
  } else {
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

async function fetchBrowserLyrics(songInfo: {
  title: string
  artist?: string
  album?: string
  duration?: number
  filePath?: string
}): Promise<LrclibLyrics | null> {
  const rawTrack = songInfo.title?.trim() || ''
  const rawArtist = songInfo.artist?.trim() || ''
  const resolved = resolveLyricsMetadata(songInfo)
  const cleanTrack = resolved.title
  const cleanArtist = resolved.artist
  const cleanAlbum = resolved.album

  if (!cleanTrack) return null

  const lyricsCacheKey = `felo-lyrics:${cleanTrack.toLowerCase()}:::${cleanArtist.toLowerCase()}`
  try {
    const cached = localStorage.getItem(lyricsCacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed && (parsed.plainLyrics || parsed.syncedLyrics)) {
        return parsed
      }
    }
  } catch {
    // Ignore localStorage parse error
  }

  // If offline, do not attempt failing network calls
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return null
  }

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
      try {
        localStorage.setItem(lyricsCacheKey, JSON.stringify(best))
      } catch {
        // Ignore storage quota
      }
      return best
    }
  }

  return null
}

function isAudioFile(file: File): boolean {
  return isAudioFileCandidate(file)
}

async function collectDirectoryFiles(
  directory: BrowserDirectoryHandle,
  parentPath = ''
): Promise<Array<{ file: File; relativePath: string }>> {
  const files: Array<{ file: File; relativePath: string }> = []
  try {
    if (typeof (directory as any).values === 'function') {
      for await (const entry of (directory as any).values()) {
        const name = (entry as any).name || ''
        const relativePath = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'file') {
          try {
            const file = await (entry as any).getFile()
            if (isAudioFile(file)) files.push({ file, relativePath })
          } catch (fileErr) {
            console.warn(`Could not read file ${name}:`, fileErr)
          }
        } else if (entry.kind === 'directory') {
          try {
            files.push(...(await collectDirectoryFiles(entry as BrowserDirectoryHandle, relativePath)))
          } catch (dirErr) {
            console.warn(`Could not traverse folder ${name}:`, dirErr)
          }
        }
      }
    } else if (typeof (directory as any).entries === 'function') {
      for await (const [name, entry] of (directory as any).entries()) {
        const relativePath = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'file') {
          try {
            const file = await (entry as any).getFile()
            if (isAudioFile(file)) files.push({ file, relativePath })
          } catch (fileErr) {
            console.warn(`Could not read file ${name}:`, fileErr)
          }
        } else if (entry.kind === 'directory') {
          try {
            files.push(...(await collectDirectoryFiles(entry as BrowserDirectoryHandle, relativePath)))
          } catch (dirErr) {
            console.warn(`Could not traverse folder ${name}:`, dirErr)
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error reading directory entries:', err)
  }
  return files
}

function pickFilesWithInput(options?: {
  directory?: boolean
  accept?: string
}): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (options?.directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
      input.setAttribute('mozdirectory', '')
      ;(input as any).webkitdirectory = true
      ;(input as any).directory = true
      ;(input as any).mozdirectory = true
    } else if (options?.accept) {
      input.accept = options.accept
    }
    input.style.position = 'fixed'
    input.style.top = '-9999px'
    input.style.left = '-9999px'
    input.style.opacity = '0'
    input.style.width = '1px'
    input.style.height = '1px'

    let resolved = false
    const cleanup = () => {
      if (!resolved) {
        resolved = true
        input.remove()
      }
    }

    const handleChange = () => {
      const files = input.files
      cleanup()
      resolve(files)
    }

    const handleCancel = () => {
      cleanup()
      resolve(null)
    }

    input.addEventListener('change', handleChange, { once: true })
    input.addEventListener('cancel', handleCancel, { once: true })

    document.body.appendChild(input)
    input.click()
  })
}

async function selectBrowserFiles(options?: { accept?: string }): Promise<string | null> {
  try {
    const files = await pickFilesWithInput({
      directory: false,
      accept: options?.accept || AUDIO_FILE_ACCEPT
    })
    if (!files || files.length === 0) return null
    pendingDirectoryHandle = undefined
    pendingFiles = Array.from(files)
      .filter(isAudioFile)
      .map((file) => ({
        file,
        relativePath:
          (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      }))
    if (pendingFiles.length === 0) return null
    const folderFromPath = pendingFiles[0]?.relativePath.includes('/')
      ? pendingFiles[0].relativePath.split('/')[0]
      : null
    pendingFolderName = folderFromPath || 'Uploaded Music'
    return WEB_FOLDER_TOKEN
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

async function selectBrowserFolder(options?: { forceFiles?: boolean }): Promise<string | null> {
  try {
    const isMobile =
      typeof navigator !== 'undefined' &&
      (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /mac/i.test(navigator.userAgent)))

    // On mobile devices, directory picking is not supported by browsers; directly open file picker
    if (isMobile || options?.forceFiles) {
      return await selectBrowserFiles()
    }

    const browserWindow = window as Window & {
      showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>
    }
    if (browserWindow.showDirectoryPicker) {
      try {
        const directory = await browserWindow.showDirectoryPicker()
        if (navigator.storage?.persist) {
          void navigator.storage.persist().catch(() => false)
        }
        pendingDirectoryHandle = directory
        pendingFolderName = directory.name || 'Browser folder'
        pendingFiles = await collectDirectoryFiles(directory)
        return pendingFiles.length ? WEB_FOLDER_TOKEN : null
      } catch (error: any) {
        if (error instanceof DOMException && error.name === 'AbortError') return null
        console.warn('showDirectoryPicker failed or restricted, falling back to directory input:', error)
      }
    }

    // Try directory input fallback for desktop browsers without File System Access API
    try {
      const dirFiles = await pickFilesWithInput({
        directory: true
      })
      if (dirFiles && dirFiles.length > 0) {
        pendingDirectoryHandle = undefined
        pendingFiles = Array.from(dirFiles)
          .filter(isAudioFile)
          .map((file) => ({
            file,
            relativePath:
              (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
          }))
        if (pendingFiles.length > 0) {
          pendingFolderName =
            pendingFiles[0]?.relativePath.includes('/')
              ? pendingFiles[0].relativePath.split('/')[0]
              : 'Browser folder'
          return WEB_FOLDER_TOKEN
        }
      } else if (dirFiles === null) {
        return null
      }
    } catch (e) {
      console.warn('Directory input failed, falling back to files:', e)
    }

    // Direct audio files picker fallback
    return await selectBrowserFiles()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

async function scanSelectedFiles(
  files: FileList | File[],
  folderName = 'Uploaded Music'
): Promise<number> {
  const fileArray = Array.from(files).filter(isAudioFile)
  if (fileArray.length === 0) return 0

  pendingDirectoryHandle = undefined
  pendingFiles = fileArray.map((file) => ({
    file,
    relativePath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  }))
  pendingFolderName = folderName

  return scanBrowserFolder(WEB_FOLDER_TOKEN)
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
  const extension = filenameExtension(file.name)
  const baseName = stripRecognizedAudioFileExtension(file.name)
  const separator = baseName.indexOf(' - ')
  const fallbackArtist = separator >= 0 ? baseName.slice(0, separator).trim() : 'Unknown Artist'
  const fallbackTitle = separator >= 0 ? baseName.slice(separator + 3).trim() : baseName
  const pathParts = relativePath.split('/')
  const fallbackAlbum = pathParts.length > 2 ? pathParts[pathParts.length - 2] : 'Unknown Album'
  const id = persistedFileId(root, file, relativePath)
  const canonicalMimeType = resolveAudioMime(file.name, file.type)
  const playableBlob =
    canonicalMimeType && file.type !== canonicalMimeType
      ? new Blob([file], { type: canonicalMimeType })
      : file

  let metadata: Awaited<ReturnType<typeof parseBlob>> | null = null
  try {
    metadata = await Promise.race([
      parseBlob(file, { duration: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
    ])
  } catch (error) {
    console.warn(`Unable to read metadata for ${file.name}:`, error)
  }

  let duration = metadata?.format.duration || 0
  if (!duration || duration <= 0) {
    try {
      const probed = await probeAudioDuration(playableBlob)
      if (probed && probed > 0) duration = probed
    } catch {
      // duration fallback
    }
  }

  const picture = selectCover(metadata?.common.picture)
  const artworkPath = picture
    ? URL.createObjectURL(
        new Blob([picture.data as BlobPart], {
          type: picture.format || 'image/jpeg'
        })
      )
    : undefined

  const codecStr = (metadata?.format.codec || extension || 'AUDIO').toUpperCase()

  registerLocalSlotPoolFile(id, playableBlob)

  return {
    id,
    title: metadata?.common.title?.trim() || fallbackTitle,
    artist: metadata?.common.artist?.trim() || fallbackArtist,
    album: metadata?.common.album?.trim() || fallbackAlbum,
    duration,
    filePath: URL.createObjectURL(playableBlob),
    artworkPath,
    rootId: root.id,
    trackNumber: metadata?.common.track?.no || undefined,
    genre: metadata?.common.genre?.[0],
    size: file.size,
    bitrate: metadata?.format.bitrate || 0,
    sampleRate: metadata?.format.sampleRate || 0,
    bitDepth: metadata?.format.bitsPerSample,
    channels: metadata?.format.numberOfChannels ?? (await probeAudioChannelCount(playableBlob)) ?? undefined,
    codec: codecStr,
    container: codecStr,
    dateAdded: root.dateAdded,
    isLocalToDevice: true,
    isOnline: false
  }
}

const scanProgressListeners = new Set<(progress: any) => void>()
let browserScanCancelled = false

function emitBrowserScanProgress(progress: any) {
  scanProgressListeners.forEach((listener) => {
    try {
      listener(progress)
    } catch (err) {
      console.warn('Scan progress listener error:', err)
    }
  })
}

async function addBrowserFiles(
  root: BrowserRoot,
  files: Array<{ file: File; relativePath: string }>,
  append = true
): Promise<number> {
  if (!append) {
    clearSongsForRoot(root.id)
  }

  let nextFileIndex = 0
  let processedFiles = 0
  const totalFiles = files.length
  const startTime = Date.now()
  let lastEmit = 0
  const workerCount = Math.min(6, files.length)

  const emit = (status: 'indexing' | 'completed' | 'cancelled', currentFile?: string, currentTrack?: any, force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 80) return
    lastEmit = now

    const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
    const elapsedMs = now - startTime
    const speed = elapsedMs > 500 && processedFiles > 0 ? processedFiles / (elapsedMs / 1000) : undefined
    const remainingFiles = Math.max(0, totalFiles - processedFiles)
    const estimatedRemainingMs =
      speed && speed > 0 && remainingFiles > 0 ? Math.round((remainingFiles / speed) * 1000) : undefined

    emitBrowserScanProgress({
      status,
      folderPath: root.path,
      folderName: root.label || root.path,
      totalFiles,
      processedFiles,
      addedCount: processedFiles,
      updatedCount: 0,
      skippedCount: 0,
      currentFile,
      currentTrack,
      percent,
      speed: speed ? Math.round(speed * 10) / 10 : undefined,
      elapsedMs,
      estimatedRemainingMs
    })
  }

  emit('indexing', undefined, undefined, true)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextFileIndex < files.length) {
        if (browserScanCancelled) break
        const fileIndex = nextFileIndex++
        const { file, relativePath } = files[fileIndex]
        const song = await createBrowserSong(root, file, relativePath)
        browserSongs.set(song.id, song)
        processedFiles++
        emit('indexing', file.name, { title: song.title, artist: song.artist })
      }
    })
  )

  if (browserScanCancelled) {
    emit('cancelled', undefined, undefined, true)
    return processedFiles
  }

  emit('completed', undefined, undefined, true)
  return files.length
}

async function scanBrowserFolder(folderToken: string): Promise<number> {
  if (folderToken !== WEB_FOLDER_TOKEN) {
    const existingRoot = [...browserRoots.values()].find(
      (r) => r.path === folderToken || r.id === folderToken
    )
    if (existingRoot) {
      if (existingRoot.handle) {
        try {
          const files = await collectDirectoryFiles(existingRoot.handle)
          return await addBrowserFiles(existingRoot, files, false)
        } catch (err) {
          console.warn('Failed to rescan directory handle:', err)
        }
      }
      const cached = await readPersistedFiles(existingRoot.id)
      if (cached.length > 0) {
        return await addBrowserFiles(existingRoot, cached, false)
      }
    }
    return 0
  }

  browserScanCancelled = false
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
    console.warn('The browser could not persist the folder handle; using the file cache.', error)
    try {
      await persistRoot({ ...root, handle: undefined })
    } catch (innerErr) {
      console.warn('Could not persist root metadata to IndexedDB:', innerErr)
    }
  }

  emitBrowserScanProgress({
    status: 'discovering',
    folderPath: root.path,
    folderName: root.label,
    totalFiles: pendingFiles.length,
    processedFiles: 0,
    addedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    percent: 0
  })

  const count = await addBrowserFiles(root, pendingFiles, true)
  void replacePersistedFiles(root, pendingFiles, true).catch((error) => {
    console.warn('Unable to cache the browser library for offline restoration:', error)
  })
  pendingFiles = []
  pendingDirectoryHandle = undefined
  window.dispatchEvent(new CustomEvent('felo:library-updated'))
  window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))
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

function browserContainsNonLatinLetters(value: string): boolean {
  return [...value].some(
    (character) => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)
  )
}

async function transformBrowserLyricLine(
  text: string,
  mode: 'translate' | 'romanize',
  targetLanguage = 'en'
): Promise<string> {
  const clean = text.replace(/<[^>]+>/g, '').trim()
  if (!clean || (mode === 'romanize' && !browserContainsNonLatinLetters(clean))) return text

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLanguage,
    dt: mode === 'translate' ? 't' : 'rm',
    q: clean
  })
  const response = await fetch(
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`
  )
  if (!response.ok) throw new Error(`Google Translate returned ${response.status}`)

  const data = await response.json()
  const segments = Array.isArray(data?.[0]) ? data[0] : []
  const result =
    mode === 'translate'
      ? segments.map((segment: any) => segment?.[0] || '').join('')
      : segments.map((segment: any) => segment?.[3] || '').join(' ')
  return result.trim() || text
}

async function transformBrowserLyricBatch(
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
  const response = await fetch(
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`
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
}

async function transformBrowserLyrics(
  lines: string[],
  mode: 'translate' | 'romanize',
  targetLanguage = 'en'
): Promise<string[]> {
  const sanitize = (line: string) => line.replace(/<[^>]+>/g, '').trim()
  const transformed = new Map<string, string>()

  if (mode === 'translate') {
    const uniqueClean = [...new Set(lines.map(sanitize).filter(Boolean))]
    const BATCH_SIZE = 25
    for (let i = 0; i < uniqueClean.length; i += BATCH_SIZE) {
      const chunk = uniqueClean.slice(i, i + BATCH_SIZE)
      try {
        const results = await transformBrowserLyricBatch(chunk, targetLanguage)
        chunk.forEach((line, idx) => {
          transformed.set(line, results[idx] || line)
        })
      } catch (err) {
        console.warn('Batch browser translation failed, falling back to line-by-line:', err)
        for (const line of chunk) {
          const res = await transformBrowserLyricLine(line, 'translate', targetLanguage).catch(() => line)
          transformed.set(line, res)
        }
      }
    }

    return lines.map((line) => {
      const clean = sanitize(line)
      return transformed.get(clean) ?? line
    })
  }

  // Romanize
  const results: string[] = []
  for (const line of lines) {
    results.push(await transformBrowserLyricLine(line, mode, targetLanguage))
  }
  return results
}

const webApi: Window['api'] = {
  setExternalPlayerEnabled: async () => desktopOnly(),
  getExternalPlayerSettings: async () => ({ enabled: false, running: false, port: 0, apiKey: '' }),
  getExternalPlayerApiKey: async () => ({ apiKey: '' }),
  regenerateExternalPlayerApiKey: async () => ({ apiKey: '' }),
  getExternalPlayerClientConfigs: async () => ({
    apiKey: '',
    port: 0,
    running: false,
    hermes: '',
    claudeDesktop: '',
    cursor: '',
    windsurf: ''
  }),
  copyHermesConfig: async () => desktopOnly(),
  getRemoteControlInfo: async () => {
    const host = localStorage.getItem('felo_remote_base_url') || ''
    const token = localStorage.getItem('felo_remote_token') || ''
    return {
      enabled: Boolean(host),
      running: Boolean(host),
      port: 4788,
      ip: host || '127.0.0.1',
      token,
      url: host ? `${host}/#remote?token=${token}` : '',
      qrDataUrl: '',
      cloudflareUrl: host
        ? `https://felo.feloapp.workers.dev/#remote?host=${encodeURIComponent(host)}&token=${token}`
        : '',
      cloudflareQrDataUrl: '',
      connectedClients: 0
    }
  },
  setRemoteControlEnabled: async () => desktopOnly(),
  regenerateRemoteControlToken: async () => desktopOnly(),
  onExternalPlayerCommand: () => () => undefined,
  publishExternalPlayerStatus: () => undefined,
  respondToExternalPlayerCommand: () => undefined,
  getDiscordBotStatus: async () => ({
    enabled: false,
    connected: false,
    botUser: null,
    prefix: '!',
    channelId: '',
    webhookUrl: '',
    webhookEnabled: false,
    error: null
  }),
  updateDiscordSettings: async () => desktopOnly(),
  testDiscordWebhook: async () => ({ success: false, message: 'Webhooks are desktop only' }),
  registerDiscordCommands: async () => ({ success: false, message: 'Discord command registration is desktop only' }),
  updateDiscordRoomInfo: () => undefined,
  setupMusicPresence: async () => ({ success: false, error: 'Desktop only' }),
  getMusicPresenceStatus: async () => ({
    installed: false,
    running: false,
    configured: false,
    executablePath: null
  }),
  launchMusicPresence: async () => ({ success: false, error: 'Desktop only' }),
  relaunchApp: async () => {
    window.location.reload()
  },
  selectFolder: selectBrowserFolder,
  selectFiles: selectBrowserFiles,
  scanLibrary: scanBrowserFolder,
  scanFiles: scanSelectedFiles,
  cancelLibraryScan: async () => {
    browserScanCancelled = true
    return true
  },
  onLibraryScanProgress: (listener: (progress: any) => void) => {
    scanProgressListeners.add(listener)
    return () => scanProgressListeners.delete(listener)
  },
  getSongs: async () => {
    await initializeBrowserLibrary()
    const favs = readBrowserFavorites()
    return [...browserSongs.values()].map((song) => ({
      ...song,
      isFavorite: favs.has(song.id)
    }))
  },
  toggleFavorite: async (songId: string, isFavorite?: boolean, songData?: any) => {
    await initializeBrowserLibrary()
    const favs = readBrowserFavorites()
    const currentFav = favs.has(songId)
    const nextFav = typeof isFavorite === 'boolean' ? isFavorite : !currentFav
    if (nextFav) {
      favs.add(songId)
      if (songData && !browserSongs.has(songId)) {
        browserSongs.set(songId, {
          ...songData,
          id: songId,
          isFavorite: true,
          dateAdded: Math.floor(Date.now() / 1000)
        })
      }
    } else {
      favs.delete(songId)
    }
    writeBrowserFavorites(favs)

    const existingSong = browserSongs.get(songId)
    if (existingSong) {
      existingSong.isFavorite = nextFav
    }

    window.dispatchEvent(new CustomEvent('felo:library-updated'))
    window.dispatchEvent(new CustomEvent('felo:favorites-updated', { detail: { songId, isFavorite: nextFav } }))
    return { id: songId, isFavorite: nextFav }
  },
  getLikedSongs: async () => {
    await initializeBrowserLibrary()
    const favs = readBrowserFavorites()
    return Array.from(browserSongs.values())
      .filter((song) => favs.has(song.id))
      .map((song) => ({ ...song, isFavorite: true }))
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
  },
  getLikedCount: async () => {
    const favs = readBrowserFavorites()
    return favs.size
  },
  readAudioFile: async (songIdOrPath: string, explicitPath?: string) => {
    try {
      await initializeBrowserLibrary()
      const song = browserSongs.get(songIdOrPath)
      const targetUrl =
        explicitPath ||
        song?.filePath ||
        (songIdOrPath.startsWith('blob:') || songIdOrPath.startsWith('http') ? songIdOrPath : '')

      let buffer: ArrayBuffer | null = null
      let contentType = song?.codec || (song as any)?.format || 'audio/mpeg'

      if (targetUrl) {
        try {
          const response = await fetch(targetUrl)
          if (response.ok) {
            buffer = await response.arrayBuffer()
            contentType = response.headers.get('content-type') || contentType
          }
        } catch {
          // targetUrl may be an expired blob URL; proceed to IndexedDB fallback
        }
      }

      // Fallback: read directly from IndexedDB if fetch failed or targetUrl was revoked
      if (!buffer && songIdOrPath) {
        try {
          const persisted = await readPersistedFileById(songIdOrPath)
          if (persisted?.file) {
            buffer = await persisted.file.arrayBuffer()
            contentType = persisted.file.type || contentType
            // Re-hydrate the blob URL and slot pool
            const newBlobUrl = URL.createObjectURL(persisted.file)
            if (song) song.filePath = newBlobUrl
            registerLocalSlotPoolFile(songIdOrPath, persisted.file)
          }
        } catch {}
      }

      if (!buffer) {
        return { success: false, error: 'File not found in browser library' }
      }

      return {
        success: true,
        data: buffer,
        contentType,
        size: buffer.byteLength
      }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to read audio file in browser' }
    }
  },
  getLibraryRoots: async () => {
    await initializeBrowserLibrary()
    return [...browserRoots.values()].map(({ handle: _handle, ...root }) => {
      const songCount = [...browserSongs.values()].filter((song) => song.rootId === root.id).length
      return { ...root, songCount }
    })
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
  getAlbums: async () => {
    await initializeBrowserLibrary()
    const albumMap = new Map<
      string,
      {
        id: string
        title: string
        artistName: string
        songCount: number
        artworkPath?: string
        year?: number | string
      }
    >()

    for (const song of browserSongs.values()) {
      const albumTitle = song.album?.trim() || 'Unknown Album'
      const artistName = song.artist?.trim() || 'Unknown Artist'
      const key = `${albumTitle.toLowerCase()}:::${artistName.toLowerCase()}`
      const existing = albumMap.get(key)
      const songArt = song.artworkPath || (song as any).artworkUrl
      if (existing) {
        existing.songCount++
        if (!existing.artworkPath && songArt) {
          existing.artworkPath = songArt
        }
      } else {
        albumMap.set(key, {
          id: stableId(`album:${key}`),
          title: albumTitle,
          artistName,
          songCount: 1,
          artworkPath: songArt,
          year: (song as any).year
        })
      }
    }
    return [...albumMap.values()].sort((a, b) => b.songCount - a.songCount || a.title.localeCompare(b.title))
  },
  searchAlbums: async (query?: string) => {
    const albums = await (webApi.getAlbums ? webApi.getAlbums() : [])
    if (!query || !query.trim()) return albums
    const q = query.toLowerCase().trim()
    return albums.filter(
      (album) =>
        album.title.toLowerCase().includes(q) ||
        (album.artistName && album.artistName.toLowerCase().includes(q))
    )
  },
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
  searchLastFm: searchBrowserLastFm,
  fetchLastFmCharts: async () => [],
  getPlaylists: async () => {
    await initializeBrowserLibrary()
    return readBrowserPlaylists()
      .map(browserPlaylistSummary)
      .sort((left, right) => right.dateModified - left.dateModified)
  },
  getPlaylist: async (playlistId) => {
    await initializeBrowserLibrary()
    if (playlistId === 'liked') {
      const favs = readBrowserFavorites()
      const likedSongs = Array.from(browserSongs.values())
        .filter((song) => favs.has(song.id))
        .map((song, idx) => ({
          ...song,
          isFavorite: true,
          playlistDateAdded: (song.dateAdded || Math.floor(Date.now() / 1000)) * 1000,
          playlistSortOrder: idx
        }))
        .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))

      return {
        id: 'liked',
        name: 'Liked Songs',
        description: 'Your favorite tracks in one place',
        artworkPath: null,
        artworkUrl: null,
        dateCreated: 0,
        dateModified: Date.now(),
        songCount: likedSongs.length,
        songs: likedSongs
      }
    }
    return getBrowserPlaylist(playlistId)
  },
  createPlaylist: async (input) => {
    await initializeBrowserLibrary()
    return createBrowserPlaylist(input)
  },
  fetchPlaylistImportMetadata: async (url: string) => {
    const cleanUrl = (url || '').trim()
    if (!/^https?:\/\//i.test(cleanUrl)) {
      throw new Error('Enter a valid playlist URL.')
    }
    if (/open\.spotify\.com\/playlist\//i.test(cleanUrl)) {
      try {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`)
        if (response.ok) {
          const data = await response.json()
          return {
            name: String(data?.title || 'Spotify Playlist'),
            description: 'Imported from Spotify link.',
            thumbnail: String(data?.thumbnail_url || ''),
            tracks: []
          }
        }
      } catch (err) {
        console.warn('Failed to fetch browser Spotify metadata:', err)
      }
    }
    return { name: 'Playlist', description: '', thumbnail: '', tracks: [] }
  },
  fetchSpotifyPlaylistTracks: async () => desktopOnly(),
  importSpotifyPlaylist: async () => desktopOnly(),
  deletePlaylist: async (playlistId) => {
    if (playlistId === 'liked') return
    writeBrowserPlaylists(readBrowserPlaylists().filter((playlist) => playlist.id !== playlistId))
  },
  renamePlaylist: async (playlistId, name) => {
    if (playlistId === 'liked') return webApi.getPlaylist('liked')
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error('Playlist name is required')
    const playlists = readBrowserPlaylists()
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!playlist) throw new Error('Playlist not found')
    const updated = { ...playlist, name: trimmedName, dateModified: Math.floor(Date.now() / 1000) }
    writeBrowserPlaylists(playlists.map((item) => (item.id === playlistId ? updated : item)))
    return getBrowserPlaylist(playlistId)
  },
  addSongToPlaylist: async (playlistId, songId) => {
    await initializeBrowserLibrary()
    if (playlistId === 'liked') {
      await webApi.toggleFavorite(songId, true)
      return webApi.getPlaylist('liked')
    }
    if (!browserSongs.has(songId)) return getBrowserPlaylist(playlistId)
    return updateBrowserPlaylistSongs(playlistId, (songIds) =>
      songIds.includes(songId) ? songIds : [...songIds, songId]
    )
  },
  removeSongFromPlaylist: async (playlistId, songId) => {
    if (playlistId === 'liked') {
      await webApi.toggleFavorite(songId, false)
      return webApi.getPlaylist('liked')
    }
    return updateBrowserPlaylistSongs(playlistId, (songIds) =>
      songIds.filter((candidateId) => candidateId !== songId)
    )
  },
  fetchLyrics: fetchBrowserLyrics,
  translateLyrics: (lines, targetLanguage) =>
    transformBrowserLyrics(lines, 'translate', targetLanguage),
  romanizeLyrics: (lines) => transformBrowserLyrics(lines, 'romanize'),
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
  testSoulseekAccount: async () => ({
    status: 'error',
    message: 'Soulseek account testing requires the Felo desktop app.'
  }),
  searchDownloadSource: async () => [],
  acquireAndDownload: async () => desktopOnly(),
  startDownload: async () => desktopOnly(),
  cancelDownload: async () => false,
  onDownloadProgress: () => () => undefined,
  checkDownloaderDependencies: async () => ({
    ytDlp: { available: false },
    ffmpeg: { available: false }
  }),
  installDownloaderDependencies: async () => ({
    success: false,
    message: 'Installing dependencies is only available in the desktop app.'
  }),
  onDownloaderInstallLog: () => () => undefined,
  getAppVersion: async () => 'web',
  checkForUpdates: async () => ({ status: 'unavailable', currentVersion: 'web' }),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  onAuthCallback: () => () => undefined,
  fetchAotyAlbums: async () => [],
  fetchExploreFeed: async () => ({
    trendingSongs: [],
    hotNewSongs: [],
    recommendedAlbums: [],
    hotNewAlbums: []
  }),
  revealInExplorer: async () => desktopOnly(),
  minimizeWindow: () => undefined,
  maximizeWindow: () => undefined,
  closeWindow: () => undefined,
  recordPlay: async () => ({ success: true, playCount: 1 }),
  getListeningHistory: async () => ({
    recent: [],
    topTracks: [],
    topArtists: [],
    totalPlays: 0,
    totalTracks: 0
  }),
  fetchDeezerChart: async () => ({}),
  fetchDeezerRecommendations: async () => [],
  getDesktopSources: async () => [],
  getAppMode: async () => ({
    mode: 'public' as const,
    sources: ['Local Library']
  }),
  getYouTubeMetadata: async (urlOrId: string): Promise<{
    success: boolean
    videoId?: string
    title?: string
    channel?: string
    thumbnailUrl?: string
    error?: string
  }> => {
    try {
      const match = urlOrId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/)
      const videoId = match ? match[1] : (urlOrId.length === 11 ? urlOrId : null)
      if (!videoId) return { success: false, error: 'Invalid YouTube URL or ID' }
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`)
      const data = await res.json()
      return {
        success: true,
        videoId,
        title: (data?.title as string) || 'YouTube Track',
        channel: (data?.author_name as string) || 'YouTube',
        thumbnailUrl: (data?.thumbnail_url as string) || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      }
    } catch {
      return { success: false, error: 'Failed to fetch YouTube metadata' }
    }
  }
}

export function installWebApi(): void {
  if (!window.api) {
    window.api = webApi
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => false)
    }
    void initializeBrowserLibrary().then(() => {
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
    })
  }
}
