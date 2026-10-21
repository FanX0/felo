import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  Infinity as InfinityIcon,
  Mic2,
  ListVideo,
  Radio,
  MonitorSpeaker,
  LogOut,
  ListMusic,
  Loader2,
  Smartphone,
  Laptop2,
  Globe,
  Sliders,
  Crown
} from 'lucide-react'
import { useDspStore } from '../../hooks/useDspStore'
import RemoteControlModal from '../RemoteControlModal/RemoteControlModal'
import { detectDeviceInfo } from '../../lib/deviceInfo'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from '../../hooks/useConnectedDeviceStore'
import { resolveEffectivePlaybackState } from '../../lib/playbackStateResolver'
import { remoteClient, type RemotePlayerState } from '../../pages/Remote/remoteClient'
import ArtistLinks from '../Common/ArtistLinks'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useListeningStore, useIsPlayerLocked } from '../../hooks/useListeningStore'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { audioDspEngine } from '../../lib/audioDspEngine'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toMediaUrl } from '../../lib/media'
import { getCurrentDeviceId } from '../../lib/deviceInfo'
import { ArtworkImage } from '../../pages/Home/components/ArtworkImage'
import type { DownloadTarget } from '../DownloadPanel/DownloadPanel'
import { AppCapabilities } from '../../lib/appConfig'
import PingPongMarquee from '../Common/PingPongMarquee'
import SongAddButton from '../Common/SongAddButton'
import { fmtTime, UNAVAILABLE_TIME_TEXT } from '../../lib/songUtils'
import { getSupabase } from '../../lib/supabase'

interface FooterProps {
  onOpenDownloadPanel?: (target?: DownloadTarget) => void
  isQueueOpen?: boolean
  onToggleQueue?: () => void
  onToggleAudioStudio?: () => void
}

interface ProgressBarProps {
  duration: number
  seek: (time: number) => void
  currentTime?: number
  disabled?: boolean
  disabledTitle?: string
}

