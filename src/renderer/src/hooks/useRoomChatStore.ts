import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import { useOnlineStore } from './useOnlineStore'
import type { RoomChatMessage } from '../online/types'

interface RoomChatState {
  messages: RoomChatMessage[]
  isLoading: boolean
  sending: boolean
  error: string | null

  loadMessages: (roomId: string) => Promise<void>
  sendMessage: (roomId: string, body: string) => Promise<void>
  addIncoming: (message: Omit<RoomChatMessage, 'sender_display_name' | 'sender_avatar_url'> & Partial<RoomChatMessage>) => Promise<void>
  clearMessages: () => void
}

// Profile cache to avoid querying Supabase profile repeatedly for known users
const profileCache = new Map<string, { display_name: string; avatar_url: string | null }>()

async function getProfileInfo(userId: string): Promise<{ display_name: string; avatar_url: string | null }> {
  if (profileCache.has(userId)) {
    return profileCache.get(userId)!
  }
  try {
    const { data } = await getSupabase()
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .maybeSingle()

    const info = {
      display_name: data?.display_name || 'User',
      avatar_url: data?.avatar_url || null
    }
    profileCache.set(userId, info)
    return info
  } catch {
    return { display_name: 'User', avatar_url: null }
  }
}

export const useRoomChatStore = create<RoomChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  sending: false,
  error: null,

  loadMessages: async (roomId: string) => {
    if (!roomId) return
    set({ isLoading: true, error: null })
    try {
      const supabase = getSupabase()
      const { data: rows, error } = await supabase
        .from('listening_room_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(60)

      if (error) throw error

      const rawMessages = (rows || []) as RoomChatMessage[]
      if (rawMessages.length === 0) {
        set({ messages: [], isLoading: false })
        return
      }

      // Collect unique user IDs to fetch profiles in a single query
      const userIds = Array.from(new Set(rawMessages.map((m) => m.sender_id)))
      const missingUserIds = userIds.filter((id) => !profileCache.has(id))

      if (missingUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, avatar_url')
          .in('id', missingUserIds)

        for (const p of profiles || []) {
          profileCache.set(p.id, {
            display_name: p.display_name || 'User',
            avatar_url: p.avatar_url || null
          })
        }
      }

      const enriched: RoomChatMessage[] = rawMessages.map((m) => {
        const p = profileCache.get(m.sender_id)
        return {
          ...m,
          sender_display_name: p?.display_name || 'User',
          sender_avatar_url: p?.avatar_url || null
        }
      })

      set({ messages: enriched, isLoading: false })
    } catch (err: any) {
      console.warn('Failed to load room chat messages:', err)
      set({ error: err?.message || 'Failed to load messages', isLoading: false })
    }
  },

  sendMessage: async (roomId: string, body: string) => {
    const cleanBody = body.trim()
    if (!cleanBody || !roomId) return

    const user = useOnlineStore.getState().user
    const profile = useOnlineStore.getState().profile
    if (!user) throw new Error('You must be signed in to chat.')

    set({ sending: true, error: null })
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('listening_room_messages')
        .insert({
          room_id: roomId,
          sender_id: user.id,
          body: cleanBody
        })
        .select('*')
        .single()

      if (error) throw error

      if (data) {
        const newMsg: RoomChatMessage = {
          ...(data as RoomChatMessage),
          sender_display_name: profile?.display_name || user.email?.split('@')[0] || 'You',
          sender_avatar_url: profile?.avatar_url || null
        }
        // Deduplicate and append immediately for zero UI lag
        set((state) => {
          if (state.messages.some((m) => m.id === newMsg.id)) return state
          return { messages: [...state.messages, newMsg] }
        })
      }
    } catch (err: any) {
      console.error('Failed to send room message:', err)
      set({ error: err?.message || 'Failed to send message' })
      throw err
    } finally {
      set({ sending: false })
    }
  },

  addIncoming: async (incoming) => {
    // Prevent duplicate entries
    const exists = get().messages.some((m) => m.id === incoming.id)
    if (exists) return

    const profile = await getProfileInfo(incoming.sender_id)
    const enrichedMsg: RoomChatMessage = {
      ...incoming,
      sender_display_name: incoming.sender_display_name || profile.display_name,
      sender_avatar_url: incoming.sender_avatar_url ?? profile.avatar_url
    }

    set((state) => {
      if (state.messages.some((m) => m.id === enrichedMsg.id)) return state
      return { messages: [...state.messages, enrichedMsg] }
    })
  },

  clearMessages: () => {
    set({ messages: [], isLoading: false, sending: false, error: null })
  }
}))
