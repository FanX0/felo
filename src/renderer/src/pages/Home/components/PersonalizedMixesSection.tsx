import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ArrowLeft,
  Play,
  Pause,
  Shuffle,
  Download,
  CheckCircle2,
  Loader2,
  Music2,
  RotateCw,
  Clock,
  Heart,
  List,
  LayoutGrid,
  MoreVertical,
  ListPlus,
  Radio,
  Laptop2,
  FileText,
  FolderOpen
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { PersonalizedMix } from '../../../services/PersonalizationService'
import type { HomeSongItem } from '../types'
import type { Song } from '../../Library/Library'
import { AppCapabilities } from '../../../lib/appConfig'
import { ArtworkImage } from './ArtworkImage'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import SongCreditsModal from '../../../components/Common/SongCreditsModal'
import { cn } from '../../../lib/utils'
import { remoteClient } from '../../Remote/remoteClient'
import { PersonalizationService } from '../../../services/PersonalizationService'
import { usePlaybackArbitration } from '../../../hooks/usePlaybackArbitration'
import { findMatchingLibrarySong } from '../../../lib/songMatching'
import { toMediaUrl } from '../../../lib/media'
import { calculateMenuPosition, useMenuAutoPosition } from '../../../lib/menuPosition'

interface PersonalizedMixesSectionProps {
  mixes: PersonalizedMix[]
  selectedMix: PersonalizedMix | null
  onSelectMix: (mix: PersonalizedMix | null) => void
  onPlayMix: (mix: PersonalizedMix, startIndex?: number) => void
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  onChooseSourceOrReplace?: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
  librarySongs?: Song[]
  likedSongIds?: Set<string>
  onToggleLike?: (songId: string) => void
  isLoadingMixes: boolean
  onRefreshMixes: () => void
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

export function PersonalizedMixesSection({
  mixes,
  selectedMix,
  onSelectMix,
  onPlayMix,
  onPlaySong,
  onDownloadSong,
  onChooseSourceOrReplace,
  libraryIndex,
  librarySongs = [],
  likedSongIds,
  onToggleLike,
  isLoadingMixes,
  onRefreshMixes
}: PersonalizedMixesSectionProps) {
  void libraryIndex
  const navigate = useNavigate()
  const queue = usePlayerStore((s) => s.queue)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const enqueueSong = usePlayerStore((s) => s.enqueueSong)
  const playbackContext = usePlayerStore((s) => s.playbackContext)
  const transfers = useDownloadStore((s) => s.transfers)
  const { requestPlayQueue } = usePlaybackArbitration()
  const currentTrack = queue[currentSongIndex]

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
    openUpwards?: boolean
    triggerRect?: { top: number; bottom: number; left: number; right: number } | DOMRect | null
  } | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const isRemoteConnected = remoteClient.getIsConnected()
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuAutoPosition({
    menuRef,
    triggerRect: activeMenu?.triggerRect,
    initialX: activeMenu?.x,
    initialY: activeMenu?.y,
    openUpwards: activeMenu?.openUpwards
  })

  // Filter mixes so that only songs already available on local storage are included
  const visibleMixes = useMemo(() => {
    return mixes
      .map((mix) => {
        const localTracks = mix.tracks
          .map((rawTrack) => {
            const localMatch =
              librarySongs.length > 0
                ? findMatchingLibrarySong(rawTrack.title, rawTrack.artist, librarySongs)
                : undefined

            if (localMatch && localMatch.filePath && !localMatch.filePath.startsWith('virtual:')) {
              return {
                ...rawTrack,
                ...localMatch,
                id: localMatch.id || rawTrack.id,
                title: localMatch.title || rawTrack.title,
                artist: localMatch.artist || rawTrack.artist,
                album: localMatch.album || rawTrack.album,
                duration: localMatch.duration || rawTrack.duration,
                artworkUrl: rawTrack.artworkUrl || toMediaUrl(localMatch.artworkPath) || localMatch.artworkUrl,
                quality: (localMatch.quality as any) || rawTrack.quality,
                filePath: localMatch.filePath
              }
            }

            const isRawLocal = Boolean(
              rawTrack.filePath &&
                !rawTrack.filePath.startsWith('virtual:') &&
                !/^https?:/i.test(rawTrack.filePath) &&
                (librarySongs.length === 0 || librarySongs.some((s) => s.filePath === rawTrack.filePath || s.id === rawTrack.id))
            )

            if (isRawLocal) {
              return rawTrack
            }

            return null
          })
          .filter((t): t is HomeSongItem => t !== null)

        return {
          ...mix,
          tracks: localTracks
        }
      })
      .filter((mix) => mix.tracks.length >= 3)
  }, [mixes, librarySongs])

