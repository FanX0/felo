import { useEffect, useState, useRef } from 'react'
import { Play, Pause, SkipForward, Laptop2, Smartphone, Radio, Globe } from 'lucide-react'
import { remoteClient, type RemotePlayerState } from '../pages/Remote/remoteClient'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { useListeningStore } from '../hooks/useListeningStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from '../hooks/useConnectedDeviceStore'
import { getCurrentDeviceId } from '../lib/deviceInfo'
import { resolveEffectivePlaybackState } from '../lib/playbackStateResolver'
import PingPongMarquee from './Common/PingPongMarquee'

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
  const activeRoom = useListeningStore((s) => s.joinedRoom || s.hostRoom)
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const myDeviceId = getCurrentDeviceId()

  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)
  const localDuration = usePlayerStore((s) => s.duration)
  const localVolume = usePlayerStore((s) => s.volume)
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)

  const [, setTick] = useState(0)

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setRemoteState)
    const unsubConn = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  // Unified resolution
  const unified = resolveEffectivePlaybackState({
    localPlayer: {
      queue: localQueue,
      currentSongIndex: localIndex,
      isPlaying: localIsPlaying,
      currentTime: localCurrentTime,
      duration: localDuration,
      volume: localVolume,
      isAudioActive
    },
    activeRemote,
    lanState: remoteState,
    isLanConnected: isRemoteConnected,
    joinedRoom,
    myDeviceId
  })

  // Timer tick for remote playing progress interpolation
  useEffect(() => {
    if (!unified.isRemote || !unified.isPlaying) return undefined
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [unified.isRemote, unified.isPlaying])

  if (!unified.song) {
    return null
  }

  const title = unified.song.title || 'Unknown Title'
  const artist = unified.song.artist || 'Unknown Artist'
  const artworkUrl = unified.artworkUrl
  const isPlaying = unified.isPlaying
  const progressPercent = unified.progressPercent
  const isRemote = unified.isRemote
  const deviceName = unified.activeDeviceName
  const deviceCategory = unified.activeDeviceCategory

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (unified.isRemote) {
      if (unified.source === 'lan') {
        void remoteClient.togglePlay()
      } else if (user?.id) {
        void sendDeviceCommand(
          user.id,
          unified.activeDeviceId,
          unified.isPlaying ? 'pause' : 'play'
        )
      }
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
    if (unified.isRemote) {
      if (unified.source === 'lan') {
        void remoteClient.next()
      } else if (user?.id) {
        void sendDeviceCommand(user.id, unified.activeDeviceId, 'next')
      }
    } else {
      usePlayerStore.getState().playNext(true)
    }
  }

  const handlePrevious = () => {
    if (unified.isRemote) {
      if (unified.source === 'lan') {
        void remoteClient.previous()
      } else if (user?.id) {
        void sendDeviceCommand(user.id, unified.activeDeviceId, 'previous')
      }
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
      className="fixed bottom-[calc(3.8rem+env(safe-area-inset-bottom,0px))] left-2.5 right-2.5 z-40 bg-[#282828]/95 hover:bg-[#323232]/95 backdrop-blur-xl border border-white/10 rounded-xl p-2 shadow-2xl flex items-center gap-3 transition active:scale-[0.99] select-none cursor-pointer group"
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
        <PingPongMarquee
          text={title}
          active={isPlaying}
          speed={32}
          className="text-xs font-bold text-white leading-tight"
        />
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-zinc-400 truncate">
          <span className="truncate">{artist}</span>
          <span className="text-zinc-600">•</span>
          {activeRoom ? (
            <span className="shrink-0 flex items-center gap-1 font-semibold text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="truncate max-w-[120px]">Together: {activeRoom.name}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleDeviceClick}
              className={`shrink-0 flex items-center gap-1 font-semibold text-[10px] transition ${
                isRemote ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {deviceCategory === 'app_pc' ? (
                <Laptop2 className="w-3 h-3 text-emerald-400" />
              ) : deviceCategory === 'web_pc' ? (
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Smartphone className={`w-3 h-3 ${isRemote ? 'text-emerald-400' : 'text-zinc-300'}`} />
              )}
              <span>
                {isRemote ? `Listening on ${deviceName}` : deviceName}
              </span>
            </button>
          )}
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
          className="h-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.9)] transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
