import type { ListeningRoom, SharedSong, RoomMemberRole, RoomMember, SpeakerRole } from '../../online/types'
import type { Song } from '../../types/song'
import type { WebRTCAudioStats } from '../../lib/webrtcAudioStream'
import type { SyncPulsePayload } from '../../lib/roomClockSync'

export type SyncStatus = 'idle' | 'synced' | 'missing_song' | 'buffering' | 'host_reconnecting'

export interface RoomSlice {
  hostRoom: ListeningRoom | null
  joinedRoom: ListeningRoom | null
  hostRoomStopped: boolean
  isJoiningRoom: boolean
  memberCount: number
  isLoading: boolean
  error: string | null
  myRole: RoomMemberRole | null
  members: RoomMember[]
  pendingLeaveAndPlay: (() => void) | null
  discordPriorityEnabled: boolean
  liveFriendRooms: Record<string, ListeningRoom>

  setLiveFriendRooms: (rooms: Record<string, ListeningRoom>) => void
  setHostRoom: (room: ListeningRoom | null) => void
  setJoinedRoom: (room: ListeningRoom | null) => void
  setMemberCount: (count: number) => void
  setError: (error: string | null) => void
  setMyRole: (role: RoomMemberRole | null) => void
  setMembers: (members: RoomMember[]) => void
  setPendingLeaveAndPlay: (action: (() => void) | null) => void
  confirmLeaveAndPlay: () => Promise<void>
  cancelLeaveAndPlay: () => void
  promoteMember: (userId: string, role: 'co_host' | 'listener') => Promise<void>
  kickMember: (userId: string) => Promise<void>
  setMySpeakerRole: (role: SpeakerRole, subCutoff?: number) => Promise<void>
  setMemberSpeakerRole: (userId: string, role: SpeakerRole, subCutoff?: number) => Promise<void>
  fetchMembers: (roomId: string) => Promise<void>
  setDiscordPriorityEnabled: (enabled: boolean) => void

  ensureHostRoom: (enabled: boolean, forceNew?: boolean, preferredCode?: string) => Promise<ListeningRoom | null>
  createHostRoom: (preferredCode?: string) => Promise<ListeningRoom | null>
  listenAlongWithFriend: (friendId: string) => Promise<ListeningRoom>
  joinRoomById: (roomId: string) => Promise<ListeningRoom>
  joinRoomByCode: (code: string) => Promise<ListeningRoom>
  leaveJoinedRoom: () => Promise<void>
  deactivateHostRoom: () => Promise<void>
  stopHostRoom: () => Promise<void>
  startHostRoom: () => Promise<ListeningRoom | null>
  refreshMemberCount: (roomId: string) => Promise<void>
  transferHost: (newHostId: string) => Promise<void>
}

export interface RoomPlaybackSlice {
  syncStatus: SyncStatus
  missingSong: SharedSong | null
  lastHostUpdate: number
  autoDownloadMissing: boolean
  substitutes: Record<string, Song>
  manualSyncOffsetMs: number
  isManualSyncModalOpen: boolean
  /** Sync lock: true while a seek is in-flight (prevents echo loop seeks) */
  isSyncLocked: boolean
  /** Buffering guard: true while <audio> is stalling/buffering (prevents seeks during buffering) */
  isGuestBuffering: boolean
  /** Current drift from host in seconds (for CatchUp HUD display) */
  driftSeconds: number
  /** Current audio quality tier ('preview' = 64kbps fast start, 'full' = lossless/high quality) */
  audioQuality: 'preview' | 'full' | null

  setSyncStatus: (status: SyncStatus) => void
  setAutoDownloadMissing: (enabled: boolean) => void
  setSubstituteSong: (hostSong: SharedSong, localSong: Song | null) => void
  setManualSyncOffsetMs: (offsetMs: number) => void
  adjustManualSyncOffsetMs: (deltaMs: number) => void
  setIsManualSyncModalOpen: (isOpen: boolean) => void
  setIsSyncLocked: (locked: boolean) => void
  setIsGuestBuffering: (buffering: boolean) => void
  setAudioQuality: (quality: 'preview' | 'full' | null) => void

