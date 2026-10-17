/**
 * Felo High-Fidelity Audio DSP Engine
 *
 * Implements native Web Audio API audio graph:
 * - Dynamic Spatial Speaker Role Routing:
 *   - Center Speaker (Stereo output, L→0, R→1)
 *   - Left Speaker (Left channel isolated, L→0 and L→1)
 *   - Right Speaker (Right channel isolated, R→0 and R→1)
 *   - Subwoofer (Summed (L+R)*0.5 + low-pass cutoff filter, 60–200 Hz)
 * - Synthetic Convolution Reverb with time-varying air absorption IR synthesis,
 *   equal-power cosine crossfading, damping filters, and debounced generation.
 * - 5-band Parametric Equalizer (60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz)
 * - Dual-Band Psychoacoustic Virtual Bass (Sub-bass cubic + Mid-bass quadratic,
 *   compressors, cascaded -24dB/oct filters, and limiter stage)
 * - Studio Harmonic Exciter (tanh saturator with 4x oversampling and cascaded -24dB/oct air-band post-filter)
 * - Mid/Side Stereo Widener with loudness compensation
 * - High-resolution Analyser for real-time acoustic reactive room diagram
 */

export type SpeakerRole = 'center' | 'left' | 'right' | 'subwoofer'
export type ChannelMode = 0 | -1 | 1 | 2 // 0=Center/Stereo, -1=Left, 1=Right, 2=Subwoofer

export const EQ_FREQUENCIES = [60, 230, 910, 3600, 14000] as const

// ─── Numeric Constants ───────────────────────────────────────────────
export const RAMP_TIME = 0.1
export const RAMP_TIME_FAST = 0.02
export const FREQ_FULL_RANGE = 20000
export const FULL_RANGE_NYQUIST_RATIO = 0.49

// Analyser
export const ANALYSER_FFT_SIZE = 4096
export const ANALYSER_SMOOTHING = 0.3

// Reverb Constants
export const REVERB_DEFAULT_DECAY = 1.0
export const REVERB_DEFAULT_PREDELAY = 0.02
export const REVERB_LOWCUT_BASE = 20
export const REVERB_LOWCUT_FACTOR = 50
export const REVERB_HIGHCUT_BASE = 20000
export const REVERB_HIGHCUT_FACTOR = 0.05
export const REVERB_IR_DAMPING_START_FREQ = 16000
export const REVERB_IR_DAMPING_END_FREQ = 2600
export const REVERB_IR_DAMPING_BLOCK_SIZE = 64
export const REVERB_IR_COALESCE_MS = 140

// Stereo Width Gain Compensation
export const STEREO_NARROW_BASE = 0.6
export const STEREO_NARROW_SCALE = 0.4
export const STEREO_WIDE_FLOOR = 0.5

// Virtual Bass Constants (Dual-Band Psychoacoustic Topology)
export const VB_CURVE_LENGTH = 8192
export const VB_SUB_LP_FREQ = 80
export const VB_SUB_HP_FREQ = 40
export const VB_SUB_COMP = { threshold: -24, ratio: 4, attack: 0.01, release: 0.1, knee: 10 } as const
export const VB_SUB_TRIM_GAIN = 0.8
export const VB_SUB_POST_HP_FREQ = 80
export const VB_SUB_POST_LP_FREQ = 320

export const VB_MID_LP_FREQ = 160
export const VB_MID_HP_FREQ = 80
export const VB_MID_COMP = { threshold: -20, ratio: 3, attack: 0.005, release: 0.08, knee: 8 } as const
export const VB_MID_TRIM_GAIN = 0.7
export const VB_MID_POST_HP_FREQ = 150
export const VB_MID_POST_LP_FREQ = 600
export const VB_MID_MIX_GAIN = 0.8
export const VB_LIMITER = { threshold: -3, ratio: 20, attack: 0.003, release: 0.01, knee: 0 } as const

// Harmonic Exciter Constants (Two-HPF Harmonic Isolation with 4x Oversampling)
export const EXCITER_HPF_FREQ = 4000
export const EXCITER_HPF_Q = 0.707
export const EXCITER_HPF_POST_FREQ = 16000
export const EXCITER_HPF_POST_STAGES = 2
export const EXCITER_HPF_POST_Q = 0.707
export const EXCITER_DRIVE = 4.5
export const EXCITER_MIX_GAIN = 0.5
export const EXCITER_CURVE_LENGTH = 4096

export interface ReverbSettings {
  enabled: boolean
  mix: number // 0 to 1
  decay: number // 0.1 to 10 seconds
  preDelay: number // 0 to 0.5 seconds
  lowCut: number // 0 to 100
  highCut: number // 0 to 100
}

export interface VirtualEffectSettings {
  bass: boolean
  treble: boolean
  surround: boolean
  bassStrength?: number // 0 to 1.0 (defaults to 0.6 if omitted when bass is true)
  stereoWidth?: number // 0 to 2.0 (defaults to 1.2 if omitted when surround is true, 1.0 when false)
}

// ─── MUSIXQUARE Clock Health Verification & Probe Types ─────────────
export type AudioContextHealthReason =
  | 'healthy'
  | 'not-created'
  | 'not-running'
  | 'clock-stalled'
  | 'inconclusive'
  | 'hidden'
  | 'superseded'

export interface AudioContextHealthResult {
  readonly healthy: boolean
  readonly reason: AudioContextHealthReason
  readonly state: string
  readonly clockAdvanceSeconds: number | null
}

const AUDIO_CLOCK_SAMPLE_MS = 180
const AUDIO_CLOCK_MIN_ADVANCE_SECONDS = 0.01
const AUDIO_RESUME_DEADLINE_MS = 500

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Web Audio Helpers ───────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function getFullRangeFrequency(sampleRate?: number): number {
  if (!Number.isFinite(sampleRate) || !sampleRate || sampleRate <= 0) return FREQ_FULL_RANGE
  return sampleRate * FULL_RANGE_NYQUIST_RATIO
}

function clampFilterFrequency(frequency: number, sampleRate?: number): number {
  const safeFrequency = Number.isFinite(frequency) ? Math.max(1, frequency) : FREQ_FULL_RANGE
  return Math.min(safeFrequency, getFullRangeFrequency(sampleRate))
}

function rampParam(param: AudioParam, targetValue: number, rampTime: number, ctx: AudioContext): void {
  const now = ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  if (rampTime <= 0) {
    param.value = targetValue
  } else {
    // Studio-grade click-free exponential transition (timeConstant = rampTime / 3.5)
    // Eliminates zipper noise and audible discontinuities across gain and filter adjustments
    const timeConstant = Math.max(0.005, rampTime / 3.5)
    param.setTargetAtTime(targetValue, now, timeConstant)
  }
}

function safeDisconnect(node: AudioNode | null): void {
  if (!node) return
  try {
    node.disconnect()
  } catch {
    // already disconnected
  }
}

interface CascadedFilter {
  input: BiquadFilterNode
  output: BiquadFilterNode
  setFrequency(value: number, rampTime?: number, ctx?: AudioContext): void
  disconnect(): void
}

function createCascadedFilter(
  ctx: AudioContext,
  type: BiquadFilterType,
  frequency: number,
  stages: number,
  q?: number
): CascadedFilter {
  const filters: BiquadFilterNode[] = []
  for (let i = 0; i < stages; i++) {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = frequency
    if (q !== undefined) f.Q.value = q
    filters.push(f)
    if (i > 0) filters[i - 1].connect(f)
  }

  return {
    input: filters[0],
    output: filters[filters.length - 1],
    setFrequency(value: number, rampTime?: number, audioCtx?: AudioContext): void {
      for (const f of filters) {
        if (rampTime && rampTime > 0 && audioCtx) {
          rampParam(f.frequency, value, rampTime, audioCtx)
        } else {
          f.frequency.value = value
        }
      }
    },
    disconnect(): void {
      for (const f of filters) safeDisconnect(f)
    }
  }
}

/**
 * Generate synthetic stereo impulse response with frequency-dependent air damping.
 */
