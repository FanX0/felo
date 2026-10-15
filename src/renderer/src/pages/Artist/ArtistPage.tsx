import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Disc3,
  Download,
  FileText,
  Globe2,
  Laptop2,
  ListPlus,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Pause,
  Play,
  Radio,
  Shuffle,
  User
} from 'lucide-react'
import { Song } from '../Library/Library'
import { toMediaUrl } from '../../lib/media'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useShallow } from 'zustand/react/shallow'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import ArtistLinks from '../../components/Common/ArtistLinks'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { PersonalizationService } from '../../services/PersonalizationService'
import { parseArtists } from '../../lib/artistParser'
import { ArtworkImage } from '../Home/components/ArtworkImage'
import { AppCapabilities } from '../../lib/appConfig'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'

type ArtistPageTrack = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artworkUrl: string
  isLocal: boolean
  source?: ArtistSource
  localSong?: Song
  url?: string
}

type ArtistSource = 'library' | 'apple_music' | 'lastfm' | 'musicbrainz'

interface ArtistPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

function normalizeArtistName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTrackTitle(value: string): string {
  return normalizeArtistName(value)
    .replace(/\bunknown\s+artist\b/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official)\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video)\s*$/g,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function splitArtistNames(value: string): string[] {
  return value
    .replace(/\b(feat|ft|featuring)\.?\b/gi, ',')
    .split(/,|&|\+| x | × | and /i)
    .map(normalizeArtistName)
    .filter(Boolean)
}

function artistNameMatches(candidate: string, target: string): boolean {
  const candidateNames = splitArtistNames(candidate)
  const targetNames = splitArtistNames(target)
  if (!candidateNames.length || !targetNames.length) return false

  return candidateNames.some((candidateName) =>
    targetNames.some(
      (targetName) =>
        candidateName === targetName ||
        candidateName.includes(targetName) ||
        targetName.includes(candidateName)
    )
  )
}

