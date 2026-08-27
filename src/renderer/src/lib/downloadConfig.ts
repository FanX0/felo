export type DownloadSourceId = 'qobuz' | 'deezer' | 'soulseek' | 'youtube'
export type PlaybackStorageMode = 'stream' | 'download'
export type DownloadConflictMode = 'replace' | 'keep_both'

export interface DownloadSource {
  id: DownloadSourceId
  name: string
  quality: string
  description: string
  accentClass: string
}

export const DOWNLOAD_SOURCES: DownloadSource[] = [
  {
    id: 'qobuz',
    name: 'Qobuz',
    quality: 'FLAC up to 24-bit/192kHz',
    description: 'Studio master hi-res lossless source',
    accentClass: 'text-secondary-cyan'
  },
  {
    id: 'deezer',
    name: 'Deezer',
    quality: 'FLAC 16-bit/44.1kHz',
    description: 'Lossless account-backed source',
    accentClass: 'text-purple-400'
  },
  {
    id: 'soulseek',
    name: 'Soulseek P2P',
    quality: 'FLAC / MP3 320k',
    description: 'Community files, manual selection required',
    accentClass: 'text-primary-amber'
  },
  {
    id: 'youtube',
    name: 'YouTube Music',
    quality: 'Opus / MP3 256k',
    description: 'Fallback catalog discovery source',
    accentClass: 'text-danger'
  }
]

export const DEFAULT_DOWNLOAD_PRIORITY: DownloadSourceId[] = [
  'qobuz',
  'deezer',
  'soulseek',
  'youtube'
]

export const DOWNLOAD_PRIORITY_SETTING = 'download.priority'
export const PLAYBACK_STORAGE_SETTING = 'download.playbackStorage'
export const STREAM_CACHE_SETTING = 'download.streamCacheLimit'
export const STREAMING_ACCOUNTS_SETTING = 'download.streamingAccounts'
export const DOWNLOAD_LOCATION_SETTING = 'download.location'
export const LASTFM_API_KEY_SETTING = 'search.lastFmApiKey'
