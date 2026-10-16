import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { Playlist } from './types'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import CreatePlaylistModal from './CreatePlaylistModal'
import { PlaylistsHeader } from './components/PlaylistsHeader'
import { PlaylistCard } from './components/PlaylistCard'
import { PlaylistContextMenu } from './components/PlaylistContextMenu'
import { PlaylistsEmptyState } from './components/PlaylistsEmptyState'

export default function Playlists() {
  const navigate = useNavigate()
  const { requestPlayQueue } = usePlaybackArbitration()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<{
    playlist: Playlist
    x: number
    y: number
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPlaylists = async () => {
    try {
      setIsLoading(true)
      setError('')
      if (window.api?.getPlaylists) {
        setPlaylists((await window.api.getPlaylists()) || [])
      } else {
        const hasLanHost = Boolean(remoteClient.getBaseUrl() && !remoteClient.getBaseUrl().includes('localhost'))
        if (remoteClient.getIsConnected() || hasLanHost) {
          const remotePlaylists = await remoteLibraryService.getPlaylists()
          setPlaylists(
            remotePlaylists.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              songCount: p.trackCount,
              dateCreated: p.dateModified ? p.dateModified * 1000 : Date.now(),
              dateModified: p.dateModified ? p.dateModified * 1000 : Date.now(),
              artworkUrl: p.artworkUrl
            }))
          )
        } else {
          setPlaylists([])
        }
      }
    } catch (err) {
      console.error('Failed to load playlists:', err)
      setError('Failed to load playlists.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadPlaylists()
  }, [])

  useEffect(() => {
    const closeMenu = () => setActiveMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
    }
  }, [])

  const filteredPlaylists = useMemo(() => {
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
    if (tokens.length === 0) return playlists
    return playlists.filter((playlist) => {
      const combined = `${playlist.name} ${playlist.description || ''}`.toLowerCase()
      return tokens.every((token) => combined.includes(token))
    })
  }, [playlists, searchQuery])

  const playPlaylist = async (playlistId: string) => {
    let playlist: Playlist | null = null
    if (window.api?.getPlaylist) {
      playlist = (await window.api.getPlaylist(playlistId)) as Playlist | null
    } else {
      const hasLanHost = Boolean(remoteClient.getBaseUrl() && !remoteClient.getBaseUrl().includes('localhost'))
      if (remoteClient.getIsConnected() || hasLanHost) {
        try {
          const res = await remoteLibraryService.getPlaylistTracks(playlistId)
          playlist = {
            id: res.playlist.id,
            name: res.playlist.name,
            description: res.playlist.description,
            dateCreated: Date.now(),
            dateModified: Date.now(),
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
          }
        } catch (err) {
          console.warn('Failed to load remote playlist tracks:', err)
        }
      }
    }

    if (playlist?.songs?.length) {
      void requestPlayQueue(playlist.songs, 0, {
        type: 'playlist',
        id: playlistId,
        title: playlist.name,
        route: `/playlists/${playlistId}`
      })
    }
  }

  const renamePlaylist = async (playlistId: string) => {
    if (!window.api?.renamePlaylist) return
    const playlist = playlists.find((item) => item.id === playlistId)
    const nextName = window.prompt('Rename playlist', playlist?.name || '')?.trim()
    if (!nextName || nextName === playlist?.name) return
    try {
      const updated = await window.api.renamePlaylist(playlistId, nextName)
      setPlaylists((current) =>
        current.map((item) => (item.id === playlistId ? { ...item, ...updated } : item))
      )
      setActiveMenu(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename playlist.')
    }
  }

  const deletePlaylist = async (playlistId: string) => {
    if (!window.api?.deletePlaylist) return
    const playlist = playlists.find((item) => item.id === playlistId)
    if (
      !window.confirm(
        `Delete "${playlist?.name || 'this playlist'}"? Songs will remain in your library.`
      )
    )
      return
    await window.api.deletePlaylist(playlistId)
    setPlaylists((current) => current.filter((item) => item.id !== playlistId))
    window.dispatchEvent(new CustomEvent('felo:playlists-updated'))
    setActiveMenu(null)
  }

  const handleOpenMenu = (playlist: Playlist, rect: DOMRect) => {
    const menuWidth = 220
    const menuHeight = 104
    setActiveMenu((current) =>
      current?.playlist.id === playlist.id
        ? null
        : {
            playlist,
            x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
            y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
          }
    )
  }

  return (
    <div className="h-full flex-1 overflow-y-auto bg-[#121212] px-4 sm:px-6 md:px-10 pt-6 sm:pt-8 md:pt-10 pb-36 md:pb-10 text-white">
      <PlaylistsHeader
        totalCount={filteredPlaylists.length}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isSearchOpen={isSearchOpen}
        setIsSearchOpen={setIsSearchOpen}
        onCreateClick={() => setIsCreateOpen(true)}
      />

      {isLoading ? (
        <div className="flex min-h-[360px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : error ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-[#b3b3b3]">
          <p>{error}</p>
          <button
            onClick={() => void loadPlaylists()}
            className="rounded-full bg-white px-5 py-2 font-bold text-black cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : filteredPlaylists.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:grid-cols-[repeat(auto-fill,234px)] gap-3 sm:gap-6 md:gap-8 pt-6 sm:pt-10 md:pt-16">
          {filteredPlaylists.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              searchQuery={searchQuery}
              isMenuActive={activeMenu?.playlist.id === playlist.id}
              onPlay={(pid) => void playPlaylist(pid)}
              onOpenMenu={handleOpenMenu}
            />
          ))}
        </div>
      ) : (
        <PlaylistsEmptyState
          searchQuery={searchQuery}
          onCreateClick={() => setIsCreateOpen(true)}
        />
      )}

      {activeMenu && (
        <PlaylistContextMenu
          playlist={activeMenu.playlist}
          x={activeMenu.x}
          y={activeMenu.y}
          onClose={() => setActiveMenu(null)}
          onPlay={(pid) => void playPlaylist(pid)}
          onRename={(pid) => void renamePlaylist(pid)}
          onDelete={(pid) => void deletePlaylist(pid)}
        />
      )}

      {isCreateOpen && (
        <CreatePlaylistModal
          onClose={() => setIsCreateOpen(false)}
          onCreated={(playlist) => {
            setPlaylists((current) => [playlist, ...current])
            setIsCreateOpen(false)
            navigate(`/playlists/${playlist.id}`)
          }}
        />
      )}
    </div>
  )
}
