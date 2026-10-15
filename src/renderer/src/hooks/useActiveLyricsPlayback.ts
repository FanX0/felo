import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { usePlayerStore } from './usePlayerStore'
import { useConnectedDeviceStore, sendDeviceCommand } from './useConnectedDeviceStore'
import { useOnlineStore } from './useOnlineStore'
import { remoteClient, type RemotePlayerState } from '../pages/Remote/remoteClient'
import { getActiveAudioTime } from '../lib/audioBridge'
import { toMediaUrl } from '../lib/media'
import { getCurrentDeviceId } from '../lib/deviceInfo'

export interface ActiveLyricsSong {
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  artworkUrl?: string
  filePath?: string
  lyrics?: {
    plainLyrics?: string
    syncedLyrics?: string
  }
}

export interface ActiveLyricsPlayback {
  song: ActiveLyricsSong | null
  isPlaying: boolean
  currentTime: number
  duration: number
  isRemote: boolean
  activeDeviceId: string | null
  activeDeviceName: string
  getCurrentTime: () => number
  seek: (seconds: number) => void
  togglePlay: () => void
}

export function useActiveLyricsPlayback(): ActiveLyricsPlayback {
  const user = useOnlineStore((s) => s.user)
  const myDeviceId = getCurrentDeviceId()

  // 1. Local Player Store
  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localSong = localQueue[localIndex] || null
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const localDuration = usePlayerStore((s) => s.duration)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)

  // CRITICAL: A device is ONLY the local audio owner if it is explicitly the active audio instance
  const isLocalAudioOwner = isAudioActive && localIsPlaying

  // 2. Cloud Remote (Supabase Realtime)
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const isCloudRemoteActive = Boolean(
    !isLocalAudioOwner &&
      activeRemote &&
      activeRemote.song &&
      (myDeviceId ? activeRemote.activeDeviceId !== myDeviceId : true)
  )

  // 3. LAN Remote (Electron Local HTTP/SSE)
  const [remoteState, setRemoteState] = useState<RemotePlayerState>(() => remoteClient.getState())
  const [isLanConnected, setIsLanConnected] = useState(() => remoteClient.getIsConnected())

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setRemoteState)
    const unsubConn = remoteClient.subscribeConnection(setIsLanConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  const isLanRemoteActive = Boolean(isLanConnected && remoteState.song && !isLocalAudioOwner)

  // Determine active source
  let activeSong: ActiveLyricsSong | null = null
  let isPlaying = false
  let duration = 0
  let isRemote = false
  let activeDeviceId: string | null = null
  let activeDeviceName = 'This Device'

  if (isCloudRemoteActive && activeRemote?.song) {
    activeSong = {
      id: activeRemote.song.id,
      title: activeRemote.song.title || 'Unknown Title',
      artist: activeRemote.song.artist || 'Unknown Artist',
      album: activeRemote.song.album || '',
      duration: activeRemote.song.duration || activeRemote.duration,
      artworkUrl: activeRemote.song.artworkUrl || toMediaUrl(activeRemote.song.artworkPath) || '',
      filePath: activeRemote.song.filePath,
      lyrics: activeRemote.lyrics
    }
    isPlaying = activeRemote.isPlaying
    duration = activeRemote.duration || activeSong.duration || 0
    isRemote = true
    activeDeviceId = activeRemote.activeDeviceId
    activeDeviceName = activeRemote.activeDeviceName || 'Felo Desktop'
  } else if (isLanRemoteActive && remoteState.song) {
    activeSong = {
      id: remoteState.song.id,
      title: remoteState.song.title || 'Unknown Title',
      artist: remoteState.song.artist || 'Unknown Artist',
      album: remoteState.song.album || '',
      duration: remoteState.song.duration || remoteState.duration,
      artworkUrl: remoteState.song.artworkUrl
        ? remoteClient.getFullArtworkUrl(remoteState.song.artworkUrl)
        : '',
      filePath: undefined
    }
    isPlaying = remoteState.isPlaying
    duration = remoteState.duration || activeSong.duration || 0
    isRemote = true
    activeDeviceId = 'lan-desktop'
    activeDeviceName = remoteState.deviceName || 'Felo Desktop'
  } else if (localSong) {
    activeSong = {
      id: localSong.id,
      title: localSong.title || 'Unknown Title',
      artist: localSong.artist || 'Unknown Artist',
      album: localSong.album || '',
      duration: localSong.duration || localDuration,
      artworkUrl: localSong.artworkUrl || toMediaUrl(localSong.artworkPath) || '',
      filePath: localSong.filePath
    }
    isPlaying = localIsPlaying
    duration = localDuration || activeSong.duration || 0
    isRemote = false
    activeDeviceId = myDeviceId
    activeDeviceName = 'This Device'
  }

  // Monotonic reference anchor for sub-frame drift-free remote clock interpolation
  const anchorRef = useRef<{
    basePosition: number
    receivedAt: number
    isPlaying: boolean
    duration: number
    isRemote: boolean
  }>({
    basePosition: 0,
    receivedAt: performance.now(),
    isPlaying: false,
    duration: 0,
    isRemote: false
  })

  // Update anchor whenever remote state updates
  useEffect(() => {
    if (isCloudRemoteActive && activeRemote) {
      anchorRef.current = {
        basePosition: activeRemote.position,
        receivedAt: performance.now(),
        isPlaying: activeRemote.isPlaying,
        duration: activeRemote.duration || duration,
        isRemote: true
      }
    } else if (isLanRemoteActive && remoteState) {
      anchorRef.current = {
        basePosition: remoteState.position,
        receivedAt: performance.now(),
        isPlaying: remoteState.isPlaying,
        duration: remoteState.duration || duration,
        isRemote: true
      }
    } else {
      anchorRef.current = {
        basePosition: localCurrentTime,
        receivedAt: performance.now(),
        isPlaying: localIsPlaying,
        duration: localDuration,
        isRemote: false
      }
    }
  }, [
    isCloudRemoteActive,
    activeRemote?.position,
    activeRemote?.isPlaying,
    activeRemote?.timestamp,
    isLanRemoteActive,
    remoteState.position,
    remoteState.isPlaying,
    localCurrentTime,
    localIsPlaying,
    localDuration,
    duration
  ])

  // Get current instantaneous time with sub-millisecond precision
  const getCurrentTime = useCallback((): number => {
    const anchor = anchorRef.current
    if (!anchor.isRemote) {
      const audioTime = getActiveAudioTime()
      return audioTime > 0 ? audioTime : usePlayerStore.getState().currentTime
    }

    if (!anchor.isPlaying) {
      return anchor.basePosition
    }

    const elapsed = (performance.now() - anchor.receivedAt) / 1000
    const calculated = anchor.basePosition + elapsed
    return Math.max(0, anchor.duration > 0 ? Math.min(anchor.duration, calculated) : calculated)
  }, [])

  // Bidirectional Seek Dispatcher
  const seek = useCallback(
    (seconds: number) => {
      const safeSeconds = Math.max(0, seconds)
      // Immediately adjust local anchor for instant UI responsiveness
      anchorRef.current = {
        ...anchorRef.current,
        basePosition: safeSeconds,
        receivedAt: performance.now()
      }

      if (isLanRemoteActive) {
        void remoteClient.seek(safeSeconds)
      } else if (isCloudRemoteActive && activeRemote && user?.id) {
        void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'seek', {
          seconds: safeSeconds
        })
      } else {
        usePlayerStore.getState().seek(safeSeconds)
      }
    },
    [isLanRemoteActive, isCloudRemoteActive, activeRemote, user?.id]
  )

  // Bidirectional Toggle Play Dispatcher
  const togglePlay = useCallback(() => {
    if (isLanRemoteActive) {
      void remoteClient.togglePlay()
    } else if (isCloudRemoteActive && activeRemote && user?.id) {
      void sendDeviceCommand(
        user.id,
        activeRemote.activeDeviceId,
        activeRemote.isPlaying ? 'pause' : 'play'
      )
    } else {
      usePlayerStore.getState().togglePlay()
    }
  }, [isLanRemoteActive, isCloudRemoteActive, activeRemote, user?.id])

  const currentAnchoredTime = isCloudRemoteActive && activeRemote
    ? activeRemote.position
    : isLanRemoteActive && remoteState
      ? remoteState.position
      : localCurrentTime

  return useMemo(
    () => ({
      song: activeSong,
      isPlaying,
      currentTime: currentAnchoredTime,
      duration,
      isRemote,
      activeDeviceId,
      activeDeviceName,
      getCurrentTime,
      seek,
      togglePlay
    }),
    [
      activeSong?.id,
      activeSong?.title,
      activeSong?.artist,
      isPlaying,
      currentAnchoredTime,
      duration,
      isRemote,
      activeDeviceId,
      activeDeviceName,
      getCurrentTime,
      seek,
      togglePlay
    ]
  )
}
