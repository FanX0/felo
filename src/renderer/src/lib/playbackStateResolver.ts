import type { Song } from '../pages/Library/Library'
import type { RemotePlayerState, PlaybackTarget } from '../pages/Remote/remoteClient'
import type { RemotePlaybackState } from '../hooks/useConnectedDeviceStore'
import { getInterpolatedPosition } from '../hooks/useConnectedDeviceStore'
import type { ListeningRoom } from '../online/types'
import { roomClockSync } from './roomClockSync'
import {
  getDeviceCategory,
  getDeviceDisplayName,
  getCurrentDeviceId,
  isPcDevice,
  detectDeviceInfo,
  type DeviceCategory
} from './deviceInfo'
import { toMediaUrl } from './media'

export interface UnifiedPlaybackState {
  source: 'local' | 'lan' | 'cloud' | 'room' | 'none'
  isLocal: boolean
  isRemote: boolean
  activeDeviceId: string
  activeDeviceName: string
  activeDeviceCategory: DeviceCategory
  isPlaying: boolean
  position: number
  duration: number
  progressPercent: number
  volume: number
  volumePercent: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  targetDevice: PlaybackTarget
  song: Song | null
  artworkUrl?: string
  lyrics?: {
    plainLyrics?: string
    syncedLyrics?: string
  }
}

export interface ResolvePlaybackParams {
  localPlayer: {
    queue: Song[]
    currentSongIndex: number
    isPlaying: boolean
    currentTime: number
    duration: number
    volume: number
    isAudioActive: boolean
    isShuffle?: boolean
    repeatMode?: 'off' | 'all' | 'one'
  }
  activeRemote: RemotePlaybackState | null
  lanState: RemotePlayerState
  isLanConnected: boolean
  joinedRoom?: ListeningRoom | null
  myDeviceId?: string | null
}

