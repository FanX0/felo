import { create } from 'zustand'
import { getSupabase } from '../lib/supabase'
import type { ListeningRoom, SharedSong } from '../online/types'
import type { Song } from '../pages/Library/Library'
import { useOnlineStore } from './useOnlineStore'
import { usePlayerStore } from './usePlayerStore'
import { useDownloadStore } from './useDownloadStore'
import { DEFAULT_DOWNLOAD_PRIORITY, DOWNLOAD_PRIORITY_SETTING, STREAMING_ACCOUNTS_SETTING } from '../lib/downloadConfig'
import { WebRTCAudioHost, WebRTCAudioClient, type WebRTCAudioStats } from '../lib/webrtcAudioStream'
import { scoreProviderMatch, cleanSearchQuery } from '../lib/songMatching'
import { setAudioPlaybackRate, getAudioPlaybackRate } from '../lib/audioBridge'
import { toMediaUrl } from '../lib/media'
import { resolveSongAudioUrl } from '../lib/songAudioResolver'

let _activeAudioHost: WebRTCAudioHost | null = null
let _activeAudioClient: WebRTCAudioClient | null = null

export function broadcastHostLosslessTrack(song?: Song | null): void {
  if (!_activeAudioHost) return
  const mediaUrl = resolveSongAudioUrl(song) || toMediaUrl(song?.filePath)
  if (!mediaUrl) return
  const ext = (song?.filePath || song?.title || '').toLowerCase()
  const mimeType = ext.endsWith('.flac')
    ? 'audio/flac'
    : ext.endsWith('.wav')
    ? 'audio/wav'
    : ext.endsWith('.ogg')
    ? 'audio/ogg'
    : 'audio/mpeg'
  void _activeAudioHost.broadcastLosslessTrack(mediaUrl, mimeType)
}

function makeCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export function toSharedSong(song: Song): SharedSong {
  const isPriorityOn =
    typeof useListeningStore !== 'undefined' && useListeningStore?.getState
      ? useListeningStore.getState().discordPriorityEnabled
      : readInitialDiscordPriority()

  const isStreaming =
    typeof useListeningStore !== 'undefined' && useListeningStore?.getState
      ? Boolean(
          useListeningStore.getState().isAutoStreamingToListeners ||
          useListeningStore.getState().isDeviceAudioSharing ||
          _activeAudioHost
        )
      : Boolean(_activeAudioHost)

  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    artworkUrl: /^https?:\/\//i.test(song.artworkPath || '') ? song.artworkPath : undefined,
    requestedBy: song.requestedBy,
    isPriority: song.isPriority,
    discordPriorityEnabled: isPriorityOn,
    isTrackStream: isStreaming,
    streamType: isStreaming ? 'track_stream' : 'library'
  }
}

export function fromSharedSong(song: SharedSong): Song {
  return {
    id: song.localId || 'shared',
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    duration: song.duration || 0,
    artworkUrl: song.artworkUrl,
    requestedBy: song.requestedBy,
    isPriority: song.isPriority
  }
}

export type SyncStatus = 'idle' | 'synced' | 'missing_song' | 'buffering' | 'host_reconnecting'

const AUTO_DOWNLOAD_STORAGE_KEY = 'fanxmusic:listen_together:auto_download'
const SUBSTITUTES_STORAGE_KEY = 'fanxmusic:listen_together:substitutes'
const DISCORD_PRIORITY_STORAGE_KEY = 'felo:discord-priority-enabled'
let _isSessionSyncing = false

