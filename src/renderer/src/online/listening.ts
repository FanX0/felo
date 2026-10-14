import { getSupabase } from '../lib/supabase'
import type { ListeningRoom } from './types'

export async function joinListeningRoom(roomId: string, userId: string): Promise<ListeningRoom> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('listening_rooms')
    .select('*')
    .eq('id', roomId)
    .eq('is_active', true)
    .eq('is_playing', true)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('This friend is no longer playing.')

  const { error: joinError } = await supabase
    .from('listening_room_members')
    .upsert({ room_id: roomId, user_id: userId })
  if (joinError) throw joinError

  return data as ListeningRoom
}
