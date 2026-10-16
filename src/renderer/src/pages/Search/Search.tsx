import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CheckCircle2,
  Database,
  Download,
  Globe,
  HardDrive,
  Loader2,
  Music2,
  Play,
  Radio,
  Search as SearchIcon,
  X
} from 'lucide-react'
import { usePlayerStore, RECENTLY_PLAYED_STORAGE_KEY } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useAppStore } from '../../hooks/useAppStore'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { Song } from '../Library/Library'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ArtistLinks from '../../components/Common/ArtistLinks'
import { HighlightMatch } from '../../components/Common/HighlightMatch'
import { AppCapabilities } from '../../lib/appConfig'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'

import type { SearchTab, SearchItem, SearchSections, SearchProps } from './types'
import { EMPTY_RESULTS } from './types'
import {
  readRecentSearches,
  readRecentlyPlayed,
  normalize,
  parseSearchDuration,
  formatSongDuration,
  scoreSearchItem,
  RECENT_SEARCHES_STORAGE_KEY
} from './utils'
import { Artwork } from './components/Artwork'
import { SearchHeader } from './components/SearchHeader'
import { RecentSearchesView } from './components/RecentSearchesView'
import { SongList } from './components/SongList'
import { ResultGrid } from './components/ResultGrid'

export type { SearchProps }

