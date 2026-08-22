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
  PlusCircle,
  Mic2,
  ListVideo,
  Maximize2
} from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toMediaUrl } from '../../lib/media'

interface FooterProps {
  onOpenDownloadPanel?: () => void
}

export default function Footer({ onOpenDownloadPanel }: FooterProps) {
  const {
    queue,
    currentSongIndex,
    isPlaying,
    volume,
    currentTime,
    duration,
    isShuffle,
    repeatMode,
    setQueue,
    togglePlay,
    playNext,
    playPrevious,
    setVolume,
    toggleShuffle,
    toggleRepeat,
    seek
  } = usePlayerStore()

  const navigate = useNavigate()
  const location = useLocation()
  const [prevVolume, setPrevVolume] = useState(1)
  const [isSeeking, setIsSeeking] = useState(false)
  const [previewTime, setPreviewTime] = useState(0)
  const progressRef = useRef<HTMLDivElement>(null)

  const currentSong = queue[currentSongIndex]
  const isLyricsActive = location.pathname === '/lyrics'
  const artworkUrl = toMediaUrl(currentSong?.artworkPath)

  const toggleLyrics = () => {
    if (isLyricsActive) {
      navigate(-1)
    } else {
      navigate('/lyrics')
    }
  }

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
      if (!currentSong || duration <= 0) return
      event.preventDefault()

      const startTime = updateSeekPreview(event.clientX)
      if (startTime === null) return

      event.currentTarget.setPointerCapture(event.pointerId)
      setIsSeeking(true)
    },
    [currentSong, duration, updateSeekPreview]
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

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    setVolume(clickX / rect.width)
  }

  const toggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume)
      setVolume(0)
    } else {
      setVolume(prevVolume || 0.5)
    }
  }

  const handlePlayClick = async () => {
    if (queue.length > 0) {
      togglePlay()
      return
    }

    try {
      const songs = await window.api?.getSongs?.()
      if (songs?.length) {
        setQueue(songs, 0)
      }
    } catch (err) {
      console.error('Failed to start library playback:', err)
    }
  }

  return (
    <footer className="h-[min(10vh,104px)] min-h-[88px] bg-canvas px-4 flex items-center justify-between select-none border-t border-border/40">
      {/* Song Info (Left) */}
      <div className="flex items-center gap-4 w-[30%] min-w-[200px]">
        {/* Cover Art */}
        <div className="relative h-[64px] w-[64px] bg-surface-elevated rounded-md shrink-0 flex items-center justify-center shadow-md overflow-hidden border border-border/10">
          {currentSong ? (
            <div className="w-full h-full bg-gradient-to-br from-indigo-900/60 to-purple-900/60 flex items-center justify-center text-[10px] font-bold text-text-muted uppercase">
              {currentSong.album ? currentSong.album.slice(0, 3) : 'Felo'}
            </div>
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
          {artworkUrl && (
            <img
              src={artworkUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
        </div>

        {/* Title & Artist */}
        <div className="flex flex-col overflow-hidden mr-2">
          <p className="text-[14px] font-medium text-text truncate hover:underline cursor-pointer no-drag">
            {currentSong ? currentSong.title : 'No track selected'}
          </p>
          <p className="text-[12px] text-text-muted truncate hover:underline cursor-pointer no-drag hover:text-text transition-colors">
            {currentSong ? currentSong.artist : 'Select a track to play'}
          </p>
        </div>

        {/* Add to Liked */}
        {currentSong && (
          <button className="text-text-muted hover:text-text transition-colors no-drag shrink-0 p-1">
            <PlusCircle className="w-4 h-4" />
          </button>
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
            onClick={playPrevious}
            title="Previous"
            className="text-text-muted hover:text-text transition-colors"
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayClick}
            title={isPlaying ? 'Pause' : 'Play'}
            className="h-10 w-10 rounded-full bg-text text-canvas flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-md"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={playNext}
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
        </div>

        {/* Progress bar */}
        <div className="w-full flex items-center gap-2 text-[11px] font-mono text-text-muted">
          <span className="w-10 text-right">{formatTime(displayTime)}</span>
          <div
            ref={progressRef}
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerCancel}
            className="flex-1 h-1.5 bg-border hover:h-2 rounded-full cursor-pointer group relative no-drag flex items-center transition-all touch-none"
          >
            <div
              className="absolute left-0 h-full bg-text group-hover:bg-primary-amber rounded-full transition-colors"
              style={{ width: `${progressPercent}%` }}
            />
            {/* Playhead thumb shown on hover */}
            <div
              className="absolute h-3 w-3 bg-text rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md -ml-1.5"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
          <span className="w-10 text-left">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Volume & Extra (Right) */}
      <div className="flex items-center justify-end gap-3 w-[30%] min-w-[200px] text-text-muted no-drag">
        {/* Lyrics */}
        {currentSong && isPlaying && (
          <button
            title="Lyrics"
            className={`hover:text-text transition-colors p-1 ${isLyricsActive ? 'text-primary-amber' : ''}`}
            onClick={toggleLyrics}
          >
            <Mic2 className="w-4 h-4" />
          </button>
        )}

        {/* Download sources */}
        <button
          title="Download sources"
          onClick={onOpenDownloadPanel}
          className="hover:text-text transition-colors p-1"
        >
          <ListVideo className="w-4 h-4" />
        </button>

        {/* Volume */}
        <div className="flex items-center gap-2 w-28">
          <button onClick={toggleMute} className="hover:text-text transition-colors p-1">
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div
            className="flex-1 h-1 bg-border hover:h-1.5 rounded-full cursor-pointer group relative flex items-center transition-all"
            onClick={handleVolumeClick}
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

        <button title="Full Screen" className="hover:text-text transition-colors ml-1 p-1">
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </footer>
  )
}
