import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, Music2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useShallow } from 'zustand/react/shallow'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import { publishLocalPlaylist } from '../../lib/onlinePlaylists'
import { downloadTrackInBackground } from '../../lib/backgroundDownloader'
import type { Song } from '../Library/Library'
import type { Playlist } from './types'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'
import { findMatchingLibrarySong } from '../../lib/songMatching'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import { AppCapabilities } from '../../lib/appConfig'

import { PlaylistDetailHeader } from './components/PlaylistDetailHeader'
import { PlaylistTrackRow } from './components/PlaylistTrackRow'
import { PlaylistSongMenu } from './components/PlaylistSongMenu'
import { AddSongsModal } from './components/AddSongsModal'

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
      enqueueSong: s.enqueueSong,
      togglePlay: s.togglePlay,
      toggleShuffle: s.toggleShuffle,
      playbackContext: s.playbackContext
    }))
  )
  const transfers = useDownloadStore((s) => s.transfers)
  const configured = useOnlineStore((s) => s.configured)
  const initialized = useOnlineStore((s) => s.initialized)
  const user = useOnlineStore((s) => s.user)
  const { requestPlayQueue } = usePlaybackArbitration()
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
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
      if (window.api?.getPlaylist) {
        setPlaylist((await window.api.getPlaylist(id)) as Playlist | null)
      } else {
        const hasLanHost = Boolean(remoteClient.getBaseUrl() && !remoteClient.getBaseUrl().includes('localhost'))
        if (remoteClient.getIsConnected() || hasLanHost) {
          const res = await remoteLibraryService.getPlaylistTracks(id)
          setPlaylist({
            id: res.playlist.id,
            name: res.playlist.name,
            description: res.playlist.description,
            dateCreated: (res.playlist as any).dateModified ? (res.playlist as any).dateModified * 1000 : Date.now(),
            dateModified: (res.playlist as any).dateModified ? (res.playlist as any).dateModified * 1000 : Date.now(),
            songCount: res.tracks.length,
            songs: res.tracks.map((r, idx) => ({
              id: r.id,
              title: r.title,
              artist: r.artist,
              album: r.album,
              duration: r.duration,
              filePath: r.audioUrl || remoteClient.getAudioStreamUrl(r.id),
              artworkUrl: r.artworkUrl,
              artworkPath: r.artworkUrl,
              isOnline: true,
              playlistDateAdded: Date.now(),
              playlistSortOrder: idx
            }))
          })
        }
      }
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
    if (window.api?.getSongs) {
      window.api
        .getSongs()
        .then((songs) => setLibrarySongs(songs || []))
        .catch(console.error)
    } else {
      const pcSongs = useConnectedDeviceStore.getState().pcLibrarySongs
      setLibrarySongs(pcSongs || [])
    }

    const refreshPlaylistAndLibrary = async () => {
      if (!window.api?.getPlaylist || !window.api?.getSongs) {
        return { nextPlaylist: playlist, nextSongs: librarySongs }
      }
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
      requestPlayQueue(allPlaylistSongs, 0, playlistContext)
      if (!allPlaylistSongs[0]?.filePath || allPlaylistSongs[0].filePath.startsWith('virtual:')) {
        usePlayerStore.getState().setIsBuffering(true)
      }
    }
  }

  const handleShufflePlaylist = () => {
    if (!allPlaylistSongs.length) return
    if (!isShuffle) toggleShuffle()
    const randomIndex = Math.floor(Math.random() * allPlaylistSongs.length)
    requestPlayQueue(allPlaylistSongs, randomIndex, playlistContext)
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

    const isDownloaded = Boolean(song.filePath && !song.filePath.startsWith('virtual:'))
    if (!isDownloaded && AppCapabilities.downloads) {
      handleChooseSource(song)
      return
    }

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
        requestPlayQueue(queue, existingQueueIndex, playlistContext)
        return
      }
    }

    requestPlayQueue(allPlaylistSongs, effectiveIndex, playlistContext)
  }

  const handleDownloadTrack = (song: Song, autoPlay = false) => {
    if (onOpenDownloadPanel) {
      handleChooseSource(song)
      return
    }
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
    if (!window.api?.removeSongFromPlaylist) return
    const updated = await window.api.removeSongFromPlaylist(id, songId)
    setPlaylist(updated)
  }

  const renamePlaylist = async (nextName: string) => {
    if (!window.api?.renamePlaylist || !playlist) return
    setPlaylistActionError('')
    try {
      const updated = await window.api.renamePlaylist(id, nextName)
      setPlaylist(updated)
    } catch (error) {
      setPlaylistActionError(error instanceof Error ? error.message : 'Unable to rename playlist.')
      throw error
    }
  }

  const deletePlaylist = async () => {
    if (!window.api?.deletePlaylist || !playlist) return
    if (!window.confirm(`Remove "${playlist.name}"? Songs will remain in your library.`)) return
    try {
      await window.api.deletePlaylist(id)
      window.dispatchEvent(new CustomEvent('felo:playlists-updated'))
      navigate('/playlists')
    } catch (error) {
      setPlaylistActionError(error instanceof Error ? error.message : 'Unable to remove playlist.')
    }
  }

  const publishToProfile = async (): Promise<void> => {
    if (!playlist) return
    if (!configured) {
      setPublishMessage('Sign in to publish playlist to your profile.')
      return
    }
    if (!user) {
      navigate('/account')
      return
    }

    setIsPublishing(true)
    setPublishMessage('')
    try {
      await publishLocalPlaylist(playlist)
      setPublishMessage('Playlist published to your profile.')
      setTimeout(() => setPublishMessage(''), 4000)
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : 'Unable to publish playlist.')
    } finally {
      setIsPublishing(false)
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
          className="mt-5 rounded-full bg-white px-5 py-2 font-bold text-black cursor-pointer"
        >
          Back to Playlists
        </button>
      </div>
    )
  }

  return (
    <div className="relative min-h-full flex-1 overflow-x-hidden bg-[#121212] text-white pb-36 md:pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[450px] bg-[linear-gradient(180deg,rgba(91,43,7,0.92)_0%,rgba(47,24,7,0.7)_55%,rgba(18,18,18,0.96)_100%)]" />

      <PlaylistDetailHeader
        playlist={playlist}
        artworkUrl={artworkUrl || undefined}
        songsCount={songs.length}
        downloadedCount={downloadedCount}
        missingCount={missingCount}
        isCurrentPlaylist={isCurrentPlaylist}
        isPlaying={isPlaying}
        isShuffle={isShuffle}
        isDownloadingMissing={isDownloadingMissing}
        isPublishing={isPublishing}
        configured={configured}
        initialized={initialized}
        hasUser={Boolean(user)}
        publishMessage={publishMessage}
        playlistActionError={playlistActionError}
        setPlaylistActionError={setPlaylistActionError}
        onTogglePlay={togglePlaylist}
        onShuffle={handleShufflePlaylist}
        onDownloadMissing={handleDownloadMissing}
        onAddSongs={() => setIsAddOpen(true)}
        onPublish={() => void publishToProfile()}
        onRename={renamePlaylist}
        onDelete={deletePlaylist}
      />

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

              const transfer = transfers.find(
                (t) =>
                  t.title.toLowerCase() === song.title.toLowerCase() &&
                  (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
                  (t.status === 'downloading' || t.status === 'queued')
              )

              return (
                <PlaylistTrackRow
                  key={song.id}
                  song={song}
                  index={index}
                  isCurrent={isCurrent}
                  isPlayingSong={isPlayingSong}
                  isDownloaded={isDownloaded}
                  downloadTransfer={transfer}
                  onTrackClick={handleTrackClick}
                  onPlayOrDownload={(s) => {
                    if (isDownloaded) {
                      const dlIndex = downloadedSongs.findIndex((item) => item.id === s.id)
                      if (dlIndex >= 0) requestPlayQueue(downloadedSongs, dlIndex, playlistContext)
                    } else {
                      handleDownloadTrack(s)
                    }
                  }}
                  onDownloadTrack={(s) => handleDownloadTrack(s, false)}
                  onOpenMenu={(s, rect) => {
                    const menuWidth = 220
                    const menuHeight = 260
                    setActiveSongMenu({
                      song: s,
                      x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
                      y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
                    })
                  }}
                />
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
                className="mt-5 flex items-center gap-2 rounded-full bg-white px-5 py-2 font-bold text-black hover:bg-white/90 transition-all cursor-pointer shadow-md"
              >
                <span>Add songs</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {activeSongMenu && (
        <PlaylistSongMenu
          song={activeSongMenu.song}
          x={activeSongMenu.x}
          y={activeSongMenu.y}
          onClose={() => setActiveSongMenu(null)}
          onPlay={handleTrackClick}
          onEnqueue={enqueueSong}
          onShowCredits={setCreditsSong}
          onDownloadTrack={(s) => handleDownloadTrack(s, false)}
          onChooseSource={handleChooseSource}
          onRemove={(songId) => void removeSong(songId)}
        />
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
