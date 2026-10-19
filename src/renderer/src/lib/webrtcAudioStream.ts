import { getSupabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  getActiveAudioElement,
  getActiveAudioMediaStream,
  registerAudioTrackChangeListener
} from './audioBridge'
import { toMediaUrl } from './media'
import {
  analyzeCompression,
  transcodeToCompressedAudio
} from './jitAudioPipeline'
import { audioDspEngine } from './audioDspEngine'
import { useDspStore, type DspRoomSnapshot } from '../hooks/useDspStore'

export interface WebRTCSignalMessage {
  type: 'stream-started' | 'stream-stopped' | 'join-stream' | 'leave-stream' | 'offer' | 'answer' | 'ice-candidate' | 'dsp-settings-sync'
  senderId: string
  targetId?: string
  offer?: RTCSessionDescriptionInit
  answer?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  settings?: DspRoomSnapshot
  metadata?: {
    hostName?: string
    streamTitle?: string
    bitrate?: number
  }
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // OpenRelay TURN fallback for cross-network, cellular 4G/5G, and symmetric NAT traversal
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

export interface WebRTCAudioStats {
  rttMs: number
  bitrateKbps: number
  packetLoss: number
}

/**
 * Modifies an SDP description to set the Opus codec parameters for studio music quality:
 * - Full stereo (stereo=1, sprop-stereo=1)
 * - Studio bitrate (default 256 kbps CBR - 1:1 MUSIXQUARE parity for NetEq stability)
 * - In-band Forward Error Correction (useinbandfec=1)
 * - Studio frame pacing (minptime=10, maxptime=20)
 */
export function forceStereoSdp(sdp: string, bitrateBps = 320000): string {
  try {
    const lines = sdp.split(/\r?\n/)
    const opusPTs: string[] = []

    for (const line of lines) {
      const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/i)
      if (match) {
        opusPTs.push(match[1])
      }
    }

    if (opusPTs.length === 0) return sdp

    const stereoParams = [
      'stereo=1',
      'sprop-stereo=1',
      `maxaveragebitrate=${bitrateBps}`,
      'maxplaybackrate=48000',
      'sprop-maxcapturerate=48000',
      'cbr=1',
      'useinbandfec=1'
    ]

    for (const pt of opusPTs) {
      const fmtpIdx = lines.findIndex((l) => new RegExp(`^a=fmtp:${pt}\\b`).test(l))
      if (fmtpIdx !== -1) {
        const line = lines[fmtpIdx]
        const match = line.match(new RegExp(`^a=fmtp:${pt}\\s*(.*)$`))
        const preservedParams = match && match[1]
          ? match[1]
              .split(';')
              .map((p) => p.trim())
              .filter(Boolean)
              .filter((p) => !/^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec|maxplaybackrate|sprop-maxcapturerate|cbr)=/i.test(p))
          : []
        lines[fmtpIdx] = `a=fmtp:${pt} ${[...preservedParams, ...stereoParams].join('; ')}`
      } else {
        const rtpmapIdx = lines.findIndex((l) => new RegExp(`^a=rtpmap:${pt}\\b`).test(l))
        if (rtpmapIdx !== -1) {
          lines.splice(rtpmapIdx + 1, 0, `a=fmtp:${pt} ${stereoParams.join('; ')}`)
        }
      }
    }

    return lines.join('\r\n')
  } catch (err) {
    console.warn('[WebRTC] Failed to force Opus stereo SDP, using raw SDP:', err)
    return sdp
  }
}

/** Backwards-compatibility alias for forceStereoSdp */
export const enhanceOpusSdp = forceStereoSdp

/** Boost bitrate and disable microphone DSP constraints for system audio sender (1:1 MUSIXQUARE parity). */
export function tuneSystemAudioSender(sender: RTCRtpSender, bitrateBps = 320000): void {
  if (sender.track?.kind !== 'audio') return
  const track = sender.track
  try {
    track
      .applyConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      })
      .catch(() => {})
  } catch {}

  try {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    params.encodings[0].maxBitrate = bitrateBps
    sender.setParameters(params).catch(() => {})
  } catch {}
}

/** Set fixed playoutDelayHint target (0.5s) on receivers to prevent buffer drift across devices (1:1 MUSIXQUARE parity). */
export const SYSTEM_AUDIO_PLAYOUT_DELAY_S = 0.5

export function tuneSystemAudioReceivers(pc: RTCPeerConnection): void {
  for (const r of pc.getReceivers()) {
    const recv = r as RTCRtpReceiver & { playoutDelayHint?: number }
    if (recv.track && recv.track.kind === 'audio') {
      try {
        recv.playoutDelayHint = SYSTEM_AUDIO_PLAYOUT_DELAY_S
      } catch {}
    }
  }
}

export interface WebRtcAudioDecoderPrimer {
  element: HTMLAudioElement
  streamKey: string
}

let _activeDecoderPrimer: WebRtcAudioDecoderPrimer | null = null

export function getAudioTrackStreamKey(scope: string, tracks: readonly MediaStreamTrack[]): string {
  return `${scope}:${tracks.map((track) => track.id).join(',')}`
}

export function cleanupWebRtcAudioDecoderPrimer(): void {
  if (!_activeDecoderPrimer) return
  try {
    _activeDecoderPrimer.element.pause()
  } catch {}
  try {
    _activeDecoderPrimer.element.srcObject = null
  } catch {}
  try {
    _activeDecoderPrimer.element.remove()
  } catch {}
  _activeDecoderPrimer = null
}

/** Dedicated, isolated decoder primer element to wake Chromium audio decoding without polluting main player (1:1 MUSIXQUARE parity). */
export function primeWebRtcAudioDecoder(
  tracks: readonly MediaStreamTrack[],
  scope = 'stream'
): WebRtcAudioDecoderPrimer | null {
  if (tracks.length === 0) return null
  const streamKey = getAudioTrackStreamKey(scope, tracks)
  if (_activeDecoderPrimer?.streamKey === streamKey) {
    return _activeDecoderPrimer
  }
  cleanupWebRtcAudioDecoderPrimer()

  try {
    const audioEl = document.createElement('audio')
    audioEl.autoplay = true
    audioEl.controls = false
    audioEl.muted = true
    audioEl.volume = 0
    audioEl.setAttribute('playsinline', 'true')
    audioEl.preload = 'auto'
    audioEl.srcObject = new MediaStream([...tracks])
    audioEl.dataset.feloSystemAudio = 'webrtc-decoder-primer'
    audioEl.style.display = 'none'
    document.body.appendChild(audioEl)
    _activeDecoderPrimer = { element: audioEl, streamKey }

    void audioEl.play().catch((err) => {
      console.debug('[WebRTCClient] Decoder primer play blocked:', err)
    })
    return _activeDecoderPrimer
  } catch (err) {
    console.debug('[WebRTCClient] Error creating decoder primer:', err)
    return null
  }
}

/**
 * Waits for remote WebRTC tracks to unmute before connecting them to Web Audio (1:1 MUSIXQUARE parity).
 * In Chromium, tracks arrive in muted state until the first RTP audio packets are decoded.
 * Creating a MediaStreamAudioSourceNode on a muted track produces a permanently silent node.
 */
