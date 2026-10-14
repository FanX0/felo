import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Clock3,
  CloudUpload,
  Disc3,
  Download,
  FileText,
  ListPlus,
  Loader2,
  Music2,
  MoreVertical,
  Pencil,
  Pause,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  User,
  UserPlus,
  X
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useShallow } from 'zustand/react/shallow'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import { publishLocalPlaylist } from '../../lib/onlinePlaylists'
import { getSupabase } from '../../lib/supabase'
import { downloadTrackInBackground } from '../../lib/backgroundDownloader'
import { Song } from '../Library/Library'
import { Playlist } from './types'
import { ArtworkImage } from '../Home/components/ArtworkImage'
import ArtistLinks from '../../components/Common/ArtistLinks'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { parseArtists } from '../../lib/artistParser'
import { AppCapabilities } from '../../lib/appConfig'

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function formatBytes(bytes = 0): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`
}

function formatRelativeDate(timestamp: number): string {
  if (!timestamp) return ''
  const elapsed = Math.max(0, Date.now() - timestamp * 1000)
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

import { findMatchingLibrarySong } from '../../lib/songMatching'

function qualityLabel(song: Song): string {
  const rawFormat = String(song.codec || song.container || '').toLowerCase()
  const format =
    rawFormat.includes('mp3') || /mpeg.*layer\s*3/.test(rawFormat)
      ? 'MP3'
      : rawFormat.includes('flac')
        ? 'FLAC'
        : rawFormat.includes('m4a') || rawFormat.includes('aac')
          ? 'AAC'
          : rawFormat.includes('opus')
            ? 'OPUS'
            : rawFormat.includes('wav')
              ? 'WAV'
              : rawFormat.includes('ogg')
                ? 'OGG'
                : rawFormat.toUpperCase()
  const rate = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : ''
  const depth = song.bitDepth ? `${song.bitDepth}-bit` : ''
  const technical = [depth, rate].filter(Boolean).join(' / ')
  return [format, technical].filter(Boolean).join(' • ') || 'Unknown format'
}

import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

interface PlaylistDetailProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export default function PlaylistDetail({ onOpenDownloadPanel }: PlaylistDetailProps) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const {
    queue,
    currentSongIndex,
    isPlaying,
    isShuffle,
    setQueue,
    enqueueSong,
    togglePlay,
    toggleShuffle,
    playbackContext
  } = usePlayerStore(
    useShallow((s) => ({
      queue: s.queue,
      currentSongIndex: s.currentSongIndex,
      isPlaying: s.isPlaying,
      isShuffle: s.isShuffle,
      setQueue: s.setQueue,
      enqueueSong: s.enqueueSong,
      togglePlay: s.togglePlay,
      toggleShuffle: s.toggleShuffle,
      playbackContext: s.playbackContext
    }))
  )
  const { transfers } = useDownloadStore()
  const { configured, initialized, user } = useOnlineStore()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
  const [onlinePlaylistId, setOnlinePlaylistId] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const [playlistActionError, setPlaylistActionError] = useState('')
  const [activeSongMenu, setActiveSongMenu] = useState<{
    song: Song
    x: number
    y: number
  } | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const [isDownloadingMissing, setIsDownloadingMissing] = useState(false)
  const downloadMissingPlaylistRef = useRef(false)
  const failedSongIdsRef = useRef<Set<string>>(new Set())
  const currentDownloadingSongIdRef = useRef<string | null>(null)

  const loadPlaylist = async () => {
    setIsLoading(true)
    try {
      setPlaylist((await window.api.getPlaylist(id)) as Playlist | null)
    } catch (err) {
      console.error('Failed to load playlist:', err)
      setPlaylist(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    downloadMissingPlaylistRef.current = false
    setIsDownloadingMissing(false)
    failedSongIdsRef.current.clear()
    currentDownloadingSongIdRef.current = null
    void loadPlaylist()
    window.api
      .getSongs()
      .then((songs) => setLibrarySongs(songs || []))
      .catch(console.error)

    const refreshPlaylistAndLibrary = async () => {
      const [nextPlaylist, nextSongs] = await Promise.all([
        window.api.getPlaylist(id) as Promise<Playlist | null>,
        window.api.getSongs()
      ])
      setPlaylist(nextPlaylist)
      setLibrarySongs(nextSongs || [])
      return { nextPlaylist, nextSongs: (nextSongs || []) as Song[] }
    }
    const handleUpdate = () => void refreshPlaylistAndLibrary().catch(console.error)
    window.addEventListener('felo:library-updated', handleUpdate)
    const cleanup = window.api?.onDownloadProgress?.(async (event: any) => {
      if (event?.status !== 'completed' && event?.status !== 'failed') return
      try {
        const { nextPlaylist, nextSongs } = await refreshPlaylistAndLibrary()
        if (!downloadMissingPlaylistRef.current || !nextPlaylist) {
          setIsDownloadingMissing(false)
          return
        }

        if (event?.status === 'completed') {
          const completedLocalSong = event.song?.id
            ? nextSongs.find((song) => song.id === event.song.id)
            : findMatchingLibrarySong(event.song?.title || '', event.song?.artist || '', nextSongs)
          if (completedLocalSong) enqueueSong(completedLocalSong)
        } else if (event?.status === 'failed') {
          const failedId = event.songId || event.song?.id || currentDownloadingSongIdRef.current
          if (failedId) {
            failedSongIdsRef.current.add(failedId)
          }
          if (event.title) {
            const matched = (nextPlaylist.songs || []).find(
              (s: Song) =>
                s.title?.toLowerCase() === event.title?.toLowerCase() &&
                (!event.artist || s.artist?.toLowerCase() === event.artist?.toLowerCase())
            )
            if (matched) failedSongIdsRef.current.add(matched.id)
          }
        }

        // Recompute all missing songs from the latest playlist & library state
        const updatedPlaylistSongs = nextPlaylist.songs || []
        const updatedSongs = updatedPlaylistSongs.map((song: Song) => {
          if (song.filePath && !song.filePath.startsWith('virtual:')) return song
          const localMatch = findMatchingLibrarySong(song.title || '', song.artist || '', nextSongs)
          return localMatch ? { ...song, ...localMatch, id: localMatch.id } : song
        })

        const nextMissing = updatedSongs.find(
          (song: Song) =>
            (!song.filePath || song.filePath.startsWith('virtual:')) &&
            !failedSongIdsRef.current.has(song.id)
        )

        if (nextMissing) {
          setIsDownloadingMissing(true)
          currentDownloadingSongIdRef.current = nextMissing.id
          // Download next missing track 1 by 1 sequentially in background
          void downloadTrackInBackground(nextMissing, { openDrawer: false })
        } else {
          downloadMissingPlaylistRef.current = false
          setIsDownloadingMissing(false)
          currentDownloadingSongIdRef.current = null
        }
      } catch (error) {
        console.error('Failed to continue playlist downloads:', error)
        downloadMissingPlaylistRef.current = false
        setIsDownloadingMissing(false)
        currentDownloadingSongIdRef.current = null
      }
    })

    const handleDownloadFailed = (e: any) => {
      const detail = e.detail || {}
      if (!downloadMissingPlaylistRef.current) return
      const failedId = detail.songId || currentDownloadingSongIdRef.current
      if (failedId) failedSongIdsRef.current.add(failedId)
      void refreshPlaylistAndLibrary().then(({ nextPlaylist, nextSongs }) => {
        if (!downloadMissingPlaylistRef.current || !nextPlaylist) return
        const updatedPlaylistSongs = nextPlaylist.songs || []
        const updatedSongs = updatedPlaylistSongs.map((song: Song) => {
          if (song.filePath && !song.filePath.startsWith('virtual:')) return song
          const localMatch = findMatchingLibrarySong(song.title || '', song.artist || '', nextSongs)
          return localMatch ? { ...song, ...localMatch, id: localMatch.id } : song
        })
        const nextMissing = updatedSongs.find(
          (song: Song) =>
            (!song.filePath || song.filePath.startsWith('virtual:')) &&
            !failedSongIdsRef.current.has(song.id)
        )
        if (nextMissing) {
          setIsDownloadingMissing(true)
          currentDownloadingSongIdRef.current = nextMissing.id
          void downloadTrackInBackground(nextMissing, { openDrawer: false })
        } else {
          downloadMissingPlaylistRef.current = false
          setIsDownloadingMissing(false)
          currentDownloadingSongIdRef.current = null
        }
      })
    }
    window.addEventListener('felo:download-failed', handleDownloadFailed)
    window.addEventListener('fanxmusic:download-failed', handleDownloadFailed)
    window.addEventListener('fanxmusic:library-updated', handleUpdate)

    return () => {
      window.removeEventListener('felo:library-updated', handleUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleUpdate)
      window.removeEventListener('felo:download-failed', handleDownloadFailed)
      window.removeEventListener('fanxmusic:download-failed', handleDownloadFailed)
      cleanup?.()
    }
  }, [id])

  useEffect(() => {
    const closeMenu = () => setActiveSongMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  const playlistSongs = playlist?.songs || []
  const songs = useMemo(
    () =>
      playlistSongs.map((song) => {
        if (song.filePath && !song.filePath.startsWith('virtual:')) return song
        const localMatch = findMatchingLibrarySong(song.title || '', song.artist || '', librarySongs)
        return localMatch ? { ...song, ...localMatch, id: localMatch.id } : song
      }),
    [librarySongs, playlistSongs]
  )

  const allPlaylistSongs = useMemo<Song[]>(() => {
    return songs.map((song, idx) => {
      if (song.filePath && !song.filePath.startsWith('virtual:')) return song
      return {
        ...song,
        id: song.id || `playlist-${id}-${idx}`,
        filePath: song.filePath || `virtual:${song.title} - ${song.artist || 'Unknown'}`,
        isOnline: true
      }
    })
  }, [songs, id])

  const downloadedSongs = useMemo(
    () => songs.filter((song) => song.filePath && !song.filePath.startsWith('virtual:')),
    [songs]
  )
  const downloadedCount = downloadedSongs.length
  const missingCount = songs.length - downloadedCount
  const currentSong = queue[currentSongIndex]
  const isCurrentPlaylist = Boolean(currentSong && songs.some((song) => song.id === currentSong.id))
  const artworkUrl = toMediaUrl(playlist?.artworkPath)

  const playlistContext = useMemo(
    () => ({
      type: 'playlist' as const,
      id,
      title: playlist?.name || 'Playlist',
      route: `/playlists/${id}`
    }),
    [id, playlist?.name]
  )

  const togglePlaylist = () => {
    if (!allPlaylistSongs.length) return
    if (isCurrentPlaylist) {
      togglePlay()
    } else {
      setQueue(allPlaylistSongs, 0, playlistContext)
      if (!allPlaylistSongs[0]?.filePath || allPlaylistSongs[0].filePath.startsWith('virtual:')) {
        usePlayerStore.getState().setIsBuffering(true)
      }
    }
  }

  const handleShufflePlaylist = () => {
    if (!allPlaylistSongs.length) return
    if (!isShuffle) toggleShuffle()
    const randomIndex = Math.floor(Math.random() * allPlaylistSongs.length)
    setQueue(allPlaylistSongs, randomIndex, playlistContext)
    if (
      !allPlaylistSongs[randomIndex]?.filePath ||
      allPlaylistSongs[randomIndex].filePath.startsWith('virtual:')
    ) {
      usePlayerStore.getState().setIsBuffering(true)
    }
  }

  const handleTrackClick = (song: Song) => {
    downloadMissingPlaylistRef.current = false
    setIsDownloadingMissing(false)
    currentDownloadingSongIdRef.current = null

    const songIndex = allPlaylistSongs.findIndex((item) => item.id === song.id)
    const effectiveIndex = songIndex >= 0 ? songIndex : 0

    const isCurrentPlaying =
      isPlaying &&
      currentSong &&
      (currentSong.id === song.id ||
        (currentSong.title.toLowerCase() === song.title.toLowerCase() &&
          currentSong.artist?.toLowerCase() === song.artist?.toLowerCase()))

    if (isCurrentPlaying) {
      togglePlay()
      return
    }

    // Same-context stability: if this playlist is already playing, jump to the track in queue
    // to preserve shuffle order and playback history
    const isSamePlaylistContext =
      playbackContext?.type === 'playlist' &&
      playbackContext.id === id

    if (isSamePlaylistContext) {
      const existingQueueIndex = queue.findIndex(
        (item) =>
          item.id === song.id ||
          (item.title.toLowerCase() === song.title.toLowerCase() &&
            item.artist?.toLowerCase() === song.artist?.toLowerCase())
      )
      if (existingQueueIndex >= 0) {
        usePlayerStore.getState().playSong(existingQueueIndex)
        return
      }
    }

    setQueue(allPlaylistSongs, effectiveIndex, playlistContext)
  }

  const handleDownloadTrack = (song: Song, autoPlay = false) => {
    void downloadTrackInBackground(song, { autoPlay, openDrawer: false })
  }

  const handleChooseSource = (song: Song) => {
    onOpenDownloadPanel?.({
      id: song.id,
      title: song.title,
      artist: song.artist || '',
      album: song.album || '',
      duration: song.duration || 0,
      artworkPath: song.artworkPath,
      filePath: song.filePath,
      isOnline: !song.filePath || song.filePath.startsWith('virtual:'),
      autoDownload: false,
      autoPlay: false
    })
  }

  const handleDownloadMissing = () => {
    if (isDownloadingMissing) {
      downloadMissingPlaylistRef.current = false
      setIsDownloadingMissing(false)
      currentDownloadingSongIdRef.current = null
      return
    }

    failedSongIdsRef.current.clear()

    const firstMissing = songs.find(
      (song) =>
        (!song.filePath || song.filePath.startsWith('virtual:')) &&
        !failedSongIdsRef.current.has(song.id)
    )
    if (firstMissing) {
      downloadMissingPlaylistRef.current = true
      setIsDownloadingMissing(true)
      currentDownloadingSongIdRef.current = firstMissing.id
      void downloadTrackInBackground(firstMissing, { openDrawer: false })
    }
  }

  const removeSong = async (songId: string) => {
    const updated = await window.api.removeSongFromPlaylist(id, songId)
    setPlaylist(updated)
  }

  const renamePlaylist = async () => {
    const nextName = renameValue.trim()
    if (!nextName || !playlist) return
    setIsRenaming(true)
    setPlaylistActionError('')
    try {
      const updated = await window.api.renamePlaylist(id, nextName)
      setPlaylist(updated)
      setIsRenameOpen(false)
      setIsActionsOpen(false)
    } catch (error) {
      setPlaylistActionError(error instanceof Error ? error.message : 'Unable to rename playlist.')
    } finally {
      setIsRenaming(false)
    }
  }

  const deletePlaylist = async () => {
    if (!playlist) return
    if (!window.confirm(`Remove "${playlist.name}"? Songs will remain in your library.`)) return
    try {
      await window.api.deletePlaylist(id)
      window.dispatchEvent(new CustomEvent('felo:playlists-updated'))
      navigate('/playlists')
    } catch (error) {
      setPlaylistActionError(error instanceof Error ? error.message : 'Unable to remove playlist.')
    }
  }

  const publishOnline = async (): Promise<void> => {
    if (!playlist) return
    if (!configured) {
      setPublishMessage('Configure Supabase before using online playlists.')
      return
    }
    if (!user) {
      navigate('/account')
      return
    }

    setIsPublishing(true)
    setPublishMessage('')
    try {
      const sharedPlaylistId = await publishLocalPlaylist(playlist)
      setOnlinePlaylistId(sharedPlaylistId)
      setPublishMessage('Playlist published online. Invite a friend to collaborate.')
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : 'Unable to publish playlist.')
    } finally {
      setIsPublishing(false)
    }
  }

  const inviteFriend = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!onlinePlaylistId || !user || !inviteUsername.trim()) return
    setIsInviting(true)
    setInviteMessage('')
    try {
      const { data: person, error: profileError } = await getSupabase()
        .from('profiles')
        .select('id, display_name')
        .eq('username', inviteUsername.trim().toLowerCase())
        .maybeSingle()
      if (profileError || !person) throw profileError || new Error('Username not found.')
      if (person.id === user.id) throw new Error('You already own this playlist.')
      const { data: relationships, error: relationshipError } = await getSupabase()
        .from('friend_requests')
        .select('requester_id, addressee_id')
        .eq('status', 'accepted')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      if (relationshipError) throw relationshipError
      const isFriend = (relationships || []).some(
        (relationship) =>
          relationship.requester_id === person.id || relationship.addressee_id === person.id
      )
      if (!isFriend) throw new Error('Add this user as a friend before inviting them.')
      const { error: inviteError } = await getSupabase()
        .from('shared_playlist_members')
        .upsert({ playlist_id: onlinePlaylistId, user_id: person.id, role: 'editor' })
      if (inviteError) throw inviteError
      setInviteUsername('')
      setInviteMessage(`${person.display_name} can now edit this playlist.`)
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Could not invite friend.')
    } finally {
      setIsInviting(false)
    }
  }


  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#121212]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    )
  }

  if (!playlist) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#121212] text-[#b3b3b3]">
        <Music2 className="mb-5 h-14 w-14" />
        <h2 className="text-2xl font-black text-white">Playlist not found</h2>
        <button
          onClick={() => navigate('/playlists')}
          className="mt-5 rounded-full bg-white px-5 py-2 font-bold text-black"
        >
          Back to Playlists
        </button>
      </div>
    )
  }

  return (
    <div className="relative min-h-full overflow-x-hidden bg-[#121212] text-white pb-36 md:pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[450px] bg-[linear-gradient(180deg,rgba(91,43,7,0.92)_0%,rgba(47,24,7,0.7)_55%,rgba(18,18,18,0.96)_100%)]" />

      <header className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end text-center sm:text-left gap-5 sm:gap-8 px-4 sm:px-6 md:px-10 pb-6 sm:pb-8 pt-6 sm:pt-10">
        <div className="flex h-40 w-40 sm:h-[232px] sm:w-[232px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#222] shadow-[0_4px_60px_rgba(0,0,0,0.5)]">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="h-16 w-16 sm:h-20 sm:w-20 fill-[#5a5a5a] text-[#5a5a5a]" />
          )}
        </div>
        <div className="min-w-0 pb-1">
          <div className="mb-2 sm:mb-3 text-xs font-black uppercase tracking-[1px]">Playlist</div>
          <h1 className="max-w-full break-words text-2xl sm:text-4xl md:text-6xl xl:text-8xl font-black leading-tight sm:leading-[0.95] tracking-tight">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-2 sm:mt-4 max-w-2xl text-xs sm:text-sm text-white/70">{playlist.description}</p>
          )}
          <div className="mt-3 sm:mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs sm:text-sm">
            <span className="font-bold">
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </span>
            {AppCapabilities.downloads && (
              <span className="text-white/65">
                ({downloadedCount} downloaded
                {missingCount > 0 ? `, ${missingCount} not downloaded` : ''})
              </span>
            )}
            <span className="text-white/65">•</span>
            <span>Created {new Date(playlist.dateCreated * 1000).toLocaleDateString()}</span>
          </div>
        </div>
      </header>

      <div className="relative z-30 flex flex-wrap items-center gap-3 sm:gap-6 px-4 sm:px-6 md:px-10 py-4 sm:py-7">
        <button
          type="button"
          onClick={togglePlaylist}
          disabled={!allPlaylistSongs.length}
          title={
            !allPlaylistSongs.length
              ? 'Playlist has no songs'
              : isCurrentPlaylist && isPlaying
                ? 'Pause playlist'
                : 'Play playlist'
          }
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-lg transition-all hover:scale-105 hover:bg-white/90 disabled:opacity-40"
        >
          {isCurrentPlaylist && isPlaying ? (
            <Pause className="h-6 w-6 fill-current" />
          ) : (
            <Play className="ml-1 h-6 w-6 fill-current" />
          )}
        </button>
        <button
          type="button"
          onClick={handleShufflePlaylist}
          disabled={!allPlaylistSongs.length}
          title="Shuffle Playlist"
          className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-all hover:scale-105 cursor-pointer ${
            isShuffle
              ? 'border-white bg-white/10 text-white'
              : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
          } disabled:opacity-40`}
        >
          <Shuffle className="h-4 w-4" /> Shuffle
        </button>
        {AppCapabilities.downloads && (
          missingCount > 0 ? (
            <button
              type="button"
              onClick={handleDownloadMissing}
              title={
                isDownloadingMissing
                  ? 'Click to stop downloading missing tracks'
                  : `Download ${missingCount} missing tracks 1 by 1`
              }
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-md transition-all ${
                isDownloadingMissing
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-border/60 bg-surface-elevated text-white hover:bg-hover'
              }`}
            >
              {isDownloadingMissing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  <span>Downloading missing ({missingCount} left)...</span>
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  <span>Download missing ({missingCount})</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="All playlist tracks are stored locally"
              className="text-[#b3b3b3] disabled:opacity-50"
            >
              <Download className="h-9 w-9" />
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          title="Add songs"
          className="text-[#b3b3b3] transition-colors hover:text-white"
        >
          <Plus className="h-10 w-10" />
        </button>
        <button
          type="button"
          onClick={() => void publishOnline()}
          disabled={isPublishing || (configured && !initialized)}
          title={user ? 'Publish or update online playlist' : 'Sign in to publish online'}
          className="flex h-10 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-bold text-[#d8d8d8] transition-colors hover:border-white/50 hover:text-white disabled:opacity-50"
        >
          {isPublishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CloudUpload className="h-4 w-4" />
          )}
          {user ? 'Publish online' : 'Sign in to publish'}
        </button>
        <div className="relative">
          <button
            type="button"
            title="Playlist options"
            onClick={() => {
              setIsActionsOpen((open) => !open)
              setPlaylistActionError('')
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {isActionsOpen && (
            <div className="pointer-events-auto absolute right-0 top-12 z-50 w-52 rounded-lg border border-white/10 bg-[#282828] p-1.5 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setRenameValue(playlist.name)
                  setIsRenameOpen(true)
                  setPlaylistActionError('')
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                <Pencil className="h-4 w-4" /> Rename playlist
              </button>
              <button
                type="button"
                onClick={() => void deletePlaylist()}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-red-400 hover:bg-white/10"
              >
                <Trash2 className="h-4 w-4" /> Remove playlist
              </button>
            </div>
          )}
        </div>
        {publishMessage && <span className="text-sm text-text-muted">{publishMessage}</span>}
        {playlistActionError && <span className="text-sm text-red-300">{playlistActionError}</span>}
      </div>

      {onlinePlaylistId && user && (
        <form
          onSubmit={(event) => void inviteFriend(event)}
          className="mx-8 mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#1d1d1d] px-4 py-3"
        >
          <UserPlus className="h-5 w-5 shrink-0 text-text-muted" />
          <span className="text-sm font-bold text-white">Invite a friend to collaborate</span>
          <input
            value={inviteUsername}
            onChange={(event) => setInviteUsername(event.target.value)}
            placeholder="Friend username"
            className="h-9 min-w-[180px] flex-1 rounded-full border border-white/15 bg-[#121212] px-3 text-sm text-white outline-none focus:border-white/40"
          />
          <button
            type="submit"
            disabled={isInviting || !inviteUsername.trim()}
            className="h-9 rounded-full bg-white px-4 text-sm font-black text-black hover:bg-white/90 disabled:opacity-50"
          >
            {isInviting ? 'Inviting…' : 'Invite'}
          </button>
          {inviteMessage && (
            <span className="basis-full text-xs text-[#b3b3b3]">{inviteMessage}</span>
          )}
        </form>
      )}

      {isRenameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void renamePlaylist()
            }}
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#282828] p-5 shadow-2xl"
          >
            <h2 className="text-lg font-black text-white">Rename playlist</h2>
            <p className="mt-1 text-sm text-[#b3b3b3]">Choose a new name for this playlist.</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="mt-4 w-full rounded-md border border-white/15 bg-[#181818] px-3 py-2.5 text-sm text-white outline-none focus:border-white/40"
              maxLength={120}
            />
            {playlistActionError && (
              <p className="mt-2 text-xs text-red-300">{playlistActionError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="rounded-full px-4 py-2 text-sm font-bold text-[#b3b3b3] hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenaming || !renameValue.trim()}
                className="rounded-full bg-white px-5 py-2 text-sm font-black text-black hover:bg-white/90 disabled:opacity-50"
              >
                {isRenaming ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="relative z-10 w-full min-w-0 px-4 pb-28 md:px-6 xl:px-10">
        <div className="w-full min-w-0">
          <div className="grid h-10 grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 border-b border-white/10 px-2 text-xs uppercase tracking-[1px] text-[#a7a7a7] md:grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_64px] md:gap-3 xl:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_minmax(0,1.1fr)_64px] xl:gap-4 xl:px-4">
            <span>#</span>
            <span>Title</span>
            <span className="hidden min-w-0 md:block">Album</span>
            <span className="hidden min-w-0 xl:block">Date added</span>
            <span className="hidden min-w-0 xl:block">Status / Quality</span>
            <Clock3 className="ml-auto h-4 w-4" />
          </div>

          {songs.length ? (
            songs.map((song, index) => {
              const isDownloaded = Boolean(song.filePath && !song.filePath.startsWith('virtual:'))
              const isCurrent = isDownloaded && currentSong?.id === song.id
              const isPlayingSong = isCurrent && isPlaying
              const songArtwork = toMediaUrl(song.artworkPath) || song.artworkUrl
              return (
                <div
                  key={song.id}
                  onClick={() => handleTrackClick(song)}
                  onDoubleClick={(event) => event.preventDefault()}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const menuWidth = 220
                    const menuHeight = 260
                    setActiveSongMenu({
                      song,
                      x: Math.min(e.clientX, window.innerWidth - menuWidth - 12),
                      y: Math.min(e.clientY, window.innerHeight - menuHeight - 12)
                    })
                  }}
                  className={`group grid h-16 w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 rounded px-2 text-sm hover:bg-white/10 md:grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_64px] md:gap-3 xl:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_minmax(0,1.1fr)_64px] xl:gap-4 xl:px-4 ${
                    isCurrent ? 'bg-white/10' : !isDownloaded ? 'opacity-75 hover:opacity-100' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isDownloaded) {
                        const dlIndex = downloadedSongs.findIndex((s) => s.id === song.id)
                        if (dlIndex >= 0) setQueue(downloadedSongs, dlIndex, playlistContext)
                      } else {
                        handleDownloadTrack(song)
                      }
                    }}
                    className={`relative flex h-8 items-center justify-start ${
                      isPlayingSong ? 'text-primary-amber' : 'text-[#a7a7a7]'
                    }`}
                  >
                    <span className="group-hover:hidden">{index + 1}</span>
                    {isDownloaded ? (
                      <Play
                        className={`hidden h-4 w-4 fill-current group-hover:block ${
                          isPlayingSong ? 'text-primary-amber' : 'text-white'
                        }`}
                      />
                    ) : (
                      <Download className="hidden h-4 w-4 text-white group-hover:block" />
                    )}
                  </button>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828]">
                      <ArtworkImage
                        src={songArtwork}
                        title={song.title}
                        artist={song.artist}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-[16px] ${
                            isPlayingSong ? 'text-primary-amber' : 'text-white'
                          }`}
                        >
                          {song.title}
                        </span>
                        {!isDownloaded && (
                          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                            Missing
                          </span>
                        )}
                      </div>
                      <div className="block max-w-full truncate text-left text-sm text-[#a7a7a7]">
                        <ArtistLinks
                          artist={song.artist}
                          artists={song.artists}
                          linkClassName="text-[#a7a7a7] hover:text-white hover:underline text-sm"
                          separatorClassName="text-[#a7a7a7]/60"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="hidden min-w-0 truncate text-[#c4cad4] md:block">
                    {song.album || 'Unknown Album'}
                  </div>
                  <div
                    className="hidden min-w-0 truncate text-[#c4cad4] xl:block"
                    title={new Date(song.playlistDateAdded * 1000).toLocaleString()}
                  >
                    {formatRelativeDate(song.playlistDateAdded)}
                  </div>
                  <div className="hidden min-w-0 items-center gap-2 overflow-hidden text-[#c4cad4] xl:flex">
                    {isDownloaded ? (
                      <>
                        <span className="hidden shrink-0 font-mono text-xs text-[#9ba7ba] 2xl:inline">
                          {formatBytes(song.size)}
                        </span>
                        <span className="truncate">{qualityLabel(song)}</span>
                      </>
                    ) : AppCapabilities.downloads ? (
                      (() => {
                        const transfer = transfers.find(
                          (t) =>
                            t.title.toLowerCase() === song.title.toLowerCase() &&
                            (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
                            (t.status === 'downloading' || t.status === 'queued')
                        )
                        const isDownloading = Boolean(transfer)
                        return isDownloading ? (
                          <span className="flex items-center gap-1.5 text-xs text-primary-amber">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Downloading ({transfer?.progress || 0}%)...
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDownloadTrack(song, false)
                            }}
                            className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-white transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download track
                          </button>
                        )
                      })()
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {!isDownloaded && AppCapabilities.downloads && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDownloadTrack(song, false)
                        }}
                        title="Download to library"
                        className="h-8 w-8 shrink-0 rounded-[3px] flex items-center justify-center text-text-muted hover:text-white transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        const menuWidth = 220
                        const menuHeight = 160
                        setActiveSongMenu((current) =>
                          current?.song.id === song.id
                            ? null
                            : {
                                song,
                                x: Math.min(
                                  rect.right - menuWidth,
                                  window.innerWidth - menuWidth - 12
                                ),
                                y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
                              }
                        )
                      }}
                      title="More options"
                      className={`h-8 w-8 shrink-0 rounded-[3px] border flex items-center justify-center transition-all ${
                        activeSongMenu?.song.id === song.id
                          ? 'border-primary-amber bg-hover text-text opacity-100'
                          : 'border-transparent text-[#b3b3b3] opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:border-primary-amber hover:bg-hover hover:text-white'
                      }`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    <span className="tabular-nums text-[#c4cad4] group-hover:hidden">
                      {formatDuration(song.duration)}
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-center text-[#a7a7a7]">
              <Music2 className="mb-4 h-12 w-12" />
              <h2 className="text-xl font-black text-white">This playlist is empty</h2>
              <p className="mt-2 text-sm">Add songs from your local library.</p>
              <button
                type="button"
                onClick={() => setIsAddOpen(true)}
                className="mt-5 flex items-center gap-2 rounded-full bg-white px-5 py-2 font-bold text-black"
              >
                <Plus className="h-4 w-4" /> Add songs
              </button>
            </div>
          )}
        </div>
      </div>

      {activeSongMenu &&
        createPortal(
          <div
            className="fixed z-[9999] w-[220px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)]"
            style={{ left: activeSongMenu.x, top: activeSongMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                handleTrackClick(activeSongMenu.song)
                setActiveSongMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <Play className="h-4 w-4 fill-current" />
              Play
            </button>
            <button
              type="button"
              onClick={() => {
                enqueueSong(activeSongMenu.song)
                setActiveSongMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <ListPlus className="h-4 w-4" />
              Add to Queue
            </button>
            {activeSongMenu.song.album && (
              <button
                type="button"
                onClick={() => {
                  navigate(`/album/${encodeURIComponent(activeSongMenu.song.album || '')}`)
                  setActiveSongMenu(null)
                }}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
              >
                <Disc3 className="h-4 w-4" />
                Go to Album
              </button>
            )}
            {(() => {
              const menuArtists =
                activeSongMenu.song.artists && activeSongMenu.song.artists.length > 0
                  ? activeSongMenu.song.artists
                  : parseArtists(activeSongMenu.song.artist)

              if (menuArtists.length <= 1) {
                const artistName = menuArtists[0]?.name || activeSongMenu.song.artist || 'Unknown Artist'
                return (
                  <button
                    type="button"
                    onClick={() => {
                      navigate(`/artist/${encodeURIComponent(artistName)}`)
                      setActiveSongMenu(null)
                    }}
                    className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                  >
                    <User className="h-4 w-4" />
                    Go to Artist
                  </button>
                )
              }

              const isNearRightEdge = activeSongMenu.x > window.innerWidth - 440
              const isNearBottomEdge = activeSongMenu.y > window.innerHeight - 250

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
                          setActiveSongMenu(null)
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
                setCreditsSong(activeSongMenu.song)
                setActiveSongMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            >
              <FileText className="h-4 w-4" />
              Show Credits
            </button>
            {AppCapabilities.downloads && (
              <>
                {(!activeSongMenu.song.filePath || activeSongMenu.song.filePath.startsWith('virtual:')) && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDownloadTrack(activeSongMenu.song, false)
                      setActiveSongMenu(null)
                    }}
                    className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                  >
                    <Download className="h-4 w-4" />
                    Download to library
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    handleChooseSource(activeSongMenu.song)
                    setActiveSongMenu(null)
                  }}
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text"
                >
                  <Download className="h-4 w-4" />
                  Choose download source...
                </button>
              </>
            )}
            <div className="mx-2 my-1 h-px bg-white/10" />
            <button
              type="button"
              onClick={() => {
                void removeSong(activeSongMenu.song.id)
                setActiveSongMenu(null)
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
            >
              <Trash2 className="h-4 w-4 fill-current" />
              Remove from playlist
            </button>
          </div>,
          document.body
        )}

      {isAddOpen && (
        <AddSongsModal
          playlist={playlist}
          librarySongs={librarySongs}
          onClose={() => setIsAddOpen(false)}
          onUpdated={setPlaylist}
        />
      )}

      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </div>
  )
}

function AddSongsModal({
  playlist,
  librarySongs,
  onClose,
  onUpdated
}: {
  playlist: Playlist
  librarySongs: Song[]
  onClose: () => void
  onUpdated: (playlist: Playlist) => void
}) {
  const [query, setQuery] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)
  const playlistIds = useMemo(
    () => new Set((playlist.songs || []).map((song) => song.id)),
    [playlist.songs]
  )
  const availableSongs = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return librarySongs.filter(
      (song) =>
        !playlistIds.has(song.id) &&
        (!normalized ||
          song.title.toLowerCase().includes(normalized) ||
          song.artist?.toLowerCase().includes(normalized) ||
          song.album?.toLowerCase().includes(normalized))
    )
  }, [librarySongs, playlistIds, query])

  const addSong = async (songId: string) => {
    try {
      setAddingId(songId)
      onUpdated(await window.api.addSongToPlaylist(playlist.id, songId))
    } finally {
      setAddingId(null)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/75 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#202020] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <h2 className="text-xl font-black">Add songs</h2>
            <p className="mt-1 text-sm text-[#a7a7a7]">Choose tracks from your local library.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="p-1 text-[#b3b3b3] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="flex h-11 items-center gap-3 rounded-full bg-[#121212] px-4">
            <Search className="h-4 w-4 text-[#a7a7a7]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your library"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {availableSongs.length ? (
            availableSongs.map((song) => {
              const artwork = toMediaUrl(song.artworkPath) || song.artworkUrl
              return (
                <div
                  key={song.id}
                  className="flex h-16 items-center gap-3 rounded px-3 hover:bg-white/10"
                >
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828]">
                    <ArtworkImage
                      src={artwork}
                      title={song.title}
                      artist={song.artist}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{song.title}</div>
                    <div className="truncate text-sm text-[#a7a7a7]">{song.artist}</div>
                  </div>
                  <button
                    type="button"
                    disabled={addingId === song.id}
                    onClick={() => void addSong(song.id)}
                    className="rounded-full border border-white/40 px-4 py-1.5 text-sm font-bold hover:border-white hover:bg-white hover:text-black disabled:opacity-50"
                  >
                    {addingId === song.id ? 'Adding...' : 'Add'}
                  </button>
                </div>
              )
            })
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-[#a7a7a7]">
              No available songs found.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