function generateReverbIR(ctx: AudioContext, decay: number, preDelay: number): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const clampedDecay = Math.max(0.01, Math.min(30, decay))
  const clampedPreDelay = Math.max(0, Math.min(2, preDelay))

  const preDelaySamples = Math.floor(clampedPreDelay * sampleRate)
  const decaySamples = Math.max(1, Math.floor(clampedDecay * sampleRate))
  const totalSamples = preDelaySamples + decaySamples

  const buffer = ctx.createBuffer(2, totalSamples, sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)

  for (let i = 0; i < preDelaySamples; i++) {
    left[i] = 0
    right[i] = 0
  }

  const startCutoff = clampFilterFrequency(REVERB_IR_DAMPING_START_FREQ, sampleRate)
  const endCutoff = Math.min(startCutoff, clampFilterFrequency(REVERB_IR_DAMPING_END_FREQ, sampleRate))
  const cutoffRatio = endCutoff / startCutoff
  const rt60 = Math.log(1000)
  const decayCoeff = Math.exp(-rt60 / decaySamples)

  let envelopeL = 1
  let envelopeR = 1
  let filteredL = 0
  let filteredR = 0
  let filterAlpha = 1 - Math.exp((-2 * Math.PI * startCutoff) / sampleRate)

  for (let n = 0; n < decaySamples; n++) {
    const i = preDelaySamples + n
    if (n % REVERB_IR_DAMPING_BLOCK_SIZE === 0) {
      const progress = n / Math.max(1, decaySamples - 1)
      const cutoff = startCutoff * Math.pow(cutoffRatio, Math.pow(progress, 0.72))
      filterAlpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
    }

    filteredL += (Math.random() * 2 - 1 - filteredL) * filterAlpha
    filteredR += (Math.random() * 2 - 1 - filteredR) * filterAlpha

    left[i] = filteredL * envelopeL
    right[i] = filteredR * envelopeR
    envelopeL *= decayCoeff
    envelopeR *= decayCoeff
  }

  return buffer
}

function makeExciterCurve(drive = 4.5, length = 4096, bias = 0.0): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(length)
  const safeDrive = Number.isFinite(drive) ? Math.max(0.1, Math.min(12, drive)) : 1
  const safeBias = Number.isFinite(bias) ? Math.max(-0.95, Math.min(0.95, bias)) : 0
  const zero = Math.tanh(safeDrive * safeBias)
  let maxAbs = 0

  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1
    const y = Math.tanh(safeDrive * (x + safeBias)) - zero
    curve[i] = y
    maxAbs = Math.max(maxAbs, Math.abs(y))
  }

  if (maxAbs > 0) {
    for (let i = 0; i < length; i++) curve[i] /= maxAbs
  }

  return curve as Float32Array<ArrayBuffer>
}

// ─── Audio DSP Engine Class ──────────────────────────────────────────

class AudioDspEngine {
  private ctx: AudioContext | null = null
  private attachedElement: HTMLAudioElement | null = null
  private attachedElementA: HTMLAudioElement | null = null
  private attachedElementB: HTMLAudioElement | null = null
  private mediaSource: MediaElementAudioSourceNode | null = null
  private mediaSourceA: MediaElementAudioSourceNode | null = null
  private mediaSourceB: MediaElementAudioSourceNode | null = null
  private attachedStream: MediaStream | null = null
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null
  private stereoUpmix: GainNode | null = null
  private isInitialized = false

  // ── 0. Stable File Playback & Dual-Channel Routing (from MUSIXQUARE FilePlaybackRoute) ──
  private filePlaybackRoute: GainNode | null = null
  private channelAInput: GainNode | null = null
  private channelAGain: GainNode | null = null
  private channelBInput: GainNode | null = null
  private channelBGain: GainNode | null = null

  // Web Audio Buffer Source playback (MUSIXQUARE approach for local audio)
  public currentBufferNodeA: AudioBufferSourceNode | null = null
  public currentBufferNodeB: AudioBufferSourceNode | null = null
  public currentAudioBufferA: AudioBuffer | null = null
  public currentAudioBufferB: AudioBuffer | null = null
  public bufferStartAudioTimeA = 0
  public bufferStartAudioTimeB = 0
  public bufferStartOffsetA = 0
  public bufferStartOffsetB = 0
  public bufferPausedAtA = 0
  public bufferPausedAtB = 0
  public isBufferPlayingA = false
  public isBufferPlayingB = false
  public onBufferEndedA: (() => void) | null = null
  public onBufferEndedB: (() => void) | null = null

  // Channel & stereo processing
  private toneSplit: ChannelSplitterNode | null = null
  private toneMerge: ChannelMergerNode | null = null
  private gainL: GainNode | null = null
  private gainR: GainNode | null = null
  private globalLowPass: BiquadFilterNode | null = null

  // Equalizer
  private eqNodes: BiquadFilterNode[] = []

  // Preamp & Stereo Widener
  private preamp: GainNode | null = null
  private widenerInput: GainNode | null = null
  private widenerSplitter: ChannelSplitterNode | null = null
  private widenerMerger: ChannelMergerNode | null = null
  private widenerMidGain: GainNode | null = null
  private widenerSideGain: GainNode | null = null

  // Reverb
  private reverbConvolver: ConvolverNode | null = null
  private reverbLowCut: BiquadFilterNode | null = null
  private reverbHighCut: BiquadFilterNode | null = null
  private reverbDryGain: GainNode | null = null
  private reverbWetGain: GainNode | null = null

  // Reverb IR Caching & Debouncing
  private lastReverbDecay = REVERB_DEFAULT_DECAY
  private lastReverbPreDelay = REVERB_DEFAULT_PREDELAY
  private reverbIrTimer: ReturnType<typeof setTimeout> | null = null

  // Dual-band Virtual Bass
  private vbSubLP: CascadedFilter | null = null
  private vbSubHP: BiquadFilterNode | null = null
  private vbSubComp: DynamicsCompressorNode | null = null
  private vbSubTrim: GainNode | null = null
  private vbSubShaper: WaveShaperNode | null = null
  private vbSubPostHP: BiquadFilterNode | null = null
  private vbSubPostLP: CascadedFilter | null = null
  private vbSubMix: GainNode | null = null

  private vbMidLP: CascadedFilter | null = null
  private vbMidHP: BiquadFilterNode | null = null
  private vbMidComp: DynamicsCompressorNode | null = null
  private vbMidTrim: GainNode | null = null
  private vbMidShaper: WaveShaperNode | null = null
  private vbMidPostHP: BiquadFilterNode | null = null
  private vbMidPostLP: CascadedFilter | null = null
  private vbMidMix: GainNode | null = null

  private vbSum: GainNode | null = null
  private vbLimiter: DynamicsCompressorNode | null = null
  private vbGain: GainNode | null = null

  // Harmonic Exciter
  private exciterHPF: BiquadFilterNode | null = null
  private exciterShaper: WaveShaperNode | null = null
  private exciterPostHPF: CascadedFilter | null = null
  private exciterGain: GainNode | null = null

  // 7.1 Surround (from MUSIXQUARE FilePlaybackRoute + channel.ts)
  private isSurroundMode = false
  private surroundChannelIndex = -1
  private surroundSplitter: ChannelSplitterNode | null = null
  private surroundGain: GainNode | null = null

  // Master output & Analyser
  private masterGain: GainNode | null = null
  private analyser: AnalyserNode | null = null

  // Current State
  private currentMode: ChannelMode = 0
  private currentSubCutoff = 120
  private currentEq: number[] = [0, 0, 0, 0, 0]
  private currentStereoWidth = 1.0 // 1.0 = standard stereo, 1.5 = expanded
  private currentReverb: ReverbSettings = {
    enabled: false,
    mix: 0.4,
    decay: 1.0,
    preDelay: 0.02,
    lowCut: 0,
    highCut: 0
  }
  private currentVirtual: VirtualEffectSettings = {
    bass: false,
    treble: false,
    surround: false
  }
  private userPreampGain = 1.0

