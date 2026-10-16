export interface SongArtist {
  id?: string
  name: string
  role?: 'primary' | 'featured'
}

export interface Song {
  id: string
  title: string
  artist: string
  artists?: SongArtist[]
  album: string
  duration: number
  filePath?: string
  trackNumber?: number
  genre?: string
  size?: number
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  channels?: number
  codec?: string
  container?: string
  artworkPath?: string
  artworkUrl?: string
  audioUrl?: string
  downloadUrl?: string
  isOnline?: boolean
  dateAdded?: number
  requestedBy?: string
  isPriority?: boolean
  isLocalToDevice?: boolean
  localId?: string
  url?: string
}

export type LibrarySortKey = 'title' | 'dateAdded' | 'artist' | 'album' | 'duration' | 'default'
export type SortDirection = 'asc' | 'desc'
export type LibraryViewMode = 'compact' | 'list'
