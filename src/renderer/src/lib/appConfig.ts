/**
 * Application feature capabilities based on environment and build configuration.
 */

// True when running inside Electron desktop container
export const isElectron = typeof window !== 'undefined' && Boolean(window.electron)

// Public local-first mode is active if:
// 1. Built with VITE_PUBLIC_MODE=true
// 2. Running as a web deployment (Cloudflare / browser)
// 3. Explicitly configured as public build via API
export const isPublicMode =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_MODE === 'true') ||
  !isElectron ||
  (typeof window !== 'undefined' && Boolean((window.api as { isPublicBuild?: boolean } | undefined)?.isPublicBuild))

export const AppCapabilities = {
  // Online music discovery tabs (Apple charts, Spotify playlists, AOTY, Last.fm)
  onlineDiscovery: !isPublicMode,

  // Direct file downloads & provider scrapers
  downloads: isElectron && !isPublicMode,

  // Local audio playback and library management
  localLibrary: true,

  // Listen Together realtime sessions (Supabase)
  listenTogether: true,

  // Lyrics lookup from open public databases (LRCLIB)
  lyrics: true
} as const
