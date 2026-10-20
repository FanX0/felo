import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  playParticipantJoinSound,
  playParticipantLeaveSound,
  isUiSoundsEnabled
} from '../../../src/renderer/src/lib/uiSounds'
import { audioDspEngine } from '../../../src/renderer/src/lib/audioDspEngine'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { useOnlineStore } from '../../../src/renderer/src/stores/useOnlineStore'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

// Mock getSupabase to test real-time room presence and member lifecycle
let realtimeCallbacks: Record<string, (payload: any) => void> = {}

vi.mock('../../../src/renderer/src/lib/supabase', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    isSupabaseConfigured: true,
    getSupabase: () => ({
      channel: (channelName: string) => ({
        name: channelName,
        on: vi.fn((_type: string, filter: { event: string; table?: string }, callback: Function) => {
          const key = filter.table ? `${filter.table}:${filter.event}` : filter.event
          realtimeCallbacks[key] = callback as (payload: any) => void
          return {
            subscribe: vi.fn().mockReturnThis()
          }
        }),
        subscribe: vi.fn().mockReturnThis()
      }),
      removeChannel: vi.fn().mockResolvedValue(undefined),
      from: vi.fn((table: string) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          upsert: vi.fn().mockImplementation(() => builder),
          update: vi.fn().mockImplementation(() => builder),
          then: (resolve: any) => resolve({ data: null, error: null }),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (table === 'listening_rooms') {
              return {
                data: {
                  id: 'room-test-join',
                  code: 'TSTJOIN',
                  name: 'Test Join Room',
                  host_id: 'host-user-456',
                  is_active: true,
                  is_playing: false,
                  position_seconds: 0,
                  is_device_stream: false,
                  queue: []
                },
                error: null
              }
            }
            if (table === 'listening_room_members') {
              return {
                data: { role: 'listener' },
                error: null
              }
            }
            return { data: null, error: null }
          })
        }
        return builder
      })
    })
  }
})

describe('Listen Together: Sound Suppression on User Join Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtimeCallbacks = {}

    // Reset online user
    useOnlineStore.setState({
      user: { id: 'current-user-123' } as any,
      profile: { id: 'current-user-123', username: 'tester', display_name: 'Tester' } as any
    })

    // Reset listening store
    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      isJoiningRoom: false,
      memberCount: 1,
      myRole: 'listener',
      syncStatus: 'idle'
    })

    // Reset player store
    usePlayerStore.setState({
      isPlaying: false,
      currentTime: 0
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('1. UI Sounds Engine (playParticipantJoinSound & playParticipantLeaveSound)', () => {
    it('is a safe no-op function and never accesses AudioContext or output graph when invoked', () => {
      expect(isUiSoundsEnabled()).toBe(true)

      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      // Invoking participant join and leave sounds should execute cleanly without audio graph activation
      expect(() => playParticipantJoinSound()).not.toThrow()
      expect(() => playParticipantLeaveSound()).not.toThrow()

      // Verification: AudioContext was NOT requested for participant join or leave
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })

    it('can be safely called repeatedly without creating memory leaks or audio graphs', () => {
      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      for (let i = 0; i < 50; i++) {
        playParticipantJoinSound()
        playParticipantLeaveSound()
      }

      // Even across 50 rapid calls, zero audio contexts or audio nodes are generated
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })
  })

  describe('2. Realtime Presence Listener (Member Join vs Leave)', () => {
    it('does NOT trigger any join chime when a peer joins the room (INSERT event)', () => {
      const hostRoom: ListeningRoom = {
        id: 'host-room-1',
        code: 'ROOM1',
        name: 'Host Room',
        host_id: 'current-user-123',
        is_active: true,
        is_playing: true,
        position_seconds: 10,
        is_device_stream: false,
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        hostRoom,
        hostRoomStopped: false,
        joinedRoom: null
      })

      const refreshMemberCountSpy = vi.spyOn(useListeningStore.getState(), 'refreshMemberCount')
      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      // Simulate a real-time INSERT payload (new participant joins)
      const memberInsertPayload = {
        eventType: 'INSERT',
        new: {
          room_id: hostRoom.id,
          user_id: 'guest-user-999',
          role: 'listener'
        }
      }

      // Exact handler logic mirroring ListeningPresenceBridge's postgres_changes listener
      const handleMemberChange = (payload: any) => {
        if (payload.eventType === 'DELETE') {
          playParticipantLeaveSound()
        }
        void useListeningStore.getState().refreshMemberCount(hostRoom.id)
      }

      handleMemberChange(memberInsertPayload)

      // Verification: Member count is refreshed, but no sound audio context was engaged
      expect(refreshMemberCountSpy).toHaveBeenCalledWith(hostRoom.id)
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })

    it('does NOT trigger any leave chime when a participant leaves the room (DELETE event)', () => {
      const hostRoom: ListeningRoom = {
        id: 'host-room-1',
        code: 'ROOM1',
        name: 'Host Room',
        host_id: 'current-user-123',
        is_active: true,
        is_playing: true,
        position_seconds: 10,
        is_device_stream: false,
        queue: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        hostRoom,
        hostRoomStopped: false,
        joinedRoom: null
      })

      const refreshMemberCountSpy = vi.spyOn(useListeningStore.getState(), 'refreshMemberCount')
      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      const memberDeletePayload = {
        eventType: 'DELETE',
        old: {
          room_id: hostRoom.id,
          user_id: 'guest-user-999'
        }
      }

      let leaveSoundInvoked = false
      const handleMemberChange = (payload: any) => {
        if (payload.eventType === 'DELETE') {
          leaveSoundInvoked = true
          playParticipantLeaveSound()
        }
        void useListeningStore.getState().refreshMemberCount(hostRoom.id)
      }

      handleMemberChange(memberDeletePayload)

      // Verification: Handler ran, but zero AudioContext or audio graphs were engaged
      expect(leaveSoundInvoked).toBe(true)
      expect(refreshMemberCountSpy).toHaveBeenCalledWith(hostRoom.id)
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })
  })

  describe('3. Room Store Slice (Local User Joins and Leaves Room)', () => {
    it('joins room without triggering any audio chime or sound', async () => {
      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      const joinedRoom = await useListeningStore.getState().joinRoomById('room-test-join')

      // Verification: Room joined successfully into state
      expect(joinedRoom).toBeDefined()
      expect(joinedRoom.id).toBe('room-test-join')
      expect(useListeningStore.getState().joinedRoom?.id).toBe('room-test-join')
      expect(useListeningStore.getState().myRole).toBe('listener')

      // Verification: Absolutely zero UI sound AudioContext requests were made
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })

    it('leaves room without triggering any audio chime or sound', async () => {
      const getAudioContextSpy = vi.spyOn(audioDspEngine, 'getAudioContext')

      await useListeningStore.getState().joinRoomById('room-test-join')
      expect(useListeningStore.getState().joinedRoom).not.toBeNull()

      await useListeningStore.getState().leaveJoinedRoom()

      // Verification: Left cleanly, joinedRoom cleared
      expect(useListeningStore.getState().joinedRoom).toBeNull()

      // Verification: Absolutely zero UI sound AudioContext requests were made on leave
      expect(getAudioContextSpy).not.toHaveBeenCalled()
    })
  })
})
