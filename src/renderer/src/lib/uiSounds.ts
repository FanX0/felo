/**
 * Felo UI Sounds — Direct Port from MUSIXQUARE
 *
 * Code-generated pitchless micro-transient tactile sounds for UI feedback.
 * Intentionally bypasses the media-effects graph (no EQ or Reverb alteration).
 */

import { audioDspEngine } from './audioDspEngine'

const STORAGE_KEY = 'felo-ui-sounds-enabled'
const SESSION_SOUND_COOLDOWN_MS = 300
const ANNOUNCEMENT_LOW_FREQUENCY_HZ = 523.25
const ANNOUNCEMENT_HIGH_FREQUENCY_HZ = 659.25
const ATTENTION_OUTPUT_GAIN = 2.5

type OutputGraph = {
  context: AudioContext
  attentionInput: GainNode
}

type ToneOptions = {
  from: number
  to?: number
  delay?: number
  duration: number
  gain: number
  attack: number
  release: number
  pan?: number
}

let outputGraph: OutputGraph | null = null
let enabledCache: boolean | null = null
let preferenceRevision = 0
let lastSessionSoundAt = Number.NEGATIVE_INFINITY
let initialized = false
let removeDomListeners: (() => void) | null = null

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function isUiSoundsEnabled(): boolean {
  if (enabledCache !== null) return enabledCache
  try {
    const val = localStorage.getItem(STORAGE_KEY)
    enabledCache = val === null ? true : val === '1' // default ON
  } catch {
    enabledCache = true
  }
  return enabledCache
}

export function setUiSoundsEnabled(enabled: boolean): void {
  preferenceRevision += 1
  enabledCache = enabled
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
}

function canPlayUiSound(force = false): boolean {
  return (
    (force || isUiSoundsEnabled()) &&
    (typeof document === 'undefined' || document.visibilityState !== 'hidden')
  )
}

function ensureOutputGraph(context: AudioContext): OutputGraph {
  if (outputGraph?.context === context) return outputGraph

  const createCompressor = () => {
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 24
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.18
    return compressor
  }

  const attentionInput = context.createGain()
  const attentionCompressor = createCompressor()
  const attentionOutput = context.createGain()
  attentionInput.gain.value = 1
  attentionOutput.gain.value = ATTENTION_OUTPUT_GAIN
  attentionInput.connect(attentionCompressor)
  attentionCompressor.connect(attentionOutput)
  attentionOutput.connect(context.destination)

  outputGraph = { context, attentionInput }
  return outputGraph
}

function resumeFromGesture(): void {
  if (!canPlayUiSound()) return
  try {
    const context = audioDspEngine.getAudioContext()
    if (context.state !== 'running') void context.resume().catch(() => undefined)
  } catch {
    // Web Audio optional UI enhancement
  }
}

async function readyOutput(force = false): Promise<OutputGraph | null> {
  if (!canPlayUiSound(force)) return null
  try {
    const context = audioDspEngine.getAudioContext()
    if (context.state !== 'running') {
      await context.resume().catch(() => undefined)
    }
    if (context.state !== 'running' || !canPlayUiSound(force)) {
      return null
    }
    return ensureOutputGraph(context)
  } catch {
    return null
  }
}

function connectWithPan(
  context: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  pan = 0
): void {
  try {
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    source.connect(panner)
    panner.connect(destination)
  } catch {
    source.connect(destination)
  }
}

function scheduleTone(
  context: AudioContext,
  destination: AudioNode,
  baseTime: number,
  options: ToneOptions
): void {
  const start = baseTime + (options.delay ?? 0)
  const end = start + options.duration
  const oscillator = context.createOscillator()
  const gain = context.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(options.from, start)
  oscillator.frequency.exponentialRampToValueAtTime(options.to ?? options.from, end)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(options.gain, start + options.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, end + options.release)

  oscillator.connect(gain)
  connectWithPan(context, gain, destination, options.pan)
  oscillator.start(start)
  oscillator.stop(end + options.release + 0.01)
}

function scheduleMicroEcho(
  context: AudioContext,
  destination: AudioNode,
  time: number,
  frequency: number
): void {
  scheduleTone(context, destination, time, {
    from: frequency,
    duration: 0.18,
    gain: 0.064,
    attack: 0.003,
    release: 0.14,
    pan: -0.025
  })
  scheduleTone(context, destination, time, {
    from: frequency,
    delay: 0.13,
    duration: 0.22,
    gain: 0.026,
    attack: 0.003,
    release: 0.18,
    pan: 0.04
  })
}

/**
 * UI touch/click sound is disabled. Maintained as a no-op for backward compatibility.
 */
export function playUiTouchSound(_options: { force?: boolean } = {}): void {
  // Click sound permanently removed per user request
}

export function playAnnouncementSound(): void {
  readyOutput().then((output) => {
    if (!output) return
    const time = output.context.currentTime + 0.008
    scheduleTone(output.context, output.attentionInput, time, {
      from: ANNOUNCEMENT_LOW_FREQUENCY_HZ,
      duration: 0.16,
      gain: 0.055,
      attack: 0.004,
      release: 0.12,
      pan: -0.04
    })
    scheduleTone(output.context, output.attentionInput, time, {
      from: ANNOUNCEMENT_HIGH_FREQUENCY_HZ,
      delay: 0.095,
      duration: 0.23,
      gain: 0.068,
      attack: 0.004,
      release: 0.18,
      pan: 0.04
    })
  }).catch(() => undefined)
}

function playSessionSound(frequency: number): void {
  const now = nowMs()
  if (now - lastSessionSoundAt < SESSION_SOUND_COOLDOWN_MS) return
  lastSessionSoundAt = now
  readyOutput().then((output) => {
    if (!output) return
    scheduleMicroEcho(
      output.context,
      output.attentionInput,
      output.context.currentTime + 0.008,
      frequency
    )
  }).catch(() => undefined)
}

export function playParticipantJoinSound(): void {
  playSessionSound(ANNOUNCEMENT_HIGH_FREQUENCY_HZ)
}

export function playParticipantLeaveSound(): void {
  playSessionSound(ANNOUNCEMENT_LOW_FREQUENCY_HZ)
}

export function initUiSounds(): void {
  if (initialized) return
  initialized = true

  const handlePointerDown = (event: PointerEvent) => {
    if (event.isTrusted) resumeFromGesture()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.isTrusted && (event.key === 'Enter' || event.key === ' ')) resumeFromGesture()
  }

  document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true })
  document.addEventListener('keydown', handleKeyDown, { capture: true })
  removeDomListeners = () => {
    document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
    document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }
}

export function destroyUiSounds(): void {
  removeDomListeners?.()
  removeDomListeners = null
  initialized = false
  outputGraph = null
}
