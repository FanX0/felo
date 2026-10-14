import { useState, useEffect, useRef } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Laptop2,
  Smartphone,
  Search,
  Radio,
  Sliders,
  Download,
  Check,
  Moon,
  Mic2
} from 'lucide-react'
import {
  remoteClient,
  type RemotePlayerState
} from './remoteClient'

interface MobileNowPlayingProps {
  state: RemotePlayerState
  isConnected: boolean
  onOpenQueue: () => void
  onOpenSearch: () => void
  onOpenDevices: () => void
  onOpenLyrics: () => void
  onOpenSleepTimer: () => void
  sleepTimerBadge?: string | null
}

const triggerHaptic = (ms = 12) => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms)
    } catch {
      // ignore
    }
  }
}

export default function MobileNowPlaying({
  state,
  isConnected,
  onOpenQueue,
  onOpenSearch,
  onOpenDevices,
  onOpenLyrics,
  onOpenSleepTimer,
  sleepTimerBadge
}: MobileNowPlayingProps) {
  const song = state.song
  const isPlaying = state.isPlaying
  const duration = state.duration || 0
  const [localPos, setLocalPos] = useState(state.position)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubPreview, setScrubPreview] = useState(0)
  const [isVolumeOpen, setIsVolumeOpen] = useState(false)
  const [volume, setVolume] = useState(state.volumePercent ?? 100)
  const [isDownloaded, setIsDownloaded] = useState(false)

  // Touch Swipe on Album Artwork for Next/Prev Track
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchStartY, setTouchStartY] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  // Smooth local timer interpolation when playing so seek bar ticks smoothly every second
  useEffect(() => {
    setLocalPos(state.position)
  }, [state.position])

  useEffect(() => {
    if (state.volumePercent !== undefined) {
      setVolume(state.volumePercent)
    }
  }, [state.volumePercent])

  useEffect(() => {
    if (!isPlaying || isScrubbing) return
    const interval = setInterval(() => {
      setLocalPos((prev) => (duration > 0 && prev < duration ? prev + 1 : prev))
    }, 1000)
    return () => clearInterval(interval)
  }, [isPlaying, isScrubbing, duration])

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatRemainingTime = (current: number, total: number) => {
    if (!total || total <= 0) return '-0:00'
    const remaining = Math.max(0, total - current)
    return `-${formatTime(remaining)}`
  }

  const currentDisplayTime = isScrubbing ? scrubPreview : localPos
  const progressPercent = duration > 0 ? Math.min(100, (currentDisplayTime / duration) * 100) : 0

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setScrubPreview(val)
  }

  const handleScrubStart = () => {
    triggerHaptic(8)
    setIsScrubbing(true)
    setScrubPreview(localPos)
  }

  const handleScrubEnd = () => {
    triggerHaptic(14)
    setIsScrubbing(false)
    setLocalPos(scrubPreview)
    void remoteClient.seek(scrubPreview)
  }

  const handleTogglePlay = () => {
    triggerHaptic(15)
    void remoteClient.togglePlay()
  }

  const handleNext = () => {
    triggerHaptic(15)
    void remoteClient.next()
  }

  const handlePrevious = () => {
    triggerHaptic(15)
    void remoteClient.previous()
  }

  const handleToggleShuffle = () => {
    triggerHaptic(10)
    void remoteClient.setMode(!state.shuffle, undefined)
  }

  const handleToggleRepeat = () => {
    triggerHaptic(10)
    const nextRepeat =
      state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
    void remoteClient.setMode(undefined, nextRepeat)
  }

  const volumeTimerRef = useRef<any>(null)

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setVolume(val)
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current)
    volumeTimerRef.current = setTimeout(() => {
      void remoteClient.setVolume(val)
    }, 75)
  }

  const handleDownload = () => {
    if (!song?.id) return
    triggerHaptic(20)
    remoteClient.downloadSong(song.id)
    setIsDownloaded(true)
    setTimeout(() => setIsDownloaded(false), 2500)
  }

  // Swipe gesture handlers
  const onArtworkTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX)
    setTouchStartY(e.touches[0].clientY)
  }

  const onArtworkTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null) return
    const deltaX = e.touches[0].clientX - touchStartX
    const deltaY = e.touches[0].clientY - (touchStartY ?? 0)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      setDragOffset(deltaX)
    }
  }

  const onArtworkTouchEnd = () => {
    if (Math.abs(dragOffset) > 65) {
      if (dragOffset < 0) {
        // Swiped left -> Next
        handleNext()
      } else {
        // Swiped right -> Previous
        handlePrevious()
      }
    }
    setTouchStartX(null)
    setTouchStartY(null)
    setDragOffset(0)
  }

  const artworkSrc = song?.artworkUrl
    ? remoteClient.getFullArtworkUrl(song.artworkUrl)
    : ''

  const isMobileTarget = state.targetDevice === 'mobile'

  return (
    <div className="relative w-full h-full flex flex-col justify-between pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] px-[max(1.5rem,env(safe-area-inset-left))] bg-gradient-to-b from-zinc-900 via-[#121212] to-black text-white select-none overflow-hidden touch-manipulation">
      {/* Dynamic Ambient Background Blur */}
      {artworkSrc && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25 blur-3xl pointer-events-none scale-125 transform"
          style={{ backgroundImage: `url(${artworkSrc})` }}
        />
      )}

      {/* Top Header */}
      <header className="relative z-10 flex items-center justify-between pt-2 pb-4">
        <button
          type="button"
          onClick={() => {
            triggerHaptic(10)
            onOpenSearch()
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:bg-white/10 transition cursor-pointer"
          title="Search Library"
        >
          <Search className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            {isMobileTarget ? 'Streaming on Phone' : 'Playing on Desktop'}
          </span>
          <span className="text-xs font-semibold text-zinc-200 truncate max-w-[200px]">
            {song?.album || (isMobileTarget ? 'Mobile Audio' : 'Desktop Library')}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Sleep Timer Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10)
              onOpenSleepTimer()
            }}
            className={`h-9 px-2.5 rounded-full flex items-center gap-1.5 transition active:scale-95 cursor-pointer text-xs font-medium ${
              sleepTimerBadge
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                : 'text-zinc-400 hover:text-white'
            }`}
            title="Sleep Timer"
          >
            <Moon className="w-4 h-4" />
            {sleepTimerBadge && <span className="text-[11px] font-mono">{sleepTimerBadge}</span>}
          </button>

          {/* Device Switcher Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10)
              onOpenDevices()
            }}
            className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-300 hover:text-white active:bg-white/10 transition cursor-pointer"
            title="Device Output Switcher"
          >
            <Radio className={`w-5 h-5 ${isConnected ? 'text-white' : 'text-zinc-400'}`} />
          </button>
        </div>
      </header>

      {/* Album Artwork Card with Swipe Gestures */}
      <div className="relative z-10 flex-1 flex items-center justify-center my-2 max-h-[46vh]">
        <div
          onTouchStart={onArtworkTouchStart}
          onTouchMove={onArtworkTouchMove}
          onTouchEnd={onArtworkTouchEnd}
          className="relative aspect-square w-full max-w-[340px] max-h-[340px] rounded-2xl overflow-hidden shadow-2xl shadow-black/80 bg-zinc-800 border border-white/5 flex items-center justify-center touch-pan-y cursor-grab active:cursor-grabbing"
          style={{
            transform: `translateX(${dragOffset * 0.6}px) rotate(${dragOffset * 0.03}deg)`,
            transition: dragOffset === 0 ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'
          }}
        >
          {artworkSrc ? (
            <img
              src={artworkSrc}
              alt={song?.title || 'Album Artwork'}
              className="w-full h-full object-cover select-none pointer-events-none"
              onError={(e) => {
                ;(e.target as HTMLElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 text-zinc-500 gap-2 pointer-events-none">
              <Radio className="w-12 h-12 opacity-40" />
              <span className="text-xs font-medium">Felo Music</span>
            </div>
          )}
        </div>
      </div>

      {/* Track Metadata & Actions (Lyrics, Download, Volume) */}
      <div className="relative z-10 flex items-center justify-between pt-2 pb-1">
        <div className="flex-1 min-w-0 pr-3">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate leading-tight">
            {song?.title || (isConnected ? 'No song loaded' : 'Connecting to Felo...')}
          </h1>
          <p className="text-sm sm:text-base font-medium text-zinc-400 truncate mt-0.5">
            {song?.artist || (isConnected ? 'Select a song on desktop' : 'Check Wi-Fi connection')}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Synced Lyrics Toggle Button */}
          {song?.id && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10)
                onOpenLyrics()
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition active:scale-95 cursor-pointer"
              title="View Synced Lyrics"
            >
              <Mic2 className="w-5 h-5 text-zinc-300" />
            </button>
          )}

          {/* Download to phone button */}
          {song?.id && (
            <button
              type="button"
              onClick={handleDownload}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer ${
                isDownloaded ? 'text-white bg-white/10' : 'text-zinc-400 hover:text-white'
              }`}
              title="Download to phone storage"
            >
              {isDownloaded ? <Check className="w-5 h-5" /> : <Download className="w-5 h-5" />}
            </button>
          )}

          {/* Volume Control Button */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8)
              setIsVolumeOpen(!isVolumeOpen)
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer ${
              isVolumeOpen ? 'bg-white/20 text-white' : 'text-zinc-400 hover:text-white'
            }`}
            title="Volume Control"
          >
            <Sliders className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Inline Volume Slider Popup */}
      {isVolumeOpen && (
        <div className="relative z-10 bg-zinc-900/95 border border-white/10 rounded-xl p-3 my-2 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10)
              const nextVol = volume === 0 ? 80 : 0
              setVolume(nextVol)
              void remoteClient.setVolume(nextVol)
            }}
            className="text-zinc-400 hover:text-white cursor-pointer"
          >
            {volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={handleVolumeChange}
            className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white"
          />
          <span className="text-xs font-mono text-zinc-400 w-8 text-right">{volume}%</span>
        </div>
      )}

      {/* Progress Bar / Scrubber */}
      <div className="relative z-10 pt-2 pb-2">
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.5}
            value={currentDisplayTime}
            onChange={handleScrubChange}
            onPointerDown={handleScrubStart}
            onPointerUp={handleScrubEnd}
            disabled={!song || duration <= 0}
            className="w-full h-1.5 bg-zinc-700/80 rounded-lg appearance-none cursor-pointer accent-white hover:accent-white transition touch-none"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.85) ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%, rgba(255,255,255,0.2) 100%)`
            }}
          />
        </div>

        <div className="flex justify-between items-center text-[11px] font-mono text-zinc-400 mt-1.5 px-0.5">
          <span>{formatTime(currentDisplayTime)}</span>
          <span>{formatRemainingTime(currentDisplayTime, duration)}</span>
        </div>
      </div>

      {/* Primary Transport Controls */}
      <div className="relative z-10 flex items-center justify-between px-2 pt-1 pb-4">
        {/* Shuffle */}
        <button
          type="button"
          onClick={handleToggleShuffle}
          className={`relative p-2 transition active:scale-90 cursor-pointer ${
            state.shuffle ? 'text-[rgba(255,255,255,0.85)]' : 'text-zinc-400 hover:text-white'
          }`}
          title="Shuffle"
        >
          <Shuffle className="w-5 h-5" />
          {state.shuffle && (
            <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full bg-[rgba(255,255,255,0.85)]" />
          )}
        </button>

        {/* Previous */}
        <button
          type="button"
          onClick={handlePrevious}
          className="p-2 text-white hover:text-zinc-200 active:scale-90 transition cursor-pointer"
          title="Previous Track"
        >
          <SkipBack className="w-7 h-7 fill-current" />
        </button>

        {/* Big Circular Play / Pause Button */}
        <button
          type="button"
          onClick={handleTogglePlay}
          className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center shadow-xl shadow-white/10 hover:scale-105 active:scale-95 transition-transform cursor-pointer"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause className="w-7 h-7 fill-current text-black" />
          ) : (
            <Play className="w-7 h-7 fill-current text-black ml-1" />
          )}
        </button>

        {/* Next */}
        <button
          type="button"
          onClick={handleNext}
          className="p-2 text-white hover:text-zinc-200 active:scale-90 transition cursor-pointer"
          title="Next Track"
        >
          <SkipForward className="w-7 h-7 fill-current" />
        </button>

        {/* Repeat */}
        <button
          type="button"
          onClick={handleToggleRepeat}
          className={`relative p-2 transition active:scale-90 cursor-pointer ${
            state.repeat !== 'off' ? 'text-[rgba(255,255,255,0.85)]' : 'text-zinc-400 hover:text-white'
          }`}
          title={`Repeat: ${state.repeat}`}
        >
          {state.repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
          {state.repeat !== 'off' && (
            <span className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full bg-[rgba(255,255,255,0.85)]" />
          )}
        </button>
      </div>

      {/* Spotify Connect Device Indicator & Queue Action */}
      <footer className="relative z-10 flex items-center justify-between pt-1 pb-2 border-t border-white/5">
        <button
          type="button"
          onClick={() => {
            triggerHaptic(10)
            onOpenDevices()
          }}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-white transition active:scale-95 px-1 py-1 cursor-pointer"
        >
          {isMobileTarget ? (
            <Smartphone className="w-4 h-4 shrink-0" />
          ) : (
            <Laptop2 className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate max-w-[200px]">
            {isMobileTarget
              ? 'Listening on This Phone'
              : isConnected
                ? `Listening on ${state.deviceName || 'Felo Desktop'}`
                : 'Reconnecting...'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            triggerHaptic(10)
            onOpenQueue()
          }}
          className="p-2 text-zinc-400 hover:text-white transition active:scale-95 relative cursor-pointer"
          title="Open Queue"
        >
          <ListMusic className="w-5 h-5" />
          {(state.queueLength ?? 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-zinc-700 text-[10px] font-bold text-white flex items-center justify-center">
              {state.queueLength}
            </span>
          )}
        </button>
      </footer>
    </div>
  )
}
