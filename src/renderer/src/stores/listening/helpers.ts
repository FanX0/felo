import type { Song } from '../../types/song'
import type { SharedSong } from '../../online/types'
import { WebRTCAudioHost, WebRTCAudioClient } from '../../lib/webrtcAudioStream'
import { scoreProviderMatch, findMatchingLibrarySong } from '../../lib/songMatching'
import { toMediaUrl } from '../../lib/media'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import { getCurrentDeviceId } from '../../lib/deviceInfo'
import {
  getSongPublicBucketUrl,
  isSongUploadedToBucket
} from '../../lib/audioBucketService'
import { useDspStore, registerDspSyncBroadcaster } from '../useDspStore'
import { usePlayerStore } from '../player/usePlayerStore'
import {
  getLocalSlotPoolFile,
  getLocalSlotPoolPath,
  registerLocalSlotPoolPath
} from '../../lib/jitAudioPipeline'
import { isYouTubeSong, extractYouTubeVideoId } from '../../components/Audio/YouTubePlayerBridge'
import type { SyncPulsePayload } from '../../lib/roomClockSync'

// Singletons & Module State
export let _activeAudioHost: WebRTCAudioHost | null = null
export function setActiveAudioHost(host: WebRTCAudioHost | null): void {
  _activeAudioHost = host
}

export let _activeAudioClient: WebRTCAudioClient | null = null
export function setActiveAudioClient(client: WebRTCAudioClient | null): void {
  _activeAudioClient = client
}

export let _audioClientWatchdog: any = null
export function setAudioClientWatchdog(watchdog: any): void {
  _audioClientWatchdog = watchdog
}

export let _preDeviceAudioState: {
  isPlaying: boolean
  currentSongIndex: number
  currentTime: number
} | null = null
export function setPreDeviceAudioState(state: { isPlaying: boolean; currentSongIndex: number; currentTime: number } | null): void {
  _preDeviceAudioState = state
}

export interface PreJoinPlayerSnapshot {
  queue: Song[]
  currentSongIndex: number
  currentTime: number
  volume: number
  isPlaying: boolean
}

export let _preJoinPlayerSnapshot: PreJoinPlayerSnapshot | null = null

export function savePreJoinPlayerSnapshot(snapshot: PreJoinPlayerSnapshot | null): void {
  _preJoinPlayerSnapshot = snapshot
}

export function getPreJoinPlayerSnapshot(): PreJoinPlayerSnapshot | null {
  return _preJoinPlayerSnapshot
}

export function broadcastHostLosslessTrack(song?: Song | null): void {
  if (!_activeAudioHost || !song) return
  const localFile = song.id ? getLocalSlotPoolFile(song.id) : null
  const localPath = song.id ? getLocalSlotPoolPath(song.id) : null
  const source =
    localFile ||
    localPath ||
    resolveSongAudioUrl(song) ||
    toMediaUrl(song.filePath) ||
    song.filePath
  if (!source) return
  const fileName = localFile && 'name' in localFile ? (localFile as File).name : ''
  const ext = (song.filePath || fileName || song.title || '').toLowerCase()
  const mimeType = ext.endsWith('.flac')
    ? 'audio/flac'
    : ext.endsWith('.wav')
    ? 'audio/wav'
    : ext.endsWith('.ogg')
    ? 'audio/ogg'
    : 'audio/mpeg'
  void _activeAudioHost.broadcastLosslessTrack(source, mimeType, song.id)
}

export let _nudgeReplayTimer: any = null
export function setNudgeReplayTimer(timer: any): void {
  _nudgeReplayTimer = timer
}

export let _lastHostPulse: SyncPulsePayload | null = null
export function setLastHostPulse(pulse: SyncPulsePayload | null): void {
  _lastHostPulse = pulse
}

export let _roomDspSyncSender: ((snapshot: any, volume?: number) => void) | null = null
export function registerRoomDspSyncSender(fn: (snapshot: any, volume?: number) => void): void {
  _roomDspSyncSender = fn
}

export let _roomClosureSender: (() => void) | null = null
export function registerRoomClosureSender(fn: () => void): void {
  _roomClosureSender = fn
}

let _listeningStoreStateGetter: (() => any) | null = null
export function registerListeningStoreStateGetter(fn: () => any): void {
  _listeningStoreStateGetter = fn
}