function parseDuration(duration: string | null | undefined): number {
  if (!duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function isLeadTrackForArtist(track: ArtistPageTrack, targetArtist: string): boolean {
  const targetNorm = normalizeArtistName(targetArtist)
  const targetLower = targetArtist.trim().toLowerCase()
  const localArtists = track.localSong?.artists

  if (localArtists && localArtists.length > 0) {
    const matchIndex = localArtists.findIndex(
      (a) => a.name.toLowerCase() === targetLower || normalizeArtistName(a.name) === targetNorm
    )
    if (matchIndex === 0 && localArtists[0].role !== 'featured') {
      return true
    }
    if (matchIndex >= 0) {
      return false
    }
  }

  const rawArtist = (track.localSong?.artist || track.artist || '').trim()
  const rawSplit = splitArtistNames(rawArtist)
  if (rawSplit.length > 0 && rawSplit[0] === targetNorm) {
    return true
  }

  return false
}

export default function ArtistPage({ onOpenDownloadPanel }: ArtistPageProps) {
  const navigate = useNavigate()
  const { name } = useParams<{ name: string }>()
  const decodedName = name ? decodeURIComponent(name) : 'Unknown Artist'
  const [songs, setSongs] = useState<Song[]>([])
  const [onlineTracks, setOnlineTracks] = useState<ArtistPageTrack[]>([])
  const [artistSource, setArtistSource] = useState<ArtistSource>('library')
  const [isOnlineLoading, setIsOnlineLoading] = useState(false)
  const [onlineError, setOnlineError] = useState('')
  const [isFollowing, setIsFollowing] = useState(false)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const [activeMenu, setActiveMenu] = useState<{
    song: ArtistPageTrack
    x: number
    y: number
    flyoutArtist: boolean
  } | null>(null)
  const {
    togglePlay,
    enqueueSong,
    queue,
    currentSongIndex,
    isPlaying,
    isShuffle,
    toggleShuffle,
    playbackContext
  } = usePlayerStore(
    useShallow((s) => ({
      togglePlay: s.togglePlay,
      enqueueSong: s.enqueueSong,
      queue: s.queue,
      currentSongIndex: s.currentSongIndex,
      isPlaying: s.isPlaying,
      isShuffle: s.isShuffle,
      toggleShuffle: s.toggleShuffle,
      playbackContext: s.playbackContext
    }))
  )
  const { transfers } = useDownloadStore()
  const { requestPlayQueue } = usePlaybackArbitration()

  const [isRemoteConnected, setIsRemoteConnected] = useState(remoteClient.getIsConnected())

  useEffect(() => {
    return remoteClient.subscribeConnection(setIsRemoteConnected)
  }, [])

  useEffect(() => {
    let mounted = true
    const loadSongs = async () => {
      try {
        let data = (await window.api?.getSongs?.()) || []
        const hasArtistSongs = data.some((song) => {
          if (
            song.artists?.some(
              (a) =>
                a.name.toLowerCase() === decodedName.toLowerCase() ||
                normalizeArtistName(a.name) === normalizeArtistName(decodedName)
            )
          ) {
            return true
          }
          return artistNameMatches(song.artist || '', decodedName)
        })

        if (!hasArtistSongs && remoteClient.getIsConnected()) {
          const remoteTracks = await remoteLibraryService.getArtistTracks(decodedName)
          if (remoteTracks && remoteTracks.length > 0) {
            const mappedRemote: Song[] = remoteTracks.map((r) => ({
              id: r.id,
              title: r.title,
              artist: r.artist || decodedName,
              album: r.album || '',
              duration: r.duration || 0,
              filePath: remoteClient.getAudioStreamUrl(r.id),
              artworkPath: r.artworkUrl || '',
              artworkUrl: r.artworkUrl || '',
              codec: r.codec || 'mp3',
              bitrate: r.bitrate,
              sampleRate: r.sampleRate,
              createdAt: Date.now()
            }))
            data = [...data, ...mappedRemote]
          }
        } else if (!hasArtistSongs && !remoteClient.getIsConnected()) {
          const remotePlayback = useConnectedDeviceStore.getState().activePlayback
          const s = remotePlayback?.song
          if (s && artistNameMatches(s.artist || '', decodedName)) {
            const mappedRemote: Song = {
              id: s.id,
              title: s.title,
              artist: s.artist || decodedName,
              album: s.album || '',
              duration: s.duration || 0,
              filePath: `virtual:${s.title} - ${s.artist}`,
              artworkPath: s.artworkUrl || toMediaUrl(s.artworkPath) || '',
              artworkUrl: s.artworkUrl || toMediaUrl(s.artworkPath) || '',
              isOnline: true
            }
            data = [...data, mappedRemote]
          }
        }
        if (mounted) setSongs(data)
      } catch (err) {
        console.error('Failed to load artist songs:', err)
      }
    }

    void loadSongs()
    window.addEventListener('felo:library-updated', loadSongs)
    return () => {
      mounted = false
      window.removeEventListener('felo:library-updated', loadSongs)
    }
  }, [decodedName, isRemoteConnected])

  useEffect(() => {
    if (!AppCapabilities.onlineSearch || artistSource === 'library') {
      setOnlineTracks([])
      setOnlineError('')
      setIsOnlineLoading(false)
      return
    }

    let cancelled = false
    const loadOnlineTracks = async () => {
      setIsOnlineLoading(true)
      setOnlineError('')
      try {
        let rawTracks: any[] = []
        if (artistSource === 'apple_music') {
          rawTracks = (await window.api?.searchAppleMusicArtistSongs?.(decodedName)) || []
        } else {
          const results = artistSource === 'lastfm'
            ? await window.api?.searchLastFm?.(decodedName)
            : await window.api?.searchMusicBrainz?.(decodedName)
          rawTracks = results?.Songs || []
        }
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        const fetchedTracks: ArtistPageTrack[] = rawTracks
          .filter((item: any) => item?.title && artistNameMatches(item.artist || '', decodedName))
          .map((item: any) => {
            const title = String(item.title)
            const artist = String(item.artist || decodedName)
            const localSong = songs.find(
              (candidate) =>
                normalize(candidate.title || '') === normalize(title) &&
                (normalize(candidate.artist || '') === normalize(artist) ||
                  normalize(candidate.artist || '') === normalize(decodedName))
            )
            return {
              id: localSong?.id || `${artistSource}-${item.id || item.title}`,
              title,
              artist,
              album: item.album || localSong?.album || '',
              duration: parseDuration(item.duration) || localSong?.duration || 0,
              artworkUrl: item.thumbnail || toMediaUrl(localSong?.artworkPath) || localSong?.artworkUrl || '',
              isLocal: Boolean(localSong),
              source: artistSource,
              localSong,
              url: item.url || ''
            }
          })
        if (artistSource !== 'apple_music' && fetchedTracks.length) {
          try {
            const artworkTracks = (await window.api?.searchAppleMusicArtistSongs?.(decodedName)) || []
            const artworkByTitle = new Map<string, string>()
            artworkTracks.forEach((item: any) => {
              if (item?.title && item?.thumbnail) {
                artworkByTitle.set(normalizeArtistName(item.title), item.thumbnail)
              }
            })
            fetchedTracks.forEach((track) => {
              if (!track.artworkUrl || track.artworkUrl.includes('last.fm')) {
                const fallbackArtwork = artworkByTitle.get(normalizeArtistName(track.title))
                if (fallbackArtwork && typeof fallbackArtwork === 'string') {
                  track.artworkUrl = fallbackArtwork
                }
              }
            })
          } catch (error) {
            console.warn('Artist artwork fallback failed:', error)
          }
        }

        const seen = new Set<string>()
        const uniqueTracks = fetchedTracks.filter((track) => {
          const key = `${normalizeArtistName(track.title)}::${normalizeArtistName(track.artist)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        if (!cancelled) setOnlineTracks(uniqueTracks)
      } catch (err) {
        console.warn(`Failed to fetch ${artistSource} artist tracks:`, err)
        if (!cancelled) {
          setOnlineTracks([])
          setOnlineError(err instanceof Error ? err.message : 'Could not load artist tracks.')
        }
      } finally {
        if (!cancelled) setIsOnlineLoading(false)
      }
    }
    void loadOnlineTracks()
    return () => {
      cancelled = true
    }
  }, [artistSource, decodedName])

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  const artistSongs = useMemo(() => {
    const targetNorm = normalizeArtistName(decodedName)
    return songs.filter((song) => {
      if (
        song.artists?.some(
          (a) =>
            a.name.toLowerCase() === decodedName.toLowerCase() ||
            normalizeArtistName(a.name) === targetNorm
        )
      ) {
        return true
      }
      return artistNameMatches(song.artist || '', decodedName)
    })
  }, [decodedName, songs])

  const currentSong = queue[currentSongIndex]
  const isCurrentArtistPlaying =
    isPlaying &&
    Boolean(
      currentSong &&
        (currentSong.artists?.some(
          (a) =>
            a.name.toLowerCase() === decodedName.toLowerCase() ||
            normalizeArtistName(a.name) === normalizeArtistName(decodedName)
        ) ||
          artistNameMatches(currentSong.artist || '', decodedName))
    )

  const artistTracks = useMemo<ArtistPageTrack[]>(() => {
    const localTracks = artistSongs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      duration: song.duration || 0,
      artworkUrl: toMediaUrl(song.artworkPath) || song.artworkUrl || '',
      isLocal: true,
      localSong: song
    }))
    if (artistSource === 'library') return localTracks

    return onlineTracks.map((track) => {
      const localSong = artistSongs.find(
        (candidate) =>
          normalizeTrackTitle(candidate.title || '') === normalizeTrackTitle(track.title) &&
          artistNameMatches(candidate.artist || '', track.artist)
      )
      return localSong
        ? { ...track, isLocal: true, localSong }
        : track
    })
  }, [artistSongs, artistSource, onlineTracks])

  const currentSongArtwork =
    currentSong && artistNameMatches(currentSong.artist || '', decodedName)
      ? toMediaUrl(currentSong.artworkPath) || currentSong.artworkUrl || ''
      : ''
  const heroArtworkUrl =
    artistTracks.find((track) => track.artworkUrl)?.artworkUrl || currentSongArtwork || ''
  const { primaryTracks, appearsOnTracks } = useMemo(() => {
    const primary: ArtistPageTrack[] = []
    const appearsOn: ArtistPageTrack[] = []

    for (const track of artistTracks) {
      if (isLeadTrackForArtist(track, decodedName)) {
        primary.push(track)
      } else {
        appearsOn.push(track)
      }
    }

    return { primaryTracks: primary, appearsOnTracks: appearsOn }
  }, [artistTracks, decodedName])

  const artistPick = primaryTracks[0] || artistTracks[0]
  const visibleSongs = artistTracks

  const allArtistSongs = useMemo<Song[]>(() => {
    return artistTracks.map((track, idx) => {
      if (track.localSong) return track.localSong
      return {
        id: track.id || `artist-${decodedName}-${idx}`,
        title: track.title,
        artist: track.artist || decodedName,
        album: track.album || '',
        duration: track.duration || 0,
        artworkUrl: track.artworkUrl,
        filePath: `virtual:${track.title} - ${track.artist || decodedName}`,
        isOnline: true
      }
    })
  }, [artistTracks, decodedName])

  const handlePlayAll = () => {
    if (!allArtistSongs.length) return

    if (artistNameMatches(currentSong?.artist || '', decodedName) && isPlaying) {
      togglePlay()
      return
    }

    const artistContext = {
      type: 'artist' as const,
      title: decodedName,
      route: `/artist/${encodeURIComponent(decodedName)}`
    }

    requestPlayQueue(allArtistSongs, 0, artistContext)
    if (!artistTracks[0]?.localSong) {
      usePlayerStore.getState().setIsBuffering(true)
    }
  }

  const handleShufflePlay = () => {
    if (allArtistSongs.length === 0) return

    const artistContext = {
      type: 'artist' as const,
      title: decodedName,
      route: `/artist/${encodeURIComponent(decodedName)}`
    }

    if (!isShuffle) toggleShuffle()
    const randomIndex = Math.floor(Math.random() * allArtistSongs.length)
    requestPlayQueue(allArtistSongs, randomIndex, artistContext)
    if (!artistTracks[randomIndex]?.localSong) {
      usePlayerStore.getState().setIsBuffering(true)
    }
  }

  const [isGeneratingRadio, setIsGeneratingRadio] = useState(false)

  const handleStartArtistRadio = async () => {
    if (!decodedName || isGeneratingRadio) return
    setIsGeneratingRadio(true)
    try {
      let localSongs: Song[] = []
      if (window.api?.getSongs) {
        localSongs = (await window.api.getSongs()) || []
      }
      const radioStation = await PersonalizationService.generateRadioStation(
        {
          artist: decodedName,
          artworkUrl: heroArtworkUrl || undefined
        },
        localSongs
      )
      if (radioStation.length > 0) {
        requestPlayQueue(radioStation, 0, {
          type: 'radio' as const,
          title: `${decodedName} Radio`,
          route: `/artist/${encodeURIComponent(decodedName)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start artist radio:', err)
    } finally {
      setIsGeneratingRadio(false)
    }
  }

  const handlePlayTrack = (track: ArtistPageTrack) => {
    if (!track || allArtistSongs.length === 0) return

    const trackIndex = artistTracks.findIndex(
      (t) =>
        t.id === track.id ||
        (normalizeTrackTitle(t.title) === normalizeTrackTitle(track.title) &&
          artistNameMatches(t.artist, track.artist))
    )
    const effectiveIndex = trackIndex >= 0 ? trackIndex : 0

    if (track.localSong && currentSong?.id === track.localSong.id) {
      togglePlay()
      return
    }

    // Same-context stability: if this artist page is already playing, jump to the track in queue
    // to preserve shuffle order and playback history
    const isSameArtistContext =
      playbackContext?.type === 'artist' &&
      playbackContext.title.toLowerCase() === decodedName.toLowerCase()

    if (isSameArtistContext) {
      const existingQueueIndex = queue.findIndex(
        (item) =>
          item.id === (track.localSong?.id || track.id) ||
          (normalizeTrackTitle(item.title) === normalizeTrackTitle(track.title) &&
            artistNameMatches(item.artist, track.artist))
      )
      if (existingQueueIndex >= 0) {
        usePlayerStore.getState().playSong(existingQueueIndex)
        return
      }
    }

    const artistContext = {
      type: 'artist' as const,
      title: decodedName,
      route: `/artist/${encodeURIComponent(decodedName)}`
    }

    requestPlayQueue(allArtistSongs, effectiveIndex, artistContext)
  }

  const handleDownloadTrack = (track: ArtistPageTrack) => {
    if (!track) return

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
        autoDownload: false,
        autoPlay: false
      })
      return
    }

    onOpenDownloadPanel?.({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      filePath: '',
      artworkUrl: track.artworkUrl,
      isOnline: true,
      autoDownload: true,
      autoPlay: false
    })
  }

  const handlePlaySong = (index: number) => {
    const track = artistTracks[index]
    if (track) handlePlayTrack(track)
  }

  const formatDuration = (seconds: number) => {
    if (!seconds || Number.isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatPlays = (index: number) => ((index + 1) * 78201948 + 1248021).toLocaleString()

  const renderTrackRow = (song: ArtistPageTrack, displayIndex: number) => {
    const isCurrent = currentSong?.id === song.localSong?.id
    const artworkUrl = song.artworkUrl
    const transfer = transfers.find(
      (t) =>
        t.title.toLowerCase() === song.title.toLowerCase() &&
        (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
        (t.status === 'downloading' || t.status === 'queued')
    )
    const isDownloading = Boolean(transfer)

    return (
      <button
        key={song.id}
        type="button"
        onClick={() => handlePlayTrack(song)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setActiveMenu({
            song,
            x: Math.min(e.clientX, window.innerWidth - 232),
            y: Math.min(e.clientY, window.innerHeight - 260),
            flyoutArtist: false
          })
        }}
        className={`group grid h-[58px] grid-cols-[32px_44px_minmax(0,1fr)_76px] md:grid-cols-[36px_48px_minmax(180px,1fr)_minmax(110px,0.7fr)_138px] items-center gap-2 sm:gap-3 rounded px-2 sm:px-3 text-left transition-colors hover:bg-white/10 ${
          isCurrent ? 'bg-white/15' : ''
        }`}
      >
        <span
          onClick={(event) => {
            event.stopPropagation()
            handlePlayTrack(song)
          }}
          className="relative flex h-5 items-center justify-center text-[16px] font-bold text-[#b3b3b3]"
        >
          <span
            className={`transition-opacity ${
              isCurrent ? 'text-primary-amber' : 'group-hover:opacity-0'
            }`}
          >
            {displayIndex + 1}
          </span>
          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            {isCurrent && isPlaying ? (
              <Pause className="h-4 w-4 fill-current text-white" />
            ) : (
              <Play className="h-4 w-4 fill-current text-white" />
            )}
          </span>
        </span>

        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828] text-[#777]">
          <ArtworkImage
            src={artworkUrl}
            title={song.title}
            artist={song.artist}
            className="h-full w-full object-cover"
            fallbackIcon={<Music2 className="h-5 w-5 text-[#777]" />}
          />
        </span>

        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={`truncate text-[16px] font-bold ${
                isCurrent ? 'text-primary-amber' : 'text-white'
              }`}
            >
              {song.title}
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                song.isLocal
                  ? 'bg-surface-elevated text-text-muted border border-border/60'
                  : 'bg-white/10 text-[#a7a7a7]'
              }`}
            >
              {song.isLocal ? 'In Library' : 'Online'}
            </span>
          </span>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-[#a7a7a7]">
            <ArtistLinks
              artist={song.artist}
              artists={song.localSong?.artists}
              linkClassName="text-[#a7a7a7] hover:text-white hover:underline text-[13px]"
            />
            {song.album && (
              <>
                <span className="text-[#a7a7a7]/60">•</span>
                <span className="truncate">{song.album}</span>
              </>
            )}
          </div>
        </span>

        <span className="hidden md:inline truncate text-[14px] tabular-nums text-[#b3b3b3]">
          {formatPlays(displayIndex)}
        </span>

        <span className="flex items-center justify-end gap-1.5 sm:gap-2 text-xs sm:text-[14px] tabular-nums text-[#b3b3b3]">
          <span>{formatDuration(song.duration)}</span>
          {song.localSong && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                setCreditsSong(song.localSong || null)
              }}
              title="Show Credits"
              className="h-7 w-7 flex items-center justify-center rounded-full transition-all cursor-pointer opacity-0 group-hover:opacity-100 text-text-muted hover:text-white hover:bg-white/10"
            >
              <FileText className="h-3.5 w-3.5" />
            </span>
          )}
          {AppCapabilities.downloads && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              handleDownloadTrack(song)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                handleDownloadTrack(song)
              }
            }}
            title={
              isDownloading
                ? `Downloading (${transfer?.progress || 0}%) - click to view in Transfers`
                : song.isLocal
                  ? 'In your library (Click to choose source or replace)'
                  : 'Download track to library'
            }
            className={`h-7 w-7 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              isDownloading
                ? 'text-primary-amber'
                : song.isLocal
                  ? 'text-text-muted hover:text-white hover:bg-white/10'
                  : 'opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
            }`}
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : song.isLocal ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              const rect = e.currentTarget.getBoundingClientRect()
              setActiveMenu((curr) =>
                curr?.song.id === song.id
                  ? null
                  : {
                      song,
                      x: Math.min(rect.right - 220, window.innerWidth - 232),
                      y: Math.min(rect.bottom + 8, window.innerHeight - 260),
                      flyoutArtist: false
                    }
              )
            }}
            title="More options"
            className={`h-7 w-7 flex items-center justify-center rounded-full transition-all cursor-pointer ${
              activeMenu?.song.id === song.id
                ? 'text-primary-amber bg-white/10 opacity-100'
                : 'opacity-70 md:opacity-0 text-[#b3b3b3] md:group-hover:opacity-100 hover:text-white hover:bg-white/10'
            }`}
          >
            <MoreVertical className="h-4 w-4" />
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="h-full overflow-y-auto select-none bg-[#121212] text-white pb-36 md:pb-12">
      <section
        className="relative flex h-[260px] sm:h-[360px] flex-col justify-end overflow-hidden bg-[#242424] px-4 sm:px-10 pb-6 sm:pb-9"
        style={
          heroArtworkUrl
            ? {
                backgroundImage: `url(${heroArtworkUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center 28%'
              }
            : undefined
        }
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.48)_42%,rgba(18,18,18,0.88)_82%,#121212_100%)]" />
        <div className="relative z-10 flex flex-col gap-1.5 sm:gap-2">
          <div className="flex items-center gap-2 text-xs sm:text-[14px] font-bold text-white drop-shadow">
            <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 rounded-full fill-[#3d91f4] text-white" />
            <span>Verified Artist</span>
          </div>
          <h1 className="max-w-full truncate text-[clamp(2.5rem,7vw,7.5rem)] font-black leading-tight sm:leading-none tracking-tight text-white drop-shadow-[0_6px_20px_rgba(0,0,0,0.7)]">
            {decodedName}
          </h1>
          <p className="text-xs sm:text-[16px] font-bold text-white/90 drop-shadow">
            {Math.max(42810495, artistSongs.length * 912348).toLocaleString()} monthly listeners
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 sm:gap-6 px-4 sm:px-10 py-4 sm:py-6">
        <button
          onClick={handlePlayAll}
          disabled={!artistTracks.length}
          title={isCurrentArtistPlaying ? 'Pause' : 'Play'}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-[0_8px_18px_rgba(0,0,0,0.38)] transition-transform hover:scale-105 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {isCurrentArtistPlaying ? (
            <Pause className="h-7 w-7 fill-current" />
          ) : (
            <Play className="ml-1 h-7 w-7 fill-current" />
          )}
        </button>

        {heroArtworkUrl && (
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 border-white/20">
            <ArtworkImage
              src={heroArtworkUrl}
              title={decodedName}
              artist={decodedName}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleShufflePlay}
          title={isShuffle ? 'Shuffle active' : 'Shuffle artist songs'}
          className={`flex h-10 w-10 items-center justify-center transition-colors ${
            isShuffle ? 'text-primary-amber' : 'text-[#b3b3b3] hover:text-white'
          }`}
        >
          <Shuffle className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={() => void handleStartArtistRadio()}
          disabled={isGeneratingRadio}
          title={`Start ${decodedName} Radio station`}
          className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[14px] font-bold text-white transition-all hover:scale-105 hover:border-white/40 hover:bg-white/10 disabled:opacity-50"
        >
          {isGeneratingRadio ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary-amber" />
          ) : (
            <Radio className="h-4 w-4 text-primary-amber" />
          )}
          <span>Artist Radio</span>
        </button>

        <button
          type="button"
          onClick={() => setIsFollowing((current) => !current)}
          className={`rounded-full border px-6 py-2 text-[14px] font-bold transition-all hover:scale-105 ${
            isFollowing
              ? 'border-white bg-white/10 text-white'
              : 'border-white/35 text-white hover:border-white'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>

        <button
          type="button"
          title="More options"
          className="flex h-10 w-10 items-center justify-center text-[#b3b3b3] transition-colors hover:text-white"
        >
          <MoreHorizontal className="h-7 w-7" />
        </button>
      </div>

      <main className="grid grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)] gap-6 sm:gap-10 px-4 sm:px-10 pb-36 md:pb-14 max-[960px]:grid-cols-1">
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-black tracking-normal text-white">Popular</h2>
              {AppCapabilities.onlineSearch && (
                <label className="flex items-center gap-2 text-xs text-[#b3b3b3]">
                  <Globe2 className="h-4 w-4" />
                  <select
                    value={artistSource}
                    onChange={(event) => setArtistSource(event.target.value as ArtistSource)}
                    className="rounded-md border border-white/15 bg-[#282828] px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="library">Library</option>
                    <option value="apple_music">Apple Music</option>
                    <option value="lastfm">Last.fm</option>
                    <option value="musicbrainz">MusicBrainz</option>
                  </select>
                </label>
              )}
            </div>
            <span className="text-[14px] text-[#b3b3b3]">
              {!AppCapabilities.onlineSearch || artistSource === 'library'
                ? `${artistSongs.length} local tracks`
                : `${onlineTracks.length} ${artistSource.replace('_', ' ')} tracks`}
            </span>
          </div>

          {isOnlineLoading ? (
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-[#b3b3b3]">
              Loading {artistSource.replace('_', ' ')} tracks...
            </div>
          ) : onlineError ? (
            <div className="rounded-md border border-red-400/20 bg-red-400/5 px-5 py-6 text-sm text-red-300">
              {onlineError}
            </div>
          ) : visibleSongs.length ? (
            <div className="space-y-10">
              {primaryTracks.length > 0 && (
                <div>
                  <div className="flex flex-col">
                    {primaryTracks.map((song, index) => renderTrackRow(song, index))}
                  </div>
                </div>
              )}

              {appearsOnTracks.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-white/[0.015] p-4 pt-3">
                  <div className="mb-3 flex items-center justify-between border-b border-white/5 pb-3">
                    <div>
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span>Appears On</span>
                        <span className="rounded-full bg-primary-amber/15 px-2 py-0.5 text-[10px] font-bold text-primary-amber border border-primary-amber/30 uppercase tracking-wide">
                          Collaborations & Features
                        </span>
                      </h3>
                      <p className="text-xs text-[#a7a7a7] mt-0.5">
                        Tracks featuring or co-performed by {decodedName}
                      </p>
                    </div>
                    <span className="text-xs text-[#b3b3b3]">{appearsOnTracks.length} tracks</span>
                  </div>
                  <div className="flex flex-col">
                    {appearsOnTracks.map((song, index) =>
                      renderTrackRow(song, primaryTracks.length + index)
                    )}
                  </div>
                </div>
              )}

              {primaryTracks.length === 0 && appearsOnTracks.length === 0 && (
                <div className="flex flex-col">
                  {visibleSongs.map((song, index) => renderTrackRow(song, index))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-[#b3b3b3]">
              No tracks found for this artist from {artistSource === 'library' ? 'your local library' : artistSource.replace('_', ' ')}.
            </div>
          )}
        </section>

        <aside className="min-w-0">
          <h2 className="mb-4 text-3xl font-black tracking-normal text-white">Artist pick</h2>
          <button
            type="button"
            onClick={() => handlePlaySong(0)}
            disabled={!artistPick}
            className="flex w-full items-center gap-4 rounded-lg bg-[#181818] p-4 text-left shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-0.5 hover:bg-[#242424] disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-[#181818]"
          >
            <span className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828] text-[#777]">
              <ArtworkImage
                src={heroArtworkUrl}
                title={artistPick?.title || decodedName}
                artist={decodedName}
                className="h-full w-full object-cover"
                fallbackIcon={<Music2 className="h-8 w-8 text-[#777]" />}
              />
            </span>
            <span className="min-w-0">
              <span className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#b3b3b3]">
                {heroArtworkUrl && (
                  <img
                    src={heroArtworkUrl}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.style.display = 'none'
                    }}
                    className="h-6 w-6 rounded-full object-cover"
                  />
                )}
                <span className="truncate">Posted By {decodedName}</span>
              </span>
              <span className="line-clamp-2 text-[18px] font-black text-white">
                {artistPick ? `${artistPick.title} - ${decodedName}` : `${decodedName} Essentials`}
              </span>
              <span className="mt-1 block text-[14px] text-[#a7a7a7]">Popular Release</span>
            </span>
          </button>

          <div className="mt-8 rounded-lg bg-[#181818] p-5">
            <h3 className="mb-3 text-xl font-black text-white">About</h3>
            <p className="text-sm leading-6 text-[#b3b3b3]">
              {artistSongs.length
                ? `${decodedName} has ${artistSongs.length} track${artistSongs.length === 1 ? '' : 's'} in your local library.`
                : onlineTracks.length
                  ? `${decodedName} has ${onlineTracks.length} online track${onlineTracks.length === 1 ? '' : 's'} available from search.`
                  : `Add local tracks by ${decodedName} to build this artist catalog.`}
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm font-bold text-white">
              <Clock className="h-4 w-4 text-[#b3b3b3]" />
              Local library profile
            </div>
          </div>
        </aside>
      </main>
      {activeMenu &&
        createPortal(
          <div
            className="fixed z-[9999] min-w-[220px] rounded-lg bg-[#282828] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] border border-white/10"
            style={{ left: activeMenu.x, top: activeMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {isRemoteConnected && (
              <>
                <button
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  onClick={() => {
                    const targetId = activeMenu.song.localSong?.id || activeMenu.song.id
                    void remoteClient.play(targetId)
                    setActiveMenu(null)
                  }}
                >
                  <Laptop2 className="h-4 w-4" /> Play on PC
                </button>
                <button
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                  onClick={() => {
                    const targetId = activeMenu.song.localSong?.id || activeMenu.song.id
                    remoteClient.downloadSong(targetId)
                    setActiveMenu(null)
                  }}
                >
                  <Download className="h-4 w-4" /> Transfer / Download to Phone
                </button>
                <div className="my-1 border-t border-white/10" />
              </>
            )}

            {/* Play */}
            <button
              className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                handlePlayTrack(activeMenu.song)
                setActiveMenu(null)
              }}
            >
              <Play className="h-4 w-4" /> Play
            </button>

            {/* Add to Queue */}
            {activeMenu.song.localSong && (
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  if (activeMenu.song.localSong) enqueueSong(activeMenu.song.localSong)
                  setActiveMenu(null)
                }}
              >
                <ListPlus className="h-4 w-4" /> Add to queue
              </button>
            )}

            <div className="my-1 border-t border-white/10" />

            {/* Go to Album */}
            {activeMenu.song.album && (
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  navigate(`/album/${encodeURIComponent(activeMenu.song.album)}`)
                  setActiveMenu(null)
                }}
              >
                <Disc3 className="h-4 w-4" /> Go to album
              </button>
            )}

            {/* Go to Artist — single or flyout */}
            {(() => {
              const songForArtists = activeMenu.song.localSong
              const parsedArtists = songForArtists
                ? parseArtists(
                    songForArtists.artist || '',
                    songForArtists.artists?.map((a) => a.name)
                  )
                : parseArtists(activeMenu.song.artist || '')
              if (parsedArtists.length <= 1) {
                const artistName = parsedArtists[0]?.name || activeMenu.song.artist
                return artistName ? (
                  <button
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                    onClick={() => {
                      navigate(`/artist/${encodeURIComponent(artistName)}`)
                      setActiveMenu(null)
                    }}
                  >
                    <User className="h-4 w-4" /> Go to artist
                  </button>
                ) : null
              }
              // Multi-artist flyout
              return (
                <div className="group/artist relative">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveMenu((m) => m ? { ...m, flyoutArtist: !m.flyoutArtist } : m)
                    }}
                  >
                    <User className="h-4 w-4" />
                    <span className="flex-1 text-left">Go to artist</span>
                    <ChevronRight className="h-4 w-4 text-[#b3b3b3]" />
                  </button>
                  {activeMenu.flyoutArtist && (
                    <div
                      className={`absolute top-0 min-w-[180px] rounded-lg bg-[#3e3e3e] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] border border-white/10 ${
                        activeMenu.x + 220 + 180 > window.innerWidth ? 'right-full mr-1' : 'left-full ml-1'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {parsedArtists.map((a) => (
                        <button
                          key={a.name}
                          className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-white hover:bg-white/10 transition-colors"
                          onClick={() => {
                            navigate(`/artist/${encodeURIComponent(a.name)}`)
                            setActiveMenu(null)
                          }}
                        >
                          <User className="h-3.5 w-3.5 shrink-0 text-[#b3b3b3]" />
                          <span className="flex-1 truncate">{a.name}</span>
                          {a.role === 'primary' && (
                            <span className="shrink-0 rounded bg-primary-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-primary-amber">
                              Lead
                            </span>
                          )}
                          {a.role === 'featured' && (
                            <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-[#b3b3b3]">
                              Feat
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="my-1 border-t border-white/10" />

            {/* Show Credits */}
            {activeMenu.song.localSong && (
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  setCreditsSong(activeMenu.song.localSong || null)
                  setActiveMenu(null)
                }}
              >
                <FileText className="h-4 w-4" /> Show credits
              </button>
            )}

            {/* Download */}
            {AppCapabilities.downloads && (
            <button
              className="flex w-full items-center gap-3 px-4 py-2.5 text-[14px] text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                handleDownloadTrack(activeMenu.song)
                setActiveMenu(null)
              }}
            >
              {activeMenu.song.isLocal ? (
                <><CheckCircle2 className="h-4 w-4 text-primary-amber" /> In your library</>
              ) : (
                <><Download className="h-4 w-4" /> Download to library</>
              )}
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
