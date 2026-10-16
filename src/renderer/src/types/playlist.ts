import type { Song } from './song'

export interface PlaylistSong extends Song {
  playlistDateAdded: number
  playlistSortOrder: number
}

export interface Playlist {
  id: string
  name: string
  description?: string | null
  artworkPath?: string | null
  artworkUrl?: string | null
  dateCreated: number
  dateModified: number
  songCount: number
  songs?: PlaylistSong[]
}
