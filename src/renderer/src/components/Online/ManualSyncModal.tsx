import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  X,
  SlidersHorizontal,
  Play,
  Pause,
  RotateCcw,
  Music,
  CheckCircle2,
  Sparkles,
  Radio,
  FastForward,
  Rewind,
  Headphones,
  Zap,
  Info
} from 'lucide-react'
import { useListeningStore, isSessionSyncing } from '../../hooks/useListeningStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'
import { fmtTime, getTrackDisplayTitle } from '../../lib/songUtils'

interface ManualSyncModalProps {
  isOpen?: boolean
  onClose?: () => void
}

export const ManualSyncModal: React.FC<ManualSyncModalProps> = ({
  isOpen: propsIsOpen,
  onClose: propsOnClose
}) => {
  // Listening Room Store
  const storeIsOpen = useListeningStore((state) => state.isManualSyncModalOpen)
  const setIsOpen = useListeningStore((state) => state.setIsManualSyncModalOpen)
  const manualSyncOffsetMs = useListeningStore((state) => state.manualSyncOffsetMs)
  const setManualSyncOffsetMs = useListeningStore((state) => state.setManualSyncOffsetMs)
  const adjustManualSyncOffsetMs = useListeningStore((state) => state.adjustManualSyncOffsetMs)
  const myRole = useListeningStore((state) => state.myRole)
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const isSyncing = isSessionSyncing()

  // Player Store (Dynamic Audio Player)
  const queue = usePlayerStore((state) => state.queue)
  const currentSongIndex = usePlayerStore((state) => state.currentSongIndex)
  const localSong = queue[currentSongIndex] || null
  const isPlaying = usePlayerStore((state) => state.isPlaying)
  const currentTime = usePlayerStore((state) => state.currentTime)
  const duration = usePlayerStore((state) => state.duration)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const seek = usePlayerStore((state) => state.seek)

  const isHost = myRole === 'host' || Boolean(hostRoom && !joinedRoom)
  const isVisible = propsIsOpen !== undefined ? propsIsOpen : storeIsOpen
  const [activeStep, setActiveStep] = useState<number | null>(null)
  const [recentlyNudged, setRecentlyNudged] = useState(false)
  const nudgeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Resolve active song from room or local player
  const activeSong = useMemo(() => {
    return joinedRoom?.song || hostRoom?.song || localSong || null
  }, [joinedRoom?.song, hostRoom?.song, localSong])

  const songTitle = useMemo(() => {
    if (!activeSong) return 'No Track Playing'
    return getTrackDisplayTitle(activeSong)
  }, [activeSong])

  const songArtist = useMemo(() => {
    if (!activeSong) return 'Play audio to preview calibration'
    return activeSong.artist || 'Unknown Artist'
  }, [activeSong])

  const artworkUrl = useMemo(() => {
    if (!activeSong) return null
    const rawArtwork = (activeSong as any).artworkUrl || (activeSong as any).artworkPath
    return toMediaUrl(rawArtwork)
  }, [activeSong])

  const effectiveDuration = (activeSong as any)?.duration || duration || 0
  const progressPercent = effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0

  const handleClose = useCallback(() => {
    if (propsOnClose) {
      propsOnClose()
    } else {
      setIsOpen(false)
    }
    setActiveStep(null)
  }, [propsOnClose, setIsOpen])

  const triggerNudgeFeedback = useCallback(() => {
    setRecentlyNudged(true)
    if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current)
    nudgeTimeoutRef.current = setTimeout(() => {
      setRecentlyNudged(false)
    }, 600)
  }, [])

  const handleStep = useCallback((deltaMs: number) => {
    if (isHost) return
    setActiveStep(deltaMs)
    adjustManualSyncOffsetMs(deltaMs)
    triggerNudgeFeedback()
  }, [isHost, adjustManualSyncOffsetMs, triggerNudgeFeedback])

  const handleSetDirect = useCallback((valueMs: number) => {
    if (isHost) return
    setManualSyncOffsetMs(valueMs)
    triggerNudgeFeedback()
  }, [isHost, setManualSyncOffsetMs, triggerNudgeFeedback])

  const handleReset = useCallback(() => {
    if (isHost) return
    setActiveStep(null)
    setManualSyncOffsetMs(0)
    triggerNudgeFeedback()
  }, [isHost, setManualSyncOffsetMs, triggerNudgeFeedback])

  // Quick 5s replay to test transient alignment
  const handleReplay5s = useCallback(() => {
    const target = Math.max(0, currentTime - 5)
    seek(target)
  }, [currentTime, seek])

  // Seek bar click inside dynamic player
  const handleSeekClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (effectiveDuration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(ratio * effectiveDuration)
  }, [effectiveDuration, seek])

  // Keyboard shortcut listener: Escape to close, Arrow keys to nudge (guests only), Space to toggle play
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInputFocused = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (!isHost && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const isRight = e.key === 'ArrowRight'
        let step = 1
        if (e.ctrlKey || e.metaKey) {
          step = 50
        } else if (e.shiftKey) {
          step = 10
        }
        handleStep(isRight ? step : -step)
      } else if (!isInputFocused && e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, isHost, handleClose, handleStep, togglePlay])

  useEffect(() => {
    return () => {
      if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current)
    }
  }, [])

  if (!isVisible) return null

  // Offset position calculation for the visual ruler (-500ms to +500ms => 0% to 100%)
  const clampedOffset = Math.max(-500, Math.min(500, manualSyncOffsetMs))
  const gaugePercentage = ((clampedOffset + 500) / 1000) * 100

  // Stepping button definitions
  const stepOptions = [
    { label: '-50', delta: -50, group: 'delay' },
    { label: '-10', delta: -10, group: 'delay' },
    { label: '-1', delta: -1, group: 'delay' },
    { label: '+1', delta: 1, group: 'advance' },
    { label: '+10', delta: 10, group: 'advance' },
    { label: '+50', delta: 50, group: 'advance' }
  ]

  // Common real-world device presets
  const presets = [
    { name: 'Wired / Direct', offset: 0, hint: '0 ms' },
    { name: 'Standard Bluetooth', offset: 40, hint: '+40 ms' },
    { name: 'Wireless Speaker', offset: 120, hint: '+120 ms' },
    { name: 'Buffer Delay', offset: -30, hint: '-30 ms' }
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Audio sync latency calibration"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-lg bg-surface border border-border rounded-2xl shadow-2xl p-5 sm:p-6 flex flex-col gap-4 text-text overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text tracking-tight">Audio Sync Calibration</h2>
                {isHost ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-300">
                    Host Source
                  </span>
                ) : joinedRoom ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-secondary-cyan/15 border border-secondary-cyan/30 text-secondary-cyan">
                    <Radio className="w-2.5 h-2.5 animate-pulse" />
                    <span>In Room</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/10 text-text-muted">
                    Local Output
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">
                {isHost
                  ? 'Host is the golden audio reference clock.'
                  : 'Fine-tune latency offset for seamless room & audio timing.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Mini Player (Live Audio Monitor) */}
        <div className="w-full rounded-xl bg-surface-elevated border border-border/80 p-3 flex flex-col gap-2.5 shadow-inner">
          <div className="flex items-center justify-between gap-3">
            {/* Artwork & Animated Playing Beacon */}
            <div className="relative w-11 h-11 rounded-lg bg-black/40 border border-border overflow-hidden shrink-0 flex items-center justify-center">
              {artworkUrl ? (
                <img src={artworkUrl} alt={songTitle} className="w-full h-full object-cover" />
              ) : (
                <Music className="w-5 h-5 text-text-muted" />
              )}
              {isPlaying && (
                <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse ring-2 ring-black" />
              )}
            </div>

            {/* Track Info & Equalizer Animation */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-text truncate max-w-[200px] sm:max-w-[240px]">
                  {songTitle}
                </span>
                {isPlaying && (
                  <div className="flex items-end gap-0.5 h-3 shrink-0 ml-1" title="Playback active">
                    <span className="w-0.5 rounded-full bg-primary animate-pulse h-3" />
                    <span className="w-0.5 rounded-full bg-primary animate-pulse h-2 delay-75" />
                    <span className="w-0.5 rounded-full bg-primary animate-pulse h-3.5 delay-150" />
                    <span className="w-0.5 rounded-full bg-primary animate-pulse h-1.5 delay-200" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] text-text-muted truncate max-w-[170px]">{songArtist}</span>
                {(isSyncing || recentlyNudged) && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-primary/20 text-primary border border-primary/30 animate-pulse">
                    <Zap className="w-2.5 h-2.5" />
                    Calibrating...
                  </span>
                )}
              </div>
            </div>

            {/* Transport Actions: Quick 5s Replay & Play/Pause */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleReplay5s}
                disabled={effectiveDuration <= 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-hover border border-border text-xs text-text-muted hover:text-text transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Replay previous 5 seconds to audit transient alignment"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="text-[10px] font-mono font-semibold">-5s</span>
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="w-8 h-8 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground flex items-center justify-center transition-all active:scale-95 cursor-pointer shadow-sm"
                title={isPlaying ? 'Pause playback' : 'Play audio'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
              </button>
            </div>
          </div>

          {/* Interactive Progress Scrubber */}
          <div className="w-full flex items-center gap-2 pt-0.5">
            <span className="text-[10px] font-mono text-text-muted w-7 text-right">
              {fmtTime(currentTime)}
            </span>
            <div
              className="flex-1 h-1.5 bg-surface rounded-full border border-border/50 overflow-hidden relative cursor-pointer group"
              onClick={handleSeekClick}
              title="Click to seek track"
            >
              <div
                className="h-full bg-primary rounded-full transition-all duration-150 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-text-muted w-7">
              {fmtTime(effectiveDuration)}
            </span>
          </div>
        </div>

        {/* Host Mode Notice */}
        {isHost && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2.5 leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-200">Host Source Active</p>
              <p className="text-[11px] text-amber-300/90 mt-0.5">
                You are streaming as the room host. Your audio clock is the master reference for all listeners.
                Manual sync is reserved for guest listeners to calibrate against your stream.
              </p>
            </div>
          </div>
        )}

        {/* Main Offset Display & Status Indicator */}
        <div className="flex flex-col items-center justify-center py-2 relative">
          <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1 flex items-center gap-1.5">
            <span>Latency Compensation</span>
            {recentlyNudged && (
              <span className="text-secondary-cyan animate-pulse flex items-center gap-0.5 text-[10px]">
                <Sparkles className="w-2.5 h-2.5" /> Updated
              </span>
            )}
          </div>

          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-5xl font-black font-mono tracking-tight transition-colors tabular-nums ${
                clampedOffset === 0
                  ? 'text-success'
                  : clampedOffset > 0
                  ? 'text-primary'
                  : 'text-warning'
              }`}
            >
              {clampedOffset > 0 ? `+${clampedOffset}` : clampedOffset}
            </span>
            <span className="text-base font-bold text-text-muted font-mono">ms</span>
          </div>
        </div>

        {/* Real-Time Preview: Drift Meter & Timeline Comparison Gauge */}
        <div className="w-full p-3.5 rounded-xl bg-surface-elevated/70 border border-border/80 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-[11px] font-medium text-text-muted">
            <span className="flex items-center gap-1 text-warning">
              <Rewind className="w-3 h-3" />
              <span>Delayed (-500ms)</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-success">
              <CheckCircle2 className="w-3 h-3" />
              <span>Host (0ms)</span>
            </span>
            <span className="flex items-center gap-1 text-primary">
              <span>Advanced (+500ms)</span>
              <FastForward className="w-3 h-3" />
            </span>
          </div>

          {/* Interactive Dual-Track Gauge */}
          <div className="relative w-full h-8 flex items-center px-2">
            {/* Background track rail */}
            <div className="w-full h-2 bg-surface rounded-full border border-border relative overflow-hidden">
              {/* Center benchmark zone */}
              <div className="absolute left-1/2 -translate-x-1/2 w-1.5 h-full bg-success/60 z-10" />

              {/* Offset fill bar from center (50%) to active point */}
              {clampedOffset > 0 && (
                <div
                  className="absolute top-0 bottom-0 bg-primary/40 transition-all duration-150"
                  style={{
                    left: '50%',
                    width: `${(clampedOffset / 500) * 50}%`
                  }}
                />
              )}
              {clampedOffset < 0 && (
                <div
                  className="absolute top-0 bottom-0 bg-warning/40 transition-all duration-150"
                  style={{
                    left: `${50 - (Math.abs(clampedOffset) / 500) * 50}%`,
                    width: `${(Math.abs(clampedOffset) / 500) * 50}%`
                  }}
                />
              )}
            </div>

            {/* Host Reference Fixed Marker (0 ms) */}
            <div
              className="absolute top-1 bottom-1 w-0.5 bg-success z-20 pointer-events-none"
              style={{ left: '50%' }}
              title="Host Reference Point (0 ms)"
            />

            {/* Local Playhead Movable Bead */}
            <div
              className={`absolute w-5 h-5 rounded-full border-2 shadow-lg flex items-center justify-center transition-all duration-150 z-30 ${
                isHost
                  ? 'border-zinc-600 bg-zinc-800'
                  : clampedOffset === 0
                  ? 'border-success bg-surface text-success shadow-success/30'
                  : clampedOffset > 0
                  ? 'border-primary bg-primary text-primary-foreground shadow-primary/30'
                  : 'border-warning bg-warning text-black shadow-warning/30'
              }`}
              style={{
                left: `calc(${gaugePercentage}% - 10px)`
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-current" />
            </div>
          </div>

          {/* Continuous Range Slider */}
          <div className="w-full px-1">
            <input
              type="range"
              min="-500"
              max="500"
              step="1"
              disabled={isHost}
              value={clampedOffset}
              onChange={(e) => handleSetDirect(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ accentColor: 'var(--app-accent, #ffffff)' }}
              title={isHost ? 'Sync is locked for host' : `Drag to adjust: ${clampedOffset} ms`}
            />
          </div>

          {/* Dynamic Impact Explanation (Tells user exactly what is changing) */}
          <div
            className={`p-2.5 rounded-lg border text-xs flex items-start gap-2.5 transition-all ${
              clampedOffset === 0
                ? 'bg-success/10 border-success/30 text-emerald-300'
                : clampedOffset > 0
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-warning/10 border-warning/30 text-amber-300'
            }`}
          >
            {clampedOffset === 0 ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success mt-0.5" />
            ) : clampedOffset > 0 ? (
              <FastForward className="w-4 h-4 shrink-0 text-primary mt-0.5" />
            ) : (
              <Rewind className="w-4 h-4 shrink-0 text-warning mt-0.5" />
            )}
            <div className="leading-snug">
              <span className="font-semibold block">
                {clampedOffset === 0
                  ? 'Locked to Host Clock (0 ms Offset)'
                  : clampedOffset > 0
                  ? `Playback Advanced by +${clampedOffset} ms`
                  : `Playback Delayed by ${Math.abs(clampedOffset)} ms`}
              </span>
              <span className="text-[11px] opacity-90 mt-0.5 block">
                {clampedOffset === 0
                  ? 'Your audio stream is playing exactly in-sync with the room host. Ideal for fast wired headphones or zero-latency setups.'
                  : clampedOffset > 0
                  ? 'Audio and lyrics will trigger slightly earlier. Ideal for Bluetooth headphones or wireless devices that introduce audio delay.'
                  : 'Audio and lyrics will trigger slightly later. Useful if your local stream is rushing ahead or cutting in early before others.'}
              </span>
            </div>
          </div>
        </div>

        {/* Nudge Step Buttons */}
        <div className="w-full flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted">
            <span>Quick Nudge Step</span>
            <span>Keyboard: ← / →</span>
          </div>

          <div className="grid grid-cols-6 gap-2">
            {stepOptions.map((step) => {
              const isSelected = activeStep === step.delta
              return (
                <button
                  key={step.delta}
                  type="button"
                  disabled={isHost}
                  onClick={() => handleStep(step.delta)}
                  className={`h-9 rounded-xl text-xs font-mono font-bold transition-all flex items-center justify-center ${
                    isHost
                      ? 'bg-surface-elevated text-zinc-600 opacity-40 cursor-not-allowed border border-border/50'
                      : isSelected
                      ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm cursor-pointer active:scale-95'
                      : 'bg-surface-elevated hover:bg-hover text-text border border-border hover:border-border/80 cursor-pointer active:scale-95'
                  }`}
                  title={isHost ? 'Sync is locked for host' : `Adjust offset by ${step.label} ms`}
                >
                  {step.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Common Audio Presets */}
        <div className="w-full flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0 mr-1 flex items-center gap-1">
            <Headphones className="w-3 h-3" />
            <span>Presets:</span>
          </span>
          {presets.map((preset) => {
            const isCurrent = clampedOffset === preset.offset
            return (
              <button
                key={preset.name}
                type="button"
                disabled={isHost}
                onClick={() => handleSetDirect(preset.offset)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all border shrink-0 ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground border-primary font-bold shadow-xs'
                    : 'bg-surface-elevated hover:bg-hover border-border text-text-muted hover:text-text cursor-pointer'
                }`}
                title={`Set offset to ${preset.hint}`}
              >
                {preset.name} <span className="font-mono opacity-75">({preset.hint})</span>
              </button>
            )
          })}
        </div>

        {/* Footer Actions: Reset & Done */}
        <div className="w-full flex items-center justify-between gap-3 pt-2 border-t border-border/70 mt-1">
          <button
            type="button"
            disabled={isHost || clampedOffset === 0}
            onClick={handleReset}
            className="flex-1 h-10 rounded-xl bg-surface-elevated hover:bg-hover border border-border text-text text-xs font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            title="Reset sync latency to 0 ms"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset (0 ms)</span>
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
            title="Save and apply calibration"
          >
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ManualSyncModal