export function resolveEffectivePlaybackState({
  localPlayer,
  activeRemote,
  lanState,
  isLanConnected,
  joinedRoom,
  myDeviceId = getCurrentDeviceId()
}: ResolvePlaybackParams): UnifiedPlaybackState {
  // 0. Priority: Listen Together Room (Joined as participant/listener/co-host)
  if (joinedRoom && joinedRoom.song) {
    const roomSong = joinedRoom.song
    const hostPos =
      typeof roomSong.hostPosition === 'number'
        ? roomSong.hostPosition
        : joinedRoom.position_seconds || 0
    const hostTimestamp =
      typeof roomSong.hostTimestamp === 'number'
        ? roomSong.hostTimestamp
        : joinedRoom.updated_at
        ? new Date(joinedRoom.updated_at).getTime()
        : Date.now()
    const dur = roomSong.duration || 0
    const pos = roomClockSync.calculateTargetTime(
      hostPos,
      hostTimestamp,
      joinedRoom.is_playing,
      0,
      dur
    )
    return {
      source: 'room',
      isLocal: false,
      isRemote: true,
      activeDeviceId: joinedRoom.host_id,
      activeDeviceName: joinedRoom.name || 'Listen Together',
      activeDeviceCategory: 'app_pc',
      isPlaying: joinedRoom.is_playing,
      position: pos,
      duration: dur,
      progressPercent: dur > 0 ? Math.min(100, (pos / dur) * 100) : 0,
      volume: localPlayer.volume ?? 1,
      volumePercent: Math.round((localPlayer.volume ?? 1) * 100),
      shuffle: false,
      repeat: 'off',
      targetDevice: 'desktop',
      song: {
        id: roomSong.localId || (roomSong as any).id || 'room-synced',
        title: roomSong.title || 'Unknown Title',
        artist: roomSong.artist || 'Unknown Artist',
        album: roomSong.album || '',
        duration: dur,
        artworkUrl: roomSong.artworkUrl || '',
        filePath: roomSong.audioUrl,
        lyrics: roomSong.lyrics
      } as Song,
      artworkUrl: roomSong.artworkUrl,
      lyrics: roomSong.lyrics
    }
  }

  const localSong = localPlayer.queue[localPlayer.currentSongIndex] || null
  const isLocalAudioOwner = Boolean(localPlayer.isAudioActive && localPlayer.isPlaying)

  // 1. Priority: Local audio is actively playing on this device
  if (isLocalAudioOwner && localSong) {
    const curTime = localPlayer.currentTime || 0
    const dur = localPlayer.duration || localSong.duration || 0
    const thisInfo = detectDeviceInfo()
    return {
      source: 'local',
      isLocal: true,
      isRemote: false,
      activeDeviceId: myDeviceId || 'local',
      activeDeviceName: getDeviceDisplayName(),
      activeDeviceCategory: thisInfo.category,
      isPlaying: true,
      position: curTime,
      duration: dur,
      progressPercent: dur > 0 ? Math.min(100, (curTime / dur) * 100) : 0,
      volume: localPlayer.volume ?? 1,
      volumePercent: Math.round((localPlayer.volume ?? 1) * 100),
      shuffle: Boolean(localPlayer.isShuffle),
      repeat: localPlayer.repeatMode || 'off',
      targetDevice: isPcDevice(thisInfo.category) ? 'desktop' : 'mobile',
      song: localSong,
      artworkUrl: toMediaUrl(localSong.artworkPath) || localSong.artworkUrl || undefined
    }
  }

  // 2. Priority: LAN Remote Connection (HTTP/SSE) actively connected to desktop
  if (isLanConnected && lanState.song) {
    const dur = lanState.duration || lanState.song.duration || 0
    const pos = lanState.position || 0
    return {
      source: 'lan',
      isLocal: false,
      isRemote: true,
      activeDeviceId: 'lan-desktop',
      activeDeviceName: lanState.deviceName || 'Felo Desktop',
      activeDeviceCategory: 'app_pc',
      isPlaying: lanState.isPlaying,
      position: pos,
      duration: dur,
      progressPercent: dur > 0 ? Math.min(100, (pos / dur) * 100) : 0,
      volume: lanState.volume ?? 1,
      volumePercent: lanState.volumePercent ?? 100,
      shuffle: Boolean(lanState.shuffle),
      repeat: (lanState.repeat as any) || 'off',
      targetDevice: lanState.targetDevice || 'desktop',
      song: lanState.song as Song,
      artworkUrl: lanState.song.artworkUrl
    }
  }

  // 3. Priority: Cloud Remote Playback (Supabase Realtime)
  const isCloudActive = Boolean(
    activeRemote &&
      activeRemote.song &&
      (!myDeviceId || activeRemote.activeDeviceId !== myDeviceId) &&
      (activeRemote.isPlaying || activeRemote.position > 0)
  )

  if (isCloudActive && activeRemote?.song) {
    const interpolatedPos = getInterpolatedPosition(activeRemote)
    const dur = activeRemote.duration || activeRemote.song.duration || 0
    const activeCategory =
      activeRemote.activeDeviceCategory ||
      getDeviceCategory({
        device_type: activeRemote.activeDeviceType,
        device_category: activeRemote.activeDeviceCategory,
        device_name: activeRemote.activeDeviceName
      })

    return {
      source: 'cloud',
      isLocal: false,
      isRemote: true,
      activeDeviceId: activeRemote.activeDeviceId,
      activeDeviceName: activeRemote.activeDeviceName || (isPcDevice(activeCategory) ? 'PC' : 'Mobile'),
      activeDeviceCategory: activeCategory,
      isPlaying: activeRemote.isPlaying,
      position: interpolatedPos,
      duration: dur,
      progressPercent: dur > 0 ? Math.min(100, (interpolatedPos / dur) * 100) : 0,
      volume: localPlayer.volume ?? 1,
      volumePercent: Math.round((localPlayer.volume ?? 1) * 100),
      shuffle: false,
      repeat: 'off',
      targetDevice: isPcDevice(activeCategory) ? 'desktop' : 'mobile',
      song: activeRemote.song,
      artworkUrl: activeRemote.song.artworkUrl || toMediaUrl(activeRemote.song.artworkPath) || undefined,
      lyrics: activeRemote.lyrics
    }
  }

  // 4. Priority: Local song queued/loaded (paused or idle)
  if (localSong) {
    const curTime = localPlayer.currentTime || 0
    const dur = localPlayer.duration || localSong.duration || 0
    const thisInfo = detectDeviceInfo()
    return {
      source: 'local',
      isLocal: true,
      isRemote: false,
      activeDeviceId: myDeviceId || 'local',
      activeDeviceName: getDeviceDisplayName(),
      activeDeviceCategory: thisInfo.category,
      isPlaying: localPlayer.isPlaying,
      position: curTime,
      duration: dur,
      progressPercent: dur > 0 ? Math.min(100, (curTime / dur) * 100) : 0,
      volume: localPlayer.volume ?? 1,
      volumePercent: Math.round((localPlayer.volume ?? 1) * 100),
      shuffle: Boolean(localPlayer.isShuffle),
      repeat: localPlayer.repeatMode || 'off',
      targetDevice: isPcDevice(thisInfo.category) ? 'desktop' : 'mobile',
      song: localSong,
      artworkUrl: toMediaUrl(localSong.artworkPath) || localSong.artworkUrl || undefined
    }
  }

  // 5. Idle / Empty state
  const thisInfo = detectDeviceInfo()
  return {
    source: 'none',
    isLocal: true,
    isRemote: false,
    activeDeviceId: myDeviceId || 'local',
    activeDeviceName: getDeviceDisplayName(),
    activeDeviceCategory: thisInfo.category,
    isPlaying: false,
    position: 0,
    duration: 0,
    progressPercent: 0,
    volume: localPlayer.volume ?? 1,
    volumePercent: Math.round((localPlayer.volume ?? 1) * 100),
    shuffle: false,
    repeat: 'off',
    targetDevice: isPcDevice(thisInfo.category) ? 'desktop' : 'mobile',
    song: null,
    artworkUrl: undefined
  }
}
