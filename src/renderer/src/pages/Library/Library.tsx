import { useEffect, useMemo, useState, useRef } from 'react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  Search,
  List,
  RefreshCw,
  Clock,
  MoreVertical,
  Play,
  Pause,
  FolderOpen,
  RotateCcw,
  Trash2,
  Plus,
  ArrowUp,
  Check,
  Loader2,
  Share2,
  ListPlus,
  Disc3,
  User,
  ChevronRight,
  FileText,
  X
} from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import { toMediaUrl } from '../../lib/media'
import { useLibraryScanStore } from '../../hooks/useLibraryScanStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import ArtistLinks from '../../components/Common/ArtistLinks'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { parseArtists } from '../../lib/artistParser'
import { cn } from '../../lib/utils'

export interface SongArtist {
  id?: string
  name: string
  role?: 'primary' | 'featured'
}

export interface Song {
  id: string
  title: string
  artist: string
  artists?: SongArtist[]
  album: string
  duration: number
  filePath?: string
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
  artworkUrl?: string
  isOnline?: boolean
  dateAdded?: number
}

interface LibraryProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

type LibrarySortKey = 'title' | 'dateAdded' | 'artist' | 'album' | 'duration' | 'default'
type SortDirection = 'asc' | 'desc'
type LibraryViewMode = 'compact' | 'list'

function AnimatedPlayingWave() {
  return (
    <div className="flex items-end justify-center gap-[2.5px] h-3.5 w-3.5">
      <span
        className="w-[2.5px] bg-primary-amber rounded-full animate-pulse"
        style={{ height: '70%' }}
      />
      <span
        className="w-[2.5px] bg-primary-amber rounded-full animate-pulse"
        style={{ height: '100%', animationDelay: '0.15s' }}
      />
      <span
        className="w-[2.5px] bg-primary-amber rounded-full animate-pulse"
        style={{ height: '80%', animationDelay: '0.3s' }}
      />
    </div>
  )
}

