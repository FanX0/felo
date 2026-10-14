import type { SharedSong } from '../online/types'
import type { Song } from '../pages/Library/Library'
import type { Playlist } from '../pages/Playlists/types'
import { getSupabase } from './supabase'

export function asSharedSong(song: Song): SharedSong {
  const artworkUrl = /^https?:\/\//i.test(song.artworkPath || '') ? song.artworkPath : undefined
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist || 'Unknown Artist',
    album: song.album || undefined,
    duration: song.duration || undefined,
    artworkUrl
  }
}

export async function publishLocalPlaylist(playlist: Playlist): Promise<string> {
  const { data, error } = await getSupabase().rpc('publish_local_playlist', {
    local_playlist_id: playlist.id,
    playlist_name: playlist.name,
    playlist_description: playlist.description || '',
    songs: (playlist.songs || []).map(asSharedSong)
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('The online playlist could not be created.')
  return data
}
