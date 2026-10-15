import { getSupabase } from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export interface WebRTCSignalMessage {
  type: 'stream-started' | 'stream-stopped' | 'join-stream' | 'leave-stream' | 'offer' | 'answer' | 'ice-candidate'
  senderId: string
  targetId?: string
  offer?: RTCSessionDescriptionInit
  answer?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
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
  { urls: 'stun:stun3.l.google.com:19302' }
]

export interface WebRTCAudioStats {
  rttMs: number
  bitrateKbps: number
  packetLoss: number
}

/**
 * Modifies an SDP description to set the Opus codec parameters for studio music quality:
 * - Full stereo (stereo=1, sprop-stereo=1)
 * - Studio Ultra bitrate (default 510 kbps CBR - maximum mathematical Opus limit)
 * - In-band Forward Error Correction (useinbandfec=1)
 * - Studio frame pacing (minptime=10, maxptime=20)
 */
export function enhanceOpusSdp(sdp: string, bitrateBps = 510000): string {
  try {
    const match = /a=rtpmap:(\d+)\s+opus\/48000\/2/i.exec(sdp)
    if (!match) return sdp
    const pt = match[1]

    const fmtpRegex = new RegExp(`^a=fmtp:${pt}\\s+(.*)$`, 'm')
    const fmtpMatch = fmtpRegex.exec(sdp)

    let customParams = 'stereo=1;sprop-stereo=1;useinbandfec=1;minptime=10;maxptime=20'
    if (bitrateBps > 0) {
      customParams += `;maxaveragebitrate=${bitrateBps};cbr=1`
    }

    if (fmtpMatch) {
      let existing = fmtpMatch[1]
      if (!existing.includes('stereo=')) existing += ';stereo=1'
      if (!existing.includes('sprop-stereo=')) existing += ';sprop-stereo=1'
      if (!existing.includes('maxaveragebitrate=')) existing += `;maxaveragebitrate=${bitrateBps}`
      if (!existing.includes('cbr=')) existing += ';cbr=1'
      if (!existing.includes('useinbandfec=')) existing += ';useinbandfec=1'
      return sdp.replace(fmtpRegex, `a=fmtp:${pt} ${existing}`)
    } else {
      return sdp.replace(
        new RegExp(`(a=rtpmap:${pt}\\s+opus\\/48000\\/2)`, 'i'),
        `$1\r\na=fmtp:${pt} ${customParams}`
      )
    }
  } catch (err) {
    console.warn('[WebRTC] Failed to enhance Opus SDP, using raw SDP:', err)
    return sdp
  }
}

/**
 * Captures the system/device loopback audio stream using Electron or modern Web APIs.
 * Disables echo cancellation, noise suppression, and automatic gain control to preserve full musical dynamics.
 */
export async function captureSystemAudioStream(): Promise<{
  rawStream: MediaStream
  audioTrack: MediaStreamTrack
  audioOnlyStream: MediaStream
}> {
  let rawStream: MediaStream | null = null
  let captureError: any = null

  // 1. First attempt: standard getDisplayMedia with studio audio constraints
  try {
    rawStream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
        sampleRate: 48000
      } as any,
      video: true
    })
  } catch (displayErr: any) {
    captureError = displayErr
    console.warn('[WebRTC] getDisplayMedia capture failed or cancelled, trying getUserMedia desktop fallback:', displayErr)
  }

  // 2. Second attempt (Electron fallback): getUserMedia with chromeMediaSource desktop
  if (!rawStream || rawStream.getAudioTracks().length === 0) {
    try {
      const desktopStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop'
          }
        },
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            maxWidth: 2,
            maxHeight: 2,
            maxFrameRate: 1
          }
        }
      })
      if (desktopStream && desktopStream.getAudioTracks().length > 0) {
        if (rawStream) {
          rawStream.getTracks().forEach((t) => t.stop())
        }
        rawStream = desktopStream
        captureError = null
      }
    } catch (fallbackErr) {
      console.warn('[WebRTC] getUserMedia desktop fallback also failed:', fallbackErr)
    }
  }

  if (!rawStream) {
    if (captureError?.name === 'NotAllowedError' || captureError?.message?.includes('Permission denied')) {
      throw new Error('Screen/audio capture was cancelled by user.')
    }
    throw new Error('Device audio capture could not be initialized.')
  }

  const audioTracks = rawStream.getAudioTracks()
  if (audioTracks.length === 0) {
    rawStream.getTracks().forEach((t) => t.stop())
    throw new Error('No system audio track was captured. When prompted, make sure to check "Also share system audio" in the browser popup.')
  }

  // Disable video track without stopping it to prevent stream termination on some Chromium builds
  rawStream.getVideoTracks().forEach((vt) => {
    vt.enabled = false
  })

  const audioTrack = audioTracks[0]
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

  constructor(callback: (level: number) => void) {
    this.callback = callback
  }

  start(stream: MediaStream): void {
    this.stop()
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioCtx) return
      this.audioCtx = new AudioCtx()
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume()
      }

      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.8

      this.sourceNode = this.audioCtx.createMediaStreamSource(stream)
      this.sourceNode.connect(this.analyser)

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

  stop(): void {
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
  onError?: (err: Error) => void
  onEnded?: () => void
}

