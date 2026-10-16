import { useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { useThemeStore, ACCENT_PRESETS } from '../../../hooks/useThemeStore'
import { Toggle } from '../components/Toggle'
import { SettingRow } from '../components/SettingRow'
import { SettingsSection } from '../components/SettingsSection'

export function AppearanceSection() {
  const [reducedMotion, setReducedMotion] = useState(false)
  const [compactMode, setCompactMode] = useState(false)
  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const setAccentEnabled = useThemeStore((s) => s.setAccentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)
  const setAccentColor = useThemeStore((s) => s.setAccentColor)

  return (
    <SettingsSection
      icon={<Palette className="w-5 h-5" />}
      title="Appearance"
      description="Customize visual presentation and accessibility."
    >
      <SettingRow
        label="Reduced Motion"
        hint="Minimizes animations for accessibility or preference."
      >
        <Toggle enabled={reducedMotion} onChange={setReducedMotion} />
      </SettingRow>
      <SettingRow label="Compact Mode" hint="Reduce spacing and show more content on screen.">
        <Toggle enabled={compactMode} onChange={setCompactMode} />
      </SettingRow>
      <SettingRow
        label="Theme Base"
        hint="Foundational visual mode for the application."
      >
        <span className="px-2.5 py-1 rounded bg-surface-elevated border border-border text-text text-xs font-medium">
          Convention Dark (Monochrome)
        </span>
      </SettingRow>

      {/* Custom Accent Color Feature */}
      <SettingRow
        label="Custom Accent Color"
        hint={
          accentEnabled
            ? 'Custom color active: highlighted controls, active toggles, and buttons use your chosen accent.'
            : 'Disabled: application follows the pure convention theme (clean monochrome & white accents).'
        }
      >
        <Toggle
          enabled={accentEnabled}
          onChange={(val) => {
            setAccentEnabled(val)
          }}
        />
      </SettingRow>

      {/* Color Swatches and Live Preview */}
      <div className={`mt-3 rounded-xl border p-4 transition-all duration-200 ${accentEnabled ? 'bg-surface-elevated/40 border-primary/25' : 'bg-surface/40 border-border/40 opacity-70'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <span className="text-xs font-bold text-text">Accent Palette</span>
            <p className="text-[11px] text-text-muted">
              Select a curated preset or enter a custom hex color.
            </p>
          </div>
          {accentEnabled && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 w-fit">
              ACTIVE: {accentColor.toUpperCase()}
            </span>
          )}
        </div>

        {/* Swatch grid */}
        <div className="flex flex-wrap items-center gap-2.5 py-1">
          {ACCENT_PRESETS.map((preset) => {
            const isSelected = accentColor.toLowerCase() === preset.color.toLowerCase()
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setAccentColor(preset.color)
                  if (!accentEnabled) setAccentEnabled(true)
                }}
                title={`${preset.label} (${preset.color})`}
                className={`group relative flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all cursor-pointer ${
                  isSelected && accentEnabled
                    ? 'border-white/50 bg-white/10 text-white shadow-sm ring-1 ring-white/30'
                    : 'border-border/60 bg-surface hover:border-white/30 text-text-muted hover:text-text'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm border border-black/20"
                  style={{ backgroundColor: preset.color }}
                />
                <span>{preset.label.replace(/ \(.+\)/, '')}</span>
                {isSelected && accentEnabled && (
                  <Check className="w-3 h-3 text-white ml-0.5" />
                )}
              </button>
            )
          })}

          {/* Custom Hex / Color Picker input */}
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-surface px-2.5 py-1 text-xs">
            <label
              htmlFor="custom-accent-picker"
              className="relative flex items-center justify-center w-5 h-5 rounded-full cursor-pointer overflow-hidden border border-white/20 shrink-0"
              title="Pick custom color"
            >
              <input
                id="custom-accent-picker"
                type="color"
                value={accentColor}
                onChange={(e) => {
                  setAccentColor(e.target.value)
                  if (!accentEnabled) setAccentEnabled(true)
                }}
                className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer opacity-0"
              />
              <span
                className="w-full h-full rounded-full"
                style={{ backgroundColor: accentColor }}
              />
            </label>
            <input
              type="text"
              value={accentColor}
              maxLength={7}
              onChange={(e) => {
                const val = e.target.value
                setAccentColor(val)
                if (!accentEnabled && /^#[0-9a-fA-F]{6}$/.test(val)) {
                  setAccentEnabled(true)
                }
              }}
              placeholder="#10b981"
              className="w-16 bg-transparent text-[11px] font-mono text-text outline-none uppercase"
            />
          </div>
        </div>

        {/* Live Theme Preview Card */}
        <div className="mt-4 pt-3 border-t border-border/30 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-text-muted">
            <span>Preview:</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25 font-medium">
              Theme Badge
            </span>
            <button
              type="button"
              className="px-3 py-1 rounded-full text-xs font-bold bg-primary text-primary-foreground shadow-sm transition-all"
            >
              Active Button
            </button>
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <span>Switch:</span>
              <div
                className="w-9 h-5 rounded-full relative transition-colors bg-primary"
              >
                <div
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary-foreground shadow"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  )
}
