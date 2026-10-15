import { create } from 'zustand'
import type { Song } from '../pages/Library/Library'
import type { UserConnectedDevice } from '../online/types'
import { getSupabase } from '../lib/supabase'
import type { PlaybackContext } from './usePlayerStore'
import { remoteClient } from '../pages/Remote/remoteClient'

export type PlaybackTarget = 'desktop' | 'mobile' | 'both'
export type PlaybackResolutionPreference = 'ask' | 'remote' | 'transfer'

export interface RemotePlaybackState {
  activeDeviceId: string
  activeDeviceName: string
  activeDeviceType: 'desktop' | 'mobile'
  isPlaying: boolean
  song: Song | null
  position: number
  duration: number
  timestamp: number
  lyrics?: {
    plainLyrics?: string
    syncedLyrics?: string
  }
}

export interface PlaybackConflictState {
  pendingSong?: Song
  pendingQueue?: Song[]
  pendingIndex?: number
  pendingContext?: PlaybackContext | null
  activeDeviceId: string
  activeDeviceName: string
  activeSong: Song | null
  activePosition: number
}

interface ConnectedDeviceStoreState {
  activePlayback: RemotePlaybackState | null
  discoveredDevices: UserConnectedDevice[]
  pcLibrarySongs: Song[]
  deviceLibraries: Record<string, Song[]>
  isLoadingPcLibrary: boolean
  pcLibraryUpdatedAt: number | null
  playbackTarget: PlaybackTarget
  playbackConflict: PlaybackConflictState | null
  resolutionPreference: PlaybackResolutionPreference
  setPlaybackTarget: (target: PlaybackTarget) => void
  setPlaybackConflict: (conflict: PlaybackConflictState | null) => void
  setResolutionPreference: (pref: PlaybackResolutionPreference, rememberSession?: boolean) => void
  setRemotePlayback: (state: RemotePlaybackState | null) => void
  updateRemotePosition: (position: number) => void
  setDiscoveredDevices: (devices: UserConnectedDevice[]) => void
  clearRemotePlayback: () => void
  setPcLibrarySongs: (songs: Song[]) => void
  setDeviceLibrarySongs: (deviceId: string, songs: Song[]) => void
  getDeviceSongs: (deviceId?: string) => Song[]
  setIsLoadingPcLibrary: (loading: boolean) => void
  loadCachedPcSongs: (userId?: string, deviceId?: string) => Song[]
  requestPcLibrary: (userId: string, targetDeviceId?: string) => Promise<void>
}

let pcLibraryTimeoutTimer: any = null

function getInitialPlaybackTarget(): PlaybackTarget {
  if (typeof window === 'undefined') return 'desktop'
  const saved = localStorage.getItem('felo_playback_target') as PlaybackTarget
  if (saved === 'desktop' || saved === 'mobile' || saved === 'both') {
    return saved
  }
  return 'desktop'
}

function getInitialResolutionPreference(): PlaybackResolutionPreference {
  if (typeof window === 'undefined') return 'ask'
  const saved = sessionStorage.getItem('felo_playback_resolution_pref') as PlaybackResolutionPreference
  if (saved === 'remote' || saved === 'transfer' || saved === 'ask') {
    return saved
  }
  return 'ask'
}

