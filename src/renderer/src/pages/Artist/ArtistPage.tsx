import { useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Globe2,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Shuffle
} from 'lucide-react'
import { Song } from '../Library/Library'
import { toMediaUrl } from '../../lib/media'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import ArtistLinks from '../../components/Common/ArtistLinks'
import SongCreditsModal from '../../components/Common/SongCreditsModal'

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
  const { name } = useParams<{ name: string }>()
  const decodedName = name ? decodeURIComponent(name) : 'Unknown Artist'
  const [songs, setSongs] = useState<Song[]>([])
  const [onlineTracks, setOnlineTracks] = useState<ArtistPageTrack[]>([])
  const [artistSource, setArtistSource] = useState<ArtistSource>('library')
  const [isOnlineLoading, setIsOnlineLoading] = useState(false)
  const [onlineError, setOnlineError] = useState('')
  const [isFollowing, setIsFollowing] = useState(false)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const { setQueue, togglePlay, queue, currentSongIndex, isPlaying, isShuffle, toggleShuffle } =
    usePlayerStore()
  const { transfers } = useDownloadStore()

  useEffect(() => {
    let mounted = true
    const loadSongs = async () => {
      try {
        const data = await window.api?.getSongs?.()
        if (mounted) setSongs(data || [])
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
  }, [])

  useEffect(() => {
    if (artistSource === 'library') {
      setOnlineTracks([])
      setOnlineError('')
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
              artworkUrl: item.thumbnail || toMediaUrl(localSong?.artworkPath) || '',
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
      artworkUrl: toMediaUrl(song.artworkPath) || '',
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
      ? toMediaUrl(currentSong.artworkPath)
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

    setQueue(allArtistSongs, 0, artistContext)
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
    setQueue(allArtistSongs, randomIndex, artistContext)
    if (!artistTracks[randomIndex]?.localSong) {
      usePlayerStore.getState().setIsBuffering(true)
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

    const artistContext = {
      type: 'artist' as const,
      title: decodedName,
      route: `/artist/${encodeURIComponent(decodedName)}`
    }

    setQueue(allArtistSongs, effectiveIndex, artistContext)
    if (!track.localSong) {
      usePlayerStore.getState().setIsBuffering(true)
    }
  }

  const handleDownloadTrack = (track: ArtistPageTrack) => {
    if (!track) return

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
        className={`group grid h-[58px] grid-cols-[36px_48px_minmax(180px,1fr)_minmax(110px,0.7fr)_110px] items-center gap-3 rounded px-3 text-left transition-colors hover:bg-white/10 ${
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

        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#282828] text-[#777]">
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
              className="h-full w-full object-cover"
            />
          ) : (
            <Music2 className="h-5 w-5" />
          )}
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

        <span className="truncate text-[14px] tabular-nums text-[#b3b3b3]">
          {formatPlays(displayIndex)}
        </span>

        <span className="flex items-center justify-end gap-2 text-[14px] tabular-nums text-[#b3b3b3]">
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
                ? `Downloading (${transfer?.progress || 0}%)...`
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
        </span>
      </button>
    )
  }

  return (
    <div className="h-full overflow-y-auto select-none bg-[#121212] text-white">
      <section
        className="relative flex h-[360px] flex-col justify-end overflow-hidden bg-[#242424] px-10 pb-9"
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
        <div className="relative z-10 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[14px] font-bold text-white drop-shadow">
            <CheckCircle2 className="h-5 w-5 rounded-full fill-[#3d91f4] text-white" />
            <span>Verified Artist</span>
          </div>
          <h1 className="max-w-full truncate text-[clamp(4rem,9vw,7.5rem)] font-black leading-none tracking-normal text-white drop-shadow-[0_6px_20px_rgba(0,0,0,0.7)]">
            {decodedName}
          </h1>
          <p className="text-[16px] font-bold text-white drop-shadow">
            {Math.max(42810495, artistSongs.length * 912348).toLocaleString()} monthly listeners
          </p>
        </div>
      </section>

      <div className="flex items-center gap-6 px-10 py-6">
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
          <img
            src={heroArtworkUrl}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
            className="h-12 w-12 rounded-md border-2 border-white/20 object-cover"
          />
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

      <main className="grid grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)] gap-10 px-10 pb-14 max-[960px]:grid-cols-1">
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-3xl font-black tracking-normal text-white">Popular</h2>
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
            </div>
            <span className="text-[14px] text-[#b3b3b3]">
              {artistSource === 'library' ? `${artistSongs.length} local tracks` : `${onlineTracks.length} ${artistSource.replace('_', ' ')} tracks`}
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
              {heroArtworkUrl ? (
                <img
                  src={heroArtworkUrl}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                  }}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Music2 className="h-8 w-8" />
              )}
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
      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </div>
  )
}
