import { useEffect, useMemo, useState } from 'react'
import { Music2, Play, User as UserIcon } from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useAppStore } from '../../hooks/useAppStore'
import { Song } from '../Library/Library'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media'
import { useNavigate } from 'react-router-dom'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

type SearchTab = 'All' | 'Artists' | 'Songs' | 'Albums'

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
}) {
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

export default function Search({ onOpenDownloadPanel }: SearchProps) {
  const { searchQuery, searchMode, setSearchQuery } = useAppStore()
  const { setQueue } = usePlayerStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SearchTab>('All')
  const [results, setResults] = useState<SearchSections>(EMPTY_RESULTS)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api
      ?.getSongs?.()
      .then((songs) => setLibrarySongs(songs || []))
      .catch((err) => console.error('Failed to load library for search matching:', err))
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
        isOnline: true
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
    return (
      <div className="h-full flex flex-col pt-6 px-8 pb-10 overflow-y-auto select-none">
        <h3 className="text-xl font-bold text-text mb-6">Browse your Library</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['Lossless (FLAC)', 'Hi-Res 24-bit', 'Recent Additions', 'Favorites'].map((tag) => (
            <button
              key={tag}
              onClick={() => setSearchQuery(tag === 'Lossless (FLAC)' ? 'flac' : tag)}
              className="aspect-video bg-surface-elevated hover:bg-hover border border-border/10 rounded-lg flex items-center justify-center p-4 transition-colors group cursor-pointer"
            >
              <span className="font-bold text-text group-hover:text-primary-amber transition-colors text-center">
                {tag}
              </span>
            </button>
          ))}
        </div>
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
        <div className="h-64 flex items-center justify-center text-sm text-red-400">{error}</div>
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
                    onPlay={handlePlayItem}
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
                  onPlay={handlePlayItem}
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

function SongList({
  songs,
  onSelect,
  onPlay,
  isLocal
}: {
  songs: SearchItem[]
  onSelect: (item: SearchItem) => void
  onPlay: (item: SearchItem) => void
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
              {localSong && (
                <button
                  type="button"
                  title="Play"
                  onClick={(event) => {
                    event.stopPropagation()
                    onPlay(song)
                  }}
                  className="w-8 h-8 rounded-full bg-text text-canvas flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                </button>
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