export async function waitForInitialUnmute(
  tracks: readonly MediaStreamTrack[],
  timeoutMs = 4000,
  settleMs = 80
): Promise<boolean> {
  if (tracks.length === 0 || tracks.every((t) => !t.muted)) {
    return true
  }

  console.log('[WebRTCClient] WebRTC audio stream arrived muted; waiting for unmute before Web Audio graph attach')

  return new Promise<boolean>((resolve) => {
    let settled = false
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (settleTimer) clearTimeout(settleTimer)
      tracks.forEach((track) => track.removeEventListener('unmute', check))
    }

    const done = (ready: boolean, reason: string): void => {
      if (settled) return
      settled = true
      cleanup()
      console.log(
        `[WebRTCClient] Audio graph attach after ${reason}: tracks muted=${tracks.map((t) => t.muted).join(',')}`
      )
      resolve(ready)
    }

    const check = (): void => {
      if (tracks.every((track) => !track.muted)) {
        if (!settleTimer) {
          settleTimer = setTimeout(() => done(true, 'unmute'), settleMs)
        }
      }
    }

    tracks.forEach((track) => track.addEventListener('unmute', check))
    timeoutTimer = setTimeout(() => {
      const stillMuted = tracks.some((t) => t.muted)
      done(!stillMuted, 'unmute-timeout')
    }, timeoutMs)
    check()
  })
}

/**
 * Captures the system/device loopback audio stream using standard getDisplayMedia (1:1 MUSIXQUARE parity).
 * In Electron Windows loopback capture, passes plain `audio: true` to avoid OverconstrainedError/NotAllowedError,
 * and falls back to constraint dictionary for browser environments.
 * Immediately stops all video tracks so screen capture does not persist in the background.
 */
export async function captureSystemAudioStream(): Promise<{
  rawStream: MediaStream
  audioTrack: MediaStreamTrack
  audioOnlyStream: MediaStream
}> {
  let rawStream: MediaStream | null = null

  // 1. In Electron WASAPI loopback, audio must be requested with a plain boolean `audio: true`.
  // Passing constraint dictionaries ({ echoCancellation: false, ... }) causes Chromium desktop
  // capture to reject with OverconstrainedError or NotAllowedError.
  try {
    rawStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    })
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission denied')) {
      throw new Error('Screen/audio capture was cancelled or denied by user.')
    }
    // Fallback to constraint dictionary for browser environments if OverconstrainedError/TypeError
    const isConstraintError =
      err instanceof DOMException &&
      (err.name === 'OverconstrainedError' || err.name === 'TypeError')
    if (isConstraintError) {
      try {
        rawStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            sampleRate: 48000
          } as any
        })
      } catch (fallbackErr: any) {
        if (
          fallbackErr?.name === 'NotAllowedError' ||
          fallbackErr?.message?.includes('Permission denied')
        ) {
          throw new Error('Screen/audio capture was cancelled or denied by user.')
        }
        throw new Error('Device audio capture could not be initialized.')
      }
    } else {
      throw new Error('Device audio capture could not be initialized.')
    }
  }

  if (!rawStream) {
    throw new Error('Device audio capture could not be initialized.')
  }

  // 2. Immediately stop all video tracks — only the captured audio track belongs in the product graph
  for (const vt of rawStream.getVideoTracks()) {
    try {
      vt.stop()
    } catch {}
  }

  // 3. Validate audio track
  const audioTracks = rawStream.getAudioTracks()
  if (audioTracks.length === 0) {
    for (const t of rawStream.getTracks()) {
      try {
        t.stop()
      } catch {}
    }
    throw new Error(
      'No system audio track was captured. When prompted, make sure to check "Also share system audio" in the browser popup.'
    )
  }

  const audioTrack = audioTracks[0]
  try {
    audioTrack.contentHint = 'music'
  } catch {}

  // Apply audio constraints safely directly to the captured track
  try {
    void audioTrack
      .applyConstraints({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      })
      .catch(() => {})
  } catch {}

  const audioOnlyStream = new MediaStream([audioTrack])
  return { rawStream, audioTrack, audioOnlyStream }
}

/**
 * Calculates audio RMS/volume level (0-100) from a MediaStream for UI meters.
 */
export class AudioLevelMonitor {
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private rafId: number | null = null
  private callback: (level: number) => void
  private unlockHandler: (() => void) | null = null

  constructor(callback: (level: number) => void) {
    this.callback = callback
  }

  setVolume(_vol: number): void {
    // Volume is controlled via HTMLAudioElement
  }

  start(stream: MediaStream): void {
    this.stop()
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      this.audioCtx = new AudioCtx()
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().catch(() => {})
      }

      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.8

      this.sourceNode = this.audioCtx.createMediaStreamSource(stream)
      this.sourceNode.connect(this.analyser)

      // Unlock AudioContext on mobile Safari if suspended upon touch/click
      this.unlockHandler = () => {
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          void this.audioCtx
            .resume()
            .then(() => {
              if (this.audioCtx?.state === 'running' && this.unlockHandler) {
                window.removeEventListener('touchstart', this.unlockHandler)
                window.removeEventListener('click', this.unlockHandler)
                this.unlockHandler = null
              }
            })
            .catch(() => {})
        }
      }
      window.addEventListener('touchstart', this.unlockHandler, { passive: true })
      window.addEventListener('click', this.unlockHandler, { passive: true })

      const bufferLength = this.analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      let lastUpdate = 0
      const updateLevel = (now: number): void => {
        if (!this.analyser) return
        this.rafId = requestAnimationFrame(updateLevel)
        if (now - lastUpdate < 50) return
        lastUpdate = now

        this.analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        const average = sum / bufferLength
        const percentage = Math.min(100, Math.round((average / 128) * 100))
        this.callback(percentage)
      }

      this.rafId = requestAnimationFrame(updateLevel)
    } catch (err) {
      console.warn('[AudioLevelMonitor] Error starting monitor:', err)
    }
  }

  resume(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => {})
    }
  }

  stop(): void {
    if (this.unlockHandler) {
      window.removeEventListener('touchstart', this.unlockHandler)
      window.removeEventListener('click', this.unlockHandler)
      this.unlockHandler = null
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {
        // Ignored
      }
      this.sourceNode = null
    }
    if (this.audioCtx) {
      try {
        void this.audioCtx.close()
      } catch {
        // Ignored
      }
      this.audioCtx = null
    }
    this.analyser = null
    this.callback(0)
  }
}

/**
 * Host manager for WebRTC loopback system audio broadcast.
 * Accepts multiple listeners, manages peer connections, and signals over Supabase Realtime.
 */
export interface WebRTCAudioHostOptions {
  bitrateBps?: number
  onPeerConnected?: (peerId: string, count: number) => void
  onPeerDisconnected?: (peerId: string, count: number) => void
  onAudioLevel?: (level: number) => void
  onLevelChange?: (level: number) => void
  onUploadProgress?: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
  onError?: (err: Error) => void
  onEnded?: () => void
}

