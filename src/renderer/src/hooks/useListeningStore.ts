import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import type { ListeningRoom, SharedSong } from '../online/types'
import type { Song } from '../pages/Library/Library'
import { useOnlineStore } from './useOnlineStore'
import { usePlayerStore } from './usePlayerStore'

function makeCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function toSharedSong(song: Song): SharedSong {
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    artworkUrl: /^https?:\/\//i.test(song.artworkPath || '') ? song.artworkPath : undefined
  }
}

export type SyncStatus = 'idle' | 'synced' | 'missing_song' | 'buffering'

const AUTO_DOWNLOAD_STORAGE_KEY = 'fanxmusic:listen_together:auto_download'

interface ListeningStoreState {
  hostRoom: ListeningRoom | null
  joinedRoom: ListeningRoom | null
  memberCount: number
  isLoading: boolean
  error: string | null

  // Sync engine state
  syncStatus: SyncStatus
  missingSong: SharedSong | null
  lastHostUpdate: number
  autoDownloadMissing: boolean
  substitutes: Record<string, Song> // hostSongKey -> localSong

  // Basic setters
  setHostRoom: (room: ListeningRoom | null) => void
  setJoinedRoom: (room: ListeningRoom | null) => void
  setMemberCount: (count: number) => void
  setError: (error: string | null) => void
  setSyncStatus: (status: SyncStatus) => void
  setAutoDownloadMissing: (enabled: boolean) => void
  setSubstituteSong: (hostSong: SharedSong, localSong: Song | null) => void

  // Room lifecycle
  ensureHostRoom: (enabled: boolean) => Promise<ListeningRoom | null>
  joinRoomById: (roomId: string) => Promise<ListeningRoom>
  joinRoomByCode: (code: string) => Promise<ListeningRoom>
  leaveJoinedRoom: () => Promise<void>
  deactivateHostRoom: () => Promise<void>
  refreshMemberCount: (roomId: string) => Promise<void>

  // Professional sync handlers
  handleHostSongChange: (room: ListeningRoom) => Promise<void>
  handleHostPauseResume: (room: ListeningRoom) => void
  handleHostDisconnect: () => Promise<void>
  transferHost: (newHostId: string) => Promise<void>

  // Cleanup
  cleanupOnLeave: () => void
}

let _ensureLock = false

function getSongKey(song?: SharedSong | null): string {
  if (!song) return ''
  return `${song.artist} - ${song.title}`.trim().toLowerCase()
}