  const localTracksForSelectedMix = useMemo(() => {
    if (!selectedMix) return []
    return selectedMix.tracks
      .map((rawTrack) => {
        const localMatch =
          librarySongs.length > 0
            ? findMatchingLibrarySong(rawTrack.title, rawTrack.artist, librarySongs)
            : undefined

        if (localMatch && localMatch.filePath && !localMatch.filePath.startsWith('virtual:')) {
          return {
            ...rawTrack,
            ...localMatch,
            id: localMatch.id || rawTrack.id,
            title: localMatch.title || rawTrack.title,
            artist: localMatch.artist || rawTrack.artist,
            album: localMatch.album || rawTrack.album,
            duration: localMatch.duration || rawTrack.duration,
            artworkUrl: rawTrack.artworkUrl || toMediaUrl(localMatch.artworkPath) || localMatch.artworkUrl,
            quality: (localMatch.quality as any) || rawTrack.quality,
            filePath: localMatch.filePath
          }
        }

        const isRawLocal = Boolean(
          rawTrack.filePath &&
            !rawTrack.filePath.startsWith('virtual:') &&
            !/^https?:/i.test(rawTrack.filePath) &&
            (librarySongs.length === 0 || librarySongs.some((s) => s.filePath === rawTrack.filePath || s.id === rawTrack.id))
        )

        if (isRawLocal) {
          return rawTrack
        }

        return null
      })
      .filter((t): t is HomeSongItem => t !== null)
  }, [selectedMix, librarySongs])

