import { create } from 'zustand'
import type { Song } from '../pages/Library/Library'
import type { UserConnectedDevice, DeviceCategory } from '../online/types'
import { getSupabase } from '../lib/supabase'
import type { PlaybackContext } from './usePlayerStore'
import { remoteClient, type PlaybackTarget } from '../pages/Remote/remoteClient'
import { resolveRemoteSongUrls } from '../lib/songAudioResolver'

export type { PlaybackTarget }
export type PlaybackResolutionPreference = 'ask' | 'remote' | 'transfer'

/** If no playback_state update is received within this window, activePlayback is considered stale */
export const REMOTE_PLAYBACK_STALE_MS = 15_000

export function normalizeDeviceId(id?: string): string {
  if (!id || id === 'pc' || id === 'default' || id === 'default-pc') {
    return 'default-pc'
  }
  return id
}

export interface RemotePlaybackState {
  activeDeviceId: string
  activeDeviceName: string
  activeDeviceType: 'desktop' | 'mobile' | DeviceCategory
  activeDeviceCategory?: DeviceCategory
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
  activeDeviceCategory?: DeviceCategory
  activeSong: Song | null
  activePosition: number
}

export type DevicePlaybackMode = 'local' | 'remote_controller' | 'independent'

interface ConnectedDeviceStoreState {
  activePlayback: RemotePlaybackState | null
  discoveredDevices: UserConnectedDevice[]
  pcLibrarySongs: Song[]
  deviceLibraries: Record<string, Song[]>
  isLoadingPcLibrary: boolean
  isLoadingDeviceLibrary: Record<string, boolean>
  pcLibraryUpdatedAt: number | null
  playbackTarget: PlaybackTarget
  playbackConflict: PlaybackConflictState | null
  resolutionPreference: PlaybackResolutionPreference
  devicePlaybackMode: DevicePlaybackMode
  claimEpoch: number
  setDevicePlaybackMode: (mode: DevicePlaybackMode) => void
  claimPlayback: () => number
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

const deviceLibraryTimers = new Map<string, any>()

function getInitialPlaybackTarget(): PlaybackTarget {
  if (typeof window === 'undefined') return 'desktop'
  const saved = localStorage.getItem('felo_playback_target') as PlaybackTarget
  if (saved === 'desktop' || saved === 'mobile' || saved === 'both') {
    return saved
  }
  return 'desktop'
}

function getInitialResolutionPreference(): PlaybackResolutionPreference {
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('felo_playback_resolution_pref')
    } catch {}
  }
  return 'ask'
}

