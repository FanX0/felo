import type { Song } from '../Library/Library'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

export type SearchTab = 'All' | 'Songs' | 'Artists' | 'Albums' | 'Playlists'

export interface SearchItem {
  id: string
  title: string
  artist: string
  album: string
  type: string
  duration: string | null
  url: string
  thumbnail: string
  explicit?: boolean
  localSong?: Song
  trackCount?: number
}

export interface SearchSections {
  'Top Results': SearchItem[]
  Artists: SearchItem[]
  Albums: SearchItem[]
  Songs: SearchItem[]
  Playlists: SearchItem[]
}

export interface SearchProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export const EMPTY_RESULTS: SearchSections = {
  'Top Results': [],
  Artists: [],
  Albums: [],
  Songs: [],
  Playlists: []
}