export function broadcastHostDspSettings(): void {
  const state = _listeningStoreStateGetter ? _listeningStoreStateGetter() : null
  if (!state) return
  const isHost = state.myRole === 'host' || Boolean(state.hostRoom && !state.joinedRoom)
  if (!isHost) return

  const snapshot = useDspStore.getState().getRoomDspSnapshot()
  const vol = usePlayerStore.getState().volume
  if (_activeAudioHost) {
    _activeAudioHost.broadcastDspSettings(snapshot)
  }
  _roomDspSyncSender?.(snapshot, vol)
}

registerDspSyncBroadcaster(broadcastHostDspSettings)

export function makeCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export let _cachedRemoteControlInfo: { ip?: string; port?: number; token?: string } | null = null

export function updateCachedRemoteControlInfo(info: { ip?: string; port?: number; token?: string } | null): void {
  if (info) _cachedRemoteControlInfo = info
}

export const AUTO_DOWNLOAD_STORAGE_KEY = 'felo:listen_together:auto_download_v2'
export const SUBSTITUTES_STORAGE_KEY = 'fanxmusic:listen_together:substitutes'
export const DISCORD_PRIORITY_STORAGE_KEY = 'felo:discord-priority-enabled'
export const MANUAL_SYNC_OFFSET_STORAGE_KEY = 'felo:listen_together:manual_sync_offset_ms'

let _sessionSyncDepth = 0
export let _isSessionSyncing = false
export function setIsSessionSyncing(val: boolean): void {
  if (val) {
    _sessionSyncDepth = Math.max(1, _sessionSyncDepth + 1)
    _isSessionSyncing = true
  } else {
    _sessionSyncDepth = Math.max(0, _sessionSyncDepth - 1)
    _isSessionSyncing = _sessionSyncDepth > 0
  }
}
export function resetSessionSync(): void {
  _sessionSyncDepth = 0
  _isSessionSyncing = false
}
export function isSessionSyncing(): boolean {
  return _sessionSyncDepth > 0 || _isSessionSyncing
}

export let _needsInitialSync = true
export function setNeedsInitialSync(val: boolean): void {
  _needsInitialSync = val
}
export function needsInitialSync(): boolean {
  return _needsInitialSync
}

export let _currentSyncEpoch = 0
export function setCurrentSyncEpoch(epoch: number): void {
  _currentSyncEpoch = epoch
}
export function getCurrentSyncEpoch(): number {
  return _currentSyncEpoch
}
export function incrementSyncEpoch(): number {
  return ++_currentSyncEpoch
}

export function readInitialManualSyncOffset(): number {
  try {
    const raw = localStorage.getItem(MANUAL_SYNC_OFFSET_STORAGE_KEY)
    if (raw === null) return 0
    const parsed = parseInt(raw, 10)
    return isNaN(parsed) ? 0 : parsed
  } catch {
    return 0
  }
}

export function readInitialDiscordPriority(): boolean {
  try {
    const raw = localStorage.getItem(DISCORD_PRIORITY_STORAGE_KEY)
    if (raw === null) return true // Default enabled
    return raw === 'true'
  } catch {
    return true
  }
}

export function readInitialAutoDownload(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY)
    if (raw === null) return false // Default disabled: stream in-RAM / WebRTC like public app
    return raw === 'true'
  } catch {
    return false
  }
}