export class WebRTCAudioHost {
  private roomCode: string
  private userId: string
  private bitrateBps = 510000
  private isMuted = false
  private rawStream: MediaStream | null = null
  private audioTrack: MediaStreamTrack | null = null
  private audioOnlyStream: MediaStream | null = null
  private peers = new Map<string, RTCPeerConnection>()
  private peerDataChannels = new Map<string, RTCDataChannel>()
  private peerPendingCandidates = new Map<string, RTCIceCandidateInit[]>()
  private channel: RealtimeChannel | null = null
  private levelMonitor: AudioLevelMonitor | null = null
  private activeTrackUrl: string | null = null
  private activeTrackMimeType = 'audio/flac'
  private peerStreamAbortControllers = new Map<string, AbortController>()
  private peerDisconnectTimers = new Map<string, any>()

  public onLevelChange?: (level: number) => void
  public onPeerCountChange?: (count: number) => void
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

  setBitrate(bitrateBps: number): void {
    this.bitrateBps = bitrateBps
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

    // 2. Start audio level monitor
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

    await this.channel.subscribe()

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

  private async handlePeerJoin(peerId: string): Promise<void> {
    if (!this.audioTrack || !this.audioOnlyStream) return

    // Clean up any existing connection for this peer
    this.removePeer(peerId)

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

    // Add audio track to peer connection
    pc.addTrack(this.audioTrack, this.audioOnlyStream)

    // Setup DataChannel for lossless audio streaming
    try {
      const dc = pc.createDataChannel('felo-lossless-stream', { ordered: true })
      this.peerDataChannels.set(peerId, dc)
      dc.onopen = () => {
        if (this.activeTrackUrl) {
          void this.streamTrackToPeer(dc, peerId, this.activeTrackUrl, this.activeTrackMimeType)
        }
      }
    } catch (dcErr) {
      console.warn('[WebRTCHost] Could not create lossless data channel for peer:', dcErr)
    }

    // Create offer
    const offer = await pc.createOffer()
    // Enhance SDP for fullband stereo Opus at configured bitrate
    if (offer.sdp) {
      offer.sdp = enhanceOpusSdp(offer.sdp, this.bitrateBps)
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
  }

  private async handlePeerAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(peerId)
    if (!pc) return

    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
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
  private async streamTrackToPeer(
    dc: RTCDataChannel,
    peerId: string,
    audioUrl: string,
    mimeType: string
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

    try {
      const response = await fetch(audioUrl, { signal: abortCtrl.signal })
      if (!response.ok || !response.body) return
      const totalSize = parseInt(response.headers.get('content-length') || '0', 10)

      if (abortCtrl.signal.aborted || dc.readyState !== 'open') return

      const startMsg = JSON.stringify({ type: 'start', mimeType, totalSize })
      dc.send(startMsg)

      const reader = response.body.getReader()
      const CHUNK_SIZE = 16384 // 16 KB safe WebRTC SCTP chunk size

      while (true) {
        if (abortCtrl.signal.aborted || dc.readyState !== 'open') {
          try {
            await reader.cancel()
          } catch {}
          break
        }

        const { done, value } = await reader.read()
        if (done) break

        if (value && value.byteLength > 0) {
          // Slice the Uint8Array into 16 KB safe WebRTC chunks
          for (let offset = 0; offset < value.byteLength; offset += CHUNK_SIZE) {
            if (abortCtrl.signal.aborted || dc.readyState !== 'open') break

            // Flow control: wait if bufferedAmount exceeds 2MB
            while (dc.readyState === 'open' && !abortCtrl.signal.aborted && dc.bufferedAmount > 2097152) {
              await new Promise((r) => setTimeout(r, 40))
            }

            if (abortCtrl.signal.aborted || dc.readyState !== 'open') break

            const slice = value.subarray(offset, Math.min(offset + CHUNK_SIZE, value.byteLength))
            dc.send(slice)
          }
        }
      }

      if (!abortCtrl.signal.aborted && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'end' }))
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn(`[WebRTCHost] Error streaming track to peer ${peerId}:`, err)
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
  async broadcastLosslessTrack(audioUrl: string, mimeType = 'audio/flac'): Promise<void> {
    this.activeTrackUrl = audioUrl
    this.activeTrackMimeType = mimeType

    for (const [peerId, dc] of this.peerDataChannels) {
      if (dc.readyState === 'open') {
        void this.streamTrackToPeer(dc, peerId, audioUrl, mimeType)
      }
    }
  }

  stop(): void {
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

    if (this.rawStream) {
      this.rawStream.getTracks().forEach((t) => t.stop())
      this.rawStream = null
    }
    this.audioTrack = null
    this.audioOnlyStream = null
    this.activeTrackUrl = null
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
  onError?: (err: Error) => void
}

export class WebRTCAudioClient {
  private roomCode: string
  private userId: string
  private hostId: string
  private pc: RTCPeerConnection | null = null
  private channel: RealtimeChannel | null = null
  private audioElement: HTMLAudioElement | null = null
  private levelMonitor: AudioLevelMonitor | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private statsTimer: any = null
  private prevBytesReceived = 0
  private prevTimestamp = 0
  private handshakeRetryTimer: any = null

  private losslessChunks: ArrayBuffer[] = []
  private losslessMimeType = 'audio/flac'
  private losslessTotalSize = 0
  private losslessReceivedSize = 0
  private losslessBlobUrl: string | null = null

  public onLevelChange?: (level: number) => void
  public onStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'stopped') => void
  public onAutoplayBlocked?: (blocked: boolean) => void
  public onStats?: (stats: WebRTCAudioStats) => void
  public onLosslessReady?: (blobUrl: string, mimeType: string) => void
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
      if (options.onError) this.onError = options.onError
    }
  }