function QualityPill({ song }: { song: Song }) {
  const rawFormat = String(song.codec || song.container || '').toLowerCase()
  const isLossless =
    rawFormat.includes('flac') ||
    rawFormat.includes('alac') ||
    rawFormat.includes('wav') ||
    rawFormat.includes('aiff')
  const isHiRes =
    (song.bitDepth && song.bitDepth >= 24) || (song.sampleRate && song.sampleRate >= 88200)

  if (isHiRes) {
    const rateKhz = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(0)}k` : ''
    return (
      <span
        title={`Hi-Res Audio: ${song.bitDepth || 24}-bit / ${song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : ''}`}
        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-primary-amber/15 text-primary-amber border border-primary-amber/30"
      >
        Hi-Res{rateKhz ? ` ${rateKhz}` : ''}
      </span>
    )
  }

  if (isLossless) {
    return (
      <span
        title="Lossless CD Quality Audio"
        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60"
      >
        Lossless
      </span>
    )
  }

  const format = rawFormat.includes('mp3') || /mpeg.*layer\s*3/.test(rawFormat)
    ? 'MP3'
    : rawFormat.includes('m4a') || rawFormat.includes('aac')
      ? 'AAC'
      : rawFormat.includes('opus')
        ? 'OPUS'
        : rawFormat.includes('ogg')
          ? 'OGG'
          : rawFormat.toUpperCase()

  if (!format || format === 'UNKNOWN') return null

  const kbps = song.bitrate ? `${Math.round(song.bitrate / 1000)}k` : ''

  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono text-text-muted/70 bg-surface-elevated/60 border border-border/30">
      {format}{kbps ? ` ${kbps}` : ''}
    </span>
  )
}

export default function Library({ onOpenDownloadPanel }: LibraryProps) {
  const [songs, setSongs] = useState<Song[]>([])
  const [isLoadingSongs, setIsLoadingSongs] = useState(true)
  const [hasLoadedSongs, setHasLoadedSongs] = useState(false)
  const { isScanning, progress: scanProgress, cancelScan } = useLibraryScanStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false)
  const [sortKey, setSortKey] = useState<LibrarySortKey>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [viewMode, setViewMode] = useState<LibraryViewMode>('list')
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [activeMenu, setActiveMenu] = useState<{
    song: Song
    index: number
    x: number
    y: number
  } | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const { setQueue, togglePlay, currentSongIndex, queue, isPlaying, enqueueSong } = usePlayerStore()
  const navigate = useNavigate()

  const parentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const viewMenuRef = useRef<HTMLDivElement>(null)
  const loadGenerationRef = useRef(0)

  const handleSort = (key: LibrarySortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(key === 'dateAdded' || key === 'duration' ? 'desc' : 'asc')
    }
  }

  const filteredSongs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const searchedSongs = !query
      ? songs
      : songs.filter((song) =>
          [song.title, song.artist, song.album, song.genre]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query))
        )

    if (sortKey === 'default') {
      return sortDirection === 'asc' ? searchedSongs : [...searchedSongs].reverse()
    }

    return [...searchedSongs].sort((left, right) => {
      let comparison = 0
      if (sortKey === 'dateAdded') {
        comparison = (left.dateAdded || 0) - (right.dateAdded || 0)
      } else if (sortKey === 'duration') {
        comparison = (left.duration || 0) - (right.duration || 0)
      } else {
        const leftValue = String(left[sortKey] || '').toLowerCase()
        const rightValue = String(right[sortKey] || '').toLowerCase()
        comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [songs, searchQuery, sortKey, sortDirection])

  const loadSongs = async () => {
    const generation = ++loadGenerationRef.current
    setIsLoadingSongs(true)
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
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoadingSongs(false)
        setHasLoadedSongs(true)
      }
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true'

      if (isInput) return

      // Select all visible songs: Ctrl+A or Cmd+A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (filteredSongs.length > 0) {
          setSelectedSongIds(new Set(filteredSongs.map((s) => s.id)))
        }
        return
      }

      // Deselect all: Escape
      if (e.key === 'Escape' && selectedSongIds.size > 0) {
        e.preventDefault()
        setSelectedSongIds(new Set())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredSongs, selectedSongIds.size])

  const handleAddFolder = async () => {
    try {
      if (!window.api?.selectFolder) {
        alert('This feature requires running in the Electron desktop app.')
        return
      }
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        await window.api.scanLibrary(folderPath)
        loadSongs()
      }
    } catch (err) {
      console.error('Failed to scan library:', err)
    }
  }

  const handleRowClick = (event: React.MouseEvent, index: number, song: Song) => {
    if (event.ctrlKey || event.metaKey) {
      // Toggle selection of this song
      setSelectedSongIds((prev) => {
        const next = new Set(prev)
        if (next.has(song.id)) {
          next.delete(song.id)
        } else {
          next.add(song.id)
        }
        return next
      })
      setLastSelectedIndex(index)
      return
    }

    if (event.shiftKey && lastSelectedIndex !== null) {
      // Range selection
      const start = Math.min(lastSelectedIndex, index)
      const end = Math.max(lastSelectedIndex, index)
      const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
      setSelectedSongIds(new Set(range))
      return
    }

    if (selectedSongIds.size > 0) {
      // Clear multi-selection on normal click
      setSelectedSongIds(new Set())
    }

    handlePlaySong(index)
  }

  const handlePlaySong = (index: number) => {
    if (queue[currentSongIndex]?.id === filteredSongs[index]?.id) {
      togglePlay()
      return
    }

    setQueue(filteredSongs, index, {
      type: 'library',
      title: 'Your Library',
      route: '/library'
    })
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

  const handleShareSong = (song: Song) => {
    sessionStorage.setItem(
      'felo:pending-chat-song',
      JSON.stringify({
        localId: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        artworkUrl: toMediaUrl(song.artworkPath)
      })
    )
    navigate('/chat')
    setActiveMenu(null)
  }

  const handleShowInExplorer = async (song: Song) => {
    const filePath = song.filePath
    if (!filePath) return
    try {
      await window.api?.revealInExplorer(filePath)
    } catch (err) {
      console.error('Failed to reveal song:', err)
    }
  }

  const handleRemoveSong = async (song: Song) => {
    try {
      await window.api?.removeSong(song.id)
      setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id))
      setSelectedSongIds((prev) => {
        const next = new Set(prev)
        next.delete(song.id)
        return next
      })
    } catch (err) {
      console.error('Failed to remove song:', err)
    }
  }

  const handleAlbumClick = (e: React.MouseEvent, artistName?: string, albumName?: string) => {
    e.stopPropagation()
    if (!albumName) return
    navigate(
      `/album/${encodeURIComponent(artistName || 'Unknown Artist')}/${encodeURIComponent(albumName)}`
    )
  }

  const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const totalSeconds = Math.floor(seconds)
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 MB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const formatRelativeDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown'
    const ms = timestamp > 1e11 ? timestamp : timestamp * 1000
    const elapsed = Math.max(0, Date.now() - ms)
    const minutes = Math.floor(elapsed / 60_000)
    if (minutes < 1) return 'Just now'
    const hours = Math.floor(elapsed / 3_600_000)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(ms).toLocaleDateString()
  }

  const sortLabels: Record<LibrarySortKey, string> = {
    default: 'Original order',
    title: 'Title',
    dateAdded: 'Recently added',
    artist: 'Artist',
    album: 'Album',
    duration: 'Duration'
  }

  const rowHeight = viewMode === 'compact' ? 46 : 56

  const virtualizer = useVirtualizer({
    count: filteredSongs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 6
  })

  useEffect(() => {
    virtualizer.measure()
  }, [viewMode, virtualizer])

  return (
    <div className="h-full flex flex-col pt-8 px-6 pb-6 select-none relative">
      {/* Header Sticky */}
      <div className="flex items-end justify-between mb-6 shrink-0">
        <div className="flex items-baseline gap-4">
          <h1 className="text-4xl font-extrabold text-text tracking-tight">My Library</h1>
          <span className="text-[13px] font-medium text-text-muted tabular-nums">
            {filteredSongs.length} {filteredSongs.length === 1 ? 'song' : 'songs'}
            {searchQuery && songs.length !== filteredSongs.length && (
              <span className="opacity-75"> (of {songs.length})</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* In-Library Search Filter */}
          <div
            className={cn(
              'flex h-11 origin-right items-center overflow-hidden rounded-full border border-border/60 bg-surface-elevated transition-all duration-300',
              isSearchOpen ? 'w-64 px-3' : 'w-11'
            )}
          >
            <button
              type="button"
              title="Search library"
              onClick={() => setIsSearchOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-text-muted hover:text-white"
            >
              <Search className="h-4 w-4" />
            </button>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('')
                  } else {
                    setIsSearchOpen(false)
                  }
                }
              }}
              onBlur={() => !searchQuery && setIsSearchOpen(false)}
              placeholder="Filter library..."
              aria-label="Filter library"
              className={cn(
                'h-full min-w-0 flex-1 bg-transparent pr-1 text-sm text-white outline-none placeholder:text-text-muted',
                isSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            />
            {searchQuery && isSearchOpen && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  searchInputRef.current?.focus()
                }}
                className="p-1 text-text-muted hover:text-white transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort & View Dropdown Menu */}
          <div ref={viewMenuRef} className="relative">
            <button
              type="button"
              title="Sort and view options"
              aria-expanded={isViewMenuOpen}
              onClick={(event) => {
                event.stopPropagation()
                setIsViewMenuOpen((isOpen) => !isOpen)
              }}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition-colors border',
                isViewMenuOpen
                  ? 'border-white/30 bg-white/20 text-white'
                  : 'border-border/60 bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            {isViewMenuOpen && (
              <div
                className="absolute right-0 top-full z-[1000] mt-2 w-48 rounded-xl border border-border/80 bg-surface-elevated py-2.5 text-xs shadow-2xl backdrop-blur-md"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-3 pb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  Sort by
                </div>
                {(['dateAdded', 'title', 'artist', 'album', 'duration', 'default'] as const).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSort(key)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left font-medium transition-colors hover:bg-white/10',
                        sortKey === key ? 'text-primary-amber font-bold' : 'text-text-muted'
                      )}
                    >
                      <span>{sortLabels[key]}</span>
                      {sortKey === key && (
                        <ArrowUp
                          className={cn(
                            'h-3.5 w-3.5 transition-transform',
                            sortDirection === 'desc' && 'rotate-180'
                          )}
                        />
                      )}
                    </button>
                  )
                )}

                <div className="my-1.5 border-t border-border/40" />

                <div className="px-3 pb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  View mode
                </div>
                {(['compact', 'list'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-1.5 text-left font-medium transition-colors hover:bg-white/10',
                      viewMode === mode ? 'text-white font-bold' : 'text-text-muted'
                    )}
                  >
                    <span className="capitalize">{mode}</span>
                    {viewMode === mode && <Check className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            title="Refresh library"
            onClick={loadSongs}
            disabled={isLoadingSongs}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-surface-elevated text-text-muted transition-colors hover:bg-hover hover:text-white"
          >
            <RefreshCw className={cn('h-4 w-4', isLoadingSongs && 'animate-spin')} />
          </button>

          <button
            type="button"
            onClick={handleAddFolder}
            disabled={isScanning}
            className="flex h-11 items-center gap-2.5 rounded-full bg-white px-5 text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isScanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary-amber" />
                <span className="tabular-nums">
                  {scanProgress?.percent !== undefined
                    ? `Scanning ${scanProgress.percent}%`
                    : 'Scanning...'}
                </span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 stroke-[3]" />
                Add Folder
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scanning Banner */}
      {isScanning && scanProgress && (
        <div className="mb-5 rounded-2xl bg-[#1b1b1b] border border-border/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-amber/15 text-primary-amber border border-primary-amber/25">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    {scanProgress.status === 'discovering'
                      ? 'Discovering Audio Files...'
                      : scanProgress.status === 'committing'
                        ? 'Saving To Database...'
                        : 'Indexing Music Folder'}
                  </h3>
                  <span className="rounded-full bg-primary-amber/15 px-2 py-0.5 text-xs font-mono font-bold text-primary-amber border border-primary-amber/25 tabular-nums">
                    {scanProgress.percent}%
                  </span>
                </div>
                <p
                  className="text-xs text-text-muted truncate mt-0.5"
                  title={scanProgress.folderPath}
                >
                  {scanProgress.folderName} •{' '}
                  <span className="text-white font-medium tabular-nums">
                    {scanProgress.processedFiles} of {scanProgress.totalFiles} songs
                  </span>
                  {scanProgress.speed ? ` • ~${scanProgress.speed} songs/sec` : ''}
                  {scanProgress.estimatedRemainingMs
                    ? ` • ~${Math.round(scanProgress.estimatedRemainingMs / 1000)}s left`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <button
                type="button"
                onClick={() => cancelScan()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors"
              >
                <X className="h-3.5 w-3.5" /> Stop Scan
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#272727]">
              <div
                className="h-full bg-primary-amber transition-all duration-200"
                style={{ width: `${Math.max(2, scanProgress.percent)}%` }}
              />
            </div>
            {(scanProgress.currentTrack || scanProgress.currentFile) && (
              <p className="text-[11px] text-text-muted truncate">
                <span className="text-white/60">Reading:</span>{' '}
                <span className="text-white font-medium">
                  {scanProgress.currentTrack
                    ? `${scanProgress.currentTrack.artist} - ${scanProgress.currentTrack.title}`
                    : scanProgress.currentFile}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Loading or Empty state */}
      {isLoadingSongs && !hasLoadedSongs ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-7 w-7 animate-spin text-primary-amber" />
          <div className="text-center">
            <p className="text-base font-semibold text-text">Loading your music library...</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Restoring saved tracks and artwork metadata
            </p>
          </div>
        </div>
      ) : songs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4">
          <p className="text-base text-text">Your library is currently empty.</p>
          <p className="text-xs text-text-muted max-w-sm text-center">
            Add a local music folder to scan and index all your high-resolution and lossless audio
            tracks.
          </p>
          <button
            onClick={handleAddFolder}
            disabled={isScanning}
            className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-md"
          >
            <Plus className="h-4 w-4 stroke-[3]" /> Add Local Music Folder
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Interactive Clickable Table Header */}
          <div className="grid grid-cols-[36px_minmax(0,1fr)_140px] gap-2 border-b border-border/30 bg-surface px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted sticky top-0 z-10 shrink-0 md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4">
            <button
              type="button"
              onClick={() => handleSort('default')}
              title="Sort by original order"
              className={cn(
                'text-center hover:text-text transition-colors flex items-center justify-center gap-1',
                sortKey === 'default' && 'text-primary-amber'
              )}
            >
              <span>#</span>
              {sortKey === 'default' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSort('title')}
              title="Sort by Title"
              className={cn(
                'flex items-center gap-1.5 hover:text-text transition-colors text-left',
                sortKey === 'title' && 'text-primary-amber font-bold'
              )}
            >
              <span>Title</span>
              {sortKey === 'title' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSort('album')}
              title="Sort by Album"
              className={cn(
                'hidden min-w-0 md:flex items-center gap-1.5 hover:text-text transition-colors text-left',
                sortKey === 'album' && 'text-primary-amber font-bold'
              )}
            >
              <span>Album</span>
              {sortKey === 'album' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSort('dateAdded')}
              title="Sort by Date added"
              className={cn(
                'hidden min-w-0 items-center gap-1.5 hover:text-text transition-colors text-left xl:flex',
                sortKey === 'dateAdded' && 'text-primary-amber font-bold'
              )}
            >
              <span>Date added</span>
              {sortKey === 'dateAdded' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSort('duration')}
              title="Sort by Duration"
              className={cn(
                'flex items-center justify-end gap-1.5 pr-8 hover:text-text transition-colors ml-auto',
                sortKey === 'duration' && 'text-primary-amber font-bold'
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              {sortKey === 'duration' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>
          </div>

          {/* Virtual Table Body */}
          <div ref={parentRef} key={viewMode} className="flex-1 overflow-y-auto mt-1 pb-16">
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
                const isSelected = selectedSongIds.has(song.id)
                const artworkUrl = toMediaUrl(song.artworkPath)

                return (
                  <div
                    key={song.id}
                    onClick={(e) => handleRowClick(e, index, song)}
                    className={cn(
                      'absolute top-0 left-0 grid w-full grid-cols-[36px_minmax(0,1fr)_140px] items-center gap-2 rounded-lg px-2 text-[13px] group cursor-pointer transition-colors md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4',
                      isSelected
                        ? 'bg-primary-amber/15 border border-primary-amber/30 text-white'
                        : isActive
                          ? 'bg-hover'
                          : 'hover:bg-hover/50'
                    )}
                    style={{
                      height: `${viewMode === 'compact' ? rowHeight : virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    {/* Index / Animated Soundwave / Play-Pause Icon */}
                    <div className="relative flex h-5 items-center justify-center text-center font-medium">
                      {isActive && isPlaying ? (
                        <>
                          <span className="group-hover:hidden">
                            <AnimatedPlayingWave />
                          </span>
                          <span className="hidden group-hover:flex items-center justify-center text-primary-amber">
                            <Pause className="h-4 w-4 fill-current" />
                          </span>
                        </>
                      ) : isActive && !isPlaying ? (
                        <>
                          <span className="text-primary-amber group-hover:hidden text-xs">❚❚</span>
                          <span className="hidden group-hover:flex items-center justify-center text-primary-amber">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-text-muted group-hover:hidden text-xs tabular-nums">
                            {index + 1}
                          </span>
                          <span className="hidden group-hover:flex items-center justify-center text-text">
                            <Play className="h-4 w-4 fill-current ml-0.5" />
                          </span>
                        </>
                      )}
                    </div>

                    {/* Title + Artwork + Artist */}
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div
                        className={cn(
                          'relative rounded-md bg-surface-elevated shrink-0 shadow-sm flex items-center justify-center overflow-hidden border border-border/30',
                          viewMode === 'compact' ? 'h-8 w-8' : 'h-10 w-10'
                        )}
                      >
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
                          className={cn(
                            'font-semibold truncate text-sm',
                            isActive ? 'text-primary-amber' : 'text-text'
                          )}
                        >
                          {song.title}
                        </span>
                        <div className="text-[12px] truncate max-w-full text-text-muted">
                          <ArtistLinks
                            artist={song.artist}
                            artists={song.artists}
                            linkClassName="text-text-muted hover:text-text hover:underline text-[12px]"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Album Column */}
                    <div
                      onClick={(e) => handleAlbumClick(e, song.artist, song.album)}
                      title={song.album ? `Go to album: ${song.album}` : undefined}
                      className="hidden min-w-0 truncate text-xs text-text-muted hover:underline hover:text-text md:block cursor-pointer"
                    >
                      {song.album || '-'}
                    </div>

                    {/* Date Added Column */}
                    <div
                      className="hidden min-w-0 truncate text-xs text-text-muted xl:block"
                      title={
                        song.dateAdded
                          ? new Date(
                              song.dateAdded > 1e11 ? song.dateAdded : song.dateAdded * 1000
                            ).toLocaleString()
                          : undefined
                      }
                    >
                      {formatRelativeDate(song.dateAdded)}
                    </div>

                    {/* Quality Badges + Duration + Menu Actions */}
                    <div className="flex min-w-0 items-center justify-end gap-2 pr-1 text-text-muted xl:gap-3 xl:pr-2">
                      <div className="hidden xl:flex items-center">
                        <QualityPill song={song} />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-text-muted">
                        {formatDuration(song.duration)}
                      </span>
                      <span className="hidden shrink-0 text-[11px] font-mono text-text-muted/60 2xl:inline">
                        {formatSize(song.size)}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => handleMenuOpen(event, song, index)}
                        title="More options"
                        className={cn(
                          'h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-all',
                          activeMenu?.song.id === song.id
                            ? 'opacity-100 text-text bg-hover'
                            : 'opacity-0 text-text-muted group-hover:opacity-100 hover:text-text hover:bg-hover'
                        )}
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

      {/* Floating Multi-Select Batch Actions Toolbar */}
      {selectedSongIds.size > 1 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-surface-elevated/95 border border-border/80 px-5 py-2.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          <span className="text-xs font-bold text-text tabular-nums">
            {selectedSongIds.size} songs selected
          </span>
          <div className="h-4 w-[1px] bg-border/60" />
          <button
            type="button"
            onClick={() => {
              const selectedSongs = filteredSongs.filter((s) => selectedSongIds.has(s.id))
              if (selectedSongs.length > 0) {
                setQueue(selectedSongs, 0, {
                  type: 'library',
                  title: `Selected (${selectedSongs.length} tracks)`,
                  route: '/library'
                })
              }
            }}
            className="flex items-center gap-1.5 text-xs font-bold text-primary-amber hover:text-white transition-colors"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> Play Selected
          </button>
          <button
            type="button"
            onClick={() => {
              const selectedSongs = filteredSongs.filter((s) => selectedSongIds.has(s.id))
              selectedSongs.forEach((song) => enqueueSong(song))
              setSelectedSongIds(new Set())
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text transition-colors"
          >
            <ListPlus className="w-3.5 h-3.5" /> Add to Queue
          </button>
          <button
            type="button"
            onClick={() => setSelectedSongIds(new Set())}
            title="Clear selection"
            className="p-1 rounded-full text-text-muted hover:text-text hover:bg-hover transition-colors ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Context Menu */}
      {activeMenu && (
        <div
          className="fixed z-[9999] w-[250px] rounded-xl border border-white/15 bg-[#1a1a1a] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)] backdrop-blur-md"
          style={{ left: activeMenu.x, top: activeMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              handlePlaySong(activeMenu.index)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Play
          </button>
          <button
            type="button"
            onClick={() => {
              enqueueSong(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <ListPlus className="h-3.5 w-3.5" />
            Add to Queue
          </button>
          {activeMenu.song.album && (
            <button
              type="button"
              onClick={() => {
                navigate(
                  `/album/${encodeURIComponent(activeMenu.song.artist || 'Unknown Artist')}/${encodeURIComponent(activeMenu.song.album || '')}`
                )
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <Disc3 className="h-3.5 w-3.5" />
              Go to Album
            </button>
          )}
          {(() => {
            const menuArtists = activeMenu.song.artists?.length
              ? activeMenu.song.artists
              : parseArtists(activeMenu.song.artist)

            if (menuArtists.length <= 1) {
              const artistName = menuArtists[0]?.name || activeMenu.song.artist || 'Unknown Artist'
              return (
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/artist/${encodeURIComponent(artistName)}`)
                    setActiveMenu(null)
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                >
                  <User className="h-3.5 w-3.5" />
                  Go to Artist
                </button>
              )
            }

            return (
              <div className="relative group/artist-sub">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                >
                  <div className="flex items-center gap-3">
                    <User className="h-3.5 w-3.5" />
                    <span>Go to Artist</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-text-muted/60 transition-transform group-hover/artist-sub:translate-x-0.5" />
                </button>
                <div className="absolute left-full top-0 ml-1 hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-border/80 bg-surface-elevated/95 p-1.5 shadow-2xl backdrop-blur-md z-50">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border/40 mb-1">
                    Track Artists
                  </div>
                  {menuArtists.map((a, i) => (
                    <button
                      key={`${a.name}-${i}`}
                      type="button"
                      onClick={() => {
                        navigate(`/artist/${encodeURIComponent(a.name)}`)
                        setActiveMenu(null)
                      }}
                      className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                    >
                      <span className="truncate pr-2">{a.name}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-white/5 text-text-muted/70">
                        {i === 0 && a.role !== 'featured' ? 'Lead' : 'Feat'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
          <button
            type="button"
            onClick={() => {
              setCreditsSong(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <FileText className="h-3.5 w-3.5" />
            Show Credits
          </button>
          <button
            type="button"
            onClick={() => handleShareSong(activeMenu.song)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share to Friend Chat
          </button>
          <button
            type="button"
            onClick={() => {
              handleShowInExplorer(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Show in Explorer
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenDownloadPanel?.({
                id: activeMenu.song.id,
                title: activeMenu.song.title,
                artist: activeMenu.song.artist,
                album: activeMenu.song.album || '',
                duration: activeMenu.song.duration || 0,
                filePath: activeMenu.song.filePath,
                artworkPath: activeMenu.song.artworkPath,
                size: activeMenu.song.size,
                sampleRate: activeMenu.song.sampleRate,
                isOnline: false,
                autoDownload: false,
                autoPlay: false
              })
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replace Audio / Re-download
          </button>
          <div className="mx-2 my-1 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              handleRemoveSong(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 className="h-3.5 w-3.5 fill-current" />
            Remove from Library
          </button>
        </div>
      )}
      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </div>
  )
}