export function readInitialSubstitutes(): Record<string, Song> {
  try {
    const raw = localStorage.getItem(SUBSTITUTES_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function toSharedSong(
  song: Song,
  remoteControlInfo?: { ip?: string; port?: number; token?: string } | null
): SharedSong {
  if (remoteControlInfo) {
    _cachedRemoteControlInfo = remoteControlInfo
  }
  const effectiveRemote = remoteControlInfo || _cachedRemoteControlInfo

  const state = _listeningStoreStateGetter ? _listeningStoreStateGetter() : null
  const isPriorityOn = state ? state.discordPriorityEnabled : readInitialDiscordPriority()

  if (isYouTubeSong(song)) {
    const videoId =
      extractYouTubeVideoId(song.audioUrl) ||
      extractYouTubeVideoId(song.filePath) ||
      extractYouTubeVideoId(song.id?.replace(/^yt-/, '')) ||
      ''
    const artworkUrl =
      song.artworkUrl ||
      song.artworkPath ||
      (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined)
    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`

    return {
      localId: song.id,
      title: song.title || 'YouTube Track',
      artist: song.artist || 'YouTube',
      album: song.album || 'YouTube Stream',
      duration: song.duration || 0,
      artworkUrl,
      audioUrl: ytUrl,
      requestedBy: song.requestedBy,
      isPriority: song.isPriority,
      discordPriorityEnabled: isPriorityOn,
      isTrackStream: false,
      isYouTube: true,
      videoId: videoId || undefined,
      streamType: 'youtube',
      deviceId: getCurrentDeviceId(),
      uploadStatus: 'UPLOADED',
      uploadProgress: 100,
      statusText: 'YouTube Sync Stream'
    }
  }

  if (song.id && song.filePath) {
    registerLocalSlotPoolPath(song.id, song.filePath)
  }

  const localFile = song.id ? getLocalSlotPoolFile(song.id) : null
  const sizeBytes = song.size || (localFile ? localFile.size : undefined)
  const duration = song.duration || 0
  const bitrate =
    song.bitrate ||
    (sizeBytes && duration > 0 ? Math.round((sizeBytes * 8) / (duration * 1000)) : undefined)

  const fileName = localFile && 'name' in localFile ? (localFile as File).name : ''
  const ext = (song.filePath || fileName || song.title || '').toLowerCase()
  const isLossy =
    ext.endsWith('.mp3') ||
    ext.endsWith('.aac') ||
    ext.endsWith('.m4a') ||
    ext.endsWith('.ogg') ||
    ext.endsWith('.opus')
  const isAlreadyCompressed = isLossy || (bitrate !== undefined && bitrate <= 320)
  const needsCompression = !isAlreadyCompressed && (sizeBytes ? sizeBytes > 5 * 1024 * 1024 : false)

  let lanUrl: string | undefined = undefined
  if (effectiveRemote?.ip && song.id) {
    let cleanIp = effectiveRemote.ip.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
    const port = effectiveRemote.port || 4788
    if (!cleanIp.includes(':')) {
      cleanIp = `${cleanIp}:${port}`
    }
    lanUrl = `http://${cleanIp}/v1/audio/${encodeURIComponent(song.id)}${effectiveRemote.token ? `?token=${encodeURIComponent(effectiveRemote.token)}` : ''}`
  }

  const cloudAudioUrl = song.id ? getSongPublicBucketUrl(song.id) : undefined
  const isUploadedToBucket = song.id ? isSongUploadedToBucket(song.id) : false
  const existingUploadStatus = (song as any).uploadStatus as SharedSong['uploadStatus']
  const isSupabaseBucket = Boolean(song.audioUrl && (song.audioUrl.includes('songs') || song.audioUrl.includes('supabase.co')))
  const isCloudReady = isUploadedToBucket || existingUploadStatus === 'UPLOADED' || isSupabaseBucket
  const directAudioUrl =
    (isCloudReady && cloudAudioUrl ? cloudAudioUrl : undefined) ||
    (song.audioUrl && /^https?:\/\//i.test(song.audioUrl) && !/127\.0\.0\.1|localhost/i.test(song.audioUrl)
      ? song.audioUrl
      : undefined) ||
    (song.filePath && /^https?:\/\//i.test(song.filePath) && !/127\.0\.0\.1|localhost/i.test(song.filePath)
      ? song.filePath
      : undefined) ||
    (isCloudReady ? cloudAudioUrl : undefined)

  let artworkUrl = song.artworkUrl || (/^https?:\/\//i.test(song.artworkPath || '') ? song.artworkPath : undefined)
  if (!artworkUrl && effectiveRemote?.ip && song.id) {
    let cleanIp = effectiveRemote.ip.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
    const port = effectiveRemote.port || 4788
    if (!cleanIp.includes(':')) {
      cleanIp = `${cleanIp}:${port}`
    }
    artworkUrl = `http://${cleanIp}/v1/artwork/${encodeURIComponent(song.id)}${effectiveRemote.token ? `?token=${encodeURIComponent(effectiveRemote.token)}` : ''}`
  }

  const isYt = isYouTubeSong(song)
  const ytVideoId = isYt
    ? extractYouTubeVideoId(song.id?.replace(/^yt-/, '')) ||
      extractYouTubeVideoId(song.audioUrl) ||
      extractYouTubeVideoId(song.filePath)
    : undefined

  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    artworkUrl,
    audioUrl: directAudioUrl,
    requestedBy: song.requestedBy,
    isPriority: song.isPriority,
    discordPriorityEnabled: isPriorityOn,
    isTrackStream: false,
    streamType: isYt ? 'youtube' : 'track_stream',
    isYouTube: isYt,
    videoId: ytVideoId || undefined,
    lanUrl,
    deviceId: getCurrentDeviceId(),
    sizeBytes,
    uploadStatus: isCloudReady ? 'UPLOADED' : existingUploadStatus || 'METADATA_ONLY',
    uploadProgress: isCloudReady ? 100 : (song as any).uploadProgress || 0,
    statusText: isCloudReady ? 'Ready (Cloud CDN)' : (song as any).statusText || 'Listed (Ready)',
    isAlreadyCompressed,
    needsCompression,
    estimatedBitrateKbps: bitrate
  }
}

export function fromSharedSong(song: SharedSong): Song {
  const isYt = Boolean(song.isYouTube || song.streamType === 'youtube' || song.videoId || isYouTubeSong(song))
  const videoId = song.videoId || extractYouTubeVideoId(song.audioUrl) || extractYouTubeVideoId(song.localId)
  if (isYt && videoId) {
    return {
      id: `yt-${videoId}`,
      title: song.title || 'YouTube Track',
      artist: song.artist || 'YouTube',
      album: song.album || 'YouTube Stream',
      duration: song.duration || 0,
      artworkPath: song.artworkUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      artworkUrl: song.artworkUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      filePath: `https://www.youtube.com/watch?v=${videoId}`,
      audioUrl: `https://www.youtube.com/watch?v=${videoId}`,
      isYouTube: true,
      streamType: 'youtube',
      isOnline: true
    } as any
  }

  const streamUrl = song.audioUrl || song.lanUrl || ''
  return {
    id: song.localId || 'shared',
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    duration: song.duration || 0,
    artworkUrl: song.artworkUrl,
    artworkPath: song.artworkUrl,
    requestedBy: song.requestedBy,
    isPriority: song.isPriority,
    audioUrl: streamUrl,
    filePath: streamUrl,
    isOnline: Boolean(streamUrl)
  }
}

export let _ensureLock = false
export function setEnsureLock(lock: boolean): void {
  _ensureLock = lock
}

export const _autoDownloadRequests = new Set<string>()

export function normalizeSongValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunknown\s+artist\b/gi, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official|audio|remastered|deluxe|version|explicit|clean|radio edit)\)\s*$/gi, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|audio|remastered)\s*$/gi,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findSongMatchIndex(songs: Song[], targetTitle: string, targetArtist: string): number {
  if (!songs || songs.length === 0 || !targetTitle) return -1
  const matched = findMatchingLibrarySong(targetTitle, targetArtist, songs)
  return matched ? songs.indexOf(matched) : -1
}

export function findBestDownloadMatch(
  results: any[],
  targetTitle: string,
  targetArtist: string,
  targetDuration?: number
): any | null {
  if (!Array.isArray(results) || results.length === 0) return null

  let bestHit: any = null
  let highestScore = -1

  for (const item of results) {
    const match = scoreProviderMatch(
      { title: targetTitle, artist: targetArtist, duration: targetDuration },
      {
        title: item.title || '',
        artist: item.artist || '',
        meta: item.meta || item.album || '',
        description: item.description || '',
        duration: item.duration
      }
    )

    if (match.isAcceptable && match.score > highestScore) {
      highestScore = match.score
      bestHit = item
    }
  }

  return bestHit
}

export function getSongKey(song?: SharedSong | null): string {
  if (!song) return ''
  return `${normalizeSongValue(song.artist)} - ${normalizeSongValue(song.title)}`
}

export let _lastSyncedSongId: string | null = null
export function setLastSyncedSongId(id: string | null): void {
  _lastSyncedSongId = id
}
