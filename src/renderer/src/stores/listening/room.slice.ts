import type { StateCreator } from 'zustand'
import { RoomNotFoundError } from './types'
import type { RoomSlice, ListeningStoreState } from './types'
import type { ListeningRoom, RoomMember, RoomMemberRole, SpeakerRole, SharedSong } from '../../online/types'
import { getSupabase } from '../../lib/supabase'
import { useOnlineStore } from '../useOnlineStore'
import { usePlayerStore } from '../player/usePlayerStore'
import { useConnectedDeviceStore } from '../useConnectedDeviceStore'
import { useDspStore } from '../useDspStore'
import { ensureTrackInAudioBucket, pruneAudioBucket } from '../../lib/audioBucketService'
import { getActiveAudioTime } from '../../lib/audioBridge'
import { playParticipantLeaveSound } from '../../lib/uiSounds'
import {
  _activeAudioHost,
  setActiveAudioHost,
  _cachedRemoteControlInfo,
  updateCachedRemoteControlInfo,
  _ensureLock,
  setEnsureLock,
  makeCode,
  toSharedSong,
  readInitialDiscordPriority,
  savePreJoinPlayerSnapshot,
  _roomClosureSender
} from './helpers'

export const createRoomSlice: StateCreator<
  ListeningStoreState,
  [],
  [],
  RoomSlice
