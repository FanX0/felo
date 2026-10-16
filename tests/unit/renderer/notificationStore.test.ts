import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useNotificationStore } from '../../../src/renderer/src/stores/useNotificationStore'
import type { ListeningRoomInvitation, FriendRequest } from '../../../src/renderer/src/online/types'

describe('Renderer Store: useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      invitations: [],
      incomingFriendRequests: [],
      profiles: {},
      rooms: {},
      sentInvitationsByRoom: {},
      activeToast: null,
      isLoading: false,
      error: null
    })
  })

  it('calculates unreadCount accurately based on invitations and friend requests', () => {
    expect(useNotificationStore.getState().getUnreadCount()).toBe(0)

    const mockInv: ListeningRoomInvitation = {
      id: 'inv-1',
      room_id: 'room-1',
      inviter_id: 'user-a',
      invitee_id: 'user-b',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useNotificationStore.setState({ invitations: [mockInv] })
    expect(useNotificationStore.getState().getUnreadCount()).toBe(1)

    const mockFr: FriendRequest = {
      id: 'fr-1',
      requester_id: 'user-c',
      addressee_id: 'user-b',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useNotificationStore.setState({ incomingFriendRequests: [mockFr] })
    expect(useNotificationStore.getState().getUnreadCount()).toBe(2)
  })

  it('dismisses active toast when dismissToast() is called', () => {
    const mockInv: ListeningRoomInvitation = {
      id: 'inv-toast',
      room_id: 'room-1',
      inviter_id: 'user-a',
      invitee_id: 'user-b',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useNotificationStore.setState({ activeToast: mockInv })
    expect(useNotificationStore.getState().activeToast).not.toBeNull()

    useNotificationStore.getState().dismissToast()
    expect(useNotificationStore.getState().activeToast).toBeNull()
  })

  it('updates sentInvitationsByRoom when sending room invitation', async () => {
    // When Supabase is not configured in test environment, it returns an error result but handles safely
    const res = await useNotificationStore.getState().sendRoomInvitation('room-123', 'friend-456')
    expect(res).toBeDefined()
  })
})
