import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import {
  getTabInstanceId,
  broadcastCrossTabMessage,
  subscribeCrossTabSync,
  type CrossTabSyncMessage,
  type PlayerSyncSnapshot
} from '../lib/crossTabSync'
import { getActiveAudioTime, getActiveAudioElement } from '../lib/audioBridge'
import { getDeterministicDeviceKey } from '../lib/deviceFingerprint'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'

export default function CrossTabSyncBridge(): null {
  const isApplyingRemoteRef = useRef(false)
  const heartbeatTimerRef = useRef<any>(null)
  const desktopProbeTimerRef = useRef<any>(null)
  const realtimeChannelRef = useRef<any>(null)
  const tabId = getTabInstanceId()
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)

  // ─── 1. Cross-Origin Supabase Realtime Sync Channel ─────────────────
  // Coordinates playback across different origins (e.g. localhost:5173 vs deployed domain)
  // and native Desktop app on the same device (or across the user's account).
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined

    let isDisposed = false
    let currentChannel: any = null

    const initRealtimeChannel = async () => {
      try {
        const deviceKey = await getDeterministicDeviceKey()
        if (isDisposed) return

        const channelTopic = user?.id
          ? `user_sync_${user.id}`
          : `device_sync_${deviceKey}`

        const supabase = getSupabase()
        const channel = supabase.channel(`felo_playback_${channelTopic}`, {
          config: {
            broadcast: { ack: false, self: false }
          }
        })

        channel.on('broadcast', { event: 'felo_playback' }, ({ payload }) => {
          if (!payload || payload.senderId === tabId) return

          const state = usePlayerStore.getState()

          switch (payload.type) {
            case 'CLAIM_PLAYBACK': {
              // Another instance (e.g. deployed domain or localhost) started audio playback!
              // 1. Immediately pause local audio element if playing
              const audio = getActiveAudioElement()
              if (audio && !audio.paused) {
                audio.pause()
              }

              // 2. Relinquish audio ownership in local store
              isApplyingRemoteRef.current = true
              state.syncFromExternal({
                ...payload.payload,
                activeInstanceId: payload.senderId
              })

              // 3. Relay to local BroadcastChannel so any sibling tabs on this origin also yield
              broadcastCrossTabMessage({
                type: 'CLAIM_PLAYBACK',
                senderId: payload.senderId,
                payload: payload.payload
              })
              break
            }

            case 'STATE_UPDATE': {
              if (state.activeInstanceId === tabId && state.isAudioActive) {
                // If this tab is currently the active audio owner, ignore passive state updates
                return
              }
              isApplyingRemoteRef.current = true
              state.syncFromExternal(payload.payload)

              // Relay to local sibling tabs
              broadcastCrossTabMessage({
                type: 'STATE_UPDATE',
                senderId: payload.senderId,
                payload: payload.payload
              })
              break
            }

            case 'RELEASE_PLAYBACK': {
              if (state.activeInstanceId === payload.senderId) {
                isApplyingRemoteRef.current = true
                state.syncFromExternal({
                  isPlaying: false,
                  activeInstanceId: undefined
                })
                broadcastCrossTabMessage({
                  type: 'RELEASE_PLAYBACK',
                  senderId: payload.senderId
                })
              }
              break
            }

            case 'REQUEST_SYNC_STATE': {
              if (state.isAudioActive && (state.queue.length > 0 || state.isPlaying)) {
                const audioTime = getActiveAudioTime() || state.currentTime
                const snapshot: PlayerSyncSnapshot = {
                  isPlaying: state.isPlaying,
                  isBuffering: state.isBuffering,
                  currentSongIndex: state.currentSongIndex,
                  queue: state.queue,
                  originalQueue: state.originalQueue,
                  currentTime: audioTime,
                  duration: state.duration,
                  volume: state.volume,
                  isShuffle: state.isShuffle,
                  repeatMode: state.repeatMode,
                  playbackContext: state.playbackContext,
                  timestamp: Date.now(),
                  activeInstanceId: tabId
                }
                sendRealtimeBroadcast('SYNC_STATE_RESPONSE', {
                  targetId: payload.senderId,
                  snapshot
                })
              }
              break
            }

            case 'SYNC_STATE_RESPONSE': {
              if (payload.payload?.targetId && payload.payload.targetId !== tabId) return
              if (!payload.payload?.snapshot) return
              isApplyingRemoteRef.current = true
              state.syncFromExternal({
                ...payload.payload.snapshot,
                activeInstanceId: payload.senderId
              })
              break
            }
          }
        })

        channel.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            sendRealtimeBroadcast('REQUEST_SYNC_STATE')
          }
        })
        currentChannel = channel
        realtimeChannelRef.current = channel
      } catch (err) {
        console.warn('[CrossTabSync] Failed to initialize cross-origin Realtime channel:', err)
      }
    }

    void initRealtimeChannel()

    return () => {
      isDisposed = true
      if (currentChannel) {
        try {
          const supabase = getSupabase()
          void supabase.removeChannel(currentChannel)
        } catch {
          // ignore
        }
      }
      realtimeChannelRef.current = null
    }
  }, [user?.id, tabId])

  // Helper to send cross-origin broadcast messages
  const sendRealtimeBroadcast = (type: string, payload?: any) => {
    const channel = realtimeChannelRef.current
    if (!channel) return
    try {
      void channel.send({
        type: 'broadcast',
        event: 'felo_playback',
        payload: {
          type,
          senderId: tabId,
          origin: typeof window !== 'undefined' ? window.location.origin : '',
          timestamp: Date.now(),
          payload
        }
      })
    } catch {
      // ignore
    }
  }

  // ─── 2. Same-Origin BroadcastChannel & Local Tab Coordination ──────
  useEffect(() => {
    const handleIncomingMessage = (message: CrossTabSyncMessage) => {
      const state = usePlayerStore.getState()

      switch (message.type) {
        case 'REQUEST_SYNC_STATE': {
          // If this tab is the active audio owner and has a playlist/song loaded, reply with current snapshot
          if (state.isAudioActive && (state.queue.length > 0 || state.isPlaying)) {
            const audioTime = getActiveAudioTime() || state.currentTime
            const snapshot: PlayerSyncSnapshot = {
              isPlaying: state.isPlaying,
              isBuffering: state.isBuffering,
              currentSongIndex: state.currentSongIndex,
              queue: state.queue,
              originalQueue: state.originalQueue,
              currentTime: audioTime,
              duration: state.duration,
              volume: state.volume,
              isShuffle: state.isShuffle,
              repeatMode: state.repeatMode,
              playbackContext: state.playbackContext,
              timestamp: Date.now(),
              activeInstanceId: tabId
            }

            broadcastCrossTabMessage({
              type: 'SYNC_STATE_RESPONSE',
              senderId: tabId,
              targetId: message.senderId,
              payload: snapshot
            })
          }
          break
        }

        case 'SYNC_STATE_RESPONSE': {
          if (message.targetId && message.targetId !== tabId) return
          // Another tab is already active and sent us its state!
          isApplyingRemoteRef.current = true
          state.syncFromExternal({
            ...message.payload,
            activeInstanceId: message.senderId
          })
          break
        }

        case 'CLAIM_PLAYBACK': {
          if (message.senderId === tabId) return

          // Another tab took over audio playback!
          const audio = getActiveAudioElement()
          if (audio && !audio.paused) {
            audio.pause()
          }

          isApplyingRemoteRef.current = true
          state.syncFromExternal({
            ...message.payload,
            activeInstanceId: message.senderId
          })
          break
        }

        case 'STATE_UPDATE': {
          if (message.senderId === tabId) return
          isApplyingRemoteRef.current = true
          state.syncFromExternal(message.payload)
          break
        }

        case 'COMMAND': {
          // Only the active audio owner executes remote commands
          if (!state.isAudioActive) return

          switch (message.command) {
            case 'play':
              state.setIsPlaying(true)
              break
            case 'pause':
              state.setIsPlaying(false)
              break
            case 'next':
              state.playNext(true)
              break
            case 'prev':
              state.playPrevious()
              break
            case 'seek':
              if (typeof message.value === 'number') {
                state.seek(message.value)
              }
              break
            case 'volume':
              if (typeof message.value === 'number') {
                state.setVolume(message.value)
              }
              break
          }
          break
        }

        case 'RELEASE_PLAYBACK': {
          if (message.senderId === tabId) return
          if (state.activeInstanceId === message.senderId) {
            isApplyingRemoteRef.current = true
            state.syncFromExternal({
              isPlaying: false,
              activeInstanceId: undefined
            })
          }
          break
        }
      }
    }

    const unsubscribeMessages = subscribeCrossTabSync(handleIncomingMessage)

    // On mount, ask other open tabs on this origin if any is already playing
    broadcastCrossTabMessage({
      type: 'REQUEST_SYNC_STATE',
      senderId: tabId
    })

    // Listen to local store changes and broadcast to other tabs & origins
    const unsubscribeStore = usePlayerStore.subscribe((curr, prev) => {
      // If this update was triggered by an incoming sync message, do not re-broadcast
      if (isApplyingRemoteRef.current) {
        isApplyingRemoteRef.current = false
        return
      }

      // Check what changed
      const audioActiveChanged = curr.isAudioActive !== prev.isAudioActive
      const songChanged =
        curr.currentSongIndex !== prev.currentSongIndex ||
        curr.queue[curr.currentSongIndex]?.id !== prev.queue[prev.currentSongIndex]?.id
      const queueChanged = curr.queue.length !== prev.queue.length
      const playChanged = curr.isPlaying !== prev.isPlaying
      const volumeChanged = Math.abs(curr.volume - prev.volume) > 0.001
      const modesChanged = curr.isShuffle !== prev.isShuffle || curr.repeatMode !== prev.repeatMode
      const seekChanged = curr.seekRequest !== null && curr.seekRequest !== prev.seekRequest

      // Case 1: This tab became the active audio owner, or started playing a new track
      if (curr.isAudioActive && (audioActiveChanged || (curr.isPlaying && (songChanged || playChanged)))) {
        const audioTime = getActiveAudioTime() || curr.currentTime
        const snapshot: PlayerSyncSnapshot = {
          isPlaying: curr.isPlaying,
          isBuffering: curr.isBuffering,
          currentSongIndex: curr.currentSongIndex,
          queue: curr.queue,
          originalQueue: curr.originalQueue,
          currentTime: audioTime,
          duration: curr.duration,
          volume: curr.volume,
          isShuffle: curr.isShuffle,
          repeatMode: curr.repeatMode,
          playbackContext: curr.playbackContext,
          timestamp: Date.now(),
          activeInstanceId: tabId
        }

        // Broadcast to same-origin tabs
        broadcastCrossTabMessage({
          type: 'CLAIM_PLAYBACK',
          senderId: tabId,
          payload: snapshot
        })

        // Broadcast cross-origin via Supabase Realtime
        sendRealtimeBroadcast('CLAIM_PLAYBACK', snapshot)
        return
      }

      // Case 2: This tab is the active audio owner and state updated
      if (curr.isAudioActive) {
        if (songChanged || queueChanged || playChanged || volumeChanged || modesChanged || seekChanged) {
          const payload = {
            isPlaying: curr.isPlaying,
            isBuffering: curr.isBuffering,
            currentSongIndex: curr.currentSongIndex,
            queue: curr.queue,
            originalQueue: curr.originalQueue,
            currentTime: seekChanged ? curr.seekRequest! : (getActiveAudioTime() || curr.currentTime),
            duration: curr.duration,
            volume: curr.volume,
            isShuffle: curr.isShuffle,
            repeatMode: curr.repeatMode,
            playbackContext: curr.playbackContext,
            timestamp: Date.now(),
            activeInstanceId: tabId
          }

          // Broadcast to same-origin tabs
          broadcastCrossTabMessage({
            type: 'STATE_UPDATE',
            senderId: tabId,
            payload
          })

          // On play/pause or song change, inform cross-origin peers
          if (songChanged || playChanged) {
            sendRealtimeBroadcast('STATE_UPDATE', payload)
          }
        }
      } else {
        // Case 3: Passive tab - user interacted with controls in the passive tab
        if (playChanged && !curr.isPlaying) {
          broadcastCrossTabMessage({
            type: 'COMMAND',
            senderId: tabId,
            command: 'pause'
          })
        } else if (seekChanged && curr.seekRequest !== null) {
          broadcastCrossTabMessage({
            type: 'COMMAND',
            senderId: tabId,
            command: 'seek',
            value: curr.seekRequest
          })
        } else if (volumeChanged) {
          broadcastCrossTabMessage({
            type: 'COMMAND',
            senderId: tabId,
            command: 'volume',
            value: curr.volume
          })
        }
      }
    })

    // Periodic heartbeat from the active tab to keep playback progress in sync across tabs
    heartbeatTimerRef.current = setInterval(() => {
      const state = usePlayerStore.getState()
      if (state.isAudioActive && state.isPlaying) {
        const audioTime = getActiveAudioTime() || state.currentTime
        broadcastCrossTabMessage({
          type: 'STATE_UPDATE',
          senderId: tabId,
          payload: {
            currentTime: audioTime,
            isPlaying: state.isPlaying,
            timestamp: Date.now()
          }
        })
      }
    }, 1500)

    // ─── 3. Local Desktop Loopback Probe (Web Browser Mode) ───────────
    // If running in browser on localhost or HTTP, probe desktop app on 127.0.0.1:4788
    if (!isElectron && typeof window !== 'undefined' && window.location.protocol === 'http:') {
      const probeDesktop = async () => {
        try {
          const res = await fetch('http://127.0.0.1:4788/health', {
            signal: AbortSignal.timeout(1200)
          })
          if (res.ok) {
            const data = await res.json()
            if (data?.isPlaying) {
              const state = usePlayerStore.getState()
              if (state.isAudioActive && state.isPlaying) {
                // Desktop app on same machine is playing audio! Yield web audio.
                const audio = getActiveAudioElement()
                if (audio && !audio.paused) {
                  audio.pause()
                }
                state.setIsAudioActive(false, 'felo-desktop-local')
                state.setIsPlaying(false)
              }
            }
          }
        } catch {
          // Desktop app not running or unreachable
        }
      }

      desktopProbeTimerRef.current = setInterval(probeDesktop, 3000)
    }

    const handleBeforeUnload = () => {
      const state = usePlayerStore.getState()
      if (state.isAudioActive) {
        broadcastCrossTabMessage({
          type: 'RELEASE_PLAYBACK',
          senderId: tabId
        })
        sendRealtimeBroadcast('RELEASE_PLAYBACK')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      if (desktopProbeTimerRef.current) clearInterval(desktopProbeTimerRef.current)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unsubscribeMessages()
      unsubscribeStore()
    }
  }, [tabId, isElectron])

  return null
}