> = (set, get) => ({
  hostRoom: null,
  joinedRoom: null,
  hostRoomStopped: true,
  isJoiningRoom: false,
  memberCount: 0,
  isLoading: false,
  error: null,
  myRole: null,
  members: [],
  pendingLeaveAndPlay: null,
  discordPriorityEnabled: readInitialDiscordPriority(),
  liveFriendRooms: {},

  setLiveFriendRooms: (liveFriendRooms) => set({ liveFriendRooms }),
  setHostRoom: (hostRoom) => set({ hostRoom }),
  setJoinedRoom: (joinedRoom) =>
    set((state) => {
      if (!joinedRoom) return { joinedRoom: null }
      const prev = state.joinedRoom
      const effectiveQueue =
        Array.isArray(joinedRoom.queue) && joinedRoom.queue.length > 0
          ? joinedRoom.queue
          : (prev?.queue && prev.queue.length > 0 ? prev.queue : [])
      const effectiveSong = joinedRoom.song || prev?.song || null

      return {
        joinedRoom: {
          ...(prev || {}),
          ...joinedRoom,
          queue: effectiveQueue,
          song: effectiveSong
        }
      }
    }),
  setMemberCount: (memberCount) => set({ memberCount }),
  setError: (error) => set({ error }),
  setMyRole: (myRole) => set({ myRole }),
  setMembers: (members) => set({ members }),
  setPendingLeaveAndPlay: (pendingLeaveAndPlay) => set({ pendingLeaveAndPlay }),

  confirmLeaveAndPlay: async () => {
    const action = get().pendingLeaveAndPlay
    set({ pendingLeaveAndPlay: null })
    await get().leaveJoinedRoom()
    if (action) {
      action()
    }
  },

  cancelLeaveAndPlay: () => {
    set({ pendingLeaveAndPlay: null })
  },

  fetchMembers: async (roomId: string) => {
    try {
      const supabase = getSupabase()
      const { data: memberRows, error: memberErr } = await supabase
        .from('listening_room_members')
        .select('room_id, user_id, role, joined_at, speaker_role, sub_cutoff')
        .eq('room_id', roomId)

      if (memberErr || !memberRows) return

      const userIds = memberRows.map((m: any) => m.user_id)
      if (userIds.length === 0) {
        set({ members: [], memberCount: 0 })
        return
      }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

      const fullMembers: RoomMember[] = memberRows.map((m: any) => ({
        room_id: m.room_id,
        user_id: m.user_id,
        role: (m.role as RoomMemberRole) || 'listener',
        speaker_role: (m.speaker_role as SpeakerRole) || 'center',
        sub_cutoff: typeof m.sub_cutoff === 'number' ? m.sub_cutoff : 120,
        joined_at: m.joined_at,
        display_name: profileMap.get(m.user_id)?.display_name,
        avatar_url: profileMap.get(m.user_id)?.avatar_url
      }))

      set({ members: fullMembers, memberCount: fullMembers.length })

      const currentUserId = useOnlineStore.getState().user?.id
      if (currentUserId) {
        const me = fullMembers.find((m) => m.user_id === currentUserId)
        if (me) {
          set({ myRole: me.role })
          if (me.speaker_role) {
            useDspStore.getState().setSpeakerRole(me.speaker_role)
          }
          if (typeof me.sub_cutoff === 'number') {
            useDspStore.getState().setSubCutoff(me.sub_cutoff)
          }
        }
      }
    } catch (err) {
      console.warn('Failed to fetch members:', err)
    }
  },

  setMySpeakerRole: async (role: SpeakerRole, subCutoff?: number) => {
    useDspStore.getState().setSpeakerRole(role)
    if (typeof subCutoff === 'number') {
      useDspStore.getState().setSubCutoff(subCutoff)
    }

    const activeRoom = get().hostRoom || get().joinedRoom
    if (!activeRoom?.id) return

    const cutoffVal = typeof subCutoff === 'number' ? subCutoff : (useDspStore.getState().subCutoff || 120)
    try {
      const supabase = getSupabase()
      const { error } = await supabase.rpc('set_my_speaker_role', {
        target_room_id: activeRoom.id,
        new_speaker_role: role,
        new_sub_cutoff: cutoffVal
      })
      if (error) {
        console.warn('[useListeningStore] Failed to persist speaker role to room:', error)
      }
      await get().fetchMembers(activeRoom.id)
    } catch (err) {
      console.warn('[useListeningStore] setMySpeakerRole error:', err)
    }
  },

  setMemberSpeakerRole: async (userId: string, role: SpeakerRole, subCutoff?: number) => {
    const activeRoom = get().hostRoom || get().joinedRoom
    if (!activeRoom?.id) return

    const cutoffVal = typeof subCutoff === 'number' ? subCutoff : 120
    const supabase = getSupabase()
    const { error } = await supabase.rpc('set_room_member_speaker_role', {
      target_room_id: activeRoom.id,
      target_user_id: userId,
      new_speaker_role: role,
      new_sub_cutoff: cutoffVal
    })
    if (error) {
      console.error('[useListeningStore] Failed to change member speaker role:', error)
      throw error
    }
    await get().fetchMembers(activeRoom.id)
  },

  promoteMember: async (userId: string, role: 'co_host' | 'listener') => {
    const activeRoom = get().hostRoom || get().joinedRoom
    if (!activeRoom) return
    const supabase = getSupabase()
    const { error } = await supabase.rpc('set_room_member_role', {
      target_room_id: activeRoom.id,
      target_user_id: userId,
      new_role: role
    })
    if (error) {
      console.error('Failed to change member role:', error)
      throw error
    }
    await get().fetchMembers(activeRoom.id)
  },

  kickMember: async (userId: string) => {
    const activeRoom = get().hostRoom || get().joinedRoom
    if (!activeRoom) return
    const supabase = getSupabase()
    const { error } = await supabase.rpc('kick_room_member', {
      target_room_id: activeRoom.id,
      target_user_id: userId
    })
    if (error) {
      console.error('Failed to kick member:', error)
      throw error
    }
    await get().fetchMembers(activeRoom.id)
    await get().refreshMemberCount(activeRoom.id)
  },

  setDiscordPriorityEnabled: (enabled: boolean) => {
    try {
      localStorage.setItem('felo:discord-priority-enabled', enabled ? 'true' : 'false')
    } catch {
      // ignore
    }
    set({ discordPriorityEnabled: enabled })
    if (get().hostRoom) {
      void get().ensureHostRoom(true)
    }
  },

  refreshMemberCount: async (roomId: string) => {
    try {
      const { count } = await getSupabase()
        .from('listening_room_members')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', roomId)
      const memberCount = count || 0
      set({ memberCount })
    } catch {
      // ignore
    }
  },

  ensureHostRoom: async (enabled: boolean, forceNew = false, preferredCode?: string): Promise<ListeningRoom | null> => {
    if (_ensureLock) return get().hostRoom
    setEnsureLock(true)

    const onlineState = useOnlineStore.getState()
    const user = onlineState.user
    const profile = onlineState.profile
    if (!user || !enabled) {
      setEnsureLock(false)
      await get().deactivateHostRoom()
      return null
    }

    const joinedRoom = get().joinedRoom
    if (get().isJoiningRoom) {
      setEnsureLock(false)
      return null
    }

    if (joinedRoom && joinedRoom.host_id !== user.id) {
      if (forceNew) {
        await get().leaveJoinedRoom()
      } else {
        setEnsureLock(false)
        return null
      }
    }

    const playerState = usePlayerStore.getState()
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const supabase = getSupabase()

    try {
      let remoteControlInfo: { ip?: string; port: number; token: string } | null = null
      if (typeof window !== 'undefined' && window.api?.getRemoteControlInfo) {
        try {
          remoteControlInfo = await window.api.getRemoteControlInfo()
        } catch {}
      }
      if (remoteControlInfo) {
        updateCachedRemoteControlInfo(remoteControlInfo)
      }

      if (currentSong) {
        void ensureTrackInAudioBucket(currentSong)
      }

      const upcomingQueue = playerState.queue
        .slice(playerState.currentSongIndex, playerState.currentSongIndex + 100)
        .map((s) => toSharedSong(s, remoteControlInfo))

      const isDeviceSharing = get().isDeviceAudioSharing
      const deviceSong: SharedSong = currentSong
        ? {
            ...toSharedSong(currentSong, remoteControlInfo),
            isDeviceStream: true,
            streamType: 'device_audio',
            discordPriorityEnabled: get().discordPriorityEnabled
          }
        : {
            title: 'Live System Audio',
            artist: profile?.display_name || user.email?.split('@')[0] || 'Host',
            album: 'Device Audio Stream',
            isDeviceStream: true,
            streamType: 'device_audio',
            discordPriorityEnabled: get().discordPriorityEnabled
          }

      const currentAudioTime = getActiveAudioTime()
      const livePosition = currentAudioTime > 0 ? currentAudioTime : playerState.currentTime || 0

      const baseSong = currentSong ? toSharedSong(currentSong, remoteControlInfo) : null
      const effectiveSong = isDeviceSharing ? deviceSong : baseSong

      const existingRoom = get().hostRoom
      let activeRoom: ListeningRoom | null = null

      // 1. If we already have a host room in memory and forceNew is false, keep it updated in Supabase
      if (existingRoom && !forceNew) {
        const { data: updatedRoom, error: updateError } = await supabase
          .from('listening_rooms')
          .update({
            name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s Room`,
            is_active: true,
            is_playing: playerState.isPlaying,
            position_seconds: Math.round(livePosition),
            song: effectiveSong,
            queue: upcomingQueue,
            is_device_stream: isDeviceSharing,
            is_track_streaming: get().isAutoStreamingToListeners,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingRoom.id)
          .select('*')
          .maybeSingle()

        if (!updateError && updatedRoom && updatedRoom.is_active) {
          activeRoom = updatedRoom as ListeningRoom
        } else if (updatedRoom && !updatedRoom.is_active) {
          console.warn('[ensureHostRoom] Host room was marked inactive in database')
          set({ hostRoom: null, hostRoomStopped: true })
        } else if (updateError) {
          console.warn('[ensureHostRoom] Host room heartbeat update network blip, preserving existing room:', updateError)
          activeRoom = existingRoom
        }
      }

      // 2. If forceNew is false and there is no active host room in memory:
      // DO NOT AUTO-CREATE OR AUTO-RESURRECT REMOTE ROOMS!
      // Rooms must be created manually by the user clicking "Create Room Now".
      if (!existingRoom && !forceNew) {
        setEnsureLock(false)
        return null
      }

      // 4. If forceNew is true: manual room creation
      if (!activeRoom) {
        // Deactivate any prior active room for this user before creating a new one
        await supabase
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
          .eq('host_id', user.id)

        let code = preferredCode || makeCode()
        let createdRoom: any = null
        let lastError: any = null

        for (let i = 0; i < 5; i++) {
          const { data: newRoom, error: createError } = await supabase
            .from('listening_rooms')
            .insert({
              host_id: user.id,
              code,
              name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s Room`,
              is_active: true,
              is_playing: playerState.isPlaying,
              position_seconds: Math.round(livePosition),
              song: effectiveSong,
              queue: upcomingQueue,
              is_device_stream: isDeviceSharing,
              is_track_streaming: get().isAutoStreamingToListeners
            })
            .select('*')
            .single()

          if (!createError && newRoom) {
            createdRoom = newRoom
            break
          }

          // Fallback if schema does not support optional columns
          if (createError?.code === '42703' || createError?.message?.includes('column')) {
            const { data: fallbackRoom, error: fbError } = await supabase
              .from('listening_rooms')
              .insert({
                host_id: user.id,
                code,
                name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s Room`,
                is_active: true,
                is_playing: playerState.isPlaying,
                position_seconds: Math.round(livePosition),
                song: effectiveSong
              })
              .select('*')
              .single()

            if (!fbError && fallbackRoom) {
              createdRoom = fallbackRoom
              break
            }
          }

          lastError = createError
          console.warn(`[ensureHostRoom] Insert attempt ${i + 1} failed:`, createError)
          code = makeCode()
        }

        if (!createdRoom) {
          throw lastError || new Error('Failed to create host room')
        }
        activeRoom = createdRoom as ListeningRoom
      }

      const currentSpeakerRole = useDspStore.getState().speakerRole || 'center'
      const currentSubCutoff = useDspStore.getState().subCutoff || 120
      const { error: upsertErr } = await supabase
        .from('listening_room_members')
        .upsert(
          {
            room_id: activeRoom.id,
            user_id: user.id,
            role: 'host',
            speaker_role: currentSpeakerRole,
            sub_cutoff: currentSubCutoff
          },
          { onConflict: 'room_id,user_id' }
        )

      if (upsertErr) {
        console.warn('[ensureHostRoom] Member upsert fallback:', upsertErr.message)
        await supabase
          .from('listening_room_members')
          .upsert(
            {
              room_id: activeRoom.id,
              user_id: user.id
            },
            { onConflict: 'room_id,user_id' }
          )
      }

      set({ hostRoom: activeRoom, hostRoomStopped: false, error: null, myRole: 'host' })
      void get().refreshMemberCount(activeRoom.id)
      void get().fetchMembers(activeRoom.id)

      return activeRoom
    } catch (err: any) {
      console.error('Failed to ensure host room:', err)
      set({ error: err?.message || 'Failed to initialize listening room' })
      return null
    } finally {
      setEnsureLock(false)
    }
  },

  listenAlongWithFriend: async (friendId: string): Promise<ListeningRoom> => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to listen along with a friend.')

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering' })
    const supabase = getSupabase()

    try {
      let targetRoom: any = null
      const { data: hostRoomData, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('host_id', friendId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (findError) throw findError
      if (hostRoomData) {
        targetRoom = hostRoomData
      } else {
        const { data: memberRows, error: memberErr } = await supabase
          .from('listening_room_members')
          .select('room_id')
          .eq('user_id', friendId)
          .limit(5)

        if (!memberErr && memberRows && memberRows.length > 0) {
          const memberRoomIds = memberRows.map((m: any) => m.room_id).filter(Boolean)
          if (memberRoomIds.length > 0) {
            const { data: activeJoinedRooms } = await supabase
              .from('listening_rooms')
              .select('*')
              .in('id', memberRoomIds)
              .eq('is_active', true)
              .order('updated_at', { ascending: false })
              .limit(1)
            if (activeJoinedRooms && activeJoinedRooms.length > 0) {
              targetRoom = activeJoinedRooms[0]
            }
          }
        }
      }

      if (!targetRoom) {
        const notFoundErr = new RoomNotFoundError('This friend is not in an active party room right now.', friendId)
        set({ error: notFoundErr.message, syncStatus: 'idle' })
        throw notFoundErr
      }

      return await get().joinRoomById(targetRoom.id)
    } catch (err: any) {
      set({ syncStatus: 'idle', error: err?.message || 'Failed to connect to friend session.' })
      throw err
    } finally {
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

  joinRoomById: async (roomId: string): Promise<ListeningRoom> => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    const cleanRoomId = (roomId || '').trim()
    if (!cleanRoomId) {
      const err = new RoomNotFoundError('Room ID is required.')
      set({ error: err.message, syncStatus: 'idle' })
      throw err
    }

    // 1. Check if already inside this room
    const currentJoined = get().joinedRoom
    if (currentJoined && currentJoined.id === cleanRoomId && currentJoined.is_active) {
      return currentJoined
    }
    const currentHost = get().hostRoom
    if (currentHost && currentHost.id === cleanRoomId && currentHost.is_active) {
      return currentHost
    }

    const prevHostId = currentHost?.id
    const prevJoinedId = currentJoined?.id

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering' })
    const supabase = getSupabase()

    try {
      const { data: targetRoom, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('id', cleanRoomId)
        .eq('is_active', true)
        .maybeSingle()

      if (findError) {
        set({ error: findError.message, syncStatus: 'idle' })
        throw findError
      }
      if (!targetRoom) {
        const notFoundErr = new RoomNotFoundError('This listening session is no longer active or does not exist.', cleanRoomId)
        set({ error: notFoundErr.message, syncStatus: 'idle' })
        throw notFoundErr
      }

      if (targetRoom.host_id !== user.id) {
        if (!currentJoined) {
          // If entering a room as a join user from standalone local playback:
          // Snapshot the participant's local player state so we can cleanly restore it when they leave!
          const localPlayer = usePlayerStore.getState()
          if (localPlayer.queue && localPlayer.queue.length > 0) {
            savePreJoinPlayerSnapshot({
              queue: [...localPlayer.queue],
              currentSongIndex: localPlayer.currentSongIndex,
              currentTime: localPlayer.currentTime || 0,
              volume: localPlayer.volume,
              isPlaying: localPlayer.isPlaying
            })
          } else {
            savePreJoinPlayerSnapshot(null)
          }
        }

        if (prevJoinedId && prevJoinedId !== targetRoom.id) {
          get().cleanupOnLeave()
          void supabase
            .from('listening_room_members')
            .delete()
            .eq('room_id', prevJoinedId)
            .eq('user_id', user.id)
        }

        // Cleanly deactivate any previous active host room owned by this user
        if (prevHostId && prevHostId !== targetRoom.id) {
          await supabase
            .from('listening_rooms')
            .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
            .eq('id', prevHostId)
            .eq('host_id', user.id)
        } else {
          await supabase
            .from('listening_rooms')
            .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
            .eq('host_id', user.id)
            .eq('is_active', true)
            .neq('id', targetRoom.id)
        }

        const currentSpeakerRole = useDspStore.getState().speakerRole || 'center'
        const currentSubCutoff = useDspStore.getState().subCutoff || 120
        const { error: memberError } = await supabase
          .from('listening_room_members')
          .upsert(
            {
              room_id: targetRoom.id,
              user_id: user.id,
              speaker_role: currentSpeakerRole,
              sub_cutoff: currentSubCutoff
            },
            { onConflict: 'room_id,user_id', ignoreDuplicates: true }
          )

        if (memberError) {
          console.warn('[joinRoomById] Member upsert with speaker_role failed, trying fallback:', memberError.message)
          const { error: fallbackError } = await supabase
            .from('listening_room_members')
            .upsert(
              {
                room_id: targetRoom.id,
                user_id: user.id
              },
              { onConflict: 'room_id,user_id', ignoreDuplicates: true }
            )
          if (fallbackError) {
            console.warn('[joinRoomById] Member upsert fallback notice:', fallbackError.message)
          }
        }

        const { data: memberData } = await supabase
          .from('listening_room_members')
          .select('role')
          .eq('room_id', targetRoom.id)
          .eq('user_id', user.id)
          .maybeSingle()

        const assignedRole = (memberData?.role as RoomMemberRole) || 'listener'

        set({
          joinedRoom: targetRoom as ListeningRoom,
          hostRoom: null,
          hostRoomStopped: true,
          lastHostUpdate: Date.now(),
          myRole: assignedRole
        })
        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
        useConnectedDeviceStore.getState().claimPlayback()
        usePlayerStore.getState().claimAudioOwnership()
        usePlayerStore.setState({ isAudioActive: true })
        await get().handleHostSongChange(targetRoom as ListeningRoom)
      } else {
        set({ hostRoom: targetRoom as ListeningRoom, joinedRoom: null, hostRoomStopped: false, syncStatus: 'idle', myRole: 'host' })
      }

      void get().refreshMemberCount(targetRoom.id)
      void get().fetchMembers(targetRoom.id)
      return targetRoom as ListeningRoom
    } catch (err: any) {
      set({ syncStatus: 'idle' })
      throw err
    } finally {
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

  joinRoomByCode: async (code: string): Promise<ListeningRoom> => {
    const cleanCode = (code || '').trim().toUpperCase()
    if (!cleanCode) throw new Error('Please enter a room code.')

    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    // 1. Check if already inside this room
    const currentJoined = get().joinedRoom
    if (currentJoined && currentJoined.code === cleanCode && currentJoined.is_active) {
      return currentJoined
    }
    const currentHost = get().hostRoom
    if (currentHost && currentHost.code === cleanCode && currentHost.is_active) {
      return currentHost
    }

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering' })
    const supabase = getSupabase()

    try {
      const { data: targetRoom, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('code', cleanCode)
        .eq('is_active', true)
        .maybeSingle()

      if (findError) {
        set({ error: findError.message, syncStatus: 'idle' })
        throw findError
      }
      if (!targetRoom) {
        const notFoundErr = new RoomNotFoundError(`No active room found with code "${cleanCode}".`, cleanCode)
        set({ error: notFoundErr.message, syncStatus: 'idle' })
        throw notFoundErr
      }

      return await get().joinRoomById(targetRoom.id)
    } catch (err: any) {
      set({ syncStatus: 'idle', error: err?.message || 'Failed to join room.' })
      throw err
    } finally {
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

  leaveJoinedRoom: async () => {
    const user = useOnlineStore.getState().user
    const joined = get().joinedRoom

    get().cleanupOnLeave()
    playParticipantLeaveSound()
    set({ hostRoomStopped: true, myRole: null, members: [], pendingLeaveAndPlay: null })

    if (!user || !joined) return

    set({ isLoading: true })
    const supabase = getSupabase()

    try {
      usePlayerStore.getState().setIsPlaying(false)

      await supabase
        .from('listening_room_members')
        .delete()
        .eq('room_id', joined.id)
        .eq('user_id', user.id)
    } catch (err: any) {
      console.error('Failed to leave room:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  deactivateHostRoom: async () => {
    const user = useOnlineStore.getState().user
    _roomClosureSender?.()
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      setActiveAudioHost(null)
    }
    set({ isDeviceAudioSharing: false, isAutoStreamingToListeners: false, deviceAudioLevel: 0, deviceAudioPeerCount: 0 })
    if (!user) return

    try {
      const supabase = getSupabase()
      const currentHostRoom = get().hostRoom
      if (currentHostRoom?.id) {
        await supabase
          .from('listening_room_members')
          .delete()
          .eq('room_id', currentHostRoom.id)
      }
      await supabase
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
        .eq('host_id', user.id)
        .eq('is_active', true)
      set({ hostRoom: null, hostRoomStopped: true, myRole: null })
    } catch {
      // best effort cleanup during logout/unmount
    }
  },

  stopHostRoom: async () => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    const roomId = hostRoom?.id

    _roomClosureSender?.()
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      setActiveAudioHost(null)
    }
    set({ isDeviceAudioSharing: false, isAutoStreamingToListeners: false, deviceAudioLevel: 0, deviceAudioPeerCount: 0 })

    set({ hostRoom: null, hostRoomStopped: true })

    if (!user || !roomId) return

    const supabase = getSupabase()
    try {
      await supabase
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
        .eq('id', roomId)
        .eq('host_id', user.id)

      await supabase
        .from('listening_room_members')
        .delete()
        .eq('room_id', roomId)
    } catch (err) {
      console.warn('Error deactivating host room:', err)
    }
  },

  startHostRoom: async () => {
    set({ hostRoomStopped: false })
    void pruneAudioBucket()
    return get().ensureHostRoom(true, true)
  },

  createHostRoom: async (preferredCode?: string) => {
    set({ hostRoomStopped: false })
    void pruneAudioBucket()
    return get().ensureHostRoom(true, true, preferredCode)
  },

  transferHost: async (newHostId: string): Promise<void> => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    if (!user || !hostRoom || hostRoom.host_id !== user.id) {
      throw new Error('Only the current host can transfer hosting.')
    }

    const { data: updatedRoom, error } = await getSupabase().rpc('transfer_listening_room_host', {
      target_room_id: hostRoom.id,
      new_host_id: newHostId
    })

    if (error) {
      if (error.code === 'PGRST202') {
        throw new Error(
          'Host transfer is not enabled on the server yet. Apply supabase/migrations/0003_listening_room_host_transfer.sql, then try again.'
        )
      }
      throw error
    }

    if (!updatedRoom) throw new Error('The server did not return the transferred room.')

    set({
      hostRoom: null,
      joinedRoom: { ...(updatedRoom as ListeningRoom), host_id: newHostId },
      syncStatus: 'buffering'
    })
  }
})
