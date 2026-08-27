import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import { useOnlineStore } from './useOnlineStore'
import type { ChatMessage, Conversation, OnlineProfile, SharedSong } from '../online/types'

export interface DirectConversationItem {
  id: string
  owner_id: string
  title: string | null
  created_at: string
  updated_at: string
  otherMember: OnlineProfile
  lastMessage: ChatMessage | null
}

interface DirectChatState {
  conversations: DirectConversationItem[]
  activeConversation: DirectConversationItem | null
  messages: ChatMessage[]
  friends: OnlineProfile[]
  isLoadingConversations: boolean
  isLoadingMessages: boolean
  sending: boolean
  error: string | null

  loadConversations: () => Promise<void>
  loadFriends: () => Promise<void>
  selectOrStartConversation: (friendId: string) => Promise<DirectConversationItem | null>
  setActiveConversation: (conv: DirectConversationItem | null) => void
  loadMessages: (conversationId: string) => Promise<void>
  sendMessage: (conversationId: string, body: string, song?: SharedSong | null) => Promise<void>
  addIncomingMessage: (msg: ChatMessage) => void
  clearActive: () => void
}

const profileCache = new Map<string, OnlineProfile>()

async function fetchProfile(userId: string): Promise<OnlineProfile | null> {
  if (profileCache.has(userId)) return profileCache.get(userId)!
  try {
    const { data } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (data) {
      profileCache.set(userId, data as OnlineProfile)
      return data as OnlineProfile
    }
  } catch {
    // ignore
  }
  return null
}

