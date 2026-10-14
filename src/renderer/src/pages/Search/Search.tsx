import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckCircle2,
  Database,
  Disc3,
  Download,
  Flame,
  Globe,
  HardDrive,
  History,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  User as UserIcon,
  X
} from 'lucide-react'
import { usePlayerStore, RECENTLY_PLAYED_STORAGE_KEY } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useAppStore } from '../../hooks/useAppStore'
import { Song } from '../Library/Library'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import ArtistLinks from '../../components/Common/ArtistLinks'
import { HighlightMatch } from '../../components/Common/HighlightMatch'
import { ArtworkImage } from '../Home/components/ArtworkImage'
import { AppCapabilities } from '../../lib/appConfig'

type SearchTab = 'All' | 'Songs' | 'Artists' | 'Albums' | 'Playlists'

const RECENT_SEARCHES_STORAGE_KEY = 'felo_recent_searches'

function readRecentSearches(): string[] {
  try {
    const searches = JSON.parse(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) || '[]')
    return Array.isArray(searches)
      ? searches.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function readRecentlyPlayed(): Song[] {
  try {
    const songs = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]')
    return Array.isArray(songs) ? (songs as Song[]) : []
  } catch {
    return []
  }
}

interface SearchItem {
  id: string
  title: string
  artist: string
  album: string
  type: string
  duration: string | null
  url: string
  thumbnail: string
  explicit?: boolean
  localSong?: Song
  trackCount?: number
}

interface SearchSections {
  'Top Results': SearchItem[]
  Artists: SearchItem[]
  Albums: SearchItem[]
  Songs: SearchItem[]
  Playlists: SearchItem[]
}

interface SearchProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

const EMPTY_RESULTS: SearchSections = {
  'Top Results': [],
  Artists: [],
  Albums: [],
  Songs: [],
  Playlists: []
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunknown\s+artist\b/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official)\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video)\s*$/g,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSearchDuration(duration: string | null): number {
  if (!duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function formatSongDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}


function scoreSearchItem(item: SearchItem, query: string): number {
  const normQuery = query.toLowerCase().trim()
  const normTitle = (item.title || '').toLowerCase().trim()
  const normArtist = (item.artist || '').toLowerCase().trim()
  const normAlbum = (item.album || '').toLowerCase().trim()

  let score = 0

  // Exact matches
  if (normTitle === normQuery) {
    score += 100
  } else if (normTitle.startsWith(normQuery)) {
    score += 70
  } else if (normTitle.includes(normQuery)) {
    score += 40
  }

  if (normArtist === normQuery) {
    score += 85
  } else if (normArtist.startsWith(normQuery)) {
    score += 60
  } else if (normArtist.includes(normQuery)) {
    score += 30
  }

  if (normAlbum === normQuery) {
    score += 50
  } else if (normAlbum.startsWith(normQuery)) {
    score += 35
  }

  const tokens = normQuery.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) {
    const combined = `${normTitle} ${normArtist} ${normAlbum}`
    const allTokensMatch = tokens.every((t) => combined.includes(t))
    if (allTokensMatch) score += 45
  }

  // Boost artists with high song counts
  if (item.type === 'Artist') {
    if (normTitle === normQuery || normTitle.startsWith(normQuery)) {
      score += Math.min(30, (item.trackCount || 0) * 2)
    }
  }

  // Boost albums with tracks
  if (item.type === 'Album' && (item.trackCount || 0) > 0) {
    score += Math.min(15, item.trackCount || 0)
  }

  return score
}

function Artwork({
  item,
  className,
  artist = false
}: {
  item: SearchItem
  className: string
  artist?: boolean
}): ReactNode {
  const fallbackIcon = artist ? (
    <UserIcon className="w-1/3 h-1/3 text-text-muted" />
  ) : item.type === 'Playlist' ? (
    <ListMusic className="w-1/3 h-1/3 text-text-muted" />
  ) : item.type === 'Album' ? (
    <Disc3 className="w-1/3 h-1/3 text-text-muted" />
  ) : (
    <Music2 className="w-1/3 h-1/3 text-text-muted" />
  )

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden bg-surface-elevated border border-border/40 flex items-center justify-center transition-all',
        artist && 'rounded-full',
        className
      )}
    >
      <ArtworkImage
        src={item.thumbnail}
        title={item.title}
        artist={item.artist || ''}
        className="absolute inset-0 h-full w-full object-cover"
        fallbackIcon={fallbackIcon}
      />
    </div>
  )
}