export default function Search({ onOpenDownloadPanel }: SearchProps): ReactNode {
  const isMobile = useIsMobile()
  const { searchQuery, setSearchQuery, searchMode, setSearchMode } = useAppStore()
  const queue = usePlayerStore((s) => s.queue)
  const playbackContext = usePlayerStore((s) => s.playbackContext)
  const transfers = useDownloadStore((s) => s.transfers)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<SearchTab>('All')
  const [results, setResults] = useState<SearchSections>(EMPTY_RESULTS)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const pcLibrarySongs = useConnectedDeviceStore((s) => s.pcLibrarySongs)
  const user = useOnlineStore((s) => s.user)
  const isElectronApp = typeof window !== 'undefined' && Boolean((window as any).electron)
  const { requestPlayQueue } = usePlaybackArbitration()

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
    } else if (!AppCapabilities.lastFm && searchMode === 'lastfm') {
      setSearchMode('local')
    }
  }, [searchMode, setSearchMode])

  useEffect(() => {
    const loadLibrarySongs = (): void => {
      if (window.api?.getSongs) {
        void window.api
          .getSongs()
          .then((songs) => setLibrarySongs(songs || []))
          .catch((err) => console.error('Failed to load library for search matching:', err))
      } else {
        const pcSongs = useConnectedDeviceStore.getState().pcLibrarySongs
        if (pcSongs.length > 0) {
          setLibrarySongs(pcSongs)
        } else {
          const cached = useConnectedDeviceStore.getState().loadCachedPcSongs(user?.id)
          setLibrarySongs(cached || [])
        }
      }
    }

    void loadLibrarySongs()
    window.addEventListener('felo:library-updated', loadLibrarySongs)
    return () => window.removeEventListener('felo:library-updated', loadLibrarySongs)
  }, [user?.id])

  useEffect(() => {
    if (!isElectronApp && pcLibrarySongs.length > 0) {
      setLibrarySongs(pcLibrarySongs)
    }
  }, [isElectronApp, pcLibrarySongs])

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

  // Search Engine Effect
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

        if (AppCapabilities.lastFm && searchMode === 'lastfm') {
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
          let songs: any[] = []
          let artists: any[] = []
          let albums: any[] = []
          let playlists: any[] = []

          if (window.api?.searchSongs) {
            const searchResults = await Promise.all([
              window.api.searchSongs(query),
              window.api.searchArtists ? window.api.searchArtists(query) : Promise.resolve([]),
              window.api.searchAlbums ? window.api.searchAlbums(query) : Promise.resolve([]),
              window.api.getPlaylists ? window.api.getPlaylists() : Promise.resolve([])
            ])
            songs = searchResults[0] || []
            artists = searchResults[1] || []
            albums = searchResults[2] || []
            playlists = (searchResults[3] || []).filter((p: any) =>
              p.name.toLowerCase().includes(query.toLowerCase())
            )
          } else {
            let allLibrary = librarySongs
            if (allLibrary.length === 0) {
              allLibrary = useConnectedDeviceStore.getState().pcLibrarySongs
            }
            if (allLibrary.length === 0 && user?.id) {
              allLibrary = useConnectedDeviceStore.getState().loadCachedPcSongs(user.id)
            }

            const lowerQ = query.toLowerCase()
            songs = allLibrary.filter((s) => {
              const text = `${s.title} ${s.artist} ${s.album || ''}`.toLowerCase()
              return text.includes(lowerQ)
            })

            const artistSet = new Set<string>()
            const albumSet = new Set<string>()
            for (const s of allLibrary) {
              if (s.artist && s.artist.toLowerCase().includes(lowerQ)) {
                artistSet.add(s.artist)
              }
              if (s.album && s.album.toLowerCase().includes(lowerQ)) {
                albumSet.add(s.album)
              }
            }

            artists = Array.from(artistSet).map((name) => ({
              name,
              songCount: allLibrary.filter((s) => s.artist === name).length
            }))

            albums = Array.from(albumSet).map((title) => {
              const track = allLibrary.find((s) => s.album === title)
              return {
                title,
                artistName: track?.artist || '',
                artworkPath: track?.artworkPath || track?.artworkUrl,
                songCount: allLibrary.filter((s) => s.album === title).length
              }
            })
          }

          const mappedSongs: SearchItem[] = (songs || []).map((s: Song) => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album || '',
            type: 'Song',
            duration: formatSongDuration(s.duration),
            url: '',
            thumbnail: toMediaUrl(s.artworkPath) || s.artworkUrl || '',
            localSong: s
          }))

          const mappedArtists: SearchItem[] = (artists || []).map((artist: any) => ({
            id: String(artist.id || artist.name),
            title: artist.name || artist.title || '',
            artist: '',
            album: '',
            type: 'Artist',
            duration: null,
            url: '',
            thumbnail: toMediaUrl(artist.artworkPath) || artist.artworkUrl || '',
            trackCount: artist.songCount || artist.trackCount
          }))

          const mappedAlbums: SearchItem[] = (albums || []).map((album: any) => ({
            id: String(album.id || album.title),
            title: album.title || '',
            artist: album.artistName || album.artist || '',
            album: album.title || '',
            type: 'Album',
            duration: null,
            url: '',
            thumbnail: toMediaUrl(album.artworkPath) || album.artworkUrl || '',
            trackCount: album.songCount || album.trackCount
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
            thumbnail: toMediaUrl(pl.artworkPath) || pl.cover_url || '',
            trackCount: pl.songCount || pl.song_count
          }))

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
      } catch (err: any) {
        console.error('Search failed:', err)
        if (!cancelled) {
          setResults(EMPTY_RESULTS)
          setError(err instanceof Error ? err.message : 'Search failed. Please try again.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery, searchMode, librarySongs, user?.id])

  const localMatchFor = (item: SearchItem): Song | undefined => {
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

  const handlePlayItem = async (item: SearchItem): Promise<void> => {
    saveRecentSearch(searchQuery.trim() || item.title)

    if (item.type === 'Playlist') {
      try {
        let playlistTracks: any[] = []
        if (window.api?.getPlaylist) {
          const playlistData = await window.api.getPlaylist(item.id)
          playlistTracks = playlistData?.tracks || []
        } else {
          const hasLanHost = Boolean(remoteClient.getBaseUrl() && !remoteClient.getBaseUrl().includes('localhost'))
          if (remoteClient.getIsConnected() || hasLanHost) {
            const res = await remoteLibraryService.getPlaylistTracks(item.id)
            playlistTracks = res.tracks.map((r) => ({
              id: r.id,
              title: r.title,
              artist: r.artist,
              album: r.album,
              duration: r.duration,
              coverArt: r.artworkUrl,
              audioUrl: r.audioUrl || remoteClient.getAudioStreamUrl(r.id)
            }))
          }
        }

        if (playlistTracks && playlistTracks.length > 0) {
          const playlistQueue: Song[] = playlistTracks.map((t: any, idx: number) => {
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
              artworkUrl: t.coverArt || item.thumbnail,
              filePath: t.audioUrl || `virtual:${t.title} - ${t.artist}`
            }
          })
          void requestPlayQueue(playlistQueue, 0, {
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
        void requestPlayQueue(artistTracks, 0, {
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
        void requestPlayQueue(albumTracks, 0, {
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
      const directLocalMatch = localMatchFor(item)
      if (!directLocalMatch && AppCapabilities.downloads) {
        handleChooseSource(item)
        return
      }

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
          requestPlayQueue(queue, existingIdx, {
            type: 'search',
            title: `Search: "${searchQuery}"`
          })
          return
        }
      }

      const searchQueue: Song[] = results.Songs.map((s) => {
        const match = localMatchFor(s)
        const rawSong: Song = match || {
          id: s.id || `search-${s.title}-${s.artist}`,
          title: s.title,
          artist: s.artist,
          album: s.album || '',
          duration: parseSearchDuration(s.duration),
          artworkPath: s.thumbnail || '',
          filePath: `virtual:${s.title} - ${s.artist}`
        }
        return {
          ...rawSong,
          filePath: resolveSongAudioUrl(rawSong) || rawSong.filePath
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

      requestPlayQueue(effectiveQueue, effectiveIndex, {
        type: 'search',
        title: `Search: "${searchQuery}"`,
        subtitle: `${effectiveQueue.length} tracks`,
        route: `/search?q=${encodeURIComponent(searchQuery)}`
      })
      if (isVirtual) {
        usePlayerStore.getState().setIsBuffering(true)
      }
      return
    }

    if (item.url) {
      if (window.api?.openExternal) void window.api.openExternal(item.url)
      else window.open(item.url, '_blank')
    }
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
      autoDownload: false,
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

  const mobileSearchInputRef = useRef<HTMLInputElement>(null)

  const playedItems: SearchItem[] = useMemo(() => {
    return recentlyPlayed
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
  }, [recentlyPlayed, librarySongs])

  const handleMobileSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    if (trimmed) {
      saveRecentSearch(trimmed)
      mobileSearchInputRef.current?.blur()
    }
  }

  const handleClearMobileSearch = () => {
    setSearchQuery('')
    mobileSearchInputRef.current?.focus()
  }

  const isZeroQuery = !searchQuery.trim()

  return (
    <div className="h-full flex-1 flex flex-col select-none overflow-hidden">
      {/* Mobile-Only Persistent Sticky Search Input Bar */}
      <div
        className={cn(
          'shrink-0 px-4 pt-3 pb-2.5 bg-canvas/95 backdrop-blur-md border-b border-border-subtle/40 z-20',
          isMobile ? 'block' : 'md:hidden'
        )}
      >
        <form
          onSubmit={handleMobileSearchSubmit}
          className="flex items-center bg-surface-elevated rounded-full pl-4 pr-2 py-2 w-full border border-border/60 shadow-md focus-within:border-white/40 focus-within:ring-1 focus-within:ring-white/20 transition-all"
        >
          <SearchIcon className="w-4 h-4 text-text-muted shrink-0 mr-2.5" />
          <input
            ref={mobileSearchInputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              AppCapabilities.onlineSearch
                ? 'Search songs, artists, albums...'
                : 'Search local library...'
            }
            className="bg-transparent border-none outline-none text-sm font-medium text-text placeholder:text-text-muted w-full"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearMobileSearch}
              title="Clear search"
              className="p-1.5 rounded-full text-text-muted hover:text-text hover:bg-hover transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {/* Main Scrollable View */}
      <div
        className={cn(
          'flex-1 overflow-y-auto select-none px-4 sm:px-8 pb-36 md:pb-14',
          isZeroQuery ? 'pt-4 sm:pt-6 space-y-6 sm:space-y-10' : 'pt-4 sm:pt-6 space-y-4 sm:space-y-6'
        )}
      >
        {isZeroQuery ? (
          <RecentSearchesView
            recentSearches={recentSearches}
            playedItems={playedItems}
            onSelectRecentSearch={(q) => setSearchQuery(q)}
            onRemoveRecentSearch={removeRecentSearch}
            onClearRecentSearches={clearRecentSearches}
            onClearRecentlyPlayed={() => {
              localStorage.removeItem(RECENTLY_PLAYED_STORAGE_KEY)
              setRecentlyPlayed([])
            }}
            onPlayItem={(item) => void handlePlayItem(item)}
            onNavigate={(path) => navigate(path)}
            onBrowseCategory={(mode, tab, q) => {
              setSearchMode(mode)
              setActiveTab(tab)
              setSearchQuery(q)
            }}
          />
        ) : (
          <>
            <SearchHeader
              activeTab={activeTab}
              searchMode={searchMode}
              results={results}
              onTabChange={setActiveTab}
              onModeChange={setSearchMode}
            />

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
                      className="rounded-md bg-text px-4 py-2 text-xs font-bold text-canvas hover:opacity-90 cursor-pointer"
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
                                className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
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
                            className="h-12 w-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 hover:bg-white/90 active:scale-95 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
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
                              className="text-xs font-semibold text-text-muted hover:text-text transition-colors cursor-pointer"
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
                        className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <HardDrive className="w-3.5 h-3.5 text-text-muted" /> Search Local Library
                      </button>
                    )}
                    {searchMode !== 'apple_music' && (
                      <button
                        type="button"
                        onClick={() => setSearchMode('apple_music')}
                        className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5 text-text-muted" /> Search Apple Music
                      </button>
                    )}
                    {AppCapabilities.lastFm && searchMode !== 'lastfm' && (
                      <button
                        type="button"
                        onClick={() => setSearchMode('lastfm')}
                        className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Radio className="w-3.5 h-3.5 text-text-muted" /> Search Last.fm
                      </button>
                    )}
                    {searchMode !== 'musicbrainz' && (
                      <button
                        type="button"
                        onClick={() => setSearchMode('musicbrainz')}
                        className="px-3.5 py-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border/50 text-xs font-semibold text-text transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Database className="w-3.5 h-3.5 text-text-muted" /> Search MusicBrainz
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
