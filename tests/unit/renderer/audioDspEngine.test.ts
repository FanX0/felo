import { describe, it, expect, beforeEach } from 'vitest'
import {
  audioDspEngine,
  EQ_FREQUENCIES,
  STEREO_WIDE_FLOOR,
  VB_CURVE_LENGTH,
  EXCITER_HPF_FREQ
} from '../../../src/renderer/src/lib/audioDspEngine'

describe('Renderer Core: audioDspEngine', () => {
  beforeEach(() => {
    // Re-initialize audioDspEngine
    const dummyAudio = document.createElement('audio')
    audioDspEngine.init(dummyAudio)
  })

  it('defines 5 standard parametric equalizer frequencies', () => {
    expect(EQ_FREQUENCIES).toEqual([60, 230, 910, 3600, 14000])
  })

  it('defines studio acoustics DSP thresholds', () => {
    expect(STEREO_WIDE_FLOOR).toBe(0.5)
    expect(VB_CURVE_LENGTH).toBe(8192)
    expect(EXCITER_HPF_FREQ).toBe(4000)
  })

  it('updates speaker channel mode safely across roles', () => {
    // 0 = Center, -1 = Left, 1 = Right, 2 = Subwoofer
    expect(() => audioDspEngine.setChannelMode(0)).not.toThrow()
    expect(() => audioDspEngine.setChannelMode(-1)).not.toThrow()
    expect(() => audioDspEngine.setChannelMode(1)).not.toThrow()
    expect(() => audioDspEngine.setChannelMode(2, 120)).not.toThrow()
  })

  it('sets 5-band equalizer gains without throwing', () => {
    const eqGains = [3, -2, 0, 4, 1]
    expect(() => audioDspEngine.setEqualizer(eqGains)).not.toThrow()
  })

  it('configures synthetic convolution reverb parameters', () => {
    const reverb = {
      enabled: true,
      mix: 0.35,
      decay: 2.5,
      preDelay: 0.03,
      lowCut: 10,
      highCut: 90
    }
    expect(() => audioDspEngine.setReverb(reverb, false)).not.toThrow()
  })

  it('configures virtual acoustic effects (bass, treble exciter, surround widener)', () => {
    expect(() =>
      audioDspEngine.setVirtualEffects({
        bass: true,
        treble: true,
        surround: true,
        bassStrength: 0.8,
        stereoWidth: 1.5
      })
    ).not.toThrow()
  })

  it('retrieves frequency data from analyser node', () => {
    const freqData = audioDspEngine.getFrequencyData()
    expect(freqData).toBeInstanceOf(Uint8Array)
    expect(freqData.length).toBeGreaterThan(0)
  })
})
