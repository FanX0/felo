import { useState, useEffect } from 'react'
import {
  Volume2,
  Sliders,
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Music,
  RotateCcw,
  Sparkles,
  MoveHorizontal,
  Ban,
  Radio,
  Smartphone,
  Speaker,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  HelpCircle,
  Info,
  Wifi,
  ShieldCheck,
  Lock,
  X
} from 'lucide-react'
import QRCode from 'qrcode'
import SettingsSyncSection from '../Online/SettingsSyncSection'
import SpatialRoomVisualizer from './SpatialRoomVisualizer'
import EmeraldVisualizer from './EmeraldVisualizer'
import {
  useDspStore,
  type SpeakerRole,
  type EqPreset,
  type ReverbPreset
} from '../../hooks/useDspStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'
import { audioDspEngine } from '../../lib/audioDspEngine'
import {
  isUiSoundsEnabled,
  setUiSoundsEnabled,
  playUiTouchSound
} from '../../lib/uiSounds'
import { useThemeStore } from '../../hooks/useThemeStore'

interface AudioSettingsPanelProps {
  onClose?: () => void
  isModal?: boolean
}

type AudioSubtab = 'general' | 'audio' | 'connect' | 'help'

export default function AudioSettingsPanel({ onClose, isModal: _isModal = false }: AudioSettingsPanelProps) {
  // Navigation
  const [activeSubtab, setActiveSubtab] = useState<AudioSubtab>('general')

  const speakerRole = useDspStore((s) => s.speakerRole)
  const setSpeakerRole = useDspStore((s) => s.setSpeakerRole)
  const subCutoff = useDspStore((s) => s.subCutoff)
  const setSubCutoff = useDspStore((s) => s.setSubCutoff)

  const eqPreset = useDspStore((s) => s.eqPreset)
  const eqGains = useDspStore((s) => s.eqGains)
  const setEqGain = useDspStore((s) => s.setEqGain)
  const setEqPreset = useDspStore((s) => s.setEqPreset)
  const resetEq = useDspStore((s) => s.resetEq)
  const userPreampGain = useDspStore((s) => s.userPreampGain)
  const setUserPreampGain = useDspStore((s) => s.setUserPreampGain)

  const reverbPreset = useDspStore((s) => s.reverbPreset)
  const reverbMix = useDspStore((s) => s.reverbMix)
  const reverbDecay = useDspStore((s) => s.reverbDecay)
  const reverbPreDelay = useDspStore((s) => s.reverbPreDelay)
  const reverbLowCut = useDspStore((s) => s.reverbLowCut)
  const reverbHighCut = useDspStore((s) => s.reverbHighCut)
  const setReverbPreset = useDspStore((s) => s.setReverbPreset)
  const setReverbParams = useDspStore((s) => s.setReverbParams)

  const virtualBass = useDspStore((s) => s.virtualBass)
  const virtualTreble = useDspStore((s) => s.virtualTreble)
  const virtualSurround = useDspStore((s) => s.virtualSurround)
  const toggleVirtualEffect = useDspStore((s) => s.toggleVirtualEffect)

  // Player Store
  const volume = usePlayerStore((s) => s.volume)
  const setVolume = usePlayerStore((s) => s.setVolume)

  // Listening Room & Devices
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const hostRoom = useListeningStore((s) => s.hostRoom)
  const myRole = useListeningStore((s) => s.myRole)
  const setMySpeakerRole = useListeningStore((s) => s.setMySpeakerRole)
  const setMemberSpeakerRole = useListeningStore((s) => s.setMemberSpeakerRole)
  const settingsSync = useDspStore((s) => s.settingsSync)
  const isGuestLocked = Boolean(joinedRoom && myRole !== 'host' && settingsSync)
  const members = useListeningStore((s) => s.members)
  const discoveredDevices = useConnectedDeviceStore((s) => s.discoveredDevices)

  // Theme Store
  const accentColor = useThemeStore((s) => s.accentColor)
  const accentEnabled = useThemeStore((s) => s.accentEnabled)

  // Local state
  const [showReverbAdvanced, setShowReverbAdvanced] = useState(false)
  const [uiSoundsActive, setUiSoundsActive] = useState<boolean>(isUiSoundsEnabled())
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  const handleSelectRole = (role: SpeakerRole) => {
    playUiTouchSound()
    setSpeakerRole(role)
    if (joinedRoom?.id || hostRoom?.id) {
      void setMySpeakerRole(role, subCutoff)
    }
  }

  const handleSubCutoffChange = (freq: number) => {
    setSubCutoff(freq)
    if (joinedRoom?.id || hostRoom?.id) {
      void setMySpeakerRole(speakerRole, freq)
    }
  }

  const preampDb = Math.round(20 * Math.log10(Math.max(0.001, userPreampGain ?? 1.0)))

  const handlePreampChange = (db: number) => {
    const linear = Math.pow(10, db / 20)
    setUserPreampGain(linear)
  }

  const handleTabChange = (tab: AudioSubtab) => {
    playUiTouchSound()
    setActiveSubtab(tab)
  }

  // Listen to external UI sound changes
  useEffect(() => {
    setUiSoundsActive(isUiSoundsEnabled())
  }, [])

  const handleToggleUiSounds = (enabled: boolean) => {
    playUiTouchSound()
    setUiSoundsEnabled(enabled)
    setUiSoundsActive(enabled)
  }

  // Generate QR Code for Connect Tab
  const roomCode = joinedRoom?.code || 'FELO-STUDIO'
  const inviteUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/join/${roomCode}`
    : `https://felo.app/join/${roomCode}`

  const qrDarkColor = accentEnabled && accentColor ? accentColor : '#ffffff'

  useEffect(() => {
    let isCurrent = true
    QRCode.toDataURL(inviteUrl, {
      width: 220,
      margin: 1.5,
      color: {
        dark: qrDarkColor,
        light: '#0b0f17'
      }
    })
      .then((url) => {
        if (isCurrent) setQrDataUrl(url)
      })
      .catch((err) => {
        console.warn('[AudioSettingsPanel] QR Generation error:', err)
      })

    return () => {
      isCurrent = false
    }
  }, [inviteUrl, qrDarkColor])

  const copyToClipboard = async (text: string, type: 'code' | 'link') => {
    playUiTouchSound()
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'code') {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      } else {
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
      }
    } catch (e) {
      console.warn('Failed to copy text:', e)
    }
  }

  const roleDescriptions: Record<SpeakerRole, { title: string; hint: string }> = {
    center: {
      title: 'This device is acting as the center speaker.',
      hint: 'Balanced stereo sound for central listening.'
    },
    left: {
      title: 'This device is acting as the left speaker.',
      hint: 'Dedicated left stereo channel for wide soundstage.'
    },
    right: {
      title: 'This device is acting as the right speaker.',
      hint: 'Dedicated right stereo channel for wide soundstage.'
    },
    subwoofer: {
      title: 'This device is acting as the dedicated subwoofer.',
      hint: 'Summed low-frequency filtered mix (60–200 Hz).'
    }
  }

  const sampleRate = audioDspEngine.getAudioContext()?.sampleRate || 48000

  return (
    <aside className="flex flex-col h-full w-full bg-canvas text-white select-none overflow-hidden rounded-xl border border-border/70 shadow-2xl no-drag">
      {/* Top Header */}
      <div className="flex h-16 items-center justify-between px-5 border-b border-border/60 shrink-0 bg-canvas">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sliders className="w-5 h-5 text-primary shrink-0" />
          <h2 className="font-bold text-white text-base truncate">Felo Audio Studio</h2>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={() => {
              playUiTouchSound()
              onClose()
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer active:scale-95"
            title="Close audio studio"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 4 Authentic MUSIXQUARE Subtabs: General, Audio, Connect, Help */}
      <div className="flex items-center border-b border-border/60 px-3 text-xs font-medium shrink-0 bg-canvas">
        {(
          [
            { id: 'general', label: 'General', icon: Activity },
            { id: 'audio', label: 'Audio', icon: Sliders },
            { id: 'connect', label: 'Connect', icon: Wifi },
            { id: 'help', label: 'Help', icon: HelpCircle }
          ] as const
        ).map(({ id, label, icon: TabIcon }) => {
          const isActive = activeSubtab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleTabChange(id)}
              className={`flex items-center gap-1.5 px-4 py-3 relative border-b-2 transition-all cursor-pointer ${
                isActive
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <TabIcon className="w-3.5 h-3.5" />
              <span>{label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary shadow-sm" />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
        {/* ─── 1. GENERAL TAB: Spectrum, Master Gain, UI Sounds, Settings Sync, Telemetry ─── */}
        {activeSubtab === 'general' && (
          <div className="space-y-5 text-xs text-zinc-300">
            {/* Live Audio Spectrum Visualizer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-primary" />
                  Live Audio Spectrum
                </span>
                <span className="text-[11px] text-zinc-400">Click canvas to toggle circular pulse</span>
              </div>
              <EmeraldVisualizer
                className="w-full h-40"
                defaultMode="spectrum"
                interactive={true}
                showModePill={true}
              />
            </div>

            {/* Master DSP Gain Staging */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 font-semibold text-text">
                  <Volume2 className="w-4 h-4 text-primary" />
                  <span>Master DSP Gain</span>
                </div>
                <span className="font-mono text-primary font-bold text-sm">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                style={{ accentColor: 'var(--app-accent)' }}
              />
            </div>

            {/* Interface Sound Effects Configuration */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-3">
              <div className="space-y-0.5">
                <span className="font-semibold text-text text-sm">Interface Sound Effects</span>
                <p className="text-text-muted text-xs">
                  Tactile pitchless micro-transient audio feedback on clicks, toggles, and switches.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleToggleUiSounds(true)}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center ${
                    uiSoundsActive
                      ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                      : 'bg-surface border-border/60 text-text-muted hover:text-white hover:bg-hover'
                  }`}
                >
                  On
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleUiSounds(false)}
                  className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center ${
                    !uiSoundsActive
                      ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                      : 'bg-surface border-border/60 text-text-muted hover:text-white hover:bg-hover'
                  }`}
                >
                  Off
                </button>
              </div>
            </div>

            {/* Room Settings Sync Configuration (MUSIXQUARE Parity) */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60">
              <SettingsSyncSection />
            </div>

            {/* Hardware DSP Telemetry */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-text text-sm">DSP Hardware Telemetry</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-sm">
                  ACTIVE
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded-lg bg-surface border border-border/60">
                  <span className="text-text-muted block text-[10px]">Sample Rate</span>
                  <span className="text-text font-semibold">{(sampleRate / 1000).toFixed(1)} kHz</span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface border border-border/60">
                  <span className="text-text-muted block text-[10px]">Bit Depth</span>
                  <span className="text-text font-semibold">32-bit Float</span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface border border-border/60">
                  <span className="text-text-muted block text-[10px]">Speaker Channels</span>
                  <span className="text-text font-semibold">Stereo 2.0</span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface border border-border/60">
                  <span className="text-text-muted block text-[10px]">Clock Status</span>
                  <div className="flex items-center gap-1.5 text-text font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span>Healthy (180ms Probe)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── 2. AUDIO TAB: Speaker Roles, 3D Room, Reverb, EQ, Virtual Effects ─── */}
        {activeSubtab === 'audio' && (
          <div className="space-y-6 text-xs text-zinc-300">
            {/* 1. Spatial Speaker Role & Wireframe Room Diagram */}
            <div className="space-y-3">
              <div>
                <h4 className="text-base font-bold text-white">Spatial Speaker Role</h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Set this device&apos;s acoustic role in a synchronized multi-device wireless surround sound setup.
                </p>
              </div>

              {/* 3D Perspective Room Visualizer */}
              <div className="pt-1">
                <SpatialRoomVisualizer
                  activeRole={speakerRole}
                  onSelectRole={(role) => handleSelectRole(role)}
                />
              </div>

              {/* Active Role Explanatory Card */}
              <div className="p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-xs flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{roleDescriptions[speakerRole].title}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">{roleDescriptions[speakerRole].hint}</p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-primary/20 text-primary border border-primary/30">
                  {speakerRole.toUpperCase()}
                </span>
              </div>

              {/* 2x2 Speaker Role Selector Grid */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                {/* Left */}
                <button
                  type="button"
                  onClick={() => handleSelectRole('left')}
                  className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    speakerRole === 'left'
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Left Speaker</span>
                </button>

                {/* Right */}
                <button
                  type="button"
                  onClick={() => handleSelectRole('right')}
                  className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    speakerRole === 'right'
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <span>Right Speaker</span>
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Subwoofer */}
                <button
                  type="button"
                  onClick={() => handleSelectRole('subwoofer')}
                  className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    speakerRole === 'subwoofer'
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <CircleDot className="w-4 h-4" />
                  <span>Subwoofer</span>
                </button>

                {/* Center */}
                <button
                  type="button"
                  onClick={() => handleSelectRole('center')}
                  className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                    speakerRole === 'center'
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <Music className="w-4 h-4" />
                  <span>Center Speaker</span>
                </button>
              </div>

              {/* Subwoofer Low-Pass Cutoff Slider (only visible in Subwoofer mode) */}
              {speakerRole === 'subwoofer' && (
                <div className="mt-3 p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-primary">Subwoofer Low-Pass Cutoff</span>
                    <span className="font-mono text-primary font-bold">{subCutoff} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="200"
                    step="5"
                    value={subCutoff}
                    onChange={(e) => handleSubCutoffChange(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ accentColor: 'var(--app-accent)' }}
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>60 Hz (Deep Sub)</span>
                    <span>120 Hz (Balanced)</span>
                    <span>200 Hz (Punchy)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Host-Controlled Room Settings Lock Notice (from MUSIXQUARE _isGuestLocked) */}
            {isGuestLocked && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs animate-fade-in">
                <Lock className="w-4 h-4 shrink-0 text-amber-400" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold block">Room Settings Synchronized</span>
                  <span className="text-[11px] text-amber-300/80">
                    Reverb, Equalizer, and Virtual Bass are locked and dynamically governed by the room host.
                  </span>
                </div>
              </div>
            )}

            {/* 2. Reverb Presets & Advanced Sliders */}
            <div className={`pt-5 border-t border-white/[0.08] space-y-3 ${isGuestLocked ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-white">Reverb</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Synthetic convolution reverb with air-damping impulse response modeling.
                  </p>
                </div>
                {reverbPreset !== 'off' && (
                  <button
                    type="button"
                    onClick={() => {
                      playUiTouchSound()
                      setShowReverbAdvanced(!showReverbAdvanced)
                    }}
                    className={`text-[11px] px-2.5 py-0.5 rounded-lg border font-semibold transition-all cursor-pointer ${
                      showReverbAdvanced
                        ? 'bg-primary text-primary-foreground border-transparent shadow-sm'
                        : 'bg-surface-elevated border-border/60 text-text-muted hover:text-white hover:bg-hover'
                    }`}
                  >
                    {showReverbAdvanced ? 'Hide Fine-Tune' : 'Fine-Tune'}
                  </button>
                )}
              </div>

              {/* Reverb Presets: Off, Studio, Arena, Advanced */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {(['off', 'studio', 'arena', 'advanced'] as const).map((preset) => {
                  const isActive = reverbPreset === preset
                  const label = preset.charAt(0).toUpperCase() + preset.slice(1)
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        playUiTouchSound()
                        setReverbPreset(preset as ReverbPreset)
                        if (preset === 'advanced') setShowReverbAdvanced(true)
                      }}
                      className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center ${
                        isActive
                          ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                          : 'bg-surface-elevated border-border/60 text-text-muted hover:text-white hover:bg-hover'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Advanced Reverb Controls */}
              {(showReverbAdvanced || reverbPreset === 'advanced') && reverbPreset !== 'off' && (
                <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-3.5 text-xs animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>Mix</span>
                      <span className="font-mono text-primary font-semibold">{Math.round(reverbMix * 100)}%</span>
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
                      <span className="font-mono text-primary font-semibold">{reverbDecay.toFixed(1)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="10"
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
                      <span className="font-mono text-primary font-semibold">{reverbPreDelay.toFixed(2)}s</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={reverbPreDelay}
                      onChange={(e) => setReverbParams({ preDelay: parseFloat(e.target.value) })}
                      className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                      style={{ accentColor: 'var(--app-accent)' }}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>High-Pass Filter (Low Cut)</span>
                      <span className="font-mono text-primary font-semibold">{reverbLowCut}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={reverbLowCut}
                      onChange={(e) => setReverbParams({ lowCut: parseInt(e.target.value, 10) })}
                      className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                      style={{ accentColor: 'var(--app-accent)' }}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-zinc-400">
                      <span>Low-Pass Filter (High Cut)</span>
                      <span className="font-mono text-primary font-semibold">{reverbHighCut}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={reverbHighCut}
                      onChange={(e) => setReverbParams({ highCut: parseInt(e.target.value, 10) })}
                      className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                      style={{ accentColor: 'var(--app-accent)' }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 3. 5-Band Parametric Equalizer */}
            <div className={`pt-5 border-t border-white/[0.08] space-y-3 ${isGuestLocked ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-white">Equalizer</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    5-band precision frequency adjustment with zero distortion.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    playUiTouchSound()
                    resetEq()
                  }}
                  className="p-1.5 rounded-lg border border-border/60 bg-surface-elevated hover:bg-hover text-text-muted hover:text-white transition-colors cursor-pointer"
                  title="Reset EQ to flat response"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {/* EQ Preset Selector: Off, Bright, Warm, Advanced */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {(['off', 'bright', 'warm', 'advanced'] as const).map((preset) => {
                  const isActive = eqPreset === preset
                  const label = preset.charAt(0).toUpperCase() + preset.slice(1)
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        playUiTouchSound()
                        setEqPreset(preset as EqPreset)
                      }}
                      className={`py-2 px-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer text-center ${
                        isActive
                          ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                          : 'bg-surface-elevated border-border/60 text-text-muted hover:text-white hover:bg-hover'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* 5-Band Slider Array */}
              <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 pt-5 pb-3">
                <div className="grid grid-cols-5 gap-2 text-center">
                  {[
                    { label: '60Hz', sub: 'Sub' },
                    { label: '230Hz', sub: 'Bass' },
                    { label: '910Hz', sub: 'Mid' },
                    { label: '3.6k', sub: 'Presence' },
                    { label: '14k', sub: 'Air' }
                  ].map((band, idx) => {
                    const gainVal = eqGains[idx] ?? 0
                    return (
                      <div key={band.label} className="flex flex-col items-center gap-2">
                        <span className="text-[10px] font-mono text-primary font-semibold">
                          {gainVal > 0 ? `+${gainVal}` : gainVal}dB
                        </span>
                        <div className="h-24 flex items-center justify-center">
                          <input
                            type="range"
                            min="-12"
                            max="12"
                            step="1"
                            value={gainVal}
                            onChange={(e) => setEqGain(idx, parseInt(e.target.value, 10))}
                            className="h-20 w-1 bg-white/20 rounded appearance-none cursor-pointer accent-primary [writing-mode:vertical-lr] [direction:rtl]"
                            style={{ accentColor: 'var(--app-accent)' }}
                          />
                        </div>
                        <div>
                          <p className="font-mono text-[11px] font-semibold text-white">{band.label}</p>
                          <p className="text-[9px] text-zinc-500">{band.sub}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Preamp Headroom Gain Slider (-12 dB to +12 dB) */}
                <div className="mt-4 pt-3.5 border-t border-white/10 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-primary" />
                      <span className="font-semibold text-white">Preamp Headroom</span>
                      <span className="text-[10px] text-zinc-500 font-normal">(-12 dB to +12 dB)</span>
                    </div>
                    <span className="font-mono text-primary font-bold">
                      {preampDb > 0 ? `+${preampDb}` : preampDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={preampDb}
                    onChange={(e) => handlePreampChange(parseInt(e.target.value, 10))}
                    className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ accentColor: 'var(--app-accent)' }}
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                    <span>-12 dB (Cut)</span>
                    <span>0 dB (Unity)</span>
                    <span>+12 dB (Boost)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Virtual Enhancers (Bass, Treble, Surround, Off) */}
            <div className={`pt-5 border-t border-white/[0.08] space-y-3 ${isGuestLocked ? 'opacity-60 pointer-events-none select-none' : ''}`}>
              <div>
                <h4 className="text-base font-bold text-white">Virtual Enhancers</h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Psychoacoustic bass harmonic synthesis, air-band saturation, and stereo widening.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2.5 pt-1">
                {/* Bass */}
                <button
                  type="button"
                  onClick={() => {
                    playUiTouchSound()
                    toggleVirtualEffect('bass')
                  }}
                  className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    virtualBass
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <CircleDot className="w-4 h-4" />
                  <span className="text-xs font-semibold">Bass</span>
                </button>

                {/* Treble */}
                <button
                  type="button"
                  onClick={() => {
                    playUiTouchSound()
                    toggleVirtualEffect('treble')
                  }}
                  className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    virtualTreble
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="text-xs font-semibold">Treble</span>
                </button>

                {/* Surround */}
                <button
                  type="button"
                  onClick={() => {
                    playUiTouchSound()
                    toggleVirtualEffect('surround')
                  }}
                  className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    virtualSurround
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <MoveHorizontal className="w-4 h-4" />
                  <span className="text-xs font-semibold">Surround</span>
                </button>

                {/* Off */}
                <button
                  type="button"
                  onClick={() => {
                    playUiTouchSound()
                    toggleVirtualEffect('off')
                  }}
                  className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border transition-all cursor-pointer ${
                    !virtualBass && !virtualTreble && !virtualSurround
                      ? 'bg-primary/20 border-primary/60 text-primary ring-1 ring-primary/30 shadow-sm font-semibold'
                      : 'bg-[#181f2c] border-transparent text-zinc-400 hover:text-white hover:bg-[#20293a]'
                  }`}
                >
                  <Ban className="w-4 h-4" />
                  <span className="text-xs font-semibold">Off</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── 3. CONNECT TAB: QR Code, Invite Code, Mesh Peers ─── */}
        {activeSubtab === 'connect' && (
          <div className="space-y-6 text-xs text-zinc-300">
            {/* Session Invite Banner */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-black/60 border border-primary/20 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Radio className="w-4 h-4 text-primary" />
                    Synchronized Mesh Room
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Scan or share code to add auxiliary speaker nodes to this room.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-primary/20 text-primary border border-primary/30">
                  ONLINE
                </span>
              </div>

              {/* Room Code Display with Copy */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-black/50 border border-white/10">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">Session Code</span>
                  <span className="font-mono text-base font-bold text-white tracking-widest">{roomCode}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(roomCode, 'code')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 text-xs font-semibold transition-all cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>

              {/* QR Code Presentation */}
              <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-black/60 border border-white/5 space-y-2">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Session QR Code"
                    className="w-48 h-48 rounded-lg shadow-lg border border-primary/20"
                  />
                ) : (
                  <div className="w-48 h-48 rounded-lg bg-surface border border-border/60 flex items-center justify-center text-text-muted">
                    <QrCode className="w-8 h-8 animate-pulse text-primary" />
                  </div>
                )}
                <p className="text-[11px] text-zinc-400 text-center">
                  Scan with your phone&apos;s camera to instantly join this surround mesh
                </p>
              </div>

              {/* Shareable URL */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border/60 text-[11px]">
                <span className="truncate text-zinc-400 font-mono pr-2">{inviteUrl}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(inviteUrl, 'link')}
                  className="shrink-0 flex items-center gap-1 text-primary hover:text-primary-hover font-semibold cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3 h-3" /> : <ExternalLink className="w-3 h-3" />}
                  <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            {/* Mesh Connected Devices List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">Active Room Speakers</h4>
                <span className="text-[11px] text-zinc-400 font-mono">
                  {members.length > 0 ? `${members.length} Connected` : 'Single Node'}
                </span>
              </div>

              <div className="space-y-2">
                {/* Local Device */}
                <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="w-4 h-4 text-primary" />
                    <div>
                      <p className="font-semibold text-white">This Device (Local Host)</p>
                      <p className="text-[11px] text-primary font-mono">Role: {speakerRole.toUpperCase()}</p>
                    </div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-primary shadow-sm" />
                </div>

                {/* Discovered / Connected Peers */}
                {members.map((member) => (
                  <div
                    key={member.user_id}
                    className="p-3 rounded-xl bg-surface-elevated border border-border/60 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <Speaker className="w-4 h-4 text-zinc-400" />
                      <div>
                        <p className="font-medium text-white">{member.display_name || member.user_id.slice(0, 8)}</p>
                        <p className="text-[11px] text-zinc-400">
                          Room: <span className="text-zinc-300">{member.role.toUpperCase()}</span>
                          {' • '}
                          Channel: <span className="text-white font-mono font-medium">{(member.speaker_role || 'center').toUpperCase()}{member.speaker_role === 'subwoofer' ? ` (${member.sub_cutoff ?? 120}Hz)` : ''}</span>
                        </p>
                      </div>
                    </div>
                    {myRole === 'host' ? (
                      <select
                        value={member.speaker_role || 'center'}
                        onChange={(e) => {
                          playUiTouchSound()
                          void setMemberSpeakerRole(
                            member.user_id,
                            e.target.value as SpeakerRole,
                            member.sub_cutoff ?? 120
                          )
                        }}
                        className="bg-surface border border-border/60 rounded px-2 py-1 text-[11px] text-text font-mono focus:outline-none cursor-pointer hover:border-border transition-colors"
                      >
                        <option value="center" className="bg-[#181f2c] text-white">Center / Stereo</option>
                        <option value="left" className="bg-[#181f2c] text-white">Left Channel</option>
                        <option value="right" className="bg-[#181f2c] text-white">Right Channel</option>
                        <option value="subwoofer" className="bg-[#181f2c] text-white">Subwoofer (LFE)</option>
                      </select>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                ))}

                {members.length === 0 && discoveredDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="p-3 rounded-xl bg-surface-elevated border border-border/60 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      {dev.device_type === 'mobile' || dev.device_category === 'app_mobile' || dev.device_category === 'web_mobile' ? (
                        <Smartphone className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <Speaker className="w-4 h-4 text-zinc-400" />
                      )}
                      <div>
                        <p className="font-medium text-white">{dev.device_name}</p>
                        <p className="text-[11px] text-zinc-500">IP: {dev.local_ip || 'LAN'}</p>
                      </div>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── 4. HELP TAB: Acoustic Setup & Placement Instructions ─── */}
        {activeSubtab === 'help' && (
          <div className="space-y-5 text-xs text-zinc-300">
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-2">
              <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Speaker className="w-4 h-4 text-primary" />
                Acoustic Speaker Placement Guidelines
              </h4>
              <p className="text-text-muted text-xs">
                To achieve true spatial surround reproduction using multiple devices, follow these optimal room placements:
              </p>

              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-lg bg-surface border border-border/60 space-y-1">
                  <span className="font-bold text-white block text-xs">1. Left & Right Speakers</span>
                  <p className="text-[11px] text-zinc-300">
                    Place Left and Right speakers at ear level, angled inward at roughly 30° toward your listening position, forming an equilateral triangle.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-surface border border-border/60 space-y-1">
                  <span className="font-bold text-white block text-xs">2. Center Speaker</span>
                  <p className="text-[11px] text-zinc-300">
                    Position directly centered in front of the listening spot. The Center speaker anchors dialog, lead vocals, and mono imaging.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-surface border border-border/60 space-y-1">
                  <span className="font-bold text-white block text-xs">3. Subwoofer Placement</span>
                  <p className="text-[11px] text-zinc-300">
                    Place near a corner or along the front wall to maximize boundary loading and acoustic coupling for deep, resonant low frequencies. Adjust the low-pass cutoff slider between 60 Hz and 120 Hz to seamlessly cross over with your satellite speakers.
                  </p>
                </div>
              </div>
            </div>

            {/* Clock Synchronization and Latency info */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-2">
              <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Clock Synchronization & Watchdog
              </h4>
              <p className="text-text-muted text-[11px]">
                MUSIXQUARE and Felo monitor Web Audio clocks with periodic 180ms probes. If mobile WebKit freezes the audio context in the background, the engine triggers seamless touch-recovery without audio distortion or desync.
              </p>
            </div>

            {/* Room Sync Info */}
            <div className="p-4 rounded-xl bg-surface-elevated border border-border/60 space-y-2">
              <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Info className="w-4 h-4 text-primary" />
                Settings Sync Behavior
              </h4>
              <p className="text-text-muted text-[11px]">
                When <strong>Settings Synchronization</strong> is enabled, EQ adjustments, Reverb presets, and Virtual effects broadcast instantly to all connected devices in your room. Speaker roles remain strictly local so each physical speaker stays tuned to its location.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
