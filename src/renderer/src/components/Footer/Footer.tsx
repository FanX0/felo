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
  PlusCircle,
  Mic2,
  ListVideo,
  Maximize2,
  Radio,
  LogOut,
  ListMusic,
  Loader2,
  Smartphone,
  Laptop2,
  Globe
} from 'lucide-react'
import RemoteControlModal from '../RemoteControlModal/RemoteControlModal'
import { getDeviceCategory, detectDeviceInfo } from '../../lib/deviceInfo'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand,
  getInterpolatedPosition
} from '../../hooks/useConnectedDeviceStore'
import ArtistLinks from '../Common/ArtistLinks'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toMediaUrl } from '../../lib/media'
import { getCurrentDeviceId } from '../../lib/deviceInfo'
import { ArtworkImage } from '../../pages/Home/components/ArtworkImage'
import type { DownloadTarget } from '../DownloadPanel/DownloadPanel'
import { AppCapabilities } from '../../lib/appConfig'

interface FooterProps {
  onOpenDownloadPanel?: (target?: DownloadTarget) => void
  isQueueOpen?: boolean
  onToggleQueue?: () => void
}

interface ProgressBarProps {
  duration: number
  seek: (time: number) => void
  currentTime?: number
  disabled?: boolean
  disabledTitle?: string
}

