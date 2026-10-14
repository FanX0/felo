import { Song } from '../Library/Library'

export interface PlaylistSong extends Song {
  playlistDateAdded: number
  playlistSortOrder: number
}

export interface Playlist {
  id: string
  name: string
  description?: string | null
  artworkPath?: string | null
  dateCreated: number
  dateModified: number
  songCount: number
  songs?: PlaylistSong[]
}
