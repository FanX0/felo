import { useEffect, useState } from 'react'
import { Play, Pause, Laptop2, Smartphone, Radio } from 'lucide-react'
import { remoteClient, type RemotePlayerState, type PlaybackTarget } from '../pages/Remote/remoteClient'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { toMediaUrl } from '../lib/media'

interface MobileDockedPlayerProps {
  onExpand: () => void
  onOpenDevices: () => void
}

export default function MobileDockedPlayer({ onExpand, onOpenDevices }: MobileDockedPlayerProps) {
  const [remoteState, setRemoteState] = useState<RemotePlayerState>(() => remoteClient.getState())
  const [isRemoteConnected, setIsRemoteConnected] = useState(() => remoteClient.getIsConnected())

  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)
  const localDuration = usePlayerStore((s) => s.duration)
  const localSong = localQueue[localIndex]

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setRemoteState)
    const unsubConn = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  // Determine active song source
  const hasRemoteSong = Boolean(isRemoteConnected && remoteState.song)
  const hasLocalSong = Boolean(localSong)

  if (!hasRemoteSong && !hasLocalSong) {
    return null
  }

  let title = ''
  let artist = ''
  let artworkUrl: string | undefined = undefined
  let isPlaying = false
  let progressPercent = 0
  let targetDevice: PlaybackTarget = 'mobile'
  let deviceLabel = 'This Device'

  if (hasRemoteSong) {
    title = remoteState.song?.title || 'Unknown Title'
    artist = remoteState.song?.artist || 'Unknown Artist'
    artworkUrl = remoteState.song?.artworkUrl
      ? remoteClient.getFullArtworkUrl(remoteState.song.artworkUrl)
      : undefined
    isPlaying = remoteState.isPlaying
    progressPercent =
      remoteState.duration > 0
        ? Math.min(100, (remoteState.position / remoteState.duration) * 100)
        : 0
    targetDevice = remoteState.targetDevice || remoteClient.getTargetDevice()
    deviceLabel =
      targetDevice === 'desktop'
        ? remoteState.deviceName || 'Felo Desktop'
        : targetDevice === 'both'
          ? 'Dual Sync'
          : 'This Device'
  } else if (hasLocalSong && localSong) {
    title = localSong.title || 'Unknown Title'
    artist = localSong.artist || 'Unknown Artist'
    artworkUrl = toMediaUrl(localSong.artworkPath) || localSong.artworkUrl
    isPlaying = localIsPlaying
    progressPercent =
      localDuration > 0 ? Math.min(100, (localCurrentTime / localDuration) * 100) : 0
    targetDevice = 'mobile'
    deviceLabel = 'This Device'
  }

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasRemoteSong) {
      void remoteClient.togglePlay()
    } else {
      usePlayerStore.getState().togglePlay()
    }
  }

  const handleDeviceClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDevices()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => e.key === 'Enter' && onExpand()}
      className="fixed bottom-[calc(3.6rem+env(safe-area-inset-bottom,0px))] left-2.5 right-2.5 z-40 bg-[#282828]/95 hover:bg-[#323232]/95 backdrop-blur-xl border border-white/10 rounded-xl p-2 shadow-2xl flex items-center gap-3 transition active:scale-[0.99] select-none cursor-pointer group"
    >
      {/* Artwork */}
      <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-white/5 relative">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-900" />
        )}
      </div>

      {/* Title & Device Badge */}
      <div className="flex-1 min-w-0 pr-1">
        <h4 className="text-xs font-bold text-white truncate leading-tight">{title}</h4>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-400 truncate">
          <span className="truncate">{artist}</span>
          <span className="text-zinc-600">•</span>
          <button
            type="button"
            onClick={handleDeviceClick}
            className="shrink-0 flex items-center gap-1 font-semibold text-[10px] text-emerald-400 hover:text-emerald-300 transition"
          >
            {targetDevice === 'desktop' ? (
              <Laptop2 className="w-3 h-3" />
            ) : targetDevice === 'both' ? (
              <Radio className="w-3 h-3" />
            ) : (
              <Smartphone className="w-3 h-3 text-zinc-300" />
            )}
            <span className={targetDevice === 'mobile' ? 'text-zinc-300' : 'text-emerald-400'}>
              {deviceLabel}
            </span>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleDeviceClick}
          title="Connect to a device"
          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition"
        >
          <Radio className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleTogglePlay}
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition shadow"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-black" />
          ) : (
            <Play className="w-4 h-4 fill-black ml-0.5" />
          )}
        </button>
      </div>

      {/* Sliver Progress Bar on bottom of docked player */}
      <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-white transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
