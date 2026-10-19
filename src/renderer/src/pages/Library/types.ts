import type { Song, SongArtist } from '../../types'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

export type { Song, SongArtist }

export interface LibraryProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export type LibrarySortKey = 'title' | 'dateAdded' | 'artist' | 'album' | 'duration' | 'default'
export type SortDirection = 'asc' | 'desc'
export type LibraryViewMode = 'compact' | 'list'

export interface ActiveMenuState {
  song: Song
  index: number
  x: number
  y: number
  openUpwards?: boolean
  triggerRect?: {
    top: number
    bottom: number
    left: number
    right: number
  } | DOMRect | null
}

export interface RemoteLibraryDevice {
  id: string
  device_name: string
  device_type?: string
  local_ip?: string
  port?: number
  token?: string
}