export const useConnectedDeviceStore = create<ConnectedDeviceStoreState>((set, get) => ({
  activePlayback: null,
  discoveredDevices: [],
  pcLibrarySongs: [],
  deviceLibraries: {},
  isLoadingPcLibrary: false,
  isLoadingDeviceLibrary: {},
  pcLibraryUpdatedAt: null,
  playbackTarget: getInitialPlaybackTarget(),
  playbackConflict: null,
  resolutionPreference: getInitialResolutionPreference(),
  devicePlaybackMode: 'local',
  claimEpoch: Date.now(),
  setDevicePlaybackMode: (devicePlaybackMode) => {
    if (devicePlaybackMode === 'local') {
      set({ devicePlaybackMode, activePlayback: null, claimEpoch: Date.now() })
    } else {
      set({ devicePlaybackMode })
    }
  },
  claimPlayback: () => {
    const nextEpoch = Date.now()
    set({ claimEpoch: nextEpoch, devicePlaybackMode: 'local' })
    return nextEpoch
  },
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
    const existing = deviceLibraryTimers.get('default-pc')
    if (existing) {
      clearTimeout(existing)
      deviceLibraryTimers.delete('default-pc')
    }
    const resolved = resolveRemoteSongUrls(pcLibrarySongs, get().discoveredDevices)
    set((state) => ({
      pcLibrarySongs: resolved,
      deviceLibraries: {
        ...state.deviceLibraries,
        default: resolved,
        'default-pc': resolved,
        pc: resolved
      },
      isLoadingPcLibrary: false,
      isLoadingDeviceLibrary: {
        ...state.isLoadingDeviceLibrary,
        'default-pc': false
      },
      pcLibraryUpdatedAt: Date.now()
    }))
  },
  setDeviceLibrarySongs: (deviceId, songs) => {
    const canonicalId = normalizeDeviceId(deviceId)
    const isDefaultPc = canonicalId === 'default-pc'
    const existing = deviceLibraryTimers.get(canonicalId)
    if (existing) {
      clearTimeout(existing)
      deviceLibraryTimers.delete(canonicalId)
    }
    const resolved = resolveRemoteSongUrls(songs, get().discoveredDevices)
    set((state) => ({
      pcLibrarySongs: isDefaultPc ? resolved : state.pcLibrarySongs,
      deviceLibraries: {
        ...state.deviceLibraries,
        [canonicalId]: resolved,
        ...(isDefaultPc ? { default: resolved, 'default-pc': resolved, pc: resolved } : {})
      },
      isLoadingPcLibrary: isDefaultPc ? false : state.isLoadingPcLibrary,
      isLoadingDeviceLibrary: {
        ...state.isLoadingDeviceLibrary,
        [canonicalId]: false
      },
      pcLibraryUpdatedAt: Date.now()
    }))
  },
  getDeviceSongs: (deviceId) => {
    const canonicalId = normalizeDeviceId(deviceId)
    const state = get()
    if (canonicalId in state.deviceLibraries) {
      return state.deviceLibraries[canonicalId]
    }
    return state.pcLibrarySongs
  },
  setIsLoadingPcLibrary: (isLoadingPcLibrary) => set({ isLoadingPcLibrary }),
  loadCachedPcSongs: (userId?: string, deviceId?: string) => {
    if (typeof window === 'undefined') return []
    try {
      const canonicalId = normalizeDeviceId(deviceId)
      const isSpecific = canonicalId !== 'default-pc'
      const specificKey = userId && isSpecific ? `felo_cached_songs_${userId}_${canonicalId}` : null
      const defaultKey = userId ? `felo_cached_pc_songs_${userId}` : 'felo_cached_pc_songs'
      const cached = isSpecific
        ? (specificKey ? localStorage.getItem(specificKey) : null)
        : localStorage.getItem(defaultKey)
      if (cached) {
        const parsed = JSON.parse(cached) as Song[]
        if (Array.isArray(parsed)) {
          const resolved = resolveRemoteSongUrls(parsed, get().discoveredDevices)
          set((state) => ({
            pcLibrarySongs: !isSpecific ? resolved : state.pcLibrarySongs,
            deviceLibraries: {
              ...state.deviceLibraries,
              [canonicalId]: resolved,
              ...(!isSpecific ? { default: resolved, 'default-pc': resolved, pc: resolved } : {})
            }
          }))
          return resolved
        }
      }
    } catch (err) {
      console.warn('[useConnectedDeviceStore] Failed to load cached songs:', err)
    }
    return []
  },
  requestPcLibrary: async (userId: string, targetDeviceId?: string) => {
    if (!userId) return
    const canonicalId = normalizeDeviceId(targetDeviceId)
    const isDefaultPc = canonicalId === 'default-pc'

    const existing = deviceLibraryTimers.get(canonicalId)
    if (existing) {
      clearTimeout(existing)
    }

    set((state) => ({
      isLoadingPcLibrary: isDefaultPc ? true : state.isLoadingPcLibrary,
      isLoadingDeviceLibrary: {
        ...state.isLoadingDeviceLibrary,
        [canonicalId]: true
      }
    }))

    const timer = setTimeout(() => {
      deviceLibraryTimers.delete(canonicalId)
      set((state) => ({
        isLoadingPcLibrary: isDefaultPc ? false : state.isLoadingPcLibrary,
        isLoadingDeviceLibrary: {
          ...state.isLoadingDeviceLibrary,
          [canonicalId]: false
        }
      }))
    }, 6000)
    deviceLibraryTimers.set(canonicalId, timer)

    try {
      const supabase = getSupabase()
      const myId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : undefined
      const payload = { requesterDeviceId: myId, targetDeviceId: canonicalId }
      // Send single deduplicated request_device_library event
      await supabase.channel(`user_playback_sync_${userId}`).send({
        type: 'broadcast',
        event: 'request_device_library',
        payload
      })
    } catch (err) {
      console.warn('[useConnectedDeviceStore] Failed to request device library:', err)
      deviceLibraryTimers.delete(canonicalId)
      set((state) => ({
        isLoadingPcLibrary: isDefaultPc ? false : state.isLoadingPcLibrary,
        isLoadingDeviceLibrary: {
          ...state.isLoadingDeviceLibrary,
          [canonicalId]: false
        }
      }))
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
      // LAN dispatch succeeded — skip cloud broadcast to prevent duplicate command execution
      return
    } catch {
      // LAN dispatch failed — fall through to cloud broadcast as backup
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

