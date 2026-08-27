import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import type { ListeningRoom, SharedSong } from '../online/types'
import type { Song } from '../pages/Library/Library'
import { useOnlineStore } from './useOnlineStore'
import { usePlayerStore } from './usePlayerStore'
import { useDownloadStore } from './useDownloadStore'
import { DEFAULT_DOWNLOAD_PRIORITY, DOWNLOAD_PRIORITY_SETTING, STREAMING_ACCOUNTS_SETTING } from '../lib/downloadConfig'

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
const SUBSTITUTES_STORAGE_KEY = 'fanxmusic:listen_together:substitutes'

function readInitialSubstitutes(): Record<string, Song> {
  try {
    const raw = localStorage.getItem(SUBSTITUTES_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

interface ListeningStoreState {
  hostRoom: ListeningRoom | null
  joinedRoom: ListeningRoom | null
  hostRoomStopped: boolean
  isJoiningRoom: boolean
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

  // Room / Listen Along lifecycle
  ensureHostRoom: (enabled: boolean, forceNew?: boolean) => Promise<ListeningRoom | null>
  listenAlongWithFriend: (friendId: string) => Promise<ListeningRoom>
  joinRoomById: (roomId: string) => Promise<ListeningRoom>
  joinRoomByCode: (code: string) => Promise<ListeningRoom>
  leaveJoinedRoom: () => Promise<void>
  deactivateHostRoom: () => Promise<void>
  stopHostRoom: () => Promise<void>
  startHostRoom: () => Promise<ListeningRoom | null>
  refreshMemberCount: (roomId: string) => Promise<void>

  // Professional sync handlers
  handleHostSongChange: (room: ListeningRoom) => Promise<void>
  handleHostPauseResume: (room: ListeningRoom) => void
  handleHostDisconnect: () => Promise<void>
  transferHost: (newHostId: string) => Promise<void>
  preloadNextQueueTracks: (room: ListeningRoom) => Promise<void>

  // Cleanup
  cleanupOnLeave: () => void
}

let _ensureLock = false
const _autoDownloadRequests = new Set<string>()

function normalizeSongValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunknown\s+artist\b/gi, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official|audio|remastered|deluxe|version|explicit|clean|radio edit)\)\s*$/gi, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|audio|remastered)\s*$/gi,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findSongMatchIndex(songs: Song[], targetTitle: string, targetArtist: string): number {
  const nTitle = normalizeSongValue(targetTitle)
  const nArtist = normalizeSongValue(targetArtist)
  if (!nTitle) return -1

  // 1. Exact normalized match
  let idx = songs.findIndex((s) => {
    const sTitle = normalizeSongValue(s.title || '')
    const sArtist = normalizeSongValue(s.artist || '')
    return sTitle === nTitle && (!nArtist || !sArtist || sArtist === nArtist)
  })
  if (idx >= 0) return idx

  // 2. Fuzzy substring match (title match + artist match)
  idx = songs.findIndex((s) => {
    const sTitle = normalizeSongValue(s.title || '')
    const sArtist = normalizeSongValue(s.artist || '')
    const titleMatch = sTitle && nTitle && (sTitle.includes(nTitle) || nTitle.includes(sTitle))
    const artistMatch = !nArtist || !sArtist || sArtist.includes(nArtist) || nArtist.includes(sArtist)
    return Boolean(titleMatch && artistMatch)
  })
  return idx
}

/**
 * Validates and ranks provider search candidates so wrong songs/covers/karaoke are never auto-downloaded.
 */
