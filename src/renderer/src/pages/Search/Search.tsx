import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { History, Music2, User as UserIcon, X } from 'lucide-react'
import { usePlayerStore, RECENTLY_PLAYED_STORAGE_KEY } from '../../hooks/usePlayerStore'
import { useAppStore } from '../../hooks/useAppStore'
import { Song } from '../Library/Library'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media'
import { useNavigate } from 'react-router-dom'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

type SearchTab = 'All' | 'Artists' | 'Songs' | 'Albums'

const RECENT_SEARCHES_STORAGE_KEY = 'felo_recent_searches'

function readRecentSearches(): string[] {
  try {
    const searches = JSON.parse(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) || '[]')
    return Array.isArray(searches) ? searches.filter((item): item is string => typeof item === 'string') : []
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
}

interface SearchSections {
  'Top Results': SearchItem[]
  Artists: SearchItem[]
  Albums: SearchItem[]
  Songs: SearchItem[]
}

interface SearchProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

const EMPTY_RESULTS: SearchSections = {
  'Top Results': [],
  Artists: [],
  Albums: [],
  Songs: []
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

function Artwork({
  item,
  className,
  artist = false
}: {
  item: SearchItem
  className: string
  artist?: boolean
}): ReactNode {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden bg-surface border border-border/50 flex items-center justify-center',
        artist && 'rounded-full',
        className
      )}
    >
      {artist ? (
        <UserIcon className="w-1/3 h-1/3 text-text-muted" />
      ) : (
        <Music2 className="w-1/3 h-1/3 text-text-muted" />
      )}
      {item.thumbnail && (
        <img
          src={item.thumbnail}
          alt=""
          draggable={false}
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

export default function Search({ onOpenDownloadPanel }: SearchProps): ReactNode {
  const { searchQuery, searchMode, setSearchQuery } = useAppStore()
  const { setQueue } = usePlayerStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SearchTab>('All')
  const [results, setResults] = useState<SearchSections>(EMPTY_RESULTS)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>(readRecentSearches)
  const [recentlyPlayed, setRecentlyPlayed] = useState<Song[]>(readRecentlyPlayed)

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

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) return

    const timer = window.setTimeout(() => {
      const next = [query, ...readRecentSearches().filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8)
      localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next))
      setRecentSearches(next)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

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
        if (searchMode === 'apple_music') {
          const appleResults = await window.api.searchAppleMusic(query)
          if (!cancelled) setResults(appleResults as SearchSections)
          return
        }

        if (searchMode === 'musicbrainz') {
          const musicBrainzResults = await window.api.searchMusicBrainz(query)
          if (!cancelled) setResults(musicBrainzResults as SearchSections)
          return
        }

        if (searchMode === 'lastfm') {
          const lastFmResults = await window.api.searchLastFm(query)
          if (!cancelled) setResults(lastFmResults as SearchSections)
          return
        }

        if (searchMode === 'local') {
          const [songs, artists] = await Promise.all([
            window.api.searchSongs(query),
            window.api.searchArtists(query)
          ])
          const mappedSongs: SearchItem[] = (songs || []).map((song: Song) => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album || '',
            type: 'Song',
            duration: null,
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
            thumbnail: ''
          }))
          if (!cancelled) {
            setResults({
              'Top Results': mappedSongs.slice(0, 1),
              Songs: mappedSongs,
              Artists: mappedArtists,
              Albums: []
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
    }, 250)

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

  const handlePlayItem = (item: SearchItem) => {
    const localMatch = localMatchFor(item)
    if (localMatch) {
      const queue = item.localSong
        ? results.Songs.map((song) => song.localSong!).filter(Boolean)
        : librarySongs
      const index = queue.findIndex((song) => song.id === localMatch.id)
      setQueue(queue, Math.max(0, index))
      return
    }

    if (item.url) void window.api.openExternal(item.url)
  }

  const handleOpenItem = (item: SearchItem) => {
    if (item.type === 'Artist') {
      navigate(`/artist/${encodeURIComponent(item.title)}`)
      return
    }

    if (item.type === 'Song' && item.artist) {
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
          isOnline: false
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
        autoPlay: true
      })
      return
    }

    handlePlayItem(item)
  }

  const topResult = results['Top Results'][0] || results.Songs[0]
  const visibleSongs = activeTab === 'All' ? results.Songs.slice(0, 4) : results.Songs
  const hasResults = useMemo(
    () => Object.values(results).some((section) => section.length > 0),
    [results]
  )

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
        duration: null,
        url: '',
        thumbnail: toMediaUrl(song.artworkPath) || '',
        localSong: song
      }))

    const clearRecentSearches = () => {
      localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY)
      setRecentSearches([])
    }

    return (
      <div className="h-full flex flex-col pt-6 px-8 pb-10 overflow-y-auto select-none">
        <h3 className="text-xl font-bold text-text mb-6">Browse your Library</h3>

        {recentSearches.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-text">Recent searches</h2>
              <button type="button" onClick={clearRecentSearches} className="text-xs text-text-muted hover:text-text transition-colors">
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((query) => (
                <button
                  type="button"
                  key={query}
                  onClick={() => setSearchQuery(query)}
                  className="flex items-center gap-2 rounded-full bg-surface-elevated px-4 py-2 text-sm text-text hover:bg-hover hover:text-primary-amber transition-colors"
                >
                  <History className="w-4 h-4 text-text-muted" />
                  {query}
                </button>
              ))}
            </div>
          </section>
        )}

        {playedItems.length > 0 && (
          <section className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-2xl font-bold text-text">Recently played</h2>
              <button
                type="button"
                title="Clear recently played"
                onClick={() => {
                  localStorage.removeItem(RECENTLY_PLAYED_STORAGE_KEY)
                  setRecentlyPlayed([])
                }}
                className="ml-auto text-text-muted hover:text-text transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <RecentlyPlayedList songs={playedItems} onPlay={handlePlayItem} />
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto select-none px-8 pt-4 pb-12">
      <div className="flex items-center gap-2 mb-8">
        {(['All', 'Artists', 'Songs', 'Albums'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
              activeTab === tab
                ? 'bg-text text-canvas'
                : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="h-64 flex items-center justify-center text-text-muted">
          <div className="w-7 h-7 rounded-full border-2 border-border border-t-primary-amber animate-spin" />
        </div>
      )}

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

      {!isLoading && !error && hasResults && (
        <div className="space-y-10 animate-in fade-in duration-200">
          {activeTab === 'All' && topResult && (
            <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
              <section>
                <h2 className="text-2xl font-bold text-text mb-4">Top result</h2>
                <button
                  type="button"
                  onClick={() => handleOpenItem(topResult)}
                  className="w-full h-64 text-left bg-surface-elevated border border-border/10 rounded-lg p-6 hover:bg-hover transition-colors group flex flex-col"
                >
                  <Artwork
                    item={topResult}
                    artist={topResult.type === 'Artist'}
                    className="w-24 h-24 rounded-md shadow-md mb-4"
                  />
                  <div className="mt-auto min-w-0 w-full">
                    <h3 className="text-3xl font-bold text-text truncate group-hover:text-primary-amber transition-colors">
                      {topResult.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-3 text-sm text-text-muted min-w-0">
                      {localMatchFor(topResult) && (
                        <span className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-500">
                          In Library
                        </span>
                      )}
                      <span className="truncate">
                        {topResult.type}
                        {topResult.artist ? ` • ${topResult.artist}` : ''}
                      </span>
                    </div>
                  </div>
                </button>
              </section>

              {visibleSongs.length > 0 && (
                <section>
                  <h2 className="text-2xl font-bold text-text mb-4">Songs</h2>
                  <SongList
                    songs={visibleSongs}
                    onSelect={handleOpenItem}
                    isLocal={localMatchFor}
                  />
                </section>
              )}
            </div>
          )}

          {(activeTab === 'Songs' || (activeTab === 'All' && !topResult)) &&
            visibleSongs.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-text mb-4">Songs</h2>
                <SongList
                  songs={visibleSongs}
                  onSelect={handleOpenItem}
                  isLocal={localMatchFor}
                />
              </section>
            )}

          {(activeTab === 'All' || activeTab === 'Artists') && results.Artists.length > 0 && (
            <ResultGrid title="Artists" items={results.Artists} artist onSelect={handleOpenItem} />
          )}

          {(activeTab === 'All' || activeTab === 'Albums') && results.Albums.length > 0 && (
            <ResultGrid title="Albums" items={results.Albums} onSelect={handleOpenItem} />
          )}
        </div>
      )}

      {!isLoading && !error && !hasResults && (
        <div className="h-64 flex items-center justify-center text-sm text-text-muted">
          No matching results found for &quot;{searchQuery}&quot;.
        </div>
      )}
    </div>
  )
}

function RecentlyPlayedList({ songs, onPlay }: { songs: SearchItem[]; onPlay: (item: SearchItem) => void }): ReactNode {
  return (
    <div className="w-full overflow-hidden">
      <div className="grid grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 border-b border-border/20 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted md:px-4">
        <div className="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div>Album</div>
        <div className="text-right">Time</div>
      </div>
      <div className="mt-1">
        {songs.map((song, index) => (
          <button
            type="button"
            key={song.id}
            onClick={() => onPlay(song)}
            className="group grid w-full grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface-elevated md:px-4"
          >
            <span className="text-center text-text-muted tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 truncate font-semibold text-text">{song.title}</span>
            <span className="min-w-0 truncate text-text-muted">{song.artist}</span>
            <span className="min-w-0 truncate text-text-muted">{song.album || '-'}</span>
            <span className="text-right text-text-muted tabular-nums">
              {formatSongDuration(song.localSong?.duration || 0)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function formatSongDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function SongList({
  songs,
  onSelect,
  isLocal
}: {
  songs: SearchItem[]
  onSelect: (item: SearchItem) => void
  isLocal: (item: SearchItem) => Song | undefined
}) {
  return (
    <div className="flex flex-col">
      {songs.map((song) => (
        (() => {
          const localSong = isLocal(song)

          return (
            <div
              role="button"
              tabIndex={0}
              key={song.id}
              onClick={() => onSelect(song)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(song)
                }
              }}
              className="h-16 flex items-center gap-4 px-3 rounded-md hover:bg-surface-elevated group text-left transition-colors"
            >
              <Artwork item={song} className="w-12 h-12 rounded" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text truncate">{song.title}</span>
                  {song.explicit && <span className="text-[10px] text-text-muted">E</span>}
                  {localSong && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-500">
                      In Library
                    </span>
                  )}
                </div>
                <div className="text-sm text-text-muted truncate mt-0.5">{song.artist}</div>
              </div>
              {song.duration && (
                <span className="text-xs text-text-muted tabular-nums">{song.duration}</span>
              )}
            </div>
          )
        })()
      ))}
    </div>
  )
}

function ResultGrid({
  title,
  items,
  artist = false,
  onSelect
}: {
  title: string
  items: SearchItem[]
  artist?: boolean
  onSelect: (item: SearchItem) => void
}) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-text mb-5">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => onSelect(item)}
            className="min-w-0 text-left group p-2 rounded-md hover:bg-surface-elevated transition-colors"
          >
            <Artwork
              item={item}
              artist={artist}
              className={cn(
                'w-full aspect-square shadow-lg mb-3',
                artist ? 'rounded-full' : 'rounded-md'
              )}
            />
            <div className="font-bold text-text group-hover:text-primary-amber transition-colors truncate">
              {item.title}
            </div>
            <div className="text-sm text-text-muted mt-1 truncate">
              {artist ? 'Artist' : item.artist || 'Album'}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
