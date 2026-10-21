import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, Heart, ListMusic, Plus, Search, X, Loader2 } from 'lucide-react'
import { toMediaUrl } from '../../lib/media'
import { cn } from '../../lib/utils'
import type { Song } from '../../types'
import type { Playlist } from '../../pages/Playlists/types'

interface AddToPlaylistPopoverProps {
  song: Song
  isOpen: boolean
  onClose: () => void
  onToggleFavorite?: (isFav: boolean) => void
  isFavorite?: boolean
}

export default function AddToPlaylistPopover({
  song,
  isOpen,
  onClose,
  onToggleFavorite,
  isFavorite: initialIsFavorite
}: AddToPlaylistPopoverProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistSongMap, setPlaylistSongMap] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isFav, setIsFav] = useState(Boolean(initialIsFavorite ?? song.isFavorite))
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isSubmittingNew, setIsSubmittingNew] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsFav(Boolean(initialIsFavorite ?? song.isFavorite))
  }, [initialIsFavorite, song.isFavorite])

  // Load playlists and verify membership
  useEffect(() => {
    if (!isOpen) return

    let active = true
    const load = async () => {
      setIsLoading(true)
      try {
        if (window.api?.getPlaylists) {
          const list = ((await window.api.getPlaylists()) || []) as Playlist[]
          if (!active) return
          setPlaylists(list)

          // Check membership for each playlist
          const membership: Record<string, boolean> = {}
          await Promise.all(
            list.map(async (pl) => {
              try {
                const detail = await window.api.getPlaylist(pl.id)
                if (detail?.songs) {
                  membership[pl.id] = detail.songs.some((s: any) => s.id === song.id)
                }
              } catch {
                // ignore detail fetch error
              }
            })
          )
          if (active) setPlaylistSongMap(membership)
        }
      } catch (err) {
        console.error('Failed to load playlists in AddToPlaylistPopover:', err)
      } finally {
        if (active) setIsLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [isOpen, song.id])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const filteredPlaylists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return playlists
    return playlists.filter((p) => p.name.toLowerCase().includes(q))
  }, [playlists, searchQuery])

  const handleToggleFavorite = async () => {
    const next = !isFav
    setIsFav(next)
    try {
      if (window.api?.toggleFavorite) {
        await window.api.toggleFavorite(song.id, next, song)
      }
      onToggleFavorite?.(next)
      window.dispatchEvent(
        new CustomEvent('felo:favorites-updated', {
          detail: { songId: song.id, isFavorite: next }
        })
      )
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      setIsFav(!next)
    }
  }

  const handleTogglePlaylist = async (playlist: Playlist) => {
    const currentlyIn = Boolean(playlistSongMap[playlist.id])
    const nextIn = !currentlyIn

    // Optimistic update
    setPlaylistSongMap((prev) => ({ ...prev, [playlist.id]: nextIn }))

    try {
      if (nextIn) {
        if (window.api?.addSongToPlaylist) {
          await window.api.addSongToPlaylist(playlist.id, song.id)
        }
      } else {
        if (window.api?.removeSongFromPlaylist) {
          await window.api.removeSongFromPlaylist(playlist.id, song.id)
        }
      }
      window.dispatchEvent(new CustomEvent('felo:playlists-updated'))
    } catch (err) {
      console.error(`Failed to update playlist ${playlist.name}:`, err)
      setPlaylistSongMap((prev) => ({ ...prev, [playlist.id]: currentlyIn }))
    }
  }

  const handleCreateNewPlaylist = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newPlaylistName.trim()
    if (!name || isSubmittingNew) return

    try {
      setIsSubmittingNew(true)
      if (window.api?.createPlaylist) {
        const created = await window.api.createPlaylist({
          name,
          songIds: [song.id]
        })
        if (created) {
          setPlaylists((prev) => [created, ...prev])
          setPlaylistSongMap((prev) => ({ ...prev, [created.id]: true }))
          setNewPlaylistName('')
          setIsCreatingNew(false)
          window.dispatchEvent(new CustomEvent('felo:playlists-updated'))
        }
      }
    } catch (err) {
      console.error('Failed to create playlist with song:', err)
    } finally {
      setIsSubmittingNew(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full sm:max-w-[380px] rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#181818] text-white shadow-2xl flex flex-col max-h-[85vh] sm:max-h-[600px] overflow-hidden',
          'animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
          <div className="min-w-0 pr-2">
            <h3 className="text-base font-bold text-white truncate">Add to playlist</h3>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {song.title} • {song.artist}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-text-muted hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Create shortcut */}
        <div className="p-3 border-b border-white/10 shrink-0 space-y-2">
          {playlists.length > 4 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find a playlist..."
                className="w-full rounded-lg bg-white/5 py-2 pl-9 pr-3 text-xs text-white placeholder-text-muted/60 outline-none border border-white/5 focus:border-white/20 transition-all"
              />
            </div>
          )}

          {isCreatingNew ? (
            <form onSubmit={handleCreateNewPlaylist} className="flex gap-2">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="New playlist name..."
                autoFocus
                className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white placeholder-text-muted outline-none border border-primary/50 focus:border-primary transition-all"
              />
              <button
                type="submit"
                disabled={!newPlaylistName.trim() || isSubmittingNew}
                className="rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-black transition-all cursor-pointer shrink-0"
              >
                {isSubmittingNew ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingNew(false)
                  setNewPlaylistName('')
                }}
                className="rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs text-text-muted hover:text-white transition-all cursor-pointer"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreatingNew(true)}
              className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs font-medium text-text-muted hover:border-white/40 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
            >
              <Plus className="h-4 w-4 text-emerald-400" />
              <span>New playlist</span>
            </button>
          )}
        </div>

        {/* Playlists & Liked Songs List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* Liked Songs Option (Always Pinned First) */}
          <button
            type="button"
            onClick={handleToggleFavorite}
            className={cn(
              'flex w-full items-center justify-between rounded-lg p-2.5 text-left transition-colors cursor-pointer group',
              isFav ? 'bg-white/10' : 'hover:bg-white/5'
            )}
          >
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <div className="h-10 w-10 shrink-0 rounded-md bg-gradient-to-br from-[#450af5] to-[#8e8ee5] flex items-center justify-center shadow-md">
                <Heart className="h-5 w-5 fill-white text-white" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm text-white block truncate">
                  Liked Songs
                </span>
                <span className="text-[11px] text-text-muted block truncate">
                  Auto-playlist
                </span>
              </div>
            </div>

            <div
              className={cn(
                'h-6 w-6 rounded-md border flex items-center justify-center shrink-0 transition-all',
                isFav
                  ? 'border-[#1ed760] bg-[#1ed760] text-black'
                  : 'border-white/20 group-hover:border-white/40'
              )}
            >
              {isFav && <Check className="h-4 w-4 stroke-[3]" />}
            </div>
          </button>

          <div className="my-1 border-t border-white/5" />

          {/* User Playlists */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-text-muted gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Loading playlists...</span>
            </div>
          ) : filteredPlaylists.length === 0 ? (
            <div className="py-6 text-center text-xs text-text-muted">
              {searchQuery ? 'No playlists found matching query' : 'No playlists created yet'}
            </div>
          ) : (
            filteredPlaylists.map((pl) => {
              const isIn = Boolean(playlistSongMap[pl.id])
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => handleTogglePlaylist(pl)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg p-2.5 text-left transition-colors cursor-pointer group',
                    isIn ? 'bg-white/10' : 'hover:bg-white/5'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    {pl.artworkPath ? (
                      <img
                        src={toMediaUrl(pl.artworkPath) ?? undefined}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover shadow-sm"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded-md bg-surface-elevated border border-white/10 flex items-center justify-center shadow-sm">
                        <ListMusic className="h-5 w-5 text-text-muted" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-white block truncate">
                        {pl.name}
                      </span>
                      <span className="text-[11px] text-text-muted block truncate">
                        Playlist • {pl.songCount || 0} songs
                      </span>
                    </div>
                  </div>

                  <div
                    className={cn(
                      'h-6 w-6 rounded-md border flex items-center justify-center shrink-0 transition-all',
                      isIn
                        ? 'border-[#1ed760] bg-[#1ed760] text-black'
                        : 'border-white/20 group-hover:border-white/40'
                    )}
                  >
                    {isIn && <Check className="h-4 w-4 stroke-[3]" />}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Footer Done */}
        <div className="border-t border-white/10 p-3 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white hover:bg-zinc-200 text-black px-5 py-1.5 text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
