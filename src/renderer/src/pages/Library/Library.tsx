import { useEffect, useMemo, useState, useRef } from 'react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  Search,
  LayoutGrid,
  List,
  RefreshCw,
  ChevronDown,
  Clock,
  MoreVertical,
  Play,
  Pause,
  FolderOpen,
  RotateCcw,
  Trash2,
  Plus,
  ArrowUp,
  Check
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import { toMediaUrl } from '../../lib/media'

export interface Song {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  filePath: string
  trackNumber?: number
  genre?: string
  size?: number
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  channels?: number
  codec?: string
  container?: string
  artworkPath?: string
  dateAdded: number
}

interface LibraryProps {
  onOpenDownloadPanel?: () => void
}

type LibrarySortKey = 'title' | 'dateAdded' | 'artist' | 'album'
type LibraryViewMode = 'compact' | 'list'

export default function Library({ onOpenDownloadPanel }: LibraryProps) {
  const [songs, setSongs] = useState<Song[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false)
  const [sortKey, setSortKey] = useState<LibrarySortKey>('album')
  const [viewMode, setViewMode] = useState<LibraryViewMode>('list')
  const [activeMenu, setActiveMenu] = useState<{
    song: Song
    index: number
    x: number
    y: number
  } | null>(null)
  const { setQueue, togglePlay, currentSongIndex, queue, isPlaying } = usePlayerStore()
  const navigate = useNavigate()

  const parentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const viewMenuRef = useRef<HTMLDivElement>(null)

  const filteredSongs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const searchedSongs = !query
      ? songs
      : songs.filter((song) =>
      [song.title, song.artist, song.album, song.genre]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query))
    )
    return [...searchedSongs].sort((left, right) => {
      if (sortKey === 'dateAdded') return (right.dateAdded || 0) - (left.dateAdded || 0)
      const leftValue = String(left[sortKey] || '').toLowerCase()
      const rightValue = String(right[sortKey] || '').toLowerCase()
      return leftValue.localeCompare(rightValue)
    })
  }, [songs, searchQuery, sortKey])

  const loadSongs = async () => {
    try {
      if (window.api?.getSongs) {
        const data = await window.api.getSongs()
        setSongs(data || [])
      } else {
        console.warn('window.api is not available (running outside Electron)')
        setSongs([])
      }
    } catch (err) {
      console.error('Failed to load songs:', err)
    }
  }

  useEffect(() => {
    loadSongs()
    const handleLibraryUpdate = () => loadSongs()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    return () => window.removeEventListener('felo:library-updated', handleLibraryUpdate)
  }, [])

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus()
  }, [isSearchOpen])

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      setActiveMenu(null)
      if (!viewMenuRef.current?.contains(event.target as Node)) {
        setIsViewMenuOpen(false)
      }
    }
    const closeAllMenus = () => {
      setActiveMenu(null)
      setIsViewMenuOpen(false)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeAllMenus)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeAllMenus)
    }
  }, [])

  const handleAddFolder = async () => {
    try {
      if (!window.api) {
        alert('This feature requires running in the Electron desktop app.')
        return
      }
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        setIsScanning(true)
        const count = await window.api.scanLibrary(folderPath)
        setIsScanning(false)
        console.log(`Scanned ${count} songs.`)
        loadSongs()
      }
    } catch (err) {
      console.error('Failed to scan library:', err)
      setIsScanning(false)
    }
  }

  const handlePlaySong = (index: number) => {
    if (queue[currentSongIndex]?.id === filteredSongs[index]?.id) {
      togglePlay()
      return
    }

    setQueue(filteredSongs, index)
  }

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLButtonElement>,
    song: Song,
    index: number
  ) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 250
    const menuHeight = 242
    setActiveMenu({
      song,
      index,
      x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
    })
  }

  const handleShowInExplorer = async (song: Song) => {
    try {
      await window.api?.revealInExplorer(song.filePath)
    } catch (err) {
      console.error('Failed to reveal song:', err)
    }
  }

  const handleRemoveSong = async (song: Song) => {
    try {
      await window.api?.removeSong(song.id)
      setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id))
    } catch (err) {
      console.error('Failed to remove song:', err)
    }
  }

  const handleArtistClick = (e: React.MouseEvent, artistName: string) => {
    e.stopPropagation() // Prevent row double-click
    navigate(`/artist/${encodeURIComponent(artistName)}`)
  }

  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 MB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const formatAudioQuality = (sampleRate?: number, bitrate?: number) => {
    // Just mock calculation or use directly if parsed accurately
    // usually sampleRate is 44100, bitrate is 320000 etc.
    const khz = sampleRate ? (sampleRate / 1000).toFixed(1) : '44.1'
    const bit = bitrate && bitrate > 320000 ? '24 bit' : '16 bit'
    return `${khz}kHz / ${bit}`
  }

  const sortLabels: Record<LibrarySortKey, string> = {
    title: 'Title',
    dateAdded: 'Recently added',
    artist: 'Artist',
    album: 'Album'
  }

  const rowHeight = viewMode === 'compact' ? 46 : 56

  const virtualizer = useVirtualizer({
    count: filteredSongs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 5
  })

  return (
    <div className="h-full flex flex-col pt-8 px-6 pb-6 select-none">
      {/* Header Sticky */}
      <div className="flex items-end justify-between mb-8 shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-4xl font-bold text-text tracking-tight">My Library</h1>
          <span className="text-[13px] font-medium text-text-muted">
            {filteredSongs.length} songs
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div
            className={`flex h-[52px] origin-right items-center overflow-hidden rounded-full bg-[#2a2a2a] transition-all duration-300 ${isSearchOpen ? 'w-[315px] px-4' : 'w-[52px]'}`}
          >
            <button
              type="button"
              title="Search library"
              onClick={() => setIsSearchOpen(true)}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center text-[#b3b3b3] hover:text-white"
            >
              <Search className="h-5 w-5" />
            </button>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onBlur={() => !searchQuery && setIsSearchOpen(false)}
              placeholder="Search library..."
              aria-label="Search library"
              className={`h-full min-w-0 flex-1 bg-transparent pr-3 text-[16px] text-white outline-none placeholder:text-[#bdbdbd] ${isSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            />
          </div>
          <div ref={viewMenuRef} className="relative">
          <div className="flex h-[52px] items-center overflow-hidden rounded-full bg-[#2a2a2a] p-1 text-[#b3b3b3]">
            <button
              type="button"
              title="Grid view"
              className="flex h-11 w-12 items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white"
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Sort and view options"
              onClick={(event) => {
                event.stopPropagation()
                setIsViewMenuOpen((isOpen) => !isOpen)
              }}
              className="flex h-11 w-12 items-center justify-center rounded-full bg-white/10 text-white shadow-sm"
            >
              <List className="h-5 w-5" />
            </button>
          </div>
          {isViewMenuOpen && (
            <div
              className="absolute right-0 top-full z-[1000] mt-2 w-[170px] rounded-sm bg-[#282828] py-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="px-3 pb-2 text-xs font-black text-[#b3b3b3]">Sort by</div>
              {(['title', 'dateAdded', 'artist', 'album'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left font-bold transition-colors hover:bg-white/10 ${
                    sortKey === key ? 'text-[#1ed760]' : 'text-white'
                  }`}
                >
                  <span>{sortLabels[key]}</span>
                  {sortKey === key && <ArrowUp className="h-4 w-4" />}
                </button>
              ))}

              <div className="mt-3 px-3 pb-2 text-xs font-black text-[#b3b3b3]">View as</div>
              {(['compact', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left font-bold transition-colors hover:bg-white/10 ${
                    viewMode === mode ? 'text-[#1ed760]' : 'text-white'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <List className="h-4 w-4" />
                    {mode === 'compact' ? 'Compact' : 'List'}
                  </span>
                  {viewMode === mode && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          )}
          </div>
          <button
            type="button"
            title="Refresh library"
            onClick={loadSongs}
            className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#2a2a2a] text-[#b3b3b3] transition-colors hover:bg-[#333] hover:text-white"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleAddFolder}
            disabled={isScanning}
            className="flex h-[52px] items-center gap-3 rounded-full bg-[#2a2a2a] px-7 text-[18px] font-black text-white transition-all hover:scale-[1.02] hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            <Plus className="h-5 w-5 stroke-[3]" />
            {isScanning ? 'Scanning...' : 'Add Folder'}
          </button>
        </div>
      </div>

      {songs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
          <p className="text-lg">Your library is empty.</p>
          <button
            onClick={handleAddFolder}
            disabled={isScanning}
            className="flex h-[52px] items-center gap-3 rounded-full bg-[#2a2a2a] px-7 text-[18px] font-black text-white transition-all hover:scale-[1.02] hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            <Plus className="h-5 w-5 stroke-[3]" />
            {isScanning ? 'Scanning...' : 'Add Local Folder'}
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Table Header */}
          <div className="grid grid-cols-[36px_minmax(0,1fr)_140px] gap-2 border-b border-border/20 bg-surface px-2 py-2 text-[12px] font-medium uppercase tracking-wider text-text-muted sticky top-0 z-10 shrink-0 md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4">
            <div className="text-center">#</div>
            <div>Title</div>
            <div className="hidden min-w-0 md:block">Album</div>
            <div className="hidden min-w-0 items-center gap-1 cursor-pointer hover:text-text xl:flex">
              Date added <ChevronDown className="w-3 h-3" />
            </div>
            <div className="flex justify-end pr-8">
              <Clock className="w-4 h-4" />
            </div>
          </div>

          {/* Table Body */}
          <div ref={parentRef} className="flex-1 overflow-y-auto mt-2 pb-10">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index
                const song = filteredSongs[index]
                const isActive = queue[currentSongIndex]?.id === song.id
                const showPauseIcon = isActive && isPlaying
                const artworkUrl = toMediaUrl(song.artworkPath)

                return (
                  <div
                    key={song.id}
                    onClick={() => handlePlaySong(index)}
                    className={`absolute top-0 left-0 grid w-full grid-cols-[36px_minmax(0,1fr)_140px] items-center gap-2 rounded-md px-2 text-[13px] group cursor-pointer md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4 ${isActive ? 'bg-hover' : 'hover:bg-hover/50'}`}
                    style={{
                      height: `${viewMode === 'compact' ? rowHeight : virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    <div className="relative flex h-5 items-center justify-center text-center font-medium">
                      <span
                        className={`transition-opacity ${
                          isActive
                            ? 'opacity-0'
                            : 'text-text-muted group-hover:opacity-0 group-hover:text-text'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span
                        className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                          isActive
                            ? 'opacity-100 text-primary-amber'
                            : 'opacity-0 text-text group-hover:opacity-100'
                        }`}
                      >
                        {showPauseIcon ? (
                          <Pause className="h-4 w-4 fill-current" />
                        ) : (
                          <Play className="h-4 w-4 fill-current" />
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className={`relative rounded-[4px] bg-surface-elevated shrink-0 shadow-sm flex items-center justify-center overflow-hidden ${viewMode === 'compact' ? 'h-8 w-8' : 'h-10 w-10'}`}>
                        <span className="text-[8px] text-text-muted">Art</span>
                        {artworkUrl && (
                          <img
                            src={artworkUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.hidden = true
                            }}
                          />
                        )}
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <span
                          className={`font-medium truncate ${isActive ? 'text-primary-amber' : 'text-text'}`}
                        >
                          {song.title}
                        </span>
                        <span
                          onClick={(e) => handleArtistClick(e, song.artist)}
                          className="text-[12px] text-text-muted truncate hover:underline hover:text-text cursor-pointer w-fit"
                        >
                          {song.artist}
                        </span>
                      </div>
                    </div>

                    <div className="hidden min-w-0 truncate text-text-muted hover:underline hover:text-text md:block">
                      {song.album}
                    </div>

                    <div className="hidden min-w-0 truncate text-text-muted xl:block">
                      13 hours ago
                    </div>

                    <div className="flex min-w-0 items-center justify-end gap-2 pr-1 text-text-muted xl:gap-3 xl:pr-2">
                      <span className="shrink-0 tabular-nums">{formatDuration(song.duration)}</span>
                      <span className="hidden shrink-0 text-[11px] font-mono 2xl:inline">
                        {formatSize(song.size)}
                      </span>
                      <span className="hidden min-w-0 truncate rounded-full border border-primary-amber/30 bg-primary-amber/5 px-2 py-0.5 text-[9px] font-bold tracking-wide text-primary-amber xl:inline-block">
                        {formatAudioQuality(song.sampleRate, song.bitrate)}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => handleMenuOpen(event, song, index)}
                        title="More options"
                        className={`h-8 w-8 shrink-0 rounded-[3px] border flex items-center justify-center transition-all ${
                          activeMenu?.song.id === song.id
                            ? 'opacity-100 border-primary-amber text-text bg-hover'
                            : 'opacity-0 border-transparent text-text-muted group-hover:opacity-100 hover:border-primary-amber hover:text-text hover:bg-hover'
                        }`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {activeMenu && (
        <div
          className="fixed z-[9999] w-[250px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)]"
          style={{ left: activeMenu.x, top: activeMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              handlePlaySong(activeMenu.index)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <Play className="h-4 w-4 fill-current" />
            Play
          </button>
          <button
            type="button"
            onClick={() => {
              handleShowInExplorer(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <FolderOpen className="h-4 w-4" />
            Show in Explorer
          </button>
          <button
            type="button"
            onClick={() => {
              handlePlaySong(activeMenu.index)
              onOpenDownloadPanel?.()
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <RotateCcw className="h-4 w-4" />
            Replace Audio / Re-download
          </button>
          <div className="mx-2 my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              handleRemoveSong(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 className="h-4 w-4 fill-current" />
            Remove from Library
          </button>
        </div>
      )}
    </div>
  )
}
