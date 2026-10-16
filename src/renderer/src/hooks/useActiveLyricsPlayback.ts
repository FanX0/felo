import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { usePlayerStore } from './usePlayerStore'
import { useConnectedDeviceStore, sendDeviceCommand } from './useConnectedDeviceStore'
import { useOnlineStore } from './useOnlineStore'
import { useListeningStore } from './useListeningStore'
import { remoteClient, type RemotePlayerState } from '../pages/Remote/remoteClient'
import { getActiveAudioTime } from '../lib/audioBridge'
import { toMediaUrl } from '../lib/media'
import { getCurrentDeviceId } from '../lib/deviceInfo'
import { roomClockSync } from '../lib/roomClockSync'
import { getSupabase } from '../lib/supabase'

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

  // 1. Listen Together Room (Priority 1 if participating as a joined user)
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const myRole = useListeningStore((s) => s.myRole)
  const isJoinedRoomActive = Boolean(joinedRoom && joinedRoom.is_active && joinedRoom.song)

  // 2. Local Player Store
  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localSong = localQueue[localIndex] || null
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const localDuration = usePlayerStore((s) => s.duration)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)

  // CRITICAL: A device is ONLY the local audio owner if it is explicitly the active audio instance
  const isLocalAudioOwner = isAudioActive && localIsPlaying

  // 3. Cloud Remote (Supabase Realtime)
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const isCloudRemoteActive = Boolean(
    !isJoinedRoomActive &&
      !isLocalAudioOwner &&
      activeRemote &&
      activeRemote.song &&
      (myDeviceId ? activeRemote.activeDeviceId !== myDeviceId : true)
  )

  // 4. LAN Remote (Electron Local HTTP/SSE)
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

  const isLanRemoteActive = Boolean(
    !isJoinedRoomActive && isLanConnected && remoteState.song && !isLocalAudioOwner
  )

  // Determine active source
  let activeSong: ActiveLyricsSong | null = null
  let isPlaying = false
  let duration = 0
  let isRemote = false
  let activeDeviceId: string | null = null
  let activeDeviceName = 'This Device'

  if (isJoinedRoomActive && joinedRoom?.song) {
    const roomSong = joinedRoom.song
    activeSong = {
      id: roomSong.localId || (roomSong as any).id || (localSong ? localSong.id : 'room-synced'),
      title: roomSong.title || 'Unknown Title',
      artist: roomSong.artist || 'Unknown Artist',
      album: roomSong.album || (localSong ? localSong.album : '') || '',
      duration: roomSong.duration || (localSong ? localSong.duration : 0) || 0,
      artworkUrl:
        roomSong.artworkUrl ||
        (localSong ? toMediaUrl(localSong.artworkPath) || localSong.artworkUrl : '') ||
        '',
      filePath: roomSong.audioUrl || (localSong ? localSong.filePath : undefined),
      lyrics: roomSong.lyrics || (localSong ? (localSong as any).lyrics : undefined)
    }
    isPlaying = joinedRoom.is_playing
    duration = roomSong.duration || (localSong ? localSong.duration : 0) || 0
    isRemote = true
    activeDeviceId = joinedRoom.host_id
    activeDeviceName = joinedRoom.name || 'Listen Together Room'
  } else if (isCloudRemoteActive && activeRemote?.song) {
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
      duration: localDuration || localSong.duration || 0,
      artworkUrl: localSong.artworkUrl || toMediaUrl(localSong.artworkPath) || '',
      filePath: localSong.filePath,
      lyrics: (localSong as any).lyrics
    }
    isPlaying = localIsPlaying
    duration = localDuration || activeSong.duration || 0
    isRemote = false
    activeDeviceId = myDeviceId
    activeDeviceName = 'This Device'
  }

  // Monotonic reference anchor for sub-frame drift-free remote/room clock interpolation
  const anchorRef = useRef<{
    basePosition: number
    receivedAt: number
    isPlaying: boolean
    duration: number
    isRemote: boolean
    isRoom: boolean
  }>({
    basePosition: 0,
    receivedAt: performance.now(),
    isPlaying: false,
    duration: 0,
    isRemote: false,
    isRoom: false
  })

  // Update anchor whenever source state or position updates
  useEffect(() => {
    if (isJoinedRoomActive && joinedRoom?.song) {
      const manualOffsetSec = (useListeningStore.getState().manualSyncOffsetMs || 0) / 1000
      const hostPos =
        typeof joinedRoom.song.hostPosition === 'number'
          ? joinedRoom.song.hostPosition
          : joinedRoom.position_seconds || 0
      const hostTimestamp =
        typeof joinedRoom.song.hostTimestamp === 'number'
          ? joinedRoom.song.hostTimestamp
          : Date.now()
      const roomDuration = joinedRoom.song.duration || duration || 0
      const calculatedTarget = roomClockSync.calculateTargetTime(
        hostPos,
        hostTimestamp,
        joinedRoom.is_playing,
        manualOffsetSec,
        roomDuration
      )

      const audioTime = getActiveAudioTime()
      const effectivePos =
        audioTime > 0 && Math.abs(audioTime - calculatedTarget) < 0.6
          ? audioTime
          : calculatedTarget

      anchorRef.current = {
        basePosition: effectivePos,
        receivedAt: performance.now(),
        isPlaying: joinedRoom.is_playing,
        duration: roomDuration,
        isRemote: true,
        isRoom: true
      }
    } else if (isCloudRemoteActive && activeRemote) {
      anchorRef.current = {
        basePosition: activeRemote.position,
        receivedAt: performance.now(),
        isPlaying: activeRemote.isPlaying,
        duration: activeRemote.duration || duration,
        isRemote: true,
        isRoom: false
      }
    } else if (isLanRemoteActive && remoteState) {
      anchorRef.current = {
        basePosition: remoteState.position,
        receivedAt: performance.now(),
        isPlaying: remoteState.isPlaying,
        duration: remoteState.duration || duration,
        isRemote: true,
        isRoom: false
      }
    } else {
      anchorRef.current = {
        basePosition: localCurrentTime,
        receivedAt: performance.now(),
        isPlaying: localIsPlaying,
        duration: localDuration,
        isRemote: false,
        isRoom: false
      }
    }
  }, [
    isJoinedRoomActive,
    joinedRoom?.song?.title,
    joinedRoom?.song?.artist,
    joinedRoom?.song?.hostPosition,
    joinedRoom?.song?.hostTimestamp,
    joinedRoom?.position_seconds,
    joinedRoom?.is_playing,
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

    if (anchor.isRoom) {
      if (!anchor.isPlaying) {
        return anchor.basePosition
      }
      // If local audio is currently playing in unison, track active audio element smoothly
      const audioTime = getActiveAudioTime()
      if (audioTime > 0 && Math.abs(audioTime - anchor.basePosition) < 0.8) {
        return audioTime
      }
      // Otherwise smoothly extrapolate from monotonic room anchor
      const elapsed = (performance.now() - anchor.receivedAt) / 1000
      const calculated = anchor.basePosition + elapsed
      return Math.max(0, anchor.duration > 0 ? Math.min(anchor.duration, calculated) : calculated)
    }

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

      if (isJoinedRoomActive && joinedRoom?.code) {
        if (myRole === 'co_host' || myRole === 'host') {
          // Co-host or Host can command room-wide seek
          const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
          void getSupabase()
            .from('listening_room_commands')
            .insert({
              room_code: joinedRoom.code,
              command: 'seek',
              sender_name: senderName,
              source: 'web',
              payload: { seconds: safeSeconds }
            })
        } else {
          // Listener: playback is locked to host, avoid desyncing the local audio
          console.log('[useActiveLyricsPlayback] Playback position is locked to session host')
        }
      } else if (isLanRemoteActive) {
        void remoteClient.seek(safeSeconds)
      } else if (isCloudRemoteActive && activeRemote && user?.id) {
        void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'seek', {
          seconds: safeSeconds
        })
      } else {
        usePlayerStore.getState().seek(safeSeconds)
      }
    },
    [isJoinedRoomActive, joinedRoom?.code, myRole, user, isLanRemoteActive, isCloudRemoteActive, activeRemote]
  )

  // Bidirectional Toggle Play Dispatcher
  const togglePlay = useCallback(() => {
    if (isJoinedRoomActive && joinedRoom?.code) {
      if (myRole === 'co_host' || myRole === 'host') {
        const senderName = user?.user_metadata?.full_name || user?.email || 'Co-host'
        void getSupabase()
          .from('listening_room_commands')
          .insert({
            room_code: joinedRoom.code,
            command: joinedRoom.is_playing ? 'pause' : 'resume',
            sender_name: senderName,
            source: 'web',
            payload: {}
          })
      }
    } else if (isLanRemoteActive) {
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
  }, [
    isJoinedRoomActive,
    joinedRoom?.code,
    joinedRoom?.is_playing,
    myRole,
    user,
    isLanRemoteActive,
    isCloudRemoteActive,
    activeRemote
  ])

  const currentAnchoredTime = isJoinedRoomActive && joinedRoom
    ? typeof joinedRoom.song?.hostPosition === 'number'
      ? joinedRoom.song.hostPosition
      : joinedRoom.position_seconds || localCurrentTime
    : isCloudRemoteActive && activeRemote
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
