import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { audioDspEngine, type ChannelMode } from '../lib/audioDspEngine'

export type SpeakerRole = 'center' | 'left' | 'right' | 'subwoofer'

export type EqPreset = 'off' | 'bright' | 'warm' | 'advanced'
export type ReverbPreset = 'off' | 'studio' | 'arena' | 'advanced'

export const EQ_PRESET_VALUES: Record<Exclude<EqPreset, 'advanced'>, [number, number, number, number, number]> = {
  off: [0, 0, 0, 0, 0],
  bright: [0, -2, 0, 4, 6],
  warm: [5, 3, 0, -2, -3]
}

export const REVERB_PRESET_VALUES: Record<
  Exclude<ReverbPreset, 'advanced'>,
  { mix: number; decay: number; preDelay: number; lowCut: number; highCut: number }
> = {
  off: { mix: 0, decay: 1.0, preDelay: 0.02, lowCut: 0, highCut: 0 },
  studio: { mix: 0.4, decay: 1.0, preDelay: 0.02, lowCut: 0, highCut: 0 },
  arena: { mix: 0.5, decay: 5.0, preDelay: 0.12, lowCut: 0, highCut: 40 }
}

type DspSyncBroadcaster = () => void
let _dspSyncBroadcaster: DspSyncBroadcaster | null = null

export function registerDspSyncBroadcaster(fn: DspSyncBroadcaster): void {
  _dspSyncBroadcaster = fn
}

function notifyDspSync(): void {
  _dspSyncBroadcaster?.()
}

export function detectEqPreset(gains: [number, number, number, number, number]): EqPreset {
  if (gains.every((v) => v === 0)) return 'off'
  for (const [name, preset] of Object.entries(EQ_PRESET_VALUES)) {
    if (name === 'off') continue
    if (preset.every((val, idx) => gains[idx] === val)) return name as EqPreset
  }
  return 'advanced'
}

export function detectReverbPreset(r: {
  mix: number
  decay: number
  preDelay: number
  lowCut: number
  highCut: number
}): ReverbPreset {
  const nearEq = (a: number, b: number) => Math.abs(a - b) < 0.01
  if (nearEq(r.mix, 0) && nearEq(r.lowCut, 0) && nearEq(r.highCut, 0)) return 'off'

  for (const [name, p] of Object.entries(REVERB_PRESET_VALUES)) {
    if (name === 'off') continue
    if (
      nearEq(r.mix, p.mix) &&
      nearEq(r.decay, p.decay) &&
      nearEq(r.preDelay, p.preDelay) &&
      nearEq(r.lowCut, p.lowCut) &&
      nearEq(r.highCut, p.highCut)
    ) {
      return name as ReverbPreset
    }
  }
  return 'advanced'
}

export interface DspRoomSnapshot {
  eqGains: [number, number, number, number, number]
  eqPreset: EqPreset
  reverb: {
    enabled: boolean
    preset: ReverbPreset
    mix: number
    decay: number
    preDelay: number
    lowCut: number
    highCut: number
  }
  virtualBass: boolean
  virtualTreble: boolean
  virtualSurround: boolean
  bassBoost: number
  userPreampGain?: number
}

export interface DspState {
  // Settings Sync (Room synchronization across mesh devices)
  settingsSync: boolean
  setSettingsSync: (sync: boolean) => void
  getRoomDspSnapshot: () => DspRoomSnapshot
  applyRoomDspSnapshot: (snapshot: Partial<DspRoomSnapshot>) => void

  // Speaker Role
  speakerRole: SpeakerRole
  setSpeakerRole: (role: SpeakerRole) => void
  subCutoff: number // 60 to 200 Hz
  setSubCutoff: (freq: number) => void

  // 7.1 / 5.1 Surround Routing (from MUSIXQUARE)
  isSurroundMode: boolean
  surroundChannelIndex: number
  setSurroundMode: (enabled: boolean) => void
  setSurroundChannel: (index: number) => void