export class WebRTCAudioHost {
  private roomCode: string
  private userId: string
  private bitrateBps = 256000
  private isMuted = false
  private isTrackOnly = false
  private rawStream: MediaStream | null = null
  private audioTrack: MediaStreamTrack | null = null
  private audioOnlyStream: MediaStream | null = null
  private peers = new Map<string, RTCPeerConnection>()
  private peerDataChannels = new Map<string, RTCDataChannel>()
  private peerPendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private channel: RealtimeChannel | null = null
  private levelMonitor: AudioLevelMonitor | null = null
  public activeTrackId: string | null = null
  public activeTrackPayload: Blob | File | string | null = null
  public activeTrackUrl: string | null = null
  public activeTrackMimeType = 'audio/flac'
  public activeTrackDuration = 180
  private peerStreamAbortControllers = new Map<string, AbortController>()
  private peerDisconnectTimers = new Map<string, any>()

  public onLevelChange?: (level: number) => void
  public onPeerCountChange?: (count: number) => void
  public onUploadProgress?: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
  public onError?: (err: Error) => void
  public onEnded?: () => void

  constructor(roomCode: string, userId: string, options?: WebRTCAudioHostOptions) {
    this.roomCode = roomCode
    this.userId = userId
    if (options?.bitrateBps) {
      this.bitrateBps = options.bitrateBps
    }
    if (options) {
      if (options.onLevelChange) this.onLevelChange = options.onLevelChange
      if (options.onAudioLevel) this.onLevelChange = options.onAudioLevel
      if (options.onPeerConnected || options.onPeerDisconnected) {
        this.onPeerCountChange = (count) => {
          options.onPeerConnected?.('', count)
        }
      }
      if (options.onError) this.onError = options.onError
      if (options.onEnded) this.onEnded = options.onEnded
    }
  }

