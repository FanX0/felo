import { vi } from 'vitest'

export class MockMediaStreamTrack {
  kind: 'audio' | 'video'
  id: string
  label: string
  enabled: boolean = true
  muted: boolean = false
  readyState: 'live' | 'ended' = 'live'
  contentHint: string = ''
  onunmute: (() => void) | null = null
  onended: (() => void) | null = null
  private listeners: Record<string, Function[]> = {}

  constructor(kind: 'audio' | 'video' = 'audio', id = `track-${Math.random().toString(36).slice(2, 7)}`) {
    this.kind = kind
    this.id = id
    this.label = `mock-${kind}-track`
  }

  applyConstraints = vi.fn().mockResolvedValue(undefined)
  getConstraints = vi.fn().mockReturnValue({})
  getSettings = vi.fn().mockReturnValue({ channelCount: 2, sampleRate: 48000 })
  stop = vi.fn(() => {
    this.readyState = 'ended'
    this.onended?.()
    this.dispatchEvent(new Event('ended'))
  })

  addEventListener = vi.fn((event: string, fn: Function) => {
    if (!this.listeners[event]) this.listeners[event] = []
    this.listeners[event].push(fn)
  })

  removeEventListener = vi.fn((event: string, fn: Function) => {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== fn)
    }
  })

  dispatchEvent = vi.fn((event: Event) => {
    const list = this.listeners[event.type] || []
    list.forEach((fn) => fn(event))
    return true
  })
}

export class MockMediaStream {
  id: string
  private tracks: MockMediaStreamTrack[] = []

  constructor(tracks?: MockMediaStreamTrack[]) {
    this.id = `stream-${Math.random().toString(36).slice(2, 7)}`
    if (tracks) {
      this.tracks = [...tracks]
    }
  }

  getAudioTracks = vi.fn(() => this.tracks.filter((t) => t.kind === 'audio'))
  getVideoTracks = vi.fn(() => this.tracks.filter((t) => t.kind === 'video'))
  getTracks = vi.fn(() => [...this.tracks])
  addTrack = vi.fn((t: MockMediaStreamTrack) => {
    if (!this.tracks.includes(t)) this.tracks.push(t)
  })
  removeTrack = vi.fn((t: MockMediaStreamTrack) => {
    this.tracks = this.tracks.filter((track) => track !== t)
  })
}

export class MockRTCSessionDescription {
  type: RTCSdpType
  sdp: string
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type
    this.sdp = init.sdp || ''
  }
  toJSON() {
    return { type: this.type, sdp: this.sdp }
  }
}

export class MockRTCIceCandidate {
  candidate: string
  sdpMid: string | null
  sdpMLineIndex: number | null
  usernameFragment: string | null = null
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate || ''
    this.sdpMid = init.sdpMid ?? '0'
    this.sdpMLineIndex = init.sdpMLineIndex ?? 0
  }
  toJSON() {
    return {
      candidate: this.candidate,
      sdpMid: this.sdpMid,
      sdpMLineIndex: this.sdpMLineIndex,
      usernameFragment: this.usernameFragment
    }
  }
}

export class MockRTCRtpSender {
  track: MockMediaStreamTrack | null
  private params: RTCRtpSendParameters = {
    encodings: [{ maxBitrate: 64000 }],
    headerExtensions: [],
    codecs: [],
    transactionId: 'tx-1'
  }

  constructor(track: MockMediaStreamTrack | null = null) {
    this.track = track
  }

  getParameters = vi.fn(() => JSON.parse(JSON.stringify(this.params)))
  setParameters = vi.fn(async (params: RTCRtpSendParameters) => {
    this.params = JSON.parse(JSON.stringify(params))
  })
  replaceTrack = vi.fn(async (track: MockMediaStreamTrack | null) => {
    this.track = track
  })
}

export class MockRTCRtpReceiver {
  track: MockMediaStreamTrack
  playoutDelayHint?: number

  constructor(track: MockMediaStreamTrack) {
    this.track = track
  }
}