  const activeSelectedMix = useMemo(() => {
    if (!selectedMix) return null
    return {
      ...selectedMix,
      tracks: localTracksForSelectedMix
    }
  }, [selectedMix, localTracksForSelectedMix])

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
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
    const pos = calculateMenuPosition({
      triggerRect: rect,
      menuWidth: 240,
      estimatedHeight: 400
    })
    setActiveMenu({
      song,
      index,
      x: pos.x,
      y: pos.y,
      openUpwards: pos.openUpwards,
      triggerRect: rect
    })
  }

  const handleContextMenu = (
    e: React.MouseEvent,
    song: HomeSongItem,
    index: number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = calculateMenuPosition({
      cursorX: e.clientX,
      cursorY: e.clientY,
      menuWidth: 240,
      estimatedHeight: 400
    })
    setActiveMenu({
      song,
      index,
      x: pos.x,
      y: pos.y,
      openUpwards: pos.openUpwards
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

  const handleStartSongRadio = async (song: HomeSongItem, allSongs: HomeSongItem[]) => {
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
        allSongs.map((s) => ({
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

  const handleStartArtistRadio = async (artistName: string, allSongs: HomeSongItem[]) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          artist: artistName
        },
        allSongs.map((s) => ({
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

  // Drill-down view
  if (selectedMix) {
    const isThisMixContext =
      playbackContext?.type === 'playlist' &&
      playbackContext.id === selectedMix.id
    const isMixPlaying = isThisMixContext && isPlaying

    const handlePlayMixToggle = () => {
      if (isThisMixContext) {
        togglePlay()
      } else if (activeSelectedMix) {
        onPlayMix(activeSelectedMix, 0)
      }
    }

    const handleShuffleMix = () => {
      if (!isShuffle) toggleShuffle()
      if (!activeSelectedMix || localTracksForSelectedMix.length === 0) return
      const randIdx = Math.floor(Math.random() * localTracksForSelectedMix.length)
      onPlayMix(activeSelectedMix, randIdx)
    }

    const heroArt =
      localTracksForSelectedMix.find((t) => t.artworkUrl)?.artworkUrl ||
      toMediaUrl(localTracksForSelectedMix[0]?.artworkUrl)

    return (
      <section className="space-y-6">
        <button
          type="button"
          onClick={() => onSelectMix(null)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-semibold text-text transition-all hover:bg-hover hover:text-white cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </button>

        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-border bg-surface-elevated p-6 sm:p-8 shadow-sm">
          <div className="relative flex h-36 w-36 shrink-0 items-center justify-center rounded-2xl bg-surface border border-border shadow-sm overflow-hidden">
            {heroArt ? (
              <ArtworkImage
                src={heroArt}
                title={selectedMix.title}
                artist={selectedMix.subtitle}
                className="h-full w-full object-cover"
                fallbackIcon={<Music2 className="h-16 w-16 text-text-muted" />}
              />
            ) : (
              <Music2 className="h-16 w-16 text-text-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Made For You
            </span>
            <h1 className="mt-1 text-3xl font-black text-text sm:text-4xl tracking-tight">
              {selectedMix.title}
            </h1>
            <p className="mt-2 text-sm text-text-muted leading-relaxed max-w-2xl">
              {selectedMix.description}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handlePlayMixToggle}
                className="inline-flex items-center gap-2 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground px-6 py-2.5 text-xs font-bold shadow-sm hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                {isMixPlaying ? (
                  <>
                    <Pause className="h-4 w-4 fill-current ml-0.5" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current ml-0.5" />
                    <span>Play Mix</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleShuffleMix}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface hover:bg-hover text-text px-4 py-2.5 text-xs font-semibold shadow-sm transition-all cursor-pointer"
                title="Shuffle Mix"
              >
                <Shuffle className="h-3.5 w-3.5" />
                <span>Shuffle</span>
              </button>
              <span className="text-xs font-semibold text-text-muted">
                {localTracksForSelectedMix.length} tracks
              </span>
            </div>
          </div>
        </div>

        {/* Tracklist Controls: Title & View Mode Switcher */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Tracklist
          </span>
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => handleSetViewMode('list')}
              title="List View (Table)"
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-all cursor-pointer',
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
                'flex h-7 w-7 items-center justify-center rounded-md transition-all cursor-pointer',
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-sm font-bold'
                  : 'text-text-muted hover:text-white'
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ─── Tracklist (Strictly local songs only) ─── */}
        {localTracksForSelectedMix.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface p-12 text-center">
            <Music2 className="h-10 w-10 text-text-muted mb-3 opacity-60" />
            <p className="font-semibold text-text">No local songs found for this mix</p>
            <p className="text-xs text-text-muted mt-1 max-w-sm">
              Made For You only shows tracks that are already in your local library.
            </p>
            <button
              type="button"
              onClick={() => onSelectMix(null)}
              className="mt-4 rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-semibold text-text hover:bg-hover hover:text-white cursor-pointer"
            >
              Back to Overview
            </button>
          </div>
        ) : viewMode === 'list' ? (
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
              {localTracksForSelectedMix.map((track, index) => {
                const isThisTrack =
                  currentTrack?.title.toLowerCase() === track.title.toLowerCase() &&
                  (!track.artist || !currentTrack?.artist || currentTrack.artist.toLowerCase() === track.artist.toLowerCase())
                const isCurrentlyPlaying = isThisTrack && isPlaying
                const isLiked = likedSongIds?.has(track.id) || false
                const isInLibrary = true

                const transfer = transfers.find(
                  (t) =>
                    t.title.toLowerCase() === track.title.toLowerCase() &&
                    (!track.artist || !t.artist || t.artist.toLowerCase() === track.artist.toLowerCase()) &&
                    (t.status === 'downloading' || t.status === 'queued')
                )
                const isDownloading = Boolean(transfer)

                return (
                  <div
                    key={track.id || `${track.title}-${index}`}
                    onClick={() => {
                      if (isThisTrack) {
                        togglePlay()
                      } else if (activeSelectedMix) {
                        onPlayMix(activeSelectedMix, index)
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, track, index)}
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
                          src={track.artworkUrl}
                          title={track.title}
                          artist={track.artist}
                          alt={track.title}
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
                            title={track.title}
                          >
                            {track.title}
                          </span>
                          {track.isExplicit && (
                            <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-bold uppercase text-text-muted">
                              E
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 truncate mt-0.5">
                          <ArtistLinks
                            artist={track.artist}
                            artists={track.artists}
                            linkClassName="text-text-muted hover:text-text hover:underline text-xs truncate"
                          />
                          <QualityPill song={track} />
                        </div>
                      </div>
                    </div>

                    {/* Album Link Column */}
                    <div
                      onClick={(e) => handleAlbumClick(e, track)}
                      title={track.album ? `Go to album: ${track.album}` : undefined}
                      className="hidden sm:block min-w-0 truncate text-xs text-text-muted hover:underline hover:text-white cursor-pointer"
                    >
                      {track.album || '-'}
                    </div>

                    {/* Right Actions: Like, Download, Duration & 3-Dots Menu */}
                    <div className="flex items-center justify-end gap-2.5 pr-1">
                      {/* Like Button */}
                      {onToggleLike && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleLike(track.id)
                          }}
                          className={cn(
                            'text-xs transition-all p-1 rounded-md hover:bg-hover cursor-pointer',
                            isLiked
                              ? 'text-rose-500'
                              : 'text-text-muted opacity-60 sm:opacity-0 group-hover:opacity-100 hover:text-white'
                          )}
                          title={isLiked ? 'Unlike track' : 'Like track'}
                        >
                          <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
                        </button>
                      )}

                      {/* Download / In Library */}
                      {AppCapabilities.downloads && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isInLibrary && onChooseSourceOrReplace) {
                              onChooseSourceOrReplace(track)
                            } else {
                              onDownloadSong(track)
                            }
                          }}
                          className={cn(
                            'h-7 w-7 flex items-center justify-center rounded-full transition-all cursor-pointer',
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
                        {formatDuration(track.duration)}
                      </span>

                      {/* 3-Dots More Options Menu */}
                      <button
                        type="button"
                        onClick={(e) => handleMenuOpen(e, track, index)}
                        title="More options"
                        className="h-7 w-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
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
            {localTracksForSelectedMix.map((track, index) => {
              const isThisTrack =
                currentTrack?.title.toLowerCase() === track.title.toLowerCase() &&
                (!track.artist || !currentTrack?.artist || currentTrack.artist.toLowerCase() === track.artist.toLowerCase())
              const isCurrentlyPlaying = isThisTrack && isPlaying
              const isLiked = likedSongIds?.has(track.id) || false
              const isInLibrary = true

              const transfer = transfers.find(
                (t) =>
                  t.title.toLowerCase() === track.title.toLowerCase() &&
                  (!track.artist || !t.artist || t.artist.toLowerCase() === track.artist.toLowerCase()) &&
                  (t.status === 'downloading' || t.status === 'queued')
              )
              const isDownloading = Boolean(transfer)

              return (
                <div
                  key={track.id || `${track.title}-${index}`}
                  onClick={() => {
                    if (isThisTrack) {
                      togglePlay()
                    } else if (activeSelectedMix) {
                      onPlayMix(activeSelectedMix, index)
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, track, index)}
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
                        src={track.artworkUrl}
                        title={track.title}
                        artist={track.artist}
                        alt={track.title}
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
                          title={track.title}
                        >
                          {track.title}
                        </p>
                        {track.isExplicit && (
                          <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-bold uppercase text-text-muted">
                            E
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 truncate mt-0.5">
                        <ArtistLinks
                          artist={track.artist}
                          artists={track.artists}
                          linkClassName="text-text-muted hover:text-text hover:underline text-xs truncate"
                        />
                        <QualityPill song={track} />
                      </div>
                    </div>
                  </div>

                  {/* Actions & Meta */}
                  <div className="flex items-center gap-2.5">
                    {onToggleLike && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleLike(track.id)
                        }}
                        className={cn(
                          'text-xs transition-colors p-1 rounded-md hover:bg-hover cursor-pointer',
                          isLiked
                            ? 'text-rose-500'
                            : 'text-text-muted opacity-60 sm:opacity-0 group-hover:opacity-100 hover:text-white'
                        )}
                        title={isLiked ? 'Unlike track' : 'Like track'}
                      >
                        <Heart className={cn('h-4 w-4', isLiked && 'fill-current')} />
                      </button>
                    )}

                    {AppCapabilities.downloads && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isInLibrary && onChooseSourceOrReplace) {
                            onChooseSourceOrReplace(track)
                          } else {
                            onDownloadSong(track)
                          }
                        }}
                        className={cn(
                          'h-7 w-7 flex items-center justify-center rounded-full transition-all cursor-pointer',
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
                      {formatDuration(track.duration)}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => handleMenuOpen(e, track, index)}
                      title="More options"
                      className="h-7 w-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
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
            ref={menuRef}
            className="fixed z-[9999] w-[240px] max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-border bg-surface-elevated p-1.5 shadow-2xl backdrop-blur-md"
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
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold text-primary hover:bg-hover transition-colors cursor-pointer"
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
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
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
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
            >
              <ListPlus className="h-3.5 w-3.5" />
              Add to Queue
            </button>

            <button
              type="button"
              onClick={() => {
                void handleStartSongRadio(activeMenu.song, selectedMix.tracks)
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
            >
              <Radio className="h-3.5 w-3.5 text-text-muted" />
              Start Song Radio
            </button>

            {activeMenu.song.artist && (
              <button
                type="button"
                onClick={() => {
                  void handleStartArtistRadio(activeMenu.song.artist, selectedMix.tracks)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
              >
                <Radio className="h-3.5 w-3.5 text-text-muted" />
                Start Artist Radio
              </button>
            )}

            {activeMenu.song.album && (
              <button
                type="button"
                onClick={(e) => {
                  handleAlbumClick(e, activeMenu.song)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
              >
                <Music2 className="h-3.5 w-3.5" />
                Go to Album
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const s = librarySongs.find(
                  (lib) =>
                    lib.title.toLowerCase() === activeMenu.song.title.toLowerCase() &&
                    (!activeMenu.song.artist || lib.artist.toLowerCase() === activeMenu.song.artist.toLowerCase())
                ) || ({
                  id: activeMenu.song.id,
                  title: activeMenu.song.title,
                  artist: activeMenu.song.artist,
                  album: activeMenu.song.album || '',
                  duration: activeMenu.song.duration,
                  artworkUrl: activeMenu.song.artworkUrl,
                  artworkPath: activeMenu.song.artworkUrl,
                  filePath: activeMenu.song.filePath || `virtual:${activeMenu.song.title}`
                } as Song)
                setCreditsSong(s)
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              Show Credits
            </button>

            {(() => {
              const matchedLib = librarySongs.find(
                (lib) =>
                  lib.title.toLowerCase() === activeMenu.song.title.toLowerCase() &&
                  (!activeMenu.song.artist || lib.artist.toLowerCase() === activeMenu.song.artist.toLowerCase())
              )
              const targetFilePath =
                (matchedLib?.filePath && !matchedLib.filePath.startsWith('virtual:') && matchedLib.filePath) ||
                (activeMenu.song.filePath && !activeMenu.song.filePath.startsWith('virtual:') && activeMenu.song.filePath)
              const hasLocalFile = Boolean(
                targetFilePath &&
                  !targetFilePath.startsWith('http://') &&
                  !targetFilePath.startsWith('https://')
              )
              if (!hasLocalFile || !targetFilePath) return null
              return (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await window.api?.revealInExplorer?.(targetFilePath)
                    } catch (err) {
                      console.error('Failed to open file location:', err)
                    }
                    setActiveMenu(null)
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open file location
                </button>
              )
            })()}

            <button
              type="button"
              onClick={() => handleShareSong(activeMenu.song)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
            >
              <Music2 className="h-3.5 w-3.5" />
              Share Track
            </button>
          </div>
        )}

        <SongCreditsModal
          song={creditsSong}
          isOpen={Boolean(creditsSong)}
          onClose={() => setCreditsSong(null)}
        />
      </section>
    )
  }

  if (visibleMixes.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Made For You
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Personalized playlists based on your listening taste
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshMixes}
          title="Refresh personalized mixes"
          disabled={isLoadingMixes}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white disabled:opacity-50 cursor-pointer"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isLoadingMixes ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visibleMixes.map((mix) => (
          <div
            key={mix.id}
            onClick={() => onSelectMix(mix)}
            className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface-elevated p-4 shadow-sm transition-all duration-200 hover:border-white/20 hover:bg-[#232326] cursor-pointer min-h-[170px]"
          >
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {mix.category === 'repeat' ? 'Heavy Rotation' : 'Daily Mix'}
              </span>
              <h3 className="text-base sm:text-lg font-bold text-text leading-tight mt-1">
                {mix.title}
              </h3>
              <p className="mt-1 text-xs text-text-muted line-clamp-2 leading-relaxed">
                {mix.subtitle}
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border mt-3">
              <span className="text-[11px] font-medium text-text-muted">
                {mix.tracks.length} tracks
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlayMix(mix, 0)
                }}
                title={`Play ${mix.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-primary-foreground shadow-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