function readInitialDiscordPriority(): boolean {
  try {
    const raw = localStorage.getItem(DISCORD_PRIORITY_STORAGE_KEY)
    if (raw === null) return true // Default enabled
    return raw === 'true'
  } catch {
    return true
  }
}

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
  discordPriorityEnabled: boolean
  setDiscordPriorityEnabled: (enabled: boolean) => void

  // Room / Listen Along lifecycle
  ensureHostRoom: (enabled: boolean, forceNew?: boolean, preferredCode?: string) => Promise<ListeningRoom | null>
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
  checkHostHealth: () => Promise<void>

  // Device audio streaming state
  isDeviceAudioSharing: boolean
  isReceivingDeviceStream: boolean
  deviceAudioLevel: number
  deviceAudioPeerCount: number
  deviceAudioClientState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'stopped'
  deviceAudioBitrate: number
  isDeviceAudioMuted: boolean
  isAutoplayBlocked: boolean
  deviceAudioStats: WebRTCAudioStats | null
  deviceAudioVolume: number
  deviceAudioClientLevel: number
  losslessStreamBlobUrl: string | null
  isLosslessMasterActive: boolean

  setDeviceAudioBitrate: (bitrate: number) => void
  toggleDeviceAudioMute: () => void
  setDeviceAudioVolume: (volume: number) => void
  unmuteDeviceStream: () => Promise<boolean>
  startDeviceAudioSharing: () => Promise<void>
  stopDeviceAudioSharing: () => Promise<void>
  isAutoStreamingToListeners: boolean
  startAutoTrackStreaming: () => Promise<void>
  stopAutoTrackStreaming: () => void
  connectToDeviceStream: (room: ListeningRoom) => Promise<void>
  disconnectFromDeviceStream: () => void

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

  // 1. Exact normalized match (only real files on disk)
  let idx = songs.findIndex((s) => {
    if (!s.filePath || String(s.filePath).startsWith('virtual:')) return false
    const sTitle = normalizeSongValue(s.title || '')
    const sArtist = normalizeSongValue(s.artist || '')
    return sTitle === nTitle && (!nArtist || !sArtist || sArtist === nArtist)
  })
  if (idx >= 0) return idx

  // 2. Fuzzy substring match (title match + artist match, only real files on disk)
  idx = songs.findIndex((s) => {
    if (!s.filePath || String(s.filePath).startsWith('virtual:')) return false
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
 * Uses the unified scoreProviderMatch engine.
 */
function findBestDownloadMatch(
  results: any[],
  targetTitle: string,
  targetArtist: string,
  targetDuration?: number
): any | null {
  if (!Array.isArray(results) || results.length === 0) return null

  let bestHit: any = null
  let highestScore = -1

  for (const item of results) {
    const match = scoreProviderMatch(
      { title: targetTitle, artist: targetArtist, duration: targetDuration },
      {
        title: item.title || '',
        artist: item.artist || '',
        meta: item.meta || item.album || '',
        description: item.description || '',
        duration: item.duration
      }
    )

    if (match.isAcceptable && match.score > highestScore) {
      highestScore = match.score
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
  autoDownloadMissing: localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) === 'true',
  substitutes: readInitialSubstitutes(),

  // Device audio streaming state
  isDeviceAudioSharing: false,
  isAutoStreamingToListeners: false,
  isReceivingDeviceStream: false,
  deviceAudioLevel: 0,
  deviceAudioPeerCount: 0,
  deviceAudioClientState: 'idle',
  deviceAudioBitrate: 510000,
  isDeviceAudioMuted: false,
  isAutoplayBlocked: false,
  deviceAudioStats: null,
  deviceAudioVolume: 1.0,
  deviceAudioClientLevel: 0,
  losslessStreamBlobUrl: null,
  isLosslessMasterActive: false,

  setDeviceAudioBitrate: (bitrate: number) => {
    set({ deviceAudioBitrate: bitrate })
    if (_activeAudioHost) {
      _activeAudioHost.setBitrate(bitrate)
    }
  },

  toggleDeviceAudioMute: () => {
    const nextMuted = !get().isDeviceAudioMuted
    set({ isDeviceAudioMuted: nextMuted })
    if (_activeAudioHost) {
      _activeAudioHost.setMuted(nextMuted)
    }
  },

  setDeviceAudioVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume))
    set({ deviceAudioVolume: clamped })
    if (_activeAudioClient) {
      _activeAudioClient.setVolume(clamped)
    }
  },

  unmuteDeviceStream: async () => {
    if (_activeAudioClient) {
      const ok = await _activeAudioClient.unmuteAudio()
      if (ok) {
        set({ isAutoplayBlocked: false })
      }
      return ok
    }
    return false
  },

  setHostRoom: (hostRoom) => set({ hostRoom }),
  setJoinedRoom: (joinedRoom) => set({ joinedRoom }),
  setMemberCount: (memberCount) => set({ memberCount }),
  setError: (error) => set({ error }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
  discordPriorityEnabled: readInitialDiscordPriority(),
  setDiscordPriorityEnabled: (enabled: boolean) => {
    try {
      localStorage.setItem(DISCORD_PRIORITY_STORAGE_KEY, enabled ? 'true' : 'false')
    } catch {
      // ignore
    }
    set({ discordPriorityEnabled: enabled })
    if (get().hostRoom) {
      void get().ensureHostRoom(true)
    }
  },

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
      const memberCount = count || 0
      set({ memberCount })

      // Auto-start track streaming when host has active listeners
      const hostRoom = get().hostRoom
      if (hostRoom && hostRoom.id === roomId && !get().joinedRoom && !get().hostRoomStopped) {
        if (memberCount > 0 && !get().isDeviceAudioSharing && !get().isAutoStreamingToListeners && !_activeAudioHost) {
          void get().startAutoTrackStreaming()
        }
      }
    } catch {
      // ignore
    }
  },

  // ─── HOST ROOM LIFECYCLE ──────────────────────────────────────────

  ensureHostRoom: async (enabled: boolean, forceNew = false, preferredCode?: string): Promise<ListeningRoom | null> => {
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
        .slice(playerState.currentSongIndex, playerState.currentSongIndex + 100)
        .map(toSharedSong)

      const isDeviceSharing = get().isDeviceAudioSharing
      const deviceSong: SharedSong = currentSong
        ? {
            ...toSharedSong(currentSong),
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

      const roomPayload = {
        name: `${profile?.display_name || user.email?.split('@')[0] || 'Friend'}'s session`,
        song: isDeviceSharing ? deviceSong : currentSong ? toSharedSong(currentSong) : null,
        queue: isDeviceSharing && !currentSong ? [] : upcomingQueue,
        position_seconds: Math.round(playerState.currentTime || 0),
        is_playing: isDeviceSharing ? true : Boolean(playerState.isPlaying && currentSong),
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
        // If not forceNew and audio is completely inactive, don't auto-create ghost rooms on page mount
        if (!forceNew && !playerState.isAudioActive && !playerState.isPlaying && !isDeviceSharing) {
          return null
        }

        // Ensure all previous host rooms are deactivated first
        await supabase
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
          .eq('host_id', user.id)

        let code = (preferredCode || '').trim().toUpperCase() || makeCode()
        let createdRoom: any = null
        let lastError: any = null

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
          lastError = createError
          console.warn(`[ensureHostRoom] Insert attempt ${i + 1} failed:`, createError)
          code = makeCode()
        }

        if (!createdRoom) {
          throw lastError || new Error('Failed to create host room')
        }
        activeRoom = createdRoom as ListeningRoom
      }

      await supabase
        .from('listening_room_members')
        .upsert(
          { room_id: activeRoom.id, user_id: user.id },
          { onConflict: 'room_id,user_id', ignoreDuplicates: true }
        )

      set({ hostRoom: activeRoom, hostRoomStopped: false, error: null })
      void get().refreshMemberCount(activeRoom.id)

      // Ready WebRTC track streaming channel immediately if playing music
      if (
        playerState.isPlaying &&
        currentSong &&
        !get().isDeviceAudioSharing &&
        !get().isAutoStreamingToListeners &&
        !_activeAudioHost
      ) {
        void get().startAutoTrackStreaming()
      }
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

      set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null, hostRoomStopped: true, lastHostUpdate: Date.now() })
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

        set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null, hostRoomStopped: true, lastHostUpdate: Date.now() })
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
        set({ joinedRoom: targetRoom as ListeningRoom, hostRoom: null, lastHostUpdate: Date.now() })
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
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      _activeAudioHost = null
    }
    set({ isDeviceAudioSharing: false, isAutoStreamingToListeners: false, deviceAudioLevel: 0, deviceAudioPeerCount: 0 })
    if (!user) return

    try {
      await getSupabase()
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
        .eq('host_id', user.id)
      set({ hostRoom: null, hostRoomStopped: true })
    } catch {
      // best effort cleanup during logout/unmount
    }
  },

  stopHostRoom: async () => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    const roomId = hostRoom?.id

    if (_activeAudioHost) {
      _activeAudioHost.stop()
      _activeAudioHost = null
    }
    set({ isDeviceAudioSharing: false, isAutoStreamingToListeners: false, deviceAudioLevel: 0, deviceAudioPeerCount: 0 })

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
    if (room.host_id === user?.id || _isSessionSyncing) return

    // Clean teardown if host stopped playback or ended device stream
    if (!room.song) {
      if (get().isReceivingDeviceStream) {
        get().disconnectFromDeviceStream()
      }
      usePlayerStore.getState().setIsPlaying(false)
      set({ syncStatus: 'idle', missingSong: null })
      return
    }

    _isSessionSyncing = true
    set({ syncStatus: 'buffering', lastHostUpdate: Date.now() })

    try {
      // Step 0: Check if host is broadcasting live device / system audio
      if (room.song?.isDeviceStream || room.is_device_stream) {
        usePlayerStore.getState().setIsPlaying(false)
        await get().connectToDeviceStream(room)
        set({ syncStatus: 'synced', missingSong: null })
        return
      }

      const playerState = usePlayerStore.getState()
      const songKey = getSongKey(room.song)

      // Step 1: Check if user mapped a custom substitute song for this host track
      const substitute = get().substitutes[songKey]
      if (substitute) {
        if (get().isReceivingDeviceStream) {
          get().disconnectFromDeviceStream()
        }
        let currentQueue = playerState.queue
        let subIndex = currentQueue.findIndex((s) => s.id === substitute.id)
        if (subIndex < 0) {
          currentQueue = [substitute, ...playerState.queue]
          subIndex = 0
        }
        _lastSyncedSongId = substitute.id
        usePlayerStore.getState().setQueue(currentQueue, subIndex)

        const now = Date.now()
        const dbElapsed = Math.max(0, (now - new Date(room.updated_at).getTime()) / 1000)
        const elapsed = room.is_playing && dbElapsed < 30 ? dbElapsed : 0
        const rawTarget = room.position_seconds + elapsed
        const duration = substitute.duration || room.song?.duration || 0
        const targetTime = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)
        if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 3) {
          usePlayerStore.getState().seek(targetTime)
        }
        setAudioPlaybackRate(1.0)
        usePlayerStore.getState().setIsPlaying(room.is_playing)
        set({ syncStatus: 'synced', missingSong: null })
        return
      }

      // Step 2: Search local library to find matching local track
      const allLocalSongs = ((await window.api?.getSongs?.()) || []) as Song[]
      const matchedIndex = findSongMatchIndex(allLocalSongs, room.song.title, room.song.artist)

      // Step 3: Song not found locally
      if (matchedIndex < 0) {
        // If guest is currently tuned into the live audio broadcast, maintain the stream seamlessly
        if (get().isReceivingDeviceStream) {
          set({ syncStatus: 'synced', missingSong: null })
          return
        }

        // Step 3.1: Try direct LAN HTTP stream from host's desktop instance
        const lanUrl = resolveSongAudioUrl({
          id: room.song.localId || '',
          title: room.song.title,
          artist: room.song.artist,
          album: room.song.album || '',
          duration: room.song.duration || 0,
          isOnline: true
        } as Song)

        if (lanUrl && !lanUrl.startsWith('media://') && !lanUrl.startsWith('virtual:')) {
          const lanSong: Song = {
            id: `lan-${room.song.localId || Date.now()}`,
            title: room.song.title,
            artist: room.song.artist,
            album: room.song.album || 'LAN Direct Stream',
            duration: room.song.duration || 0,
            artworkPath: room.song.artworkUrl || '',
            filePath: lanUrl,
            audioUrl: lanUrl,
            isOnline: true
          }

          usePlayerStore.getState().setQueue([lanSong], 0)
          const now = Date.now()
          const dbElapsed = Math.max(0, (now - new Date(room.updated_at).getTime()) / 1000)
          const elapsed = room.is_playing && dbElapsed < 30 ? dbElapsed : 0
          const rawTarget = room.position_seconds + elapsed
          const duration = room.song.duration || 0
          const targetTime = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)
          if (targetTime > 0) {
            usePlayerStore.getState().seek(targetTime)
          }
          setAudioPlaybackRate(1.0)
          usePlayerStore.getState().setIsPlaying(room.is_playing)
          set({ syncStatus: 'synced', missingSong: null })
          return
        }

        // Step 3.2: Check if host WebRTC stream is active (Default streaming mode for missing tracks)
        const isHostStreaming = Boolean(
          room.is_track_streaming ||
          room.is_device_stream ||
          room.song?.isDeviceStream ||
          room.song?.isTrackStream ||
          room.song?.streamType === 'track_stream' ||
          room.song?.streamType === 'device_audio'
        )

        if (isHostStreaming) {
          void get().connectToDeviceStream(room)
          set({ syncStatus: 'synced', missingSong: null })

          // If autoDownloadMissing is also turned on (private desktop), optionally download in background
          if (get().autoDownloadMissing && room.song) {
            const requestKey = `${room.id}:${songKey}`
            if (!_autoDownloadRequests.has(requestKey)) {
              _autoDownloadRequests.add(requestKey)
              void (async () => {
                try {
                  const query =
                    cleanSearchQuery(room.song!.artist, room.song!.title) ||
                    `${room.song!.artist || ''} ${room.song!.title}`.trim()
                  const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
                  const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
                  const priority = Array.isArray(savedPriority) && savedPriority.length > 0
                    ? savedPriority
                    : DEFAULT_DOWNLOAD_PRIORITY
                  const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

                  for (const source of priority) {
                    if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) continue
                    if (source === 'deezer' && !accounts.deezerArl) continue
                    if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) continue

                    try {
                      let timer: ReturnType<typeof setTimeout> | undefined
                      const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
                      const timeoutPromise = new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`Room track search timed out on ${source}`)), 12000)
                      })
                      const results = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
                        if (timer) clearTimeout(timer)
                      })
                      const bestHit = findBestDownloadMatch(
                        results,
                        room.song!.title,
                        room.song!.artist,
                        room.song!.duration
                      )
                      if (!bestHit) continue

                      const transferId = `room-${room.id}-${Date.now()}`
                      const safeArtwork =
                        bestHit.artworkUrl && /^https?:\/\//i.test(bestHit.artworkUrl)
                          ? bestHit.artworkUrl
                          : room.song?.artworkUrl && /^https?:\/\//i.test(room.song.artworkUrl)
                            ? room.song.artworkUrl
                            : undefined

                      useDownloadStore.getState().queueTransfer(
                        {
                          id: transferId,
                          source: source as any,
                          sourceName: bestHit.sourceName || source,
                          title: bestHit.title || room.song!.title,
                          artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                          quality: bestHit.quality || 'FLAC',
                          size: bestHit.size || '...',
                          conflictMode: 'keep_both',
                          status: 'downloading',
                          progress: 5,
                          message: `Downloading from ${bestHit.sourceName || source}...`,
                          autoPlay: false,
                          resultId: String(bestHit.id),
                          song: room.song ? fromSharedSong(room.song) : undefined
                        },
                        { openDrawer: false }
                      )

                      await window.api?.startDownload?.({
                        transferId,
                        source,
                        resultId: String(bestHit.id),
                        title: bestHit.title || room.song!.title,
                        artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                        songId: '',
                        conflictMode: 'keep_both',
                        accounts,
                        autoPlay: false,
                        artworkUrl: safeArtwork,
                        album: bestHit.album || room.song?.album
                      })
                      return
                    } catch (sourceErr) {
                      console.warn(`Auto-download failed on source ${source}:`, sourceErr)
                    }
                  }
                } catch (autoErr) {
                  console.warn('Auto-download background search attempt:', autoErr)
                } finally {
                  setTimeout(() => _autoDownloadRequests.delete(requestKey), 30_000)
                }
              })()
            }
          }
          return
        }

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
                const query =
                  cleanSearchQuery(room.song!.artist, room.song!.title) ||
                  `${room.song!.artist || ''} ${room.song!.title}`.trim()
                const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
                const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
                const priority = Array.isArray(savedPriority) && savedPriority.length > 0
                  ? savedPriority
                  : DEFAULT_DOWNLOAD_PRIORITY
                const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

                for (const source of priority) {
                  if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) continue
                  if (source === 'deezer' && !accounts.deezerArl) continue
                  if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) continue

                  try {
                    let timer: ReturnType<typeof setTimeout> | undefined
                    const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
                    const timeoutPromise = new Promise<never>((_, reject) => {
                      timer = setTimeout(() => reject(new Error(`Room track search timed out on ${source}`)), 12000)
                    })
                    const results = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
                      if (timer) clearTimeout(timer)
                    })
                    const bestHit = findBestDownloadMatch(
                      results,
                      room.song!.title,
                      room.song!.artist,
                      room.song!.duration
                    )
                    if (!bestHit) continue

                    const transferId = `room-${room.id}-${Date.now()}`
                    const safeArtwork =
                      bestHit.artworkUrl && /^https?:\/\//i.test(bestHit.artworkUrl)
                        ? bestHit.artworkUrl
                        : room.song?.artworkUrl && /^https?:\/\//i.test(room.song.artworkUrl)
                          ? room.song.artworkUrl
                          : undefined

                    // Register in the sidebar download panel so the user can see progress (silent background mode)
                    useDownloadStore.getState().queueTransfer(
                      {
                        id: transferId,
                        source: source as any,
                        sourceName: bestHit.sourceName || source,
                        title: bestHit.title || room.song!.title,
                        artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                        quality: bestHit.quality || 'FLAC',
                        size: bestHit.size || '...',
                        conflictMode: 'keep_both',
                        status: 'downloading',
                        progress: 5,
                        message: `Downloading from ${bestHit.sourceName || source}...`,
                        autoPlay: true,
                        resultId: String(bestHit.id),
                        song: room.song ? fromSharedSong(room.song) : undefined
                      },
                      { openDrawer: false }
                    )

                    await window.api?.startDownload?.({
                      transferId,
                      source,
                      resultId: String(bestHit.id),
                      title: bestHit.title || room.song!.title,
                      artist: bestHit.artist || room.song!.artist || 'Unknown Artist',
                      songId: '',
                      conflictMode: 'keep_both',
                      accounts,
                      autoPlay: true,
                      artworkUrl: safeArtwork,
                      album: bestHit.album || room.song?.album
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

      // Step 4: Construct the Session Queue preserving the room's shared queue
      if (get().isReceivingDeviceStream) {
        get().disconnectFromDeviceStream()
      }
      const matchedSong = allLocalSongs[matchedIndex]
      let sessionQueue: Song[] = []
      let targetIndex = 0

      if (room.queue && room.queue.length > 0) {
        sessionQueue = room.queue.map((shared, idx) => {
          const localMatchIdx = findSongMatchIndex(allLocalSongs, shared.title, shared.artist)
          if (localMatchIdx >= 0) {
            return allLocalSongs[localMatchIdx]
          }
          // Synthetic placeholder for queue items not yet on disk
          return {
            id: `session-${idx}-${shared.localId || idx}`,
            title: shared.title,
            artist: shared.artist,
            album: shared.album || '',
            duration: shared.duration || 0,
            artworkPath: shared.artworkUrl || '',
            filePath: ''
          } as Song
        })

        const activeInQueueIdx = sessionQueue.findIndex(
          (s) =>
            normalizeSongValue(s.title) === normalizeSongValue(room.song!.title) &&
            normalizeSongValue(s.artist) === normalizeSongValue(room.song!.artist)
        )
        if (activeInQueueIdx >= 0) {
          sessionQueue[activeInQueueIdx] = matchedSong
          targetIndex = activeInQueueIdx
        } else {
          sessionQueue = [matchedSong, ...sessionQueue]
          targetIndex = 0
        }
      } else {
        sessionQueue = [matchedSong]
        targetIndex = 0
      }

      // Step 5: Switch to session queue and matched song
      const currentPlaying = playerState.queue[playerState.currentSongIndex]
      _lastSyncedSongId = matchedSong.id
      if (!currentPlaying || currentPlaying.id !== matchedSong.id) {
        usePlayerStore.getState().setQueue(sessionQueue, targetIndex)
      }

      // Step 6: Seek to host position (latency compensated)
      const now = Date.now()
      const dbElapsed = Math.max(0, (now - new Date(room.updated_at).getTime()) / 1000)
      const elapsed = room.is_playing && dbElapsed < 30 ? dbElapsed : 0
      const rawTarget = room.position_seconds + elapsed
      const duration = matchedSong.duration || room.song?.duration || 0
      const targetTime = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)
      if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 3) {
        usePlayerStore.getState().seek(targetTime)
      }
      setAudioPlaybackRate(1.0)


      usePlayerStore.getState().setIsPlaying(room.is_playing)
      set({ syncStatus: 'synced', missingSong: null })

      // Trigger predictive background pre-download for the next upcoming tracks in queue
      void get().preloadNextQueueTracks(room)
    } catch (err) {
      console.error('Sync error during song change:', err)
      set({ syncStatus: 'missing_song', missingSong: room.song })
    } finally {
      _isSessionSyncing = false
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
            const query =
              cleanSearchQuery(upcomingSong.artist, upcomingSong.title) ||
              `${upcomingSong.artist || ''} ${upcomingSong.title}`.trim()
            const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
            const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
            const priority = Array.isArray(savedPriority) && savedPriority.length > 0
              ? savedPriority
              : DEFAULT_DOWNLOAD_PRIORITY
            const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

            for (const source of priority) {
              if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) continue
              if (source === 'deezer' && !accounts.deezerArl) continue
              if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) continue

              try {
                let timer: ReturnType<typeof setTimeout> | undefined
                const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
                const timeoutPromise = new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error(`Preload track search timed out on ${source}`)), 12000)
                })
                const results = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
                  if (timer) clearTimeout(timer)
                })
                const bestHit = findBestDownloadMatch(
                  results,
                  upcomingSong.title,
                  upcomingSong.artist,
                  upcomingSong.duration
                )
                if (!bestHit) continue

                const transferId = `preload-${room.id}-${Date.now()}`
                const safeArtwork =
                  bestHit.artworkUrl && /^https?:\/\//i.test(bestHit.artworkUrl)
                    ? bestHit.artworkUrl
                    : upcomingSong.artworkUrl && /^https?:\/\//i.test(upcomingSong.artworkUrl)
                      ? upcomingSong.artworkUrl
                      : undefined

                useDownloadStore.getState().queueTransfer(
                  {
                    id: transferId,
                    source: source as any,
                    sourceName: bestHit.sourceName || source,
                    title: bestHit.title || upcomingSong.title,
                    artist: bestHit.artist || upcomingSong.artist || 'Unknown Artist',
                    quality: bestHit.quality || 'FLAC',
                    size: bestHit.size || '...',
                    conflictMode: 'keep_both',
                    status: 'downloading',
                    progress: 5,
                    message: `Pre-buffering next track for session: "${upcomingSong.title}"`,
                    autoPlay: false,
                    resultId: String(bestHit.id),
                    song: fromSharedSong(upcomingSong)
                  },
                  { openDrawer: false }
                )

                await window.api?.startDownload?.({
                  transferId,
                  source,
                  resultId: String(bestHit.id),
                  title: bestHit.title || upcomingSong.title,
                  artist: bestHit.artist || upcomingSong.artist || 'Unknown Artist',
                  songId: '',
                  conflictMode: 'keep_both',
                  accounts,
                  autoPlay: false,
                  artworkUrl: safeArtwork,
                  album: bestHit.album || upcomingSong.album
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
    if (room.host_id === user?.id || _isSessionSyncing) return

    set({ lastHostUpdate: Date.now() })

    // If host is streaming device audio, WebRTC handles real-time audio playback directly
    if (room.song?.isDeviceStream || room.is_device_stream || get().isReceivingDeviceStream) {
      return
    }

    const currentStatus = get().syncStatus
    if (currentStatus === 'missing_song') return

    // If room is back to life, recover from host_reconnecting
    if (currentStatus === 'host_reconnecting') {
      set({ syncStatus: 'synced' })
    }

    usePlayerStore.getState().setIsPlaying(room.is_playing)

    if (room.is_playing) {
      const now = Date.now()
      const dbElapsed = Math.max(0, (now - new Date(room.updated_at).getTime()) / 1000)
      // Clock-skew protection: only trust DB timestamp if within 30s window, else assume real-time
      const elapsed = dbElapsed < 30 ? dbElapsed : 0
      const rawTarget = room.position_seconds + elapsed
      const duration = room.song?.duration || 0
      const targetTime = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)

      const currentGuestTime = usePlayerStore.getState().currentTime
      const diff = currentGuestTime - targetTime
      const absDiff = Math.abs(diff)

      if (absDiff > 4.0) {
        // Large desync (> 4s): hard seek & normalize playbackRate
        setAudioPlaybackRate(1.0)
        _isSessionSyncing = true
        usePlayerStore.getState().seek(targetTime)
        setTimeout(() => {
          _isSessionSyncing = false
        }, 300)
      } else if (absDiff > 1.2) {
        // Mild lag / network jitter (1.2s - 4.0s): smooth rate micro-adjustment
        // If guest is behind host (diff < -1.2), speed up to 1.04x
        // If guest is ahead of host (diff > 1.2), slow down to 0.96x
        const catchUpRate = diff < 0 ? 1.04 : 0.96
        setAudioPlaybackRate(catchUpRate)
      } else {
        // Tight sync (< 1.2s): maintain normal 1.0x rate
        if (getAudioPlaybackRate() !== 1.0) {
          setAudioPlaybackRate(1.0)
        }
      }
    } else {
      setAudioPlaybackRate(1.0)
    }
  },

  checkHostHealth: async (): Promise<void> => {
    const joined = get().joinedRoom
    const user = useOnlineStore.getState().user
    if (!joined || !user) return

    const now = Date.now()
    // Local monotonic elapsed check: immune to client clock skew between host and guest PCs
    const lastUpdateTs = get().lastHostUpdate || now
    const elapsed = now - lastUpdateTs

    // 1. Stage 1: Healthy (< 12 seconds since last heartbeat)
    if (elapsed < 12_000) {
      if (get().syncStatus === 'host_reconnecting') {
        set({ syncStatus: 'synced' })
        if (joined.is_playing) {
          usePlayerStore.getState().setIsPlaying(true)
          get().handleHostPauseResume(joined)
        }
      }
      return
    }

    // 2. Stage 2: Host lag / restart (12s to 35s grace period)
    if (elapsed < 35_000) {
      if (get().syncStatus !== 'host_reconnecting') {
        set({ syncStatus: 'host_reconnecting' })
        // Temporarily pause local playback to avoid drifting while host reconnects
        usePlayerStore.getState().setIsPlaying(false)
        setAudioPlaybackRate(1.0)
      }
      return
    }

    // 3. Stage 3: Grace period expired (> 35s without host update). Elect new host or close.
    try {
      const { data: updatedRoom, error } = await getSupabase().rpc('elect_new_room_host', {
        target_room_id: joined.id,
        expected_old_host_id: joined.host_id
      })

      if (error) {
        if (error.code === 'PGRST202') {
          console.warn(
            '[Watchdog] Automatic failover RPC is not installed on the server yet. Apply supabase/migrations/0014_listening_room_host_failover.sql in your Supabase SQL editor.'
          )
        } else {
          console.warn('[Watchdog] elect_new_room_host RPC error:', error)
        }
        await get().handleHostDisconnect()
        return
      }

      if (!updatedRoom) {
        // Room was closed by server (no remaining members)
        await get().handleHostDisconnect()
        return
      }

      // If THIS user was elected as the new host
      if (updatedRoom.host_id === user.id) {
        set({
          hostRoom: updatedRoom as ListeningRoom,
          joinedRoom: null,
          hostRoomStopped: false,
          syncStatus: 'idle'
        })
        // As new host, resume playback and broadcast presence
        usePlayerStore.getState().setIsPlaying(true)
        await get().ensureHostRoom(true, true)
      } else {
        // Another member was elected as the new host
        const newHostRoom = updatedRoom as ListeningRoom
        set({
          joinedRoom: newHostRoom,
          syncStatus: 'synced',
          lastHostUpdate: Date.now()
        })
        await get().handleHostSongChange(newHostRoom)
      }
    } catch (failoverErr) {
      console.warn('[Watchdog] Failover error:', failoverErr)
      await get().handleHostDisconnect()
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

  startDeviceAudioSharing: async () => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be logged in to share audio.')

    // 1. Ensure host room exists
    const room = await get().ensureHostRoom(true)
    if (!room) throw new Error('Could not create or retrieve host room.')

    // 2. Stop existing audio host if any
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      _activeAudioHost = null
    }

    const bitrate = get().deviceAudioBitrate || 510000

    try {
      set({
        isDeviceAudioSharing: true,
        isDeviceAudioMuted: false,
        deviceAudioLevel: 0,
        deviceAudioPeerCount: 0
      })

      const audioHost = new WebRTCAudioHost(room.code, user.id, { bitrateBps: bitrate })
      audioHost.onPeerCountChange = (count) => {
        set({ deviceAudioPeerCount: count })
      }
      audioHost.onLevelChange = (level) => {
        set({ deviceAudioLevel: level })
      }
      audioHost.onError = (err) => {
        console.error('[WebRTCAudioHost] Error:', err)
        set({ error: err.message })
      }
      audioHost.onEnded = () => {
        void get().stopDeviceAudioSharing()
      }

      await audioHost.start()
      _activeAudioHost = audioHost

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      if (currentTrack) {
        broadcastHostLosslessTrack(currentTrack)
      }

      // 4. Broadcast to listening_rooms that host is now streaming device audio
      const deviceSong: SharedSong = {
        title: currentTrack?.title || 'System / Device Audio',
        artist: currentTrack?.artist || user.user_metadata?.display_name || user.email || 'Host',
        album: currentTrack?.album || 'Live Stream',
        duration: currentTrack?.duration || 0,
        artworkUrl:
          currentTrack?.artworkPath && /^https?:\/\//i.test(currentTrack.artworkPath)
            ? currentTrack.artworkPath
            : undefined,
        isDeviceStream: true,
        streamType: 'device_audio'
      }

      await getSupabase()
        .from('listening_rooms')
        .update({
          song: deviceSong,
          is_playing: true,
          position_seconds: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', room.id)

      set((prev) => ({
        hostRoom: prev.hostRoom
          ? {
              ...prev.hostRoom,
              song: deviceSong,
              is_playing: true
            }
          : null
      }))
    } catch (err: any) {
      if (_activeAudioHost) {
        _activeAudioHost.stop()
        _activeAudioHost = null
      }
      set({
        isDeviceAudioSharing: false,
        deviceAudioLevel: 0,
        deviceAudioPeerCount: 0
      })
      throw err
    }
  },

  stopDeviceAudioSharing: async () => {
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      _activeAudioHost = null
    }
    set({
      isDeviceAudioSharing: false,
      isDeviceAudioMuted: false,
      deviceAudioLevel: 0,
      deviceAudioPeerCount: 0
    })

    const hostRoom = get().hostRoom
    const user = useOnlineStore.getState().user
    if (hostRoom && user) {
      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      const normalSong = currentTrack ? toSharedSong(currentTrack) : null

      await getSupabase()
        .from('listening_rooms')
        .update({
          song: normalSong,
          is_playing: playerState.isPlaying,
          position_seconds: Math.round(playerState.currentTime || 0),
          updated_at: new Date().toISOString()
        })
        .eq('id', hostRoom.id)

      set((prev) => ({
        hostRoom: prev.hostRoom
          ? {
              ...prev.hostRoom,
              song: normalSong,
              is_playing: playerState.isPlaying,
              position_seconds: Math.round(playerState.currentTime || 0)
            }
          : null
      }))
    }
  },

  startAutoTrackStreaming: async () => {
    const user = useOnlineStore.getState().user
    const hostRoom = get().hostRoom
    if (!user || !hostRoom) return
    if (_activeAudioHost || get().isDeviceAudioSharing) return

    try {
      const audioHost = new WebRTCAudioHost(hostRoom.code, user.id, {
        bitrateBps: get().deviceAudioBitrate || 510000
      })
      audioHost.onPeerCountChange = (count) => {
        set({ deviceAudioPeerCount: count })
      }
      audioHost.onLevelChange = (level) => {
        set({ deviceAudioLevel: level })
      }
      audioHost.onError = (err) => {
        console.error('[WebRTCAudioHost TrackOnly] Error:', err)
      }
      audioHost.onEnded = () => {
        get().stopAutoTrackStreaming()
      }

      await audioHost.startTrackOnlyMode()
      _activeAudioHost = audioHost
      set({ isAutoStreamingToListeners: true })

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      if (currentTrack) {
        broadcastHostLosslessTrack(currentTrack)
      }
    } catch (err) {
      console.warn('[startAutoTrackStreaming] Error starting track-only audio broadcast:', err)
      if (_activeAudioHost) {
        _activeAudioHost.stop()
        _activeAudioHost = null
      }
      set({ isAutoStreamingToListeners: false })
    }
  },

  stopAutoTrackStreaming: () => {
    if (!get().isDeviceAudioSharing && _activeAudioHost) {
      _activeAudioHost.stop()
      _activeAudioHost = null
    }
    set({ isAutoStreamingToListeners: false })
  },

  connectToDeviceStream: async (room: ListeningRoom) => {
    const user = useOnlineStore.getState().user
    if (!user) return

    // Stop local playback so we only hear the remote stream
    usePlayerStore.getState().setIsPlaying(false)

    if (_activeAudioClient) {
      _activeAudioClient.disconnect()
      _activeAudioClient = null
    }

    set({
      isReceivingDeviceStream: true,
      isAutoplayBlocked: false,
      deviceAudioClientState: 'connecting',
      deviceAudioStats: null,
      deviceAudioClientLevel: 0
    })

    try {
      const client = new WebRTCAudioClient(room.code, user.id, room.host_id, {
        onStateChange: (state) => {
          set({ deviceAudioClientState: state })
        },
        onAutoplayBlocked: (blocked) => {
          set({ isAutoplayBlocked: blocked })
        },
        onStats: (stats) => {
          set({ deviceAudioStats: stats })
        },
        onLevelChange: (level) => {
          set({ deviceAudioClientLevel: level })
        },
        onLosslessReady: (blobUrl) => {
          const currentBlob = get().losslessStreamBlobUrl
          if (currentBlob && currentBlob !== blobUrl) {
            try {
              URL.revokeObjectURL(currentBlob)
            } catch {}
          }
          set({ losslessStreamBlobUrl: blobUrl, isLosslessMasterActive: true })

          // If listener is in device streaming mode, hand over to bit-perfect RAM playback
          const state = get()
          const currentRoom = state.joinedRoom
          if (currentRoom?.song) {
            // Mute the WebRTC Opus stream to prevent double audio playback / echo
            _activeAudioClient?.setMutedForLossless(true)

            const inMemorySong: Song = {
              id: `ephemeral-${currentRoom.song.localId || 'lossless'}`,
              title: currentRoom.song.title,
              artist: currentRoom.song.artist,
              album: currentRoom.song.album || 'Studio Master Stream',
              duration: currentRoom.song.duration || 0,
              artworkPath: currentRoom.song.artworkUrl || '',
              filePath: blobUrl
            }
            usePlayerStore.getState().setQueue([inMemorySong], 0)

            // Precise latency-compensated seeking: calculate time elapsed since host's last update
            const now = Date.now()
            const dbElapsed = Math.max(0, (now - new Date(currentRoom.updated_at).getTime()) / 1000)
            const elapsed = currentRoom.is_playing && dbElapsed < 30 ? dbElapsed : 0
            const rawTarget = (currentRoom.position_seconds || 0) + elapsed
            const duration = currentRoom.song.duration || 0
            const targetPos = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)

            if (targetPos > 0) {
              usePlayerStore.getState().seek(targetPos)
            }
            usePlayerStore.getState().setIsPlaying(currentRoom.is_playing)
            set({ syncStatus: 'synced', missingSong: null })
          }
        },
        onError: (err) => {
          console.error('[WebRTCAudioClient] Error:', err)
          set({ error: err.message, deviceAudioClientState: 'disconnected' })
        }
      })

      client.setVolume(get().deviceAudioVolume)
      await client.connect()
      _activeAudioClient = client
    } catch (err: any) {
      if (_activeAudioClient) {
        _activeAudioClient.disconnect()
        _activeAudioClient = null
      }
      set({
        isReceivingDeviceStream: false,
        deviceAudioClientState: 'disconnected'
      })
      throw err
    }
  },

  disconnectFromDeviceStream: () => {
    if (_activeAudioClient) {
      _activeAudioClient.disconnect()
      _activeAudioClient = null
    }
    const currentBlob = get().losslessStreamBlobUrl
    if (currentBlob) {
      try {
        URL.revokeObjectURL(currentBlob)
      } catch {}
    }
    set({
      isReceivingDeviceStream: false,
      isAutoplayBlocked: false,
      deviceAudioClientState: 'idle',
      deviceAudioStats: null,
      deviceAudioClientLevel: 0,
      losslessStreamBlobUrl: null,
      isLosslessMasterActive: false
    })
  },

  cleanupOnLeave: () => {
    get().disconnectFromDeviceStream()
    setAudioPlaybackRate(1.0)
    _lastSyncedSongId = null
    const currentBlob = get().losslessStreamBlobUrl
    if (currentBlob) {
      try {
        URL.revokeObjectURL(currentBlob)
      } catch {}
    }
    set({
      joinedRoom: null,
      syncStatus: 'idle',
      missingSong: null,
      lastHostUpdate: 0,
      isAutoplayBlocked: false,
      deviceAudioStats: null,
      deviceAudioClientLevel: 0,
      losslessStreamBlobUrl: null,
      isLosslessMasterActive: false
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
    if (_isSessionSyncing || state.isReceivingDeviceStream || state.syncStatus === 'host_reconnecting') return


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

    // Check if the current song matches the host's active song (by metadata)
    const hostSongKey = getSongKey(joined.song)
    const currentSongKey = currentSong
      ? `${normalizeSongValue(currentSong.artist)} - ${normalizeSongValue(currentSong.title)}`
      : ''
    if (hostSongKey && currentSongKey && hostSongKey === currentSongKey) {
      _lastSyncedSongId = currentSong?.id ?? null
      return
    }

    // Check if the current song is part of the host's active session queue
    const isInSessionQueue = joined.queue?.some((qs) => {
      const qKey = `${normalizeSongValue(qs.artist)} - ${normalizeSongValue(qs.title)}`
      return qKey === currentSongKey
    })
    if (isInSessionQueue) {
      _lastSyncedSongId = currentSong?.id ?? null
      return
    }

    // The user manually changed to a completely DIFFERENT song outside the session — auto-leave
    if (!_leaving) {
      _leaving = true
      _lastSyncedSongId = null
      void useListeningStore.getState().leaveJoinedRoom().finally(() => {
        _leaving = false
      })
    }
  })

  // When host changes track while broadcasting audio, stream new track chunks to connected listeners
  usePlayerStore.subscribe((playerState, prevPlayerState) => {
    const currentSong = playerState.queue[playerState.currentSongIndex]
    const prevSong = prevPlayerState.queue[prevPlayerState.currentSongIndex]
    if (currentSong && currentSong.id !== prevSong?.id && _activeAudioHost) {
      broadcastHostLosslessTrack(currentSong)
    }
  })
}