export const useConnectedDeviceStore = create<ConnectedDeviceStoreState>((set, get) => ({
  activePlayback: null,
  discoveredDevices: [],
  pcLibrarySongs: [],
  deviceLibraries: {},
  isLoadingPcLibrary: false,
  pcLibraryUpdatedAt: null,
  playbackTarget: getInitialPlaybackTarget(),
  playbackConflict: null,
  resolutionPreference: getInitialResolutionPreference(),
  setPlaybackTarget: (playbackTarget) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('felo_playback_target', playbackTarget)
    }
    set({ playbackTarget })
  },
  setPlaybackConflict: (playbackConflict) => set({ playbackConflict }),
  setResolutionPreference: (resolutionPreference, rememberSession = true) => {
    if (rememberSession && typeof window !== 'undefined') {
      sessionStorage.setItem('felo_playback_resolution_pref', resolutionPreference)
    }
    set({ resolutionPreference })
  },
  setRemotePlayback: (activePlayback) => set({ activePlayback }),
  updateRemotePosition: (position) =>
    set((state) =>
      state.activePlayback
        ? { activePlayback: { ...state.activePlayback, position, timestamp: Date.now() } }
        : state
    ),
  setDiscoveredDevices: (discoveredDevices) => set({ discoveredDevices }),
  clearRemotePlayback: () => set({ activePlayback: null }),
  setPcLibrarySongs: (pcLibrarySongs) => {
    if (pcLibraryTimeoutTimer) clearTimeout(pcLibraryTimeoutTimer)
    set((state) => ({
      pcLibrarySongs,
      deviceLibraries: { ...state.deviceLibraries, default: pcLibrarySongs },
      isLoadingPcLibrary: false,
      pcLibraryUpdatedAt: Date.now()
    }))
  },
  setDeviceLibrarySongs: (deviceId, songs) => {
    if (pcLibraryTimeoutTimer) clearTimeout(pcLibraryTimeoutTimer)
    set((state) => ({
      pcLibrarySongs: songs,
      deviceLibraries: { ...state.deviceLibraries, [deviceId]: songs },
      isLoadingPcLibrary: false,
      pcLibraryUpdatedAt: Date.now()
    }))
  },
  getDeviceSongs: (deviceId) => {
    const state = get()
    if (deviceId && state.deviceLibraries[deviceId]?.length > 0) {
      return state.deviceLibraries[deviceId]
    }
    return state.pcLibrarySongs
  },
  setIsLoadingPcLibrary: (isLoadingPcLibrary) => set({ isLoadingPcLibrary }),
  loadCachedPcSongs: (userId?: string, deviceId?: string) => {
    if (typeof window === 'undefined') return []
    try {
      const specificKey = userId && deviceId ? `felo_cached_songs_${userId}_${deviceId}` : null
      const defaultKey = userId ? `felo_cached_pc_songs_${userId}` : 'felo_cached_pc_songs'
      const cached =
        (specificKey ? localStorage.getItem(specificKey) : null) || localStorage.getItem(defaultKey)
      if (cached) {
        const parsed = JSON.parse(cached) as Song[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          set((state) => ({
            pcLibrarySongs: parsed,
            deviceLibraries: deviceId
              ? { ...state.deviceLibraries, [deviceId]: parsed }
              : state.deviceLibraries
          }))
          return parsed
        }
      }
    } catch (err) {
      console.warn('[useConnectedDeviceStore] Failed to load cached PC songs:', err)
    }
    return []
  },
  requestPcLibrary: async (userId: string, targetDeviceId?: string) => {
    if (!userId) return
    set({ isLoadingPcLibrary: true })
    if (pcLibraryTimeoutTimer) clearTimeout(pcLibraryTimeoutTimer)
    pcLibraryTimeoutTimer = setTimeout(() => {
      set({ isLoadingPcLibrary: false })
    }, 6000)
    try {
      const supabase = getSupabase()
      const myId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : undefined
      await supabase.channel(`user_playback_sync_${userId}`).send({
        type: 'broadcast',
        event: 'request_pc_library',
        payload: { requesterDeviceId: myId, targetDeviceId }
      })
    } catch (err) {
      console.warn('[useConnectedDeviceStore] Failed to request PC library:', err)
      set({ isLoadingPcLibrary: false })
    }
  }
}))

export function getInterpolatedPosition(state: RemotePlaybackState | null): number {
  if (!state) return 0
  if (!state.isPlaying) return state.position
  const elapsed = (Date.now() - state.timestamp) / 1000
  return Math.min(state.duration, state.position + elapsed)
}

export async function sendDeviceCommand(
  userId: string,
  targetDeviceId: string,
  action: 'play' | 'pause' | 'togglePlay' | 'next' | 'previous' | 'seek' | 'volume',
  data: Record<string, any> = {}
) {
  // If remoteClient is actively connected over local LAN to desktop, dispatch local HTTP command immediately
  if (
    remoteClient.getIsConnected() &&
    (!targetDeviceId ||
      targetDeviceId === 'desktop' ||
      targetDeviceId === 'pc' ||
      targetDeviceId === 'default-pc')
  ) {
    try {
      if (action === 'play') void remoteClient.play(data.songId)
      else if (action === 'pause') void remoteClient.pause()
      else if (action === 'togglePlay') void remoteClient.togglePlay()
      else if (action === 'next') void remoteClient.next()
      else if (action === 'previous') void remoteClient.previous()
      else if (action === 'seek' && typeof data.seconds === 'number') void remoteClient.seek(data.seconds)
      else if (action === 'volume' && typeof data.volume === 'number') void remoteClient.setVolume(data.volume * 100)
    } catch {
      // ignore
    }
  }

  if (!userId || !targetDeviceId) return
  try {
    const supabase = getSupabase()
    await supabase.channel(`user_playback_sync_${userId}`).send({
      type: 'broadcast',
      event: 'command',
      payload: {
        targetDeviceId,
        action,
        ...data
      }
    })
  } catch (err) {
    console.warn('[sendDeviceCommand] Failed to send command:', err)
  }
}

