/**
 * Application feature capabilities based on environment and build configuration.
 */

// True when running inside Electron desktop container
export const isElectron = typeof window !== 'undefined' && Boolean(window.electron)

// Public local-first mode is always active on open-source releases & web deployments
export const isPublicMode = true

export const AppCapabilities = {
  // Online music discovery tabs (Apple charts, Spotify playlists, AOTY, Last.fm)
  onlineDiscovery: false,

  // Online external catalog search (Apple Music, MusicBrainz, Last.fm)
  onlineSearch: false,

  // Direct file downloads & provider scrapers
  downloads: false,

  // Local audio playback and library management
  localLibrary: true,

  // Listen Together realtime sessions (Supabase)
  listenTogether: true,

  // Lyrics lookup from open public databases (LRCLIB)
  lyrics: true
} as const
