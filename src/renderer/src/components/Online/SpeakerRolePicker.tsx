import { memo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Music,
  Sliders,
  Volume2
} from 'lucide-react'
import { useDspStore, type SpeakerRole } from '../../hooks/useDspStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useThemeStore } from '../../hooks/useThemeStore'
import { playUiTouchSound } from '../../lib/uiSounds'
import Slider from '../Common/Slider'

interface SpeakerRolePickerProps {
  className?: string
  compact?: boolean
  showCutoffSlider?: boolean
  title?: string
  description?: string
}

interface RoleOption {
  role: SpeakerRole
  label: string
  shortLabel: string
  icon: any
  badge: string
  hint: string
}

const ROLES: RoleOption[] = [
  {
    role: 'center',
    label: 'Center Speaker',
    shortLabel: 'Center',
    icon: Music,
    badge: 'STEREO',
    hint: 'Full stereo output. Anchors lead vocals, dialog, and full frequency response.'
  },
  {
    role: 'left',
    label: 'Left Speaker',
    shortLabel: 'Left',
    icon: ChevronLeft,
    badge: 'LEFT',
    hint: 'Left channel isolated and routed across both speakers for wide stereo imaging.'
  },
  {
    role: 'right',
    label: 'Right Speaker',
    shortLabel: 'Right',
    icon: ChevronRight,
    badge: 'RIGHT',
    hint: 'Right channel isolated and routed across both speakers for wide stereo imaging.'
  },
  {
    role: 'subwoofer',
    label: 'Subwoofer',
    shortLabel: 'Sub',
    icon: CircleDot,
    badge: 'SUB LFE',
    hint: 'Summed mono bass with low-pass filter cutoff. Maximizes deep low-frequency punch.'
  }
]

export const SpeakerRolePicker = memo(function SpeakerRolePicker({
  className = '',
  compact = false,
  showCutoffSlider = true,
  title = 'Spatial Speaker Role',
  description = 'Turn this device into an isolated Left, Right, Center, or Subwoofer speaker.'
}: SpeakerRolePickerProps) {
  const speakerRole = useDspStore((s) => s.speakerRole)
  const subCutoff = useDspStore((s) => s.subCutoff)
  const setSpeakerRole = useDspStore((s) => s.setSpeakerRole)
  const setSubCutoff = useDspStore((s) => s.setSubCutoff)
  const setMySpeakerRole = useListeningStore((s) => s.setMySpeakerRole)
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const hostRoom = useListeningStore((s) => s.hostRoom)
  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)

  const activeColor = accentEnabled && accentColor ? accentColor : '#10b981'

  const handleSelectRole = (role: SpeakerRole) => {
    playUiTouchSound()
    setSpeakerRole(role)
    if (joinedRoom?.id || hostRoom?.id) {
      void setMySpeakerRole(role, subCutoff)
    }
  }

  const handleCutoffChange = (freq: number) => {
    setSubCutoff(freq)
    if (joinedRoom?.id || hostRoom?.id) {
      void setMySpeakerRole(speakerRole, freq)
    }
  }

  if (compact) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-text-muted" />
            {title}
          </span>
          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-surface-elevated text-text-muted border border-border/60 uppercase"
          >
            {speakerRole}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {ROLES.map(({ role, shortLabel, icon: Icon }) => {
            const isSelected = speakerRole === role
            return (
              <button
                key={role}
                type="button"
                onClick={() => handleSelectRole(role)}
                className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                    : 'bg-surface-elevated border-border/60 text-text-muted hover:text-white hover:bg-hover'
                }`}
                title={shortLabel}
              >
                <Icon
                  className="w-4 h-4 mb-1"
                />
                <span className="text-[11px] truncate w-full text-center">{shortLabel}</span>
              </button>
            )
          })}
        </div>

        {showCutoffSlider && speakerRole === 'subwoofer' && (
          <div className="p-2.5 rounded-lg bg-black/40 border border-white/10 space-y-1.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-zinc-400">Sub Cutoff</span>
              <span className="font-mono font-bold text-primary" style={{ color: activeColor }}>
                {subCutoff} Hz
              </span>
            </div>
            <Slider
              min={60}
              max={200}
              step={5}
              value={subCutoff}
              onChange={handleCutoffChange}
              className="w-full h-3"
              ariaLabel="Subwoofer Cutoff"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`p-4 rounded-2xl bg-black/40 border border-white/[0.08] backdrop-blur-md space-y-3.5 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-text-muted" />
            {title}
          </h4>
          <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-surface-elevated text-text-muted border border-border/60 uppercase tracking-wider"
        >
          {speakerRole}
        </span>
      </div>

      {/* 2x2 or 4-column Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ROLES.map(({ role, label, icon: Icon, badge }) => {
          const isSelected = speakerRole === role
          return (
            <button
              key={role}
              type="button"
              onClick={() => handleSelectRole(role)}
              className={`flex flex-col items-start justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                isSelected
                  ? 'bg-primary text-primary-foreground font-bold border-transparent shadow-sm'
                  : 'bg-surface-elevated border-border/60 text-text-muted hover:text-white hover:bg-hover'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-2">
                <Icon
                  className="w-4 h-4"
                />
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                  isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-surface text-text-muted border border-border/40'
                }`}>
                  {badge}
                </span>
              </div>
              <span className="text-xs font-semibold leading-tight">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Active Role Hint */}
      <div className="p-3 rounded-xl bg-surface-elevated border border-border/60 text-xs text-text-muted flex items-start gap-2.5">
        <Sliders className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed text-text-muted">
          {ROLES.find((r) => r.role === speakerRole)?.hint}
        </p>
      </div>

      {/* Subwoofer Cutoff Slider */}
      {showCutoffSlider && speakerRole === 'subwoofer' && (
        <div className="p-3.5 rounded-xl bg-surface-elevated border border-border/60 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-text">Subwoofer Low-Pass Filter</span>
            <span className="font-mono font-bold text-text">
              {subCutoff} Hz
            </span>
          </div>
          <Slider
            min={60}
            max={200}
            step={5}
            value={subCutoff}
            onChange={handleCutoffChange}
            className="w-full h-4"
            ariaLabel="Subwoofer Low-Pass Filter"
          />
          <div className="flex justify-between text-[10px] text-text-muted font-mono">
            <span>60 Hz (Deep Sub)</span>
            <span>120 Hz (Balanced)</span>
            <span>200 Hz (Punchy Bass)</span>
          </div>
        </div>
      )}
    </div>
  )
})