function findBestDownloadMatch(
  results: any[],
  targetTitle: string,
  targetArtist: string,
  targetDuration?: number
): any | null {
  if (!Array.isArray(results) || results.length === 0) return null

  const nTargetTitle = normalizeSongValue(targetTitle)
  const nTargetArtist = normalizeSongValue(targetArtist)
  if (!nTargetTitle) return null

  const isTargetRemix = nTargetTitle.includes('remix') || nTargetTitle.includes('mix')

  let bestHit: any = null
  let highestScore = -1

  for (const item of results) {
    const itemTitle = normalizeSongValue(item.title || '')
    const itemArtist = normalizeSongValue(item.artist || '')
    const rawTitle = (item.title || '').toLowerCase()

    // 1. Hard filters: Reject low quality / parody / karaoke / instrumental unless target asked for it
    const isBadVariation = /\b(karaoke|instrumental|tribute|cover|8d audio|sped up|slowed|nightcore|parody|backing track|ringtone)\b/i.test(rawTitle)
    if (isBadVariation) continue

    const isItemRemix = itemTitle.includes('remix') || itemTitle.includes('mix')
    if (!isTargetRemix && isItemRemix && !rawTitle.includes('radio edit')) continue

    // 2. Title matching score
    let titleScore = 0
    if (itemTitle === nTargetTitle) {
      titleScore = 1.0
    } else if (itemTitle.startsWith(nTargetTitle) || nTargetTitle.startsWith(itemTitle)) {
      titleScore = 0.9
    } else if (itemTitle.includes(nTargetTitle) || nTargetTitle.includes(itemTitle)) {
      titleScore = 0.8
    } else {
      const targetWords = nTargetTitle.split(' ').filter((w) => w.length > 1)
      const itemWords = new Set(itemTitle.split(' ').filter((w) => w.length > 1))
      if (targetWords.length > 0) {
        const matchingWords = targetWords.filter((w) => itemWords.has(w)).length
        titleScore = (matchingWords / targetWords.length) * 0.75
      }
    }

    if (titleScore < 0.5) continue

    // 3. Artist matching score
    let artistScore = 0.6
    if (nTargetArtist && itemArtist) {
      if (itemArtist === nTargetArtist) {
        artistScore = 1.0
      } else if (itemArtist.includes(nTargetArtist) || nTargetArtist.includes(itemArtist)) {
        artistScore = 0.85
      } else {
        const targetArtistWords = nTargetArtist.split(' ').filter((w) => w.length > 1)
        const itemArtistWords = new Set(itemArtist.split(' ').filter((w) => w.length > 1))
        if (targetArtistWords.length > 0) {
          const matching = targetArtistWords.filter((w) => itemArtistWords.has(w)).length
          artistScore = (matching / targetArtistWords.length) * 0.7
        } else {
          artistScore = 0.2
        }
      }
    }

    // 4. Duration delta check (penalize if diff > 15-30s)
    let durationScore = 1.0
    const itemDuration = typeof item.duration === 'number' ? item.duration : 0
    if (targetDuration && targetDuration > 0 && itemDuration > 0) {
      const diff = Math.abs(itemDuration - targetDuration)
      if (diff <= 5) durationScore = 1.0
      else if (diff <= 15) durationScore = 0.9
      else if (diff <= 30) durationScore = 0.75
      else if (diff <= 60) durationScore = 0.4
      else durationScore = 0.1
    }

    const totalScore = titleScore * 0.5 + artistScore * 0.3 + durationScore * 0.2

    if (totalScore > highestScore && totalScore >= 0.65) {
      highestScore = totalScore
      bestHit = item
    }
  }

  return bestHit
}

function getSongKey(song?: SharedSong | null): string {
  if (!song) return ''
  return `${normalizeSongValue(song.artist)} - ${normalizeSongValue(song.title)}`
}

let _lastSyncedSongId: string | null = null

