import React, { useEffect } from 'react'
import { deriveForeground, deriveHoverColor, useThemeStore } from '../../hooks/useThemeStore'

/**
 * Directly applies the theme CSS custom properties to the document root element.
 * Safe to call outside of React lifecycle (e.g. before initial render) to avoid FOUC.
 */
export function applyDocumentTheme(accentEnabled: boolean, accentColor: string): void {
  const root = document.documentElement
  if (!accentEnabled) {
    // Pure Convention Theme (Clean monochrome dark mode)
    root.style.setProperty('--app-accent', '#ffffff')
    root.style.setProperty('--app-accent-hover', '#e5e5e5')
    root.style.setProperty('--app-accent-foreground', '#000000')
  } else {
    // User Chosen Accent Color Theme
    const hover = deriveHoverColor(accentColor)
    const foreground = deriveForeground(accentColor)
    root.style.setProperty('--app-accent', accentColor)
    root.style.setProperty('--app-accent-hover', hover)
    root.style.setProperty('--app-accent-foreground', foreground)
  }

  // Keep browser status bar / mobile chrome in sync with Felo dark canvas
  try {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', '#000000')
    document.documentElement.style.colorScheme = 'dark'
  } catch {
    // SSR / non-DOM guard
  }
}

/**
 * Initializes the theme from localStorage immediately before DOM hydration.
 */
export function initTheme(): void {
  try {
    const enabled = localStorage.getItem('felo_accent_enabled') === 'true'
    const color = localStorage.getItem('felo_accent_color') || '#10b981'
    applyDocumentTheme(enabled, color)
  } catch (err) {
    console.warn('Failed to load initial theme from localStorage:', err)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)

  useEffect(() => {
    applyDocumentTheme(accentEnabled, accentColor)
  }, [accentEnabled, accentColor])

  return <>{children}</>
}