  // Equalizer
  eqPreset: EqPreset
  eqGains: [number, number, number, number, number] // 60Hz, 230Hz, 910Hz, 3.6kHz, 14kHz
  setEqGain: (bandIndex: number, gainDb: number) => void
  setEqPreset: (preset: EqPreset) => void
  resetEq: () => void

  // Reverb
  reverbEnabled: boolean
  reverbPreset: ReverbPreset
  reverbMix: number // 0.0 to 1.0
  reverbDecay: number // 0.1 to 10s
  reverbPreDelay: number // 0 to 0.1s
  reverbLowCut: number // 0 to 100
  reverbHighCut: number // 0 to 100
  setReverbEnabled: (enabled: boolean) => void
  setReverbPreset: (preset: ReverbPreset) => void
  setReverbMix: (mix: number) => void
  setReverbParams: (params: Partial<{ mix: number; decay: number; preDelay: number; lowCut: number; highCut: number }>) => void

  // Virtual Effects
  virtualBass: boolean
  virtualTreble: boolean
  virtualSurround: boolean
  bassBoost: number // 0 to 10 (convenience slider)
  userPreampGain: number // 0.0 to 2.0 (headroom gain, default 1.0)
  setUserPreampGain: (gain: number) => void
  setBassBoost: (boost: number) => void
  toggleVirtualEffect: (effect: 'bass' | 'treble' | 'surround' | 'off') => void

  // Navigation & UI
  activeStudioTab: 'general' | 'audio' | 'connect' | 'help' | 'lyrics'
  setActiveStudioTab: (tab: 'general' | 'audio' | 'connect' | 'help' | 'lyrics') => void
  visualizerMode: 'orb' | 'artwork' | 'spectrum'
  setVisualizerMode: (mode: 'orb' | 'artwork' | 'spectrum') => void
  isAudioModalOpen: boolean
  setIsAudioModalOpen: (open: boolean) => void
}

function roleToChannelMode(role: SpeakerRole): ChannelMode {
  switch (role) {
    case 'left':
      return -1
    case 'right':
      return 1
    case 'subwoofer':
      return 2
    case 'center':
    default:
      return 0
  }
}

