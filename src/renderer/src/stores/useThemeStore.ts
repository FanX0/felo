import { create } from 'zustand'

// Built-in accent color presets
export interface AccentPreset {
  id: string
  label: string
  color: string // hex
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'emerald', label: 'Emerald (Felo Green)', color: '#10b981' },
  { id: 'white', label: 'Default (White)', color: '#ffffff' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
  { id: 'cyan', label: 'Cyan', color: '#06b6d4' },
  { id: 'orange', label: 'Orange', color: '#f97316' },
  { id: 'blue', label: 'Electric Blue', color: '#3b82f6' }
]

const ACCENT_ENABLED_KEY = 'felo_accent_enabled'
const ACCENT_COLOR_KEY = 'felo_accent_color'

/**
 * Derive a slightly lighter variant of a hex color for hover states.
 * Blends toward white by 10%.
 */
export function deriveHoverColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const blend = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.1))
  return `#${[blend(r), blend(g), blend(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Determine a contrasting foreground color (black or white) for the given hex bg.
 */
export function deriveForeground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Relative luminance formula (WCAG)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#000000' : '#ffffff'
}

interface ThemeState {
  accentEnabled: boolean
  accentColor: string // hex string e.g. "#10b981"

  setAccentEnabled: (enabled: boolean) => void
  setAccentColor: (color: string) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  accentEnabled: localStorage.getItem(ACCENT_ENABLED_KEY) === 'true',
  accentColor: localStorage.getItem(ACCENT_COLOR_KEY) || '#10b981',

  setAccentEnabled: (enabled) => {
    localStorage.setItem(ACCENT_ENABLED_KEY, String(enabled))
    set({ accentEnabled: enabled })
  },

  setAccentColor: (color) => {
    localStorage.setItem(ACCENT_COLOR_KEY, color)
    set({ accentColor: color })
  }
}))
