import { create } from 'zustand'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { useOnlineStore } from './useOnlineStore'
import type { FriendRequest, ListeningRoom, ListeningRoomInvitation, OnlineProfile } from '../online/types'
import { playAnnouncementSound } from '../lib/uiSounds'

type ProfilePreview = Pick<OnlineProfile, 'id' | 'username' | 'display_name' | 'avatar_url'>
type RoomPreview = Pick<ListeningRoom, 'id' | 'code' | 'name' | 'is_active' | 'song' | 'is_playing'>

interface NotificationState {
  invitations: ListeningRoomInvitation[]
  incomingFriendRequests: FriendRequest[]
  profiles: Record<string, ProfilePreview>
  rooms: Record<string, RoomPreview>
  sentInvitationsByRoom: Record<string, string[]> // roomId -> list of invitee user IDs
  activeToast: ListeningRoomInvitation | null
  isLoading: boolean
  error: string | null

  // Computed / Helpers
  getUnreadCount: () => number

  // Actions
  loadNotifications: () => Promise<void>
  loadSentInvitations: (roomId: string) => Promise<void>
  sendRoomInvitation: (roomId: string, inviteeId: string) => Promise<{ success: boolean; error?: string }>
  acceptRoomInvitation: (invitationId: string) => Promise<void>
  declineRoomInvitation: (invitationId: string) => Promise<void>
  dismissToast: () => void
  subscribe: (userId: string) => () => void
}

let activeChannel: ReturnType<ReturnType<typeof getSupabase>['channel']> | null = null

