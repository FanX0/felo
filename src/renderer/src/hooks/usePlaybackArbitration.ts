import { useCallback } from 'react'
import type { Song } from '../pages/Library/Library'
import { usePlayerStore, type PlaybackContext } from './usePlayerStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from './useConnectedDeviceStore'
import { useOnlineStore } from './useOnlineStore'
import { resolveSongAudioUrl } from '../lib/songAudioResolver'
import { remoteClient } from '../pages/Remote/remoteClient'
import { getCurrentDeviceId, detectDeviceInfo } from '../lib/deviceInfo'
import { isLocalSong } from '../lib/songUtils'
import { isElectron } from '../lib/appConfig'

export function usePlaybackArbitration() {
  const user = useOnlineStore((s) => s.user)
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const playbackConflict = useConnectedDeviceStore((s) => s.playbackConflict)
  const setPlaybackConflict = useConnectedDeviceStore((s) => s.setPlaybackConflict)
  const resolutionPreference = useConnectedDeviceStore((s) => s.resolutionPreference)
  const setResolutionPreference = useConnectedDeviceStore((s) => s.setResolutionPreference)

  const myDeviceId = getCurrentDeviceId()
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const localIsAudioActive = usePlayerStore((s) => s.isAudioActive)

  // Local device is only genuinely playing audio if local audio engine is active and playing
  const isLocalAudioOwner = Boolean(localIsPlaying && localIsAudioActive)

  // Determine effective remote device: Cloud Realtime activeRemote or local LAN remoteClient
  const lanState = remoteClient.getState()
  const isLanConnected = remoteClient.getIsConnected()
  const effectiveRemote =
    activeRemote ||
    (isLanConnected && lanState.song
      ? {
          activeDeviceId: 'desktop',
          activeDeviceName: lanState.deviceName || 'Felo Desktop',
          activeDeviceType: 'desktop' as const,
          isPlaying: lanState.isPlaying,
          song: lanState.song as any,
          position: lanState.position,
          duration: lanState.duration,
          timestamp: Date.now()
        }
      : null)

  // An external device is actively playing music if:
  // 1. effectiveRemote exists, is playing, has a song, and activeDeviceId is not our own
  // 2. We are not currently the active local audio producer
  const isExternalDevicePlaying = Boolean(
    !isLocalAudioOwner &&
      effectiveRemote &&
      effectiveRemote.isPlaying &&
      effectiveRemote.song &&
      (myDeviceId ? effectiveRemote.activeDeviceId !== myDeviceId : true)
  )

  const startLocalPlayback = useCallback(
    (queue: Song[], index = 0, context?: PlaybackContext | null, seekTo?: number) => {
      const player = usePlayerStore.getState()
      // Resolve audio URLs for any virtual / remote songs when playing locally on web/mobile
      const preparedQueue = queue.map((s) => {
        const streamUrl = resolveSongAudioUrl(s)
        if (streamUrl && streamUrl !== s.filePath) {
          return { ...s, filePath: streamUrl }
        }
        return s
      })
      player.setQueue(preparedQueue, index, context)
      if (typeof seekTo === 'number' && seekTo > 0) {
        setTimeout(() => {
          usePlayerStore.getState().seek(seekTo)
        }, 80)
      }
    },
    []
  )

  const requestPlayQueue = useCallback(
    (queue: Song[], index = 0, context?: PlaybackContext | null) => {
      if (!queue.length) return
      const targetSong = queue[index] || queue[0]
      const isTargetLocal = isLocalSong(targetSong, context)
      const thisDeviceType =
        isElectron || detectDeviceInfo().type === 'desktop' ? 'desktop' : 'mobile'

      // Industry Standard UX (Spotify Connect / Apple Music style):
      // When a user clicks a local song, turn playback to THIS DEVICE by default.
      // Local tracks reside on this machine/device and cannot play on remote devices.
      if (isTargetLocal) {
        if (isExternalDevicePlaying && effectiveRemote) {
          // Pause the active external playback device
          void sendDeviceCommand(user?.id || '', effectiveRemote.activeDeviceId, 'pause')

          // Dispatch sleek notification toast
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('felo:device-toast', {
                detail: {
                  title: 'Switched to This Device',
                  message: `Playing local track • Paused ${effectiveRemote.activeDeviceName || 'Remote Device'}`
                }
              })
            )
          }
        }

        // Synchronize playback target to this device
        useConnectedDeviceStore.getState().setPlaybackTarget(thisDeviceType)
        void remoteClient.setTargetDevice(thisDeviceType)

        // Clear remote playback state to eliminate UI lag/flicker in player controls
        if (effectiveRemote) {
          useConnectedDeviceStore.getState().clearRemotePlayback()
        }

        // Immediately start local playback on this device
        startLocalPlayback(queue, index, context)
        return
      }

      // If the song is NOT local (e.g. streaming or remote library), apply standard arbitration
      if (isExternalDevicePlaying && effectiveRemote) {
        if (resolutionPreference === 'remote') {
          void sendDeviceCommand(user?.id || '', effectiveRemote.activeDeviceId, 'play', {
            songId: targetSong.id,
            song: targetSong
          })
          return
        }

        if (resolutionPreference === 'transfer') {
          void sendDeviceCommand(user?.id || '', effectiveRemote.activeDeviceId, 'pause')
          useConnectedDeviceStore.getState().setPlaybackTarget(thisDeviceType)
          void remoteClient.setTargetDevice(thisDeviceType)
          useConnectedDeviceStore.getState().clearRemotePlayback()
          startLocalPlayback(queue, index, context)
          return
        }

        // First-in Priority: The active playing device has authority.
        // Secondary devices must always prompt the user to choose:
        // Remote control master device OR transfer playback to this device.
        setPlaybackConflict({
          pendingSong: targetSong,
          pendingQueue: queue,
          pendingIndex: index,
          pendingContext: context,
          activeDeviceId: effectiveRemote.activeDeviceId,
          activeDeviceName: effectiveRemote.activeDeviceName || 'Active Device',
          activeDeviceCategory: (effectiveRemote as any).activeDeviceCategory,
          activeSong: effectiveRemote.song,
          activePosition: effectiveRemote.position
        })
        return
      }

      // No conflict: play locally
      startLocalPlayback(queue, index, context)
    },
    [
      isExternalDevicePlaying,
      effectiveRemote,
      resolutionPreference,
      setPlaybackConflict,
      startLocalPlayback,
      user?.id
    ]
  )

  const requestPlaySong = useCallback(
    (song: Song, context?: PlaybackContext | null) => {
      requestPlayQueue([song], 0, context)
    },
    [requestPlayQueue]
  )

  const resolveConflict = useCallback(
    (
      action: 'remote' | 'transfer' | 'resume_remote_here' | 'cancel',
      rememberSession = false
    ) => {
      if (!playbackConflict) return

      const thisDeviceType =
        isElectron || detectDeviceInfo().type === 'desktop' ? 'desktop' : 'mobile'

      if (rememberSession && (action === 'remote' || action === 'transfer')) {
        setResolutionPreference(action, true)
      }

      if (action === 'remote') {
        if (playbackConflict.pendingSong) {
          void sendDeviceCommand(
            user?.id || '',
            playbackConflict.activeDeviceId,
            'play',
            {
              songId: playbackConflict.pendingSong.id,
              song: playbackConflict.pendingSong
            }
          )
        }
      } else if (action === 'transfer') {
        void sendDeviceCommand(
          user?.id || '',
          playbackConflict.activeDeviceId,
          'pause'
        )
        useConnectedDeviceStore.getState().setPlaybackTarget(thisDeviceType)
        void remoteClient.setTargetDevice(thisDeviceType)
        useConnectedDeviceStore.getState().clearRemotePlayback()

        if (playbackConflict.pendingQueue && playbackConflict.pendingQueue.length > 0) {
          startLocalPlayback(
            playbackConflict.pendingQueue,
            playbackConflict.pendingIndex || 0,
            playbackConflict.pendingContext
          )
        } else if (playbackConflict.pendingSong) {
          startLocalPlayback(
            [playbackConflict.pendingSong],
            0,
            playbackConflict.pendingContext
          )
        }
      } else if (action === 'resume_remote_here') {
        // Transfer the currently playing song from the remote PC to this device at the exact current position
        void sendDeviceCommand(
          user?.id || '',
          playbackConflict.activeDeviceId,
          'pause'
        )
        useConnectedDeviceStore.getState().setPlaybackTarget(thisDeviceType)
        void remoteClient.setTargetDevice(thisDeviceType)
        useConnectedDeviceStore.getState().clearRemotePlayback()

        if (playbackConflict.activeSong) {
          startLocalPlayback(
            [playbackConflict.activeSong],
            0,
            { type: 'library', title: 'Transferred Playback' },
            playbackConflict.activePosition
          )
        }
      }

      setPlaybackConflict(null)
    },
    [playbackConflict, setResolutionPreference, setPlaybackConflict, user?.id, startLocalPlayback]
  )

  return {
    isExternalDevicePlaying,
    activeRemoteDevice: effectiveRemote,
    playbackConflict,
    resolutionPreference,
    requestPlaySong,
    requestPlayQueue,
    resolveConflict,
    setResolutionPreference
  }
}
