import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

export interface HomeSongItem {
  id: string
  title: string
  artist: string
  artists?: Array<{ name: string; role?: 'primary' | 'featured' }>
  album?: string
  year?: string | number
  duration: number
  artworkUrl?: string
  quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
  isExplicit?: boolean
  previewUrl?: string
  filePath?: string
  codec?: string
  container?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  dateAdded?: number
  size?: number
}

export interface HomeAlbumItem {
  id: string
  title: string
  artist: string
  year?: string | number
  artworkUrl?: string
  songCount?: number
  genre?: string
}

export interface HomeProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export type HomeTabType = 'overview' | 'apple' | 'spotify' | 'aoty' | 'lastfm'