export const useDirectChatStore = create<DirectChatState>((set, get) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  friends: [],
  isLoadingConversations: false,
  isLoadingMessages: false,
  sending: false,
  error: null,

  loadFriends: async () => {
    const user = useOnlineStore.getState().user
    if (!user) return
    try {
      const supabase = getSupabase()
      const { data: reqs, error } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted')

      if (error) throw error

      const friendIds = (reqs || []).map((r) =>
        r.requester_id === user.id ? r.addressee_id : r.requester_id
      )

      if (friendIds.length === 0) {
        set({ friends: [] })
        return
      }

      const { data: profiles, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', friendIds)

      if (pError) throw pError
      const friendProfiles = (profiles || []) as OnlineProfile[]
      friendProfiles.forEach((p) => profileCache.set(p.id, p))
      set({ friends: friendProfiles })
    } catch (err: any) {
      console.warn('Failed to load friends for chat:', err)
    }
  },

  loadConversations: async () => {
    const user = useOnlineStore.getState().user
    if (!user) return

    set({ isLoadingConversations: true, error: null })
    try {
      const supabase = getSupabase()

      // 1. Get all conversations the user belongs to
      const { data: myMemberships, error: memberErr } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', user.id)

      if (memberErr) throw memberErr

      const conversationIds = (myMemberships || []).map((m) => m.conversation_id)
      if (conversationIds.length === 0) {
        set({ conversations: [], isLoadingConversations: false })
        return
      }

      // 2. Fetch conversation rows and other members
      const [{ data: convRows, error: convErr }, { data: allMembers, error: allMemErr }] =
        await Promise.all([
          supabase
            .from('conversations')
            .select('*')
            .in('id', conversationIds)
            .order('updated_at', { ascending: false }),
          supabase
            .from('conversation_members')
            .select('conversation_id, user_id')
            .in('conversation_id', conversationIds)
        ])

      if (convErr) throw convErr
      if (allMemErr) throw allMemErr

      // 3. Find recipient IDs and fetch their profiles
      const otherUserIds: string[] = []
      const convToOtherUser = new Map<string, string>()

      for (const m of allMembers || []) {
        if (m.user_id !== user.id) {
          convToOtherUser.set(m.conversation_id, m.user_id)
          if (!otherUserIds.includes(m.user_id)) {
            otherUserIds.push(m.user_id)
          }
        }
      }

      const missingUserIds = otherUserIds.filter((id) => !profileCache.has(id))
      if (missingUserIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('*')
          .in('id', missingUserIds)

        for (const p of profileRows || []) {
          profileCache.set(p.id, p as OnlineProfile)
        }
      }

      // 4. Fetch the last message for each conversation
      const items: DirectConversationItem[] = []
      for (const conv of (convRows || []) as Conversation[]) {
        const otherId = convToOtherUser.get(conv.id)
        const otherProfile = otherId ? profileCache.get(otherId) : null

        const defaultOtherProfile: OnlineProfile = otherProfile || {
          id: otherId || 'unknown',
          username: 'user',
          display_name: conv.title || 'Friend',
          bio: '',
          avatar_url: null,
          created_at: conv.created_at,
          updated_at: conv.updated_at
        }

        // Fetch latest message
        const { data: latestMsgRows } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)

        const lastMessage = (latestMsgRows?.[0] as ChatMessage) || null

        items.push({
          id: conv.id,
          owner_id: conv.owner_id,
          title: conv.title,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          otherMember: defaultOtherProfile,
          lastMessage
        })
      }

      set({ conversations: items, isLoadingConversations: false })

      // Auto-select first conversation if none is active
      const currentActive = get().activeConversation
      if (currentActive) {
        const updatedActive = items.find((i) => i.id === currentActive.id)
        if (updatedActive) set({ activeConversation: updatedActive })
      } else if (items.length > 0) {
        set({ activeConversation: items[0] })
        void get().loadMessages(items[0].id)
      }
    } catch (err: any) {
      console.warn('Failed to load conversations:', err)
      set({ error: err?.message || 'Failed to load conversations', isLoadingConversations: false })
    }
  },

  selectOrStartConversation: async (friendId: string): Promise<DirectConversationItem | null> => {
    const user = useOnlineStore.getState().user
    if (!user || !friendId || friendId === user.id) return null

    // Check if we already have this conversation loaded in state
    const existing = get().conversations.find((c) => c.otherMember.id === friendId)
    if (existing) {
      get().setActiveConversation(existing)
      void get().loadMessages(existing.id)
      return existing
    }

    set({ isLoadingMessages: true, error: null })

    // Resolve friend profile early so we can show the chat UI optimistically
    let otherProfile = await fetchProfile(friendId)
    if (!otherProfile) {
      otherProfile = {
        id: friendId,
        username: 'friend',
        display_name: 'Friend',
        bio: '',
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    }

    try {
      const supabase = getSupabase()

      // 1. Try RPC first (requires migration 0005 applied)
      let conversationId: string | null = null
      try {
        const { data: rpcId, error: rpcErr } = await supabase.rpc('get_or_create_direct_conversation', {
          other_user_id: friendId
        })
        if (!rpcErr && rpcId) {
          conversationId = rpcId
        }
      } catch {
        // RPC not available, fall through to manual approach
      }

      // 2. Fallback: manual lookup & creation
      if (!conversationId) {
        const { data: myConvs } = await supabase
          .from('conversation_members')
          .select('conversation_id')
          .eq('user_id', user.id)

        const myIds = (myConvs || []).map((m) => m.conversation_id)

        if (myIds.length > 0) {
          const { data: match } = await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', friendId)
            .in('conversation_id', myIds)
            .limit(1)
            .maybeSingle()

          if (match) {
            conversationId = match.conversation_id
          }
        }

        if (!conversationId) {
          // Create new conversation (we are the owner)
          const { data: createdConv, error: cErr } = await supabase
            .from('conversations')
            .insert({ owner_id: user.id, title: null })
            .select()
            .single()

          if (cErr) throw cErr
          conversationId = createdConv.id

          // Insert self first (user_id = auth.uid() passes RLS)
          await supabase.from('conversation_members').insert({
            conversation_id: conversationId,
            user_id: user.id
          })

          // Insert friend (owns_conversation policy passes since we're the owner)
          await supabase.from('conversation_members').insert({
            conversation_id: conversationId,
            user_id: friendId
          })
        }
      }

      if (!conversationId) throw new Error('Failed to resolve conversation ID')

      const item: DirectConversationItem = {
        id: conversationId,
        owner_id: user.id,
        title: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        otherMember: otherProfile,
        lastMessage: null
      }

      set((state) => {
        const filtered = state.conversations.filter((c) => c.id !== item.id)
        return {
          conversations: [item, ...filtered],
          activeConversation: item
        }
      })

      void get().loadMessages(item.id)
      return item
    } catch (err: any) {
      console.error('Failed to start conversation with friend:', err)

      // Even if DB fails, open the chat UI optimistically so the user sees the input box
      const optimisticItem: DirectConversationItem = {
        id: `pending-${friendId}`,
        owner_id: user.id,
        title: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        otherMember: otherProfile,
        lastMessage: null
      }

      set((state) => ({
        conversations: [optimisticItem, ...state.conversations.filter((c) => c.otherMember.id !== friendId)],
        activeConversation: optimisticItem,
        error: err?.message || 'Failed to start conversation — messages may not send until the database is ready.'
      }))

      return optimisticItem
    } finally {
      set({ isLoadingMessages: false })
    }
  },

  setActiveConversation: (conv) => {
    set({ activeConversation: conv })
    if (conv) {
      void get().loadMessages(conv.id)
    } else {
      set({ messages: [] })
    }
  },

  loadMessages: async (conversationId: string) => {
    if (!conversationId) return
    set({ isLoadingMessages: true, error: null })
    try {
      const { data, error } = await getSupabase()
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) throw error
      set({ messages: (data || []) as ChatMessage[], isLoadingMessages: false })
    } catch (err: any) {
      console.warn('Failed to load conversation messages:', err)
      set({ error: err?.message || 'Failed to load messages', isLoadingMessages: false })
    }
  },

  sendMessage: async (conversationId: string, body: string, song?: SharedSong | null) => {
    const cleanBody = body.trim()
    if (!conversationId || (!cleanBody && !song)) return

    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to send messages.')

    set({ sending: true, error: null })
    try {
      const supabase = getSupabase()
      const payload = {
        conversation_id: conversationId,
        sender_id: user.id,
        body: cleanBody,
        song: song || null
      }

      const { data, error } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single()

      if (error) throw error

      const newMsg = data as ChatMessage

      // Update active messages & sidebar lastMessage preview
      set((state) => {
        const nextMsgs = state.messages.some((m) => m.id === newMsg.id)
          ? state.messages
          : [...state.messages, newMsg]

        const updatedConvs = state.conversations.map((c) =>
          c.id === conversationId ? { ...c, lastMessage: newMsg, updated_at: newMsg.created_at } : c
        )

        // Move active conversation to top of list
        updatedConvs.sort(
          (a, b) =>
            new Date(b.lastMessage?.created_at || b.updated_at).getTime() -
            new Date(a.lastMessage?.created_at || a.updated_at).getTime()
        )

        return {
          messages: nextMsgs,
          conversations: updatedConvs
        }
      })

      // Bump conversation updated_at
      void supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
    } catch (err: any) {
      console.error('Failed to send direct message:', err)
      set({ error: err?.message || 'Failed to send message' })
      throw err
    } finally {
      set({ sending: false })
    }
  },

  addIncomingMessage: (msg: ChatMessage) => {
    set((state) => {
      const isForActive = state.activeConversation?.id === msg.conversation_id
      const nextMsgs = isForActive
        ? state.messages.some((m) => m.id === msg.id)
          ? state.messages
          : [...state.messages, msg]
        : state.messages

      const updatedConvs = state.conversations.map((c) =>
        c.id === msg.conversation_id ? { ...c, lastMessage: msg, updated_at: msg.created_at } : c
      )

      updatedConvs.sort(
        (a, b) =>
          new Date(b.lastMessage?.created_at || b.updated_at).getTime() -
          new Date(a.lastMessage?.created_at || a.updated_at).getTime()
      )

      return {
        messages: nextMsgs,
        conversations: updatedConvs
      }
    })
  },

  clearActive: () => {
    set({ activeConversation: null, messages: [] })
  }
}))