  async setBitrate(bitrateBps: number): Promise<void> {
    this.bitrateBps = bitrateBps
    for (const pc of this.peers.values()) {
      if (pc.connectionState === 'closed') continue
      const senders = pc.getSenders()
      for (const sender of senders) {
        if (sender.track?.kind === 'audio') {
          try {
            const params = sender.getParameters()
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}]
            }
            params.encodings[0].maxBitrate = bitrateBps
            await sender.setParameters(params)
          } catch (err) {
            console.warn('[WebRTCHost] Failed to update sender bitrate dynamically:', err)
          }
        }
      }
    }
  }

  getBitrate(): number {
    return this.bitrateBps
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted
    if (this.audioTrack) {
      this.audioTrack.enabled = !muted
    }
  }

  getIsMuted(): boolean {
    return this.isMuted
  }

  async start(): Promise<void> {
    this.isTrackOnly = false
    // 1. Capture system loopback audio
    const { rawStream, audioTrack, audioOnlyStream } = await captureSystemAudioStream()
    this.rawStream = rawStream
    this.audioTrack = audioTrack
    this.audioOnlyStream = audioOnlyStream

    // Handle user clicking "Stop Sharing" from the OS/browser notification bar
    this.audioTrack.onended = () => {
      this.stop()
      this.onEnded?.()
    }

    // 2. MUSIXQUARE System Audio Capture Topology Parity:
    // Route captured system audio into the host's Web Audio DSP engine so visualizers dance,
    // while muting physical speaker destination to prevent acoustic feedback loop / audio doubling.
    audioDspEngine.attachMediaStream(this.audioOnlyStream, 1.0, false)
    audioDspEngine.setDestinationMuted(true)

    // 3. Start audio level monitor
    if (this.onLevelChange) {
      this.levelMonitor = new AudioLevelMonitor(this.onLevelChange)
      this.levelMonitor.start(this.audioOnlyStream)
    }

    // 3. Connect to Supabase Realtime Broadcast channel
    const supabase = getSupabase()
    this.channel = supabase.channel(`room-rtc-${this.roomCode}`, {
      config: { broadcast: { ack: false, self: false } }
    })

    this.channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const msg = payload as WebRTCSignalMessage
      if (!msg) return

      try {
        if (msg.type === 'join-stream' && msg.senderId) {
          if (msg.senderId === this.userId) return
          await this.handlePeerJoin(msg.senderId)
        } else if (msg.type === 'answer' && msg.senderId && msg.targetId === this.userId && msg.answer) {
          await this.handlePeerAnswer(msg.senderId, msg.answer)
        } else if (msg.type === 'ice-candidate' && msg.senderId && msg.targetId === this.userId && msg.candidate) {
          await this.handlePeerCandidate(msg.senderId, msg.candidate)
        } else if (msg.type === 'leave-stream' && msg.senderId) {
          this.removePeer(msg.senderId)
        }
      } catch (err) {
        console.warn(`[WebRTCHost] Error handling signal from ${msg.senderId}:`, err)
      }
    })

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000)
      this.channel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    // 4. Broadcast that device audio stream has started
    await this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: 'stream-started',
        senderId: this.userId,
        metadata: { bitrate: this.bitrateBps }
      } satisfies WebRTCSignalMessage
    })
  }

  /**
   * Starts WebRTC audio hosting in track-only mode without prompt for screen/system audio capture.
   * Listeners connect and stream lossless FLAC/MP3 track chunks directly via WebRTC DataChannel.
   * If local audio element stream capture is available, it also streams real-time Opus audio.
   */
  async startTrackOnlyMode(): Promise<void> {
    this.isTrackOnly = true

    // Register audio track change listener to seamlessly re-capture on song changes
    registerAudioTrackChangeListener(() => {
      this.refreshTrack()
    })

    // Capture initial track if element is active
    this.refreshTrack()

    const supabase = getSupabase()
    this.channel = supabase.channel(`room-rtc-${this.roomCode}`, {
      config: { broadcast: { ack: false, self: false } }
    })

    this.channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const msg = payload as WebRTCSignalMessage
      if (!msg) return

      try {
        if (msg.type === 'join-stream' && msg.senderId) {
          if (msg.senderId === this.userId) return
          await this.handlePeerJoin(msg.senderId)
        } else if (msg.type === 'answer' && msg.senderId && msg.targetId === this.userId && msg.answer) {
          await this.handlePeerAnswer(msg.senderId, msg.answer)
        } else if (msg.type === 'ice-candidate' && msg.senderId && msg.targetId === this.userId && msg.candidate) {
          await this.handlePeerCandidate(msg.senderId, msg.candidate)
        } else if (msg.type === 'leave-stream' && msg.senderId) {
          this.removePeer(msg.senderId)
        }
      } catch (err) {
        console.warn(`[WebRTCHost] Error handling signal from ${msg.senderId}:`, err)
      }
    })

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000)
      this.channel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    await this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: 'stream-started',
        senderId: this.userId,
        metadata: { bitrate: this.bitrateBps }
      } satisfies WebRTCSignalMessage
    })
  }

  /**
   * Refreshes the local audio track from the active HTMLAudioElement and dynamically replaces
   * the audio sender track on all active peer connections without interrupting playback.
   */
  refreshTrack(): void {
    if (!this.isTrackOnly) return
    try {
      let stream =
        getActiveAudioMediaStream() ||
        (() => {
          const el = getActiveAudioElement()
          if (!el) return null
          return typeof (el as any).captureStream === 'function'
            ? (el as any).captureStream()
            : typeof (el as any).mozCaptureStream === 'function'
            ? (el as any).mozCaptureStream()
            : null
        })()

      // Fallback: If captureStream returned null or empty tracks, use audioDspEngine's
      // post-DSP master gain capture node instead of creating a competing MediaElementSource
      // (which throws InvalidStateError when the element is already bound to the DSP graph).
      if (!stream || stream.getAudioTracks().length === 0) {
        const dspStream = audioDspEngine.getStreamCapture()
        if (dspStream && dspStream.getAudioTracks().length > 0) {
          stream = dspStream
        }
      }

      if (stream && stream.getAudioTracks().length > 0) {
        this.audioOnlyStream = stream
        this.audioTrack = stream.getAudioTracks()[0]

        if (this.audioTrack) {
          try {
            void this.audioTrack.applyConstraints({
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            })
          } catch {}
        }

        // Update audio track on all connected peers
        for (const [peerId, pc] of this.peers.entries()) {
          const senders = pc.getSenders()
          const audioSender = senders.find((s) => s.track?.kind === 'audio' || s.track === null)
          if (audioSender && this.audioTrack) {
            void audioSender.replaceTrack(this.audioTrack).catch((err) => {
              console.warn('[WebRTCHost] Failed to replaceTrack on peer:', err)
            })
          } else if (!audioSender && this.audioTrack && this.audioOnlyStream) {
            try {
              const sender = pc.addTrack(this.audioTrack, this.audioOnlyStream)
              tuneSystemAudioSender(sender, this.bitrateBps)
              void this.renegotiatePeer(peerId, pc)
            } catch {}
          }
        }

        if (this.onLevelChange && this.audioOnlyStream) {
          this.levelMonitor?.stop()
          this.levelMonitor = new AudioLevelMonitor(this.onLevelChange)
          this.levelMonitor.start(this.audioOnlyStream)
        }
      }
    } catch (err) {
      console.warn('[WebRTCHost] Error refreshing track:', err)
    }
  }

  private async renegotiatePeer(peerId: string, pc: RTCPeerConnection): Promise<void> {
    try {
      if (pc.signalingState === 'closed') return
      const offer = await pc.createOffer()
      if (offer.sdp) {
        offer.sdp = forceStereoSdp(offer.sdp, this.bitrateBps)
      }
      await pc.setLocalDescription(offer)
      if (this.channel) {
        await this.channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'offer',
            senderId: this.userId,
            targetId: peerId,
            offer: {
              type: offer.type,
              sdp: offer.sdp
            }
          } satisfies WebRTCSignalMessage
        })
      }
    } catch (err) {
      console.warn('[WebRTCHost] Renegotiation error for peer:', peerId, err)
    }
  }

  private async handlePeerJoin(peerId: string): Promise<void> {
    // Refresh audio track first to ensure new peer receives a live track immediately
    this.refreshTrack()
    if (!this.isTrackOnly && (!this.audioTrack || !this.audioOnlyStream)) return

    // Guard against tearing down already-connected or in-flight handshakes
    const existing = this.peers.get(peerId)
    if (existing) {
      if (existing.connectionState === 'connected') {
        // Peer is already connected; sync settings and track payload if data channel is ready
        try {
          const dc = this.peerDataChannels.get(peerId)
          if (dc && dc.readyState === 'open') {
            const snapshot = useDspStore.getState().getRoomDspSnapshot()
            if (snapshot) {
              dc.send(JSON.stringify({ type: 'dsp-settings-sync', settings: snapshot }))
            }
            const payloadToStream = this.activeTrackPayload || this.activeTrackUrl
            if (payloadToStream) {
              void this.streamTrackToPeer(
                dc,
                peerId,
                payloadToStream,
                this.activeTrackMimeType,
                this.activeTrackId || 'track',
                this.activeTrackDuration
              )
            }
          }
        } catch {}
        return
      }
      if (existing.connectionState === 'connecting' || existing.signalingState === 'have-local-offer') {
        // Handshake already in flight; do not abort ongoing ICE / SDP negotiation
        return
      }
      this.removePeer(peerId)
    }

    const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })
    this.peers.set(peerId, pc)
    this.onPeerCountChange?.(this.peers.size)

    pc.onicecandidate = (event) => {
      if (event.candidate && this.channel) {
        void this.channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'ice-candidate',
            senderId: this.userId,
            targetId: peerId,
            candidate: event.candidate.toJSON()
          } satisfies WebRTCSignalMessage
        })
      }
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'connected') {
        const timer = this.peerDisconnectTimers.get(peerId)
        if (timer) {
          clearTimeout(timer)
          this.peerDisconnectTimers.delete(peerId)
        }
      } else if (state === 'failed' || state === 'closed') {
        const timer = this.peerDisconnectTimers.get(peerId)
        if (timer) {
          clearTimeout(timer)
          this.peerDisconnectTimers.delete(peerId)
        }
        this.removePeer(peerId)
      } else if (state === 'disconnected') {
        if (!this.peerDisconnectTimers.has(peerId)) {
          const timer = setTimeout(() => {
            this.peerDisconnectTimers.delete(peerId)
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              this.removePeer(peerId)
            }
          }, 4000)
          this.peerDisconnectTimers.set(peerId, timer)
        }
      }
    }

    // Add audio track to peer connection if available, or add audio transceiver so SDP offer always has an audio m-line
    if (this.audioTrack && this.audioOnlyStream) {
      try {
        const sender = pc.addTrack(this.audioTrack, this.audioOnlyStream)
        tuneSystemAudioSender(sender, this.bitrateBps)
      } catch (trackErr) {
        console.warn('[WebRTCHost] Could not add audio track to peer connection:', trackErr)
      }
    } else {
      try {
        pc.addTransceiver('audio', { direction: 'sendonly' })
      } catch (trErr) {
        console.warn('[WebRTCHost] Could not add audio transceiver:', trErr)
      }

      // In track-only mode, audio element may not be ready yet (Howl still loading).
      // Retry capturing and attaching the audio track once it becomes available.
      if (this.isTrackOnly) {
        const retryAttachTrack = (attempt: number) => {
          if (attempt > 3 || !this.peers.has(peerId)) return
          setTimeout(() => {
            if (!this.peers.has(peerId)) return
            this.refreshTrack()
            if (this.audioTrack && this.audioOnlyStream) {
              const activePc = this.peers.get(peerId)
              if (activePc && activePc.connectionState !== 'closed' && activePc.connectionState !== 'failed') {
                const senders = activePc.getSenders()
                const audioSender = senders.find((s) => s.track?.kind === 'audio' || s.track === null)
                if (audioSender) {
                  void audioSender.replaceTrack(this.audioTrack!).catch((err) => {
                    console.warn('[WebRTCHost] Retry replaceTrack failed:', err)
                  })
                } else {
                  try {
                    const sender = activePc.addTrack(this.audioTrack!, this.audioOnlyStream!)
                    tuneSystemAudioSender(sender, this.bitrateBps)
                    void this.renegotiatePeer(peerId, activePc)
                  } catch {}
                }
              }
            } else {
              retryAttachTrack(attempt + 1)
            }
          }, 500 * (attempt + 1))
        }
        retryAttachTrack(0)
      }
    }

    // Setup DataChannel for lossless audio streaming
    try {
      const dc = pc.createDataChannel('felo-lossless-stream', { ordered: true })
      this.peerDataChannels.set(peerId, dc)
      dc.onopen = () => {
        try {
          const snapshot = useDspStore.getState().getRoomDspSnapshot()
          if (snapshot) {
            dc.send(JSON.stringify({ type: 'dsp-settings-sync', settings: snapshot }))
          }
        } catch {}
        const payloadToStream = this.activeTrackPayload || this.activeTrackUrl
        if (payloadToStream) {
          void this.streamTrackToPeer(
            dc,
            peerId,
            payloadToStream,
            this.activeTrackMimeType,
            this.activeTrackId || 'track',
            this.activeTrackDuration
          )
        }
      }
    } catch (dcErr) {
      console.warn('[WebRTCHost] Could not create lossless data channel for peer:', dcErr)
    }

    // Create offer
    const offer = await pc.createOffer()
    // Enhance SDP for fullband stereo Opus at configured bitrate
    if (offer.sdp) {
      offer.sdp = forceStereoSdp(offer.sdp, this.bitrateBps)
    }
    await pc.setLocalDescription(offer)

    for (const sender of pc.getSenders()) {
      tuneSystemAudioSender(sender, this.bitrateBps)
    }

    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'offer',
          senderId: this.userId,
          targetId: peerId,
          offer: {
            type: offer.type,
            sdp: offer.sdp
          }
        } satisfies WebRTCSignalMessage
      })
    }
  }

  private async handlePeerAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(peerId)
    if (!pc) return

    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
      for (const sender of pc.getSenders()) {
        tuneSystemAudioSender(sender, this.bitrateBps)
      }
      const pending = this.peerPendingCandidates.get(peerId) || []
      this.peerPendingCandidates.delete(peerId)
      for (const cand of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand))
        } catch (err) {
          console.warn(`[WebRTCHost] Error adding drained candidate for ${peerId}:`, err)
        }
      }
    }
  }

  private async handlePeerCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(peerId)
    if (!pc || !pc.remoteDescription) {
      const pending = this.peerPendingCandidates.get(peerId) || []
      pending.push(candidate)
      this.peerPendingCandidates.set(peerId, pending)
      return
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn(`[WebRTCHost] Error adding candidate for ${peerId}:`, err)
    }
  }

  private removePeer(peerId: string): void {
    const timer = this.peerDisconnectTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.peerDisconnectTimers.delete(peerId)
    }
    const abortCtrl = this.peerStreamAbortControllers.get(peerId)
    if (abortCtrl) {
      try {
        abortCtrl.abort()
      } catch {}
      this.peerStreamAbortControllers.delete(peerId)
    }
    this.peerPendingCandidates.delete(peerId)
    const dc = this.peerDataChannels.get(peerId)
    if (dc) {
      try {
        dc.close()
      } catch {
        // Ignored
      }
      this.peerDataChannels.delete(peerId)
    }

    const pc = this.peers.get(peerId)
    if (pc) {
      try {
        pc.close()
      } catch {
        // Ignored
      }
      this.peers.delete(peerId)
      this.onPeerCountChange?.(this.peers.size)
    }
  }

  /**
   * Streams audio chunks to an individual peer's DataChannel with flow control backpressure,
   * safe 16 KB packet fragmentation, and per-peer cancellation on track change.
   */
  private  async streamTrackToPeer(
    dc: RTCDataChannel,
    peerId: string,
    fileOrBlobOrUrl: Blob | File | string,
    mimeType = 'audio/mpeg',
    trackId = 'track',
    durationSec = 180
  ): Promise<void> {
    if (dc.readyState !== 'open') return

    // Cancel any previous stream reader in progress for this peer
    const prevAbort = this.peerStreamAbortControllers.get(peerId)
    if (prevAbort) {
      try {
        prevAbort.abort()
      } catch {}
      this.peerStreamAbortControllers.delete(peerId)
    }

    const abortCtrl = new AbortController()
    this.peerStreamAbortControllers.set(peerId, abortCtrl)
    const signal = abortCtrl.signal

    try {
      let rawBlob: Blob | null = null
      if (fileOrBlobOrUrl instanceof Blob) {
        rawBlob = fileOrBlobOrUrl
      } else if (typeof fileOrBlobOrUrl === 'string') {
        const fetchUrl = /^https?:\/\//i.test(fileOrBlobOrUrl) || /^blob:/i.test(fileOrBlobOrUrl) || /^media:\/\//i.test(fileOrBlobOrUrl)
          ? fileOrBlobOrUrl
          : toMediaUrl(fileOrBlobOrUrl) || fileOrBlobOrUrl
        const response = await fetch(fetchUrl, { signal: abortCtrl.signal })
        if (!response.ok) return
        rawBlob = await response.blob()
      }

      if (!rawBlob || abortCtrl.signal.aborted || dc.readyState !== 'open') return

      const profile = analyzeCompression(rawBlob.size, durationSec, trackId, mimeType)

      let payloadToStream = rawBlob
      if (profile.needsCompression) {
        this.onUploadProgress?.(trackId, 0, 'Compressing (WAV -> Opus)...', 0, rawBlob.size)
        try {
          payloadToStream = await transcodeToCompressedAudio(rawBlob, signal)
        } catch (transErr: any) {
          if (transErr.name === 'AbortError') return
          payloadToStream = rawBlob
        }
      }

      if (signal.aborted || dc.readyState !== 'open') return

      const totalSize = payloadToStream.size
      const CHUNK_SIZE = 65536 // 64 KB slices for optimal WebRTC SCTP delivery
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
      const effectiveMime = payloadToStream.type || rawBlob.type || mimeType || 'audio/mpeg'

      const startMsg = JSON.stringify({
        type: 'jit-start',
        trackId,
        mimeType: effectiveMime,
        totalSize,
        totalChunks,
        compression: profile
      })
      dc.send(startMsg)

      let uploadedBytes = 0

      for (let i = 0; i < totalChunks; i++) {
        if (signal.aborted || dc.readyState !== 'open') {
          if (dc.readyState === 'open') {
            try {
              dc.send(JSON.stringify({ type: 'jit-abort', trackId }))
            } catch {}
          }
          return
        }

        // Flow control: event-driven backpressure via bufferedamountlow threshold
        if (dc.readyState === 'open' && !signal.aborted && dc.bufferedAmount > 1048576) {
          dc.bufferedAmountLowThreshold = 262144
          await new Promise<void>((resolve) => {
            const onLow = () => {
              dc.removeEventListener('bufferedamountlow', onLow)
              clearTimeout(timer)
              resolve()
            }
            const timer = setTimeout(() => {
              dc.removeEventListener('bufferedamountlow', onLow)
              resolve()
            }, 100)
            dc.addEventListener('bufferedamountlow', onLow)
          })
        }

        if (signal.aborted || dc.readyState !== 'open') return

        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalSize)
        const slice = payloadToStream.slice(start, end)
        const arrayBuf = await slice.arrayBuffer()

        dc.send(arrayBuf)

        uploadedBytes += arrayBuf.byteLength
        const percent = Math.min(100, Math.round((uploadedBytes / totalSize) * 100))
        const statusText = profile.needsCompression
          ? `Compressing & Uploading... ${percent}%`
          : `Uploading... ${percent}%`
        this.onUploadProgress?.(trackId, percent, statusText, uploadedBytes, totalSize)
      }

      if (!signal.aborted && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'jit-end', trackId, totalSize }))
        this.onUploadProgress?.(trackId, 100, 'Playing (Synced)', totalSize, totalSize)
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn(`[WebRTCHost] Error streaming JIT track to peer ${peerId}:`, err)
      }
    } finally {
      if (this.peerStreamAbortControllers.get(peerId) === abortCtrl) {
        this.peerStreamAbortControllers.delete(peerId)
      }
    }
  }

  /**
   * Broadcasts the pristine, bit-perfect lossless audio stream chunks directly through WebRTC DataChannels.
   * Chunks are held ephemerally in RAM on the listener's client and never written to disk.
   */
  async broadcastLosslessTrack(
    fileOrBlobOrUrl: Blob | File | string,
    mimeType = 'audio/flac',
    trackId = 'track',
    durationSec = 180
  ): Promise<void> {
    this.activeTrackId = trackId
    this.activeTrackPayload = fileOrBlobOrUrl
    this.activeTrackUrl = typeof fileOrBlobOrUrl === 'string' ? fileOrBlobOrUrl : null
    this.activeTrackMimeType = mimeType
    this.activeTrackDuration = durationSec

    for (const [peerId, dc] of this.peerDataChannels) {
      if (dc.readyState === 'open') {
        void this.streamTrackToPeer(dc, peerId, fileOrBlobOrUrl, mimeType, trackId, durationSec)
      }
    }
  }

  /**
   * Broadcasts room DSP settings (EQ gains, Reverb presets, Virtual Bass/Exciter/Widener)
   * to all connected peers over both WebRTC DataChannel and Supabase Realtime broadcast.
   */
  broadcastDspSettings(snapshot: DspRoomSnapshot): void {
    if (this.channel) {
      void this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'dsp-settings-sync',
          senderId: this.userId,
          settings: snapshot
        } satisfies WebRTCSignalMessage
      })
    }
    const msg = JSON.stringify({ type: 'dsp-settings-sync', settings: snapshot })
    for (const dc of this.peerDataChannels.values()) {
      if (dc.readyState === 'open') {
        try {
          dc.send(msg)
        } catch {}
      }
    }
  }

  private isStopping = false

  stop(): void {
    if (this.isStopping) return
    this.isStopping = true
    try {
      if (this.channel) {
        void this.channel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            type: 'stream-stopped',
            senderId: this.userId
          } satisfies WebRTCSignalMessage
        })
        void getSupabase().removeChannel(this.channel)
        this.channel = null
      }

      this.levelMonitor?.stop()
      this.levelMonitor = null

      for (const [, abortCtrl] of this.peerStreamAbortControllers) {
        try {
          abortCtrl.abort()
        } catch {}
      }
      this.peerStreamAbortControllers.clear()

      for (const [, timer] of this.peerDisconnectTimers) {
        clearTimeout(timer)
      }
      this.peerDisconnectTimers.clear()

      for (const [, dc] of this.peerDataChannels) {
        try {
          dc.close()
        } catch {
          // Ignored
        }
      }
      this.peerDataChannels.clear()

      for (const [, pc] of this.peers) {
        try {
          pc.close()
        } catch {
          // Ignored
        }
      }
      this.peers.clear()
      this.onPeerCountChange?.(0)

      if (this.audioTrack) {
        this.audioTrack.onended = null
      }

      if (this.rawStream) {
        this.rawStream.getTracks().forEach((t) => {
          t.onended = null
          t.stop()
        })
        this.rawStream = null
      }

      // Restore physical destination and detach captured stream from DSP engine
      if (this.audioOnlyStream && audioDspEngine.getAttachedMediaStream() === this.audioOnlyStream) {
        audioDspEngine.detachMediaStream()
      }
      audioDspEngine.setDestinationMuted(false)
      audioDspEngine.releaseStreamCapture()

      this.audioTrack = null
      this.audioOnlyStream = null
      this.activeTrackUrl = null
      this.activeTrackPayload = null
      this.activeTrackId = null
      registerAudioTrackChangeListener(null)
    } finally {
      this.isStopping = false
    }
  }
}

