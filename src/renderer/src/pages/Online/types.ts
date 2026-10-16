import type { ListeningRoom, SpeakerRole } from '../../online/types'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

export interface ListenTogetherPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export interface RoomMemberInfo {
  userId: string
  displayName: string
  avatarUrl: string | null
  isHost: boolean
  role?: 'host' | 'co_host' | 'listener'
  speaker_role?: SpeakerRole
  sub_cutoff?: number
  username?: string
  isOnline?: boolean
}

export interface LiveFriendSession {
  profile: {
    id: string
    username: string
    display_name: string
    avatar_url: string | null
  }
  room: ListeningRoom
}
