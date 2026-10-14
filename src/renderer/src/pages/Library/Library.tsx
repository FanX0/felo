import { useEffect, useMemo, useState, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  Search,
  List,
  RefreshCw,
  Clock,
  MoreVertical,
  Play,
  Pause,
  Radio,
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
  X,
  Laptop2,
  Download
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
import { PersonalizationService } from '../../services/PersonalizationService'
import { ArtworkImage } from '../Home/components/ArtworkImage'
import { HighlightMatch } from '../../components/Common/HighlightMatch'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'

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
  requestedBy?: string
  isPriority?: boolean
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
        className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted"
      >
        Hi-Res{rateKhz ? ` ${rateKhz}` : ''}
      </span>
    )
  }

  if (isLossless) {
    return (
      <span
        title="Lossless CD Quality Audio"
        className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted"
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
    <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted/70">
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
  const [librarySource, setLibrarySource] = useState<'local' | 'pc'>('local')
  const [isRemoteConnected, setIsRemoteConnected] = useState(() => remoteClient.getIsConnected())
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const isElectronApp = typeof window !== 'undefined' && Boolean((window as any).electron)
  const hasRemoteDevice = Boolean(isRemoteConnected || (activeRemote && activeRemote.song))

  useEffect(() => {
    const unsub = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => unsub()
  }, [])
  const { setQueue, togglePlay, currentSongIndex, queue, isPlaying, enqueueSong } = usePlayerStore(
    useShallow((s) => ({
      setQueue: s.setQueue,
      togglePlay: s.togglePlay,
      currentSongIndex: s.currentSongIndex,
      queue: s.queue,
      isPlaying: s.isPlaying,
      enqueueSong: s.enqueueSong
    }))
  )
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
    let searchedSongs: Song[] = songs

    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean)
      searchedSongs = songs.filter((song) => {
        const combined = [song.title, song.artist, song.album, song.genre]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return tokens.every((token) => combined.includes(token))
      })
    }

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

  const loadSongs = async (source = librarySource) => {
    const generation = ++loadGenerationRef.current
    setIsLoadingSongs(true)
    try {
      if (source === 'pc') {
        if (remoteClient.getIsConnected()) {
          const res = await remoteLibraryService.getSongs({ limit: 200 })
          const mapped: Song[] = res.songs.map((s) => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            duration: s.duration,
            filePath: remoteClient.getAudioStreamUrl(s.id),
            artworkPath: s.artworkUrl,
            artworkUrl: s.artworkUrl,
            bitrate: s.bitrate,
            sampleRate: s.sampleRate,
            trackNumber: s.trackNumber,
            genre: s.genre,
            dateAdded: s.dateAdded,
            isOnline: true
          }))
          setSongs(mapped)
        } else if (activeRemote?.song) {
          const s = activeRemote.song
          const mapped: Song = {
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            duration: s.duration,
            filePath: `virtual:${s.title} - ${s.artist}`,
            artworkPath: s.artworkUrl || toMediaUrl(s.artworkPath) || undefined,
            artworkUrl: s.artworkUrl || toMediaUrl(s.artworkPath) || undefined,
            isOnline: true
          }
          setSongs([mapped])
        } else {
          setSongs([])
        }
      } else if (window.api?.getSongs) {
        const data = await window.api.getSongs()
        setSongs(data || [])
      } else {
        console.warn('window.api is not available (running outside Electron)')
        setSongs([])
      }
    } catch (err) {
      console.error('Failed to load songs:', err)
      if (source === 'pc') {
        setSongs([])
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoadingSongs(false)
        setHasLoadedSongs(true)
      }
    }
  }

  // Auto-switch to PC library if local library is empty on mobile and PC is connected
  useEffect(() => {
    if (
      !isElectronApp &&
      hasLoadedSongs &&
      songs.length === 0 &&
      librarySource === 'local' &&
      (isRemoteConnected || activeRemote?.song)
    ) {
      setLibrarySource('pc')
    }
  }, [isElectronApp, hasLoadedSongs, songs.length, librarySource, isRemoteConnected, activeRemote?.song])

  useEffect(() => {
    void loadSongs(librarySource)
  }, [librarySource])

  const handleStartSongRadio = async (song: Song) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          artworkUrl: song.artworkPath,
          filePath: song.filePath
        },
        songs
      )
      if (station.length > 0) {
        usePlayerStore.getState().setQueue(station, 0, {
          type: 'radio' as const,
          title: `${song.title} Radio`,
          route: `/artist/${encodeURIComponent(song.artist)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start song radio:', err)
    }
  }

  const handleStartArtistRadio = async (artistName: string) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          artist: artistName
        },
        songs
      )
      if (station.length > 0) {
        usePlayerStore.getState().setQueue(station, 0, {
          type: 'radio' as const,
          title: `${artistName} Radio`,
          route: `/artist/${encodeURIComponent(artistName)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start artist radio:', err)
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
      // In multi-selection mode, clicking a row toggles its selection
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

    handlePlaySong(index)
  }

  const handlePlaySong = (index: number) => {
    const targetSong = filteredSongs[index]
    if (!targetSong) return

    if (librarySource === 'pc') {
      const targetDevice = remoteClient.getTargetDevice()
      if (targetDevice === 'desktop') {
        void remoteClient.play(targetSong.id)
        return
      }
    }

    if (queue[currentSongIndex]?.id === targetSong.id) {
      togglePlay()
      return
    }

    const contextTitle = librarySource === 'pc' ? 'Remote PC Library' : 'Your Library'
    const playbackContext = usePlayerStore.getState().playbackContext
    const isSameLibraryContext =
      playbackContext?.type === 'library' &&
      playbackContext.title === contextTitle &&
      !searchQuery.trim()

    if (isSameLibraryContext) {
      const existingIdx = queue.findIndex((s) => s.id === targetSong.id)
      if (existingIdx >= 0) {
        usePlayerStore.getState().playSong(existingIdx)
        return
      }
    }

    setQueue(filteredSongs, index, {
      type: 'library',
      title: contextTitle,
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
        artworkUrl: toMediaUrl(song.artworkPath) || song.artworkUrl
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
        setLastSelectedIndex(null)
        return
      }

      // Toggle Play/Pause on Space
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }

      // Play selected song on Enter
      if (e.key === 'Enter') {
        e.preventDefault()
        if (lastSelectedIndex !== null && filteredSongs[lastSelectedIndex]) {
          handlePlaySong(lastSelectedIndex)
        } else if (selectedSongIds.size > 0) {
          const firstIndex = filteredSongs.findIndex((s) => selectedSongIds.has(s.id))
          if (firstIndex >= 0) handlePlaySong(firstIndex)
        }
        return
      }

      // Arrow Down: move active selection down and scroll into view
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filteredSongs.length === 0) return
        const nextIndex =
          lastSelectedIndex === null
            ? 0
            : Math.min(filteredSongs.length - 1, lastSelectedIndex + 1)

        if (e.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, nextIndex)
          const end = Math.max(lastSelectedIndex, nextIndex)
          const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
          setSelectedSongIds(new Set(range))
        } else {
          setSelectedSongIds(new Set([filteredSongs[nextIndex].id]))
          setLastSelectedIndex(nextIndex)
        }
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
        return
      }

      // Arrow Up: move active selection up and scroll into view
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filteredSongs.length === 0) return
        const prevIndex =
          lastSelectedIndex === null
            ? filteredSongs.length - 1
            : Math.max(0, lastSelectedIndex - 1)

        if (e.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, prevIndex)
          const end = Math.max(lastSelectedIndex, prevIndex)
          const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
          setSelectedSongIds(new Set(range))
        } else {
          setSelectedSongIds(new Set([filteredSongs[prevIndex].id]))
          setLastSelectedIndex(prevIndex)
        }
        virtualizer.scrollToIndex(prevIndex, { align: 'auto' })
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredSongs, lastSelectedIndex, selectedSongIds, virtualizer, togglePlay])

  return (
    <div className="h-full flex flex-col pt-4 sm:pt-8 px-3 sm:px-6 pb-2 select-none relative">
      {/* Header Sticky */}
      <div className="mb-4 sm:mb-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5 sm:gap-4 min-w-0">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-text tracking-tight truncate">
              {librarySource === 'pc' ? 'PC Library' : 'My Library'}
            </h1>
            <span className="text-xs sm:text-[13px] font-medium text-text-muted tabular-nums shrink-0">
              {filteredSongs.length} {filteredSongs.length === 1 ? 'song' : 'songs'}
              {searchQuery && songs.length !== filteredSongs.length && (
                <span className="opacity-75 hidden sm:inline"> (of {songs.length})</span>
              )}
            </span>
          </div>

          {/* Library Source Switcher (when connected to PC desktop) */}
          {hasRemoteDevice && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated border border-border/60 text-xs shrink-0 shadow-sm">
              <button
                type="button"
                onClick={() => setLibrarySource('local')}
                className={cn(
                  'px-3 py-1 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer',
                  librarySource === 'local'
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-text-muted hover:text-white'
                )}
              >
                <span>This Device</span>
              </button>
              <button
                type="button"
                onClick={() => setLibrarySource('pc')}
                className={cn(
                  'px-3 py-1 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer',
                  librarySource === 'pc'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-text-muted hover:text-white'
                )}
              >
                <Laptop2 className="w-3.5 h-3.5" />
                <span>PC Library</span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Desktop Expanding In-Library Search Filter */}
            <div
              className={cn(
                'hidden md:flex h-11 origin-right items-center overflow-hidden rounded-full border border-border/60 bg-surface-elevated transition-all duration-300',
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

            {/* Mobile Search Toggle Button */}
            <button
              type="button"
              title="Search library"
              onClick={() => {
                setIsSearchOpen((open) => !open)
                if (!isSearchOpen) {
                  setTimeout(() => searchInputRef.current?.focus(), 50)
                }
              }}
              className={cn(
                'md:hidden flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                isSearchOpen
                  ? 'border-white/40 bg-white/20 text-white'
                  : 'border-border/60 bg-surface-elevated text-text-muted hover:text-white'
              )}
            >
              <Search className="h-4 w-4" />
            </button>

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
                  'flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full shadow-sm transition-colors border',
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
                          sortKey === key ? 'text-white font-bold' : 'text-text-muted'
                        )}
                      >
                        <span>{sortLabels[key]}</span>
                        {sortKey === key && (
                          <ArrowUp
                            className={cn(
                              'h-3.5 w-3.5 transition-transform text-white',
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

            {/* Refresh Library Button */}
            <button
              type="button"
              title="Refresh library"
              onClick={() => void loadSongs()}
              disabled={isLoadingSongs}
              className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-border/60 bg-surface-elevated text-text-muted transition-colors hover:bg-hover hover:text-white"
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingSongs && 'animate-spin')} />
            </button>

            {/* Add Folder Button */}
            <button
              type="button"
              onClick={handleAddFolder}
              disabled={isScanning}
              className="flex h-9 sm:h-11 items-center gap-1.5 sm:gap-2.5 rounded-full bg-white px-3 sm:px-5 text-xs sm:text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 shrink-0 whitespace-nowrap"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary-amber" />
                  <span className="tabular-nums">
                    {scanProgress?.percent !== undefined
                      ? `${scanProgress.percent}%`
                      : 'Scanning...'}
                  </span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 stroke-[3]" />
                  <span className="hidden sm:inline">Add Folder</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Full-Width In-Library Search Filter Row */}
        {isSearchOpen && (
          <div className="md:hidden mt-2.5 flex items-center gap-2 bg-surface-elevated border border-border/60 rounded-full px-3.5 py-1.5 animate-in fade-in slide-in-from-top-1">
            <Search className="h-4 w-4 text-text-muted shrink-0" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter library..."
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-text-muted"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 text-text-muted hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                setIsSearchOpen(false)
              }}
              className="text-xs font-semibold text-text-muted hover:text-white ml-1 shrink-0"
            >
              Done
            </button>
          </div>
        )}
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
            {hasRemoteDevice
              ? 'Connect to your PC to browse and control playback from your desktop library.'
              : 'Add a local music folder to scan and index all your high-resolution and lossless audio tracks.'}
          </p>
          {hasRemoteDevice && librarySource === 'local' ? (
            <button
              type="button"
              onClick={() => setLibrarySource('pc')}
              className="flex h-11 items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 text-sm font-bold text-black transition-all hover:scale-[1.02] shadow-md cursor-pointer"
            >
              <Laptop2 className="h-4 w-4" />
              <span>Browse PC Library</span>
            </button>
          ) : (
            <button
              onClick={handleAddFolder}
              disabled={isScanning}
              className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-md"
            >
              <Plus className="h-4 w-4 stroke-[3]" /> Add Local Music Folder
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Interactive Clickable Table Header */}
          <div className="grid grid-cols-[32px_minmax(0,1fr)_76px] gap-2 border-b border-border/30 bg-surface px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted sticky top-0 z-10 shrink-0 md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4">
            <button
              type="button"
              onClick={() => handleSort('default')}
              title="Sort by original order"
              className={cn(
                'text-center hover:text-text transition-colors flex items-center justify-center gap-1',
                sortKey === 'default' ? 'text-white font-bold' : 'text-text-muted'
              )}
            >
              <span>#</span>
              {sortKey === 'default' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform text-white',
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
                sortKey === 'title' ? 'text-white font-bold' : 'text-text-muted'
              )}
            >
              <span>Title</span>
              {sortKey === 'title' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform text-white',
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
                sortKey === 'album' ? 'text-white font-bold' : 'text-text-muted'
              )}
            >
              <span>Album</span>
              {sortKey === 'album' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform text-white',
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
                sortKey === 'dateAdded' ? 'text-white font-bold' : 'text-text-muted'
              )}
            >
              <span>Date added</span>
              {sortKey === 'dateAdded' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform text-white',
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
                'flex items-center justify-end gap-1.5 pr-1 md:pr-8 hover:text-text transition-colors ml-auto',
                sortKey === 'duration' ? 'text-white font-bold' : 'text-text-muted'
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              {sortKey === 'duration' && (
                <ArrowUp
                  className={cn(
                    'w-3 h-3 transition-transform text-white',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              )}
            </button>
          </div>

          {/* Virtual Table Body */}
          <div ref={parentRef} key={viewMode} className="flex-1 overflow-y-auto mt-1 pb-36 md:pb-16">
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
                const artworkUrl = toMediaUrl(song.artworkPath) || song.artworkUrl

                return (
                  <div
                    key={song.id}
                    onClick={(e) => handleRowClick(e, index, song)}
                    className={cn(
                      'absolute top-0 left-0 grid w-full grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 rounded-lg px-2 text-[13px] group cursor-pointer transition-colors md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(180px,1fr)] xl:gap-4 xl:px-4',
                      isSelected
                        ? 'bg-white/10 border border-white/20 text-white'
                        : isActive
                          ? 'bg-hover'
                          : 'hover:bg-hover/50'
                    )}
                    style={{
                      height: `${viewMode === 'compact' ? rowHeight : virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    {/* Index / Animated Soundwave / Checkmark / Play-Pause Icon */}
                    <div className="relative flex h-5 items-center justify-center text-center font-medium">
                      {isSelected ? (
                        <div className="flex items-center justify-center text-primary-amber">
                          <Check className="h-4 w-4 stroke-[2.5]" />
                        </div>
                      ) : selectedSongIds.size > 0 ? (
                        <div className="h-3.5 w-3.5 rounded border border-border/70 group-hover:border-primary-amber flex items-center justify-center transition-colors" />
                      ) : isActive && isPlaying ? (
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
                        <ArtworkImage
                          src={artworkUrl}
                          title={song.title}
                          artist={song.artist}
                          className="absolute inset-0 h-full w-full object-cover"
                          fallbackIcon={<span className="text-[8px] text-text-muted font-bold">Art</span>}
                        />
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <span
                          className={cn(
                            'font-semibold truncate text-sm',
                            isActive ? 'text-primary-amber' : 'text-text'
                          )}
                        >
                          <HighlightMatch text={song.title} query={searchQuery} />
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
                      {song.album ? (
                        <HighlightMatch text={song.album} query={searchQuery} />
                      ) : (
                        '-'
                      )}
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
                            : 'opacity-70 md:opacity-0 text-text-muted md:group-hover:opacity-100 hover:text-text hover:bg-hover'
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
      {selectedSongIds.size > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-surface-elevated/95 border border-border/80 px-5 py-2.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          <span className="text-xs font-bold text-text tabular-nums">
            {selectedSongIds.size} {selectedSongIds.size === 1 ? 'song' : 'songs'} selected
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
            className="flex items-center gap-1.5 text-xs font-bold text-white hover:text-white/80 transition-colors"
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
          <div className="h-4 w-[1px] bg-border/60" />
          <button
            type="button"
            onClick={() => {
              if (selectedSongIds.size === filteredSongs.length) {
                setSelectedSongIds(new Set())
              } else {
                setSelectedSongIds(new Set(filteredSongs.map((s) => s.id)))
              }
            }}
            className="text-xs font-semibold text-text-muted hover:text-text transition-colors"
          >
            {selectedSongIds.size === filteredSongs.length ? 'Deselect All' : 'Select All'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedSongIds(new Set())}
            title="Clear selection (Esc)"
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
          {isRemoteConnected && (
            <>
              <button
                type="button"
                onClick={() => {
                  void remoteClient.play(activeMenu.song.id)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <Laptop2 className="h-3.5 w-3.5" />
                Play on PC
              </button>
              <button
                type="button"
                onClick={() => {
                  remoteClient.downloadSong(activeMenu.song.id)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Transfer / Download to Phone
              </button>
              <div className="my-1 border-t border-white/10" />
            </>
          )}
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
          <button
            type="button"
            onClick={() => {
              void handleStartSongRadio(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          >
            <Radio className="h-3.5 w-3.5 text-primary-amber" />
            Start Song Radio
          </button>
          {activeMenu.song.artist && (
            <button
              type="button"
              onClick={() => {
                void handleStartArtistRadio(activeMenu.song.artist || '')
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <Radio className="h-3.5 w-3.5 text-primary-amber" />
              Start Artist Radio
            </button>
          )}
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

            const isNearRightEdge = activeMenu.x > window.innerWidth - 440
            const isNearBottomEdge = activeMenu.y > window.innerHeight - 250

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
                <div
                  className={`absolute ${
                    isNearRightEdge ? 'right-full mr-1' : 'left-full ml-1'
                  } ${
                    isNearBottomEdge ? 'bottom-0' : 'top-0'
                  } hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-border/80 bg-surface-elevated/95 p-1.5 shadow-2xl backdrop-blur-md z-50`}
                >
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
