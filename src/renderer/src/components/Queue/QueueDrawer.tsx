import { useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  Loader2,
  Star,
  ArrowUp
} from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { sendDeviceCommand } from '../../hooks/useConnectedDeviceStore'
import { toMediaUrl } from '../../lib/media'
import type { Song } from '../../pages/Library/Library'
import ArtistLinks from '../Common/ArtistLinks'
import { ArtworkImage } from '../../pages/Home/components/ArtworkImage'
import { useIsMobile } from '../../hooks/useIsMobile'
import { cn } from '../../lib/utils'

interface QueueDrawerProps {
  isOpen: boolean
  onClose: () => void
  isMobile?: boolean
}

function formatDuration(seconds?: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const total = Math.floor(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function QueueDrawer({ isOpen, onClose, isMobile: isMobileProp }: QueueDrawerProps) {
  const isMobileHook = useIsMobile()
  const isMobile = isMobileProp ?? isMobileHook
  const user = useOnlineStore((s) => s.user)
  const { isExternalDevicePlaying, activeRemoteDevice, requestPlayQueue } = usePlaybackArbitration()
  const queue = usePlayerStore((s) => s.queue)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const playbackContext = usePlayerStore((s) => s.playbackContext)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const reorderQueue = usePlayerStore((s) => s.reorderQueue)
  const bumpSongToPriority = usePlayerStore((s) => s.bumpSongToPriority)
  const removeSongFromQueueByIndex = usePlayerStore((s) => s.removeSongFromQueueByIndex)
  const clearUpcomingQueue = usePlayerStore((s) => s.clearUpcomingQueue)
  const transfers = useDownloadStore((s) => s.transfers)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollToCurrent, setShowScrollToCurrent] = useState(false)

  const scrollToCurrent = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const [touchStartY, setTouchStartY] = useState<number | null>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return
    const deltaY = e.changedTouches[0].clientY - touchStartY
    if (deltaY > 60) {
      onClose()
    }
    setTouchStartY(null)
  }

  const activeSong = (isExternalDevicePlaying && activeRemoteDevice?.song) ? activeRemoteDevice.song : queue[currentSongIndex]
  const isDisplayPlaying = isExternalDevicePlaying && activeRemoteDevice ? activeRemoteDevice.isPlaying : isPlaying

  const handleTogglePlay = () => {
    if (isExternalDevicePlaying && activeRemoteDevice) {
      void sendDeviceCommand(
        user?.id || '',
        activeRemoteDevice.activeDeviceId,
        activeRemoteDevice.isPlaying ? 'pause' : 'play'
      )
      return
    }
    togglePlay()
  }

  const currentSong: Song | undefined = activeSong

  const upcomingSongs = useMemo(() => {
    if (currentSongIndex < 0 || currentSongIndex >= queue.length - 1) return []
    return queue.slice(currentSongIndex + 1).map((song, offset) => ({
      song,
      actualIndex: currentSongIndex + 1 + offset
    }))
  }, [queue, currentSongIndex])

  if (!isOpen) return null

  const content = (
    <>
      {/* Mobile Drag Indicator */}
      {isMobile && (
        <div
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={onClose}
          className="w-full flex flex-col items-center pt-2.5 pb-1 cursor-pointer shrink-0"
          title="Swipe or tap to close"
        >
          <div className="w-12 h-1.5 rounded-full bg-white/30" />
        </div>
      )}

      {/* Header */}
      <div
        onTouchStart={isMobile ? handleTouchStart : undefined}
        onTouchEnd={isMobile ? handleTouchEnd : undefined}
        className={cn(
          'flex shrink-0 items-center justify-between border-b border-border/60 px-4 sm:px-5 bg-canvas select-none',
          isMobile ? 'h-14 pt-[env(safe-area-inset-top,0px)]' : 'h-16'
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ListMusic className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-base font-bold text-white truncate">Queue</h2>
          {isShuffle && (
            <span
              title="Shuffle is active"
              className="flex items-center gap-1 text-[11px] font-mono font-medium text-primary shrink-0"
            >
              <Shuffle className="h-3 w-3" />
              Shuffled
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {upcomingSongs.length > 0 && (
            <button
              type="button"
              onClick={() => clearUpcomingQueue(true)}
              title="Clear upcoming queue (preserves active priority requests)"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-white/10 hover:text-danger cursor-pointer whitespace-nowrap active:scale-95"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close queue"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer active:scale-95"
          >
            {isMobile ? <ChevronDown className="h-5 w-5" /> : <X className="h-4 w-4" />}
          </button>
        </div>
      </div>

        {/* Content */}
        <div
          ref={scrollContainerRef}
          onScroll={(e) => setShowScrollToCurrent(e.currentTarget.scrollTop > 80)}
          className="flex-1 overflow-y-auto px-4 py-4 pb-12 space-y-6 custom-scrollbar"
        >
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
                  onClick={handleTogglePlay}
                  title={isDisplayPlaying ? 'Pause' : 'Play'}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-white"
                >
                  {isDisplayPlaying ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="h-5 w-5 fill-current" />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-primary flex items-center gap-1.5">
                  {isPlaying && <Volume2 className="h-3.5 w-3.5 shrink-0 animate-pulse" />}
                  {isBuffering && <Disc3 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
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
                    onClick={() => requestPlayQueue(queue, actualIndex, playbackContext)}
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="truncate text-xs font-semibold text-text group-hover:text-primary transition-colors">
                          {song.title}
                        </p>
                        {song.isPriority && (
                          <span className="rounded-full bg-surface-elevated border border-border px-1.5 py-0.2 text-[8px] font-mono font-bold text-text-muted">
                            {song.requestedBy || 'Priority'}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-text-muted">
                        <ArtistLinks
                          artist={song.artist}
                          artists={song.artists}
                          linkClassName="text-[11px] text-text-muted hover:text-text hover:underline"
                        />
                      </div>
                    </div>

                    {transfer && (
                      <span className="flex items-center gap-1 text-[10px] text-primary font-medium shrink-0">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {transfer.progress > 0 ? `${transfer.progress}%` : 'Buffering'}
                      </span>
                    )}

                    <span className="text-[11px] font-mono text-text-muted tabular-nums shrink-0">
                      {formatDuration(song.duration)}
                    </span>

                    <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          bumpSongToPriority(actualIndex)
                        }}
                        title={song.isPriority ? 'Priority Request • Move to Top Next' : 'Make Important / Play Next'}
                        className={`p-1 rounded transition-all ${
                          song.isPriority
                            ? 'text-primary bg-primary/10'
                            : 'text-text-muted hover:text-text hover:bg-hover'
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${song.isPriority ? 'fill-primary' : ''}`} />
                      </button>
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

      {/* Floating Jump to Now Playing locator */}
      {showScrollToCurrent && currentSong && (
        <button
          type="button"
          onClick={scrollToCurrent}
          className="absolute bottom-6 right-6 z-20 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground shadow-lg text-xs font-bold animate-in fade-in slide-in-from-bottom-2 duration-200 cursor-pointer active:scale-95 border border-border"
          title="Jump to Now Playing"
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span>Now Playing</span>
        </button>
      )}
    </>
  )

  if (!isMobile) {
    return (
      <aside
        aria-label="Play Queue"
        className="h-full w-full shrink-0 overflow-hidden rounded-xl border border-border/70 bg-canvas shadow-2xl no-drag flex flex-col relative select-none"
      >
        {content}
      </aside>
    )
  }

  const mobileDrawer = (
    <>
      <div
        className="fixed inset-0 z-[99999] bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />
      <aside
        aria-label="Play Queue"
        className="fixed inset-0 z-[99999] flex w-full max-w-full flex-col border-t border-white/10 bg-canvas shadow-2xl transition-transform animate-in slide-in-from-bottom duration-200 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] select-none"
      >
        {content}
      </aside>
    </>
  )

  if (typeof document !== 'undefined') {
    return createPortal(mobileDrawer, document.body)
  }

  return mobileDrawer
}
