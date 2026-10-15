import { useEffect, useState, useRef } from 'react'
import { Play, Pause, SkipForward, Laptop2, Smartphone, Radio } from 'lucide-react'
import { remoteClient, type RemotePlayerState, type PlaybackTarget } from '../pages/Remote/remoteClient'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand,
  getInterpolatedPosition
} from '../hooks/useConnectedDeviceStore'
import { toMediaUrl } from '../lib/media'
import { getDeviceDisplayName } from '../lib/deviceInfo'

interface MobileDockedPlayerProps {
  onExpand: () => void
  onOpenDevices: () => void
}

export default function MobileDockedPlayer({ onExpand, onOpenDevices }: MobileDockedPlayerProps) {
  const [remoteState, setRemoteState] = useState<RemotePlayerState>(() => remoteClient.getState())
  const [isRemoteConnected, setIsRemoteConnected] = useState(() => remoteClient.getIsConnected())
  const touchStartXRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)

  const user = useOnlineStore((s) => s.user)
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null

  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)
  const localDuration = usePlayerStore((s) => s.duration)
  const localSong = localQueue[localIndex]
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const isLocalAudioOwner = isAudioActive && localIsPlaying

  const [, setTick] = useState(0)

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setRemoteState)
    const unsubConn = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  // Cloud Realtime active device check
  const isCloudRemoteActive = Boolean(
    !isLocalAudioOwner &&
      activeRemote &&
      (myDeviceId ? activeRemote.activeDeviceId !== myDeviceId : true) &&
      activeRemote.song
  )

  useEffect(() => {
    if (!isCloudRemoteActive || !activeRemote?.isPlaying) return undefined
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [isCloudRemoteActive, activeRemote?.isPlaying])

  // Determine active song source
  const hasLanRemoteSong = Boolean(isRemoteConnected && remoteState.song)
  const hasLocalSong = Boolean(localSong)

  if (!isCloudRemoteActive && !hasLanRemoteSong && !hasLocalSong) {
    return null
  }

  let title = ''
  let artist = ''
  let artworkUrl: string | undefined = undefined
  let isPlaying = false
  let progressPercent = 0
  let targetDevice: PlaybackTarget = 'mobile'
  let deviceLabel = 'This Device'

  if (isCloudRemoteActive && activeRemote?.song) {
    title = activeRemote.song.title || 'Unknown Title'
    artist = activeRemote.song.artist || 'Unknown Artist'
    artworkUrl = activeRemote.song.artworkUrl
    isPlaying = activeRemote.isPlaying
    const currentPos = getInterpolatedPosition(activeRemote)
    progressPercent =
      activeRemote.duration > 0
        ? Math.min(100, (currentPos / activeRemote.duration) * 100)
        : 0
    targetDevice = activeRemote.activeDeviceType === 'desktop' ? 'desktop' : 'mobile'
    deviceLabel = activeRemote.activeDeviceName || 'Felo Desktop'
  } else if (hasLanRemoteSong) {
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
          : getDeviceDisplayName()
  } else if (hasLocalSong && localSong) {
    title = localSong.title || 'Unknown Title'
    artist = localSong.artist || 'Unknown Artist'
    artworkUrl = toMediaUrl(localSong.artworkPath) || localSong.artworkUrl
    isPlaying = localIsPlaying
    progressPercent =
      localDuration > 0 ? Math.min(100, (localCurrentTime / localDuration) * 100) : 0
    targetDevice = 'mobile'
    deviceLabel = getDeviceDisplayName()
  }

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCloudRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(
        user.id,
        activeRemote.activeDeviceId,
        activeRemote.isPlaying ? 'pause' : 'play'
      )
    } else if (hasLanRemoteSong) {
      void remoteClient.togglePlay()
    } else {
      usePlayerStore.getState().togglePlay()
    }
  }

  const handleDeviceClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onOpenDevices()
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCloudRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'next')
    } else if (hasLanRemoteSong) {
      void remoteClient.next()
    } else {
      usePlayerStore.getState().playNext(true)
    }
  }

  const handlePrevious = () => {
    if (isCloudRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'previous')
    } else if (hasLanRemoteSong) {
      void remoteClient.previous()
    } else {
      usePlayerStore.getState().playPrevious()
    }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX
    touchStartYRef.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartXRef.current
    const deltaY = e.changedTouches[0].clientY - touchStartYRef.current
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 45) {
      if (deltaX < 0) {
        // Swipe left -> Next
        handleNext(e as any)
      } else {
        // Swipe right -> Previous
        handlePrevious()
      }
    }
    touchStartXRef.current = null
    touchStartYRef.current = null
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => e.key === 'Enter' && onExpand()}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="md:hidden fixed bottom-[calc(3.8rem+env(safe-area-inset-bottom,0px))] left-2.5 right-2.5 z-40 bg-[#282828]/95 hover:bg-[#323232]/95 backdrop-blur-xl border border-white/10 rounded-xl p-2 shadow-2xl flex items-center gap-3 transition active:scale-[0.99] select-none cursor-pointer group"
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
              {isCloudRemoteActive ? `Listening on ${deviceLabel}` : deviceLabel}
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
          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition cursor-pointer"
        >
          <Radio className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleTogglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition shadow cursor-pointer"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-black" />
          ) : (
            <Play className="w-4 h-4 fill-black ml-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleNext}
          title="Next track"
          className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-300 hover:text-white transition cursor-pointer"
        >
          <SkipForward className="w-4 h-4 fill-current" />
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
