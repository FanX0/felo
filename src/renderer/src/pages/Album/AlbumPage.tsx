import { useEffect, useState } from 'react'
import { Music2, Play } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'
import type { Song } from '../Library/Library'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

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
  const { setQueue, togglePlay, queue, currentSongIndex } = usePlayerStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

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
      setLoading(true)
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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load album tracks.')
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


  const handleTrackClick = (track: AlbumTrack) => {
    if (track.localSong) {
      const current = queue[currentSongIndex]
      if (current?.id === track.localSong.id) {
        togglePlay()
      } else {
        setQueue([track.localSong], 0)
      }
      return
    }
    openDownload(track)
  }

  const openDownload = (track: AlbumTrack) => {
    onOpenDownloadPanel?.({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration ? track.duration.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0,
      artworkUrl: track.thumbnail || artwork,
      isOnline: true,
      autoDownload: true,
      autoPlay: true
    })
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
          <p className="mt-3 text-lg text-[#b3b3b3]">{albumArtist}</p>
          <p className="mt-2 text-sm text-[#777]">{tracks.length} tracks</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void saveOnlineAlbum()}
              disabled={isSaving || !tracks.length}
              className="rounded-full bg-[#1ed760] px-5 py-2 text-sm font-bold text-black disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Online Album'}
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
          {tracks.map((track, index) => (
            <button
              key={track.id}
              type="button"
              onClick={() => handleTrackClick(track)}
              className="group grid h-16 grid-cols-[40px_48px_minmax(0,1fr)_80px] items-center gap-3 rounded-md px-3 text-left hover:bg-white/10"
            >
              <span className="text-center text-[#b3b3b3]">{index + 1}</span>
              <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded bg-[#282828]">
                {track.thumbnail ? <img src={track.thumbnail} alt="" className="h-full w-full object-cover" /> : <Music2 className="h-5 w-5 text-[#777]" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 truncate font-bold">
                  <span className="truncate">{track.title}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${track.localSong ? 'bg-[#1ed760]/20 text-[#1ed760]' : 'bg-white/10 text-[#a7a7a7]'}`}>
                    {track.localSong ? 'In Library' : 'Online'}
                  </span>
                </span>
                <span className="block truncate text-sm text-[#a7a7a7]">{track.artist}</span>
              </span>
              <span className="flex items-center justify-end gap-2 text-sm text-[#a7a7a7]">
                <Play className="h-4 w-4 opacity-0 group-hover:opacity-100" />
                {parseDuration(track.duration)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