export const useDspStore = create<DspState>()(
  persist(
    (set, get) => ({
      settingsSync: true,
      setSettingsSync: (sync) => set({ settingsSync: sync }),

      getRoomDspSnapshot: () => ({
        eqGains: get().eqGains,
        eqPreset: get().eqPreset,
        reverb: {
          enabled: get().reverbEnabled,
          preset: get().reverbPreset,
          mix: get().reverbMix,
          decay: get().reverbDecay,
          preDelay: get().reverbPreDelay,
          lowCut: get().reverbLowCut,
          highCut: get().reverbHighCut
        },
        virtualBass: get().virtualBass,
        virtualTreble: get().virtualTreble,
        virtualSurround: get().virtualSurround,
        bassBoost: get().bassBoost,
        userPreampGain: get().userPreampGain
      }),

      applyRoomDspSnapshot: (snapshot) => {
        if (!get().settingsSync) return
        const updates: Partial<DspState> = {}

        if (snapshot.userPreampGain !== undefined) {
          updates.userPreampGain = snapshot.userPreampGain
          audioDspEngine.setUserPreampGain(snapshot.userPreampGain)
        }

        if (snapshot.eqGains) {
          updates.eqGains = snapshot.eqGains
          audioDspEngine.setEqualizer(snapshot.eqGains)
        }
        if (snapshot.eqPreset) {
          updates.eqPreset = snapshot.eqPreset
        }

        if (snapshot.reverb) {
          const r = snapshot.reverb
          if (r.enabled !== undefined) updates.reverbEnabled = r.enabled
          if (r.preset !== undefined) updates.reverbPreset = r.preset
          if (r.mix !== undefined) updates.reverbMix = r.mix
          if (r.decay !== undefined) updates.reverbDecay = r.decay
          if (r.preDelay !== undefined) updates.reverbPreDelay = r.preDelay
          if (r.lowCut !== undefined) updates.reverbLowCut = r.lowCut
          if (r.highCut !== undefined) updates.reverbHighCut = r.highCut

          audioDspEngine.setReverb({
            enabled: r.enabled ?? get().reverbEnabled,
            mix: r.mix ?? get().reverbMix,
            decay: r.decay ?? get().reverbDecay,
            preDelay: r.preDelay ?? get().reverbPreDelay,
            lowCut: r.lowCut ?? get().reverbLowCut,
            highCut: r.highCut ?? get().reverbHighCut
          })
        }

        let vb = get().virtualBass
        let vt = get().virtualTreble
        let vs = get().virtualSurround
        let bb = get().bassBoost
        let vChanged = false

        if (snapshot.virtualBass !== undefined) {
          vb = snapshot.virtualBass
          updates.virtualBass = vb
          vChanged = true
        }
        if (snapshot.virtualTreble !== undefined) {
          vt = snapshot.virtualTreble
          updates.virtualTreble = vt
          vChanged = true
        }
        if (snapshot.virtualSurround !== undefined) {
          vs = snapshot.virtualSurround
          updates.virtualSurround = vs
          vChanged = true
        }
        if (snapshot.bassBoost !== undefined) {
          bb = snapshot.bassBoost
          updates.bassBoost = bb
          vChanged = true
        }

        if (vChanged) {
          audioDspEngine.setVirtualEffects({
            bass: vb,
            treble: vt,
            surround: vs,
            bassStrength: vb ? (bb > 0 ? bb / 10 : 0.6) : 0
          })
        }

        set(updates)
      },

      speakerRole: 'center',
      setSpeakerRole: (role) => {
        set({ speakerRole: role })
        const mode = roleToChannelMode(role)
        audioDspEngine.setChannelMode(mode, get().subCutoff)
      },

      subCutoff: 120,
      setSubCutoff: (freq) => {
        const clamped = Math.max(60, Math.min(200, freq))
        set({ subCutoff: clamped })
        audioDspEngine.setSubCutoff(clamped)
      },

      isSurroundMode: false,
      surroundChannelIndex: 2,
      setSurroundMode: (enabled) => {
        set({ isSurroundMode: enabled })
        audioDspEngine.toggleSurroundMode(enabled)
      },
      setSurroundChannel: (index) => {
        set({ surroundChannelIndex: index, isSurroundMode: true })
        audioDspEngine.setSurroundChannel(index)
      },

      eqPreset: 'off',
      eqGains: [0, 0, 0, 0, 0],
      setEqGain: (bandIndex, gainDb) => {
        const clamped = Math.max(-12, Math.min(12, gainDb))
        const next = [...get().eqGains] as [number, number, number, number, number]
        next[bandIndex] = clamped
        const detected = detectEqPreset(next)
        set({ eqGains: next, eqPreset: detected })
        audioDspEngine.setEqualizer(next)
        notifyDspSync()
      },
      setEqPreset: (preset) => {
        if (preset === 'advanced') {
          set({ eqPreset: 'advanced' })
          notifyDspSync()
          return
        }
        const values = EQ_PRESET_VALUES[preset]
        set({ eqPreset: preset, eqGains: values })
        audioDspEngine.setEqualizer(values)
        notifyDspSync()
      },
      resetEq: () => {
        const flat: [number, number, number, number, number] = [0, 0, 0, 0, 0]
        set({ eqPreset: 'off', eqGains: flat, userPreampGain: 1.0 })
        audioDspEngine.setEqualizer(flat)
        audioDspEngine.setUserPreampGain(1.0)
        notifyDspSync()
      },

      reverbEnabled: false,
      reverbPreset: 'off',
      reverbMix: 0.4,
      reverbDecay: 1.0,
      reverbPreDelay: 0.02,
      reverbLowCut: 0,
      reverbHighCut: 0,
      setReverbEnabled: (enabled) => {
        const nextPreset = enabled
          ? get().reverbPreset === 'off'
            ? 'studio'
            : get().reverbPreset
          : 'off'
        set({ reverbEnabled: enabled, reverbPreset: nextPreset })
        audioDspEngine.setReverb({
          enabled,
          mix: get().reverbMix,
          decay: get().reverbDecay,
          preDelay: get().reverbPreDelay,
          lowCut: get().reverbLowCut,
          highCut: get().reverbHighCut
        })
        notifyDspSync()
      },
      setReverbPreset: (preset) => {
        if (preset === 'off') {
          set({ reverbPreset: 'off', reverbEnabled: false })
          audioDspEngine.setReverb({
            enabled: false,
            mix: 0,
            decay: get().reverbDecay,
            preDelay: get().reverbPreDelay,
            lowCut: get().reverbLowCut,
            highCut: get().reverbHighCut
          })
          notifyDspSync()
          return
        }
        if (preset === 'advanced') {
          set({ reverbPreset: 'advanced', reverbEnabled: true })
          audioDspEngine.setReverb({
            enabled: true,
            mix: get().reverbMix,
            decay: get().reverbDecay,
            preDelay: get().reverbPreDelay,
            lowCut: get().reverbLowCut,
            highCut: get().reverbHighCut
          })
          notifyDspSync()
          return
        }
        const vals = REVERB_PRESET_VALUES[preset]
        set({
          reverbPreset: preset,
          reverbEnabled: true,
          reverbMix: vals.mix,
          reverbDecay: vals.decay,
          reverbPreDelay: vals.preDelay,
          reverbLowCut: vals.lowCut,
          reverbHighCut: vals.highCut
        })
        audioDspEngine.setReverb({
          enabled: true,
          mix: vals.mix,
          decay: vals.decay,
          preDelay: vals.preDelay,
          lowCut: vals.lowCut,
          highCut: vals.highCut
        })
        notifyDspSync()
      },
      setReverbMix: (mix) => {
        const clamped = Math.max(0, Math.min(1, mix))
        const cur = get()
        const detected = detectReverbPreset({
          mix: clamped,
          decay: cur.reverbDecay,
          preDelay: cur.reverbPreDelay,
          lowCut: cur.reverbLowCut,
          highCut: cur.reverbHighCut
        })
        set({ reverbMix: clamped, reverbEnabled: clamped > 0, reverbPreset: detected })
        audioDspEngine.setReverb({
          enabled: clamped > 0,
          mix: clamped,
          decay: cur.reverbDecay,
          preDelay: cur.reverbPreDelay,
          lowCut: cur.reverbLowCut,
          highCut: cur.reverbHighCut
        })
        notifyDspSync()
      },
      setReverbParams: (params) => {
        const cur = get()
        const merged = {
          mix: params.mix ?? cur.reverbMix,
          decay: params.decay ?? cur.reverbDecay,
          preDelay: params.preDelay ?? cur.reverbPreDelay,
          lowCut: params.lowCut ?? cur.reverbLowCut,
          highCut: params.highCut ?? cur.reverbHighCut
        }
        const detected = detectReverbPreset(merged)
        const isEnabled = merged.mix > 0 || merged.lowCut > 0 || merged.highCut > 0
        set({
          reverbMix: merged.mix,
          reverbDecay: merged.decay,
          reverbPreDelay: merged.preDelay,
          reverbLowCut: merged.lowCut,
          reverbHighCut: merged.highCut,
          reverbPreset: detected,
          reverbEnabled: isEnabled
        })
        const updated = get()
        audioDspEngine.setReverb(
          {
            enabled: updated.reverbEnabled,
            mix: updated.reverbMix,
            decay: updated.reverbDecay,
            preDelay: updated.reverbPreDelay,
            lowCut: updated.reverbLowCut,
            highCut: updated.reverbHighCut
          },
          true
        )
        notifyDspSync()
      },

      virtualBass: false,
      virtualTreble: false,
      virtualSurround: false,
      bassBoost: 0,
      setBassBoost: (boost) => {
        const clamped = Math.max(0, Math.min(10, boost))
        set({ bassBoost: clamped, virtualBass: clamped > 0 })
        audioDspEngine.setVirtualEffects({
          bass: clamped > 0,
          treble: get().virtualTreble,
          surround: get().virtualSurround,
          bassStrength: clamped > 0 ? clamped / 10 : 0
        })
        notifyDspSync()
      },
      toggleVirtualEffect: (effect) => {
        if (effect === 'off') {
          set({
            virtualBass: false,
            virtualTreble: false,
            virtualSurround: false,
            bassBoost: 0
          })
          audioDspEngine.setVirtualEffects({
            bass: false,
            treble: false,
            surround: false,
            bassStrength: 0
          })
          notifyDspSync()
          return
        }

        const current = get()
        let nextBass = current.virtualBass
        let nextTreble = current.virtualTreble
        let nextSurround = current.virtualSurround

        if (effect === 'bass') nextBass = !nextBass
        if (effect === 'treble') nextTreble = !nextTreble
        if (effect === 'surround') nextSurround = !nextSurround

        const nextBassBoost = nextBass ? (current.bassBoost > 0 ? current.bassBoost : 6) : 0

        set({
          virtualBass: nextBass,
          virtualTreble: nextTreble,
          virtualSurround: nextSurround,
          bassBoost: nextBassBoost
        })

        audioDspEngine.setVirtualEffects({
          bass: nextBass,
          treble: nextTreble,
          surround: nextSurround,
          bassStrength: nextBass ? nextBassBoost / 10 : 0
        })
        notifyDspSync()
      },

      userPreampGain: 1.0,
      setUserPreampGain: (gain) => {
        const clamped = Math.max(0.0, Math.min(2.0, gain))
        set({ userPreampGain: clamped })
        audioDspEngine.setUserPreampGain(clamped)
        notifyDspSync()
      },

      activeStudioTab: 'audio',
      setActiveStudioTab: (tab) => set({ activeStudioTab: tab }),
      visualizerMode: 'orb',
      setVisualizerMode: (mode) => set({ visualizerMode: mode }),

      isAudioModalOpen: false,
      setIsAudioModalOpen: (open) => set({ isAudioModalOpen: open })
    }),
    {
      name: 'felo-dsp-settings',
      partialize: (state) => ({
        settingsSync: state.settingsSync,
        speakerRole: state.speakerRole,
        subCutoff: state.subCutoff,
        eqPreset: state.eqPreset,
        eqGains: state.eqGains,
        reverbEnabled: state.reverbEnabled,
        reverbPreset: state.reverbPreset,
        reverbMix: state.reverbMix,
        reverbDecay: state.reverbDecay,
        reverbPreDelay: state.reverbPreDelay,
        lowCut: state.reverbLowCut,
        highCut: state.reverbHighCut,
        virtualBass: state.virtualBass,
        virtualTreble: state.virtualTreble,
        virtualSurround: state.virtualSurround,
        bassBoost: state.bassBoost,
        userPreampGain: state.userPreampGain,
        visualizerMode: state.visualizerMode
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        audioDspEngine.setUserPreampGain(state.userPreampGain ?? 1.0)
        audioDspEngine.setEqualizer(state.eqGains ?? [0, 0, 0, 0, 0])
        audioDspEngine.setReverb({
          enabled: state.reverbEnabled,
          mix: state.reverbMix,
          decay: state.reverbDecay,
          preDelay: state.reverbPreDelay,
          lowCut: state.reverbLowCut,
          highCut: state.reverbHighCut
        })
        audioDspEngine.setVirtualEffects({
          bass: state.virtualBass,
          treble: state.virtualTreble,
          surround: state.virtualSurround,
          bassStrength: state.virtualBass ? (state.bassBoost > 0 ? state.bassBoost / 10 : 0.6) : 0
        })
        const mode = roleToChannelMode(state.speakerRole)
        audioDspEngine.setChannelMode(mode, state.subCutoff)
      }
    }
  )
)
