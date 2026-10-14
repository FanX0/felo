import { Play, Pause, SkipForward, Laptop2 } from 'lucide-react'
import { remoteClient, type RemotePlayerState } from './remoteClient'

interface MobileMiniPlayerProps {
  state: RemotePlayerState
  isConnected: boolean
  onExpand: () => void
}

export default function MobileMiniPlayer({ state, isConnected, onExpand }: MobileMiniPlayerProps) {
  const song = state.song
  const isPlaying = state.isPlaying
  const duration = state.duration || 1
  const position = state.position || 0
  const progressPercent = Math.min(100, Math.max(0, (position / duration) * 100))

  const artworkSrc = song?.artworkUrl
    ? remoteClient.getFullArtworkUrl(song.artworkUrl)
    : ''

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    void remoteClient.togglePlay()
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    void remoteClient.next()
  }

  return (
    <div
      onClick={onExpand}
      className="relative w-full bg-[#242424] hover:bg-[#282828] text-white rounded-xl shadow-2xl overflow-hidden cursor-pointer active:scale-[0.99] transition border border-white/5 select-none"
    >
      {/* Mini Progress Line on Top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-zinc-700">
        <div
          className="h-full bg-white transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between p-2.5 gap-3">
        {/* Cover Thumbnail */}
        <div className="w-11 h-11 rounded-lg overflow-hidden bg-zinc-800 shrink-0 border border-white/5 flex items-center justify-center">
          {artworkSrc ? (
            <img src={artworkSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            <Laptop2 className="w-5 h-5 text-zinc-500" />
          )}
        </div>

        {/* Title & Artist */}
        <div className="flex-1 min-w-0 pr-1">
          <h4 className="text-sm font-semibold text-white truncate leading-tight">
            {song?.title || (isConnected ? 'No song loaded' : 'Connecting...')}
          </h4>
          <p className="text-xs text-zinc-400 truncate mt-0.5 flex items-center gap-1.5">
            <span className="truncate">{song?.artist || 'Felo Desktop'}</span>
            <span className="text-[10px] text-white/80 font-medium shrink-0">• Desktop</span>
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white hover:text-zinc-200 active:scale-90 transition"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleNext}
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white active:scale-90 transition"
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>
        </div>
      </div>
    </div>
  )
}
