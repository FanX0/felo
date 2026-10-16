import { useState, useEffect } from 'react'
import {
  Play,
  Pause,
  Heart,
  Download,
  CheckCircle2,
  Loader2,
  Radio,
  List,
  LayoutGrid,
  MoreVertical,
  ListPlus,
  Disc3,
  User,
  ChevronRight,
  FileText,
  Share2,
  Laptop2,
  Clock
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { HomeSongItem } from '../types'
import { ArtworkImage } from './ArtworkImage'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'
import { AppCapabilities } from '../../../lib/appConfig'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import SongCreditsModal from '../../../components/Common/SongCreditsModal'
import { parseArtists } from '../../../lib/artistParser'
import { cn } from '../../../lib/utils'
import { remoteClient } from '../../Remote/remoteClient'
import { PersonalizationService } from '../../../services/PersonalizationService'
import { usePlaybackArbitration } from '../../../hooks/usePlaybackArbitration'
import type { Song } from '../../Library/Library'

interface HomeSongSectionProps {
  songs: HomeSongItem[]
  title: string
  subtitle?: string
  likedSongIds: Set<string>
  onToggleLike: (songId: string) => void
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  onChooseSourceOrReplace: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
  onStartRadio?: () => void
  isRadioActive?: boolean
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function AnimatedPlayingWave() {
  return (
    <div className="flex items-end justify-center gap-[2.5px] h-3.5 w-3.5" aria-label="Playing">
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '70%' }}
      />
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '100%', animationDelay: '0.15s' }}
      />
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '80%', animationDelay: '0.3s' }}
      />
    </div>
  )
}

function QualityPill({ song }: { song: HomeSongItem }) {
  const rawFormat = String(song.codec || song.container || song.quality || '').toLowerCase()
  const isLossless =
    rawFormat.includes('flac') ||
    rawFormat.includes('alac') ||
    rawFormat.includes('wav') ||
    rawFormat.includes('aiff') ||
    song.quality === 'FLAC' ||
    song.quality === 'HD FLAC'
  const isHiRes =
    (song.bitDepth && song.bitDepth >= 24) ||
    (song.sampleRate && song.sampleRate >= 88200) ||
    song.quality === 'Hi-Res'

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
          : song.quality
            ? song.quality
            : rawFormat.toUpperCase()

  if (!format || format === 'UNKNOWN') return null

  const kbps = song.bitrate ? `${Math.round(song.bitrate / 1000)}k` : ''

  return (
    <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted/70">
      {format}{kbps ? ` ${kbps}` : ''}
    </span>
  )
}