  handleHostSongChange: (room: ListeningRoom) => Promise<void>
  handleHostPauseResume: (room: ListeningRoom) => void
  handleHostSyncPulse: (pulse: SyncPulsePayload) => void
  handleHostExplicitSeek: (payload: { position: number; hostTimestamp: number; trackId?: string; isLoop?: boolean }) => void
  handleHostExplicitPlayPause: (payload: { isPlaying: boolean; position?: number; hostTimestamp: number; trackId?: string }) => void
  handleHostDisconnect: () => Promise<void>
  hotSwapToFullQuality: (fullUrl: string) => Promise<void>
  preloadNextQueueTracks: (room: ListeningRoom) => Promise<void>
  refreshJoinedRoomState: () => Promise<void>
  checkHostHealth: () => Promise<void>
  calculateCurrentHostTargetTime: () => number
  performOneTimeSyncWithHost: (options?: { forceSeek?: boolean; logReason?: string }) => void
}

export interface WebRTCSlice {
  isDeviceAudioSharing: boolean
  isReceivingDeviceStream: boolean
  deviceAudioLevel: number
  deviceAudioPeerCount: number
  deviceAudioClientState: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'stopped'
  deviceAudioBitrate: number
  isDeviceAudioMuted: boolean
  isAutoplayBlocked: boolean
  deviceAudioStats: WebRTCAudioStats | null
  deviceAudioVolume: number
  deviceAudioClientLevel: number
  losslessStreamBlobUrl: string | null
  isLosslessMasterActive: boolean
  isAutoStreamingToListeners: boolean

  setIsAutoplayBlocked: (blocked: boolean) => void
  enableSpeakerAudio: () => Promise<boolean>
  setDeviceAudioBitrate: (bitrate: number) => void
  toggleDeviceAudioMute: () => void
  setDeviceAudioVolume: (volume: number) => void
  unmuteDeviceStream: () => Promise<boolean>
  startDeviceAudioSharing: () => Promise<void>
  stopDeviceAudioSharing: () => Promise<void>
  startAutoTrackStreaming: () => Promise<void>
  stopAutoTrackStreaming: () => void
  connectToDeviceStream: (room: ListeningRoom) => Promise<void>
  disconnectFromDeviceStream: () => void
}

export interface AudioBucketSlice {
  jitStatus: Record<
    string,
    {
      percent: number
      statusText: string
      receivedBytes?: number
      totalBytes?: number
    }
  >
  setJitStatus: (
    trackId: string,
    percent: number,
    statusText: string,
    receivedBytes?: number,
    totalBytes?: number
  ) => void
  addLocalFilesToQueue: (files: FileList | File[]) => Promise<void>
  addYouTubeTrackToQueue: (
    videoId: string,
    title?: string,
    channel?: string,
    duration?: number,
    isPriority?: boolean,
    playNow?: boolean
  ) => Promise<void>
  addLibrarySongsToQueue: (songs: Song[]) => Promise<void>
  syncPlayerQueueToRoom: () => Promise<void>
  cleanupOnLeave: () => void
}

export type ListeningStoreState = RoomSlice & RoomPlaybackSlice & WebRTCSlice & AudioBucketSlice

export class RoomNotFoundError extends Error {
  readonly code = 'ROOM_NOT_FOUND' as const
  readonly identifier?: string

  constructor(message = 'The listening session was not found or is no longer active.', identifier?: string) {
    super(message)
    this.name = 'RoomNotFoundError'
    this.identifier = identifier
    Object.setPrototypeOf(this, RoomNotFoundError.prototype)
  }
}

export function isRoomNotFoundError(err: unknown): err is RoomNotFoundError {
  return (
    err instanceof RoomNotFoundError ||
    (typeof err === 'object' && err !== null && (err as any).code === 'ROOM_NOT_FOUND')
  )
}
