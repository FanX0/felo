import { create } from 'zustand'
import type { Song } from '../pages/Library/Library'
import type { UserConnectedDevice } from '../online/types'
import { getSupabase } from '../lib/supabase'

export interface RemotePlaybackState {
  activeDeviceId: string
  activeDeviceName: string
  activeDeviceType: 'desktop' | 'mobile'
  isPlaying: boolean
  song: Song | null
  position: number
  duration: number
  timestamp: number
}

interface ConnectedDeviceStoreState {
  activePlayback: RemotePlaybackState | null
  discoveredDevices: UserConnectedDevice[]
  setRemotePlayback: (state: RemotePlaybackState | null) => void
  updateRemotePosition: (position: number) => void
  setDiscoveredDevices: (devices: UserConnectedDevice[]) => void
  clearRemotePlayback: () => void
}

export const useConnectedDeviceStore = create<ConnectedDeviceStoreState>((set) => ({
  activePlayback: null,
  discoveredDevices: [],
  setRemotePlayback: (activePlayback) => set({ activePlayback }),
  updateRemotePosition: (position) =>
    set((state) =>
      state.activePlayback
        ? { activePlayback: { ...state.activePlayback, position, timestamp: Date.now() } }
        : state
    ),
  setDiscoveredDevices: (discoveredDevices) => set({ discoveredDevices }),
  clearRemotePlayback: () => set({ activePlayback: null })
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