export function ProgressBar({ duration, seek, currentTime: propCurrentTime, disabled, disabledTitle }: ProgressBarProps) {
  const storeCurrentTime = usePlayerStore((state) => state.currentTime)
  const currentTime = propCurrentTime !== undefined ? propCurrentTime : storeCurrentTime
  const [isSeeking, setIsSeeking] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const [timeDisplayMode, setTimeDisplayMode] = useState<'duration' | 'remaining'>(() => {
    try {
      const saved = localStorage.getItem('felo_mobile_time_mode')
      return saved === 'remaining' ? 'remaining' : 'duration'
    } catch {
      return 'duration'
    }
  })

  const toggleTimeDisplayMode = () => {
    setTimeDisplayMode((prev) => {
      const next = prev === 'duration' ? 'remaining' : 'duration'
      try {
        localStorage.setItem('felo_mobile_time_mode', next)
      } catch {
        // ignore
      }
      return next
    })
  }

  const formatTime = (time: number) => {
    return fmtTime(time, duration > 0 ? '0:00' : UNAVAILABLE_TIME_TEXT)
  }

  const displayTime = isSeeking ? previewTime : currentTime
  const progressPercent = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0

  const getSeekTimeFromClientX = useCallback(
    (clientX: number) => {
      const rect = progressRef.current?.getBoundingClientRect()
      if (!rect || duration <= 0) return null
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return fraction * duration
    },
    [duration]
  )

  const updateSeekPreview = useCallback(
    (clientX: number) => {
      const nextTime = getSeekTimeFromClientX(clientX)
      if (nextTime !== null) {
        setPreviewTime(nextTime)
      }
      return nextTime
    },
    [getSeekTimeFromClientX]
  )

  const handleProgressPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (duration <= 0 || disabled) return
      event.preventDefault()

      const startTime = updateSeekPreview(event.clientX)
      if (startTime === null) return

      event.currentTarget.setPointerCapture?.(event.pointerId)
      setIsSeeking(true)
      setHoverTime(null)
    },
    [duration, disabled, updateSeekPreview]
  )

  const handleProgressPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isSeeking) {
        event.preventDefault()
        updateSeekPreview(event.clientX)
      } else if (!disabled && duration > 0) {
        const time = getSeekTimeFromClientX(event.clientX)
        const rect = progressRef.current?.getBoundingClientRect()
        if (time !== null && rect) {
          setHoverTime(time)
          setHoverX(Math.max(12, Math.min(rect.width - 12, event.clientX - rect.left)))
        }
      }
    },
    [isSeeking, disabled, duration, updateSeekPreview, getSeekTimeFromClientX]
  )

  const handleProgressPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isSeeking) return
      event.preventDefault()

      const finalTime = updateSeekPreview(event.clientX)
      if (finalTime !== null) {
        seek(finalTime)
      }

      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }
      setIsSeeking(false)
    },
    [isSeeking, seek, updateSeekPreview]
  )

  const handleProgressPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
    setIsSeeking(false)
    setHoverTime(null)
  }, [])

  const handlePointerLeave = () => {
    if (!isSeeking) {
      setHoverTime(null)
      setHoverX(null)
    }
  }

  useEffect(() => {
    if (!isSeeking) {
      setPreviewTime(currentTime)
    }
  }, [currentTime, isSeeking])

  return (
    <div className="w-full flex items-center gap-2 text-[11px] font-mono text-text-muted">
      <span className="min-w-[36px] text-right tabular-nums">{formatTime(displayTime)}</span>
      <div
        ref={progressRef}
        onPointerDown={disabled ? undefined : handleProgressPointerDown}
        onPointerMove={disabled ? undefined : handleProgressPointerMove}
        onPointerUp={disabled ? undefined : handleProgressPointerUp}
        onPointerCancel={disabled ? undefined : handleProgressPointerCancel}
        onPointerLeave={handlePointerLeave}
        title={disabledTitle}
        className={`flex-1 h-1.5 bg-border rounded-full relative no-drag flex items-center transition-[height] duration-150 touch-none ${
          disabled ? 'cursor-not-allowed opacity-85' : 'cursor-pointer hover:h-2 group'
        }`}
      >
        {/* Hover Timestamp Preview Tooltip */}
        {!disabled && hoverTime !== null && hoverX !== null && (
          <div
            className="absolute -top-7 -translate-x-1/2 px-2 py-0.5 rounded-md bg-surface-elevated border border-border/60 text-[10px] font-mono text-text font-bold shadow-md pointer-events-none transition-opacity animate-in fade-in duration-150 z-30"
            style={{ left: `${hoverX}px` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}

        <div
          className={`absolute left-0 h-full rounded-full transition-colors ${
            disabled ? 'bg-text-muted' : isSeeking ? 'bg-primary' : 'bg-text group-hover:bg-primary'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
        {!disabled && (
          <div
            className={`absolute top-1/2 -mt-1.5 -ml-1.5 h-3 w-3 bg-white rounded-full shadow-md pointer-events-none transition-[opacity,transform] duration-150 ${
              isSeeking ? 'opacity-100 scale-110' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ left: `${progressPercent}%` }}
          />
        )}
      </div>
      <button
        type="button"
        onClick={toggleTimeDisplayMode}
        className="min-w-[36px] text-left tabular-nums text-text-muted hover:text-text active:opacity-60 transition-colors cursor-pointer select-none"
        title={
          timeDisplayMode === 'remaining'
            ? 'Remaining time (-M:SS). Click to show total duration'
            : 'Total duration (M:SS). Click to show remaining time'
        }
        aria-label={
          timeDisplayMode === 'remaining'
            ? `Remaining time: -${fmtTime(Math.max(0, duration - displayTime), '0:00')}. Click to show total duration.`
            : `Total duration: ${fmtTime(duration, UNAVAILABLE_TIME_TEXT)}. Click to show remaining time.`
        }
      >
        {timeDisplayMode === 'remaining' && duration > 0
          ? `-${fmtTime(Math.max(0, duration - displayTime), '0:00')}`
          : fmtTime(duration, UNAVAILABLE_TIME_TEXT)}
      </button>
    </div>
  )
}

