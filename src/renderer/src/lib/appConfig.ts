/**
 * Application feature capabilities based on environment and build configuration.
 */

// True when running inside Electron desktop container
export const isElectron =
  typeof window !== 'undefined' && Boolean((window as any).electron)

// True when running inside native mobile or desktop app (Capacitor or Electron)
export const isNativeApp =
  typeof window !== 'undefined' &&
  Boolean(
    (window as any).electron ||
      (window as any).api ||
      (window as any).Capacitor?.isNativePlatform?.() ||
      (window as any).Capacitor
  )

// Public local-first mode is active on open-source releases & web deployments (where window.api is undefined or VITE_APP_MODE is 'public')
export const isPublicMode =
  typeof window === 'undefined' ||
  !isElectron ||
  (typeof import.meta !== 'undefined' &&
    ((import.meta as any).env?.VITE_APP_MODE === 'public' ||
      (import.meta as any).env?.FELO_MODE === 'public'))

export const AppCapabilities = {
  // Online music discovery tabs (Apple charts, Spotify playlists, AOTY, Last.fm)
  onlineDiscovery: !isPublicMode,

  // Online external catalog search (Apple Music, MusicBrainz)
  onlineSearch: !isPublicMode,

  // Last.fm search & metadata (Private desktop app only, excluded from web & public releases)
  lastFm: !isPublicMode,

  // Direct file downloads & provider scrapers (Enabled ONLY in private desktop app)
  downloads: !isPublicMode,

  // External playlist import (CSV, JSPF, XSPF, XML, M3U) with automated downloading (private desktop only)
  playlistImport: !isPublicMode,

  // Local audio playback and library management
  localLibrary: true,

  // Listen Together realtime sessions (Supabase)
  listenTogether: true,

  // Real-time Lossless Audio Streaming over WebRTC (Bit-perfect FLAC / 510kbps Opus)
  losslessStreaming: true,

  // Lyrics lookup from open public databases (LRCLIB)
  lyrics: true
} as const