export const useListeningStore = create<ListeningStoreState>((set, get) => ({
  hostRoom: null,
  joinedRoom: null,
  hostRoomStopped: false,
  isJoiningRoom: false,
  memberCount: 0,
  isLoading: false,
  error: null,
  syncStatus: 'idle',
  missingSong: null,
  lastHostUpdate: 0,
  autoDownloadMissing: localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) !== 'false',
  substitutes: readInitialSubstitutes(),

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
      try {
        localStorage.setItem(SUBSTITUTES_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
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

  ensureHostRoom: async (enabled: boolean, forceNew = false): Promise<ListeningRoom | null> => {
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

    // Never create a host room if stopped, joining, or currently in a joined session with a friend
    if (!forceNew && (get().hostRoomStopped || get().isJoiningRoom || get().joinedRoom !== null)) {
      _ensureLock = false
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
      const upcomingQueue = playerState.queue
        .slice(playerState.currentSongIndex, playerState.currentSongIndex + 40)
        .map(toSharedSong)

      const roomPayload = {
        name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s session`,
        song: currentSong ? toSharedSong(currentSong) : null,
        queue: upcomingQueue,
        position_seconds: Math.round(playerState.currentTime || 0),
        is_playing: Boolean(playerState.isPlaying && currentSong),
        is_active: true,
        updated_at: new Date().toISOString()
      }

      let activeRoom: ListeningRoom | null = null

      if (!forceNew) {
        const { data: existing, error: findError } = await supabase
          .from('listening_rooms')
          .select('*')
          .eq('host_id', user.id)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (findError) throw findError

        if (existing) {
          const { data: updated, error: updateError } = await supabase
            .from('listening_rooms')
            .update(roomPayload)
            .eq('id', existing.id)
            .select('*')
            .single()

          if (updateError) throw updateError
          activeRoom = updated as ListeningRoom
        }
      }

      if (!activeRoom) {
        // Ensure all previous host rooms are deactivated first
        await supabase
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
          .eq('host_id', user.id)

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

      set({ hostRoom: activeRoom, hostRoomStopped: false, error: null })
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

  // ─── LISTEN ALONG / JOIN ROOM ────────────────────────────────────

  listenAlongWithFriend: async (friendId: string): Promise<ListeningRoom> => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to listen along with a friend.')

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering', hostRoom: null, hostRoomStopped: true })
    const supabase = getSupabase()

    try {
      // Find friend's active room
      const { data: targetRoom, error: findError } = await supabase
        .from('listening_rooms')
        .select('*')
        .eq('host_id', friendId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (findError) throw findError
      if (!targetRoom) throw new Error('This friend is not currently listening to anything.')

      // Deactivate our own host rooms so we don't broadcast duplicate presence
      await supabase
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false })
        .eq('host_id', user.id)

      await supabase
        .from('listening_room_members')
        .upsert({ room_id: targetRoom.id, user_id: user.id })

      set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null, hostRoomStopped: true })
      await get().handleHostSongChange(targetRoom as ListeningRoom)
      void get().refreshMemberCount(targetRoom.id)
      return targetRoom as ListeningRoom
    } catch (err: any) {
      set({ syncStatus: 'idle' })
      throw err
    } finally {
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

  joinRoomById: async (roomId: string): Promise<ListeningRoom> => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering', hostRoom: null, hostRoomStopped: true })
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

        set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null, hostRoomStopped: true })
        await get().handleHostSongChange(targetRoom as ListeningRoom)
      } else {
        set({ hostRoom: targetRoom as ListeningRoom, joinedRoom: null, hostRoomStopped: false, syncStatus: 'idle' })
      }

      void get().refreshMemberCount(targetRoom.id)
      return targetRoom as ListeningRoom
    } catch (err: any) {
      set({ syncStatus: 'idle' })
      throw err
    } finally {
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

  joinRoomByCode: async (code: string): Promise<ListeningRoom> => {
    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode) throw new Error('Please enter a room code.')

    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be signed in to join a room.')

    set({ isLoading: true, isJoiningRoom: true, error: null, syncStatus: 'buffering' })
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
      set({ isLoading: false, isJoiningRoom: false })
    }
  },

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
      set({ hostRoomStopped: false })
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
      // best effort cleanup during logout/unmount
    }
  },

  stopHostRoom: async () => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    const roomId = hostRoom?.id

    // Immediately update local state so UI responds in 0ms
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
    return get().ensureHostRoom(true, true)
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
        _lastSyncedSongId = substitute.id
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
      let targetIndex = findSongMatchIndex(playerState.queue, room.song.title, room.song.artist)
      let targetQueue = playerState.queue

      // Step 3: If not in queue, search full local library
      if (targetIndex < 0) {
        targetQueue = ((await window.api?.getSongs?.()) || []) as Song[]
        targetIndex = findSongMatchIndex(targetQueue, room.song.title, room.song.artist)
      }

      // Step 4: Song not found locally -> trigger auto-download
      if (targetIndex < 0) {
        set({
          syncStatus: 'missing_song',
          missingSong: room.song
        })

        if (get().autoDownloadMissing && room.song) {
          const requestKey = `${room.id}:${songKey}`
          if (!_autoDownloadRequests.has(requestKey)) {
            _autoDownloadRequests.add(requestKey)
            void (async () => {
              try {
                const query = `${room.song!.artist} ${room.song!.title}`.trim()
                const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
                const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
                const priority = Array.isArray(savedPriority) && savedPriority.length > 0
                  ? savedPriority
                  : DEFAULT_DOWNLOAD_PRIORITY
                const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

                for (const source of priority) {
                  try {
                    const results = await window.api?.searchDownloadSource?.(source, query, accounts)
                    const bestHit = findBestDownloadMatch(
                      results,
                      room.song!.title,
                      room.song!.artist,
                      room.song!.duration
                    )
                    if (!bestHit) continue

                    const transferId = `room-${room.id}-${Date.now()}`

                    // Register in the sidebar download panel so the user can see progress
                    useDownloadStore.getState().queueTransfer({
                      source: source as any,
                      sourceName: bestHit.sourceName || source,
                      title: bestHit.title || room.song!.title,
                      artist: bestHit.artist || room.song!.artist,
                      quality: bestHit.quality || 'FLAC',
                      size: bestHit.size || '...',
                      conflictMode: 'keep_both',
                      status: 'downloading',
                      progress: 5,
                      message: `Downloading from ${bestHit.sourceName || source}...`,
                      autoPlay: true,
                      resultId: String(bestHit.id)
                    })

                    await window.api?.startDownload?.({
                      transferId,
                      source,
                      resultId: String(bestHit.id),
                      title: bestHit.title || room.song!.title,
                      artist: bestHit.artist || room.song!.artist,
                      songId: '',
                      conflictMode: 'keep_both',
                      accounts,
                      autoPlay: true
                    })
                    return
                  } catch (sourceErr) {
                    console.warn(`Auto-download failed on source ${source}:`, sourceErr)
                  }
                }
                console.warn(`No priority provider result for room track "${room.song!.title}"`)
              } catch (autoErr) {
                console.warn('Auto-download background search attempt:', autoErr)
              } finally {
                // Clear key after 30s so retry can happen if needed
                setTimeout(() => _autoDownloadRequests.delete(requestKey), 30_000)
              }
            })()
          }
        }

        return
      }

      // Step 5: Song found — switch to it
      const currentPlaying = playerState.queue[playerState.currentSongIndex]
      _lastSyncedSongId = targetQueue[targetIndex].id
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

      // Trigger predictive background pre-download for the next upcoming tracks in queue
      void get().preloadNextQueueTracks(room)
    } catch (err) {
      console.error('Sync error during song change:', err)
      set({ syncStatus: 'missing_song', missingSong: room.song })
    }
  },

  preloadNextQueueTracks: async (room: ListeningRoom): Promise<void> => {
    if (!room || !room.queue || room.queue.length === 0 || !get().autoDownloadMissing) return
    const user = useOnlineStore.getState().user
    if (room.host_id === user?.id) return // Hosts already have their tracks locally

    try {
      const songs = ((await window.api?.getSongs?.()) || []) as Song[]

      // Find where the current host song sits in room.queue
      let currentIndex = -1
      if (room.song) {
        currentIndex = room.queue.findIndex(
          (s) =>
            normalizeSongValue(s.title) === normalizeSongValue(room.song!.title) &&
            normalizeSongValue(s.artist) === normalizeSongValue(room.song!.artist)
        )
      }

      // Pre-buffer the next 1-2 tracks ahead
      const startIndex = currentIndex >= 0 ? currentIndex + 1 : 1
      const upcomingTracks = room.queue.slice(startIndex, startIndex + 2)

      for (const upcomingSong of upcomingTracks) {
        if (!upcomingSong.title || !upcomingSong.artist) continue

        const inLibrary = findSongMatchIndex(songs, upcomingSong.title, upcomingSong.artist) >= 0
        if (inLibrary) continue

        const songKey = `${normalizeSongValue(upcomingSong.artist)} - ${normalizeSongValue(upcomingSong.title)}`
        const requestKey = `preload:${room.id}:${songKey}`
        if (_autoDownloadRequests.has(requestKey)) continue

        _autoDownloadRequests.add(requestKey)

        void (async () => {
          try {
            const query = `${upcomingSong.artist} ${upcomingSong.title}`.trim()
            const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
            const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
            const priority = Array.isArray(savedPriority) && savedPriority.length > 0
              ? savedPriority
              : DEFAULT_DOWNLOAD_PRIORITY
            const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

            for (const source of priority) {
              try {
                const results = await window.api?.searchDownloadSource?.(source, query, accounts)
                const bestHit = findBestDownloadMatch(
                  results,
                  upcomingSong.title,
                  upcomingSong.artist,
                  upcomingSong.duration
                )
                if (!bestHit) continue

                const transferId = `preload-${room.id}-${Date.now()}`

                useDownloadStore.getState().queueTransfer({
                  source: source as any,
                  sourceName: bestHit.sourceName || source,
                  title: bestHit.title || upcomingSong.title,
                  artist: bestHit.artist || upcomingSong.artist,
                  quality: bestHit.quality || 'FLAC',
                  size: bestHit.size || '...',
                  conflictMode: 'keep_both',
                  status: 'downloading',
                  progress: 5,
                  message: `Pre-buffering next track for session: "${upcomingSong.title}"`,
                  autoPlay: false,
                  resultId: String(bestHit.id)
                })

                await window.api?.startDownload?.({
                  transferId,
                  source,
                  resultId: String(bestHit.id),
                  title: bestHit.title || upcomingSong.title,
                  artist: bestHit.artist || upcomingSong.artist,
                  songId: '',
                  conflictMode: 'keep_both',
                  accounts,
                  autoPlay: false
                })
                return
              } catch (err) {
                console.warn(`Pre-download failed on source ${source}:`, err)
              }
            }
          } catch (preErr) {
            console.warn('Pre-download search error:', preErr)
          } finally {
            setTimeout(() => _autoDownloadRequests.delete(requestKey), 60_000)
          }
        })()
      }
    } catch (err) {
      console.warn('preloadNextQueueTracks failed:', err)
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
  },

  cleanupOnLeave: () => {
    _lastSyncedSongId = null
    set({
      joinedRoom: null,
      syncStatus: 'idle',
      missingSong: null,
      lastHostUpdate: 0
    })
  }
}))

// Global listener: when a downloaded song arrives into local library, automatically sync joined room
if (typeof window !== 'undefined') {
  const onLibraryUpdated = () => {
    const state = useListeningStore.getState()
    const joined = state.joinedRoom
    if (joined && joined.song && state.syncStatus === 'missing_song') {
      void state.handleHostSongChange(joined)
    }
  }
  window.addEventListener('felo:library-updated', onLibraryUpdated)
  window.addEventListener('fanxmusic:library-updated', onLibraryUpdated)
}

// ─── AUTO-LEAVE: when the listener manually changes the song, exit the session ───
// We watch currentSongIndex changes in the playerStore. If the user is currently
// in a joined (listener) room and the index shifts to a song that doesn't match
// what the host is playing, we auto-leave so the footer badge disappears.
if (typeof window !== 'undefined') {
  let _leaving = false

  usePlayerStore.subscribe((playerState, prevPlayerState) => {
    const state = useListeningStore.getState()
    const joined = state.joinedRoom
    if (!joined) {
      _lastSyncedSongId = null
      return
    }

    // Track what song the store last synced us to
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const prevSong = prevPlayerState.queue[prevPlayerState.currentSongIndex]

    // Only react if the *index or id* changed — not just position/play-state ticks
    const indexChanged = playerState.currentSongIndex !== prevPlayerState.currentSongIndex
    const idChanged = currentSong?.id !== prevSong?.id
    if (!indexChanged && !idChanged) return

    // First time we see a sync, record it and don't auto-leave
    if (_lastSyncedSongId === null) {
      _lastSyncedSongId = currentSong?.id ?? null
      return
    }

    // If the new song is still the same as the last one the store synced → no-op
    if (currentSong?.id === _lastSyncedSongId) return

    // The user manually changed to a DIFFERENT song — auto-leave
    if (!_leaving) {
      _leaving = true
      _lastSyncedSongId = null
      void useListeningStore.getState().leaveJoinedRoom().finally(() => {
        _leaving = false
      })
    }
  })
}