export default function Footer({
  onOpenDownloadPanel,
  isQueueOpen,
  onToggleQueue,
  onToggleAudioStudio
}: FooterProps) {
  const currentSong = usePlayerStore((state) => state.queue[state.currentSongIndex])
  const isPlaying = usePlayerStore((state) => state.isPlaying)
  const isBuffering = usePlayerStore((state) => state.isBuffering)
  const volume = usePlayerStore((state) => state.volume)
  const duration = usePlayerStore((state) => state.duration)
  const isShuffle = usePlayerStore((state) => state.isShuffle)
  const repeatMode = usePlayerStore((state) => state.repeatMode)
  const queueLength = usePlayerStore((state) => state.queue.length)
  const currentSongIndex = usePlayerStore((state) => state.currentSongIndex)

  const user = useOnlineStore((state) => state.user)
  const activeRemote = useConnectedDeviceStore((state) => state.activePlayback)
  const myDeviceId = getCurrentDeviceId()
  const { requestPlayQueue } = usePlaybackArbitration()
  const isAudioActive = usePlayerStore((state) => state.isAudioActive)

  const [lanState, setLanState] = useState<RemotePlayerState>(() => remoteClient.getState())
  const [isLanConnected, setIsLanConnected] = useState(() => remoteClient.getIsConnected())

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setLanState)
    const unsubConn = remoteClient.subscribeConnection(setIsLanConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  const unified = resolveEffectivePlaybackState({
    localPlayer: {
      queue: usePlayerStore.getState().queue,
      currentSongIndex,
      isPlaying,
      currentTime: usePlayerStore.getState().currentTime,
      duration,
      volume,
      isAudioActive,
      isShuffle,
      repeatMode
    },
    activeRemote,
    lanState,
    isLanConnected,
    myDeviceId
  })

  const isRemoteActive = Boolean(unified.isRemote && unified.song)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!isRemoteActive || !unified.isPlaying) return undefined
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [isRemoteActive, unified.isPlaying])

  const displaySong = isRemoteActive && unified.song ? unified.song : currentSong
  const displayIsPlaying = isRemoteActive ? unified.isPlaying : isPlaying
  const displayDuration = isRemoteActive ? unified.duration : duration
  const displayCurrentTime = isRemoteActive ? unified.position : undefined

  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const playNext = usePlayerStore((state) => state.playNext)
  const playPrevious = usePlayerStore((state) => state.playPrevious)
  const setVolume = usePlayerStore((state) => state.setVolume)
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle)
  const toggleRepeat = usePlayerStore((state) => state.toggleRepeat)
  const isAutoplay = usePlayerStore((state) => state.isAutoplay)
  const toggleAutoplay = usePlayerStore((state) => state.toggleAutoplay)
  const seek = usePlayerStore((state) => state.seek)
  const playbackContext = usePlayerStore((state) => state.playbackContext)
  const transfers = useDownloadStore((state) => state.transfers)
  const prefetchingTransfer = transfers.find(
    (t) => (t.status === 'downloading' || t.status === 'queued') && !t.autoPlay
  )

  const navigate = useNavigate()

  const speakerRole = useDspStore((s) => s.speakerRole)
  const reverbEnabled = useDspStore((s) => s.reverbEnabled)
  const virtualBass = useDspStore((s) => s.virtualBass)
  const virtualTreble = useDspStore((s) => s.virtualTreble)
  const virtualSurround = useDspStore((s) => s.virtualSurround)
  const isAudioModalOpen = useDspStore((s) => s.isAudioModalOpen)
  const setIsAudioModalOpen = useDspStore((s) => s.setIsAudioModalOpen)
  const location = useLocation()
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState(false)
  const [connectedPhones, setConnectedPhones] = useState(0)

  useEffect(() => {
    let mounted = true
    const checkClients = async () => {
      if (!window.api?.getRemoteControlInfo) return
      try {
        const info = await window.api.getRemoteControlInfo()
        if (mounted && info) {
          setConnectedPhones(info.connectedClients || 0)
        }
      } catch {
        // ignore
      }
    }
    void checkClients()
    const timer = setInterval(() => void checkClients(), 8000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const myRole = useListeningStore((state) => state.myRole)
  const memberCount = useListeningStore((state) => state.memberCount)
  const isPlayerLocked = useIsPlayerLocked()
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const missingSong = useListeningStore((state) => state.missingSong)
  const leaveJoinedRoom = useListeningStore((state) => state.leaveJoinedRoom)
  const isAutoplayBlocked = useListeningStore((state) => state.isAutoplayBlocked)
  const unmuteDeviceStream = useListeningStore((state) => state.unmuteDeviceStream)
  const manualSyncOffsetMs = useListeningStore((state) => state.manualSyncOffsetMs)
  const setIsManualSyncModalOpen = useListeningStore((state) => state.setIsManualSyncModalOpen)

  const isLyricsActive = location.pathname === '/lyrics'
  const artworkUrl =
    isRemoteActive && activeRemote?.song?.artworkUrl
      ? activeRemote.song.artworkUrl
      : toMediaUrl(displaySong?.artworkPath) || displaySong?.artworkUrl

  const toggleLyrics = () => {
    if (isLyricsActive) {
      navigate(-1)
    } else {
      navigate('/lyrics')
    }
  }

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const newVol = clickX / rect.width
    setVolume(newVol)
    if (isRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'volume', { volume: newVol })
    }
  }

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const newVol = clickX / rect.width
    setVolume(newVol)
    if (isRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'volume', { volume: newVol })
    }
  }

  const toggleMute = () => {
    usePlayerStore.getState().toggleMute()
    const nextVol = usePlayerStore.getState().volume
    if (isRemoteActive && user?.id) {
      void sendDeviceCommand(user.id, unified.activeDeviceId, 'volume', { volume: nextVol })
    }
  }

  const handlePlayClick = async () => {
    void audioDspEngine.resume()
    if (isRemoteActive) {
      if (unified.source === 'lan') {
        void remoteClient.togglePlay()
        return
      }
      if (user?.id) {
        await sendDeviceCommand(
          user.id,
          unified.activeDeviceId,
          unified.isPlaying ? 'pause' : 'play'
        )
      }
      return
    }

    if (joinedRoom && joinedRoom.code && myRole === 'co_host') {
      const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
      void getSupabase()
        .from('listening_room_commands')
        .insert({
          room_code: joinedRoom.code,
          command: isPlaying ? 'pause' : 'resume',
          sender_name: senderName,
          source: 'web',
          payload: {}
        })
      return
    }

    if (queueLength > 0 && currentSongIndex >= 0 && currentSongIndex < queueLength) {
      togglePlay()
      return
    }

    try {
      let songs = await window.api?.getSongs?.()
      if (!songs || songs.length === 0) {
        songs = useConnectedDeviceStore.getState().pcLibrarySongs
      }
      if (songs?.length) {
        const sorted = [...songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
        requestPlayQueue(sorted, 0, {
          type: 'library',
          title: 'Your Library',
          route: '/library'
        })
      } else if (queueLength > 0) {
        togglePlay()
      }
    } catch (err) {
      console.error('Failed to start library playback:', err)
    }
  }

  const handleNextClick = async () => {
    if (isRemoteActive) {
      if (unified.source === 'lan') {
        void remoteClient.next()
        return
      }
      if (user?.id) {
        await sendDeviceCommand(user.id, unified.activeDeviceId, 'next')
      }
      return
    }

    if (joinedRoom && joinedRoom.code && myRole === 'co_host') {
      const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
      void getSupabase()
        .from('listening_room_commands')
        .insert({
          room_code: joinedRoom.code,
          command: 'skip',
          sender_name: senderName,
          source: 'web',
          payload: {}
        })
      return
    }

    playNext(true)
  }

  const handlePreviousClick = async () => {
    if (isRemoteActive) {
      if (unified.source === 'lan') {
        void remoteClient.previous()
        return
      }
      if (user?.id) {
        await sendDeviceCommand(user.id, unified.activeDeviceId, 'previous')
      }
      return
    }

    if (joinedRoom && joinedRoom.code && myRole === 'co_host') {
      const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
      void getSupabase()
        .from('listening_room_commands')
        .insert({
          room_code: joinedRoom.code,
          command: 'prev',
          sender_name: senderName,
          source: 'web',
          payload: {}
        })
      return
    }

    playPrevious()
  }

  const handleSeek = (time: number) => {
    if (isRemoteActive) {
      if (unified.source === 'lan') {
        void remoteClient.seek(time)
        return
      }
      if (user?.id) {
        void sendDeviceCommand(user.id, unified.activeDeviceId, 'seek', { seconds: time })
        useConnectedDeviceStore.getState().updateRemotePosition(time)
      }
      return
    }

    if (joinedRoom && joinedRoom.code && myRole === 'co_host') {
      const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
      void getSupabase()
        .from('listening_room_commands')
        .insert({
          room_code: joinedRoom.code,
          command: 'seek',
          sender_name: senderName,
          source: 'web',
          payload: { seconds: time }
        })
      return
    }

    seek(time)
  }

  const handleTitleClick = () => {
    if (isRemoteActive) {
      setIsRemoteModalOpen(true)
      return
    }
    if (!currentSong) {
      void handlePlayClick()
      return
    }
    if (AppCapabilities.downloads) {
      onOpenDownloadPanel?.(currentSong)
    }
  }

  return (
    <footer className="h-[min(10vh,104px)] min-h-[88px] bg-canvas px-4 flex items-center justify-between select-none border-t border-border/40">
      {/* Song Info (Left) */}
      <div className="flex items-center gap-4 w-[30%] min-w-[200px]">
        {/* Cover Art */}
        <div
          onClick={displaySong ? handleTitleClick : () => void handlePlayClick()}
          title={
            displaySong
              ? isRemoteActive
                ? `Playing on ${activeRemote?.activeDeviceName}`
                : AppCapabilities.downloads
                  ? `Open download sources for "${displaySong.title}"`
                  : displaySong.title
              : 'Click play to start recently added'
          }
          className="relative h-[64px] w-[64px] bg-surface-elevated rounded-md shrink-0 flex items-center justify-center shadow-md overflow-hidden border border-border/10 cursor-pointer hover:border-white/30"
        >
          {displaySong ? (
            <ArtworkImage
              src={artworkUrl}
              title={displaySong.title}
              artist={displaySong.artist}
              loading="eager"
              className="absolute inset-0 h-full w-full object-cover"
              fallbackIcon={
                <div className="w-full h-full bg-gradient-to-br from-indigo-900/60 to-purple-900/60 flex items-center justify-center text-[10px] font-bold text-text-muted uppercase">
                  {displaySong.album && displaySong.album !== 'UNKNOWN' ? displaySong.album.slice(0, 3) : 'Felo'}
                </div>
              }
            />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-text-muted"
            >
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
          )}
        </div>

        {/* Title & Artist & Context */}
        <div className="flex flex-col overflow-hidden mr-2">
          {isRemoteActive && activeRemote ? (
            <button
              type="button"
              onClick={() => setIsRemoteModalOpen(true)}
              className="flex items-center gap-1.5 mb-0.5 text-[11px] font-bold text-primary hover:opacity-80 transition text-left cursor-pointer no-drag group"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
              {activeRemote.activeDeviceType === 'mobile' ? (
                <Smartphone className="w-3 h-3 shrink-0" />
              ) : (
                <Laptop2 className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate">Listening on {activeRemote.activeDeviceName}</span>
            </button>
          ) : (playbackContext || prefetchingTransfer) ? (
            <div className="flex items-center gap-2 mb-0.5">
              {playbackContext && (
                <button
                  type="button"
                  onClick={() => {
                    if (playbackContext.route) navigate(playbackContext.route)
                  }}
                  title={`Playing from ${playbackContext.type}: ${playbackContext.title}`}
                  className="text-[11px] font-medium text-text-muted hover:text-text hover:underline truncate text-left cursor-pointer no-drag transition-colors"
                >
                  <span className="truncate">{playbackContext.title}</span>
                </button>
              )}
              {AppCapabilities.downloads && prefetchingTransfer && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-primary-amber bg-primary-amber/10 px-1.5 py-0.2 rounded font-medium shrink-0 animate-pulse"
                  title={`Buffering upcoming track "${prefetchingTransfer.title}" in background...`}
                >
                  Caching next
                </span>
              )}
            </div>
          ) : null}

          {displaySong ? (
            <PingPongMarquee
              text={displaySong.title}
              onClick={handleTitleClick}
              active={isPlaying}
              className="text-[14px] font-medium text-text hover:underline cursor-pointer no-drag"
              title={
                isRemoteActive
                  ? `Playing on ${activeRemote?.activeDeviceName}`
                  : AppCapabilities.downloads
                    ? `Open download sources for "${displaySong.title}"`
                    : displaySong.title
              }
            />
          ) : (
            <p
              onClick={handleTitleClick}
              title="Click play to start recently added"
              className="text-[14px] font-medium text-text truncate hover:underline cursor-pointer no-drag"
            >
              No track selected
            </p>
          )}
          {displaySong ? (
            <div className="text-[12px] truncate no-drag">
              <ArtistLinks
                artist={displaySong.artist}
                artists={displaySong.artists}
                linkClassName="text-text-muted hover:text-text hover:underline text-[12px]"
                separatorClassName="text-text-muted/60"
              />
            </div>
          ) : (
            <p
              onClick={() => void handlePlayClick()}
              title="Click play to start recently added"
              className="text-[12px] text-text-muted truncate hover:underline cursor-pointer no-drag hover:text-text transition-colors"
            >
              Click play to start recently added
            </p>
          )}
        </div>

        {/* Add to Liked / Playlist */}
        {displaySong && (
          <SongAddButton
            song={displaySong}
            size="md"
            alwaysVisible={true}
            className="no-drag ml-1"
          />
        )}

        {/* Listen Together Status Badge */}
        {joinedRoom && (
          <div
            className={`hidden xl:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs no-drag shrink-0 transition-colors ${
              syncStatus === 'missing_song'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : syncStatus === 'host_reconnecting'
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 animate-pulse'
                : 'border-border/60 bg-surface-elevated text-text'
            }`}
          >
            <Radio className="h-3 w-3 animate-pulse shrink-0" />
            <button
              type="button"
              onClick={() => navigate('/listen-together')}
              className="truncate max-w-[120px] font-bold text-[11px] hover:underline cursor-pointer text-left"
              title="Open Listen Together session"
            >
              {syncStatus === 'missing_song'
                ? `Missing: ${missingSong?.title || 'Song'}`
                : syncStatus === 'host_reconnecting'
                ? 'Host reconnecting...'
                : joinedRoom.name}
            </button>
            {myRole && (
              <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/40">
                {myRole === 'host' ? 'Host' : myRole === 'co_host' ? 'Co-host' : 'Listener'}
              </span>
            )}
            {isAutoplayBlocked && (
              <button
                type="button"
                onClick={() => void unmuteDeviceStream()}
                title="Audio blocked by browser. Click to unmute!"
                className="flex items-center gap-1 rounded-full bg-primary-amber hover:bg-amber-400 text-black px-2 py-0.5 text-[10px] font-bold shadow-md shadow-amber-500/20 animate-bounce transition-all ml-1 cursor-pointer"
              >
                <Volume2 className="h-2.5 w-2.5" />
                <span>Unmute</span>
              </button>
            )}
            <button
              type="button"
              disabled={myRole === 'host'}
              onClick={() => {
                if (myRole !== 'host') {
                  setIsManualSyncModalOpen(true)
                }
              }}
              title={
                myRole === 'host'
                  ? 'Manual sync is disabled for host (host is the reference audio source)'
                  : 'Manual sync latency calibration (ms)'
              }
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold transition-all ml-0.5 ${
                myRole === 'host'
                  ? 'bg-white/5 text-zinc-500 opacity-40 cursor-not-allowed border border-white/5 shadow-none'
                  : 'bg-white/10 hover:bg-white/20 text-text cursor-pointer'
              }`}
            >
              <Sliders className={`h-2.5 w-2.5 ${myRole === 'host' ? 'text-zinc-500' : 'text-text-muted'}`} />
              <span>{manualSyncOffsetMs && myRole !== 'host' ? `${manualSyncOffsetMs > 0 ? `+${manualSyncOffsetMs}` : manualSyncOffsetMs}ms` : 'Sync'}</span>
            </button>
            <button
              type="button"
              onClick={() => void leaveJoinedRoom()}
              title="Leave listen together session"
              className="flex items-center gap-1 rounded-full bg-danger hover:bg-danger/90 text-white px-2 py-0.5 text-[10px] font-bold transition-all ml-1 cursor-pointer shadow-xs"
            >
              <LogOut className="h-2.5 w-2.5" />
              <span>Leave</span>
            </button>
          </div>
        )}

        {/* Host Room Status Badge */}
        {hostRoom && !joinedRoom && (
          <div className="hidden xl:flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated text-text px-2.5 py-1 text-xs no-drag shrink-0 transition-colors">
            <Radio className="h-3 w-3 animate-pulse text-primary shrink-0" />
            <button
              type="button"
              onClick={() => navigate('/listen-together')}
              className="truncate max-w-[120px] font-bold text-[11px] hover:underline cursor-pointer text-left flex items-center gap-1"
              title="Open host room"
            >
              <Crown className="h-3 w-3 text-text-muted shrink-0" />
              <span className="truncate">{hostRoom.name}</span>
            </button>
            {memberCount > 1 && (
              <span className="text-[10px] text-text-muted font-semibold">({memberCount})</span>
            )}
          </div>
        )}

      </div>

      {/* Controls (Center) */}
      <div className="flex flex-col items-center justify-center gap-1.5 w-[40%] max-w-[600px]">
        <div className="flex items-center gap-5 no-drag">
          {/* Shuffle button */}
          <button
            onClick={toggleShuffle}
            disabled={isPlayerLocked}
            title={isPlayerLocked ? 'Host controls playback' : isShuffle ? 'Shuffle on' : 'Shuffle off'}
            className={`transition-colors relative ${
              isPlayerLocked
                ? 'opacity-30 cursor-not-allowed text-text-muted'
                : isShuffle
                ? 'text-primary-amber'
                : 'text-text-muted hover:text-text'
            }`}
          >
            <Shuffle className="w-[17px] h-[17px]" />
            {isShuffle && !isPlayerLocked && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>

          {/* Previous */}
          <button
            onClick={handlePreviousClick}
            disabled={isPlayerLocked}
            title={isPlayerLocked ? 'Host controls playback' : 'Previous'}
            className={`transition-colors ${
              isPlayerLocked ? 'opacity-30 cursor-not-allowed text-text-muted' : 'text-text-muted hover:text-text'
            }`}
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayClick}
            disabled={isPlayerLocked}
            title={
              isPlayerLocked
                ? 'Host controls playback'
                : isBuffering
                ? 'Buffering track...'
                : displayIsPlaying
                ? 'Pause'
                : 'Play'
            }
            className={`h-10 w-10 rounded-full flex items-center justify-center transition-transform shadow-md ${
              isPlayerLocked
                ? 'bg-text/40 text-canvas/60 cursor-not-allowed'
                : 'bg-text text-canvas hover:scale-105 active:scale-95'
            }`}
          >
            {isBuffering ? (
              <Loader2 className="w-4 h-4 animate-spin text-canvas" />
            ) : displayIsPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={handleNextClick}
            disabled={isPlayerLocked}
            title={isPlayerLocked ? 'Host controls playback' : 'Next'}
            className={`transition-colors ${
              isPlayerLocked ? 'opacity-30 cursor-not-allowed text-text-muted' : 'text-text-muted hover:text-text'
            }`}
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>

          {/* Repeat */}
          <button
            onClick={toggleRepeat}
            disabled={isPlayerLocked}
            title={isPlayerLocked ? 'Host controls playback' : `Repeat: ${repeatMode}`}
            className={`transition-colors relative ${
              isPlayerLocked
                ? 'opacity-30 cursor-not-allowed text-text-muted'
                : repeatMode !== 'off'
                ? 'text-primary-amber'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-[17px] h-[17px]" />
            ) : (
              <Repeat className="w-[17px] h-[17px]" />
            )}
            {repeatMode !== 'off' && !isPlayerLocked && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>

          {/* Autoplay / Infinity */}
          <button
            onClick={toggleAutoplay}
            disabled={isPlayerLocked}
            title={
              isPlayerLocked
                ? 'Host controls playback'
                : `Autoplay similar songs when music ends: ${isAutoplay ? 'On' : 'Off'}`
            }
            className={`transition-colors relative ${
              isPlayerLocked
                ? 'opacity-30 cursor-not-allowed text-text-muted'
                : isAutoplay
                ? 'text-primary-amber'
                : 'text-text-muted hover:text-text'
            }`}
          >
            <InfinityIcon className="w-[17px] h-[17px]" />
            {isAutoplay && !isPlayerLocked && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>
        </div>

        {/* Progress bar */}
        <ProgressBar
          duration={displayDuration}
          seek={handleSeek}
          currentTime={displayCurrentTime}
          disabled={Boolean(!displaySong || displayDuration <= 0 || isPlayerLocked)}
          disabledTitle={
            isPlayerLocked
              ? 'Playback position is locked to the live session host.'
              : undefined
          }
        />
      </div>

      {/* Volume & Extra (Right) */}
      <div className="flex items-center justify-end gap-3 w-[30%] min-w-[200px] text-text-muted no-drag">
        {/* Queue */}
        <button
          title="Play Queue"
          className={`hover:text-text transition-colors p-1 relative ${isQueueOpen ? 'text-primary-amber' : ''}`}
          onClick={onToggleQueue}
        >
          <ListMusic className="w-4 h-4" />
          {queueLength > 0 && isQueueOpen && (
            <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-primary-amber" />
          )}
        </button>

        {/* Lyrics */}
        {Boolean(displaySong) && (
          <button
            title="Lyrics"
            className={`hover:text-text transition-colors p-1 ${isLyricsActive ? 'text-primary-amber' : ''}`}
            onClick={toggleLyrics}
          >
            <Mic2 className="w-4 h-4" />
          </button>
        )}

        {/* Download sources */}
        {AppCapabilities.downloads && (
          <button
            title="Download sources"
            onClick={() => onOpenDownloadPanel?.(currentSong)}
            className="hover:text-text transition-colors p-1"
          >
            <ListVideo className="w-4 h-4" />
          </button>
        )}

        {/* Volume */}
        <div className="flex items-center gap-2 w-28">
          <button onClick={toggleMute} className="hover:text-text transition-colors p-1">
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div
            className="flex-1 h-1 bg-border hover:h-1.5 rounded-full cursor-pointer group relative flex items-center transition-all touch-none"
            onPointerDown={handleVolumePointerDown}
            onPointerMove={handleVolumePointerMove}
          >
            <div
              className="absolute left-0 h-full bg-text group-hover:bg-primary rounded-full transition-colors"
              style={{ width: `${volume * 100}%` }}
            />
            <div
              className="absolute h-2.5 w-2.5 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md -ml-1"
              style={{ left: `${volume * 100}%` }}
            />
          </div>
        </div>

        {/* Spatial Audio & Speaker Roles (Acoustics & DSP) */}
        <button
          type="button"
          title={`Acoustic Settings & Spatial DSP (${speakerRole.charAt(0).toUpperCase() + speakerRole.slice(1)} Speaker)`}
          onClick={onToggleAudioStudio ? onToggleAudioStudio : () => setIsAudioModalOpen(!isAudioModalOpen)}
          className={`hover:text-text transition-colors p-1 ${
            isAudioModalOpen || speakerRole !== 'center' || reverbEnabled || virtualBass || virtualTreble || virtualSurround
              ? 'text-primary-amber'
              : ''
          }`}
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Device Output Switcher / Remote Control */}
        {isRemoteActive ? (
          <button
            type="button"
            title={`Listening on ${unified.activeDeviceName} (Click to switch)`}
            onClick={() => setIsRemoteModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-elevated border border-border/60 text-text hover:bg-hover transition cursor-pointer text-xs font-semibold shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
            {unified.activeDeviceCategory === 'app_pc' ? (
              <Laptop2 className="w-3.5 h-3.5" />
            ) : unified.activeDeviceCategory === 'web_pc' ? (
              <Globe className="w-3.5 h-3.5" />
            ) : (
              <Smartphone className="w-3.5 h-3.5" />
            )}
            <span className="truncate max-w-[120px]">{unified.activeDeviceName}</span>
          </button>
        ) : (
          <button
            title={`Listening on ${detectDeviceInfo().name} (Click to connect devices)`}
            onClick={() => setIsRemoteModalOpen(true)}
            className={`hover:text-text transition-colors p-1 relative ${
              connectedPhones > 0 ? 'text-white' : ''
            }`}
          >
            <MonitorSpeaker className="w-4 h-4" />
            {connectedPhones > 0 && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            )}
          </button>
        )}
      </div>

      <RemoteControlModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
      />
    </footer>
  )
}
