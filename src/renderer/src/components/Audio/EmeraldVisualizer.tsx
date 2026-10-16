import { useEffect, useRef, useState, useCallback } from 'react'
import { audioDspEngine } from '../../lib/audioDspEngine'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useThemeStore } from '../../hooks/useThemeStore'
import { buildSpectrumDitherStrip, SPECTRUM_DITHER_TILE_SIZE } from '../../lib/spectrumDither'

export type VisualizerMode = 'circular' | 'spectrum'

interface EmeraldVisualizerProps {
  className?: string
  defaultMode?: VisualizerMode
  interactive?: boolean
  showModePill?: boolean
  themeColor?: 'emerald' | 'amber' | 'blue'
}

function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '')
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16)
    const g = parseInt(cleanHex[1] + cleanHex[1], 16)
    const b = parseInt(cleanHex[2] + cleanHex[2], 16)
    return [r, g, b]
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.slice(0, 2), 16)
    const g = parseInt(cleanHex.slice(2, 4), 16)
    const b = parseInt(cleanHex.slice(4, 6), 16)
    return [r, g, b]
  }
  return [16, 185, 129]
}

// ─── Spectrum Constants (from MUSIXQUARE) ─────────────────────────────
const MIN_FREQ = 20
const MAX_FREQ = 20000
const MIN_DB = -100
const MAX_DB = 0
const SLOPE_DB_PER_OCTAVE = 4.5
const SLOPE_REF_FREQ = 1000
const LOG_GAMMA = 1.0
const LOG_MIN_FREQ = Math.log10(MIN_FREQ)
const LOG_FREQ_RANGE = Math.log10(MAX_FREQ) - LOG_MIN_FREQ
const SPECTRUM_GRID_FREQS = [100, 1000, 10000] as const

// ─── Smoothing coefficients ───────────────────────────────────────────
const BASS_SMOOTH = 0.8
const HIGH_SMOOTH = 0.8
const VIZ_SETTLE_MS = 180

type SpectrumPoint = { x: number; y: number }

interface CircularFrame {
  bassPunch: number
  bassOpacity: number
  highPunch: number
}

interface SpectrumBinLayout {
  bufferLength: number
  sampleRate: number
  logicalW: number
  padX: number
  indices: number[]
  xValues: number[]
  slopeValues: number[]
  gridXValues: number[]
}

function freqToX(freq: number, w: number, padX: number): number {
  const norm = (Math.log10(freq) - LOG_MIN_FREQ) / LOG_FREQ_RANGE
  const compressed = Math.pow(Math.max(0, Math.min(1, norm)), LOG_GAMMA)
  return padX + compressed * (w - 2 * padX)
}

function dbToY(db: number, h: number, padY: number): number {
  const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db))
  const norm = (clamped - MIN_DB) / (MAX_DB - MIN_DB)
  return padY + (1 - norm) * (h - 2 * padY)
}

function slopeCompensation(freq: number): number {
  if (freq <= 0) return 0
  return SLOPE_DB_PER_OCTAVE * Math.log2(freq / SLOPE_REF_FREQ)
}

function createSpectrumBinLayout(
  bufferLength: number,
  sampleRate: number,
  logicalW: number,
  padX: number
): SpectrumBinLayout {
  const indices: number[] = []
  const xValues: number[] = []
  const slopeValues: number[] = []

  for (let i = 1; i < bufferLength; i += Math.max(1, Math.floor(i / 64))) {
    const freq = (i * sampleRate) / (bufferLength * 2)
    if (freq < MIN_FREQ) continue
    if (freq > MAX_FREQ) break
    indices.push(i)
    xValues.push(freqToX(freq, logicalW, padX))
    slopeValues.push(slopeCompensation(freq))
  }

  return {
    bufferLength,
    sampleRate,
    logicalW,
    padX,
    indices,
    xValues,
    slopeValues,
    gridXValues: SPECTRUM_GRID_FREQS.map((freq) => freqToX(freq, logicalW, padX))
  }
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - clamped, 3)
}

