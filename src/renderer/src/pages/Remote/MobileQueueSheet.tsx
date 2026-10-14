import { useState, useEffect } from 'react'
import { X, Trash2, ListMusic, Music2, RefreshCw, Download, Check } from 'lucide-react'
import { remoteClient, type RemotePlayerState, type RemotePlayerSong } from './remoteClient'

interface MobileQueueSheetProps {
  state: RemotePlayerState
  isOpen: boolean
  onClose: () => void
}

interface QueueItem extends RemotePlayerSong {
  index: number
  current?: boolean
}

export default function MobileQueueSheet({ state, isOpen, onClose }: MobileQueueSheetProps) {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())

  const loadQueue = async () => {
    setIsLoading(true)
    try {
      const res = await remoteClient.getQueue(0, 50)
      if (res && Array.isArray(res.queue)) {
        setQueue(res.queue)
      }
    } catch (e) {
      console.warn('Failed to load queue:', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      void loadQueue()
    }
  }, [isOpen, state.queueIndex, state.song?.id])

  if (!isOpen) return null

  const handlePlayIndex = (index: number) => {
    void remoteClient.playIndex(index)
  }

  const handleRemove = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation()
    void remoteClient.removeFromQueue(songId)
    setQueue((prev) => prev.filter((item) => item.id !== songId))
  }

  const handleDownload = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation()
    remoteClient.downloadSong(songId)
    setDownloadedIds((prev) => new Set(prev).add(songId))
    setTimeout(() => {
      setDownloadedIds((prev) => {
        const next = new Set(prev)
        next.delete(songId)
        return next
      })
    }, 2500)
  }

  const formatDuration = (secs: number) => {
    if (!secs) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const currentSong = state.song

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#121212] flex flex-col text-white animate-in slide-in-from-bottom duration-200 select-none pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Top Drag Handle Indicator */}
      <div className="w-10 h-1.5 rounded-full bg-white/20 mx-auto mt-2 mb-1 shrink-0" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#181818]/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <ListMusic className="w-5 h-5 text-white" />
          <h2 className="text-lg font-bold">Queue</h2>
          <span className="text-xs text-zinc-400 font-mono">({queue.length} tracks)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadQueue}
            disabled={isLoading}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Refresh Queue"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-white' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
        {/* Now Playing Section */}
        {currentSong && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 px-2">
              Now Playing
            </h3>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.06] border border-white/20 shadow-lg">
              <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-white/10">
                {currentSong.artworkUrl ? (
                  <img
                    src={remoteClient.getFullArtworkUrl(currentSong.artworkUrl)}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Music2 className="w-6 h-6 text-zinc-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{currentSong.title}</h4>
                <p className="text-xs text-zinc-400 truncate">{currentSong.artist}</p>
              </div>

              <span className="text-xs font-mono text-zinc-400">
                {formatDuration(currentSong.duration)}
              </span>

              <button
                type="button"
                onClick={(e) => handleDownload(e, currentSong.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition shrink-0 cursor-pointer"
                title="Download to phone storage"
              >
                {downloadedIds.has(currentSong.id) ? (
                  <Check className="w-4 h-4 text-white" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Up Next List */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 px-2">
            Next In Queue
          </h3>

          {isLoading && queue.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
              <RefreshCw className="w-6 h-6 animate-spin text-white" />
              <span className="text-xs">Loading queue...</span>
            </div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              Queue is empty. Search for songs to add them!
            </div>
          ) : (
            <div className="space-y-1">
              {queue.map((track, i) => {
                const isCurrent = track.current || track.id === currentSong?.id
                const isDownloaded = downloadedIds.has(track.id)
                return (
                  <div
                    key={`${track.id}-${i}`}
                    onClick={() => handlePlayIndex(track.index)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl transition cursor-pointer active:scale-[0.99] group ${
                      isCurrent
                        ? 'bg-white/10 text-white'
                        : 'hover:bg-white/5 text-zinc-300'
                    }`}
                  >
                    <span className="w-5 text-center text-xs font-mono text-zinc-500 group-hover:text-white">
                      {i + 1}
                    </span>

                    <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-white/5">
                      {track.artworkUrl ? (
                        <img
                          src={remoteClient.getFullArtworkUrl(track.artworkUrl)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Music2 className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pr-2">
                      <h4
                        className={`text-sm font-semibold truncate ${
                          isCurrent ? 'text-white font-bold' : 'text-white'
                        }`}
                      >
                        {track.title}
                      </h4>
                      <p className="text-xs text-zinc-400 truncate">{track.artist}</p>
                    </div>

                    <span className="text-xs font-mono text-zinc-500 shrink-0">
                      {formatDuration(track.duration)}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleDownload(e, track.id)}
                        className="p-1.5 text-zinc-500 hover:text-white transition cursor-pointer"
                        title="Download track to phone storage"
                      >
                        {isDownloaded ? (
                          <Check className="w-4 h-4 text-white" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleRemove(e, track.id)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                        title="Remove from queue"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
