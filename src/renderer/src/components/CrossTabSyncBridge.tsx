import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import {
  getTabInstanceId,
  broadcastCrossTabMessage,
  subscribeCrossTabSync,
  type CrossTabSyncMessage,
  type PlayerSyncSnapshot
} from '../lib/crossTabSync'
import { getActiveAudioTime, getActiveAudioElement } from '../lib/audioBridge'

export default function CrossTabSyncBridge(): null {
  const isApplyingRemoteRef = useRef(false)
  const heartbeatTimerRef = useRef<any>(null)
  const tabId = getTabInstanceId()

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
          // Mark this tab as passive/synced and apply the snapshot
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
          // 1. Immediately pause local audio element if playing
          const audio = getActiveAudioElement()
          if (audio && !audio.paused) {
            audio.pause()
          }

          // 2. Mark this tab as passive and sync state
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

    // On mount, ask other open tabs on this device if any of them is already playing
    broadcastCrossTabMessage({
      type: 'REQUEST_SYNC_STATE',
      senderId: tabId
    })

    // Listen to local store changes and broadcast to other tabs
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
        broadcastCrossTabMessage({
          type: 'CLAIM_PLAYBACK',
          senderId: tabId,
          payload: {
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
        })
        return
      }

      // Case 2: This tab is the active audio owner and state updated
      if (curr.isAudioActive) {
        if (songChanged || queueChanged || playChanged || volumeChanged || modesChanged || seekChanged) {
          broadcastCrossTabMessage({
            type: 'STATE_UPDATE',
            senderId: tabId,
            payload: {
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
          })
        }
      } else {
        // Case 3: Passive tab - user interacted with controls in the passive tab
        if (playChanged && !curr.isPlaying) {
          // User hit pause in the passive tab
          broadcastCrossTabMessage({
            type: 'COMMAND',
            senderId: tabId,
            command: 'pause'
          })
        } else if (seekChanged && curr.seekRequest !== null) {
          // User scrubbed seek bar in the passive tab
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

    const handleBeforeUnload = () => {
      const state = usePlayerStore.getState()
      if (state.isAudioActive) {
        broadcastCrossTabMessage({
          type: 'RELEASE_PLAYBACK',
          senderId: tabId
        })
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unsubscribeMessages()
      unsubscribeStore()
    }
  }, [tabId])

  return null
}
