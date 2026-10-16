import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { toMediaUrl } from '../../../lib/media'
import { ArtworkImage } from '../../Home/components/ArtworkImage'
import type { Song } from '../../Library/Library'
import type { Playlist } from '../types'

interface AddSongsModalProps {
  playlist: Playlist
  librarySongs: Song[]
  onClose: () => void
  onUpdated: (playlist: Playlist) => void
}

export function AddSongsModal({
  playlist,
  librarySongs,
  onClose,
  onUpdated
}: AddSongsModalProps) {
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
    if (!window.api?.addSongToPlaylist) return
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
            className="p-1 text-[#b3b3b3] hover:text-white cursor-pointer"
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
                    className="rounded-full border border-white/40 px-4 py-1.5 text-sm font-bold hover:border-white hover:bg-white hover:text-black disabled:opacity-50 cursor-pointer"
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