export default function Search({ onOpenDownloadPanel }: SearchProps): ReactNode {
  const { searchQuery, setSearchQuery, searchMode, setSearchMode } = useAppStore()
  const { setQueue, queue, playSong, playbackContext } = usePlayerStore()
  const { transfers } = useDownloadStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<SearchTab>('All')
  const [results, setResults] = useState<SearchSections>(EMPTY_RESULTS)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches)
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>(readRecentlyPlayed)

  // Two-way URL synchronization with search query
  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null && q !== searchQuery) {
      setSearchQuery(q)
    }
  }, [searchParams])

  useEffect(() => {
    const trimmed = searchQuery.trim()
    const currentParam = searchParams.get('q') || ''
    if (trimmed !== currentParam) {
      if (trimmed) {
        setSearchParams({ q: trimmed }, { replace: true })
      } else if (currentParam) {
        setSearchParams({}, { replace: true })
      }
    }
  }, [searchQuery, searchParams, setSearchParams])

  useEffect(() => {
    if (!AppCapabilities.onlineSearch && searchMode !== 'local') {
      setSearchMode('local')
    }
  }, [searchMode, setSearchMode])

  useEffect(() => {
    const loadLibrarySongs = (): void => {
      void window.api
        ?.getSongs?.()
        .then((songs) => setLibrarySongs(songs || []))
        .catch((err) => console.error('Failed to load library for search matching:', err))
    }

    void loadLibrarySongs()
    window.addEventListener('felo:library-updated', loadLibrarySongs)
    return () => window.removeEventListener('felo:library-updated', loadLibrarySongs)
  }, [])

  const saveRecentSearch = (query: string): void => {
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) return
    const next = [
      trimmed,
      ...readRecentSearches().filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
    ].slice(0, 10)
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next))
    setRecentSearches(next)
    window.dispatchEvent(new CustomEvent('felo:recent-searches-updated'))
  }

  const removeRecentSearch = (queryToRemove: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    const next = recentSearches.filter((item) => item !== queryToRemove)
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next))
    setRecentSearches(next)
    window.dispatchEvent(new CustomEvent('felo:recent-searches-updated'))
  }

  const clearRecentSearches = (): void => {
    localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY)
    setRecentSearches([])
    window.dispatchEvent(new CustomEvent('felo:recent-searches-updated'))
  }

  useEffect(() => {
    const refreshRecent = (): void => setRecentSearches(readRecentSearches())
    window.addEventListener('felo:recent-searches-updated', refreshRecent)
    return () => window.removeEventListener('felo:recent-searches-updated', refreshRecent)
  }, [])

  useEffect(() => {
    const refreshRecentlyPlayed = (): void => setRecentlyPlayed(readRecentlyPlayed())
    window.addEventListener('felo:recently-played-updated', refreshRecentlyPlayed)
    return () => window.removeEventListener('felo:recently-played-updated', refreshRecentlyPlayed)
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setResults(EMPTY_RESULTS)
      setError('')
      setIsLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsLoading(true)
      setError('')

      try {
        if (AppCapabilities.onlineSearch && searchMode === 'apple_music') {
          const appleResults = await window.api.searchAppleMusic(query)
          if (!cancelled) {
            const raw = appleResults as SearchSections
            const allExternal = [
              ...(raw.Artists || []),
              ...(raw.Songs || []),
              ...(raw.Albums || [])
            ]
            let topResult = raw['Top Results']?.[0]
            if (!topResult && allExternal.length > 0) {
              const scored = allExternal.map((item) => ({ item, score: scoreSearchItem(item, query) }))
              scored.sort((a, b) => b.score - a.score)
              topResult = scored[0].item
            }
            setResults({
              'Top Results': topResult ? [topResult] : [],
              Songs: raw.Songs || [],
              Artists: raw.Artists || [],
              Albums: raw.Albums || [],
              Playlists: []
            })
          }
          return
        }

        if (AppCapabilities.onlineSearch && searchMode === 'musicbrainz') {
          const musicBrainzResults = await window.api.searchMusicBrainz(query)
          if (!cancelled) {
            const raw = musicBrainzResults as SearchSections
            const allExternal = [
              ...(raw.Artists || []),
              ...(raw.Songs || []),
              ...(raw.Albums || [])
            ]
            let topResult = raw['Top Results']?.[0]
            if (!topResult && allExternal.length > 0) {
              const scored = allExternal.map((item) => ({ item, score: scoreSearchItem(item, query) }))
              scored.sort((a, b) => b.score - a.score)
              topResult = scored[0].item
            }
            setResults({
              'Top Results': topResult ? [topResult] : [],
              Songs: raw.Songs || [],
              Artists: raw.Artists || [],
              Albums: raw.Albums || [],
              Playlists: []
            })
          }
          return
        }

        if (AppCapabilities.onlineSearch && searchMode === 'lastfm') {
          const lastFmResults = await window.api.searchLastFm(query)
          if (!cancelled) {
            const raw = lastFmResults as SearchSections
            const allExternal = [
              ...(raw.Artists || []),
              ...(raw.Songs || []),
              ...(raw.Albums || [])
            ]
            let topResult = raw['Top Results']?.[0]
            if (!topResult && allExternal.length > 0) {
              const scored = allExternal.map((item) => ({ item, score: scoreSearchItem(item, query) }))
              scored.sort((a, b) => b.score - a.score)
              topResult = scored[0].item
            }
            setResults({
              'Top Results': topResult ? [topResult] : [],
              Songs: raw.Songs || [],
              Artists: raw.Artists || [],
              Albums: raw.Albums || [],
              Playlists: []
            })
          }
          return
        }

        const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

        if (!AppCapabilities.onlineSearch || searchMode === 'local' || isOffline) {
          if (isOffline && searchMode !== 'local') {
            setError('You are offline. Showing results from your local library.')
          }
          const [songs, artists, albums, playlists] = await Promise.all([
            window.api.searchSongs(query),
            window.api.searchArtists(query),
            window.api.searchAlbums?.(query) || Promise.resolve([]),
            window.api.getPlaylists?.() || Promise.resolve([])
          ])

          const mappedSongs: SearchItem[] = (songs || []).map((song: Song) => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album || '',
            type: 'Song',
            duration: formatSongDuration(song.duration),
            url: '',
            thumbnail: toMediaUrl(song.artworkPath) || '',
            localSong: song
          }))

          const mappedArtists: SearchItem[] = (artists || []).map((artist: any) => ({
            id: String(artist.id),
            title: artist.name,
            artist: '',
            album: '',
            type: 'Artist',
            duration: null,
            url: '',
            thumbnail: toMediaUrl(artist.artworkPath) || '',
            trackCount: artist.songCount
          }))

          const mappedAlbums: SearchItem[] = (albums || []).map((album: any) => ({
            id: String(album.id),
            title: album.title,
            artist: album.artistName || '',
            album: album.title,
            type: 'Album',
            duration: null,
            url: '',
            thumbnail: toMediaUrl(album.artworkPath) || '',
            trackCount: album.songCount
          }))

          const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)
          const matchingPlaylists = (playlists || []).filter((pl: any) => {
            const combined = `${pl?.name || ''} ${pl?.description || ''}`.toLowerCase()
            return queryTokens.every((token) => combined.includes(token))
          })

          const mappedPlaylists: SearchItem[] = matchingPlaylists.map((pl: any) => ({
            id: String(pl.id),
            title: pl.name,
            artist: '',
            album: '',
            type: 'Playlist',
            duration: null,
            url: '',
            thumbnail: toMediaUrl(pl.artworkPath) || '',
            trackCount: pl.songCount
          }))

          // Determine the most relevant top result using multi-factor relevance scoring
          const allLocalItems = [
            ...mappedArtists,
            ...mappedSongs,
            ...mappedAlbums,
            ...mappedPlaylists
          ]
          let topResult: SearchItem | undefined
          if (allLocalItems.length > 0) {
            const scored = allLocalItems.map((item) => ({
              item,
              score: scoreSearchItem(item, query)
            }))
            scored.sort((a, b) => b.score - a.score)
            topResult = scored[0].item
          }

          if (!cancelled) {
            setResults({
              'Top Results': topResult ? [topResult] : [],
              Songs: mappedSongs,
              Artists: mappedArtists,
              Albums: mappedAlbums,
              Playlists: mappedPlaylists
            })
          }
          return
        }

        if (!cancelled) setResults(EMPTY_RESULTS)
      } catch (err) {
        console.error('Search failed:', err)
        if (!cancelled) {
          setResults(EMPTY_RESULTS)
          setError(err instanceof Error ? err.message : 'Search failed. Please try again.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchMode, searchQuery])

  const localMatchFor = (item: SearchItem) => {
    if (item.type !== 'Song') return undefined
    if (item.localSong) return item.localSong
    const title = normalize(item.title)
    const artist = normalize(item.artist)
    return librarySongs.find((song) => {
      if (normalize(song.title) !== title) return false
      const localArtist = normalize(song.artist)
      return !artist || !localArtist || artist.includes(localArtist) || localArtist.includes(artist)
    })
  }

  const handlePlayItem = async (item: SearchItem) => {
    saveRecentSearch(searchQuery.trim() || item.title)

    if (item.type === 'Playlist') {
      try {
        const playlistData = await window.api.getPlaylist(item.id)
        if (playlistData?.tracks && playlistData.tracks.length > 0) {
          const playlistQueue: Song[] = playlistData.tracks.map((t: any, idx: number) => {
            const local = librarySongs.find(
              (s) =>
                (t.matchedSongId && s.id === t.matchedSongId) || (t.songId && s.id === t.songId)
            )
            if (local) return local
            return {
              id: t.id || `pl-track-${item.id}-${idx}`,
              title: t.title,
              artist: t.artist || 'Unknown Artist',
              album: t.album || item.title,
              duration: t.duration || 0,
              artworkPath: t.coverArt || item.thumbnail,
              filePath: `virtual:${t.title} - ${t.artist}`
            }
          })
          setQueue(playlistQueue, 0, {
            type: 'playlist',
            title: item.title,
            subtitle: `${playlistQueue.length} tracks`,
            route: `/playlists/${item.id}`
          })
          return
        }
      } catch (err) {
        console.error('Failed to play playlist tracks:', err)
      }
      navigate(`/playlists/${item.id}`)
      return
    }

    if (item.type === 'Artist') {
      const targetArtist = item.title.toLowerCase()
      const artistTracks = librarySongs.filter((song) => {
        const artist = song.artist?.toLowerCase() || ''
        return artist === targetArtist || artist.includes(targetArtist)
      })
      if (artistTracks.length > 0) {
        setQueue(artistTracks, 0, {
          type: 'artist',
          title: item.title,
          subtitle: `${artistTracks.length} tracks`,
          route: `/artist/${encodeURIComponent(item.title)}`
        })
        return
      }
      navigate(`/artist/${encodeURIComponent(item.title)}`)
      return
    }

    if (item.type === 'Album') {
      const targetAlbum = item.title.toLowerCase()
      const albumTracks = librarySongs.filter(
        (song) => song.album?.toLowerCase() === targetAlbum
      )
      if (albumTracks.length > 0) {
        setQueue(albumTracks, 0, {
          type: 'album',
          title: item.title,
          subtitle: item.artist || 'Unknown Artist',
          route: `/album/${encodeURIComponent(item.artist || 'Unknown Artist')}/${encodeURIComponent(item.title)}`
        })
        return
      }
      navigate(
        `/album/${encodeURIComponent(item.artist || 'Unknown Artist')}/${encodeURIComponent(item.title)}`
      )
      return
    }

    if (item.type === 'Song') {
      const isSameSearchContext =
        playbackContext?.type === 'search' &&
        playbackContext.title === `Search: "${searchQuery}"`

      if (isSameSearchContext) {
        const existingIdx = queue.findIndex(
          (s) =>
            s.id === item.id ||
            (s.title.toLowerCase() === item.title.toLowerCase() &&
              (!item.artist || !s.artist || s.artist.toLowerCase() === item.artist.toLowerCase()))
        )
        if (existingIdx >= 0) {
          playSong(existingIdx)
          return
        }
      }

      const searchQueue: Song[] = results.Songs.map((s) => {
        const match = localMatchFor(s)
        if (match) return match
        return {
          id: s.id || `search-${s.title}-${s.artist}`,
          title: s.title,
          artist: s.artist,
          album: s.album || '',
          duration: parseSearchDuration(s.duration),
          artworkPath: s.thumbnail || '',
          filePath: `virtual:${s.title} - ${s.artist}`
        }
      })

      const targetId = item.id || `search-${item.title}-${item.artist}`
      const playIdx = searchQueue.findIndex(
        (s) =>
          s.id === targetId ||
          (s.title.toLowerCase() === item.title.toLowerCase() &&
            s.artist.toLowerCase() === item.artist.toLowerCase())
      )

      const fallbackSong: Song = {
        id: targetId,
        title: item.title,
        artist: item.artist,
        album: item.album || '',
        duration: parseSearchDuration(item.duration),
        artworkPath: item.thumbnail || '',
        filePath: `virtual:${item.title} - ${item.artist}`
      }

      const effectiveQueue = searchQueue.length > 0 ? searchQueue : [fallbackSong]
      const effectiveIndex = playIdx >= 0 ? playIdx : 0
      const activeItem = effectiveQueue[effectiveIndex]
      const isVirtual = !activeItem?.filePath || activeItem.filePath.startsWith('virtual:')

      setQueue(effectiveQueue, effectiveIndex, {
        type: 'search',
        title: `Search: "${searchQuery}"`,
        subtitle: `${effectiveQueue.length} tracks`,
        route: `/search?q=${encodeURIComponent(searchQuery)}`
      })
      usePlayerStore.getState().setIsBuffering(isVirtual)
      return
    }

    if (item.url) void window.api.openExternal(item.url)
  }

  const handleDownloadItem = (item: SearchItem) => {
    const localMatch = localMatchFor(item)
    if (localMatch) {
      onOpenDownloadPanel?.({
        id: localMatch.id,
        title: localMatch.title,
        artist: localMatch.artist,
        album: localMatch.album || '',
        duration: localMatch.duration || 0,
        filePath: localMatch.filePath,
        artworkPath: localMatch.artworkPath,
        size: localMatch.size,
        sampleRate: localMatch.sampleRate,
        isOnline: false,
        autoDownload: false,
        autoPlay: false
      })
      return
    }

    onOpenDownloadPanel?.({
      id: item.id,
      title: item.title,
      artist: item.artist,
      album: item.album || '',
      duration: parseSearchDuration(item.duration),
      artworkUrl: item.thumbnail,
      isOnline: true,
      autoDownload: true,
      autoPlay: false
    })
  }

  const handleChooseSource = (item: SearchItem) => {
    const localMatch = localMatchFor(item)
    onOpenDownloadPanel?.({
      id: localMatch?.id || item.id,
      title: item.title,
      artist: item.artist,
      album: item.album || '',
      duration: localMatch?.duration || parseSearchDuration(item.duration),
      filePath: localMatch?.filePath,
      artworkPath: localMatch?.artworkPath,
      artworkUrl: item.thumbnail,
      isOnline: !localMatch,
      autoDownload: false,
      autoPlay: false
    })
  }

  const handleOpenItem = (item: SearchItem) => {
    saveRecentSearch(searchQuery.trim() || item.title)
    if (item.type === 'Artist') {
      navigate(`/artist/${encodeURIComponent(item.title)}`)
      return
    }
    if (item.type === 'Album') {
      navigate(
        `/album/${encodeURIComponent(item.artist || 'Unknown Artist')}/${encodeURIComponent(item.title)}`
      )
      return
    }
    if (item.type === 'Playlist') {
      navigate(`/playlists/${item.id}`)
      return
    }

    void handlePlayItem(item)
  }

  const topResult =
    results['Top Results'][0] ||
    results.Songs[0] ||
    results.Artists[0] ||
    results.Albums[0] ||
    results.Playlists[0]
  const visibleSongs = activeTab === 'All' ? results.Songs.slice(0, 4) : results.Songs
  const hasResults = useMemo(
    () => Object.values(results).some((section) => section.length > 0),
    [results]
  )

  // Zero-Query / Browse View
  if (!searchQuery.trim()) {
    const playedItems: SearchItem[] = recentlyPlayed
      .filter((song) => librarySongs.some((librarySong) => librarySong.id === song.id))
      .slice(0, 6)
      .map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        type: 'Song',
        duration: formatSongDuration(song.duration),
        url: '',
        thumbnail: toMediaUrl(song.artworkPath) || song.artworkUrl || '',
        localSong: song
      }))

    return (
      <div className="h-full flex flex-col pt-6 px-8 pb-12 overflow-y-auto select-none space-y-10">
        <div>
          <h1 className="text-3xl font-extrabold text-text tracking-tight">Search & Browse</h1>
          <p className="text-sm text-text-muted mt-1">
            {AppCapabilities.onlineSearch
              ? 'Explore your library or search across global catalog streaming sources.'
              : 'Search and explore your local music library.'}
          </p>
        </div>

        {/* Recent Searches */}
        {recentSearches.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-text flex items-center gap-2">
                <History className="w-4 h-4 text-text-muted" /> Recent Searches
              </h2>
              <button
                type="button"
                onClick={clearRecentSearches}
                className="text-xs font-medium text-text-muted hover:text-text transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {recentSearches.map((query) => (
                <div
                  key={query}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSearchQuery(query)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSearchQuery(query)
                  }}
                  className="group flex items-center gap-2 rounded-full bg-surface-elevated pl-4 pr-2 py-1.5 text-sm text-text hover:bg-hover hover:text-primary transition-colors cursor-pointer border border-border/50 shadow-sm"
                >
                  <History className="w-3.5 h-3.5 text-text-muted group-hover:text-primary" />
                  <span className="font-medium">{query}</span>
                  <button
                    type="button"
                    title="Remove from recent searches"
                    onClick={(e) => removeRecentSearch(query, e)}
                    className="p-1 rounded-full text-text-muted hover:text-white hover:bg-white/10 transition-colors ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Browse All Cards */}
        <section>
          <h2 className="text-lg font-bold text-text mb-4">Browse Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
            <button
              type="button"
              onClick={() => navigate('/library')}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-amber-600/90 to-amber-900 border border-amber-500/20 shadow-md group"
            >
              <span className="text-base font-bold text-white block">Your Library</span>
              <span className="text-[11px] text-white/70 block mt-0.5">Local Tracks</span>
              <HardDrive className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-purple-600/90 to-indigo-900 border border-purple-500/20 shadow-md group"
            >
              <span className="text-base font-bold text-white block">Playlists</span>
              <span className="text-[11px] text-white/70 block mt-0.5">Curated Mixes</span>
              <ListMusic className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
            </button>

            <button
              type="button"
              onClick={() => {
                setSearchMode('local')
                setActiveTab('Artists')
                setSearchQuery('a')
              }}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-emerald-600/90 to-teal-900 border border-emerald-500/20 shadow-md group"
            >
              <span className="text-base font-bold text-white block">Artists</span>
              <span className="text-[11px] text-white/70 block mt-0.5">All Creators</span>
              <UserIcon className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
            </button>

            <button
              type="button"
              onClick={() => {
                setSearchMode('local')
                setActiveTab('Albums')
                setSearchQuery('a')
              }}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-rose-600/90 to-pink-900 border border-rose-500/20 shadow-md group"
            >
              <span className="text-base font-bold text-white block">Albums</span>
              <span className="text-[11px] text-white/70 block mt-0.5">Discography</span>
              <Disc3 className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
            </button>

            {AppCapabilities.onlineSearch && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSearchMode('apple_music')
                    setSearchQuery('Billboard Hot 100')
                  }}
                  className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-blue-600/90 to-cyan-900 border border-blue-500/20 shadow-md group"
                >
                  <span className="text-base font-bold text-white block">Apple Music</span>
                  <span className="text-[11px] text-white/70 block mt-0.5">Global Catalog</span>
                  <Globe className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSearchMode('lastfm')
                    setSearchQuery('Top Tracks')
                  }}
                  className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-gradient-to-br from-red-600/90 to-orange-900 border border-red-500/20 shadow-md group"
                >
                  <span className="text-base font-bold text-white block">Last.fm</span>
                  <span className="text-[11px] text-white/70 block mt-0.5">Scrobbles & Charts</span>
                  <Radio className="absolute bottom-2 right-2 w-10 h-10 text-white/20 group-hover:rotate-12 transition-transform" />
                </button>
              </>
            )}
          </div>
        </section>

        {/* Recently Played */}
        {playedItems.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-text flex items-center gap-2">
                <Flame className="w-4 h-4 text-text-muted" /> Recently Played
              </h2>
              <button
                type="button"
                title="Clear recently played"
                onClick={() => {
                  localStorage.removeItem(RECENTLY_PLAYED_STORAGE_KEY)
                  setRecentlyPlayed([])
                }}
                className="text-xs text-text-muted hover:text-text transition-colors"
              >
                Clear
              </button>
            </div>
            <RecentlyPlayedList songs={playedItems} onPlay={handlePlayItem} />
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto select-none px-8 pt-6 pb-14 space-y-6">
      {/* Source Switcher & Filter Tabs Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/40">
        {/* Category Tabs: All, Songs, Artists, Albums, Playlists */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(['All', 'Songs', 'Artists', 'Albums', 'Playlists'] as const).map((tab) => {
            const count =
              tab === 'Songs'
                ? results.Songs.length
                : tab === 'Artists'
                  ? results.Artists.length
                  : tab === 'Albums'
                    ? results.Albums.length
                    : tab === 'Playlists'
                      ? results.Playlists.length
                      : null
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all shrink-0',
                  activeTab === tab
                    ? 'bg-text text-canvas shadow-sm font-bold'
                    : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text border border-border/40'
                )}
              >
                {tab}
                {count !== null && count > 0 && (
                  <span className="ml-1.5 opacity-70 tabular-nums">({count})</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Source Switcher Pills */}
        {AppCapabilities.onlineSearch && (
          <div className="flex items-center gap-1 bg-surface-elevated p-1 rounded-full border border-border/50 text-xs shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setSearchMode('local')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors',
                searchMode === 'local'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <HardDrive className="w-3.5 h-3.5" /> Local
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('apple_music')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors',
                searchMode === 'apple_music'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <Globe className="w-3.5 h-3.5" /> Apple Music
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('musicbrainz')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors',
                searchMode === 'musicbrainz'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <Database className="w-3.5 h-3.5" /> MusicBrainz
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('lastfm')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors',
                searchMode === 'lastfm'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <Radio className="w-3.5 h-3.5" /> Last.fm
            </button>
          </div>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-6 animate-pulse pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
            <div className="h-64 rounded-xl bg-surface-elevated/50" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 rounded-lg bg-surface-elevated/40" />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error View */}
      {!isLoading && error && (
        <div className="h-64 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          {searchMode === 'lastfm' && error.toLowerCase().includes('api key') && (
            <>
              <p className="max-w-md text-xs text-text-muted">
                Last.fm requires a free API key for catalog search. Your key is stored locally and is
                only used to query Last.fm.
              </p>
              <button
                type="button"
                onClick={() => navigate('/settings')}
                className="rounded-md bg-text px-4 py-2 text-xs font-bold text-canvas hover:opacity-90"
              >
                Open Settings
              </button>
            </>
          )}
        </div>
      )}

      {/* Active Results View */}
      {!isLoading && !error && hasResults && (
        <div className="space-y-10 animate-in fade-in duration-200">
          {/* 'All' Tab: Split Layout with Top Result + Songs */}
          {activeTab === 'All' && topResult && (
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
              <section>
                <h2 className="text-xl font-bold text-text mb-3">Top result</h2>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenItem(topResult)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleOpenItem(topResult)
                    }
                  }}
                  className="w-full h-64 text-left bg-surface-elevated border border-border/20 rounded-xl p-6 hover:bg-hover transition-colors group flex flex-col relative cursor-pointer shadow-md"
                >
                  <Artwork
                    item={topResult}
                    artist={topResult.type === 'Artist'}
                    className="w-24 h-24 rounded-lg shadow-lg mb-4"
                  />
                  <div className="mt-auto min-w-0 w-full pr-14">
                    <h3 className="text-2xl font-bold text-text truncate group-hover:text-primary transition-colors">
                      <HighlightMatch text={topResult.title} query={searchQuery} />
                    </h3>
                    <div className="flex items-center gap-2 mt-2 text-xs text-text-muted min-w-0">
                      {localMatchFor(topResult) && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60">
                          In Library
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold text-text">{topResult.type}</span>
                        {topResult.artist && (
                          <>
                            <span>•</span>
                            <ArtistLinks
                              artist={topResult.artist}
                              artists={topResult.localSong?.artists}
                              linkClassName="text-xs text-text-muted hover:text-text hover:underline"
                            />
                          </>
                        )}
                        {topResult.trackCount !== undefined && topResult.trackCount > 0 && (
                          <>
                            <span>•</span>
                            <span>{topResult.trackCount} tracks</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="absolute right-5 bottom-5 flex items-center gap-2">
                    {AppCapabilities.downloads && topResult.type === 'Song' && (() => {
                      const topTransfer = transfers.find(
                        (t) =>
                          t.title.toLowerCase() === topResult.title.toLowerCase() &&
                          (!topResult.artist ||
                            !t.artist ||
                            t.artist.toLowerCase() === topResult.artist.toLowerCase()) &&
                          (t.status === 'downloading' || t.status === 'queued')
                      )
                      const isTopDownloading = Boolean(topTransfer)

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownloadItem(topResult)
                          }}
                          title={
                            isTopDownloading
                              ? `Downloading (${topTransfer?.progress || 0}%)...`
                              : localMatchFor(topResult)
                                ? 'View download sources'
                                : 'Download track'
                          }
                          className={`h-10 w-10 rounded-full flex items-center justify-center transition-all ${
                            isTopDownloading
                              ? 'bg-white/10 text-primary'
                              : 'bg-white/10 hover:bg-white/20 text-white opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          {isTopDownloading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : localMatchFor(topResult) ? (
                            <CheckCircle2 className="w-5 h-5 text-text-muted" />
                          ) : (
                            <Download className="w-5 h-5" />
                          )}
                        </button>
                      )
                    })()}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handlePlayItem(topResult)
                      }}
                      title={`Play ${topResult.type}: ${topResult.title}`}
                      className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 hover:bg-white/90 active:scale-95 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Play className="w-6 h-6 fill-current ml-0.5" />
                    </button>
                  </div>
                </div>
              </section>

              {/* Songs Section (Top 4) */}
              {visibleSongs.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-bold text-text">Songs</h2>
                    {results.Songs.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('Songs')}
                        className="text-xs font-semibold text-text-muted hover:text-text transition-colors"
                      >
                        See all ({results.Songs.length})
                      </button>
                    )}
                  </div>
                  <SongList
                    songs={visibleSongs}
                    query={searchQuery}
                    onPlay={handlePlayItem}
                    onDownload={handleDownloadItem}
                    onChooseSource={handleChooseSource}
                    isLocal={localMatchFor}
                  />
                </section>
              )}
            </div>
          )}

          {/* Dedicated 'Songs' Tab */}
          {activeTab === 'Songs' && results.Songs.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-text">Songs ({results.Songs.length})</h2>
              </div>
              <SongList
                songs={results.Songs}
                query={searchQuery}
                onPlay={handlePlayItem}
                onDownload={handleDownloadItem}
                onChooseSource={handleChooseSource}
                isLocal={localMatchFor}
                fullView
              />
            </section>
          )}

          {/* Artists Section / Tab */}
          {(activeTab === 'All' || activeTab === 'Artists') && results.Artists.length > 0 && (
            <ResultGrid
              title="Artists"
              items={results.Artists}
              query={searchQuery}
              artist
              onSelect={handleOpenItem}
              onPlay={handlePlayItem}
              showAllButton={activeTab === 'All' && results.Artists.length > 6}
              onShowAll={() => setActiveTab('Artists')}
            />
          )}

          {/* Albums Section / Tab */}
          {(activeTab === 'All' || activeTab === 'Albums') && results.Albums.length > 0 && (
            <ResultGrid
              title="Albums"
              items={results.Albums}
              query={searchQuery}
              onSelect={handleOpenItem}
              onPlay={handlePlayItem}
              showAllButton={activeTab === 'All' && results.Albums.length > 6}
              onShowAll={() => setActiveTab('Albums')}
            />
          )}

          {/* Playlists Section / Tab */}
          {(activeTab === 'All' || activeTab === 'Playlists') && results.Playlists.length > 0 && (
            <ResultGrid
              title="Playlists"
              items={results.Playlists}
              query={searchQuery}
              onSelect={handleOpenItem}
              onPlay={handlePlayItem}
              showAllButton={activeTab === 'All' && results.Playlists.length > 6}
              onShowAll={() => setActiveTab('Playlists')}
            />
          )}
        </div>
      )}

      {/* Empty Search Results */}
      {!isLoading && !error && !hasResults && (
        <div className="h-72 flex flex-col items-center justify-center gap-3 text-center px-4">
          <div className="w-14 h-14 rounded-full bg-surface-elevated border border-border/40 flex items-center justify-center text-text-muted mb-2">
            <Music2 className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-text">
            No results found for &quot;{searchQuery}&quot;
          </h3>
          <p className="text-xs text-text-muted max-w-md">
            {AppCapabilities.onlineSearch
              ? 'Please check your spelling, try fewer keywords, or switch your search source to explore external streaming catalogs.'
              : 'Please check your spelling, try fewer keywords, or ensure the songs are imported into your local library.'}
          </p>
          {AppCapabilities.onlineSearch && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
              {searchMode !== 'local' && (
                <button
                  type="button"
                  onClick={() => setSearchMode('local')}
                  className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5"
                >
                  <HardDrive className="w-3.5 h-3.5 text-text-muted" /> Search Local Library
                </button>
              )}
              {searchMode !== 'apple_music' && (
                <button
                  type="button"
                  onClick={() => setSearchMode('apple_music')}
                  className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5"
                >
                  <Globe className="w-3.5 h-3.5 text-text-muted" /> Search Apple Music
                </button>
              )}
              {searchMode !== 'lastfm' && (
                <button
                  type="button"
                  onClick={() => setSearchMode('lastfm')}
                  className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5"
                >
                  <Radio className="w-3.5 h-3.5 text-text-muted" /> Search Last.fm
                </button>
              )}
              {searchMode !== 'musicbrainz' && (
                <button
                  type="button"
                  onClick={() => setSearchMode('musicbrainz')}
                  className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5"
                >
                  <Database className="w-3.5 h-3.5 text-text-muted" /> Search MusicBrainz
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RecentlyPlayedList({
  songs,
  onPlay
}: {
  songs: SearchItem[]
  onPlay: (item: SearchItem) => void
}): ReactNode {
  return (
    <div className="w-full overflow-hidden border border-border/30 rounded-xl bg-surface-elevated/30">
      <div className="grid grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 border-b border-border/20 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted md:px-4">
        <div className="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div>Album</div>
        <div className="text-right">Time</div>
      </div>
      <div className="divide-y divide-border/10">
        {songs.map((song, index) => (
          <button
            type="button"
            key={song.id}
            onClick={() => onPlay(song)}
            className="group grid w-full grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-elevated md:px-4"
          >
            <span className="text-center text-text-muted tabular-nums group-hover:hidden">
              {index + 1}
            </span>
            <span className="hidden group-hover:flex items-center justify-center text-primary">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </span>
            <div className="flex items-center gap-3 min-w-0">
              <Artwork item={song} className="w-8 h-8 rounded shrink-0" />
              <span className="min-w-0 truncate font-semibold text-text group-hover:text-primary transition-colors">
                {song.title}
              </span>
            </div>
            <span className="min-w-0 truncate text-text-muted text-xs">
              <ArtistLinks
                artist={song.artist}
                artists={song.localSong?.artists}
                linkClassName="text-text-muted hover:text-text hover:underline text-xs"
              />
            </span>
            <span className="min-w-0 truncate text-text-muted text-xs">{song.album || '-'}</span>
            <span className="text-right text-text-muted tabular-nums text-xs">
              {formatSongDuration(song.localSong?.duration || 0)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SongList({
  songs,
  query,
  onPlay,
  onDownload,
  onChooseSource,
  isLocal,
  fullView = false
}: {
  songs: SearchItem[]
  query?: string
  onPlay: (item: SearchItem) => void | Promise<void>
  onDownload: (item: SearchItem) => void
  onChooseSource: (item: SearchItem) => void
  isLocal: (item: SearchItem) => Song | undefined
  fullView?: boolean
}) {
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const queue = usePlayerStore((s) => s.queue)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const { transfers } = useDownloadStore()
  const currentTrack = queue[currentSongIndex]

  return (
    <div className={cn('flex flex-col', fullView && 'border border-border/30 rounded-xl overflow-hidden bg-surface-elevated/20')}>
      {fullView && (
        <div className="grid grid-cols-[36px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px] items-center gap-3 border-b border-border/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted md:px-4">
          <div className="text-center">#</div>
          <div>Title</div>
          <div className="hidden md:block">Artist</div>
          <div className="hidden lg:block">Album</div>
          <div className="text-right pr-2">Duration</div>
        </div>
      )}
      {songs.map((song, index) => {
        const localSong = isLocal(song)
        const isCurrentSong =
          currentTrack &&
          ((localSong && currentTrack.id === localSong.id) ||
            (song.localSong && currentTrack.id === song.localSong.id) ||
            (currentTrack.title.toLowerCase() === song.title.toLowerCase() &&
              (!song.artist ||
                currentTrack.artist.toLowerCase().includes(song.artist.toLowerCase()))))
        const isSongPlaying = isCurrentSong && isPlaying

        const transfer = transfers.find(
          (t) =>
            t.title.toLowerCase() === song.title.toLowerCase() &&
            (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
            (t.status === 'downloading' || t.status === 'queued')
        )
        const isDownloading = Boolean(transfer)

        return (
          <div
            role="button"
            tabIndex={0}
            key={song.id || `${song.title}-${index}`}
            onClick={() => onPlay(song)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onPlay(song)
              }
            }}
            className={cn(
              'flex items-center justify-between gap-4 px-3 rounded-lg hover:bg-surface-elevated group text-left transition-colors cursor-pointer',
              fullView ? 'h-14 md:px-4 border-b border-border/10 last:border-b-0' : 'h-14'
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              {fullView && (
                <span className="w-5 text-center text-xs text-text-muted tabular-nums shrink-0">
                  {index + 1}
                </span>
              )}

              <div className="relative group/art shrink-0">
                <Artwork item={song} className="w-10 h-10 rounded-md" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlay(song)
                  }}
                  title={isSongPlaying ? 'Pause' : 'Play'}
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-md bg-black/60 transition-opacity',
                    isSongPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  {isSongPlaying ? (
                    <Pause className="w-4 h-4 fill-white text-white" />
                  ) : (
                    <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-sm font-semibold truncate',
                      isCurrentSong ? 'text-primary' : 'text-text'
                    )}
                  >
                    <HighlightMatch text={song.title} query={query} />
                  </span>
                  {song.explicit && (
                    <span className="text-[9px] font-bold px-1 rounded bg-surface-elevated text-text-muted border border-border/40">
                      E
                    </span>
                  )}
                  {localSong && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60">
                      In Library
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted truncate mt-0.5">
                  <ArtistLinks
                    artist={song.artist}
                    artists={song.localSong?.artists || (localSong ? localSong.artists : undefined)}
                    linkClassName="text-xs text-text-muted hover:text-text hover:underline"
                  />
                  {fullView && song.album && (
                    <span className="md:hidden opacity-75"> • {song.album}</span>
                  )}
                </div>
              </div>
            </div>

            {fullView && (
              <div className="hidden lg:block min-w-0 max-w-[200px] truncate text-xs text-text-muted">
                {song.album || '-'}
              </div>
            )}

            <div className="flex items-center gap-3 shrink-0">
              {song.duration && (
                <span className="text-xs text-text-muted tabular-nums">{song.duration}</span>
              )}

              {AppCapabilities.downloads && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (localSong) {
                      onChooseSource(song)
                    } else {
                      onDownload(song)
                    }
                  }}
                  title={
                    isDownloading
                      ? `Downloading (${transfer?.progress || 0}%)...`
                      : localSong
                        ? 'In your library (Click to choose source or replace)'
                        : 'Download track to library'
                  }
                  className={cn(
                    'h-8 w-8 flex items-center justify-center rounded-full transition-all',
                    isDownloading
                      ? 'text-primary'
                      : localSong
                        ? 'text-text-muted hover:text-white hover:bg-white/10'
                        : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                  )}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : localSong ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ResultGrid({
  title,
  items,
  query,
  artist = false,
  onSelect,
  onPlay,
  showAllButton = false,
  onShowAll
}: {
  title: string
  items: SearchItem[]
  query?: string
  artist?: boolean
  onSelect: (item: SearchItem) => void
  onPlay?: (item: SearchItem) => void | Promise<void>
  showAllButton?: boolean
  onShowAll?: () => void
}) {
  const displayItems = showAllButton ? items.slice(0, 6) : items

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text">{title}</h2>
        {showAllButton && onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="text-xs font-semibold text-text-muted hover:text-text transition-colors"
          >
            See all ({items.length})
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {displayItems.map((item) => (
          <div
            role="button"
            tabIndex={0}
            key={item.id}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(item)
              }
            }}
            className="min-w-0 text-left group p-3 rounded-xl bg-surface-elevated/40 hover:bg-surface-elevated border border-border/20 transition-all shadow-sm hover:shadow-md cursor-pointer relative"
          >
            <div className="relative mb-3">
              <Artwork
                item={item}
                artist={artist}
                className={cn(
                  'w-full aspect-square shadow-md transition-transform group-hover:scale-[1.03]',
                  artist ? 'rounded-full' : 'rounded-lg'
                )}
              />
              {onPlay && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onPlay(item)
                  }}
                  title={`Play ${item.title}`}
                  className="absolute right-2 bottom-2 h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-110 hover:bg-white/90 active:scale-95 transition-all opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0"
                >
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </button>
              )}
            </div>
            <div className="font-bold text-sm text-text group-hover:text-primary transition-colors truncate">
              <HighlightMatch text={item.title} query={query} />
            </div>
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {artist
                ? item.trackCount !== undefined
                  ? `${item.trackCount} ${item.trackCount === 1 ? 'song' : 'songs'}`
                  : 'Artist'
                : item.type === 'Playlist'
                  ? item.trackCount !== undefined
                    ? `${item.trackCount} ${item.trackCount === 1 ? 'track' : 'tracks'}`
                    : 'Playlist'
                  : item.artist || (item.trackCount ? `${item.trackCount} tracks` : 'Album')}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