export function HomeSongSection({
  songs,
  title,
  subtitle,
  likedSongIds,
  onToggleLike,
  onPlaySong,
  onDownloadSong,
  onChooseSourceOrReplace,
  libraryIndex,
  onStartRadio,
  isRadioActive
}: HomeSongSectionProps) {
  const navigate = useNavigate()
  const queue = usePlayerStore((s) => s.queue)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const enqueueSong = usePlayerStore((s) => s.enqueueSong)
  const transfers = useDownloadStore((s) => s.transfers)
  const currentTrack = queue[currentSongIndex]
  const { requestPlayQueue } = usePlaybackArbitration()

  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      const saved = localStorage.getItem('felo_home_track_view')
      if (saved === 'list' || saved === 'grid') return saved
    } catch {}
    return 'list'
  })

  const [activeMenu, setActiveMenu] = useState<{
    song: HomeSongItem
    index: number
    x: number
    y: number
  } | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const isRemoteConnected = remoteClient.getIsConnected()

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  const handleSetViewMode = (mode: 'list' | 'grid') => {
    setViewMode(mode)
    try {
      localStorage.setItem('felo_home_track_view', mode)
    } catch {}
  }

  const handleMenuOpen = (
    e: React.MouseEvent,
    song: HomeSongItem,
    index: number
  ) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const menuWidth = 240
    const menuHeight = 260
    setActiveMenu({
      song,
      index,
      x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
    })
  }

  const handleContextMenu = (
    e: React.MouseEvent,
    song: HomeSongItem,
    index: number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const menuWidth = 240
    const menuHeight = 260
    setActiveMenu({
      song,
      index,
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 12)
    })
  }

  const handleAlbumClick = (e: React.MouseEvent, song: HomeSongItem) => {
    e.stopPropagation()
    if (!song.album) return
    navigate(`/album/${encodeURIComponent(song.artist || 'Unknown Artist')}/${encodeURIComponent(song.album)}`)
  }

  const handleShareSong = (song: HomeSongItem) => {
    sessionStorage.setItem(
      'felo:pending-chat-song',
      JSON.stringify({
        localId: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        artworkUrl: song.artworkUrl
      })
    )
    navigate('/chat')
    setActiveMenu(null)
  }

  const handleStartSongRadio = async (song: HomeSongItem) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          artworkUrl: song.artworkUrl,
          filePath: song.filePath
        },
        songs.map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          album: s.album || '',
          duration: s.duration,
          filePath: s.filePath
        }))
      )
      if (station.length > 0) {
        requestPlayQueue(station, 0, {
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
        songs.map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          album: s.album || '',
          duration: s.duration,
          filePath: s.filePath
        }))
      )
      if (station.length > 0) {
        requestPlayQueue(station, 0, {
          type: 'radio' as const,
          title: `${artistName} Radio`,
          route: `/artist/${encodeURIComponent(artistName)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start artist radio:', err)
    }
  }

  if (songs.length === 0) return null

  return (
    <section className="space-y-4">
      {/* Header with Title, Infinite Radio & View Mode Switcher */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{title}</h2>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onStartRadio && (
            <button
              type="button"
              onClick={onStartRadio}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-4 text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95 ${
                isRadioActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-surface-elevated text-text-muted hover:text-white hover:bg-hover'
              }`}
            >
              <Radio className={`h-3.5 w-3.5 ${isRadioActive ? 'animate-pulse text-primary-foreground' : ''}`} />
              <span className="hidden sm:inline">{isRadioActive ? 'Radio Streaming' : 'Start Infinite Radio'}</span>
            </button>
          )}

          {/* View Mode Switcher: List vs Grid */}
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => handleSetViewMode('list')}
              title="List View (Table)"
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground shadow-sm font-bold'
                  : 'text-text-muted hover:text-white'
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              title="Grid View (2 Columns)"
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-all',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-sm font-bold'
                  : 'text-text-muted hover:text-white'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Mode 1: Table List View (Identical to Library.tsx Local Songs) ─── */}
      {viewMode === 'list' ? (
        <div className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-[36px_minmax(0,1fr)_80px] sm:grid-cols-[40px_minmax(0,2fr)_minmax(0,1.2fr)_140px] items-center gap-3 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted bg-surface-elevated/40">
            <div className="text-center font-medium">#</div>
            <div>Title</div>
            <div className="hidden sm:block">Album</div>
            <div className="flex items-center justify-end gap-1.5 pr-2">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-border/40">
            {songs.map((song, index) => {
              const isThisTrack =
                currentTrack?.title.toLowerCase() === song.title.toLowerCase() &&
                (!song.artist || !currentTrack?.artist || currentTrack.artist.toLowerCase() === song.artist.toLowerCase())
              const isCurrentlyPlaying = isThisTrack && isPlaying
              const isLiked = likedSongIds.has(song.id)
              const isInLibrary = libraryIndex.has(song.title, song.artist)

              const transfer = transfers.find(
                (t) =>
                  t.title.toLowerCase() === song.title.toLowerCase() &&
                  (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
                  (t.status === 'downloading' || t.status === 'queued')
              )
              const isDownloading = Boolean(transfer)

              return (
                <div
                  key={song.id || `${song.title}-${index}`}
                  onClick={() => onPlaySong(song)}
                  onContextMenu={(e) => handleContextMenu(e, song, index)}
                  className={cn(
                    'group grid grid-cols-[36px_minmax(0,1fr)_80px] sm:grid-cols-[40px_minmax(0,2fr)_minmax(0,1.2fr)_140px] items-center gap-3 px-3 py-2 text-[13px] cursor-pointer transition-colors',
                    isThisTrack
                      ? 'bg-surface-elevated'
                      : 'hover:bg-hover/50'
                  )}
                >
                  {/* Track Index / Play on Hover / Playing Wave */}
                  <div className="relative flex h-5 items-center justify-center text-center font-medium">
                    {isCurrentlyPlaying ? (
                      <>
                        <span className="group-hover:hidden">
                          <AnimatedPlayingWave />
                        </span>
                        <span className="hidden group-hover:flex items-center justify-center text-primary">
                          <Pause className="h-4 w-4 fill-current" />
                        </span>
                      </>
                    ) : isThisTrack ? (
                      <>
                        <span className="text-primary group-hover:hidden text-xs">❚❚</span>
                        <span className="hidden group-hover:flex items-center justify-center text-primary">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-text-muted group-hover:hidden text-xs tabular-nums">
                          {index + 1}
                        </span>
                        <span className="hidden group-hover:flex items-center justify-center text-white">
                          <Play className="h-4 w-4 fill-current ml-0.5" />
                        </span>
                      </>
                    )}
                  </div>

                  {/* Artwork + Title + ArtistLinks + Quality Badge */}
                  <div className="flex items-center gap-3 overflow-hidden min-w-0">
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface-elevated border border-border shadow-sm">
                      <ArtworkImage
                        src={song.artworkUrl}
                        title={song.title}
                        artist={song.artist}
                        alt={song.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col overflow-hidden min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'font-semibold truncate text-sm transition-colors',
                            isThisTrack ? 'text-primary font-bold' : 'text-text'
                          )}
                          title={song.title}
                        >
                          {song.title}
                        </span>
                        {song.isExplicit && (
                          <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-bold uppercase text-text-muted">
                            E
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 truncate mt-0.5">
                        <ArtistLinks
                          artist={song.artist}
                          artists={song.artists}
                          linkClassName="text-text-muted hover:text-text hover:underline text-xs truncate"
                        />
                        <QualityPill song={song} />
                      </div>
                    </div>
                  </div>

                  {/* Album Link Column */}
                  <div
                    onClick={(e) => handleAlbumClick(e, song)}
                    title={song.album ? `Go to album: ${song.album}` : undefined}
                    className="hidden sm:block min-w-0 truncate text-xs text-text-muted hover:underline hover:text-white cursor-pointer"
                  >
                    {song.album || '-'}
                  </div>

                  {/* Right Actions: Like, Download, Duration & 3-Dots Menu */}
                  <div className="flex items-center justify-end gap-2.5 pr-1">
                    {/* Like Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleLike(song.id)
                      }}
                      className={cn(
                        'text-xs transition-all p-1 rounded-md hover:bg-hover',
                        isLiked
                          ? 'text-rose-500'
                          : 'text-text-muted opacity-60 sm:opacity-0 group-hover:opacity-100 hover:text-white'
                      )}
                      title={isLiked ? 'Unlike track' : 'Like track'}
                    >
                      <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
                    </button>

                    {/* Download / In Library */}
                    {AppCapabilities.downloads && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isInLibrary) {
                            onChooseSourceOrReplace(song)
                          } else {
                            onDownloadSong(song)
                          }
                        }}
                        className={cn(
                          'h-7 w-7 flex items-center justify-center rounded-full transition-all',
                          isDownloading
                            ? 'text-primary'
                            : isInLibrary
                              ? 'text-text-muted hover:text-white hover:bg-hover'
                              : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-hover'
                        )}
                        title={
                          isDownloading
                            ? `Downloading (${transfer?.progress || 0}%)...`
                            : isInLibrary
                              ? 'In your library'
                              : 'Download track'
                        }
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : isInLibrary ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    {/* Duration */}
                    <span className="w-10 text-right text-xs text-text-muted tabular-nums">
                      {formatDuration(song.duration)}
                    </span>

                    {/* 3-Dots More Options Menu */}
                    <button
                      type="button"
                      onClick={(e) => handleMenuOpen(e, song, index)}
                      title="More options"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-hover transition-colors"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ─── Mode 2: Enhanced 2-Column Cards Grid ─── */
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {songs.map((song, index) => {
            const isThisTrack =
              currentTrack?.title.toLowerCase() === song.title.toLowerCase() &&
              (!song.artist || !currentTrack?.artist || currentTrack.artist.toLowerCase() === song.artist.toLowerCase())
            const isCurrentlyPlaying = isThisTrack && isPlaying
            const isLiked = likedSongIds.has(song.id)
            const isInLibrary = libraryIndex.has(song.title, song.artist)

            const transfer = transfers.find(
              (t) =>
                t.title.toLowerCase() === song.title.toLowerCase() &&
                (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
                (t.status === 'downloading' || t.status === 'queued')
            )
            const isDownloading = Boolean(transfer)

            return (
              <div
                key={song.id || `${song.title}-${index}`}
                onClick={() => onPlaySong(song)}
                onContextMenu={(e) => handleContextMenu(e, song, index)}
                className={cn(
                  'group flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-all duration-200 cursor-pointer',
                  isThisTrack
                    ? 'bg-surface-elevated border border-border shadow-sm'
                    : 'hover:bg-hover/50 border border-transparent'
                )}
              >
                {/* Thumbnail & Info */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-elevated border border-border shadow-sm">
                    <ArtworkImage
                      src={song.artworkUrl}
                      title={song.title}
                      artist={song.artist}
                      alt={song.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                      {isCurrentlyPlaying ? (
                        <AnimatedPlayingWave />
                      ) : (
                        <Play className="h-4 w-4 fill-white text-white ml-0.5" />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isCurrentlyPlaying && <AnimatedPlayingWave />}
                      <p
                        className={cn(
                          'truncate text-sm font-semibold transition-colors',
                          isThisTrack ? 'text-primary font-bold' : 'text-text'
                        )}
                        title={song.title}
                      >
                        {song.title}
                      </p>
                      {song.isExplicit && (
                        <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-bold uppercase text-text-muted">
                          E
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 truncate mt-0.5">
                      <ArtistLinks
                        artist={song.artist}
                        artists={song.artists}
                        linkClassName="text-text-muted hover:text-text hover:underline text-xs truncate"
                      />
                      <QualityPill song={song} />
                    </div>
                  </div>
                </div>

                {/* Actions & Meta */}
                <div className="flex items-center gap-2.5">
                  {/* Like Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleLike(song.id)
                    }}
                    className={cn(
                      'text-xs transition-colors p-1 rounded-md hover:bg-hover',
                      isLiked
                        ? 'text-rose-500'
                        : 'text-text-muted opacity-60 sm:opacity-0 group-hover:opacity-100 hover:text-white'
                    )}
                    title={isLiked ? 'Unlike track' : 'Like track'}
                  >
                    <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
                  </button>

                  {/* Download / In Library */}
                  {AppCapabilities.downloads && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isInLibrary) {
                          onChooseSourceOrReplace(song)
                        } else {
                          onDownloadSong(song)
                        }
                      }}
                      className={cn(
                        'h-7 w-7 flex items-center justify-center rounded-full transition-all',
                        isDownloading
                          ? 'text-primary'
                          : isInLibrary
                            ? 'text-text-muted hover:text-white hover:bg-hover'
                            : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-hover'
                      )}
                    >
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : isInLibrary ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>
                  )}

                  <span className="w-9 text-right text-xs text-text-muted tabular-nums">
                    {formatDuration(song.duration)}
                  </span>

                  {/* 3-Dots More Options Menu */}
                  <button
                    type="button"
                    onClick={(e) => handleMenuOpen(e, song, index)}
                    title="More options"
                    className="h-7 w-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-hover transition-colors"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Context Action Menu ─── */}
      {activeMenu && (
        <div
          className="fixed z-[9999] w-[240px] rounded-xl border border-border bg-surface-elevated p-1.5 shadow-2xl backdrop-blur-md"
          style={{ left: activeMenu.x, top: activeMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {isRemoteConnected && (
            <>
              <button
                type="button"
                onClick={() => {
                  void remoteClient.play(activeMenu.song.id)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-hover transition-colors"
              >
                <Laptop2 className="h-3.5 w-3.5" />
                Play on PC
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}

          <button
            type="button"
            onClick={() => {
              onPlaySong(activeMenu.song)
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Play
          </button>

          <button
            type="button"
            onClick={() => {
              enqueueSong({
                id: activeMenu.song.id,
                title: activeMenu.song.title,
                artist: activeMenu.song.artist,
                album: activeMenu.song.album || '',
                duration: activeMenu.song.duration,
                artworkUrl: activeMenu.song.artworkUrl,
                filePath: activeMenu.song.filePath || `virtual:${activeMenu.song.title}`
              })
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white"
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
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white"
          >
            <Radio className="h-3.5 w-3.5 text-text-muted" />
            Start Song Radio
          </button>

          {activeMenu.song.artist && (
            <button
              type="button"
              onClick={() => {
                void handleStartArtistRadio(activeMenu.song.artist)
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white"
            >
              <Radio className="h-3.5 w-3.5 text-text-muted" />
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
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
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
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
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
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
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
                  } hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-white/10 bg-[#141518] p-1.5 shadow-2xl backdrop-blur-md z-50`}
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-white/10 mb-1">
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
                      className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-white transition-colors"
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
              setCreditsSong({
                id: activeMenu.song.id,
                title: activeMenu.song.title,
                artist: activeMenu.song.artist,
                album: activeMenu.song.album || '',
                duration: activeMenu.song.duration,
                artworkUrl: activeMenu.song.artworkUrl,
                filePath: activeMenu.song.filePath,
                codec: activeMenu.song.codec,
                container: activeMenu.song.container,
                bitrate: activeMenu.song.bitrate,
                sampleRate: activeMenu.song.sampleRate,
                bitDepth: activeMenu.song.bitDepth,
                size: activeMenu.song.size
              })
              setActiveMenu(null)
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <FileText className="h-3.5 w-3.5" />
            Show Credits
          </button>

          <button
            type="button"
            onClick={() => handleShareSong(activeMenu.song)}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share to Friend Chat
          </button>
        </div>
      )}

      {/* Song Credits Modal */}
      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </section>
  )
}