/**
 * Listener client for receiving host's WebRTC device audio stream.
 * Plays incoming audio through an ephemeral HTML5 MediaStream in RAM (Mode A compliant).
 */
export interface WebRTCAudioClientOptions {
  onLevelChange?: (level: number) => void
  onStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'stopped') => void
  onConnectionStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'stopped') => void
  onAutoplayBlocked?: (blocked: boolean) => void
  onStats?: (stats: WebRTCAudioStats) => void
  onLosslessReady?: (blobUrl: string, mimeType: string) => void
  onJITProgress?: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
  onError?: (err: Error) => void
}

export class WebRTCAudioClient {
  private roomCode: string
  private userId: string
  private hostId: string
  private pc: RTCPeerConnection | null = null
  private channel: RealtimeChannel | null = null
  private audioElement: HTMLAudioElement | null = null
  private audioCtx: AudioContext | null = null
  private audioSourceNode: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private levelMonitor: AudioLevelMonitor | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private statsTimer: any = null
  private prevBytesReceived = 0
  private prevTimestamp = 0
  private handshakeRetryTimer: any = null
  private reconnectTimer: any = null

  private losslessChunks: ArrayBuffer[] = []
  private losslessMimeType = 'audio/flac'
  private losslessTotalSize = 0
  private losslessReceivedSize = 0
  private losslessBlobUrl: string | null = null
  private activeTrackId: string | null = null
  private currentStream: MediaStream | null = null

