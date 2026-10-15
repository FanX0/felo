import { useCallback, useMemo } from 'react'
import type { Song } from '../pages/Library/Library'
import { usePlayerStore, type PlaybackContext } from './usePlayerStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from './useConnectedDeviceStore'
import { useOnlineStore } from './useOnlineStore'
import { resolveSongAudioUrl } from '../lib/songAudioResolver'
import { remoteClient } from '../pages/Remote/remoteClient'
import { getCurrentDeviceId, detectDeviceInfo, isPcDevice } from '../lib/deviceInfo'
import { isLocalSong } from '../lib/songUtils'
import { isElectron } from '../lib/appConfig'
import { resolveEffectivePlaybackState } from '../lib/playbackStateResolver'

export function usePlaybackArbitration() {
  const user = useOnlineStore((s) => s.user)
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const playbackConflict = useConnectedDeviceStore((s) => s.playbackConflict)
  const setPlaybackConflict = useConnectedDeviceStore((s) => s.setPlaybackConflict)
  const resolutionPreference = useConnectedDeviceStore((s) => s.resolutionPreference)
  const setResolutionPreference = useConnectedDeviceStore((s) => s.setResolutionPreference)

  const myDeviceId = getCurrentDeviceId()
  const queue = usePlayerStore((s) => s.queue)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const volume = usePlayerStore((s) => s.volume)
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)

  const lanState = remoteClient.getState()
  const isLanConnected = remoteClient.getIsConnected()

  // Use unified resolver across local, LAN, and Cloud Realtime
  const unified = useMemo(
    () =>
      resolveEffectivePlaybackState({
        localPlayer: {
          queue,
          currentSongIndex,
          isPlaying,
          currentTime,
          duration,
          volume,
          isAudioActive,
          isShuffle,
          repeatMode
        },
        activeRemote,
        lanState,
        isLanConnected,
        myDeviceId
      }),
    [
      queue,
      currentSongIndex,
      isPlaying,
      currentTime,
      duration,
      volume,
      isAudioActive,
      isShuffle,
      repeatMode,
      activeRemote,
      lanState,
      isLanConnected,
      myDeviceId
    ]
  )

  const isExternalDevicePlaying = Boolean(
    unified.isRemote &&
      unified.isPlaying &&
      unified.song &&
      (!myDeviceId || unified.activeDeviceId !== myDeviceId)
  )

  const effectiveRemote = useMemo(() => {
    if (!unified.isRemote || !unified.song) return null
    return {
      activeDeviceId: unified.activeDeviceId,
      activeDeviceName: unified.activeDeviceName,
      activeDeviceType: isPcDevice(unified.activeDeviceCategory)
        ? ('desktop' as const)
        : ('mobile' as const),
      activeDeviceCategory: unified.activeDeviceCategory,
      isPlaying: unified.isPlaying,
      song: unified.song,
      position: unified.position,
      duration: unified.duration,
      timestamp: activeRemote?.timestamp || 0
    }
  }, [
    unified.isRemote,
    unified.song,
    unified.activeDeviceId,
    unified.activeDeviceName,
    unified.activeDeviceCategory,
    unified.isPlaying,
    unified.position,
    unified.duration,
    activeRemote?.timestamp
  ])

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
        useConnectedDeviceStore.getState().setDevicePlaybackMode('remote_controller')
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
        useConnectedDeviceStore.getState().claimPlayback()
        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
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
        useConnectedDeviceStore.getState().claimPlayback()
        useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
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
