import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

export interface HomeSongItem {
  id: string
  title: string
  artist: string
  album?: string
  year?: string | number
  duration: number
  artworkUrl?: string
  quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
  isExplicit?: boolean
  previewUrl?: string
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
