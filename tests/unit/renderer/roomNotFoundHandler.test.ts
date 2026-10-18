import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import {
  useListeningStore,
  RoomNotFoundError,
  isRoomNotFoundError
} from '../../../src/renderer/src/stores/listening'
import { useOnlineStore } from '../../../src/renderer/src/stores/useOnlineStore'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import JoinCodeModal from '../../../src/renderer/src/pages/Online/components/JoinCodeModal'

let mockRoomData: any = null

vi.mock('../../../src/renderer/src/lib/supabase', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    isSupabaseConfigured: true,
    getSupabase: () => ({
      channel: () => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis()
      }),
      removeChannel: vi.fn().mockResolvedValue(undefined),
      from: (table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockImplementation(() => builder),
          update: vi.fn().mockImplementation(() => builder),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (table === 'listening_rooms') {
              return { data: mockRoomData, error: null }
            }
            if (table === 'listening_room_members') {
              return { data: null, error: null }
            }
            return { data: null, error: null }
          }),
          single: vi.fn().mockImplementation(async () => {
            if (table === 'listening_rooms') {
              return { data: mockRoomData, error: null }
            }
            return { data: null, error: null }
          })
        }
        return builder
      }
    })
  }
})

describe('Listening Room Not Found Handling Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoomData = null

    useOnlineStore.setState({
      user: { id: 'test-user-123' } as any,
      profile: { id: 'test-user-123', username: 'tester', display_name: 'Tester' } as any
    })

    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      isJoiningRoom: false,
      memberCount: 0,
      syncStatus: 'idle',
      error: null
    })

    usePlayerStore.setState({
      isPlaying: false,
      currentTime: 0
    })
  })

  describe('1. Error Class and Type Guard', () => {
    it('creates a RoomNotFoundError with code ROOM_NOT_FOUND', () => {
      const err = new RoomNotFoundError('Room not found', 'ABCDEF')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(RoomNotFoundError)
      expect(err.name).toBe('RoomNotFoundError')
      expect(err.code).toBe('ROOM_NOT_FOUND')
      expect(err.identifier).toBe('ABCDEF')
      expect(err.message).toBe('Room not found')
    })

    it('identifies RoomNotFoundError instances and matching error objects with isRoomNotFoundError', () => {
      const err = new RoomNotFoundError('Room not found')
      expect(isRoomNotFoundError(err)).toBe(true)
      expect(isRoomNotFoundError({ code: 'ROOM_NOT_FOUND', message: 'Custom' })).toBe(true)
      expect(isRoomNotFoundError(new Error('Generic error'))).toBe(false)
      expect(isRoomNotFoundError(null)).toBe(false)
      expect(isRoomNotFoundError(undefined)).toBe(false)
    })
  })

  describe('2. joinRoomById Room Not Found Handling', () => {
    it('throws RoomNotFoundError and sets store error when room does not exist in database', async () => {
      mockRoomData = null

      await expect(useListeningStore.getState().joinRoomById('non-existent-id')).rejects.toThrow(
        RoomNotFoundError
      )

      const state = useListeningStore.getState()
      expect(state.error).toContain('This listening session is no longer active')
      expect(state.isJoiningRoom).toBe(false)
      expect(state.syncStatus).toBe('idle')
      expect(state.joinedRoom).toBeNull()
    })

    it('throws RoomNotFoundError if roomId is empty or whitespace', async () => {
      await expect(useListeningStore.getState().joinRoomById('   ')).rejects.toThrow(
        RoomNotFoundError
      )

      const state = useListeningStore.getState()
      expect(state.error).toContain('Room ID is required')
      expect(state.isJoiningRoom).toBe(false)
    })
  })

  describe('3. joinRoomByCode Room Not Found Handling', () => {
    it('throws RoomNotFoundError and sets store error when room code does not exist', async () => {
      mockRoomData = null

      await expect(useListeningStore.getState().joinRoomByCode('NOTFND')).rejects.toThrow(
        RoomNotFoundError
      )

      const state = useListeningStore.getState()
      expect(state.error).toContain('No active room found with code "NOTFND"')
      expect(state.isJoiningRoom).toBe(false)
      expect(state.syncStatus).toBe('idle')
      expect(state.joinedRoom).toBeNull()
    })

    it('successfully joins when room exists and is active', async () => {
      mockRoomData = {
        id: 'room-valid-123',
        code: 'VALID1',
        name: 'Valid Party Room',
        host_id: 'host-user-999',
        is_active: true,
        is_playing: false,
        position_seconds: 0,
        queue: []
      }

      const room = await useListeningStore.getState().joinRoomByCode('VALID1')
      expect(room.id).toBe('room-valid-123')
      expect(useListeningStore.getState().joinedRoom?.id).toBe('room-valid-123')
      expect(useListeningStore.getState().error).toBeNull()
    })
  })

  describe('4. listenAlongWithFriend Room Not Found Handling', () => {
    it('throws RoomNotFoundError when friend has no active listening room', async () => {
      mockRoomData = null

      await expect(useListeningStore.getState().listenAlongWithFriend('friend-123')).rejects.toThrow(
        RoomNotFoundError
      )

      const state = useListeningStore.getState()
      expect(state.error).toContain('This friend is not in an active party room right now')
      expect(state.isJoiningRoom).toBe(false)
      expect(state.syncStatus).toBe('idle')
      expect(state.joinedRoom).toBeNull()
    })
  })

  describe('5. refreshJoinedRoomState Inactive/Deleted Room Handling', () => {
    it('disconnects and clears room state when room becomes inactive or missing', async () => {
      useListeningStore.setState({
        joinedRoom: {
          id: 'room-ended',
          code: 'ENDED1',
          name: 'Ended Room',
          host_id: 'host-1',
          is_active: true,
          position_seconds: 0,
          is_playing: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          song: null
        }
      })

      // Room is now null or inactive in database
      mockRoomData = null

      await useListeningStore.getState().refreshJoinedRoomState()

      const state = useListeningStore.getState()
      expect(state.joinedRoom).toBeNull()
      expect(state.hostRoom).toBeNull()
      expect(state.hostRoomStopped).toBe(true)
    })
  })

  describe('6. JoinCodeModal Error UI Feedback', () => {
    it('displays error alert inside JoinCodeModal when error prop is provided', () => {
      render(
        React.createElement(JoinCodeModal, {
          isOpen: true,
          onClose: vi.fn(),
          joinCodeInput: 'BADCOD',
          setJoinCodeInput: vi.fn(),
          onSubmit: vi.fn(),
          busy: false,
          error: 'No active room found with code "BADCOD".'
        })
      )

      expect(screen.getByText('No active room found with code "BADCOD".')).toBeInTheDocument()
    })

    it('does not display error alert when error is null or undefined', () => {
      render(
        React.createElement(JoinCodeModal, {
          isOpen: true,
          onClose: vi.fn(),
          joinCodeInput: 'ABCDEF',
          setJoinCodeInput: vi.fn(),
          onSubmit: vi.fn(),
          busy: false,
          error: null
        })
      )

      expect(screen.queryByText(/No active room found/i)).toBeNull()
    })
  })
})