export default function EmeraldVisualizer({
  className = '',
  defaultMode = 'circular',
  interactive = true,
  showModePill = true,
  themeColor = 'emerald'
}: EmeraldVisualizerProps) {
  const [mode, setMode] = useState<VisualizerMode>(() => {
    try {
      const saved = localStorage.getItem('felo-viz-mode')
      return saved === 'spectrum' || saved === 'circular' ? saved : defaultMode
    } catch {
      return defaultMode
    }
  })

  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const lastCircularFrameRef = useRef<CircularFrame | null>(null)
  const lastSpectrumPointsRef = useRef<SpectrumPoint[] | null>(null)
  const settlingStartRef = useRef<number | null>(null)
  const ditherPatternRef = useRef<{ pattern: CanvasPattern; height: number } | null>(null)

  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)

  const rgbColor: [number, number, number] = accentEnabled
    ? hexToRgb(accentColor)
    : themeColor === 'amber'
      ? [245, 158, 11]
      : themeColor === 'blue'
        ? [59, 130, 246]
        : [16, 185, 129]

  const handleToggleMode = useCallback(() => {
    if (!interactive) return
    setMode((prev) => {
      const next = prev === 'circular' ? 'spectrum' : 'circular'
      try {
        localStorage.setItem('felo-viz-mode', next)
      } catch {}
      return next
    })
  }, [interactive])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (interactive && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        handleToggleMode()
      }
    },
    [interactive, handleToggleMode]
  )

  useEffect(() => {
    const analyser = audioDspEngine.getAnalyser()
    if (analyser) {
      analyser.smoothingTimeConstant = mode === 'spectrum' ? 0 : 0.3
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let isDestroyed = false
    let smoothedBass = 0
    let smoothedHigh = 0
    let warmupFrames = 2

    const padX = 6
    const padY = 8

    const render = () => {
      if (isDestroyed) return

      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
      const rect = canvas.getBoundingClientRect()
      const logicalW = Math.max(20, rect.width)
      const logicalH = Math.max(20, rect.height)
      const targetW = Math.round(logicalW * dpr)
      const targetH = Math.round(logicalH * dpr)

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
        ditherPatternRef.current = null
      }

      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, logicalW, logicalH)

      const analyser = audioDspEngine.getAnalyser()
      const sampleRate = audioDspEngine.getAudioContext()?.sampleRate || 48000
      const bufferLength = analyser ? analyser.frequencyBinCount : 1024
      const freqData = new Float32Array(bufferLength)

      if (analyser && isPlaying) {
        try {
          analyser.getFloatFrequencyData(freqData)
        } catch {
          const byteData = new Uint8Array(bufferLength)
          analyser.getByteFrequencyData(byteData)
          for (let i = 0; i < bufferLength; i++) {
            freqData[i] = (byteData[i] / 255) * 100 - 100
          }
        }
      } else {
        freqData.fill(-100)
      }

      // Handle Smooth Settling when Paused
      if (!isPlaying) {
        if (!settlingStartRef.current) settlingStartRef.current = performance.now()
        const elapsed = performance.now() - settlingStartRef.current
        const progress = Math.min(1, elapsed / VIZ_SETTLE_MS)
        const quiet = 1 - easeOutCubic(progress)

        if (mode === 'circular') {
          const last = lastCircularFrameRef.current || { bassPunch: 0, bassOpacity: 0.25, highPunch: 0 }
          const frame: CircularFrame = {
            bassPunch: last.bassPunch * quiet,
            bassOpacity: 0.25 + (last.bassOpacity - 0.25) * quiet,
            highPunch: last.highPunch * quiet
          }
          drawCircular(ctx, logicalW, logicalH, frame, rgbColor)
        } else {
          drawSpectrumGrid(ctx, logicalW, logicalH, padX, padY)
          const restY = dbToY(MIN_DB, logicalH, padY)
          if (lastSpectrumPointsRef.current && quiet > 0.01) {
            const points = lastSpectrumPointsRef.current.map((p) => ({
              x: p.x,
              y: p.y + (restY - p.y) * (1 - quiet)
            }))
            drawSpectrumCurve(ctx, points, logicalH, padX, padY, rgbColor, ditherPatternRef)
          } else {
            drawRestingLine(ctx, logicalW, logicalH, padX, padY, rgbColor)
          }
        }

        ctx.restore()
        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(render)
        }
        return
      }

      settlingStartRef.current = null

      if (mode === 'circular') {
        // ── 1. Circular Visualizer (Dual Concentric Power Circles from MUSIXQUARE) ──
        const bassCount = Math.min(12, bufferLength)
        let bassSum = 0
        for (let i = 0; i < bassCount; i++) {
          let val = (freqData[i] + 100) * 2.5
          if (!Number.isFinite(val) || val < 0) val = 0
          if (val > 255) val = 255
          bassSum += val
        }
        const bassAverage = bassSum / Math.max(1, bassCount)
        smoothedBass = smoothedBass * BASS_SMOOTH + bassAverage * (1 - BASS_SMOOTH)
        let bassPunch = Math.pow(smoothedBass / 255, 2.5)
        if (!Number.isFinite(bassPunch)) bassPunch = 0
        const bassPunchOpacity = Math.pow(smoothedBass / 255, 1.5)

        const highStart = Math.floor(bufferLength * 0.7)
        const highEnd = bufferLength
        let highSum = 0
        for (let i = highStart; i < highEnd; i++) {
          let val = (freqData[i] + 100) * 2.5
          if (!Number.isFinite(val) || val < 0) val = 0
          if (val > 255) val = 255
          highSum += val
        }
        const highCountVal = Math.max(1, highEnd - highStart)
        const highAverage = highSum / highCountVal
        smoothedHigh = smoothedHigh * HIGH_SMOOTH + highAverage * (1 - HIGH_SMOOTH)
        let highPunch = smoothedHigh / 255
        if (!Number.isFinite(highPunch)) highPunch = 0

        const bassOpacity = Math.min(0.75, 0.25 + bassPunchOpacity * 0.75)
        const frame: CircularFrame = { bassPunch, bassOpacity, highPunch }
        lastCircularFrameRef.current = frame
        drawCircular(ctx, logicalW, logicalH, frame, rgbColor)
      } else {
        // ── 2. Spectrum RTA Curve with Logarithmic Frequency Mapping ──
        drawSpectrumGrid(ctx, logicalW, logicalH, padX, padY)

        if (warmupFrames > 0) {
          warmupFrames--
          drawRestingLine(ctx, logicalW, logicalH, padX, padY, rgbColor)
          if (warmupFrames === 0 && analyser) {
            analyser.smoothingTimeConstant = 0.8
          }
          ctx.restore()
          animFrameRef.current = requestAnimationFrame(render)
          return
        }

        const binLayout = createSpectrumBinLayout(bufferLength, sampleRate, logicalW, padX)
        const points: SpectrumPoint[] = []

        for (let i = 0; i < binLayout.indices.length; i++) {
          const rawDb = freqData[binLayout.indices[i]] ?? -100
          const compensatedDb = rawDb + binLayout.slopeValues[i]
          points.push({
            x: binLayout.xValues[i],
            y: dbToY(compensatedDb, logicalH, padY)
          })
        }

        if (points.length >= 2) {
          lastSpectrumPointsRef.current = points
          drawSpectrumCurve(ctx, points, logicalH, padX, padY, rgbColor, ditherPatternRef)
        } else {
          drawRestingLine(ctx, logicalW, logicalH, padX, padY, rgbColor)
        }
      }

      ctx.restore()
      animFrameRef.current = requestAnimationFrame(render)
    }

    animFrameRef.current = requestAnimationFrame(render)

    return () => {
      isDestroyed = true
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [mode, isPlaying, rgbColor])

  return (
    <div
      onClick={handleToggleMode}
      onKeyDown={handleKeyDown}
      tabIndex={interactive ? 0 : -1}
      role={interactive ? 'button' : 'img'}
      aria-label={`Audio Visualizer: ${mode === 'circular' ? 'Circular Hologram' : 'Spectrum Curve'}`}
      className={`relative select-none overflow-hidden rounded-2xl bg-[#0e1013] border border-white/[0.08] flex items-center justify-center cursor-pointer group focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
      title={interactive ? `Visualizer Mode: ${mode === 'circular' ? 'Circular Pulse' : 'Spectrum Curve'} (Click to toggle)` : undefined}
    >
      <canvas ref={canvasRef} className="w-full h-full block pointer-events-none" />

      {/* Mode Indicator Pill */}
      {showModePill && (
        <div
          className={`absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/60 border border-white/10 backdrop-blur-md text-[10px] font-mono font-medium opacity-70 group-hover:opacity-100 transition-opacity ${
            accentEnabled
              ? 'text-primary'
              : themeColor === 'amber'
                ? 'text-amber-400'
                : themeColor === 'blue'
                  ? 'text-blue-400'
                  : 'text-emerald-400'
          }`}
        >
          {mode === 'circular' ? 'Circular' : 'Spectrum'}
        </div>
      )}
    </div>
  )
}

// ─── Drawing Functions ───────────────────────────────────────────────

function drawCircular(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: CircularFrame,
  rgb: [number, number, number]
): void {
  const minDim = Math.min(w, h)
  const scale = minDim / 240
  const centerX = w / 2
  const centerY = h / 2
  const maxRadius = Math.max(0, minDim / 2 - 2)

  // Outer ambient bass halo
  const bassRadius = Math.min(maxRadius, (55 + frame.bassPunch * 180) * scale)
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${frame.bassOpacity})`
  ctx.beginPath()
  ctx.arc(centerX, centerY, bassRadius, 0, Math.PI * 2)
  ctx.fill()

  // Inner solid treble/presence core
  const highRadius = Math.min(maxRadius, (40 + frame.highPunch * 110) * scale)
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.95)`
  ctx.beginPath()
  ctx.arc(centerX, centerY, highRadius, 0, Math.PI * 2)
  ctx.fill()
}

function drawSpectrumGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  padX: number,
  padY: number
): void {
  ctx.lineWidth = 1
  ctx.font = '9px monospace'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'

  const labels: Record<number, string> = { 100: '100Hz', 1000: '1kHz', 10000: '10kHz' }

  for (const freq of SPECTRUM_GRID_FREQS) {
    const x = freqToX(freq, w, padX)
    const grad = ctx.createLinearGradient(0, padY, 0, h - padY)
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.08)')
    grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.08)')
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.strokeStyle = grad
    ctx.beginPath()
    ctx.moveTo(x, padY)
    ctx.lineTo(x, h - padY)
    ctx.stroke()

    // Frequency markers
    if (labels[freq]) {
      ctx.fillText(labels[freq], x + 3, padY + 10)
    }
  }
}

function drawRestingLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  padX: number,
  padY: number,
  rgb: [number, number, number]
): void {
  const restY = dbToY(MIN_DB, h, padY)
  ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.35)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(padX, restY)
  ctx.lineTo(w - padX, restY)
  ctx.stroke()
}

function drawSpectrumCurve(
  ctx: CanvasRenderingContext2D,
  points: SpectrumPoint[],
  logicalH: number,
  padX: number,
  padY: number,
  rgb: [number, number, number],
  patternRef: React.MutableRefObject<{ pattern: CanvasPattern; height: number } | null>
): void {
  if (points.length < 2) return

  // 1. Build smooth fill path
  ctx.beginPath()
  ctx.moveTo(padX, logicalH - padY)
  ctx.lineTo(padX, points[0].y)

  for (let i = 0; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
  }

  const last = points[points.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.lineTo(last.x, logicalH - padY)
  ctx.closePath()

  // 2. Bayer Matrix Ordered Dithered Fill (prevents banding)
  const physicalH = ctx.canvas.height
  let pattern = patternRef.current?.height === physicalH ? patternRef.current.pattern : null

  if (!pattern && typeof document !== 'undefined') {
    try {
      const tile = document.createElement('canvas')
      tile.width = SPECTRUM_DITHER_TILE_SIZE
      tile.height = physicalH
      const tileCtx = tile.getContext('2d')
      if (tileCtx) {
        const imgData = tileCtx.createImageData(tile.width, tile.height)
        imgData.data.set(buildSpectrumDitherStrip(physicalH, logicalH, padY, 0.22, rgb))
        tileCtx.putImageData(imgData, 0, 0)
        pattern = ctx.createPattern(tile, 'repeat')
        if (pattern) {
          patternRef.current = { pattern, height: physicalH }
        }
      }
    } catch {}
  }

  if (pattern) {
    ctx.save()
    ctx.clip()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
  } else {
    const grad = ctx.createLinearGradient(0, padY, 0, logicalH - padY)
    grad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.25)`)
    grad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.0)`)
    ctx.fillStyle = grad
    ctx.fill()
  }

  // 3. Crisp Studio Foreground Stroke
  ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.95)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(padX, points[0].y)

  for (let i = 0; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
  }

  ctx.lineTo(last.x, last.y)
  ctx.stroke()
}