  public onLevelChange?: (level: number) => void
  public onStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'stopped') => void
  public onAutoplayBlocked?: (blocked: boolean) => void
  public onStats?: (stats: WebRTCAudioStats) => void
  public onLosslessReady?: (blobUrl: string, mimeType: string) => void
  public onJITProgress?: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
  public onError?: (err: Error) => void

  constructor(roomCode: string, userId: string, hostId: string, options?: WebRTCAudioClientOptions) {
    this.roomCode = roomCode
    this.userId = userId
    this.hostId = hostId
    if (options) {
      if (options.onLevelChange) this.onLevelChange = options.onLevelChange
      if (options.onStateChange) this.onStateChange = options.onStateChange
      if (options.onConnectionStateChange) this.onStateChange = options.onConnectionStateChange
      if (options.onAutoplayBlocked) this.onAutoplayBlocked = options.onAutoplayBlocked
      if (options.onStats) this.onStats = options.onStats
      if (options.onLosslessReady) this.onLosslessReady = options.onLosslessReady
      if (options.onJITProgress) this.onJITProgress = options.onJITProgress
      if (options.onError) this.onError = options.onError
    }
  }

  private volume = 1.0

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume
    }
    if (this.audioElement) {
      this.audioElement.volume = this.volume
      this.audioElement.muted = this.volume === 0
    }
    audioDspEngine.setMediaStreamVolume(this.volume)
    this.levelMonitor?.setVolume(this.volume)
  }

  setMutedForLossless(_muted: boolean): void {
    // Lossless mute logic decoupled from device audio streaming
  }

  resumeAudio(): void {
    void audioDspEngine.resume()
    if (this.audioElement && this.audioElement.paused) {
      void this.audioElement.play().catch(() => {})
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume()
    }
  }

  /**
   * Routes incoming stream directly to an industry-standard HTML5 Audio element
   * for zero-glitch, hardware-accelerated WebRTC audio decoding and playout,
   * while maintaining AudioLevelMonitor for UI visualizers.
   */
  public playStream(stream: MediaStream, _forceReattach = false): void {
    this.currentStream = stream

    // Detach any competing media stream from audioDspEngine to prevent double-output comb-filter / phasing
    audioDspEngine.detachMediaStream()

    if (!this.audioElement) {
      const audioEl = document.createElement('audio')
      audioEl.autoplay = true
      audioEl.controls = false
      audioEl.setAttribute('playsinline', 'true')
      audioEl.dataset.feloSystemAudio = 'webrtc-stream-player'
      audioEl.style.position = 'fixed'
      audioEl.style.pointerEvents = 'none'
      audioEl.style.opacity = '0'
      audioEl.style.width = '0'
      audioEl.style.height = '0'
      audioEl.style.top = '-9999px'
      audioEl.style.left = '-9999px'
      document.body.appendChild(audioEl)
      this.audioElement = audioEl
    }

    if (this.audioElement.srcObject !== stream) {
      this.audioElement.srcObject = stream
    }
    this.audioElement.volume = this.volume
    this.audioElement.muted = this.volume === 0

    // Ensure audio track lifecycle events keep playout in sync
    const audioTracks = stream.getAudioTracks()
    for (const track of audioTracks) {
      track.onunmute = () => {
        if (this.audioElement && this.audioElement.paused) {
          void this.audioElement.play().catch(() => {})
        }
        this.levelMonitor?.resume()
      }
      track.onended = () => {
        if (this.audioElement) {
          this.audioElement.pause()
          this.audioElement.srcObject = null
        }
        this.levelMonitor?.stop()
      }
    }

    // Unlock playback and handle browser autoplay restrictions cleanly
    try {
      const playPromise = this.audioElement.play()
      if (playPromise !== undefined && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            this.onAutoplayBlocked?.(false)
          })
          .catch((playErr: any) => {
            if (playErr?.name === 'NotAllowedError') {
              console.warn('[WebRTCClient] Autoplay blocked by browser policy; user gesture required')
              this.onAutoplayBlocked?.(true)
            } else {
              console.warn('[WebRTCClient] Error playing audio element:', playErr)
            }
          })
      } else {
        this.onAutoplayBlocked?.(false)
      }
    } catch (syncErr: any) {
      if (syncErr?.name === 'NotAllowedError') {
        this.onAutoplayBlocked?.(true)
      }
    }
  }

  private stopHandshakeRetry(): void {
    if (this.handshakeRetryTimer) {
      clearInterval(this.handshakeRetryTimer)
      this.handshakeRetryTimer = null
    }
  }

  async connect(): Promise<void> {
    this.onStateChange?.('connecting')

    const supabase = getSupabase()
    this.channel = supabase.channel(`room-rtc-${this.roomCode}`, {
      config: { broadcast: { ack: false, self: false } }
    })

    this.channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const msg = payload as WebRTCSignalMessage
      if (!msg) return

      try {
        if (msg.type === 'offer' && msg.targetId === this.userId && msg.offer && msg.senderId === this.hostId) {
          this.stopHandshakeRetry()
          await this.handleOffer(msg.offer)
        } else if (msg.type === 'ice-candidate' && msg.targetId === this.userId && msg.candidate && msg.senderId === this.hostId) {
          if (this.pc && this.pc.remoteDescription) {
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
            } catch (err) {
              console.warn('[WebRTCClient] Error adding candidate:', err)
            }
          } else {
            this.pendingCandidates.push(msg.candidate)
          }
        } else if (msg.type === 'stream-stopped' && msg.senderId === this.hostId) {
          this.disconnect()
          this.onStateChange?.('stopped')
        } else if (msg.type === 'dsp-settings-sync' && msg.settings && msg.senderId === this.hostId) {
          if (useDspStore.getState().settingsSync) {
            useDspStore.getState().applyRoomDspSnapshot(msg.settings)
          }
        }
      } catch (err) {
        console.warn('[WebRTCClient] Error handling signal:', err)
      }
    })

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 4000)
      this.channel!.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout)
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout)
          reject(new Error(`Realtime subscription error: ${status}`))
        }
      })
    })

    await this.sendJoin()

    this.stopHandshakeRetry()
    let attempts = 0
    this.handshakeRetryTimer = setInterval(async () => {
      if (this.pc?.remoteDescription || this.pc?.connectionState === 'connected' || attempts >= 5) {
        this.stopHandshakeRetry()
        return
      }
      attempts++
      await this.sendJoin()
    }, 2500)
  }

  private async sendJoin(): Promise<void> {
    if (!this.channel) return
    await this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: 'join-stream',
        senderId: this.userId,
        targetId: this.hostId
      } satisfies WebRTCSignalMessage
    })
  }

  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    const isRenegotiation = Boolean(
      this.pc &&
      this.pc.signalingState !== 'closed' &&
      this.pc.connectionState !== 'failed' &&
      this.pc.connectionState !== 'closed'
    )

    if (!isRenegotiation) {
      if (this.pc) {
        try {
          this.pc.close()
        } catch {
          // Ignored
        }
      }

      this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })

      this.pc.ondatachannel = (event) => {
        if (event.channel.label === 'felo-lossless-stream' || event.channel.label === 'felo-jit-stream') {
          this.setupLosslessDataChannel(event.channel)
        }
      }

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.channel) {
          void this.channel.send({
            type: 'broadcast',
            event: 'signal',
            payload: {
              type: 'ice-candidate',
              senderId: this.userId,
              targetId: this.hostId,
              candidate: event.candidate.toJSON()
            } satisfies WebRTCSignalMessage
          })
        }
      }

      this.pc.ontrack = async (event) => {
        const stream = event.streams[0] || new MediaStream([event.track])
        if (this.pc) {
          tuneSystemAudioReceivers(this.pc)
        }

        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length === 0) return

        // 1. Immediately play stream using dedicated HTMLAudioElement (industry standard)
        this.playStream(stream)

        // 2. On track unmute / network recovery, ensure playback continues
        event.track.onunmute = () => {
          if (this.audioElement && this.audioElement.paused) {
            void this.audioElement.play().catch(() => {})
          }
          this.levelMonitor?.resume()
        }

        event.track.onended = () => {
          if (this.audioElement) {
            this.audioElement.pause()
            this.audioElement.srcObject = null
          }
          this.levelMonitor?.stop()
        }

        // 3. Audio Level Monitor for UI VU meters
        if (this.onLevelChange) {
          this.levelMonitor?.stop()
          this.levelMonitor = new AudioLevelMonitor(this.onLevelChange)
          this.levelMonitor.start(stream)
        }

        this.startStatsMonitoring()
        this.onStateChange?.('connected')
      }

      this.pc.onconnectionstatechange = () => {
        const state = this.pc?.connectionState
        if (state === 'connected') {
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
          }
          this.onStateChange?.('connected')
        } else if (state === 'disconnected') {
          this.onStateChange?.('disconnected')
          if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = null
              if (this.pc?.connectionState === 'disconnected' || this.pc?.connectionState === 'failed') {
                console.log('[WebRTCClient] Connection dropped; auto-reconnecting via join-stream')
                void this.sendJoin()
              }
            }, 3000)
          }
        } else if (state === 'failed') {
          this.onStateChange?.('disconnected')
          void this.sendJoin()
        } else if (state === 'closed') {
          this.onStateChange?.('disconnected')
        }
      }
    }

    if (!this.pc) return
    const pc = this.pc

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    tuneSystemAudioReceivers(pc)
    const queuedCandidates = [...this.pendingCandidates]
    this.pendingCandidates = []
    for (const cand of queuedCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand))
      } catch (err) {
        console.warn('[WebRTCClient] Error adding buffered candidate:', err)
      }
    }

    const answer = await pc.createAnswer()
    // CRITICAL: Munge answer SDP to force stereo reception (RFC 7587 & 1:1 MUSIXQUARE parity)
    if (answer.sdp) {
      answer.sdp = forceStereoSdp(answer.sdp, 256000)
    }
    await pc.setLocalDescription(answer)

    if (this.channel) {
      await this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'answer',
          senderId: this.userId,
          targetId: this.hostId,
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        } satisfies WebRTCSignalMessage
      })
    }
  }

  async unmuteAudio(): Promise<boolean> {
    if (this.audioElement) {
      try {
        this.audioElement.muted = false
        this.audioElement.volume = this.volume
        if (this.currentStream && this.audioElement.srcObject !== this.currentStream) {
          this.audioElement.srcObject = this.currentStream
        }
        await this.audioElement.play()
        this.onAutoplayBlocked?.(false)
      } catch (err) {
        console.warn('[WebRTCClient] unmuteAudio play error:', err)
        return false
      }
    } else if (this.currentStream) {
      this.playStream(this.currentStream)
    }
    await audioDspEngine.resume()
    this.levelMonitor?.resume()
    this.onAutoplayBlocked?.(false)
    return true
  }

  private startStatsMonitoring(): void {
    this.stopStatsMonitoring()
    this.statsTimer = setInterval(async () => {
      if (!this.pc || this.pc.connectionState !== 'connected') return
      try {
        const stats = await this.pc.getStats()
        let rttMs = 0
        let bitrateKbps = 0
        let packetLoss = 0

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (typeof report.currentRoundTripTime === 'number') {
              rttMs = Math.round(report.currentRoundTripTime * 1000)
            }
          } else if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            const now = report.timestamp
            const bytes = report.bytesReceived || 0
            if (this.prevTimestamp > 0 && now > this.prevTimestamp) {
              const deltaSeconds = (now - this.prevTimestamp) / 1000
              const deltaBytes = Math.max(0, bytes - this.prevBytesReceived)
              bitrateKbps = Math.round((deltaBytes * 8) / (deltaSeconds * 1000))
            }
            this.prevBytesReceived = bytes
            this.prevTimestamp = now

            const packetsLost = report.packetsLost || 0
            const packetsReceived = report.packetsReceived || 0
            const total = packetsLost + packetsReceived
            if (total > 0) {
              packetLoss = Math.min(100, Math.round((packetsLost / total) * 100))
            }
          }
        })

        if (this.onStats && (rttMs > 0 || bitrateKbps > 0)) {
          this.onStats({ rttMs, bitrateKbps, packetLoss })
        }
      } catch {
        // Ignored
      }
    }, 2500)
  }

  private stopStatsMonitoring(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  private setupLosslessDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer'
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const meta = JSON.parse(event.data)
          if (meta.type === 'dsp-settings-sync' && meta.settings) {
            if (useDspStore.getState().settingsSync) {
              useDspStore.getState().applyRoomDspSnapshot(meta.settings)
            }
            return
          }
          if (meta.type === 'jit-start' || meta.type === 'start') {
            this.clearLosslessBuffer()
            this.losslessMimeType = meta.mimeType || 'audio/mpeg'
            this.losslessTotalSize = meta.totalSize || 0
            this.losslessReceivedSize = 0
            this.activeTrackId = meta.trackId || null
            this.onJITProgress?.(meta.trackId || '', 0, 'Buffering... 0%', 0, this.losslessTotalSize)
            this.setMutedForLossless(false)
          } else if (meta.type === 'jit-end' || meta.type === 'end') {
            this.activateLosslessPlayback()
          } else if (meta.type === 'jit-abort') {
            this.clearLosslessBuffer()
            this.onJITProgress?.(meta.trackId || '', 0, 'Buffering paused', 0, this.losslessTotalSize)
          }
        } catch {}
      } else if (event.data instanceof ArrayBuffer) {
        this.losslessChunks.push(event.data)
        this.losslessReceivedSize += event.data.byteLength
        if (this.losslessTotalSize > 0) {
          const percent = Math.min(100, Math.round((this.losslessReceivedSize / this.losslessTotalSize) * 100))
          this.onJITProgress?.(
            this.activeTrackId || '',
            percent,
            `Buffering... ${percent}%`,
            this.losslessReceivedSize,
            this.losslessTotalSize
          )
        }
        // When received complete track stream, activate in-memory lossless stream
        if (
          !this.losslessBlobUrl &&
          this.losslessTotalSize > 0 &&
          this.losslessReceivedSize >= this.losslessTotalSize
        ) {
          this.activateLosslessPlayback()
        }
      }
    }
  }

  private activateLosslessPlayback(): void {
    if (this.losslessChunks.length === 0) return
    try {
      const blob = new Blob(this.losslessChunks, { type: this.losslessMimeType })
      if (this.losslessBlobUrl) {
        URL.revokeObjectURL(this.losslessBlobUrl)
      }
      this.losslessBlobUrl = URL.createObjectURL(blob)
      const finalBytes = this.losslessTotalSize || this.losslessReceivedSize
      this.onJITProgress?.(this.activeTrackId || '', 100, 'Playing (Synced)', finalBytes, finalBytes)
      this.onLosslessReady?.(this.losslessBlobUrl, this.losslessMimeType)
    } catch (err) {
      console.warn('[WebRTCClient] Error activating JIT lossless buffer:', err)
    }
  }

  private clearLosslessBuffer(): void {
    if (this.losslessBlobUrl) {
      try {
        URL.revokeObjectURL(this.losslessBlobUrl)
      } catch {}
      this.losslessBlobUrl = null
    }
    this.losslessChunks = []
    this.losslessReceivedSize = 0
    this.losslessTotalSize = 0
    this.activeTrackId = null
    this.setMutedForLossless(false)
  }

  disconnect(): void {
    this.stopHandshakeRetry()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearLosslessBuffer()
    this.stopStatsMonitoring()
    this.pendingCandidates = []
    this.currentStream = null
    cleanupWebRtcAudioDecoderPrimer()

    if (this.channel) {
      void this.channel.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          type: 'leave-stream',
          senderId: this.userId,
          targetId: this.hostId
        } satisfies WebRTCSignalMessage
      })
      void getSupabase().removeChannel(this.channel)
      this.channel = null
    }

    this.levelMonitor?.stop()
    this.levelMonitor = null

    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        // Ignored
      }
      this.pc = null
    }

    audioDspEngine.detachMediaStream()

    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.disconnect()
      } catch {}
      this.audioSourceNode = null
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect()
      } catch {}
      this.gainNode = null
    }
    if (this.audioCtx) {
      try {
        void this.audioCtx.close()
      } catch {}
      this.audioCtx = null
    }

    if (this.audioElement) {
      try {
        this.audioElement.pause()
        this.audioElement.srcObject = null
        this.audioElement.remove()
      } catch {}
      this.audioElement = null
    }
    this.onStateChange?.('stopped')
  }
}
