import { useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Globe2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Shuffle
} from 'lucide-react'
import { Song } from '../Library/Library'
import { toMediaUrl } from '../../lib/media'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

interface ArtistPageTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artworkUrl: string
  isLocal: boolean
  localSong?: Song
  url?: string
}

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

export default function ArtistPage({ onOpenDownloadPanel }: ArtistPageProps) {
  const { name } = useParams<{ name: string }>()
  const decodedName = name ? decodeURIComponent(name) : 'Unknown Artist'
  const [songs, setSongs] = useState<Song[]>([])
  const [onlineTracks, setOnlineTracks] = useState<ArtistPageTrack[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const { setQueue, togglePlay, queue, currentSongIndex, isPlaying } = usePlayerStore()

  useEffect(() => {
    const loadSongs = async () => {
      try {
        const data = await window.api?.getSongs?.()
        setSongs(data || [])
      } catch (err) {
        console.error('Failed to load artist songs:', err)
      }
    }

    loadSongs()
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadOnlineTracks = async () => {
      const seedKey = `felo_artist_seed:${normalizeArtistName(decodedName)}`
      const seededTracks: ArtistPageTrack[] = []

      try {
        const rawSeed = sessionStorage.getItem(seedKey)
        if (rawSeed) {
          const item = JSON.parse(rawSeed)
          seededTracks.push({
            id: `seed-${item.id || item.title}`,
            title: item.title || 'Unknown Track',
            artist: item.artist || decodedName,
            album: item.album || '',
            duration: parseDuration(item.duration),
            artworkUrl: item.thumbnail || '',
            isLocal: false,
            url: item.url || ''
          })
        }
      } catch (err) {
        console.warn('Failed to load artist seed:', err)
      }

      try {
        const appleSongs = await window.api?.searchAppleMusicArtistSongs?.(decodedName)
        const fetchedTracks: ArtistPageTrack[] = (appleSongs || [])
          .filter((item: any) => item?.title && artistNameMatches(item.artist || '', decodedName))
          .map((item: any) => ({
            id: `online-${item.id || item.title}`,
            title: item.title || 'Unknown Track',
            artist: item.artist || decodedName,
            album: item.album || '',
            duration: parseDuration(item.duration),
            artworkUrl: item.thumbnail || '',
            isLocal: false,
            url: item.url || ''
          }))

        const seen = new Set<string>()
        const nextTracks = [...seededTracks, ...fetchedTracks].filter((track) => {
          const key = `${normalizeArtistName(track.title)}::${normalizeArtistName(track.artist)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        if (!cancelled) setOnlineTracks(nextTracks)
      } catch (err) {
        console.warn('Failed to fetch online artist tracks:', err)
        if (!cancelled) setOnlineTracks(seededTracks)
      }
    }

    loadOnlineTracks()

    return () => {
      cancelled = true
    }
  }, [decodedName])

  const artistSongs = useMemo(() => {
    return songs.filter((song) => artistNameMatches(song.artist || '', decodedName))
  }, [decodedName, songs])

  const currentSong = queue[currentSongIndex]
  const isCurrentArtistPlaying =
    isPlaying && artistNameMatches(currentSong?.artist || '', decodedName)

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
    const localTitles = new Set(localTracks.map((track) => normalizeArtistName(track.title)))
    return [
      ...localTracks,
      ...onlineTracks.filter((track) => !localTitles.has(normalizeArtistName(track.title)))
    ]
  }, [artistSongs, onlineTracks])

  const currentSongArtwork =
    currentSong && artistNameMatches(currentSong.artist || '', decodedName)
      ? toMediaUrl(currentSong.artworkPath)
      : ''
  const heroArtworkUrl =
    artistTracks.find((track) => track.artworkUrl)?.artworkUrl || currentSongArtwork || ''
  const artistPick = artistTracks[0]
  const visibleSongs = artistTracks.slice(0, 5)

  const handlePlayAll = () => {
    if (!artistTracks.length) return

    if (artistNameMatches(currentSong?.artist || '', decodedName)) {
      togglePlay()
      return
    }

    const firstLocalIndex = artistSongs.findIndex(
      (song) => song.id === artistTracks[0]?.localSong?.id
    )
    if (artistTracks[0]?.localSong) {
      setQueue(artistSongs, Math.max(0, firstLocalIndex))
      return
    }

    if (artistTracks[0]?.url) void window.api?.openExternal?.(artistTracks[0].url)
  }

  const handlePlaySong = (index: number) => {
    const track = artistTracks[index]
    if (!track) return

    if (!track.localSong) {
      onOpenDownloadPanel?.({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration,
        filePath: '',
        artworkUrl: track.artworkUrl,
        isOnline: true
      })
      return
    }

    if (currentSong?.id === track.localSong.id) {
      togglePlay()
      return
    }

    const localIndex = artistSongs.findIndex((song) => song.id === track.localSong?.id)
    setQueue(artistSongs, Math.max(0, localIndex))
  }

  const formatDuration = (seconds: number) => {
    if (!seconds || Number.isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatPlays = (index: number) => ((index + 1) * 78201948 + 1248021).toLocaleString()

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
          className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1ed760] text-black shadow-[0_8px_18px_rgba(0,0,0,0.38)] transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
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
            className="h-12 w-12 rounded-md border-2 border-white/20 object-cover"
          />
        )}

        <button
          type="button"
          onClick={handlePlayAll}
          title="Shuffle"
          className="flex h-10 w-10 items-center justify-center text-[#b3b3b3] transition-colors hover:text-white"
        >
          <Shuffle className="h-6 w-6" />
        </button>

        <button
          type="button"
          onClick={() => setIsFollowing((current) => !current)}
          className={`rounded-full border px-6 py-2 text-[14px] font-bold transition-all hover:scale-105 ${
            isFollowing
              ? 'border-[#1ed760] text-[#1ed760]'
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
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-3xl font-black tracking-normal text-white">Popular</h2>
            <span className="flex items-center gap-2 text-[14px] text-[#b3b3b3]">
              <Globe2 className="h-4 w-4" />
              {artistSongs.length} local • {onlineTracks.length} online
            </span>
          </div>

          {visibleSongs.length ? (
            <div className="flex flex-col">
              {visibleSongs.map((song, index) => {
                const isCurrent = currentSong?.id === song.localSong?.id
                const artworkUrl = song.artworkUrl

                return (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => {
                      if (!song.localSong) handlePlaySong(index)
                    }}
                    onDoubleClick={() => handlePlaySong(index)}
                    className={`group grid h-[58px] grid-cols-[36px_48px_minmax(180px,1fr)_minmax(110px,0.7fr)_72px] items-center gap-3 rounded px-3 text-left transition-colors hover:bg-white/10 ${
                      isCurrent ? 'bg-white/15' : ''
                    }`}
                  >
                    <span
                      onClick={(event) => {
                        event.stopPropagation()
                        handlePlaySong(index)
                      }}
                      className="relative flex h-5 items-center justify-center text-[16px] font-bold text-[#b3b3b3]"
                    >
                      <span
                        className={`transition-opacity ${
                          isCurrent ? 'text-[#1ed760]' : 'group-hover:opacity-0'
                        }`}
                      >
                        {index + 1}
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
                        <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Music2 className="h-5 w-5" />
                      )}
                    </span>

                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`truncate text-[16px] font-bold ${
                            isCurrent ? 'text-[#1ed760]' : 'text-white'
                          }`}
                        >
                          {song.title}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            song.isLocal
                              ? 'bg-[#1ed760]/20 text-[#1ed760]'
                              : 'bg-white/10 text-[#a7a7a7]'
                          }`}
                        >
                          {song.isLocal ? 'In Library' : 'Online'}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-[#a7a7a7]">
                        {song.album || decodedName}
                      </span>
                    </span>

                    <span className="truncate text-[14px] tabular-nums text-[#b3b3b3]">
                      {formatPlays(index)}
                    </span>

                    <span className="flex items-center justify-end gap-2 text-[14px] tabular-nums text-[#b3b3b3]">
                      {formatDuration(song.duration)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-5 py-6 text-sm text-[#b3b3b3]">
              No tracks found for this artist in your local library.
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
                <img src={heroArtworkUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Music2 className="h-8 w-8" />
              )}
            </span>
            <span className="min-w-0">
              <span className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#b3b3b3]">
                {heroArtworkUrl && (
                  <img src={heroArtworkUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
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
    </div>
  )
}
