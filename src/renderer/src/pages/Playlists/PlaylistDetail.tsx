import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Clock3,
  CloudUpload,
  Download,
  Loader2,
  Music2,
  MoreVertical,
  Pencil,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'
import { publishLocalPlaylist } from '../../lib/onlinePlaylists'
import { getSupabase } from '../../lib/supabase'
import { Song } from '../Library/Library'
import { Playlist } from './types'

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

function songMatchKey(title: string, artist = ''): string {
  return `${title}::${artist}`
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findMatchingLibrarySong(playlistSong: Song, librarySongs: Song[]): Song | undefined {
  const normalize = (value: string) => songMatchKey(value)
  const playlistTitle = normalize(playlistSong.title || '')
  const playlistArtist = normalize(playlistSong.artist || '')
  const titleCandidates = [playlistTitle]
  const displayTitle = playlistSong.title || ''
  const dashIndex = displayTitle.indexOf(' - ')
  if (dashIndex >= 0) titleCandidates.push(normalize(displayTitle.slice(dashIndex + 3)))

  return librarySongs.find((local) => {
    if (!local?.filePath || local.filePath.startsWith('virtual:')) return false
    const localTitle = normalize(local.title || '')
    const localArtist = normalize(local.artist || '')
    const titleMatches = titleCandidates.some(
      (candidate) =>
        candidate === localTitle || candidate.includes(localTitle) || localTitle.includes(candidate)
    )
    if (!titleMatches) return false
    return (
      !playlistArtist ||
      playlistArtist === 'unknown artist' ||
      localArtist === playlistArtist ||
      localArtist.includes(playlistArtist) ||
      playlistArtist.includes(localArtist)
    )
  })
}

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
  const { queue, currentSongIndex, isPlaying, setQueue, enqueueSong, togglePlay } = usePlayerStore()
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
  const downloadMissingPlaylistRef = useRef(false)

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
      if (event?.status !== 'completed') return
      try {
        const { nextPlaylist, nextSongs } = await refreshPlaylistAndLibrary()
        if (!downloadMissingPlaylistRef.current || !nextPlaylist) return

        const completedLocalSong = event.song?.id
          ? nextSongs.find((song) => song.id === event.song.id)
          : nextSongs.find(
              (song) =>
                songMatchKey(song.title || '') === songMatchKey(event.song?.title || '') &&
                songMatchKey(song.artist || '') === songMatchKey(event.song?.artist || '')
            )
        if (completedLocalSong) enqueueSong(completedLocalSong)

        // Stop after the selected track. The next missing track is downloaded
        // only when the user selects it, matching Infinite Radio behavior.
        downloadMissingPlaylistRef.current = false
      } catch (error) {
        console.error('Failed to continue playlist downloads:', error)
      }
    })
    return () => {
      window.removeEventListener('felo:library-updated', handleUpdate)
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
        const localMatch = findMatchingLibrarySong(song, librarySongs)
        return localMatch ? { ...song, ...localMatch, id: localMatch.id } : song
      }),
    [librarySongs, playlistSongs]
  )
  const downloadedSongs = useMemo(
    () => songs.filter((song) => song.filePath && !song.filePath.startsWith('virtual:')),
    [songs]
  )
  const downloadedCount = downloadedSongs.length
  const missingCount = songs.length - downloadedCount
  const currentSong = queue[currentSongIndex]
  const isCurrentPlaylist = Boolean(currentSong && songs.some((song) => song.id === currentSong.id))
  const artworkUrl = toMediaUrl(playlist?.artworkPath)

  const togglePlaylist = () => {
    if (!downloadedSongs.length) return
    if (isCurrentPlaylist) togglePlay()
    else setQueue(downloadedSongs, 0)
  }

  const handleTrackClick = (song: Song) => {
    if (song.filePath && !song.filePath.startsWith('virtual:')) {
      // An explicit local-track selection should not continue a background
      // "download missing" sequence or trigger the next missing track.
      downloadMissingPlaylistRef.current = false
      const dlIndex = downloadedSongs.findIndex((item) => item.id === song.id)
      if (dlIndex >= 0) setQueue(downloadedSongs, dlIndex)
      return
    }
    downloadMissingPlaylistRef.current = false
    handleDownloadTrack(song)
  }

  const handleDownloadTrack = (song: Song, autoPlay = true) => {
    onOpenDownloadPanel?.({
      id: song.id,
      title: song.title,
      artist: song.artist || '',
      album: song.album || '',
      duration: song.duration || 0,
      artworkPath: song.artworkPath,
      isOnline: true,
      autoDownload: true,
      autoPlay
    })
  }

  const handleDownloadMissing = () => {
    const firstMissing = songs.find(
      (song) => !song.filePath || song.filePath.startsWith('virtual:')
    )
    if (firstMissing) {
      downloadMissingPlaylistRef.current = true
      handleDownloadTrack(firstMissing)
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

  const openArtist = (event: React.MouseEvent, artistName?: string) => {
    event.stopPropagation()
    const targetArtist = artistName?.trim()
    if (!targetArtist) return
    navigate(`/artist/${encodeURIComponent(targetArtist)}`)
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
    <div className="relative min-h-full overflow-x-hidden bg-[#121212] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[450px] bg-[linear-gradient(180deg,rgba(91,43,7,0.92)_0%,rgba(47,24,7,0.7)_55%,rgba(18,18,18,0.96)_100%)]" />

      <header className="relative z-10 flex min-h-[310px] items-end gap-8 px-10 pb-8 pt-10">
        <div className="flex h-[232px] w-[232px] shrink-0 items-center justify-center overflow-hidden rounded bg-[#222] shadow-[0_4px_60px_rgba(0,0,0,0.5)]">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="h-20 w-20 fill-[#5a5a5a] text-[#5a5a5a]" />
          )}
        </div>
        <div className="min-w-0 pb-1">
          <div className="mb-3 text-xs font-black uppercase tracking-[1px]">Playlist</div>
          <h1 className="max-w-full break-words text-5xl font-black leading-[0.95] tracking-normal md:text-7xl xl:text-8xl">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-4 max-w-2xl text-sm text-white/70">{playlist.description}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold">
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </span>
            <span className="text-white/65">
              ({downloadedCount} downloaded
              {missingCount > 0 ? `, ${missingCount} not downloaded` : ''})
            </span>
            <span className="text-white/65">•</span>
            <span>Created {new Date(playlist.dateCreated * 1000).toLocaleDateString()}</span>
          </div>
        </div>
      </header>

      <div className="relative z-30 flex items-center gap-7 px-10 py-7">
        <button
          type="button"
          onClick={togglePlaylist}
          disabled={!downloadedSongs.length}
          title={
            !downloadedSongs.length
              ? 'Download tracks to play locally'
              : isCurrentPlaylist && isPlaying
                ? 'Pause playlist'
                : 'Play playlist'
          }
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2a2a2a] text-white shadow-lg transition-all hover:scale-105 hover:bg-[#353535] disabled:opacity-40"
        >
          {isCurrentPlaylist && isPlaying ? (
            <Pause className="h-6 w-6 fill-current" />
          ) : (
            <Play className="ml-1 h-6 w-6 fill-current" />
          )}
        </button>
        {missingCount > 0 ? (
          <button
            type="button"
            onClick={handleDownloadMissing}
            title={`Download ${missingCount} missing tracks`}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-[#2a2a2a] px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-[#353535]"
          >
            <Download className="h-5 w-5" />
            <span>Download missing ({missingCount})</span>
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
        {publishMessage && <span className="text-sm text-[#1ed760]">{publishMessage}</span>}
        {playlistActionError && <span className="text-sm text-red-300">{playlistActionError}</span>}
      </div>

      {onlinePlaylistId && user && (
        <form
          onSubmit={(event) => void inviteFriend(event)}
          className="mx-8 mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#1d1d1d] px-4 py-3"
        >
          <UserPlus className="h-5 w-5 shrink-0 text-[#1ed760]" />
          <span className="text-sm font-bold text-white">Invite a friend to collaborate</span>
          <input
            value={inviteUsername}
            onChange={(event) => setInviteUsername(event.target.value)}
            placeholder="Friend username"
            className="h-9 min-w-[180px] flex-1 rounded-full border border-white/15 bg-[#121212] px-3 text-sm text-white outline-none focus:border-[#1ed760]"
          />
          <button
            type="submit"
            disabled={isInviting || !inviteUsername.trim()}
            className="h-9 rounded-full bg-[#1ed760] px-4 text-sm font-black text-black disabled:opacity-50"
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
              className="mt-4 w-full rounded-md border border-white/15 bg-[#181818] px-3 py-2.5 text-sm text-white outline-none focus:border-[#1ed760]"
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
                className="rounded-full bg-[#1ed760] px-5 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                {isRenaming ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="relative z-10 w-full min-w-0 px-4 pb-28 md:px-6 xl:px-10">
        <div className="w-full min-w-0">
          <div className="grid h-10 grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-2 border-b border-white/10 px-2 text-xs uppercase tracking-[1px] text-[#a7a7a7] md:grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_64px] md:gap-3 xl:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_minmax(0,1.1fr)_64px] xl:gap-4 xl:px-4">
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
              const songArtwork = toMediaUrl(song.artworkPath)
              return (
                <div
                  key={song.id}
                  onClick={() => handleTrackClick(song)}
                  onDoubleClick={(event) => event.preventDefault()}
                  className={`group grid h-16 w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-2 rounded px-2 text-sm hover:bg-white/10 md:grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_64px] md:gap-3 xl:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_minmax(0,1.1fr)_64px] xl:gap-4 xl:px-4 ${
                    isCurrent ? 'bg-white/10' : !isDownloaded ? 'opacity-75 hover:opacity-100' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isDownloaded) {
                        const dlIndex = downloadedSongs.findIndex((s) => s.id === song.id)
                        if (dlIndex >= 0) setQueue(downloadedSongs, dlIndex)
                      } else {
                        handleDownloadTrack(song)
                      }
                    }}
                    className={`relative flex h-8 items-center justify-start ${
                      isPlayingSong ? 'text-[#1ed760]' : 'text-[#a7a7a7]'
                    }`}
                  >
                    <span className="group-hover:hidden">{index + 1}</span>
                    {isDownloaded ? (
                      <Play
                        className={`hidden h-4 w-4 fill-current group-hover:block ${
                          isPlayingSong ? 'text-[#1ed760]' : 'text-white'
                        }`}
                      />
                    ) : (
                      <Download className="hidden h-4 w-4 text-white group-hover:block" />
                    )}
                  </button>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828]">
                      {songArtwork ? (
                        <img src={songArtwork} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Music2 className="h-5 w-5 text-[#666]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-[16px] ${
                            isPlayingSong ? 'text-[#1ed760]' : 'text-white'
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
                      <button
                        type="button"
                        onClick={(event) => openArtist(event, song.artist)}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className="block max-w-full truncate text-left text-sm text-[#a7a7a7] transition-colors hover:text-white hover:underline"
                      >
                        {song.artist || 'Unknown Artist'}
                      </button>
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
                    ) : (
                      <span className="text-xs text-amber-300">Click track to download</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        const menuWidth = 220
                        const menuHeight = 136
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
                          : 'border-transparent text-[#b3b3b3] opacity-0 group-hover:opacity-100 hover:border-primary-amber hover:bg-hover hover:text-white'
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
              {activeSongMenu.song.filePath &&
              !activeSongMenu.song.filePath.startsWith('virtual:') ? (
                <Play className="h-4 w-4 fill-current" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {activeSongMenu.song.filePath && !activeSongMenu.song.filePath.startsWith('virtual:')
                ? 'Play'
                : 'Download'}
            </button>
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

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-6"
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
              const artwork = toMediaUrl(song.artworkPath)
              return (
                <div
                  key={song.id}
                  className="flex h-16 items-center gap-3 rounded px-3 hover:bg-white/10"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-[#282828]">
                    {artwork ? (
                      <img src={artwork} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Music2 className="h-5 w-5 text-[#666]" />
                    )}
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
    </div>
  )
}
