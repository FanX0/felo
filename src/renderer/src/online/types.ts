export interface OnlineProfile {
  id: string
  username: string
  display_name: string
  bio: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface FriendRequest {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted'
  created_at: string
  updated_at: string
}

export interface SharedSong {
  localId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  artworkUrl?: string
}

export interface Conversation {
  id: string
  owner_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  song: SharedSong | null
  created_at: string
}

export interface SharedPlaylist {
  id: string
  owner_id: string
  name: string
  description: string
  source_local_playlist_id?: string | null
  created_at: string
  updated_at: string
}

export interface SharedPlaylistItem {
  id: string
  playlist_id: string
  added_by: string
  song: SharedSong
  position: number
  created_at: string
}

export interface ListeningRoom {
  id: string
  host_id: string
  code: string
  name: string
  is_active: boolean
  song: SharedSong | null
  queue?: SharedSong[]
  position_seconds: number
  is_playing: boolean
  created_at: string
  updated_at: string
}

export interface RoomChatMessage {
  id: string
  room_id: string
  sender_id: string
  body: string
  created_at: string
  sender_display_name?: string
  sender_avatar_url?: string | null
}
