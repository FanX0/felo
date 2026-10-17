import React from 'react'
import { useDspStore } from '../../hooks/useDspStore'
import { playUiTouchSound } from '../../lib/uiSounds'
import { requestRoomDspSync } from '../ListeningPresenceBridge'

/**
 * MUSIXQUARE-parity SVG icon for Settings Sync ON (dual circular arrows with gear)
 */
export function SettingsSyncOnIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 -960 960 960" aria-hidden="true" className={className} fill="currentColor">
      <path d="M120-160v-80h110l-16-14q-52-46-73-105t-21-119q0-111 66.5-197.5T360-790v84q-72 26-116 88.5T200-478q0 45 17 87.5t53 78.5l10 10v-98h80v240H120Zm717-360h-81q-5-35-21.5-67T690-648l-10-10v98h-80v-240h240v80H730l16 14q41 42 63 89t28 97ZM680-40l-12-60q-12-5-22.5-10.5T624-124l-58 18-40-68 46-40q-2-14-2-26t2-26l-46-40 40-68 58 18q11-8 21.5-13.5T668-380l12-60h80l12 60q12 5 22.5 11t21.5 15l58-20 40 70-46 40q2 12 2 25t-2 25l46 40-40 68-58-18q-11 8-21.5 13.5T772-100l-12 60h-80Zm40-120q33 0 56.5-23.5T800-240q0-33-23.5-56.5T720-320q-33 0-56.5 23.5T640-240q0 33 23.5 56.5T720-160Z" />
    </svg>
  )
}

/**
 * MUSIXQUARE-parity SVG icon for Settings Sync OFF (circle with diagonal slash)
 */
export function SettingsSyncOffIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z" />
    </svg>
  )
}

interface SettingsSyncSectionProps {
  className?: string
  titleClassName?: string
  descClassName?: string
  variant?: 'cards' | 'compact' | 'inline'
  onToggle?: (enabled: boolean) => void
}

/**
 * Settings Sync Component (MUSIXQUARE Parity)
 * Synchronizes volume and audio effects (equalizer, reverb, virtual bass) across room devices.
 */
export const SettingsSyncSection: React.FC<SettingsSyncSectionProps> = ({
  className = '',
  titleClassName = '',
  descClassName = '',
  variant = 'cards',
  onToggle
}) => {
  const settingsSync = useDspStore((s) => s.settingsSync)
  const setSettingsSync = useDspStore((s) => s.setSettingsSync)

  const handleToggle = (enabled: boolean) => {
    try {
      playUiTouchSound()
    } catch {}
    setSettingsSync(enabled)
    if (enabled) {
      requestRoomDspSync()
    }
    onToggle?.(enabled)
  }

  if (variant === 'compact' || variant === 'inline') {
    return (
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface/50 border border-white/[0.06] hover:border-white/10 transition-colors ${className}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
            settingsSync
              ? 'bg-primary text-primary-foreground border-transparent shadow-sm'
              : 'bg-surface-elevated border-border/60 text-text-muted'
          }`}>
            {settingsSync ? (
              <SettingsSyncOnIcon className="w-5 h-5 text-primary-foreground" />
            ) : (
              <SettingsSyncOffIcon className="w-5 h-5 text-text-muted" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold text-white tracking-tight ${titleClassName}`}>
                Settings Sync
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border transition-colors ${
                settingsSync
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-surface-elevated border-border/60 text-text-muted'
              }`}>
                {settingsSync ? 'ON' : 'OFF'}
              </span>
            </div>
            <p className={`text-[11px] text-text-muted mt-0.5 truncate leading-relaxed ${descClassName}`}>
              Sync volume & audio DSP effects across all room devices
            </p>
          </div>
        </div>

        {/* Compact Segmented Pill Control */}
        <div
          className="flex items-center p-1 rounded-xl bg-black/40 border border-white/10 shrink-0 self-start sm:self-center"
          role="group"
          aria-label="Settings sync selection"
        >
          <button
            type="button"
            onClick={() => handleToggle(true)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              settingsSync
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-white/5'
            }`}
            aria-pressed={settingsSync}
          >
            On
          </button>
          <button
            type="button"
            onClick={() => handleToggle(false)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              !settingsSync
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-white/5'
            }`}
            aria-pressed={!settingsSync}
          >
            Off
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <h4 className={`text-base font-bold text-white tracking-tight ${titleClassName}`}>
          Settings sync
        </h4>
        <p className={`text-xs text-text-muted mt-0.5 leading-relaxed ${descClassName}`}>
          Devices with this setting on sync their volume and audio effects.
        </p>
      </div>

      <div
        className="grid grid-cols-2 gap-3 max-w-sm pt-1"
        role="group"
        aria-label="Settings sync selection"
      >
        {/* On Button */}
        <button
          type="button"
          onClick={() => handleToggle(true)}
          className={`flex flex-col items-center justify-center gap-2.5 p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer active:scale-95 ${
            settingsSync
              ? 'bg-primary border-primary text-primary-foreground shadow-md font-semibold'
              : 'bg-surface border border-border/60 text-text-muted hover:text-white hover:bg-surface-elevated'
          }`}
          aria-pressed={settingsSync}
          title="Enable Settings Sync (sync volume and audio effects with room)"
        >
          <SettingsSyncOnIcon
            className={`w-6 h-6 transition-colors ${settingsSync ? 'text-primary-foreground' : 'text-text-muted'}`}
          />
          <span className={`text-xs font-semibold ${settingsSync ? 'text-primary-foreground' : 'text-text-muted'}`}>On</span>
        </button>

        {/* Off Button */}
        <button
          type="button"
          onClick={() => handleToggle(false)}
          className={`flex flex-col items-center justify-center gap-2.5 p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer active:scale-95 ${
            !settingsSync
              ? 'bg-primary border-primary text-primary-foreground shadow-md font-semibold'
              : 'bg-surface border border-border/60 text-text-muted hover:text-white hover:bg-surface-elevated'
          }`}
          aria-pressed={!settingsSync}
          title="Disable Settings Sync (keep volume and audio effects local)"
        >
          <SettingsSyncOffIcon
            className={`w-6 h-6 transition-colors ${!settingsSync ? 'text-primary-foreground' : 'text-text-muted'}`}
          />
          <span className={`text-xs font-semibold ${!settingsSync ? 'text-primary-foreground' : 'text-text-muted'}`}>Off</span>
        </button>
      </div>
    </div>
  )
}

export default SettingsSyncSection