  public getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      this.ctx = new AudioCtx()
      this.bindContextInterruptionRecovery(this.ctx)
    }
    return this.ctx
  }

  private isAudioPlaying(): boolean {
    return (
      (this.attachedElementA !== null && !this.attachedElementA.paused) ||
      (this.attachedElementB !== null && !this.attachedElementB.paused) ||
      (this.attachedElement !== null && !this.attachedElement.paused) ||
      this.isBufferPlayingA ||
      this.isBufferPlayingB
    )
  }

  private bindContextInterruptionRecovery(ctx: AudioContext): void {
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'suspended' && this.isAudioPlaying()) {
        ctx.resume().catch((e) => console.warn('[AudioDspEngine] auto-resume on statechange error:', e))
      }
    })

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (
          document.visibilityState === 'visible' &&
          ctx.state === 'suspended' &&
          this.isAudioPlaying()
        ) {
          ctx.resume().catch((e) => console.warn('[AudioDspEngine] auto-resume on visibilitychange error:', e))
        } else if (
          document.visibilityState === 'visible' &&
          ctx.state === 'running' &&
          this.isAudioPlaying()
        ) {
          // MUSIXQUARE Evidence-based clock stall health probe
          void this.probeAudioContextHealth().then((health) => {
            if (health.reason === 'clock-stalled') {
              console.warn('[AudioDspEngine] WebKit AudioContext clock freeze detected; parking for trusted gesture')
              ctx.suspend().catch(() => {})
            }
          })
        }
      })
    }

    if (typeof window !== 'undefined') {
      const gestureUnlock = () => {
        if (ctx.state === 'suspended' && this.isAudioPlaying()) {
          ctx.resume().catch(() => {})
        }
      }
      window.addEventListener('pointerdown', gestureUnlock, { passive: true })
      window.addEventListener('keydown', gestureUnlock, { passive: true })
      window.addEventListener('pageshow', gestureUnlock, { passive: true })
      window.addEventListener('focus', gestureUnlock, { passive: true })
    }
  }

  /**
   * Samples AudioContext.currentTime over 180ms to verify that the native clock
   * actually advances (MUSIXQUARE clock stall verification).
   */
  private async sampleRunningClock(
    ctx: AudioContext,
    isCurrent: () => boolean
  ): Promise<AudioContextHealthResult> {
    let totalAdvance = 0
    for (let sample = 0; sample < 2; sample += 1) {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return {
          healthy: false,
          reason: 'hidden',
          state: String(ctx.state),
          clockAdvanceSeconds: null
        }
      }
      if (!isCurrent()) {
        return {
          healthy: false,
          reason: 'superseded',
          state: String(ctx.state),
          clockAdvanceSeconds: null
        }
      }

      const startedAt = ctx.currentTime
      const wallStartedAt = performance.now()
      await delay(AUDIO_CLOCK_SAMPLE_MS)
      if (!isCurrent()) {
        return {
          healthy: false,
          reason: 'superseded',
          state: String(ctx.state),
          clockAdvanceSeconds: null
        }
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return {
          healthy: false,
          reason: 'hidden',
          state: String(ctx.state),
          clockAdvanceSeconds: null
        }
      }
      if (String(ctx.state) !== 'running') {
        return {
          healthy: false,
          reason: 'not-running',
          state: String(ctx.state),
          clockAdvanceSeconds: null
        }
      }

      const wallElapsed = performance.now() - wallStartedAt
      const advance = Math.max(0, ctx.currentTime - startedAt)
      totalAdvance += advance
      if (wallElapsed < AUDIO_CLOCK_SAMPLE_MS * 0.75) {
        return {
          healthy: false,
          reason: 'inconclusive',
          state: String(ctx.state),
          clockAdvanceSeconds: totalAdvance
        }
      }
      if (advance >= AUDIO_CLOCK_MIN_ADVANCE_SECONDS) {
        return {
          healthy: true,
          reason: 'healthy',
          state: String(ctx.state),
          clockAdvanceSeconds: totalAdvance
        }
      }
    }

    return {
      healthy: false,
      reason: 'clock-stalled',
      state: String(ctx.state),
      clockAdvanceSeconds: totalAdvance
    }
  }

  /**
   * Health probe verifying that the Web Audio engine is healthy and advancing.
   */
  public async probeAudioContextHealth(
    options: {
      attemptResume?: boolean
      isCurrent?: () => boolean
    } = {}
  ): Promise<AudioContextHealthResult> {
    const ctx = this.ctx
    if (!ctx) {
      return {
        healthy: true,
        reason: 'not-created',
        state: 'not-created',
        clockAdvanceSeconds: null
      }
    }
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) {
      return {
        healthy: false,
        reason: 'superseded',
        state: String(ctx.state),
        clockAdvanceSeconds: null
      }
    }

    if (String(ctx.state) !== 'running' && options.attemptResume !== false) {
      try {
        await Promise.race([ctx.resume(), delay(AUDIO_RESUME_DEADLINE_MS)])
      } catch {}
    }

    if (String(ctx.state) !== 'running') {
      return {
        healthy: false,
        reason: 'not-running',
        state: String(ctx.state),
        clockAdvanceSeconds: null
      }
    }

    return this.sampleRunningClock(ctx, isCurrent)
  }

  public restartAudioContextFromGesture(): Promise<void> {
    const ctx = this.getAudioContext()
    try {
      return ctx.resume()
    } catch (err) {
      return Promise.reject(err)
    }
  }

  public async resume(): Promise<void> {
    const ctx = this.getAudioContext()
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch (err) {
        console.warn('[AudioDspEngine] resume failed:', err)
      }
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  /**
   * Returns stable input destination for Web Audio sources or audio elements (Channel A or B)
   */
  public getFilePlaybackDestination(channel: 'A' | 'B' = 'A'): GainNode {
    this.init()
    return channel === 'B' ? this.channelBInput! : this.channelAInput!
  }

  /**
   * Equal-Power Cosine/Sine Crossfade between Channel A and Channel B (MUSIXQUARE crossfade math)
   * ratio: 0.0 = 100% Channel A, 1.0 = 100% Channel B
   */
  public setCrossfadeMix(ratio: number, rampTime = RAMP_TIME): void {
    if (!this.ctx || !this.channelAGain || !this.channelBGain) return
    const clamped = Math.max(0, Math.min(1, ratio))
    const gainA = Math.cos((clamped * Math.PI) / 2)
    const gainB = Math.sin((clamped * Math.PI) / 2)
    rampParam(this.channelAGain.gain, gainA, rampTime, this.ctx)
    rampParam(this.channelBGain.gain, gainB, rampTime, this.ctx)
  }

  /**
   * Initialize audio graph and wire all effects
   */
  public init(): void {
    if (this.isInitialized) return
    const ctx = this.getAudioContext()

    // ── 0. Stable File Playback & Dual-Channel Crossfader Route (MUSIXQUARE FilePlaybackRoute) ──
    this.filePlaybackRoute = ctx.createGain()
    this.filePlaybackRoute.gain.value = 1.0
    this.filePlaybackRoute.channelCountMode = 'max'
    this.filePlaybackRoute.channelInterpretation = 'discrete'

    this.channelAInput = ctx.createGain()
    this.channelAGain = ctx.createGain()
    this.channelAGain.gain.value = 1.0 // 100% active channel A

    this.channelBInput = ctx.createGain()
    this.channelBGain = ctx.createGain()
    this.channelBGain.gain.value = 0.0 // 0% inactive channel B

    this.channelAInput.connect(this.channelAGain)
    this.channelAGain.connect(this.filePlaybackRoute)

    this.channelBInput.connect(this.channelBGain)
    this.channelBGain.connect(this.filePlaybackRoute)

    // ── 1. Mid/Side Stereo Widener ──
    this.widenerInput = ctx.createGain()
    this.filePlaybackRoute.connect(this.widenerInput)
    this.widenerSplitter = ctx.createChannelSplitter(2)
    this.widenerMerger = ctx.createChannelMerger(2)
    this.widenerMidGain = ctx.createGain()
    this.widenerSideGain = ctx.createGain()

    // Mid = (L+R)*0.5
    const lToMid = ctx.createGain()
    const rToMid = ctx.createGain()
    lToMid.gain.value = 0.5
    rToMid.gain.value = 0.5
    this.widenerInput.connect(this.widenerSplitter)
    this.widenerSplitter.connect(lToMid, 0)
    this.widenerSplitter.connect(rToMid, 1)

    const midSum = ctx.createGain()
    lToMid.connect(midSum)
    rToMid.connect(midSum)

    // Side = (L-R)*0.5
    const lToSide = ctx.createGain()
    const rToSide = ctx.createGain()
    lToSide.gain.value = 0.5
    rToSide.gain.value = -0.5
    this.widenerSplitter.connect(lToSide, 0)
    this.widenerSplitter.connect(rToSide, 1)

    const sideSum = ctx.createGain()
    lToSide.connect(sideSum)
    rToSide.connect(sideSum)

    midSum.connect(this.widenerMidGain)
    sideSum.connect(this.widenerSideGain)

    this.widenerMidGain.gain.value = 1.0
    this.widenerSideGain.gain.value = 1.0

    // Reconstruct: L = Mid + Side, R = Mid - Side
    const outL = ctx.createGain()
    const outR = ctx.createGain()
    const sideInvertR = ctx.createGain()
    sideInvertR.gain.value = -1

    this.widenerMidGain.connect(outL)
    this.widenerSideGain.connect(outL)
    this.widenerMidGain.connect(outR)
    this.widenerSideGain.connect(sideInvertR)
    sideInvertR.connect(outR)

    outL.connect(this.widenerMerger, 0, 0)
    outR.connect(this.widenerMerger, 0, 1)

    // Preamp for loudness compensation
    this.preamp = ctx.createGain()
    this.preamp.gain.value = 1.0
    this.widenerMerger.connect(this.preamp)

    // ── 2. Channel Splitting & Routing ──
    this.toneSplit = ctx.createChannelSplitter(2)
    this.toneMerge = ctx.createChannelMerger(2)
    this.gainL = ctx.createGain()
    this.gainR = ctx.createGain()

    this.preamp.connect(this.toneSplit)
    this.toneSplit.connect(this.gainL, 0)
    this.toneSplit.connect(this.gainR, 1)

    // Default Stereo: L->0, R->1
    this.gainL.connect(this.toneMerge, 0, 0)
    this.gainR.connect(this.toneMerge, 0, 1)

    // ── 3. Post-Processing: Global LowPass (for Subwoofer cutoff) ──
    this.globalLowPass = ctx.createBiquadFilter()
    this.globalLowPass.type = 'lowpass'
    this.globalLowPass.frequency.value = getFullRangeFrequency(ctx.sampleRate)
    this.toneMerge.connect(this.globalLowPass)

    // ── 4. 5-Band Parametric Equalizer ──
    this.eqNodes = EQ_FREQUENCIES.map((freq) => {
      const filter = ctx.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = freq
      filter.Q.value = 1.0
      filter.gain.value = 0
      return filter
    })

    let eqHead: AudioNode = this.globalLowPass
    for (const node of this.eqNodes) {
      eqHead.connect(node)
      eqHead = node
    }
    const eqOutput = eqHead

    // ── 5. Convolution Reverb with Equal-Power Crossfade ──
    this.reverbConvolver = ctx.createConvolver()
    this.reverbConvolver.buffer = generateReverbIR(ctx, REVERB_DEFAULT_DECAY, REVERB_DEFAULT_PREDELAY)

    this.reverbLowCut = ctx.createBiquadFilter()
    this.reverbLowCut.type = 'highpass'
    this.reverbLowCut.frequency.value = REVERB_LOWCUT_BASE

    this.reverbHighCut = ctx.createBiquadFilter()
    this.reverbHighCut.type = 'lowpass'
    this.reverbHighCut.frequency.value = getFullRangeFrequency(ctx.sampleRate)

    this.reverbDryGain = ctx.createGain()
    this.reverbWetGain = ctx.createGain()
    this.reverbDryGain.gain.value = 1.0
    this.reverbWetGain.gain.value = 0.0

    eqOutput.connect(this.reverbDryGain)
    eqOutput.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.reverbLowCut)
    this.reverbLowCut.connect(this.reverbHighCut)
    this.reverbHighCut.connect(this.reverbWetGain)

    // ── 6. Dual-Band Psychoacoustic Virtual Bass ──
    // Sub-bass wave-shaping curve: f(x) = x - x³/3
    const subCurve = new Float32Array(VB_CURVE_LENGTH)
    for (let i = 0; i < VB_CURVE_LENGTH; i++) {
      const x = (i / (VB_CURVE_LENGTH - 1)) * 2 - 1
      subCurve[i] = x - (x * x * x) / 3
    }

    // Mid-bass wave-shaping curve: f(x) = sign(x)*(2|x| - x²)
    const midCurve = new Float32Array(VB_CURVE_LENGTH)
    for (let i = 0; i < VB_CURVE_LENGTH; i++) {
      const x = (i / (VB_CURVE_LENGTH - 1)) * 2 - 1
      const ax = Math.abs(x)
      const shaped = ax <= 1.0 ? 2 * ax - ax * ax : 1.0
      midCurve[i] = x >= 0 ? shaped : -shaped
    }

    // Sub-bass path (40-80 Hz)
    this.vbSubLP = createCascadedFilter(ctx, 'lowpass', VB_SUB_LP_FREQ, 2)
    this.vbSubHP = ctx.createBiquadFilter()
    this.vbSubHP.type = 'highpass'
    this.vbSubHP.frequency.value = VB_SUB_HP_FREQ
    this.vbSubComp = ctx.createDynamicsCompressor()
    this.vbSubComp.threshold.value = VB_SUB_COMP.threshold
    this.vbSubComp.ratio.value = VB_SUB_COMP.ratio
    this.vbSubComp.attack.value = VB_SUB_COMP.attack
    this.vbSubComp.release.value = VB_SUB_COMP.release
    this.vbSubComp.knee.value = VB_SUB_COMP.knee
    this.vbSubTrim = ctx.createGain()
    this.vbSubTrim.gain.value = VB_SUB_TRIM_GAIN
    this.vbSubShaper = ctx.createWaveShaper()
    this.vbSubShaper.curve = subCurve as any
    this.vbSubPostHP = ctx.createBiquadFilter()
    this.vbSubPostHP.type = 'highpass'
    this.vbSubPostHP.frequency.value = VB_SUB_POST_HP_FREQ
    this.vbSubPostLP = createCascadedFilter(ctx, 'lowpass', VB_SUB_POST_LP_FREQ, 2)
    this.vbSubMix = ctx.createGain()

    eqOutput.connect(this.vbSubLP.input)
    this.vbSubLP.output.connect(this.vbSubHP)
    this.vbSubHP.connect(this.vbSubComp)
    this.vbSubComp.connect(this.vbSubTrim)
    this.vbSubTrim.connect(this.vbSubShaper)
    this.vbSubShaper.connect(this.vbSubPostHP)
    this.vbSubPostHP.connect(this.vbSubPostLP.input)
    this.vbSubPostLP.output.connect(this.vbSubMix)

    // Mid-bass path (80-160 Hz)
    this.vbMidLP = createCascadedFilter(ctx, 'lowpass', VB_MID_LP_FREQ, 2)
    this.vbMidHP = ctx.createBiquadFilter()
    this.vbMidHP.type = 'highpass'
    this.vbMidHP.frequency.value = VB_MID_HP_FREQ
    this.vbMidComp = ctx.createDynamicsCompressor()
    this.vbMidComp.threshold.value = VB_MID_COMP.threshold
    this.vbMidComp.ratio.value = VB_MID_COMP.ratio
    this.vbMidComp.attack.value = VB_MID_COMP.attack
    this.vbMidComp.release.value = VB_MID_COMP.release
    this.vbMidComp.knee.value = VB_MID_COMP.knee
    this.vbMidTrim = ctx.createGain()
    this.vbMidTrim.gain.value = VB_MID_TRIM_GAIN
    this.vbMidShaper = ctx.createWaveShaper()
    this.vbMidShaper.curve = midCurve as any
    this.vbMidPostHP = ctx.createBiquadFilter()
    this.vbMidPostHP.type = 'highpass'
    this.vbMidPostHP.frequency.value = VB_MID_POST_HP_FREQ
    this.vbMidPostLP = createCascadedFilter(ctx, 'lowpass', VB_MID_POST_LP_FREQ, 2)
    this.vbMidMix = ctx.createGain()
    this.vbMidMix.gain.value = VB_MID_MIX_GAIN

    eqOutput.connect(this.vbMidLP.input)
    this.vbMidLP.output.connect(this.vbMidHP)
    this.vbMidHP.connect(this.vbMidComp)
    this.vbMidComp.connect(this.vbMidTrim)
    this.vbMidTrim.connect(this.vbMidShaper)
    this.vbMidShaper.connect(this.vbMidPostHP)
    this.vbMidPostHP.connect(this.vbMidPostLP.input)
    this.vbMidPostLP.output.connect(this.vbMidMix)

    // Virtual Bass Sum & Limiter
    this.vbSum = ctx.createGain()
    this.vbLimiter = ctx.createDynamicsCompressor()
    this.vbLimiter.threshold.value = VB_LIMITER.threshold
    this.vbLimiter.ratio.value = VB_LIMITER.ratio
    this.vbLimiter.attack.value = VB_LIMITER.attack
    this.vbLimiter.release.value = VB_LIMITER.release
    this.vbLimiter.knee.value = VB_LIMITER.knee
    this.vbGain = ctx.createGain()
    this.vbGain.gain.value = 0 // Initially disabled

    this.vbSubMix.connect(this.vbSum)
    this.vbMidMix.connect(this.vbSum)
    this.vbSum.connect(this.vbLimiter)
    this.vbLimiter.connect(this.vbGain)

    // ── 7. Harmonic Exciter (with 4x oversampling & cascaded -24dB post-HPF) ──
    this.exciterHPF = ctx.createBiquadFilter()
    this.exciterHPF.type = 'highpass'
    this.exciterHPF.frequency.value = EXCITER_HPF_FREQ
    this.exciterHPF.Q.value = EXCITER_HPF_Q

    this.exciterShaper = ctx.createWaveShaper()
    this.exciterShaper.curve = makeExciterCurve(EXCITER_DRIVE, EXCITER_CURVE_LENGTH) as any
    this.exciterShaper.oversample = '4x' // Anti-aliasing

    this.exciterPostHPF = createCascadedFilter(
      ctx,
      'highpass',
      EXCITER_HPF_POST_FREQ,
      EXCITER_HPF_POST_STAGES,
      EXCITER_HPF_POST_Q
    )
    this.exciterGain = ctx.createGain()
    this.exciterGain.gain.value = 0 // Initially disabled

    eqOutput.connect(this.exciterHPF)
    this.exciterHPF.connect(this.exciterShaper)
    this.exciterShaper.connect(this.exciterPostHPF.input)
    this.exciterPostHPF.output.connect(this.exciterGain)

    // ── 8. Master Output & Analyser Stage ──
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = 1.0

    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = ANALYSER_FFT_SIZE
    this.analyser.smoothingTimeConstant = ANALYSER_SMOOTHING

    this.reverbDryGain.connect(this.masterGain)
    this.reverbWetGain.connect(this.masterGain)
    this.vbGain.connect(this.masterGain)
    this.exciterGain.connect(this.masterGain)

    this.masterGain.connect(this.analyser)
    this.masterGain.connect(ctx.destination)

    this.isInitialized = true
    this.applyAllSettings()
  }

  /**
   * Complete graph cleanup, disconnecting and dereferencing all nodes (matching MUSIXQUARE _cleanupAllNodes)
   */
  public cleanup(): void {
    this.detachAudioElement()
    this.detachMediaStream()

    safeDisconnect(this.channelAInput)
    safeDisconnect(this.channelAGain)
    safeDisconnect(this.channelBInput)
    safeDisconnect(this.channelBGain)
    safeDisconnect(this.filePlaybackRoute)
    safeDisconnect(this.widenerInput)
    safeDisconnect(this.widenerSplitter)
    safeDisconnect(this.widenerMerger)
    safeDisconnect(this.widenerMidGain)
    safeDisconnect(this.widenerSideGain)
    safeDisconnect(this.preamp)
    safeDisconnect(this.toneSplit)
    safeDisconnect(this.toneMerge)
    safeDisconnect(this.gainL)
    safeDisconnect(this.gainR)
    safeDisconnect(this.globalLowPass)
    this.eqNodes.forEach((node) => safeDisconnect(node))
    this.eqNodes = []
    safeDisconnect(this.reverbConvolver)
    safeDisconnect(this.reverbLowCut)
    safeDisconnect(this.reverbHighCut)
    safeDisconnect(this.reverbDryGain)
    safeDisconnect(this.reverbWetGain)

    this.vbSubLP?.disconnect()
    safeDisconnect(this.vbSubHP)
    safeDisconnect(this.vbSubComp)
    safeDisconnect(this.vbSubTrim)
    safeDisconnect(this.vbSubShaper)
    safeDisconnect(this.vbSubPostHP)
    this.vbSubPostLP?.disconnect()
    safeDisconnect(this.vbSubMix)

    this.vbMidLP?.disconnect()
    safeDisconnect(this.vbMidHP)
    safeDisconnect(this.vbMidComp)
    safeDisconnect(this.vbMidTrim)
    safeDisconnect(this.vbMidShaper)
    safeDisconnect(this.vbMidPostHP)
    this.vbMidPostLP?.disconnect()
    safeDisconnect(this.vbMidMix)

    safeDisconnect(this.vbSum)
    safeDisconnect(this.vbLimiter)
    safeDisconnect(this.vbGain)

    safeDisconnect(this.exciterHPF)
    safeDisconnect(this.exciterShaper)
    this.exciterPostHPF?.disconnect()
    safeDisconnect(this.exciterGain)

    safeDisconnect(this.surroundSplitter)
    safeDisconnect(this.surroundGain)
    safeDisconnect(this.masterGain)
    safeDisconnect(this.analyser)

    this.isDestinationMuted = false
    this.isInitialized = false
  }

  /**
   * Connect an HTMLAudioElement to the DSP graph (Channel A or B)
   */
  public attachAudioElement(el: HTMLAudioElement, channel: 'A' | 'B' = 'A'): void {
    if (channel === 'A') {
      if (this.attachedElementA === el && this.mediaSourceA) return
      this.attachedElementA = el
      this.attachedElement = el
    } else {
      if (this.attachedElementB === el && this.mediaSourceB) return
      this.attachedElementB = el
    }

    try {
      this.init()
      this.setDestinationMuted(false)
      const ctx = this.getAudioContext()
      const destination = this.getFilePlaybackDestination(channel)

      // Avoid creating multiple MediaElementSourceNodes for the same HTMLAudioElement
      let mediaSource = (el as any).__feloMediaSource as MediaElementAudioSourceNode | undefined
      if (!mediaSource) {
        mediaSource = ctx.createMediaElementSource(el)
        ;(el as any).__feloMediaSource = mediaSource
      }
      try {
        mediaSource.disconnect()
      } catch {}
      mediaSource.connect(destination)
      if (channel === 'A') {
        this.mediaSourceA = mediaSource
        this.mediaSource = mediaSource
      } else {
        this.mediaSourceB = mediaSource
      }
      console.log(`[AudioDspEngine] Connected HTMLAudioElement to DSP Channel ${channel}`)
    } catch (err) {
      console.warn(`[AudioDspEngine] attachAudioElement error on Channel ${channel}:`, err)
    }
  }

  public detachAudioElement(): void {
    if (this.mediaSourceA) {
      safeDisconnect(this.mediaSourceA)
      this.mediaSourceA = null
    }
    if (this.mediaSourceB) {
      safeDisconnect(this.mediaSourceB)
      this.mediaSourceB = null
    }
    this.mediaSource = null
    this.attachedElementA = null
    this.attachedElementB = null
    this.attachedElement = null
  }

  // ─── MUSIXQUARE Web Audio Buffer Source Architecture ──────────────

  /**
   * Decodes raw ArrayBuffer into an AudioBuffer using the AudioContext decoder.
   */
  public async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    this.init()
    const ctx = this.getAudioContext()
    return await ctx.decodeAudioData(arrayBuffer)
  }

  /**
   * Plays an AudioBuffer through the active DSP channel (A or B) using a native
   * AudioBufferSourceNode connected to FilePlaybackRoute.
   */
  public playBuffer(
    audioBuffer: AudioBuffer,
    offset = 0,
    onEnded?: () => void,
    channel: 'A' | 'B' = 'A'
  ): void {
    this.init()
    const ctx = this.getAudioContext()
    this.stopBuffer(channel)

    const destination = this.getFilePlaybackDestination(channel)
    const sourceNode = ctx.createBufferSource()
    sourceNode.buffer = audioBuffer
    sourceNode.connect(destination)

    const safeOffset = Math.max(0, Math.min(offset, audioBuffer.duration))
    const now = ctx.currentTime

    if (channel === 'A') {
      this.currentAudioBufferA = audioBuffer
      this.currentBufferNodeA = sourceNode
      this.bufferStartAudioTimeA = now
      this.bufferStartOffsetA = safeOffset
      this.isBufferPlayingA = true
      this.onBufferEndedA = onEnded || null

      sourceNode.onended = () => {
        if (this.currentBufferNodeA === sourceNode) {
          this.isBufferPlayingA = false
          this.currentBufferNodeA = null
          if (this.onBufferEndedA) {
            const cb = this.onBufferEndedA
            this.onBufferEndedA = null
            cb()
          }
        }
      }
    } else {
      this.currentAudioBufferB = audioBuffer
      this.currentBufferNodeB = sourceNode
      this.bufferStartAudioTimeB = now
      this.bufferStartOffsetB = safeOffset
      this.isBufferPlayingB = true
      this.onBufferEndedB = onEnded || null

      sourceNode.onended = () => {
        if (this.currentBufferNodeB === sourceNode) {
          this.isBufferPlayingB = false
          this.currentBufferNodeB = null
          if (this.onBufferEndedB) {
            const cb = this.onBufferEndedB
            this.onBufferEndedB = null
            cb()
          }
        }
      }
    }

    sourceNode.start(0, safeOffset)
    console.log(
      `[AudioDspEngine] Started AudioBuffer playback on Channel ${channel} from offset ${safeOffset.toFixed(2)}s`
    )
  }

  /**
   * Pauses AudioBuffer playback on the specified channel, capturing exact offset.
   */
  public pauseBuffer(channel: 'A' | 'B' = 'A'): number {
    const pos = this.getBufferPosition(channel)
    if (channel === 'A') {
      this.bufferPausedAtA = pos
      this.isBufferPlayingA = false
      if (this.currentBufferNodeA) {
        this.currentBufferNodeA.onended = null
        try {
          this.currentBufferNodeA.stop()
        } catch {}
        safeDisconnect(this.currentBufferNodeA)
        this.currentBufferNodeA = null
      }
    } else {
      this.bufferPausedAtB = pos
      this.isBufferPlayingB = false
      if (this.currentBufferNodeB) {
        this.currentBufferNodeB.onended = null
        try {
          this.currentBufferNodeB.stop()
        } catch {}
        safeDisconnect(this.currentBufferNodeB)
        this.currentBufferNodeB = null
      }
    }
    return pos
  }

  /**
   * Seeks AudioBuffer playback to the specified offset in seconds.
   */
  public seekBuffer(offset: number, channel: 'A' | 'B' = 'A'): void {
    const buffer = channel === 'A' ? this.currentAudioBufferA : this.currentAudioBufferB
    const isPlaying = channel === 'A' ? this.isBufferPlayingA : this.isBufferPlayingB
    const onEnded = channel === 'A' ? this.onBufferEndedA : this.onBufferEndedB

    if (!buffer) return
    const safeOffset = Math.max(0, Math.min(offset, buffer.duration))

    if (isPlaying) {
      this.playBuffer(buffer, safeOffset, onEnded || undefined, channel)
    } else {
      if (channel === 'A') {
        this.bufferPausedAtA = safeOffset
      } else {
        this.bufferPausedAtB = safeOffset
      }
    }
  }

  /**
   * Stops and releases buffer playback on specified channel or all channels.
   */
  public stopBuffer(channel?: 'A' | 'B'): void {
    const stopChan = (ch: 'A' | 'B') => {
      if (ch === 'A') {
        this.isBufferPlayingA = false
        this.onBufferEndedA = null
        if (this.currentBufferNodeA) {
          this.currentBufferNodeA.onended = null
          try {
            this.currentBufferNodeA.stop()
          } catch {}
          safeDisconnect(this.currentBufferNodeA)
          this.currentBufferNodeA = null
        }
      } else {
        this.isBufferPlayingB = false
        this.onBufferEndedB = null
        if (this.currentBufferNodeB) {
          this.currentBufferNodeB.onended = null
          try {
            this.currentBufferNodeB.stop()
          } catch {}
          safeDisconnect(this.currentBufferNodeB)
          this.currentBufferNodeB = null
        }
      }
    }

    if (channel) {
      stopChan(channel)
    } else {
      stopChan('A')
      stopChan('B')
    }
  }

  /**
   * Completely clears and releases buffer playback and audio data on specified channel or all channels.
   */
  public clearBuffer(channel?: 'A' | 'B'): void {
    this.stopBuffer(channel)
    if (!channel || channel === 'A') {
      this.currentAudioBufferA = null
      this.bufferPausedAtA = 0
      this.bufferStartOffsetA = 0
    }
    if (!channel || channel === 'B') {
      this.currentAudioBufferB = null
      this.bufferPausedAtB = 0
      this.bufferStartOffsetB = 0
    }
  }

  /**
   * Returns current playback offset in seconds for the given channel.
   */
  public getBufferPosition(channel: 'A' | 'B' = 'A'): number {
    const isPlaying = channel === 'A' ? this.isBufferPlayingA : this.isBufferPlayingB
    const buffer = channel === 'A' ? this.currentAudioBufferA : this.currentAudioBufferB
    if (!buffer) return 0

    if (!isPlaying) {
      return channel === 'A' ? this.bufferPausedAtA : this.bufferPausedAtB
    }

    if (!this.ctx) return 0
    const startTime = channel === 'A' ? this.bufferStartAudioTimeA : this.bufferStartAudioTimeB
    const startOffset = channel === 'A' ? this.bufferStartOffsetA : this.bufferStartOffsetB
    const elapsed = this.ctx.currentTime - startTime
    return Math.max(0, Math.min(startOffset + elapsed, buffer.duration))
  }

  public isBufferPlaying(channel: 'A' | 'B' = 'A'): boolean {
    return channel === 'A' ? this.isBufferPlayingA : this.isBufferPlayingB
  }

  public isBufferActive(channel: 'A' | 'B' = 'A'): boolean {
    return channel === 'A' ? Boolean(this.currentAudioBufferA) : Boolean(this.currentAudioBufferB)
  }

  public getCurrentAudioBuffer(channel: 'A' | 'B' = 'A'): AudioBuffer | null {
    return channel === 'A' ? this.currentAudioBufferA : this.currentAudioBufferB
  }

  /**
   * Connect a MediaStream (e.g. WebRTC remote stream or local captured desktop audio)
   * directly to the full Web Audio DSP graph through FilePlaybackRoute.
   */
  public attachMediaStream(
    stream: MediaStream,
    initialVolume = 1.0,
    unmuteDestination = true,
    forceReattach = false
  ): void {
    if (!forceReattach && this.attachedStream === stream && this.mediaStreamSource) return

    try {
      this.init()
      const ctx = this.getAudioContext()
      this.detachMediaStream()

      this.mediaStreamSource = ctx.createMediaStreamSource(stream)
      this.stereoUpmix = ctx.createGain()
      this.stereoUpmix.gain.value = clamp(initialVolume, 0, 1)
      this.stereoUpmix.channelCount = 2
      this.stereoUpmix.channelCountMode = 'explicit'
      this.stereoUpmix.channelInterpretation = 'speakers'
      this.mediaStreamSource.connect(this.stereoUpmix)
      const destination = this.widenerInput ?? this.filePlaybackRoute
      if (destination) {
        this.stereoUpmix.connect(destination)
      }
      this.attachedStream = stream
      if (unmuteDestination) {
        this.setDestinationMuted(false)
      }
      void this.resume()
      console.log('[AudioDspEngine] Connected MediaStream to full DSP graph')
    } catch (err) {
      console.warn('[AudioDspEngine] attachMediaStream error:', err)
    }
  }

  public setMediaStreamVolume(volume: number, rampTime = 0.05): void {
    if (this.stereoUpmix && this.ctx) {
      rampParam(this.stereoUpmix.gain, clamp(volume, 0, 1), rampTime, this.ctx)
    }
  }

  public detachMediaStream(): void {
    this.attachedStream = null
    if (this.mediaStreamSource) {
      safeDisconnect(this.mediaStreamSource)
      this.mediaStreamSource = null
    }
    if (this.stereoUpmix) {
      safeDisconnect(this.stereoUpmix)
      this.stereoUpmix = null
    }
  }

  public getAttachedMediaStream(): MediaStream | null {
    return this.attachedStream
  }

  public getMediaSource(): MediaElementAudioSourceNode | null {
    return this.mediaSource
  }

  private captureDestNode: MediaStreamAudioDestinationNode | null = null

  /**
   * Returns a MediaStream tapped from the post-DSP master gain node.
   * Used by WebRTC host to capture fully-processed audio for streaming
   * without calling createMediaElementSource a second time (which throws InvalidStateError).
   */
  public getStreamCapture(): MediaStream | null {
    if (!this.ctx || !this.masterGain) return null
    try {
      if (!this.captureDestNode) {
        this.captureDestNode = this.ctx.createMediaStreamDestination()
        this.masterGain.connect(this.captureDestNode)
      }
      return this.captureDestNode.stream
    } catch (err) {
      console.warn('[AudioDspEngine] getStreamCapture error:', err)
      return null
    }
  }

  /**
   * Disconnect and release the capture destination node.
   */
  public releaseStreamCapture(): void {
    if (this.captureDestNode) {
      try { this.captureDestNode.disconnect() } catch {}
      this.captureDestNode = null
    }
  }

  /**
   * Set Speaker Role / Channel Routing Mode
   * - 0: Center Speaker (Stereo: L→0, R→1)
   * - -1: Left Speaker (L isolated → 0 and 1)
   * - 1: Right Speaker (R isolated → 0 and 1)
   * - 2: Subwoofer ((L+R)*0.5 → 0 and 1, plus low-pass cutoff filter)
   */
  public setChannelMode(mode: ChannelMode, subFreq = this.currentSubCutoff): void {
    this.currentMode = mode
    this.currentSubCutoff = subFreq
    if (!this.isInitialized || !this.ctx || !this.gainL || !this.gainR || !this.toneMerge) return

    const lowPass = this.globalLowPass
    const fullRange = getFullRangeFrequency(this.ctx.sampleRate)

    // Reset LowPass if not in subwoofer mode
    if (lowPass && mode !== 2) {
      rampParam(lowPass.frequency, fullRange, RAMP_TIME_FAST, this.ctx)
    }

    // Reset routing
    safeDisconnect(this.gainL)
    safeDisconnect(this.gainR)

    if (mode !== 2) {
      rampParam(this.gainL.gain, 1.0, RAMP_TIME_FAST, this.ctx)
      rampParam(this.gainR.gain, 1.0, RAMP_TIME_FAST, this.ctx)
    }

    if (mode === 0) {
      // Center / Stereo: Left to L, Right to R
      this.gainL.connect(this.toneMerge, 0, 0)
      this.gainR.connect(this.toneMerge, 0, 1)
    } else if (mode === -1) {
      // Left Speaker only: L to both speakers
      this.gainL.connect(this.toneMerge, 0, 0)
      this.gainL.connect(this.toneMerge, 0, 1)
    } else if (mode === 1) {
      // Right Speaker only: R to both speakers
      this.gainR.connect(this.toneMerge, 0, 0)
      this.gainR.connect(this.toneMerge, 0, 1)
    } else if (mode === 2) {
      // Subwoofer: Sum (L+R)*0.5 to both speakers + LowPass cutoff
      rampParam(this.gainL.gain, 0.5, 0, this.ctx)
      rampParam(this.gainR.gain, 0.5, 0, this.ctx)
      if (lowPass) {
        rampParam(lowPass.frequency, subFreq, RAMP_TIME_FAST, this.ctx)
      }
      this.gainL.connect(this.toneMerge, 0, 0)
      this.gainL.connect(this.toneMerge, 0, 1)
      this.gainR.connect(this.toneMerge, 0, 0)
      this.gainR.connect(this.toneMerge, 0, 1)
    }

    // Suppress high-frequency enhancers on Subwoofer role
    this.applyVirtualEffects()
  }

  public setSubCutoff(freq: number): void {
    this.currentSubCutoff = clamp(freq, 40, 300)
    if (this.currentMode === 2 && this.globalLowPass && this.ctx) {
      rampParam(this.globalLowPass.frequency, this.currentSubCutoff, RAMP_TIME_FAST, this.ctx)
    }
  }

  /**
   * Ensure shared 8-channel splitter and surround gain nodes (from MUSIXQUARE FilePlaybackRoute)
   */
  public ensureSurroundNodes(): { splitter: ChannelSplitterNode; gain: GainNode } {
    this.init()
    const ctx = this.getAudioContext()
    if (!this.surroundSplitter || !this.surroundGain) {
      this.surroundSplitter = ctx.createChannelSplitter(8)
      this.surroundGain = ctx.createGain()
      this.surroundGain.gain.value = 1.0
    }
    return { splitter: this.surroundSplitter, gain: this.surroundGain }
  }

  /**
   * Set 7.1/5.1 Surround Channel Index (0-7):
   * 0: Front Left, 1: Front Right, 2: Center, 3: LFE (Sub),
   * 4: Side Left, 5: Side Right, 6: Rear Left (folds to Side L in 5.1), 7: Rear Right (folds to Side R in 5.1)
   */
  public setSurroundChannel(idx: number): void {
    if (!Number.isFinite(idx) || idx < 0 || idx > 7) return
    const channelIndex = Math.floor(idx)
    this.surroundChannelIndex = channelIndex
    this.isSurroundMode = true
    if (!this.isInitialized || !this.ctx || !this.gainL || !this.gainR || !this.toneMerge) return

    const { splitter, gain } = this.ensureSurroundNodes()

    try {
      splitter.disconnect()
      gain.disconnect()
      if (this.preamp) {
        gain.connect(this.preamp)
      }
      if (channelIndex === 6) {
        splitter.connect(gain, 6, 0)
        splitter.connect(gain, 4, 0)
      } else if (channelIndex === 7) {
        splitter.connect(gain, 7, 0)
        splitter.connect(gain, 5, 0)
      } else {
        splitter.connect(gain, channelIndex, 0)
      }

      if (this.filePlaybackRoute) {
        safeDisconnect(this.filePlaybackRoute)
        this.filePlaybackRoute.connect(splitter)
      }

      // LowPass for LFE channel
      const lowPass = this.globalLowPass
      const subFreq = this.currentSubCutoff
      const fullRange = getFullRangeFrequency(this.ctx.sampleRate)
      if (lowPass) {
        rampParam(lowPass.frequency, channelIndex === 3 ? subFreq : fullRange, RAMP_TIME_FAST, this.ctx)
      }

      // Force output to Dual Mono
      safeDisconnect(this.gainL)
      safeDisconnect(this.gainR)
      this.gainL.connect(this.toneMerge, 0, 0)
      this.gainL.connect(this.toneMerge, 0, 1)
      rampParam(this.gainL.gain, 1.0, RAMP_TIME_FAST, this.ctx)
      rampParam(this.gainR.gain, 1.0, RAMP_TIME_FAST, this.ctx)

      this.applyVirtualEffects()
    } catch (err) {
      console.warn('[AudioDspEngine] setSurroundChannel error:', err)
    }
  }

  public toggleSurroundMode(enabled: boolean): void {
    this.isSurroundMode = enabled
    if (enabled) {
      const idx = this.surroundChannelIndex === -1 ? 2 : this.surroundChannelIndex
      this.setSurroundChannel(idx)
    } else {
      if (this.filePlaybackRoute && this.widenerInput) {
        safeDisconnect(this.filePlaybackRoute)
        this.filePlaybackRoute.connect(this.widenerInput)
      }
      this.setChannelMode(this.currentMode)
    }
  }

  /**
   * Set 5-band Equalizer values (-12dB to +12dB)
   */
  public setEqualizer(gains: number[]): void {
    this.currentEq = gains
    if (!this.isInitialized || !this.ctx || this.eqNodes.length === 0) return

    gains.forEach((gainVal, idx) => {
      const node = this.eqNodes[idx]
      if (node) {
        const clamped = clamp(gainVal, -12, 12)
        rampParam(node.gain, clamped, RAMP_TIME, this.ctx!)
      }
    })
  }

  /**
   * Set Reverb parameters.
   * Debounces the expensive impulse response regeneration while applying
   * mix, lowCut, and highCut AudioParams immediately.
   */
  public setReverb(settings: ReverbSettings, deferReverbImpulse = false): void {
    this.currentReverb = settings
    if (!this.isInitialized || !this.ctx || !this.reverbDryGain || !this.reverbWetGain) return

    if (!settings.enabled || settings.mix <= 0.001) {
      rampParam(this.reverbDryGain.gain, 1.0, RAMP_TIME, this.ctx)
      rampParam(this.reverbWetGain.gain, 0.0, RAMP_TIME, this.ctx)
      return
    }

    // Equal-power crossfade (dry = cos, wet = sin)
    const mix = clamp(settings.mix, 0, 1)
    const dryVal = Math.cos((mix * Math.PI) / 2)
    const wetVal = Math.sin((mix * Math.PI) / 2)
    rampParam(this.reverbDryGain.gain, dryVal, RAMP_TIME, this.ctx)
    rampParam(this.reverbWetGain.gain, wetVal, RAMP_TIME, this.ctx)

    // Damping filters
    if (this.reverbLowCut) {
      const lFreq =
        REVERB_LOWCUT_BASE *
        Math.pow(REVERB_LOWCUT_FACTOR, clamp(settings.lowCut, 0, 100) / 100)
      rampParam(this.reverbLowCut.frequency, lFreq, RAMP_TIME, this.ctx)
    }

    if (this.reverbHighCut) {
      const sampleRate = this.ctx.sampleRate
      const hFreqRaw =
        REVERB_HIGHCUT_BASE *
        Math.pow(REVERB_HIGHCUT_FACTOR, clamp(settings.highCut, 0, 100) / 100)
      const hFreq =
        settings.highCut <= 0
          ? getFullRangeFrequency(sampleRate)
          : clampFilterFrequency(hFreqRaw, sampleRate)
      rampParam(this.reverbHighCut.frequency, hFreq, RAMP_TIME, this.ctx)
    }

    // Only regenerate impulse response if decay or preDelay actually changed
    if (
      settings.decay !== this.lastReverbDecay ||
      settings.preDelay !== this.lastReverbPreDelay
    ) {
      if (deferReverbImpulse) {
        if (this.reverbIrTimer) clearTimeout(this.reverbIrTimer)
        this.reverbIrTimer = setTimeout(() => {
          this.refreshReverbImpulse()
        }, REVERB_IR_COALESCE_MS)
      } else {
        if (this.reverbIrTimer) {
          clearTimeout(this.reverbIrTimer)
          this.reverbIrTimer = null
        }
        this.refreshReverbImpulse()
      }
    }
  }

  private refreshReverbImpulse(): void {
    if (!this.reverbConvolver || !this.ctx) return
    const { decay, preDelay } = this.currentReverb
    if (decay === this.lastReverbDecay && preDelay === this.lastReverbPreDelay) return

    this.lastReverbDecay = decay
    this.lastReverbPreDelay = preDelay
    try {
      this.reverbConvolver.buffer = generateReverbIR(this.ctx, decay, preDelay)
    } catch (e) {
      console.warn('[AudioDspEngine] Failed to set convolver buffer:', e)
    }
  }

  /**
   * Set Virtual Effects (Bass, Treble exciter, Surround widener)
   */
  public setVirtualEffects(effects: VirtualEffectSettings): void {
    this.currentVirtual = effects
    this.applyVirtualEffects()
  }

  private applyVirtualEffects(): void {
    if (!this.isInitialized || !this.ctx) return
    const isSubwoofer = this.currentMode === 2 || (this.isSurroundMode && this.surroundChannelIndex === 3)

    // Virtual Bass (Dual-band psychoacoustic saturator - MUSIXQUARE tuned to 60% default)
    if (this.vbGain) {
      const strength = this.currentVirtual.bassStrength ?? 0.6
      const targetGain = !isSubwoofer && this.currentVirtual.bass ? clamp(strength, 0, 1) : 0.0
      rampParam(this.vbGain.gain, targetGain, RAMP_TIME, this.ctx)
    }

    // Harmonic Exciter (Air band)
    if (this.exciterGain) {
      const targetGain = !isSubwoofer && this.currentVirtual.treble ? EXCITER_MIX_GAIN : 0.0
      rampParam(this.exciterGain.gain, targetGain, RAMP_TIME, this.ctx)
    }

    // Stereo Widener with loudness compensation (MUSIXQUARE tuned to 120% expanded width)
    // Width mapping: 0.0 = full mono (mid only), 1.0 = neutral stereo (unity gain), 2.0 = extra wide (side only)
    this.currentStereoWidth = this.currentVirtual.surround ? (this.currentVirtual.stereoWidth ?? 1.2) : 1.0
    if (this.widenerMidGain && this.widenerSideGain) {
      // At width=1.0: midGain=1.0, sideGain=1.0 → outL = Mid+Side = L, outR = Mid-Side = R (unity)
      // At width=0.0: midGain=1.0, sideGain=0.0 → outL = outR = Mid = (L+R)*0.5 (mono)
      // At width=2.0: midGain=0.0, sideGain=1.0 → outL = Side, outR = -Side (full side)
      const w = clamp(this.currentStereoWidth, 0, 2)
      const midGain = w <= 1.0 ? 1.0 : clamp(2.0 - w, 0, 1)
      const sideGain = w <= 1.0 ? w : 1.0
      rampParam(this.widenerMidGain.gain, midGain, RAMP_TIME, this.ctx)
      rampParam(this.widenerSideGain.gain, sideGain, RAMP_TIME, this.ctx)
    }

    // Preamp compensation so widening doesn't cause energy dip (from MUSIXQUARE userPreampGain)
    if (this.preamp) {
      let compensation = 1.0
      if (this.currentStereoWidth < 1.0) {
        compensation = STEREO_NARROW_BASE + STEREO_NARROW_SCALE * this.currentStereoWidth
      } else if (this.currentStereoWidth > 1.0) {
        compensation = Math.max(
          STEREO_WIDE_FLOOR,
          1.0 / (STEREO_NARROW_BASE + STEREO_NARROW_SCALE * this.currentStereoWidth)
        )
      }
      rampParam(this.preamp.gain, this.userPreampGain * compensation, RAMP_TIME, this.ctx)
    }
  }

  public setUserPreampGain(gain: number): void {
    this.userPreampGain = clamp(gain, 0.0, 3.981)
    this.applyVirtualEffects()
  }

  public setPreamp(valDb: number): void {
    const db = Math.max(-48, Math.min(12, Number(valDb)))
    if (!Number.isFinite(db)) return
    const linear = Math.pow(10, db / 20)
    this.setUserPreampGain(linear)
  }

  public getUserPreampGain(): number {
    return this.userPreampGain
  }

  public setMasterVolume(vol: number, rampTime = RAMP_TIME): void {
    if (this.masterGain && this.ctx) {
      rampParam(this.masterGain.gain, clamp(vol, 0, 1), rampTime, this.ctx)
    }
  }

  public setMasterGain(vol: number, rampTime = RAMP_TIME): void {
    this.setMasterVolume(vol, rampTime)
  }

  private isDestinationMuted = false

  /**
   * Mute or unmute the local physical audio destination (speakers) while keeping
   * the analyser connected and alive for real-time visualizer rendering (MUSIXQUARE system capture / monitoring logic).
   */
  public setDestinationMuted(muted: boolean): void {
    if (!this.masterGain || !this.ctx || this.isDestinationMuted === muted) return
    try {
      if (muted) {
        this.masterGain.disconnect(this.ctx.destination)
      } else {
        this.masterGain.connect(this.ctx.destination)
      }
      this.isDestinationMuted = muted
    } catch (e) {
      console.warn('[AudioDspEngine] setDestinationMuted error:', e)
    }
  }

  public getIsDestinationMuted(): boolean {
    return this.isDestinationMuted
  }

  private dataArrayCache: Uint8Array<ArrayBuffer> | null = null

  public getFrequencyData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(64)
    }
    if (!this.dataArrayCache || this.dataArrayCache.length !== this.analyser.frequencyBinCount) {
      this.dataArrayCache = new Uint8Array(this.analyser.frequencyBinCount)
    }
    this.analyser.getByteFrequencyData(this.dataArrayCache as any)
    return this.dataArrayCache
  }

  public getAverageEnergy(): number {
    const data = this.getFrequencyData()
    if (!data.length) return 0
    let sum = 0
    const count = Math.min(data.length, 64)
    for (let i = 0; i < count; i++) {
      sum += data[i]
    }
    return sum / (count * 255)
  }

  private applyAllSettings(): void {
    // Pull persisted DSP settings from Zustand store if available.
    // This fixes the rehydration timing bug where onRehydrateStorage runs
    // before init() is called, causing all persisted settings to be silently dropped.
    try {
      const { useDspStore } = require('../hooks/useDspStore')
      const state = useDspStore.getState()
      if (state) {
        if (state.channelMode !== undefined) this.currentMode = state.channelMode
        if (state.subFreq !== undefined) this.currentSubCutoff = state.subFreq
        if (state.eqGains) this.currentEq = state.eqGains
        if (state.reverbMix !== undefined) {
          this.currentReverb = {
            enabled: Boolean(state.reverbEnabled ?? ((state.reverbMix ?? 0) > 0)),
            mix: state.reverbMix ?? 0,
            decay: state.reverbDecay ?? REVERB_DEFAULT_DECAY,
            preDelay: state.reverbPreDelay ?? REVERB_DEFAULT_PREDELAY,
            lowCut: state.reverbLowCut ?? 0,
            highCut: state.reverbHighCut ?? 0
          }
        }
        if (state.virtualBass !== undefined) this.currentVirtual.bass = state.virtualBass
        if (state.bassStrength !== undefined) this.currentVirtual.bassStrength = state.bassStrength
        if (state.exciter !== undefined) this.currentVirtual.treble = state.exciter
        if (state.surround !== undefined) this.currentVirtual.surround = state.surround
        if (state.stereoWidth !== undefined) this.currentVirtual.stereoWidth = state.stereoWidth
        if (state.userPreampGain !== undefined) this.userPreampGain = state.userPreampGain
      }
    } catch {
      // useDspStore not yet available — use in-memory defaults
    }

    this.setChannelMode(this.currentMode, this.currentSubCutoff)
    this.setEqualizer(this.currentEq)
    this.setReverb(this.currentReverb, false)
    this.applyVirtualEffects()
  }
}

export const audioDspEngine = new AudioDspEngine()