export const useNotificationStore = create<NotificationState>((set, get) => ({
  invitations: [],
  incomingFriendRequests: [],
  profiles: {},
  rooms: {},
  sentInvitationsByRoom: {},
  activeToast: null,
  isLoading: false,
  error: null,

  getUnreadCount: () => {
    const { invitations, incomingFriendRequests } = get()
    return invitations.length + incomingFriendRequests.length
  },

  loadNotifications: async () => {
    if (!isSupabaseConfigured) return
    const user = useOnlineStore.getState().user
    if (!user) {
      set({ invitations: [], incomingFriendRequests: [] })
      return
    }

    set({ isLoading: true, error: null })
    const supabase = getSupabase()

    try {
      // 1. Fetch pending room invitations for this user
      const { data: invRows, error: invErr } = await supabase
        .from('listening_room_invitations')
        .select('*')
        .eq('invitee_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (invErr) {
        console.warn('Could not load room invitations:', invErr.message)
      }

      // 2. Fetch incoming pending friend requests
      const { data: frRows, error: frErr } = await supabase
        .from('friend_requests')
        .select('*')
        .eq('addressee_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })

      if (frErr) {
        console.warn('Could not load friend requests for notifications:', frErr.message)
      }

      const pendingInvs = (invRows || []) as ListeningRoomInvitation[]
      const pendingFrs = (frRows || []) as FriendRequest[]

      // Collect user IDs and room IDs needing hydration
      const userIdsToFetch = new Set<string>()
      const roomIdsToFetch = new Set<string>()

      pendingInvs.forEach((inv) => {
        userIdsToFetch.add(inv.inviter_id)
        roomIdsToFetch.add(inv.room_id)
      })

      pendingFrs.forEach((fr) => {
        userIdsToFetch.add(fr.requester_id)
      })

      const profileMap: Record<string, ProfilePreview> = { ...get().profiles }
      const roomMap: Record<string, RoomPreview> = { ...get().rooms }

      // Fetch missing profiles
      const missingUserIds = Array.from(userIdsToFetch).filter((id) => !profileMap[id])
      if (missingUserIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', missingUserIds)

        ;(profileData || []).forEach((p: ProfilePreview) => {
          profileMap[p.id] = p
        })
      }

      // Fetch missing active room details
      const missingRoomIds = Array.from(roomIdsToFetch).filter((id) => !roomMap[id])
      if (missingRoomIds.length > 0) {
        const { data: roomData } = await supabase
          .from('listening_rooms')
          .select('id, code, name, is_active, song, is_playing')
          .in('id', missingRoomIds)

        ;(roomData || []).forEach((r: RoomPreview) => {
          roomMap[r.id] = r
        })
      }

      // Filter out invitations for rooms that are no longer active
      const validInvitations = pendingInvs
        .map((inv) => ({
          ...inv,
          inviter: profileMap[inv.inviter_id],
          room: roomMap[inv.room_id]
        }))
        .filter((inv) => inv.room && inv.room.is_active)

      set({
        invitations: validInvitations,
        incomingFriendRequests: pendingFrs,
        profiles: profileMap,
        rooms: roomMap,
        isLoading: false
      })
    } catch (err) {
      console.error('Error loading notifications:', err)
      set({ isLoading: false, error: (err as Error).message })
    }
  },

  loadSentInvitations: async (roomId: string) => {
    if (!isSupabaseConfigured || !roomId) return
    const user = useOnlineStore.getState().user
    if (!user) return

    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('listening_room_invitations')
        .select('invitee_id')
        .eq('room_id', roomId)
        .eq('status', 'pending')

      if (error) {
        console.warn('Failed to load sent room invitations:', error.message)
        return
      }

      const invitedUserIds = (data || []).map((row: { invitee_id: string }) => row.invitee_id)
      set((state) => ({
        sentInvitationsByRoom: {
          ...state.sentInvitationsByRoom,
          [roomId]: invitedUserIds
        }
      }))
    } catch (err) {
      console.warn('Error loading sent room invitations:', err)
    }
  },

  sendRoomInvitation: async (roomId: string, inviteeId: string) => {
    if (!isSupabaseConfigured) return { success: false, error: 'Supabase not configured' }
    const user = useOnlineStore.getState().user
    if (!user) return { success: false, error: 'You must be signed in to invite friends' }
    if (user.id === inviteeId) return { success: false, error: 'Cannot invite yourself' }

    try {
      const supabase = getSupabase()

      // Optimistically record in local sentInvitations state
      set((state) => {
        const existing = state.sentInvitationsByRoom[roomId] || []
        if (existing.includes(inviteeId)) return state
        return {
          sentInvitationsByRoom: {
            ...state.sentInvitationsByRoom,
            [roomId]: [...existing, inviteeId]
          }
        }
      })

      // Upsert/insert pending invitation
      const { error } = await supabase.from('listening_room_invitations').upsert(
        {
          room_id: roomId,
          inviter_id: user.id,
          invitee_id: inviteeId,
          status: 'pending',
          updated_at: new Date().toISOString()
        },
        { onConflict: 'room_id,invitee_id' }
      )

      if (error) {
        // Fallback: regular insert if upsert fails on constraint
        const { error: insertErr } = await supabase.from('listening_room_invitations').insert({
          room_id: roomId,
          inviter_id: user.id,
          invitee_id: inviteeId,
          status: 'pending'
        })
        if (insertErr) {
          throw insertErr
        }
      }

      return { success: true }
    } catch (err) {
      console.error('Failed to send room invitation:', err)
      return { success: false, error: (err as Error).message }
    }
  },

  acceptRoomInvitation: async (invitationId: string) => {
    if (!isSupabaseConfigured) return
    try {
      const supabase = getSupabase()
      // Optimistically remove from state
      set((state) => ({
        invitations: state.invitations.filter((i) => i.id !== invitationId),
        activeToast: state.activeToast?.id === invitationId ? null : state.activeToast
      }))

      await supabase
        .from('listening_room_invitations')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', invitationId)
    } catch (err) {
      console.error('Failed to accept room invitation:', err)
    }
  },

  declineRoomInvitation: async (invitationId: string) => {
    if (!isSupabaseConfigured) return
    try {
      const supabase = getSupabase()
      // Optimistically remove from state
      set((state) => ({
        invitations: state.invitations.filter((i) => i.id !== invitationId),
        activeToast: state.activeToast?.id === invitationId ? null : state.activeToast
      }))

      await supabase
        .from('listening_room_invitations')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('id', invitationId)
    } catch (err) {
      console.error('Failed to decline room invitation:', err)
    }
  },

  dismissToast: () => set({ activeToast: null }),

  subscribe: (userId: string) => {
    if (!isSupabaseConfigured || !userId) return () => {}

    if (activeChannel) {
      const supabase = getSupabase()
      void supabase.removeChannel(activeChannel)
      activeChannel = null
    }

    const supabase = getSupabase()
    const channelName = `user-notifications:${userId}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_room_invitations',
          filter: `invitee_id=eq.${userId}`
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const newInv = payload.new as ListeningRoomInvitation
            if (newInv.status === 'pending') {
              // Fetch inviter profile and room details
              let inviter = get().profiles[newInv.inviter_id]
              let room = get().rooms[newInv.room_id]

              try {
                if (!inviter) {
                  const { data: pData } = await supabase
                    .from('profiles')
                    .select('id, username, display_name, avatar_url')
                    .eq('id', newInv.inviter_id)
                    .maybeSingle()
                  if (pData) {
                    inviter = pData as ProfilePreview
                    set((s) => ({ profiles: { ...s.profiles, [pData.id]: inviter } }))
                  }
                }

                if (!room) {
                  const { data: rData } = await supabase
                    .from('listening_rooms')
                    .select('id, code, name, is_active, song, is_playing')
                    .eq('id', newInv.room_id)
                    .maybeSingle()
                  if (rData) {
                    room = rData as RoomPreview
                    set((s) => ({ rooms: { ...s.rooms, [rData.id]: room } }))
                  }
                }
              } catch {
                // Ignore fetch errors
              }

              const hydratedInv: ListeningRoomInvitation = {
                ...newInv,
                inviter,
                room
              }

              // Play announcement sound for real-time invitation alert
              playAnnouncementSound()

              set((state) => {
                const exists = state.invitations.some((i) => i.id === newInv.id)
                return {
                  invitations: exists
                    ? state.invitations
                    : [hydratedInv, ...state.invitations],
                  activeToast: hydratedInv
                }
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ListeningRoomInvitation
            if (updated.status !== 'pending') {
              set((state) => ({
                invitations: state.invitations.filter((i) => i.id !== updated.id),
                activeToast: state.activeToast?.id === updated.id ? null : state.activeToast
              }))
            }
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as { id: string }
            set((state) => ({
              invitations: state.invitations.filter((i) => i.id !== deleted.id),
              activeToast: state.activeToast?.id === deleted.id ? null : state.activeToast
            }))
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `addressee_id=eq.${userId}`
        },
        () => {
          void get().loadNotifications()
        }
      )
      .subscribe()

    activeChannel = channel

    // Initial load
    void get().loadNotifications()

    return () => {
      if (activeChannel) {
        void supabase.removeChannel(activeChannel)
        activeChannel = null
      }
    }
  }
}))
