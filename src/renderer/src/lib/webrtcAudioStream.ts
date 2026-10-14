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

/**
 * Modifies an SDP description to set the Opus codec parameters for studio music quality:
 * - Full stereo (stereo=1, sprop-stereo=1)
 * - 320 kbps constant bitrate (maxaveragebitrate=320000, cbr=1)
 * - In-band Forward Error Correction (useinbandfec=1)
 */
export function enhanceOpusSdp(sdp: string, bitrateBps = 320000): string {
  try {
    const match = /a=rtpmap:(\d+)\s+opus\/48000\/2/i.exec(sdp)
    if (!match) return sdp
    const pt = match[1]

    const fmtpRegex = new RegExp(`^a=fmtp:${pt}\\s+(.*)$`, 'm')
    const fmtpMatch = fmtpRegex.exec(sdp)

    let customParams = 'stereo=1;sprop-stereo=1;useinbandfec=1'
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
  } catch (displayErr) {
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
      }
    } catch (fallbackErr) {
      console.warn('[WebRTC] getUserMedia desktop fallback also failed:', fallbackErr)
    }
  }

  if (!rawStream) {
    throw new Error('Device audio capture was cancelled or could not be initialized.')
  }

  const audioTracks = rawStream.getAudioTracks()
  if (audioTracks.length === 0) {
    rawStream.getTracks().forEach((t) => t.stop())
    throw new Error('No system audio track was captured. Please ensure "Share audio" is checked in the system dialog.')
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

      const updateLevel = (): void => {
        if (!this.analyser) return
        this.analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i]
        }
        const average = sum / bufferLength
        const percentage = Math.min(100, Math.round((average / 128) * 100))
        this.callback(percentage)
        this.rafId = requestAnimationFrame(updateLevel)
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
export class WebRTCAudioHost {
  private roomCode: string
  private userId: string
  private rawStream: MediaStream | null = null
  private audioTrack: MediaStreamTrack | null = null
  private audioOnlyStream: MediaStream | null = null
  private peers = new Map<string, RTCPeerConnection>()
  private channel: RealtimeChannel | null = null
  private levelMonitor: AudioLevelMonitor | null = null

  public onLevelChange?: (level: number) => void
  public onPeerCountChange?: (count: number) => void
  public onError?: (err: Error) => void
  public onEnded?: () => void

  constructor(roomCode: string, userId: string) {
    this.roomCode = roomCode
    this.userId = userId
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
        metadata: { bitrate: 320000 }
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
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.removePeer(peerId)
      }
    }

    // Add audio track to peer connection
    pc.addTrack(this.audioTrack, this.audioOnlyStream)

    // Create offer
    const offer = await pc.createOffer()
    // Enhance SDP for 320kbps fullband stereo Opus
    if (offer.sdp) {
      offer.sdp = enhanceOpusSdp(offer.sdp, 320000)
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
    }
  }

  private async handlePeerCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(peerId)
    if (!pc) return

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn(`[WebRTCHost] Error adding candidate for ${peerId}:`, err)
    }
  }

  private removePeer(peerId: string): void {
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
  }
}

/**
 * Listener client for receiving host's WebRTC device audio stream.
 * Plays incoming audio through an ephemeral HTML5 MediaStream in RAM (Mode A compliant).
 */
export class WebRTCAudioClient {
  private roomCode: string
  private userId: string
  private hostId: string
  private pc: RTCPeerConnection | null = null
  private channel: RealtimeChannel | null = null
  private audioElement: HTMLAudioElement | null = null
  private levelMonitor: AudioLevelMonitor | null = null

  public onLevelChange?: (level: number) => void
  public onStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'stopped') => void
  public onError?: (err: Error) => void

  constructor(roomCode: string, userId: string, hostId: string) {
    this.roomCode = roomCode
    this.userId = userId
    this.hostId = hostId
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
          await this.handleOffer(msg.offer)
        } else if (msg.type === 'ice-candidate' && msg.targetId === this.userId && msg.candidate && msg.senderId === this.hostId) {
          if (this.pc) {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
          }
        } else if (msg.type === 'stream-stopped' && msg.senderId === this.hostId) {
          this.disconnect()
          this.onStateChange?.('stopped')
        }
      } catch (err) {
        console.warn('[WebRTCClient] Error handling signal:', err)
      }
    })

    await this.channel.subscribe()

    // Announce to host that we want to join the device audio stream
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
    if (this.pc) {
      try {
        this.pc.close()
      } catch {
        // Ignored
      }
    }

    this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS })

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
        this.audioElement.play().catch((err) => {
          console.warn('[WebRTCClient] Audio auto-play prevented:', err)
        })
      }

      if (this.onLevelChange) {
        this.levelMonitor?.stop()
        this.levelMonitor = new AudioLevelMonitor(this.onLevelChange)
        this.levelMonitor.start(stream)
      }

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

  setVolume(vol: number): void {
    if (this.audioElement) {
      this.audioElement.volume = Math.max(0, Math.min(1, vol))
    }
  }

  disconnect(): void {
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
