import { vi } from 'vitest'

class MockAudioParam {
  value: number
  defaultValue: number
  minValue: number
  maxValue: number

  constructor(initial = 0) {
    this.value = initial
    this.defaultValue = initial
    this.minValue = -1000
    this.maxValue = 1000
  }

  setValueAtTime = vi.fn((val: number) => {
    this.value = val
    return this
  })
  linearRampToValueAtTime = vi.fn((val: number) => {
    this.value = val
    return this
  })
  exponentialRampToValueAtTime = vi.fn((val: number) => {
    this.value = val
    return this
  })
  setTargetAtTime = vi.fn((val: number) => {
    this.value = val
    return this
  })
  setValueCurveAtTime = vi.fn(() => this)
  cancelScheduledValues = vi.fn(() => this)
  cancelAndHoldAtTime = vi.fn(() => this)
}

class MockAudioNode {
  context: MockAudioContext
  numberOfInputs: number
  numberOfOutputs: number
  channelCount: number
  channelCountMode: string
  channelInterpretation: string

  constructor(context: MockAudioContext, inputs = 1, outputs = 1) {
    this.context = context
    this.numberOfInputs = inputs
    this.numberOfOutputs = outputs
    this.channelCount = 2
    this.channelCountMode = 'max'
    this.channelInterpretation = 'speakers'
  }

  connect = vi.fn((destination: any) => destination)
  disconnect = vi.fn(() => {})
}

class MockGainNode extends MockAudioNode {
  gain: MockAudioParam
  constructor(context: MockAudioContext) {
    super(context, 1, 1)
    this.gain = new MockAudioParam(1)
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  type: string = 'lowpass'
  frequency: MockAudioParam
  detune: MockAudioParam
  Q: MockAudioParam
  gain: MockAudioParam

  constructor(context: MockAudioContext) {
    super(context, 1, 1)
    this.frequency = new MockAudioParam(350)
    this.detune = new MockAudioParam(0)
    this.Q = new MockAudioParam(1)
    this.gain = new MockAudioParam(0)
  }

  getFrequencyResponse = vi.fn()
}

class MockConvolverNode extends MockAudioNode {
  buffer: any = null
  normalize: boolean = true
  constructor(context: MockAudioContext) {
    super(context, 1, 1)
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold: MockAudioParam
  knee: MockAudioParam
  ratio: MockAudioParam
  reduction: number = 0
  attack: MockAudioParam
  release: MockAudioParam

  constructor(context: MockAudioContext) {
    super(context, 1, 1)
    this.threshold = new MockAudioParam(-24)
    this.knee = new MockAudioParam(30)
    this.ratio = new MockAudioParam(12)
    this.attack = new MockAudioParam(0.003)
    this.release = new MockAudioParam(0.25)
  }
}

class MockChannelSplitterNode extends MockAudioNode {
  constructor(context: MockAudioContext, numberOfOutputs = 2) {
    super(context, 1, numberOfOutputs)
  }
}

class MockChannelMergerNode extends MockAudioNode {
  constructor(context: MockAudioContext, numberOfInputs = 2) {
    super(context, numberOfInputs, 1)
  }
}

class MockAnalyserNode extends MockAudioNode {
  fftSize: number = 2048
  frequencyBinCount: number = 1024
  minDecibels: number = -100
  maxDecibels: number = -30
  smoothingTimeConstant: number = 0.8

  constructor(context: MockAudioContext) {
    super(context, 1, 1)
  }

  getByteFrequencyData = vi.fn((array: Uint8Array) => array.fill(0))
  getByteTimeDomainData = vi.fn((array: Uint8Array) => array.fill(128))
  getFloatFrequencyData = vi.fn((array: Float32Array) => array.fill(-100))
  getFloatTimeDomainData = vi.fn((array: Float32Array) => array.fill(0))
}

class MockWaveShaperNode extends MockAudioNode {
  curve: Float32Array | null = null
  oversample: OverSampleType = 'none'

  constructor(context: MockAudioContext) {
    super(context, 1, 1)
  }
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine'
  frequency: MockAudioParam
  detune: MockAudioParam

  constructor(context: MockAudioContext) {
    super(context, 0, 1)
    this.frequency = new MockAudioParam(440)
    this.detune = new MockAudioParam(0)
  }

  start = vi.fn()
  stop = vi.fn()
}

class MockStereoPannerNode extends MockAudioNode {
  pan: MockAudioParam

  constructor(context: MockAudioContext) {
    super(context, 1, 1)
    this.pan = new MockAudioParam(0)
  }
}

export class MockAudioBuffer {
  numberOfChannels: number
  length: number
  sampleRate: number
  duration: number
  private channels: Float32Array[]

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels
    this.length = options.length
    this.sampleRate = options.sampleRate
    this.duration = options.length / options.sampleRate
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length))
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] || new Float32Array(this.length)
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset = 0) {
    const src = this.getChannelData(channelNumber)
    destination.set(src.subarray(bufferOffset, bufferOffset + destination.length))
  }

  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0) {
    const dst = this.getChannelData(channelNumber)
    dst.set(source, bufferOffset)
  }
}

export class MockAudioContext {
  state: AudioContextState = 'running'
  sampleRate: number = 44100
  currentTime: number = 0
  destination: MockAudioNode

  constructor() {
    this.destination = new MockAudioNode(this, 1, 0)
  }

  createGain = vi.fn(() => new MockGainNode(this))
  createOscillator = vi.fn(() => new MockOscillatorNode(this))
  createStereoPanner = vi.fn(() => new MockStereoPannerNode(this))
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode(this))
  createConvolver = vi.fn(() => new MockConvolverNode(this))
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode(this))
  createChannelSplitter = vi.fn((channels = 2) => new MockChannelSplitterNode(this, channels))
  createChannelMerger = vi.fn((channels = 2) => new MockChannelMergerNode(this, channels))
  createAnalyser = vi.fn(() => new MockAnalyserNode(this))
  createWaveShaper = vi.fn(() => new MockWaveShaperNode(this))
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
    return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate })
  })
  createBufferSource = vi.fn(() => {
    const node = new MockAudioNode(this, 0, 1) as any
    node.playbackRate = new MockAudioParam(1)
    node.start = vi.fn()
    node.stop = vi.fn()
    node.buffer = null
    return node
  })
  createMediaElementSource = vi.fn(() => new MockAudioNode(this, 0, 1))
  createMediaStreamSource = vi.fn((_stream?: any) => new MockAudioNode(this, 0, 1))
  createMediaStreamDestination = vi.fn(() => {
    const node = new MockAudioNode(this, 1, 0) as any
    node.stream = { getAudioTracks: () => [] }
    return node
  })
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  dispatchEvent = vi.fn()
  resume = vi.fn().mockResolvedValue(undefined)
  suspend = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
}

export function setupWebAudioGlobals() {
  if (typeof window !== 'undefined') {
    // @ts-ignore
    window.AudioContext = MockAudioContext
    // @ts-ignore
    window.webkitAudioContext = MockAudioContext
    // @ts-ignore
    window.AudioBuffer = MockAudioBuffer
  }
}
