/**
 * Application feature capabilities based on environment and build configuration.
 */

// True when running inside Electron desktop container
export const isElectron =
  typeof window !== 'undefined' && Boolean((window as any).electron || (window as any).api)

// Public local-first mode is active on open-source releases & web deployments (where window.api is undefined or VITE_APP_MODE is 'public')
export const isPublicMode =
  typeof window === 'undefined' ||
  !isElectron ||
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_MODE === 'public')

export const AppCapabilities = {
  // Online music discovery tabs (Apple charts, Spotify playlists, AOTY, Last.fm)
  onlineDiscovery: !isPublicMode,

  // Online external catalog search (Apple Music, MusicBrainz, Last.fm)
  onlineSearch: !isPublicMode,

  // Direct file downloads & provider scrapers (Enabled ONLY in private desktop app)
  downloads: !isPublicMode,

  // Local audio playback and library management
  localLibrary: true,

  // Listen Together realtime sessions (Supabase)
  listenTogether: true,

  // Real-time Lossless Audio Streaming over WebRTC (Bit-perfect FLAC / 510kbps Opus)
  losslessStreaming: true,

  // Lyrics lookup from open public databases (LRCLIB)
  lyrics: true
} as const
