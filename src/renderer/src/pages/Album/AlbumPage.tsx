import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  ListPlus,
  Loader2,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Shuffle,
  User
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlayerStore, type PlaybackContext } from '../../hooks/usePlayerStore'
import { useShallow } from 'zustand/react/shallow'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import { downloadTrackInBackground } from '../../lib/backgroundDownloader'
import type { Song } from '../Library/Library'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import ArtistLinks from '../../components/Common/ArtistLinks'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { parseArtists } from '../../lib/artistParser'

interface AlbumPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

interface AlbumTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: string | null
  thumbnail: string
  localSong?: Song
}

function parseDuration(value: string | null): string {
  return value || '0:00'
}

function normalizeTrack(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunknown\s+artist\b/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official)\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video)\s*$/g,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function AlbumPage({ onOpenDownloadPanel }: AlbumPageProps) {
  const { artist = '', title = '' } = useParams<{ artist: string; title: string }>()
  const albumArtist = decodeURIComponent(artist)
  const albumTitle = decodeURIComponent(title)
  const navigate = useNavigate()
  const [tracks, setTracks] = useState<AlbumTrack[]>([])
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [artwork, setArtwork] = useState('')
  const {
    setQueue,
    enqueueSong,
    togglePlay,
    queue,
    currentSongIndex,
    isPlaying,
    isBuffering,
    isShuffle,
    toggleShuffle,
    playbackContext
  } = usePlayerStore(
    useShallow((s) => ({
      setQueue: s.setQueue,
      enqueueSong: s.enqueueSong,
      togglePlay: s.togglePlay,
      queue: s.queue,
      currentSongIndex: s.currentSongIndex,
      isPlaying: s.isPlaying,
      isBuffering: s.isBuffering,
      isShuffle: s.isShuffle,
      toggleShuffle: s.toggleShuffle,
      playbackContext: s.playbackContext
    }))
  )
  const { transfers } = useDownloadStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloadingAlbum, setIsDownloadingAlbum] = useState(false)
  const [activeMenu, setActiveMenu] = useState<{
    track: AlbumTrack
    song: Song
    x: number
    y: number
  } | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  const albumContext = useMemo<PlaybackContext>(
    () => ({
      type: 'album',
      title: albumTitle,
      subtitle: albumArtist,
      route: `/album/${encodeURIComponent(albumArtist)}/${encodeURIComponent(albumTitle)}`
    }),
    [albumArtist, albumTitle]
  )

  const isAlbumContextPlaying =
    playbackContext?.type === 'album' &&
    playbackContext.title.toLowerCase() === albumTitle.toLowerCase() &&
    playbackContext.subtitle?.toLowerCase() === albumArtist.toLowerCase() &&
    (isPlaying || isBuffering)

  const allAlbumSongs = useMemo<Song[]>(() => {
    return tracks.map((track, idx) => {
      if (track.localSong) {
        return track.localSong
      }
      return {
        id: track.id || `album-${albumArtist}-${albumTitle}-${idx}`,
        title: track.title,
        artist: track.artist,
        album: track.album || albumTitle,
        duration: track.duration
          ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
          : 0,
        artworkUrl: track.thumbnail || artwork,
        filePath: `virtual:${track.title} - ${track.artist || albumArtist}`,
        isOnline: true
      }
    })
  }, [tracks, albumArtist, albumTitle, artwork])

  useEffect(() => {
    const loadLibrarySongs = () =>
      window.api.getSongs().then((songs) => setLibrarySongs(songs || [])).catch(console.error)

    void loadLibrarySongs()
    window.addEventListener('felo:library-updated', loadLibrarySongs)
    return () => window.removeEventListener('felo:library-updated', loadLibrarySongs)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadAlbum = async () => {
      // 1. Dual-source offline-first: immediately populate any existing local tracks
      const localAlbumSongs = librarySongs.filter(
        (song) =>
          song?.title &&
          ((song.album && song.album.toLowerCase() === albumTitle.toLowerCase()) ||
            (!song.album && song.artist?.toLowerCase().includes(albumArtist.toLowerCase())))
      )

      if (localAlbumSongs.length > 0) {
        const localMapped: AlbumTrack[] = localAlbumSongs.map((local) => ({
          id: String(local.id),
          title: local.title,
          artist: local.artist || albumArtist,
          album: local.album || albumTitle,
          duration: local.duration
            ? `${Math.floor(local.duration / 60)}:${String(local.duration % 60).padStart(2, '0')}`
            : null,
          thumbnail: toMediaUrl(local.artworkPath) || '',
          localSong: local
        }))
        if (!cancelled) {
          setTracks(localMapped)
          const firstArt = localMapped.find((s) => s.thumbnail)?.thumbnail
          if (firstArt) setArtwork(firstArt)
          setLoading(false)
        }
      } else {
        setLoading(true)
      }

      setError('')
      try {
        const results = await window.api.searchAppleMusic(`${albumArtist} ${albumTitle}`)
        const songs = (results?.Songs || []) as any[]
        const matching = songs.filter(
          (song) =>
            song?.title &&
            (!song.album || song.album.toLowerCase() === albumTitle.toLowerCase()) &&
            (!song.artist || song.artist.toLowerCase().includes(albumArtist.toLowerCase()))
        )
        const selected = matching.length ? matching : songs.filter((song) =>
          song?.artist?.toLowerCase().includes(albumArtist.toLowerCase())
        )

        if (selected.length > 0) {
          const exactMatches = new Map(
            librarySongs.map((local) => [
              `${normalizeTrack(local.title)}::${normalizeTrack(local.artist || '')}`,
              local
            ])
          )
          const titleMatches = new Map<string, Song>()
          librarySongs.forEach((local) => {
            const key = normalizeTrack(local.title)
            if (!titleMatches.has(key)) titleMatches.set(key, local)
          })
          const mapped = selected.map((song) => {
            const localSong =
              exactMatches.get(`${normalizeTrack(String(song.title))}::${normalizeTrack(String(song.artist || ''))}`) ||
              titleMatches.get(normalizeTrack(String(song.title)))
            return {
              id: String(localSong?.id || song.id || `${song.title}-${song.artist}`),
              title: String(song.title),
              artist: String(song.artist || localSong?.artist || albumArtist),
              album: String(song.album || localSong?.album || albumTitle),
              duration: song.duration || (localSong?.duration ? `${Math.floor(localSong.duration / 60)}:${String(localSong.duration % 60).padStart(2, '0')}` : null),
              thumbnail: String(song.thumbnail || toMediaUrl(localSong?.artworkPath) || ''),
              localSong
            }
          })
          if (!cancelled) {
            setTracks(mapped)
            setArtwork(mapped.find((song) => song.thumbnail)?.thumbnail || '')
          }
        }
      } catch (err) {
        if (!cancelled && localAlbumSongs.length === 0) {
          setError(err instanceof Error ? err.message : 'Could not load album tracks.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadAlbum()
    return () => {
      cancelled = true
    }
  }, [albumArtist, albumTitle, librarySongs])

  const saveOnlineAlbum = async () => {
    if (!tracks.length || isSaving) return
    setIsSaving(true)
    setSaveMessage('')
    try {
      const playlist = await window.api.createPlaylist({
        name: albumTitle,
        description: `Online album • ${albumArtist}`,
        tracks: tracks.map((track) => ({
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration
            ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
            : 0,
          coverArt: track.thumbnail || artwork
        }))
      })
      if (playlist?.id) navigate(`/playlists/${playlist.id}`)
      else setSaveMessage('Album saved to your local playlists.')
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Could not save this album.')
    } finally {
      setIsSaving(false)
    }
  }


  const handlePlayTrack = (track: AlbumTrack, index: number) => {
    if (allAlbumSongs.length === 0) return

    const currentTrack = queue[currentSongIndex]
    const isCurrentPlaying =
      isPlaying &&
      currentTrack &&
      ((track.localSong && currentTrack.id === track.localSong.id) ||
        (currentTrack.title.toLowerCase() === track.title.toLowerCase() &&
          currentTrack.artist.toLowerCase() === track.artist.toLowerCase()))

    if (isCurrentPlaying) {
      togglePlay()
      return
    }

    // Same-context stability: if this album is already playing, jump to the track in queue
    // to preserve shuffle order and playback history
    const isSameAlbumContext =
      playbackContext?.type === 'album' &&
      playbackContext.title.toLowerCase() === albumTitle.toLowerCase() &&
      playbackContext.subtitle?.toLowerCase() === albumArtist.toLowerCase()

    if (isSameAlbumContext) {
      const existingQueueIndex = queue.findIndex(
        (item) =>
          item.id === (track.localSong?.id || track.id) ||
          (item.title.toLowerCase() === track.title.toLowerCase() &&
            item.artist.toLowerCase() === track.artist.toLowerCase())
      )
      if (existingQueueIndex >= 0) {
        usePlayerStore.getState().playSong(existingQueueIndex)
        return
      }
    }

    // Set the entire album into the player queue with Spotify-standard scoped context!
    setQueue(allAlbumSongs, index, albumContext)
  }

  const handlePlayAlbum = () => {
    if (allAlbumSongs.length === 0) return
    if (isAlbumContextPlaying) {
      togglePlay()
      return
    }
    handlePlayTrack(tracks[0], 0)
  }

  const handleShuffleAlbum = () => {
    if (allAlbumSongs.length === 0) return
    if (!isShuffle) toggleShuffle()
    const randomIndex = Math.floor(Math.random() * allAlbumSongs.length)
    handlePlayTrack(tracks[randomIndex], randomIndex)
  }

  const missingTracks = useMemo(() => tracks.filter((t) => !t.localSong), [tracks])

  const albumActiveTransfers = useMemo(() => {
    return transfers.filter(
      (t) =>
        (t.status === 'downloading' || t.status === 'queued' || t.status === 'waiting_connector') &&
        missingTracks.some(
          (track) =>
            t.title.toLowerCase() === track.title.toLowerCase() &&
            (!track.artist || !t.artist || t.artist.toLowerCase() === track.artist.toLowerCase())
        )
    )
  }, [missingTracks, transfers])

  const abortAlbumDownloadRef = useRef(false)

  useEffect(() => {
    return () => {
      abortAlbumDownloadRef.current = true
    }
  }, [])

  const handleDownloadAlbum = async () => {
    if (isDownloadingAlbum || albumActiveTransfers.length > 0) {
      abortAlbumDownloadRef.current = true
      setIsDownloadingAlbum(false)
      for (const t of albumActiveTransfers) {
        try {
          await window.api?.cancelDownload?.(t.id)
        } catch {}
        useDownloadStore.getState().removeTransfer(t.id)
      }
      return
    }
    if (tracks.length === 0 || missingTracks.length === 0) return

    abortAlbumDownloadRef.current = false
    setIsDownloadingAlbum(true)

    try {
      for (const track of missingTracks) {
        if (abortAlbumDownloadRef.current) break
        const parsedSec = track.duration
          ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
          : 0
        await downloadTrackInBackground(
          {
            id: track.id,
            title: track.title,
            artist: track.artist || albumArtist,
            album: track.album || albumTitle,
            duration: parsedSec,
            artworkUrl: track.thumbnail || artwork
          },
          { openDrawer: false }
        )
      }
    } finally {
      setIsDownloadingAlbum(false)
    }
  }

  const handleDownloadTrack = (track: AlbumTrack) => {
    const activeTransfer = transfers.find(
      (t) =>
        t.title.toLowerCase() === track.title.toLowerCase() &&
        (!track.artist || !t.artist || t.artist.toLowerCase() === track.artist.toLowerCase()) &&
        (t.status === 'downloading' || t.status === 'queued' || t.status === 'waiting_connector')
    )
    if (activeTransfer) {
      useDownloadStore.getState().setTransfersOpen(true)
      return
    }

    if (track.localSong) {
      onOpenDownloadPanel?.({
        id: track.localSong.id,
        title: track.localSong.title,
        artist: track.localSong.artist,
        album: track.localSong.album || '',
        duration: track.localSong.duration || 0,
        filePath: track.localSong.filePath,
        artworkPath: track.localSong.artworkPath,
        size: track.localSong.size,
        sampleRate: track.localSong.sampleRate,
        isOnline: false,
        autoDownload: false
      })
      return
    }

    const parsedSec = track.duration
      ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
      : 0

    void downloadTrackInBackground(
      {
        id: track.id,
        title: track.title,
        artist: track.artist || albumArtist,
        album: track.album || albumTitle,
        duration: parsedSec,
        artworkUrl: track.thumbnail || artwork
      },
      { openDrawer: true }
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-[#121212] px-8 py-8 text-white">
      <div className="flex items-end gap-6 border-b border-white/10 pb-8">
        <div className="flex h-48 w-48 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#282828]">
          {artwork ? <img src={artwork} alt="" className="h-full w-full object-cover" /> : <Music2 className="h-16 w-16 text-[#777]" />}
        </div>
        <div>
          <p className="text-sm font-bold uppercase text-[#b3b3b3]">Album</p>
          <h1 className="mt-2 text-5xl font-black">{albumTitle}</h1>
          <div className="mt-3 text-lg text-[#b3b3b3]">
            <ArtistLinks
              artist={albumArtist}
              linkClassName="text-white/80 hover:text-white hover:underline text-lg font-medium"
              separatorClassName="text-[#b3b3b3]/60"
            />
          </div>
          <p className="mt-2 text-sm text-[#777]">{tracks.length} tracks</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePlayAlbum}
              disabled={loading || tracks.length === 0}
              className="flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition-transform hover:scale-105 hover:bg-white/90 active:scale-95 disabled:opacity-50 cursor-pointer shadow-lg"
            >
              {isAlbumContextPlaying && isBuffering ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Buffering...
                </>
              ) : isAlbumContextPlaying ? (
                <>
                  <Pause className="h-5 w-5 fill-current" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 fill-current" /> Play Album
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleShuffleAlbum}
              disabled={loading || tracks.length === 0}
              className={`flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-bold transition-all hover:scale-105 cursor-pointer ${
                isShuffle
                  ? 'border-white bg-white/10 text-white'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
              }`}
              title="Shuffle Album"
            >
              <Shuffle className="h-4 w-4" /> Shuffle
            </button>
            {tracks.length > 0 && missingTracks.length === 0 ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-bold text-emerald-400 opacity-90 cursor-default"
                title="All album tracks are already in your library"
              >
                <CheckCircle2 className="h-4 w-4" /> In Library
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleDownloadAlbum()}
                disabled={loading || tracks.length === 0}
                className={`flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-bold transition-all hover:scale-105 cursor-pointer ${
                  isDownloadingAlbum || albumActiveTransfers.length > 0
                    ? 'border-primary-amber bg-primary-amber/10 text-primary-amber hover:bg-primary-amber/20'
                    : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                } disabled:opacity-50`}
                title={
                  isDownloadingAlbum || albumActiveTransfers.length > 0
                    ? 'Click to stop downloading missing tracks'
                    : `Download all ${missingTracks.length} missing tracks to library`
                }
              >
                {isDownloadingAlbum || albumActiveTransfers.length > 0 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Downloading missing ({albumActiveTransfers.length || missingTracks.length})... (Click to stop)
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" /> Download Album ({missingTracks.length})
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveOnlineAlbum()}
              disabled={isSaving || !tracks.length}
              className="rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-all hover:bg-white/10 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save as Playlist'}
            </button>
          </div>
          {saveMessage && <p className="mt-3 text-xs text-[#b3b3b3]">{saveMessage}</p>}
        </div>
      </div>

      {loading && <div className="py-12 text-center text-[#b3b3b3]">Loading album tracks...</div>}
      {!loading && error && <div className="py-12 text-center text-red-300">{error}</div>}
      {!loading && !error && !tracks.length && (
        <div className="py-12 text-center text-[#b3b3b3]">No tracks found for this album.</div>
      )}
      {!loading && !error && tracks.length > 0 && (
        <div className="mt-6 flex flex-col">
          {tracks.map((track, index) => {
            const currentQueueSong = queue[currentSongIndex]
            const isCurrent =
              Boolean(currentQueueSong) &&
              ((track.localSong && currentQueueSong?.id === track.localSong.id) ||
                (currentQueueSong?.title?.toLowerCase() === track.title.toLowerCase() &&
                  currentQueueSong?.artist?.toLowerCase() === track.artist.toLowerCase()))
            const isTrackPlaying = isCurrent && isPlaying
            const transfer = transfers.find(
              (t) =>
                t.title.toLowerCase() === track.title.toLowerCase() &&
                (!track.artist || !t.artist || t.artist.toLowerCase() === track.artist.toLowerCase()) &&
                (t.status === 'downloading' || t.status === 'queued')
            )
            const isDownloading = Boolean(transfer)

            return (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                onClick={() => handlePlayTrack(track, index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handlePlayTrack(track, index)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const song: Song = track.localSong || {
                    id: track.id || `album-${albumArtist}-${albumTitle}-${index}`,
                    title: track.title,
                    artist: track.artist,
                    album: track.album || albumTitle,
                    duration: track.duration
                      ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
                      : 0,
                    artworkUrl: track.thumbnail || artwork,
                    filePath: `virtual:${track.title} - ${track.artist || albumArtist}`,
                    isOnline: true
                  }
                  const menuWidth = 220
                  const menuHeight = 220
                  setActiveMenu({
                    track,
                    song,
                    x: Math.min(e.clientX, window.innerWidth - menuWidth - 12),
                    y: Math.min(e.clientY, window.innerHeight - menuHeight - 12)
                  })
                }}
                className="group grid h-16 grid-cols-[40px_48px_minmax(0,1fr)_120px] items-center gap-3 rounded-md px-3 text-left hover:bg-white/10 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-center">
                  <span className={`text-center text-[#b3b3b3] group-hover:hidden ${isTrackPlaying || (isCurrent && isBuffering) ? 'hidden' : ''}`}>
                    {index + 1}
                  </span>
                  {isCurrent && isBuffering ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary-amber" />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handlePlayTrack(track, index)
                      }}
                      title={isTrackPlaying ? 'Pause' : 'Play'}
                      className={`items-center justify-center ${isTrackPlaying ? 'flex' : 'hidden group-hover:flex'}`}
                    >
                      {isTrackPlaying ? (
                        <Pause className="h-4 w-4 fill-white text-white" />
                      ) : (
                        <Play className="h-4 w-4 fill-white text-white" />
                      )}
                    </button>
                  )}
                </div>

                <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-[#282828] shrink-0">
                  {track.thumbnail ? (
                    <img src={track.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Music2 className="h-5 w-5 text-[#777]" />
                  )}
                </span>

                <span className="min-w-0">
                  <span className="flex items-center gap-2 truncate font-bold">
                    <span className={`truncate ${isCurrent ? 'text-primary-amber' : 'text-white'}`}>{track.title}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        track.localSong ? 'bg-surface-elevated text-text-muted border border-border/60' : 'bg-white/5 text-[#a7a7a7]'
                      }`}
                    >
                      {track.localSong ? 'In Library' : 'Online'}
                    </span>
                  </span>
                  <div className="block truncate text-sm text-[#a7a7a7]">
                    <ArtistLinks
                      artist={track.artist}
                      artists={track.localSong?.artists}
                      linkClassName="text-[#a7a7a7] hover:text-white hover:underline text-sm"
                    />
                  </div>
                </span>

                <div className="flex items-center justify-end gap-2 text-sm text-[#a7a7a7]">
                  <span>{parseDuration(track.duration)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDownloadTrack(track)
                    }}
                    title={
                      isDownloading
                        ? `Downloading (${transfer?.progress || 0}%) - click to view in Transfers`
                        : track.localSong
                          ? 'In your library (Click to choose source or replace)'
                          : 'Download track to library'
                    }
                    className={`h-7 w-7 flex items-center justify-center rounded-full transition-all ${
                      isDownloading
                        ? 'text-primary-amber'
                        : track.localSong
                          ? 'text-text-muted hover:text-white hover:bg-white/10'
                          : 'opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : track.localSong ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const song: Song = track.localSong || {
                        id: track.id || `album-${albumArtist}-${albumTitle}-${index}`,
                        title: track.title,
                        artist: track.artist,
                        album: track.album || albumTitle,
                        duration: track.duration
                          ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
                          : 0,
                        artworkUrl: track.thumbnail || artwork,
                        filePath: `virtual:${track.title} - ${track.artist || albumArtist}`,
                        isOnline: true
                      }
                      const rect = e.currentTarget.getBoundingClientRect()
                      const menuWidth = 220
                      const menuHeight = 220
                      setActiveMenu((curr) =>
                        curr?.track.id === track.id
                          ? null
                          : {
                              track,
                              song,
                              x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
                              y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
                            }
                      )
                    }}
                    title="More options"
                    className={`h-7 w-7 flex items-center justify-center rounded-full transition-all ${
                      activeMenu?.track.id === track.id
                        ? 'text-primary-amber bg-white/10 opacity-100'
                        : 'opacity-0 group-hover:opacity-100 text-[#b3b3b3] hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeMenu &&
        createPortal(
          <div
            className="fixed z-[9999] w-[220px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)]"
            style={{ left: activeMenu.x, top: activeMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const trackIdx = tracks.findIndex((t) => t.id === activeMenu.track.id)
                handlePlayTrack(activeMenu.track, trackIdx >= 0 ? trackIdx : 0)
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
                enqueueSong(activeMenu.song)
                setActiveMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <ListPlus className="h-4 w-4" />
              Add to Queue
            </button>
            {(() => {
              const menuArtists =
                activeMenu.song.artists && activeMenu.song.artists.length > 0
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
                    className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                  >
                    <User className="h-4 w-4" />
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
                    className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                  >
                    <div className="flex items-center gap-3">
                      <User className="h-4 w-4" />
                      <span>Go to Artist</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-muted/60 transition-transform group-hover/artist-sub:translate-x-0.5" />
                  </button>
                  <div
                    className={`absolute ${
                      isNearRightEdge ? 'right-full mr-1' : 'left-full ml-1'
                    } ${
                      isNearBottomEdge ? 'bottom-0' : 'top-0'
                    } hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1.5 shadow-2xl backdrop-blur-md z-50`}
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
                        className="flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors"
                      >
                        <span className="truncate pr-2">{a.name}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/5 text-text-muted/70">
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
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <FileText className="h-4 w-4" />
              Show Credits
            </button>
            {!activeMenu.track.localSong && (
              <button
                type="button"
                onClick={() => {
                  handleDownloadTrack(activeMenu.track)
                  setActiveMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
              >
                <Download className="h-4 w-4" />
                Download to library
              </button>
            )}
          </div>,
          document.body
        )}

      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </div>
  )
}