export const useListeningStore = create<ListeningStoreState>((set, get) => ({
  hostRoom: null,
  joinedRoom: null,
  memberCount: 0,
  isLoading: false,
  error: null,
  syncStatus: 'idle',
  missingSong: null,
  lastHostUpdate: 0,
  autoDownloadMissing: localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) !== 'false',
  substitutes: {},

  setHostRoom: (hostRoom) => set({ hostRoom }),
  setJoinedRoom: (joinedRoom) => set({ joinedRoom }),
  setMemberCount: (memberCount) => set({ memberCount }),
  setError: (error) => set({ error }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),

  setAutoDownloadMissing: (enabled: boolean) => {
    localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, String(enabled))
    set({ autoDownloadMissing: enabled })
  },

  setSubstituteSong: (hostSong: SharedSong, localSong: Song | null) => {
    const key = getSongKey(hostSong)
    if (!key) return

    set((state) => {
      const next = { ...state.substitutes }
      if (localSong) {
        next[key] = localSong
      } else {
        delete next[key]
      }
      return { substitutes: next }
    })

    // If currently joined and this was the active missing song, immediately trigger sync
    const joined = get().joinedRoom
    if (joined && getSongKey(joined.song) === key) {
      void get().handleHostSongChange(joined)
    }
  },

  refreshMemberCount: async (roomId: string) => {
    try {
      const { count } = await getSupabase()
        .from('listening_room_members')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', roomId)
      set({ memberCount: count || 0 })
    } catch {
      // ignore
    }
  },

  // ─── HOST ROOM LIFECYCLE ──────────────────────────────────────────

  ensureHostRoom: async (enabled: boolean): Promise<ListeningRoom | null> => {
    if (_ensureLock) return get().hostRoom
    _ensureLock = true

    const onlineState = useOnlineStore.getState()
    const user = onlineState.user
    const profile = onlineState.profile
    if (!user || !enabled) {
      _ensureLock = false
      await get().deactivateHostRoom()
      return null
    }

    if (get().joinedRoom && get().joinedRoom?.host_id !== user.id) {
      _ensureLock = false
      return null
    }

    const playerState = usePlayerStore.getState()
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const supabase = getSupabase()

    try {
      const { data: existing, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('host_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (findError) throw findError

      const roomPayload = {
        name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s room`,
        song: currentSong ? toSharedSong(currentSong) : null,
        position_seconds: Math.round(playerState.currentTime || 0),
        is_playing: Boolean(playerState.isPlaying && currentSong),
        is_active: true,
        updated_at: new Date().toISOString()
      }

      let activeRoom: ListeningRoom

      if (existing) {
        const { data: updated, error: updateError } = await supabase
          .from('listening_rooms')
          .update(roomPayload)
          .eq('id', existing.id)
          .select('*')
          .single()

        if (updateError) throw updateError
        activeRoom = updated as ListeningRoom
      } else {
        let code = makeCode()
        let createdRoom: any = null

        for (let i = 0; i < 3; i++) {
          const { data: created, error: createError } = await supabase
            .from('listening_rooms')
            .insert({
              host_id: user.id,
              code,
              ...roomPayload
            })
            .select('*')
            .single()

          if (!createError) {
            createdRoom = created
            break
          }
          code = makeCode()
        }

        if (!createdRoom) throw new Error('Failed to create host room')
        activeRoom = createdRoom as ListeningRoom
      }

      await supabase
        .from('listening_room_members')
        .upsert({ room_id: activeRoom.id, user_id: user.id })

      set({ hostRoom: activeRoom, error: null })
      void get().refreshMemberCount(activeRoom.id)
      return activeRoom
    } catch (err: any) {
      console.error('Failed to ensure host room:', err)
      set({ error: err?.message || 'Failed to initialize listening room' })
      return null
    } finally {
      _ensureLock = false
    }
  },

  // ─── JOIN ROOM ────────────────────────────────────────────────────

  joinRoomById: async (roomId: string): Promise<ListeningRoom> => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    set({ isLoading: true, error: null, syncStatus: 'buffering' })
    const supabase = getSupabase()

    try {
      const { data: targetRoom, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('id', roomId)
        .eq('is_active', true)
        .maybeSingle()

      if (findError) throw findError
      if (!targetRoom) throw new Error('This listening session is no longer active.')

      if (targetRoom.host_id !== user.id) {
        await supabase
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false })
          .eq('host_id', user.id)

        const { error: memberError } = await supabase
          .from('listening_room_members')
          .upsert({ room_id: targetRoom.id, user_id: user.id })

        if (memberError) throw memberError

        set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null })
        await get().handleHostSongChange(targetRoom as ListeningRoom)
      } else {
        set({ hostRoom: targetRoom as ListeningRoom, joinedRoom: null, syncStatus: 'idle' })
      }

      void get().refreshMemberCount(targetRoom.id)
      return targetRoom as ListeningRoom
    } catch (err: any) {
      set({ syncStatus: 'idle' })
      throw err
    } finally {
      set({ isLoading: false })
    }
  },

  joinRoomByCode: async (code: string): Promise<ListeningRoom> => {
    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode) throw new Error('Please enter a room code.')

    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    set({ isLoading: true, error: null, syncStatus: 'buffering' })
    const supabase = getSupabase()

    try {
      const { data: targetRoom, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('code', cleanCode)
        .eq('is_active', true)
        .maybeSingle()

      if (findError) throw findError
      if (!targetRoom) throw new Error(`No active room found with code "${cleanCode}".`)

      if (targetRoom.host_id !== user.id) {
        await supabase
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false })
          .eq('host_id', user.id)

        const { error: memberError } = await supabase
          .from('listening_room_members')
          .upsert({ room_id: targetRoom.id, user_id: user.id })

        if (memberError) throw memberError
        set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null })
        await get().handleHostSongChange(targetRoom as ListeningRoom)
      } else {
        set({ hostRoom: targetRoom as ListeningRoom, joinedRoom: null, syncStatus: 'idle' })
      }

      void get().refreshMemberCount(targetRoom.id)
      return targetRoom as ListeningRoom
    } catch (err: any) {
      set({ syncStatus: 'idle' })
      throw err
    } finally {
      set({ isLoading: false })
    }
  },

  // ─── LEAVE / DEACTIVATE ───────────────────────────────────────────

  leaveJoinedRoom: async () => {
    const user = useOnlineStore.getState().user
    const joined = get().joinedRoom
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

      get().cleanupOnLeave()
      await get().ensureHostRoom(true)
    } catch (err: any) {
      console.error('Failed to leave room:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  deactivateHostRoom: async () => {
    const user = useOnlineStore.getState().user
    if (!user) return

    try {
      await getSupabase()
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
        .eq('host_id', user.id)
      set({ hostRoom: null })
    } catch {
      // ignore
    }
  },

  // ─── PROFESSIONAL SYNC HANDLERS ───────────────────────────────────

  handleHostSongChange: async (room: ListeningRoom): Promise<void> => {
    const user = useOnlineStore.getState().user
    if (!room.song || room.host_id === user?.id) return

    set({ syncStatus: 'buffering', lastHostUpdate: Date.now() })

    try {
      const playerState = usePlayerStore.getState()
      const songKey = getSongKey(room.song)

      // Step 1: Check if user mapped a custom substitute song for this host track
      const substitute = get().substitutes[songKey]
      if (substitute) {
        let currentQueue = playerState.queue
        let subIndex = currentQueue.findIndex((s) => s.id === substitute.id)
        if (subIndex < 0) {
          currentQueue = [substitute, ...playerState.queue]
          subIndex = 0
        }
        usePlayerStore.getState().setQueue(currentQueue, subIndex)

        const elapsed = room.is_playing
          ? Math.max(0, (Date.now() - new Date(room.updated_at).getTime()) / 1000)
          : 0
        const targetTime = room.position_seconds + elapsed
        if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 2) {
          usePlayerStore.getState().seek(targetTime)
        }
        usePlayerStore.getState().setIsPlaying(room.is_playing)
        set({ syncStatus: 'synced', missingSong: null })
        return
      }

      // Step 2: Try to find exact or fuzzy match in the current queue
      let targetIndex = playerState.queue.findIndex(
        (s) =>
          s.title.toLowerCase() === room.song!.title.toLowerCase() &&
          s.artist.toLowerCase() === room.song!.artist.toLowerCase()
      )
      let targetQueue = playerState.queue

      // Step 3: If not in queue, search full local library
      if (targetIndex < 0) {
        targetQueue = ((await window.api?.getSongs?.()) || []) as Song[]
        targetIndex = targetQueue.findIndex(
          (s) =>
            s.title.toLowerCase() === room.song!.title.toLowerCase() &&
            s.artist.toLowerCase() === room.song!.artist.toLowerCase()
        )
      }

      // Step 4: Song not found locally
      if (targetIndex < 0) {
        usePlayerStore.getState().setIsPlaying(false)
        set({
          syncStatus: 'missing_song',
          missingSong: room.song
        })

        // Step 4b: Auto-download if enabled
        if (get().autoDownloadMissing && room.song) {
          try {
            const query = `${room.song.artist} ${room.song.title}`
            const accounts = (await window.api?.getSetting?.('app_settings:streaming_accounts')) || {}
            let results = await window.api?.searchDownloadSource?.('qobuz', query, accounts)
            let sourceUsed: 'qobuz' | 'deezer' = 'qobuz'
            if (!results || results.length === 0) {
              results = await window.api?.searchDownloadSource?.('deezer', query, accounts)
              sourceUsed = 'deezer'
            }
            const firstHit = results?.[0]
            if (firstHit) {
              await window.api?.startDownload?.({
                transferId: `auto-${Date.now()}`,
                source: sourceUsed,
                resultId: firstHit.id,
                title: firstHit.title || room.song.title,
                artist: firstHit.artist || room.song.artist,
                conflictMode: 'replace',
                accounts
              })
            }
          } catch (autoErr) {
            console.warn('Auto-download background search attempt:', autoErr)
          }
        }

        return
      }

      // Step 5: Song found — switch to it
      const currentPlaying = playerState.queue[playerState.currentSongIndex]
      if (!currentPlaying || currentPlaying.id !== targetQueue[targetIndex].id) {
        usePlayerStore.getState().setQueue(targetQueue, targetIndex)
      }

      // Step 6: Seek to host position (latency compensated)
      const elapsed = room.is_playing
        ? Math.max(0, (Date.now() - new Date(room.updated_at).getTime()) / 1000)
        : 0
      const targetTime = room.position_seconds + elapsed
      if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 2) {
        usePlayerStore.getState().seek(targetTime)
      }

      usePlayerStore.getState().setIsPlaying(room.is_playing)
      set({ syncStatus: 'synced', missingSong: null })
    } catch (err) {
      console.error('Sync error during song change:', err)
      set({ syncStatus: 'missing_song', missingSong: room.song })
    }
  },

  handleHostPauseResume: (room: ListeningRoom): void => {
    const user = useOnlineStore.getState().user
    if (room.host_id === user?.id) return

    set({ lastHostUpdate: Date.now() })

    const currentStatus = get().syncStatus
    if (currentStatus === 'missing_song') return

    usePlayerStore.getState().setIsPlaying(room.is_playing)

    if (room.is_playing) {
      const elapsed = Math.max(0, (Date.now() - new Date(room.updated_at).getTime()) / 1000)
      const targetTime = room.position_seconds + elapsed
      if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 2) {
        usePlayerStore.getState().seek(targetTime)
      }
    }
  },

  handleHostDisconnect: async (): Promise<void> => {
    const joined = get().joinedRoom
    if (!joined) return

    usePlayerStore.getState().setIsPlaying(false)
    get().cleanupOnLeave()

    const user = useOnlineStore.getState().user
    if (user) {
      try {
        await getSupabase()
          .from('listening_room_members')
          .delete()
          .eq('room_id', joined.id)
          .eq('user_id', user.id)
      } catch {
        // best effort
      }
    }

    await get().ensureHostRoom(true)
  },

  transferHost: async (newHostId: string): Promise<void> => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    if (!user || !hostRoom || hostRoom.host_id !== user.id) {
      throw new Error('Only the current host can transfer hosting.')
    }

    const supabase = getSupabase()

    const { error } = await supabase
      .from('listening_rooms')
      .update({
        host_id: newHostId,
        song: null,
        position_seconds: 0,
        is_playing: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', hostRoom.id)

    if (error) throw error

    set({
      hostRoom: null,
      joinedRoom: { ...hostRoom, host_id: newHostId },
      syncStatus: 'buffering'
    })
  },

  cleanupOnLeave: () => {
    set({
      joinedRoom: null,
      syncStatus: 'idle',
      missingSong: null,
      lastHostUpdate: 0
    })
  }
}))