export class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  iceConnectionState: RTCIceConnectionState = 'new'
  localDescription: MockRTCSessionDescription | null = null
  remoteDescription: MockRTCSessionDescription | null = null

  public senders: MockRTCRtpSender[] = []
  public receivers: MockRTCRtpReceiver[] = []

  onicecandidate: ((ev: any) => any) | null = null
  ontrack: ((ev: any) => any) | null = null
  onconnectionstatechange: ((ev: any) => any) | null = null
  ondatachannel: ((ev: any) => any) | null = null

  constructor(_config?: RTCConfiguration) {}

  addTrack = vi.fn((track: MockMediaStreamTrack, _stream?: MockMediaStream) => {
    const sender = new MockRTCRtpSender(track)
    this.senders.push(sender)
    return sender
  })

  getSenders = vi.fn(() => [...this.senders])
  getReceivers = vi.fn(() => [...this.receivers])

  addTransceiver = vi.fn((trackOrKind: MockMediaStreamTrack | string, init?: RTCRtpTransceiverInit) => {
    const track = typeof trackOrKind === 'string' ? new MockMediaStreamTrack(trackOrKind as any) : trackOrKind
    const sender = new MockRTCRtpSender(track)
    const receiver = new MockRTCRtpReceiver(track)
    this.senders.push(sender)
    this.receivers.push(receiver)
    return { sender, receiver, direction: init?.direction || 'sendrecv' }
  })

  createOffer = vi.fn(async () => {
    return {
      type: 'offer' as RTCSdpType,
      sdp: [
        'v=0',
        'o=- 12345 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10',
        ''
      ].join('\r\n')
    }
  })

  createAnswer = vi.fn(async () => {
    return {
      type: 'answer' as RTCSdpType,
      sdp: [
        'v=0',
        'o=- 67890 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10',
        ''
      ].join('\r\n')
    }
  })

  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = new MockRTCSessionDescription(desc)
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable'
  })

  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.remoteDescription = new MockRTCSessionDescription(desc)
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable'
    if (this.receivers.length === 0) {
      const remoteTrack = new MockMediaStreamTrack('audio', 'remote-audio-track')
      const receiver = new MockRTCRtpReceiver(remoteTrack)
      this.receivers.push(receiver)
    }
    if (desc.type === 'offer' && this.ontrack) {
      const track = this.receivers[0].track
      const stream = new MockMediaStream([track])
      this.ontrack({
        track,
        streams: [stream],
        receiver: this.receivers[0]
      })
    }
  })

  addIceCandidate = vi.fn(async (_cand: RTCIceCandidateInit) => {})

  getStats = vi.fn(async () => {
    return new Map<string, any>([
      [
        'cand-pair',
        {
          type: 'candidate-pair',
          state: 'succeeded',
          currentRoundTripTime: 0.024
        }
      ],
      [
        'inbound-audio',
        {
          type: 'inbound-rtp',
          kind: 'audio',
          timestamp: Date.now(),
          bytesReceived: 500000,
          packetsReceived: 2500,
          packetsLost: 0
        }
      ]
    ])
  })

  createDataChannel = vi.fn((label: string) => {
    return {
      label,
      readyState: 'open',
      binaryType: 'arraybuffer',
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null
    }
  })

  close = vi.fn(() => {
    this.connectionState = 'closed'
    this.signalingState = 'closed'
  })
}

export function setupWebRTCGlobals() {
  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.RTCPeerConnection = MockRTCPeerConnection
    // @ts-ignore
    window.RTCSessionDescription = MockRTCSessionDescription
    // @ts-ignore
    window.RTCIceCandidate = MockRTCIceCandidate
    // @ts-ignore
    window.MediaStream = MockMediaStream
    // @ts-ignore
    window.MediaStreamTrack = MockMediaStreamTrack
  }
  if (typeof global !== 'undefined') {
    // @ts-ignore
    global.RTCPeerConnection = MockRTCPeerConnection
    // @ts-ignore
    global.RTCSessionDescription = MockRTCSessionDescription
    // @ts-ignore
    global.RTCIceCandidate = MockRTCIceCandidate
    // @ts-ignore
    global.MediaStream = MockMediaStream
    // @ts-ignore
    global.MediaStreamTrack = MockMediaStreamTrack
  }
  if (typeof HTMLMediaElement !== 'undefined' && !('srcObject' in HTMLMediaElement.prototype)) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      get() {
        return (this as any)._srcObject || null
      },
      set(val) {
        ;(this as any)._srcObject = val
      },
      configurable: true
    })
  }
}