function ProgressBar({ duration, seek, currentTime: propCurrentTime, disabled, disabledTitle }: ProgressBarProps) {
  const storeCurrentTime = usePlayerStore((state) => state.currentTime)
  const currentTime = propCurrentTime !== undefined ? propCurrentTime : storeCurrentTime
  const [isSeeking, setIsSeeking] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const progressRef = useRef<HTMLDivElement>(null)

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00'
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
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

      event.currentTarget.setPointerCapture(event.pointerId)
      setIsSeeking(true)
    },
    [duration, disabled, updateSeekPreview]
  )

  const handleProgressPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isSeeking) return
      event.preventDefault()
      updateSeekPreview(event.clientX)
    },
    [isSeeking, updateSeekPreview]
  )

  const handleProgressPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isSeeking) return
      event.preventDefault()

      const finalTime = updateSeekPreview(event.clientX)
      if (finalTime !== null) {
        seek(finalTime)
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      setIsSeeking(false)
    },
    [isSeeking, seek, updateSeekPreview]
  )

  const handleProgressPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsSeeking(false)
  }, [])

  useEffect(() => {
    if (!isSeeking) {
      setPreviewTime(currentTime)
    }
  }, [currentTime, isSeeking])

  return (
    <div className="w-full flex items-center gap-2 text-[11px] font-mono text-text-muted">
      <span className="w-10 text-right">{formatTime(displayTime)}</span>
      <div
        ref={progressRef}
        onPointerDown={disabled ? undefined : handleProgressPointerDown}
        onPointerMove={disabled ? undefined : handleProgressPointerMove}
        onPointerUp={disabled ? undefined : handleProgressPointerUp}
        onPointerCancel={disabled ? undefined : handleProgressPointerCancel}
        title={disabledTitle}
        className={`flex-1 h-1.5 bg-border rounded-full relative no-drag flex items-center transition-all touch-none ${
          disabled ? 'cursor-not-allowed opacity-85' : 'cursor-pointer hover:h-2 group'
        }`}
      >
        <div
          className={`absolute left-0 h-full rounded-full transition-colors ${
            disabled ? 'bg-text-muted' : 'bg-text group-hover:bg-primary-amber'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
        {!disabled && (
          <div
            className="absolute h-3 w-3 bg-text rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md -ml-1.5"
            style={{ left: `${progressPercent}%` }}
          />
        )}
      </div>
      <span className="w-10 text-left">{formatTime(duration)}</span>
    </div>
  )
}

export default function Footer({ onOpenDownloadPanel, isQueueOpen, onToggleQueue }: FooterProps) {
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
  const isLocalAudioOwner = isAudioActive && isPlaying
  const isRemoteActive = Boolean(
    !isLocalAudioOwner &&
      activeRemote &&
      activeRemote.activeDeviceId !== myDeviceId &&
      activeRemote.song &&
      (activeRemote.isPlaying || activeRemote.position > 0)
  )

  const [remotePos, setRemotePos] = useState(0)

  useEffect(() => {
    if (!isRemoteActive || !activeRemote) return
    setRemotePos(getInterpolatedPosition(activeRemote))
    if (!activeRemote.isPlaying) return

    const timer = setInterval(() => {
      setRemotePos(getInterpolatedPosition(activeRemote))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRemoteActive, activeRemote?.timestamp, activeRemote?.isPlaying, activeRemote?.position])

  const displaySong = isRemoteActive && activeRemote?.song ? activeRemote.song : currentSong
  const displayIsPlaying = isRemoteActive && activeRemote ? activeRemote.isPlaying : isPlaying
  const displayDuration = isRemoteActive && activeRemote ? activeRemote.duration : duration
  const displayCurrentTime = isRemoteActive ? remotePos : undefined

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
  const location = useLocation()
  const [prevVolume, setPrevVolume] = useState(1)
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
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const missingSong = useListeningStore((state) => state.missingSong)
  const leaveJoinedRoom = useListeningStore((state) => state.leaveJoinedRoom)

  const isLyricsActive = location.pathname === '/lyrics'
  const artworkUrl =
    isRemoteActive && activeRemote?.song?.artworkUrl
      ? activeRemote.song.artworkUrl
      : toMediaUrl(currentSong?.artworkPath) || currentSong?.artworkUrl

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
    if (volume > 0) {
      setPrevVolume(volume)
      setVolume(0)
      if (isRemoteActive && activeRemote && user?.id) {
        void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'volume', { volume: 0 })
      }
    } else {
      const restored = prevVolume || 0.5
      setVolume(restored)
      if (isRemoteActive && activeRemote && user?.id) {
        void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'volume', { volume: restored })
      }
    }
  }

  const handlePlayClick = async () => {
    if (isRemoteActive && activeRemote && user?.id) {
      await sendDeviceCommand(
        user.id,
        activeRemote.activeDeviceId,
        activeRemote.isPlaying ? 'pause' : 'play'
      )
      return
    }

    if (queueLength > 0 && currentSongIndex >= 0 && currentSongIndex < queueLength) {
      togglePlay()
      return
    }

    try {
      const songs = await window.api?.getSongs?.()
      if (songs?.length) {
        const sorted = [...songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
        requestPlayQueue(sorted, 0)
      } else if (queueLength > 0) {
        togglePlay()
      }
    } catch (err) {
      console.error('Failed to start library playback:', err)
    }
  }

  const handleNextClick = async () => {
    if (isRemoteActive && activeRemote && user?.id) {
      await sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'next')
      return
    }
    playNext(true)
  }

  const handlePreviousClick = async () => {
    if (isRemoteActive && activeRemote && user?.id) {
      await sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'previous')
      return
    }
    playPrevious()
  }

  const handleSeek = (time: number) => {
    if (isRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'seek', { seconds: time })
      useConnectedDeviceStore.getState().updateRemotePosition(time)
      setRemotePos(time)
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
              className="flex items-center gap-1.5 mb-0.5 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition text-left cursor-pointer no-drag group"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
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
                  className="text-[10px] uppercase font-bold tracking-wider text-text-muted hover:text-white truncate text-left cursor-pointer no-drag flex items-center gap-1 transition-colors"
                >
                  <span className="text-primary-amber font-black">•</span>
                  <span className="truncate">{playbackContext.type}: {playbackContext.title}</span>
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

          <p
            onClick={handleTitleClick}
            title={
              displaySong
                ? isRemoteActive
                  ? `Playing on ${activeRemote?.activeDeviceName}`
                  : AppCapabilities.downloads
                    ? `Open download sources for "${displaySong.title}"`
                    : displaySong.title
                : 'Click play to start recently added'
            }
            className="text-[14px] font-medium text-text truncate hover:underline cursor-pointer no-drag"
          >
            {displaySong ? displaySong.title : 'No track selected'}
          </p>
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

        {/* Add to Liked */}
        {displaySong && (
          <button className="text-text-muted hover:text-text transition-colors no-drag shrink-0 p-1">
            <PlusCircle className="w-4 h-4" />
          </button>
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
            <button
              type="button"
              onClick={() => void leaveJoinedRoom()}
              title="Leave listen together session"
              className="flex items-center gap-0.5 rounded-full bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white px-2 py-0.5 text-[10px] font-bold transition-all ml-1"
            >
              <LogOut className="h-2.5 w-2.5" />
              <span>Leave</span>
            </button>
          </div>
        )}

      </div>

      {/* Controls (Center) */}
      <div className="flex flex-col items-center justify-center gap-1.5 w-[40%] max-w-[600px]">
        <div className="flex items-center gap-5 no-drag">
          {/* Shuffle button */}
          <button
            onClick={toggleShuffle}
            title={isShuffle ? 'Shuffle on' : 'Shuffle off'}
            className={`transition-colors relative ${isShuffle ? 'text-primary-amber' : 'text-text-muted hover:text-text'}`}
          >
            <Shuffle className="w-[17px] h-[17px]" />
            {isShuffle && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>

          {/* Previous */}
          <button
            onClick={handlePreviousClick}
            title="Previous"
            className="text-text-muted hover:text-text transition-colors"
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayClick}
            title={isBuffering ? 'Buffering track...' : displayIsPlaying ? 'Pause' : 'Play'}
            className="h-10 w-10 rounded-full bg-text text-canvas flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-md"
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
            title="Next"
            className="text-text-muted hover:text-text transition-colors"
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>

          {/* Repeat */}
          <button
            onClick={toggleRepeat}
            title={`Repeat: ${repeatMode}`}
            className={`transition-colors relative ${repeatMode !== 'off' ? 'text-primary-amber' : 'text-text-muted hover:text-text'}`}
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-[17px] h-[17px]" />
            ) : (
              <Repeat className="w-[17px] h-[17px]" />
            )}
            {repeatMode !== 'off' && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>

          {/* Autoplay / Infinity */}
          <button
            onClick={toggleAutoplay}
            title={`Autoplay similar songs when music ends: ${isAutoplay ? 'On' : 'Off'}`}
            className={`transition-colors relative ${isAutoplay ? 'text-primary-amber' : 'text-text-muted hover:text-text'}`}
          >
            <InfinityIcon className="w-[17px] h-[17px]" />
            {isAutoplay && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary-amber" />
            )}
          </button>
        </div>

        {/* Progress bar */}
        <ProgressBar
          duration={displayDuration}
          seek={handleSeek}
          currentTime={displayCurrentTime}
          disabled={Boolean(!displaySong || displayDuration <= 0 || joinedRoom)}
          disabledTitle={
            joinedRoom
              ? 'Playback position is locked to the live session host. Leave room to seek.'
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
              className="absolute left-0 h-full bg-text group-hover:bg-primary-amber rounded-full transition-colors"
              style={{ width: `${volume * 100}%` }}
            />
            <div
              className="absolute h-2.5 w-2.5 bg-text rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm -ml-1"
              style={{ left: `${volume * 100}%` }}
            />
          </div>
        </div>

        {/* Device Output Switcher / Remote Control */}
        {isRemoteActive && activeRemote ? (
          <button
            type="button"
            title={`Listening on ${activeRemote.activeDeviceName} (Click to switch)`}
            onClick={() => setIsRemoteModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/25 transition cursor-pointer text-xs font-semibold shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            {(() => {
              const cat = getDeviceCategory({
                device_type: activeRemote.activeDeviceType,
                device_category: activeRemote.activeDeviceCategory,
                device_name: activeRemote.activeDeviceName
              })
              if (cat === 'app_pc') return <Laptop2 className="w-3.5 h-3.5" />
              if (cat === 'web_pc') return <Globe className="w-3.5 h-3.5" />
              return <Smartphone className="w-3.5 h-3.5" />
            })()}
            <span className="truncate max-w-[120px]">{activeRemote.activeDeviceName}</span>
          </button>
        ) : (
          <button
            title={`Listening on ${detectDeviceInfo().name} (Click to connect devices)`}
            onClick={() => setIsRemoteModalOpen(true)}
            className={`hover:text-text transition-colors p-1 relative ${
              connectedPhones > 0 ? 'text-white' : ''
            }`}
          >
            <Radio className="w-4 h-4" />
            {connectedPhones > 0 && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            )}
          </button>
        )}

        <button title="Full Screen" className="hover:text-text transition-colors ml-1 p-1">
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <RemoteControlModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
      />
    </footer>
  )
}