  setMutedForLossless(muted: boolean): void {
    if (this.audioElement) {
      this.audioElement.muted = muted
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

    // Create an ephemeral HTMLAudioElement in memory
    this.audioElement = new Audio()
    this.audioElement.autoplay = true
    this.audioElement.volume = 1.0

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

    const sendJoin = async () => {
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

    await sendJoin()

    this.stopHandshakeRetry()
    let attempts = 0
    this.handshakeRetryTimer = setInterval(async () => {
      if (this.pc?.remoteDescription || this.pc?.connectionState === 'connected' || attempts >= 2) {
        this.stopHandshakeRetry()
        return
      }
      attempts++
      await sendJoin()
    }, 2500)
  }

  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        // Ignored
      }
    }

    this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })

    this.pc.ondatachannel = (event) => {
      if (event.channel.label === 'felo-lossless-stream') {
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

    this.pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track])
      if (this.audioElement) {
        this.audioElement.srcObject = stream
        this.audioElement
          .play()
          .then(() => {
            this.onAutoplayBlocked?.(false)
          })
          .catch((err) => {
            console.warn('[WebRTCClient] Audio auto-play prevented by browser:', err)
            this.onAutoplayBlocked?.(true)
          })
      }

      if (this.onLevelChange) {
        this.levelMonitor?.stop()
        this.levelMonitor = new AudioLevelMonitor(this.onLevelChange)
        this.levelMonitor.start(stream)
      }

      this.startStatsMonitoring()
      this.onStateChange?.('connected')
    }

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === 'connected') {
        this.onStateChange?.('connected')
      } else if (
        this.pc?.connectionState === 'disconnected' ||
        this.pc?.connectionState === 'failed' ||
        this.pc?.connectionState === 'closed'
      ) {
        this.onStateChange?.('disconnected')
      }
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer))
    const queuedCandidates = [...this.pendingCandidates]
    this.pendingCandidates = []
    for (const cand of queuedCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand))
      } catch (err) {
        console.warn('[WebRTCClient] Error adding buffered candidate:', err)
      }
    }

    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)

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
    if (!this.audioElement) return false
    try {
      await this.audioElement.play()
      this.onAutoplayBlocked?.(false)
      return true
    } catch (err) {
      console.warn('[WebRTCClient] Manual unmute/play failed:', err)
      return false
    }
  }

  setVolume(vol: number): void {
    if (this.audioElement) {
      this.audioElement.volume = Math.max(0, Math.min(1, vol))
    }
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
          if (meta.type === 'start') {
            this.clearLosslessBuffer()
            this.losslessMimeType = meta.mimeType || 'audio/flac'
            this.losslessTotalSize = meta.totalSize || 0
            this.losslessReceivedSize = 0
            this.setMutedForLossless(false)
          } else if (meta.type === 'end') {
            this.activateLosslessPlayback()
          }
        } catch {}
      } else if (event.data instanceof ArrayBuffer) {
        this.losslessChunks.push(event.data)
        this.losslessReceivedSize += event.data.byteLength
        // When received known complete stream, activate in-memory lossless stream
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
      this.onLosslessReady?.(this.losslessBlobUrl, this.losslessMimeType)
    } catch (err) {
      console.warn('[WebRTCClient] Error activating lossless buffer:', err)
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
    this.setMutedForLossless(false)
  }

  disconnect(): void {
    this.stopHandshakeRetry()
    this.clearLosslessBuffer()
    this.stopStatsMonitoring()
    this.pendingCandidates = []
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

    if (this.audioElement) {
      this.audioElement.pause()
      this.audioElement.srcObject = null
      this.audioElement = null
    }

    this.onStateChange?.('stopped')
  }
}
