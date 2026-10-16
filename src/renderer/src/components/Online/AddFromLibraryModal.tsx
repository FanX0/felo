import { useState, useMemo, useEffect } from 'react'
import { Search, X, Music2, Plus, Check, Sparkles, FolderOpen } from 'lucide-react'
import type { Song } from '../../pages/Library/Library'

interface AddFromLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  onAddSong: (song: Song) => void
  onAddSongs: (songs: Song[]) => void
  existingQueueSongIds: Set<string>
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function AddFromLibraryModal({
  isOpen,
  onClose,
  onAddSong,
  onAddSongs,
  existingQueueSongIds
}: AddFromLibraryModalProps) {
  const [songs, setSongs] = useState<Song[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [recentlyAddedIds, setRecentlyAddedIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    if (typeof window !== 'undefined' && window.api?.getSongs) {
      window.api
        .getSongs()
        .then((data: any) => {
          setSongs((data || []) as Song[])
        })
        .catch(console.error)
        .finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [isOpen])

  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return songs
    const q = searchQuery.toLowerCase().trim()
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        (s.album && s.album.toLowerCase().includes(q))
    )
  }, [songs, searchQuery])

  const handleAddSingle = (song: Song) => {
    onAddSong(song)
    setRecentlyAddedIds((prev) => new Set(prev).add(song.id))
    setTimeout(() => {
      setRecentlyAddedIds((prev) => {
        const next = new Set(prev)
        next.delete(song.id)
        return next
      })
    }, 2000)
  }

  const handleAddNextTen = () => {
    const unqueued = filteredSongs.filter((s) => !existingQueueSongIds.has(s.id))
    const toAdd = unqueued.slice(0, 10)
    if (toAdd.length > 0) {
      onAddSongs(toAdd)
      toAdd.forEach((s) => recentlyAddedIds.add(s.id))
      setRecentlyAddedIds(new Set(recentlyAddedIds))
    }
  }

  const handleAddAll = () => {
    const unqueued = filteredSongs.filter((s) => !existingQueueSongIds.has(s.id))
    if (unqueued.length > 0) {
      onAddSongs(unqueued)
      unqueued.forEach((s) => recentlyAddedIds.add(s.id))
      setRecentlyAddedIds(new Set(recentlyAddedIds))
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-surface-elevated/95 p-5 shadow-2xl flex flex-col max-h-[85vh] animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-amber/20 text-primary-amber border border-primary-amber/30">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white">Add from Local Library</h2>
              <p className="text-[11px] text-text-muted">
                Pick tracks from your local music library to stream live via JIT WebRTC.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search Bar & Batch Actions */}
        <div className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search local songs, artists, albums..."
              className="w-full rounded-xl border border-border/60 bg-black/40 pl-9 pr-9 py-2 text-xs text-white placeholder-text-muted focus:border-primary-amber/60 focus:outline-hidden"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <span className="text-[11px] text-text-muted font-mono">
              {filteredSongs.length} track{filteredSongs.length !== 1 ? 's' : ''} available
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddNextTen}
                disabled={filteredSongs.length === 0}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold bg-white/10 hover:bg-white text-white hover:text-black border border-white/20 transition-all cursor-pointer shadow-xs disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3 text-amber-300 fill-amber-300" />
                <span>+ Add Next 10</span>
              </button>
              <button
                type="button"
                onClick={handleAddAll}
                disabled={filteredSongs.length === 0}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-all cursor-pointer shadow-xs disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                <span>+ Add All ({filteredSongs.length})</span>
              </button>
            </div>
          </div>
        </div>

        {/* Songs List */}
        <div className="mt-3 flex-1 overflow-y-auto divide-y divide-border/20 pr-1 scrollbar-thin max-h-[50vh]">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-text-muted">Loading local library...</div>
          ) : filteredSongs.length === 0 ? (
            <div className="p-8 text-center">
              <FolderOpen className="h-8 w-8 text-text-muted/40 mx-auto mb-2" />
              <p className="text-xs font-bold text-text">No local songs found</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                {searchQuery
                  ? 'Try a different search query.'
                  : 'Scan your music folder in Library or drag-and-drop audio files.'}
              </p>
            </div>
          ) : (
            filteredSongs.map((song) => {
              const isAlreadyInQueue = existingQueueSongIds.has(song.id)
              const wasRecentlyAdded = recentlyAddedIds.has(song.id)
              const ext = (song.filePath || song.title || '').toLowerCase()
              const formatBadge = ext.endsWith('.flac')
                ? 'FLAC'
                : ext.endsWith('.wav')
                ? 'WAV'
                : ext.endsWith('.ogg')
                ? 'OGG'
                : 'MP3'

              return (
                <div
                  key={song.id}
                  className="flex items-center justify-between py-2 px-2 hover:bg-white/5 rounded-xl transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="rounded-md bg-surface border border-border/50 px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted shrink-0">
                      {formatBadge}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white group-hover:text-primary-amber transition-colors">
                        {song.title}
                      </p>
                      <p className="truncate text-[10px] text-text-muted">
                        {song.artist} {song.album ? `• ${song.album}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 ml-3">
                    <span className="text-[10px] font-mono text-text-muted">
                      {formatDuration(song.duration)}
                    </span>
                    {wasRecentlyAdded ? (
                      <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        <Check className="h-3 w-3" />
                        <span>Added</span>
                      </span>
                    ) : isAlreadyInQueue ? (
                      <span className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium text-text-muted bg-white/5 border border-white/10">
                        <Check className="h-3 w-3 opacity-60" />
                        <span>In Queue</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddSingle(song)}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold bg-primary-amber/20 hover:bg-primary-amber text-amber-300 hover:text-black border border-primary-amber/40 transition-all cursor-pointer shadow-xs active:scale-95"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11px] text-text-muted">
          <span>Files stay in local RAM. Only streamed JIT when played.</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1 font-bold bg-white/10 hover:bg-white text-white hover:text-black transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
