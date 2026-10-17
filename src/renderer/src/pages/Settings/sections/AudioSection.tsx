import { useState } from 'react'
import {
  Volume2,
  Radio,
  SlidersHorizontal,
  CircleDot,
  Ban,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Activity,
  MoveHorizontal,
  ChevronLeft,
  ChevronRight,
  Music
} from 'lucide-react'
import SpatialRoomVisualizer from '../../../components/Audio/SpatialRoomVisualizer'
import { SettingsSyncSection } from '../../../components/Online/SettingsSyncSection'
import { useDspStore, type ReverbPreset, type EqPreset } from '../../../hooks/useDspStore'
import { useListeningStore } from '../../../hooks/useListeningStore'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { isUiSoundsEnabled, setUiSoundsEnabled } from '../../../lib/uiSounds'
import { Toggle } from '../components/Toggle'
import { SettingRow } from '../components/SettingRow'
import { SettingsSection } from '../components/SettingsSection'
import { McpSection } from './McpSection'
import Slider from '../../../components/Common/Slider'

export function AudioSection() {
  // Playback settings
  const crossfadeEnabled = usePlayerStore((s) => s.crossfadeEnabled)
  const setCrossfadeEnabled = usePlayerStore((s) => s.setCrossfadeEnabled)
  const crossfadeDuration = usePlayerStore((s) => s.crossfadeDuration)
  const setCrossfadeDuration = usePlayerStore((s) => s.setCrossfadeDuration)
  const [gaplessEnabled, setGaplessEnabledState] = useState(() => localStorage.getItem('felo_gapless') !== 'false')
  const setGaplessEnabled = (val: boolean) => {
    localStorage.setItem('felo_gapless', String(val))
    setGaplessEnabledState(val)
  }
  const [automixEnabled, setAutomixEnabledState] = useState(() => localStorage.getItem('felo_automix') === 'true')
  const setAutomixEnabled = (val: boolean) => {
    localStorage.setItem('felo_automix', String(val))
    setAutomixEnabledState(val)
  }
  const [normalizeVolume, setNormalizeVolumeState] = useState(() => localStorage.getItem('felo_normalize_volume') === 'true')
  const setNormalizeVolume = (val: boolean) => {
    localStorage.setItem('felo_normalize_volume', String(val))
    setNormalizeVolumeState(val)
  }
  const [uiSoundsEnabled, setUiSoundsEnabledState] = useState(() => isUiSoundsEnabled())
  const handleToggleUiSounds = (val: boolean) => {
    setUiSoundsEnabled(val)
    setUiSoundsEnabledState(val)
  }

  // Listening sync
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const myRole = useListeningStore((state) => state.myRole)
  const isHost = myRole === 'host' || Boolean(hostRoom && !joinedRoom)
  const manualSyncOffsetMs = useListeningStore((state) => state.manualSyncOffsetMs)
  const setIsManualSyncModalOpen = useListeningStore((state) => state.setIsManualSyncModalOpen)

  // DSP and Spatial Audio
  const speakerRole = useDspStore((s) => s.speakerRole)
  const setSpeakerRole = useDspStore((s) => s.setSpeakerRole)
  const subCutoff = useDspStore((s) => s.subCutoff)
  const setSubCutoff = useDspStore((s) => s.setSubCutoff)
  const reverbPreset = useDspStore((s) => s.reverbPreset)
  const setReverbPreset = useDspStore((s) => s.setReverbPreset)
  const reverbMix = useDspStore((s) => s.reverbMix)
  const reverbDecay = useDspStore((s) => s.reverbDecay)
  const reverbPreDelay = useDspStore((s) => s.reverbPreDelay)
  const reverbLowCut = useDspStore((s) => s.reverbLowCut)
  const reverbHighCut = useDspStore((s) => s.reverbHighCut)
  const setReverbParams = useDspStore((s) => s.setReverbParams)
  const eqPreset = useDspStore((s) => s.eqPreset)
  const setEqPreset = useDspStore((s) => s.setEqPreset)
  const eqGains = useDspStore((s) => s.eqGains)
  const setEqGain = useDspStore((s) => s.setEqGain)
  const resetEq = useDspStore((s) => s.resetEq)
  const virtualBass = useDspStore((s) => s.virtualBass)
  const virtualTreble = useDspStore((s) => s.virtualTreble)
  const virtualSurround = useDspStore((s) => s.virtualSurround)
  const toggleVirtualEffect = useDspStore((s) => s.toggleVirtualEffect)
  const [showReverbAdvanced, setShowReverbAdvanced] = useState(false)
  const [showEqAdvanced, setShowEqAdvanced] = useState(false)

  return (
    <SettingsSection
      icon={<Volume2 className="w-5 h-5" />}
      title="Playback & Audio"
      description="Audio engine configuration and playback behavior."
    >
      <SettingRow
        label="Gapless Playback"
        hint="Seamlessly transitions between tracks without silence gaps."
      >
        <Toggle enabled={gaplessEnabled} onChange={setGaplessEnabled} />
      </SettingRow>
      <SettingRow label="Crossfade" hint="Smoothly fade between tracks during playback.">
        <div className="flex items-center gap-3">
          {crossfadeEnabled && (
            <div className="flex items-center gap-2.5">
              <Slider
                min={1}
                max={12}
                step={1}
                value={crossfadeDuration}
                onChange={setCrossfadeDuration}
                className="w-24"
                ariaLabel="Crossfade duration"
              />
              <span className="text-xs font-mono text-text-muted w-6">{crossfadeDuration}s</span>
            </div>
          )}
          <Toggle enabled={crossfadeEnabled} onChange={setCrossfadeEnabled} />
        </div>
      </SettingRow>
      <SettingRow
        label="Automix"
        hint="Automatically queue similar tracks when your queue ends."
      >
        <Toggle enabled={automixEnabled} onChange={setAutomixEnabled} />
      </SettingRow>
      <SettingRow
        label="Normalize Volume"
        hint="Keep consistent volume levels across tracks (ReplayGain)."
      >
        <Toggle enabled={normalizeVolume} onChange={setNormalizeVolume} />
      </SettingRow>
      <SettingRow
        label="Sound Effects"
        hint="Play audio alerts for room participants, chat messages, and notifications."
      >
        <Toggle enabled={uiSoundsEnabled} onChange={handleToggleUiSounds} />
      </SettingRow>
      <SettingRow
        label="Listen Together Manual Sync"
        hint={
          isHost
            ? 'Host device acts as the reference master clock (0 ms). Manual latency calibration is only needed for joined listener devices.'
            : 'Calibrate microsecond playback latency offset to keep devices and speakers in tight alignment.'
        }
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold px-3 py-1.5 rounded-full bg-[#18191d] border border-white/[0.08] text-white">
            {isHost ? '0 ms (Host)' : manualSyncOffsetMs ? `${manualSyncOffsetMs > 0 ? `+${manualSyncOffsetMs}` : manualSyncOffsetMs} ms` : '0 ms'}
          </span>
          <button
            type="button"
            disabled={isHost}
            onClick={() => setIsManualSyncModalOpen(true)}
            title={
              isHost
                ? 'Host is the master playback reference (0 ms). Only joined guests calibrate latency.'
                : 'Calibrate playback latency offset'
            }
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              isHost
                ? 'bg-white/10 text-zinc-500 cursor-not-allowed border border-white/5 opacity-60'
                : 'bg-primary hover:bg-primary-hover text-primary-foreground active:scale-95 cursor-pointer shadow-md'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Calibrate Sync</span>
          </button>
        </div>
      </SettingRow>

      {/* ─── SETTINGS SYNC (VOLUME & AUDIO EFFECTS) ─── */}
      <div className="pt-2">
        <SettingsSyncSection />
      </div>

      {/* ─── AUDIO DSP & ACOUSTIC SUITE (MUSIXQUARE-INSPIRED PERSONAL AUDIO) ─── */}
      <div className="mt-6 space-y-6">
        {/* 1. Reverb Section */}
        <div className="rounded-2xl border border-border/20 bg-surface-elevated/40 p-5 backdrop-blur-sm space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-base font-bold text-white tracking-tight">Reverb</h4>
              <p className="text-xs text-text-muted mt-0.5">
                Adjust the sound&apos;s reverb and resonance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowReverbAdvanced(!showReverbAdvanced)}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                showReverbAdvanced || reverbPreset === 'advanced'
                  ? 'bg-primary text-primary-foreground font-semibold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
              title="Fine-tune Reverb parameters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          {/* 2x2 Reverb Grid */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            {(['studio', 'arena', 'advanced', 'off'] as const).map((preset) => {
              const isActive = reverbPreset === preset
              const label = preset.charAt(0).toUpperCase() + preset.slice(1)
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setReverbPreset(preset as ReverbPreset)
                    if (preset === 'advanced') setShowReverbAdvanced(true)
                  }}
                  className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                      : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
                  }`}
                >
                  {preset === 'studio' && <CircleDot className="w-5 h-5" />}
                  {preset === 'arena' && <Radio className="w-5 h-5" />}
                  {preset === 'advanced' && <SlidersHorizontal className="w-5 h-5" />}
                  {preset === 'off' && <Ban className="w-5 h-5" />}
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              )
            })}
          </div>

          {/* Advanced Reverb Sliders */}
          {(showReverbAdvanced || reverbPreset === 'advanced') && (
            <div className="mt-3 p-4 rounded-xl bg-white/5 border border-white/5 space-y-3 text-xs animate-in fade-in duration-200">
              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Reverb Mix</span>
                  <span className="font-mono text-white">{Math.round(reverbMix * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={reverbMix}
                  onChange={(e) => setReverbParams({ mix: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Decay Time</span>
                  <span className="font-mono text-white">{reverbDecay.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="8"
                  step="0.1"
                  value={reverbDecay}
                  onChange={(e) => setReverbParams({ decay: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Pre-Delay</span>
                  <span className="font-mono text-white">{Math.round(reverbPreDelay * 1000)}ms</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.1"
                  step="0.005"
                  value={reverbPreDelay}
                  onChange={(e) => setReverbParams({ preDelay: parseFloat(e.target.value) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>Low-Cut Filter</span>
                  <span className="font-mono text-white">{reverbLowCut}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={reverbLowCut}
                  onChange={(e) => setReverbParams({ lowCut: parseInt(e.target.value, 10) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-zinc-400">
                  <span>High-Cut Filter</span>
                  <span className="font-mono text-white">{reverbHighCut}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={reverbHighCut}
                  onChange={(e) => setReverbParams({ highCut: parseInt(e.target.value, 10) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 2. Equalizer Section */}
        <div className="rounded-2xl border border-border/20 bg-surface-elevated/40 p-5 backdrop-blur-sm space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="text-base font-bold text-white tracking-tight">Equalizer</h4>
              <p className="text-xs text-text-muted mt-0.5">
                Adjust the tone of the sound. Use it together with the volume control.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={resetEq}
                className="p-1.5 rounded-lg border border-white/10 bg-white/5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Reset Equalizer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowEqAdvanced(!showEqAdvanced)}
                className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                  showEqAdvanced || eqPreset === 'advanced'
                    ? 'bg-primary text-primary-foreground font-semibold border-transparent shadow-sm'
                    : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
                }`}
                title="Toggle 5-Band EQ Sliders"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 2x2 Equalizer Grid */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            {(['bright', 'warm', 'advanced', 'off'] as const).map((preset) => {
              const isActive = eqPreset === preset
              const label = preset.charAt(0).toUpperCase() + preset.slice(1)
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setEqPreset(preset as EqPreset)
                    if (preset === 'advanced') setShowEqAdvanced(true)
                  }}
                  className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                      : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
                  }`}
                >
                  {preset === 'bright' && <TrendingUp className="w-5 h-5" />}
                  {preset === 'warm' && <TrendingDown className="w-5 h-5" />}
                  {preset === 'advanced' && <SlidersHorizontal className="w-5 h-5" />}
                  {preset === 'off' && <Ban className="w-5 h-5" />}
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              )
            })}
          </div>

          {/* 5-Band Vertical Equalizer Sliders */}
          {(showEqAdvanced || eqPreset === 'advanced') && (
            <div className="mt-3 p-4 rounded-xl bg-white/5 border border-white/5 space-y-2 animate-in fade-in duration-200">
              <div className="grid grid-cols-5 gap-2 text-center">
                {['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'].map((label, idx) => {
                  const gain = eqGains[idx] || 0
                  return (
                    <div key={label} className="flex flex-col items-center gap-2">
                      <span className="text-[10px] font-mono text-primary font-semibold">
                        {gain > 0 ? `+${gain}` : gain} dB
                      </span>
                      <div className="h-24 flex items-center justify-center">
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={gain}
                          onChange={(e) => setEqGain(idx, parseInt(e.target.value, 10))}
                          className="h-20 w-1 bg-white/20 rounded appearance-none cursor-pointer accent-primary"
                          style={{ writingMode: 'vertical-lr', direction: 'rtl', accentColor: 'var(--app-accent)' }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500">{label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. Virtual Effects Section */}
        <div className="rounded-2xl border border-border/20 bg-surface-elevated/40 p-5 backdrop-blur-sm space-y-3">
          <div>
            <h4 className="text-base font-bold text-white tracking-tight">Virtual effects</h4>
            <p className="text-xs text-text-muted mt-0.5">
              Apply synthesized effects to the audio. This may cause heavy distortion.
            </p>
          </div>

          {/* 2x2 Virtual Effects Grid */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => toggleVirtualEffect('bass')}
              className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                virtualBass
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <Activity className="w-5 h-5" />
              <span className="text-xs font-semibold">Bass</span>
            </button>

            <button
              type="button"
              onClick={() => toggleVirtualEffect('treble')}
              className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                virtualTreble
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <SlidersHorizontal className="w-5 h-5" />
              <span className="text-xs font-semibold">Treble</span>
            </button>

            <button
              type="button"
              onClick={() => toggleVirtualEffect('surround')}
              className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                virtualSurround
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <MoveHorizontal className="w-5 h-5" />
              <span className="text-xs font-semibold">Surround</span>
            </button>

            <button
              type="button"
              onClick={() => toggleVirtualEffect('off')}
              className={`flex flex-col items-center justify-center gap-2.5 p-5 rounded-2xl border transition-all cursor-pointer ${
                !virtualBass && !virtualTreble && !virtualSurround
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <Ban className="w-5 h-5" />
              <span className="text-xs font-semibold">Off</span>
            </button>
          </div>
        </div>

        {/* 4. Spatial Speaker Role & Wireframe Room Diagram */}
        <div className="rounded-2xl border border-border/20 bg-surface-elevated/40 p-5 backdrop-blur-sm space-y-3">
          <div>
            <h4 className="text-base font-bold text-white tracking-tight">Spatial Speaker Role</h4>
            <p className="text-xs text-text-muted mt-0.5">
              Set this device&apos;s role in a synchronized multi-device wireless surround sound setup.
            </p>
          </div>

          <div className="pt-1">
            <SpatialRoomVisualizer
              activeRole={speakerRole}
              onSelectRole={setSpeakerRole}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => setSpeakerRole('left')}
              className={`flex items-center justify-center gap-2 p-4 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                speakerRole === 'left'
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Left Speaker</span>
            </button>

            <button
              type="button"
              onClick={() => setSpeakerRole('right')}
              className={`flex items-center justify-center gap-2 p-4 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                speakerRole === 'right'
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <span>Right Speaker</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setSpeakerRole('subwoofer')}
              className={`flex items-center justify-center gap-2 p-4 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                speakerRole === 'subwoofer'
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <CircleDot className="w-4 h-4" />
              <span>Subwoofer</span>
            </button>

            <button
              type="button"
              onClick={() => setSpeakerRole('center')}
              className={`flex items-center justify-center gap-2 p-4 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                speakerRole === 'center'
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-text hover:bg-hover'
              }`}
            >
              <Music className="w-4 h-4" />
              <span>Center Speaker</span>
            </button>
          </div>

          {speakerRole === 'subwoofer' && (
            <div className="mt-3 p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-text">Subwoofer Cutoff</span>
                <span className="font-mono text-text font-bold">{subCutoff} Hz</span>
              </div>
              <Slider
                min={60}
                max={200}
                step={5}
                value={subCutoff}
                onChange={setSubCutoff}
                className="w-full h-4"
                ariaLabel="Subwoofer Cutoff"
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>60 Hz (Deep Sub)</span>
                <span>120 Hz (Balanced)</span>
                <span>200 Hz (Punchy)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI & MCP Playback Control */}
      <McpSection />

      {/* Codecs and media specs */}
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between py-2 border-t border-border/10">
          <div>
            <span className="font-semibold text-text">Local Media Protocol</span>
            <p className="text-text-muted">
              Streams local audio securely through custom sandboxed media pipeline.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-surface-elevated border border-border/60 text-text font-mono text-[11px] font-semibold">
            Active (media://)
          </span>
        </div>
        <div className="flex items-center justify-between py-2">
          <div>
            <span className="font-semibold text-text">Supported Formats</span>
            <p className="text-text-muted">MP3, FLAC, M4A, AAC, WAV, OGG, OPUS, WMA</p>
          </div>
          <span className="text-text-muted font-mono text-[11px]">8 Codecs</span>
        </div>
      </div>
    </SettingsSection>
  )
}
