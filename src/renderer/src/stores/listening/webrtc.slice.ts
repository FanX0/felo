import type { StateCreator } from 'zustand'
import type { WebRTCSlice, ListeningStoreState } from './types'
import type { ListeningRoom, SharedSong } from '../../online/types'
import { WebRTCAudioHost, WebRTCAudioClient } from '../../lib/webrtcAudioStream'
import { unlockAudioElement, getActiveAudioElement } from '../../lib/audioBridge'
import { getCurrentDeviceId } from '../../lib/deviceInfo'
import { getSupabase } from '../../lib/supabase'
import { usePlayerStore } from '../player/usePlayerStore'
import { useOnlineStore } from '../useOnlineStore'
import { cacheAudioBlob } from '../../lib/jitAudioPipeline'
import {
  _activeAudioHost,
  setActiveAudioHost,
  _activeAudioClient,
  setActiveAudioClient,
  _audioClientWatchdog,
  setAudioClientWatchdog,
  _preDeviceAudioState,
  setPreDeviceAudioState,
  broadcastHostLosslessTrack,
  toSharedSong,
  getSongKey
} from './helpers'

export const createWebRTCSlice: StateCreator<
  ListeningStoreState,
  [],
  [],
  WebRTCSlice
> = (set, get) => ({
  isDeviceAudioSharing: false,
  isAutoStreamingToListeners: false,
  isReceivingDeviceStream: false,
  deviceAudioLevel: 0,
  deviceAudioPeerCount: 0,
  deviceAudioClientState: 'idle',
  deviceAudioBitrate: 256000,
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
      void _activeAudioHost.setBitrate(bitrate)
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

  setIsAutoplayBlocked: (blocked: boolean) => {
    set({ isAutoplayBlocked: blocked })
  },

  enableSpeakerAudio: async (): Promise<boolean> => {
    const ok = await unlockAudioElement()
    set({ isAutoplayBlocked: false })
    const player = usePlayerStore.getState()
    player.claimAudioOwnership()
    const activeEl = getActiveAudioElement()
    if (activeEl) {
      activeEl.muted = false
      activeEl.volume = player.volume ?? 1.0
      const currentTrack = player.queue[player.currentSongIndex]
      if (currentTrack) {
        try {
          await activeEl.play()
        } catch (err) {
          console.warn('[enableSpeakerAudio] direct play error:', err)
        }
      }
    }
    const joined = get().joinedRoom
    if (joined?.is_playing) {
      player.setIsPlaying(true)
    }
    if (_activeAudioClient) {
      void _activeAudioClient.resumeAudio()
      void _activeAudioClient.unmuteAudio()
    }
    return ok
  },

  unmuteDeviceStream: async () => {
    void unlockAudioElement()
    set({ isAutoplayBlocked: false })
    const player = usePlayerStore.getState()
    player.claimAudioOwnership()
    if (_activeAudioClient) {
      void _activeAudioClient.resumeAudio()
      const ok = await _activeAudioClient.unmuteAudio()
      return ok
    }
    const activeEl = getActiveAudioElement()
    if (activeEl) {
      activeEl.muted = false
      try {
        await activeEl.play()
      } catch {}
    }
    player.setIsPlaying(true)
    return true
  },

  startDeviceAudioSharing: async () => {
    const user = useOnlineStore.getState().user
    if (!user) throw new Error('You must be logged in to share audio.')

    // 1. Ensure host room exists
    const room = get().hostRoom || (await get().ensureHostRoom(true, true))
    if (!room) throw new Error('Could not create or retrieve host room.')

    // 2. Stop existing audio host if any
    if (_activeAudioHost) {
      _activeAudioHost.stop()
      setActiveAudioHost(null)
    }

    const bitrate = get().deviceAudioBitrate || 256000

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
      audioHost.onUploadProgress = (trackId, percent, statusText, receivedBytes, totalBytes) => {
        get().setJitStatus(trackId, percent, statusText, receivedBytes, totalBytes)
      }
      audioHost.onError = (err) => {
        console.error('[WebRTCAudioHost] Error:', err)
        set({ error: err.message })
      }
      audioHost.onEnded = () => {
        void get().stopDeviceAudioSharing()
      }

      await audioHost.start()
      setActiveAudioHost(audioHost)

      const playerState = usePlayerStore.getState()
      setPreDeviceAudioState({
        isPlaying: playerState.isPlaying,
        currentSongIndex: playerState.currentSongIndex,
        currentTime: playerState.currentTime || 0
      })
      if (playerState.isPlaying) {
        usePlayerStore.getState().setIsPlaying(false)
      }

      // 4. Broadcast to listening_rooms that host is now streaming system/device audio
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      const deviceSong: SharedSong = {
        title: currentTrack?.title ? `Device Sound: ${currentTrack.title}` : 'System / Device Audio',
        artist: user.user_metadata?.display_name || user.email || 'Host',
        album: 'Live Device Audio Broadcast',
        duration: 0,
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
          is_device_stream: true,
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
              is_device_stream: true,
              is_playing: true
            }
          : null
      }))
    } catch (err: any) {
      if (_activeAudioHost) {
        _activeAudioHost.stop()
        setActiveAudioHost(null)
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
      setActiveAudioHost(null)
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
      const preState = _preDeviceAudioState
      setPreDeviceAudioState(null)
      if (preState) {
        if (preState.currentTime > 0) {
          usePlayerStore.getState().seek(preState.currentTime)
        }
        usePlayerStore.getState().setIsPlaying(preState.isPlaying)
      }

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      const normalSong = currentTrack ? toSharedSong(currentTrack) : null

      await getSupabase()
        .from('listening_rooms')
        .update({
          song: normalSong,
          is_device_stream: false,
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
              is_device_stream: false,
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

    let audioHostInstance: WebRTCAudioHost | null = null
    try {
      const audioHost = new WebRTCAudioHost(hostRoom.code, user.id, {
        bitrateBps: get().deviceAudioBitrate || 256000
      })
      audioHostInstance = audioHost
      audioHost.onPeerCountChange = (count) => {
        set({ deviceAudioPeerCount: count })
      }
      audioHost.onLevelChange = (level) => {
        set({ deviceAudioLevel: level })
      }
      audioHost.onUploadProgress = (trackId, percent, statusText, receivedBytes, totalBytes) => {
        get().setJitStatus(trackId, percent, statusText, receivedBytes, totalBytes)
      }
      audioHost.onError = (err) => {
        console.error('[WebRTCAudioHost TrackOnly] Error:', err)
      }
      audioHost.onEnded = () => {
        get().stopAutoTrackStreaming()
      }

      await audioHost.startTrackOnlyMode()
      setActiveAudioHost(audioHost)
      set({ isAutoStreamingToListeners: true })

      const playerState = usePlayerStore.getState()
      const currentTrack = playerState.queue[playerState.currentSongIndex]
      if (currentTrack) {
        broadcastHostLosslessTrack(currentTrack)
      }

      // Persist active streaming status to listening_rooms
      void getSupabase()
        .from('listening_rooms')
        .update({ is_track_streaming: true, updated_at: new Date().toISOString() })
        .eq('id', hostRoom.id)
    } catch (err) {
      console.warn('[startAutoTrackStreaming] Error starting track-only audio broadcast:', err)
      if (audioHostInstance) {
        audioHostInstance.stop()
        setActiveAudioHost(null)
      }
      set({ isAutoStreamingToListeners: false })
    }
  },

  stopAutoTrackStreaming: () => {
    if (!get().isDeviceAudioSharing && _activeAudioHost) {
      _activeAudioHost.stop()
      setActiveAudioHost(null)
    }
    const hostRoom = get().hostRoom
    if (hostRoom?.id) {
      void getSupabase()
        .from('listening_rooms')
        .update({ is_track_streaming: false, updated_at: new Date().toISOString() })
        .eq('id', hostRoom.id)
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
      setActiveAudioClient(null)
    }

    set({
      isReceivingDeviceStream: true,
      isAutoplayBlocked: false,
      deviceAudioClientState: 'connecting',
      deviceAudioStats: null,
      deviceAudioClientLevel: 0
    })

    if (_audioClientWatchdog) {
      clearTimeout(_audioClientWatchdog)
      setAudioClientWatchdog(null)
    }

    const watchdog = setTimeout(() => {
      if (get().deviceAudioClientState === 'connecting') {
        console.warn('[WebRTCAudioClient] Connection watchdog: stream connection took longer than 30s')
        set({
          error: 'Connecting to host stream is taking longer than expected. Retrying...',
          deviceAudioClientState: 'disconnected'
        })
      }
    }, 30000)
    setAudioClientWatchdog(watchdog)

    try {
      const clientId = `${user.id}_${getCurrentDeviceId() || Math.random().toString(36).slice(2, 8)}`
      const client = new WebRTCAudioClient(room.code, clientId, room.host_id, {
        onStateChange: (state) => {
          if (state === 'connected') {
            if (_audioClientWatchdog) {
              clearTimeout(_audioClientWatchdog)
              setAudioClientWatchdog(null)
            }
            set({ error: null })
          }
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
        onLosslessReady: (blobUrl, mimeType) => {
          console.log('[WebRTCAudioClient] Lossless audio ready in RAM:', mimeType)
          set({
            losslessStreamBlobUrl: blobUrl,
            isLosslessMasterActive: true,
            syncStatus: 'synced'
          })
          const state = get()
          const currentRoomSong = state.joinedRoom?.song
          if (currentRoomSong && blobUrl) {
            const songId = (currentRoomSong as any).id || currentRoomSong.localId || getSongKey(currentRoomSong)
            cacheAudioBlob(songId, new Blob([], { type: mimeType }))
            const player = usePlayerStore.getState()
            if (state.joinedRoom?.is_playing && !player.isPlaying) {
              player.setIsPlaying(true)
            }
          }
        },
        onJITProgress: (trackId, percent, statusText, receivedBytes, totalBytes) => {
          get().setJitStatus(trackId, percent, statusText, receivedBytes, totalBytes)
          if (percent < 100) {
            if (get().syncStatus !== 'buffering') {
              set({ syncStatus: 'buffering' })
            }
          } else {
            if (get().syncStatus === 'buffering') {
              set({ syncStatus: 'synced' })
            }
          }
        },
        onError: (err) => {
          if (_audioClientWatchdog) {
            clearTimeout(_audioClientWatchdog)
            setAudioClientWatchdog(null)
          }
          console.error('[WebRTCAudioClient] Error:', err)
          set({ error: err.message, deviceAudioClientState: 'disconnected' })
        }
      })

      client.setVolume(get().deviceAudioVolume)
      await client.connect()
      setActiveAudioClient(client)
    } catch (err: any) {
      if (_audioClientWatchdog) {
        clearTimeout(_audioClientWatchdog)
        setAudioClientWatchdog(null)
      }
      if (_activeAudioClient) {
        _activeAudioClient.disconnect()
        setActiveAudioClient(null)
      }
      set({
        isReceivingDeviceStream: false,
        deviceAudioClientState: 'disconnected'
      })
      throw err
    }
  },

  disconnectFromDeviceStream: () => {
    if (_audioClientWatchdog) {
      clearTimeout(_audioClientWatchdog)
      setAudioClientWatchdog(null)
    }
    if (_activeAudioClient) {
      _activeAudioClient.disconnect()
      setActiveAudioClient(null)
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
  }
})
