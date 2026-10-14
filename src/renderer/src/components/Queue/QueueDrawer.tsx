import { useMemo } from 'react'
import {
  ChevronDown,
  ChevronUp,
  X,
  Play,
  Pause,
  Trash2,
  ListMusic,
  Disc3,
  Shuffle,
  Volume2,
  Loader2
} from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import type { Song } from '../../pages/Library/Library'
import ArtistLinks from '../Common/ArtistLinks'
import { ArtworkImage } from '../../pages/Home/components/ArtworkImage'

interface QueueDrawerProps {
  isOpen: boolean
  onClose: () => void
}

function formatDuration(seconds?: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function QueueDrawer({ isOpen, onClose }: QueueDrawerProps) {
  const queue = usePlayerStore((s) => s.queue)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const playbackContext = usePlayerStore((s) => s.playbackContext)
  const playSong = usePlayerStore((s) => s.playSong)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const reorderQueue = usePlayerStore((s) => s.reorderQueue)
  const removeSongFromQueueByIndex = usePlayerStore((s) => s.removeSongFromQueueByIndex)
  const clearUpcomingQueue = usePlayerStore((s) => s.clearUpcomingQueue)
  const transfers = useDownloadStore((s) => s.transfers)

  const currentSong: Song | undefined = queue[currentSongIndex]

  const upcomingSongs = useMemo(() => {
    if (currentSongIndex < 0 || currentSongIndex >= queue.length - 1) return []
    return queue.slice(currentSongIndex + 1).map((song, offset) => ({
      song,
      actualIndex: currentSongIndex + 1 + offset
    }))
  }, [queue, currentSongIndex])

  if (!isOpen) return null

  return (
    <aside
      aria-label="Play Queue"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col border-l border-white/10 bg-[#121212]/95 backdrop-blur-xl shadow-2xl transition-transform animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-2.5">
          <ListMusic className="h-5 w-5 text-primary-amber" />
          <h2 className="text-base font-bold text-white">Queue</h2>
          {isShuffle && (
            <span
              title="Shuffle is active"
              className="flex items-center gap-1 text-[11px] font-mono font-medium text-primary-amber"
            >
              <Shuffle className="h-3 w-3" />
              Shuffled
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {upcomingSongs.length > 0 && (
            <button
              type="button"
              onClick={clearUpcomingQueue}
              title="Clear upcoming queue"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-white/10 hover:text-danger cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close queue"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {/* Now Playing */}
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Now Playing
            </span>
            {playbackContext && (
              <span className="truncate max-w-[180px] text-[11px] font-medium text-text-muted/80">
                from {playbackContext.type}: {playbackContext.title}
              </span>
            )}
          </div>

          {currentSong ? (
            <div className="group relative flex items-center gap-3 rounded-lg border border-white/10 bg-surface-elevated/70 p-3 shadow-sm hover:bg-surface-elevated transition-colors">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-[#282828]">
                <ArtworkImage
                  src={toMediaUrl(currentSong.artworkPath) || currentSong.artworkUrl}
                  title={currentSong.title}
                  artist={currentSong.artist}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={togglePlay}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-white"
                >
                  {isPlaying ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-primary-amber flex items-center gap-1.5">
                  {isPlaying && <Volume2 className="h-3.5 w-3.5 shrink-0 animate-pulse" />}
                  {isBuffering && <Disc3 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary-amber" />}
                  <span className="truncate">{currentSong.title}</span>
                </p>
                <div className="truncate text-xs text-text-muted mt-0.5">
                  <ArtistLinks
                    artist={currentSong.artist}
                    artists={currentSong.artists}
                    linkClassName="text-xs text-text-muted hover:text-text hover:underline"
                  />
                </div>
                {currentSong.album && (
                  <p className="truncate text-[11px] text-text-muted/70">{currentSong.album}</p>
                )}
              </div>

              <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                {formatDuration(currentSong.duration)}
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-text-muted">
              Nothing is playing right now.
            </div>
          )}
        </div>

        {/* Next Up */}
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Next In Queue ({upcomingSongs.length})
            </span>
          </div>

          {upcomingSongs.length > 0 ? (
            <div className="space-y-1">
              {upcomingSongs.map(({ song, actualIndex }, idx) => {
                const artworkUrl = toMediaUrl(song.artworkPath) || song.artworkUrl
                const transfer = transfers.find(
                  (t) =>
                    t.title.toLowerCase() === song.title.toLowerCase() &&
                    (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
                    (t.status === 'downloading' || t.status === 'queued')
                )
                return (
                  <div
                    key={`${song.id}-${actualIndex}`}
                    className="group flex items-center gap-3 rounded-md px-2.5 py-2 hover:bg-white/10 transition-colors cursor-pointer"
                    onClick={() => playSong(actualIndex)}
                    title={`Jump to "${song.title}"`}
                  >
                    <span className="w-5 text-center text-xs text-text-muted group-hover:hidden">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      className="hidden w-5 items-center justify-center text-white group-hover:flex"
                      title="Play track"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </button>

                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-[#282828]">
                      <ArtworkImage
                        src={artworkUrl}
                        title={song.title}
                        artist={song.artist}
                        className="h-full w-full object-cover"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-text group-hover:text-primary-amber transition-colors">
                        {song.title}
                      </p>
                      <div className="truncate text-[11px] text-text-muted">
                        <ArtistLinks
                          artist={song.artist}
                          artists={song.artists}
                          linkClassName="text-[11px] text-text-muted hover:text-text hover:underline"
                        />
                      </div>
                    </div>

                    {transfer && (
                      <span className="flex items-center gap-1 text-[10px] text-primary-amber font-medium shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {transfer.progress > 0 ? `${transfer.progress}%` : 'Buffering'}
                      </span>
                    )}

                    <span className="text-[11px] font-mono text-text-muted tabular-nums shrink-0">
                      {formatDuration(song.duration)}
                    </span>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            reorderQueue(actualIndex, actualIndex - 1)
                          }}
                          title="Move up"
                          className="p-1 text-text-muted hover:text-white hover:bg-white/10 rounded transition-all"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {idx < upcomingSongs.length - 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            reorderQueue(actualIndex, actualIndex + 1)
                          }}
                          title="Move down"
                          className="p-1 text-text-muted hover:text-white hover:bg-white/10 rounded transition-all"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeSongFromQueueByIndex(actualIndex)
                        }}
                        title="Remove from queue"
                        className="p-1 text-text-muted hover:text-danger hover:bg-white/10 rounded transition-all"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-text-muted">
              Queue is empty. Select an album, playlist, or songs to queue them.
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
