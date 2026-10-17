import { FormEvent, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Radio } from 'lucide-react'
import QRCode from 'qrcode'
import { useSearchParams } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { useRoomChatStore } from '../../hooks/useRoomChatStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useDspStore } from '../../hooks/useDspStore'
import RoomMemberProfileModal from '../../components/Online/RoomMemberProfileModal'
import { getSupabase } from '../../lib/supabase'
import { roomClockSync } from '../../lib/roomClockSync'
import SelectMediaModal from '../../components/Online/SelectMediaModal'
import AddFromLibraryModal from '../../components/Online/AddFromLibraryModal'
import { registerLocalSlotPoolFile, registerLocalSlotPoolPath } from '../../lib/jitAudioPipeline'
import { toMediaUrl } from '../../lib/media'
import type { ListeningRoom, SpeakerRole } from '../../online/types'
import type { Song } from '../../types'
import type { ListenTogetherPageProps, RoomMemberInfo, LiveFriendSession } from './types'
import { getSongKey, sanitizeCodeInput } from './utils'
import {
  GuestRoomView,
  HostSessionSection,
  LobbyBentoGrid,
  FriendSessionsSection,
  JoinCodeModal,
  InviteFriendsModal
} from './components'

function ListenTogetherWorkspace({ onOpenDownloadPanel }: ListenTogetherPageProps): ReactElement {
  const { user, profile } = useOnlineStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const transfers = useDownloadStore((state) => state.transfers)
  const {
    isPlaying,
    currentTime,
    queue,
    currentSongIndex,
    playNext,
    playSong: playTrackByIndex,
    removeSongFromQueueByIndex,
    bumpSongToPriority
  } = usePlayerStore()

  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const memberCount = useListeningStore((state) => state.memberCount)
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const missingSong = useListeningStore((state) => state.missingSong)
  const autoDownloadMissing = useListeningStore((state) => state.autoDownloadMissing)
  const substitutes = useListeningStore((state) => state.substitutes)
  const jitStatus = useListeningStore((state) => state.jitStatus)

  const setAutoDownloadMissing = useListeningStore((state) => state.setAutoDownloadMissing)
  const setSubstituteSong = useListeningStore((state) => state.setSubstituteSong)
  const listenAlongWithFriend = useListeningStore((state) => state.listenAlongWithFriend)
  const joinRoomById = useListeningStore((state) => state.joinRoomById)
  const joinRoomByCode = useListeningStore((state) => state.joinRoomByCode)
  const leaveJoinedRoom = useListeningStore((state) => state.leaveJoinedRoom)
  const deactivateHostRoom = useListeningStore((state) => state.deactivateHostRoom)
  const handleHostSongChange = useListeningStore((state) => state.handleHostSongChange)
  const handleHostPauseResume = useListeningStore((state) => state.handleHostPauseResume)
  const handleHostDisconnect = useListeningStore((state) => state.handleHostDisconnect)
  const refreshMemberCount = useListeningStore((state) => state.refreshMemberCount)
  const isDeviceAudioSharing = useListeningStore((state) => state.isDeviceAudioSharing)
  const isReceivingDeviceStream = useListeningStore((state) => state.isReceivingDeviceStream)
  const deviceAudioLevel = useListeningStore((state) => state.deviceAudioLevel)
  const deviceAudioPeerCount = useListeningStore((state) => state.deviceAudioPeerCount)
  const deviceAudioClientState = useListeningStore((state) => state.deviceAudioClientState)
  const startDeviceAudioSharing = useListeningStore((state) => state.startDeviceAudioSharing)
  const stopDeviceAudioSharing = useListeningStore((state) => state.stopDeviceAudioSharing)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const deviceAudioBitrate = useListeningStore((state) => state.deviceAudioBitrate)
  const isDeviceAudioMuted = useListeningStore((state) => state.isDeviceAudioMuted)
  const isAutoplayBlocked = useListeningStore((state) => state.isAutoplayBlocked)
  const deviceAudioStats = useListeningStore((state) => state.deviceAudioStats)
  const deviceAudioVolume = useListeningStore((state) => state.deviceAudioVolume)
  const deviceAudioClientLevel = useListeningStore((state) => state.deviceAudioClientLevel)
  const isLosslessMasterActive = useListeningStore((state) => state.isLosslessMasterActive)
  const connectToDeviceStream = useListeningStore((state) => state.connectToDeviceStream)
  const disconnectFromDeviceStream = useListeningStore((state) => state.disconnectFromDeviceStream)
  const setDeviceAudioBitrate = useListeningStore((state) => state.setDeviceAudioBitrate)
  const toggleDeviceAudioMute = useListeningStore((state) => state.toggleDeviceAudioMute)
  const setDeviceAudioVolume = useListeningStore((state) => state.setDeviceAudioVolume)
  const unmuteDeviceStream = useListeningStore((state) => state.unmuteDeviceStream)
  const discordPriorityEnabled = useListeningStore((state) => state.discordPriorityEnabled)
  const setDiscordPriorityEnabled = useListeningStore((state) => state.setDiscordPriorityEnabled)
  const promoteMember = useListeningStore((state) => state.promoteMember)
  const kickMember = useListeningStore((state) => state.kickMember)
  const manualSyncOffsetMs = useListeningStore((state) => state.manualSyncOffsetMs)
  const setIsManualSyncModalOpen = useListeningStore((state) => state.setIsManualSyncModalOpen)

  const loadMessages = useRoomChatStore((state) => state.loadMessages)
  const addIncoming = useRoomChatStore((state) => state.addIncoming)
  const clearMessages = useRoomChatStore((state) => state.clearMessages)

  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showHostChat, setShowHostChat] = useState(false)
  const [showSelectMediaModal, setShowSelectMediaModal] = useState(false)
  const [showAddLibraryModal, setShowAddLibraryModal] = useState(false)

  const handleSelectLocalFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return
    setBusy(true)
    try {
      const newSongs: Song[] = []
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i]
        const cleanName = file.name.replace(/\.[^/.]+$/, '')
        const songId = `local-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`
        registerLocalSlotPoolFile(songId, file)
        const objectUrl = URL.createObjectURL(file)
        const newSong: Song = {
          id: songId,
          title: cleanName,
          artist: user?.user_metadata?.display_name || user?.email || 'Local File',
          album: 'Local Upload',
          duration: 0,
          filePath: objectUrl,
          audioUrl: objectUrl,
          isOnline: false,
          size: file.size
        }
        newSongs.push(newSong)
      }

      if (newSongs.length > 0) {
        const updatedQueue = [...queue, ...newSongs]
        const targetIdx = queue.length === 0 ? 0 : queue.length
        usePlayerStore.getState().setQueue(updatedQueue, targetIdx)
        usePlayerStore.getState().setIsPlaying(true)
        await ensureHostRoom(true, true)
        setMessage(`Added ${newSongs.length} local file(s) to room!`)
        setTimeout(() => setMessage(''), 3000)
      }
    } catch (err: any) {
      console.error('[handleSelectLocalFiles] Failed:', err)
      setMessage('Failed to load local audio files.')
    } finally {
      setBusy(false)
    }
  }

  const handleSelectLibrarySongs = async (librarySongs: Song[]) => {
    if (!librarySongs || librarySongs.length === 0) return
    setBusy(true)
    try {
      const preparedSongs: Song[] = []
      for (let i = 0; i < librarySongs.length; i++) {
        const song = librarySongs[i]
        const songId = `local-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`

        let blob: Blob | null = null
        let contentType = 'audio/mpeg'

        // 1. In Electron desktop: direct IPC file read
        if (typeof window !== 'undefined' && window.api?.readAudioFile) {
          try {
            const res = await window.api.readAudioFile(song.id, song.filePath)
            if (res?.success && res.data) {
              contentType = res.contentType || 'audio/mpeg'
              blob = new Blob([res.data], { type: contentType })
            }
          } catch (e) {
            console.warn('[handleSelectLibrarySongs] readAudioFile failed:', e)
          }
        }

        // 2. Fallback: via toMediaUrl or existing blob/http URL
        if (!blob && song.filePath) {
          try {
            if (/^(blob:|https?:)/i.test(song.filePath)) {
              const res = await fetch(song.filePath)
              if (res.ok) {
                contentType = res.headers.get('content-type') || contentType
                blob = await res.blob()
              }
            } else {
              const mediaUrl = toMediaUrl(song.filePath)
              if (mediaUrl) {
                const res = await fetch(mediaUrl)
                if (res.ok) {
                  contentType = res.headers.get('content-type') || contentType
                  blob = await res.blob()
                }
              }
            }
          } catch (e) {
            console.warn('[handleSelectLibrarySongs] Media URL fetch failed:', e)
          }
        }

        if (blob && blob.size > 0) {
          registerLocalSlotPoolFile(songId, blob)
          if (song.filePath) {
            registerLocalSlotPoolPath(songId, song.filePath)
          }
          const objectUrl = URL.createObjectURL(blob)
          const newSong: Song = {
            ...song,
            id: songId,
            filePath: objectUrl,
            audioUrl: objectUrl,
            isOnline: false,
            size: blob.size
          }
          preparedSongs.push(newSong)
        } else {
          if (song.filePath) {
            registerLocalSlotPoolPath(songId, song.filePath)
          }
          preparedSongs.push({
            ...song,
            id: songId
          })
        }
      }

      if (preparedSongs.length > 0) {
        const updatedQueue = [...queue, ...preparedSongs]
        const targetIdx = queue.length === 0 ? 0 : queue.length
        usePlayerStore.getState().setQueue(updatedQueue, targetIdx)
        usePlayerStore.getState().setIsPlaying(true)
        await ensureHostRoom(true, true)
        setMessage(`Added ${preparedSongs.length} track(s) from library to room!`)
        setTimeout(() => setMessage(''), 3000)
      }
    } catch (err: any) {
      console.error('[handleSelectLibrarySongs] Failed:', err)
      setMessage('Failed to load library audio files.')
    } finally {
      setBusy(false)
    }
  }

  const handleSelectYouTube = async (videoId: string, title?: string, channel?: string) => {
    setBusy(true)
    try {
      const ytSong: Song = {
        id: `yt-${videoId}`,
        title: title || 'YouTube Track',
        artist: channel || 'YouTube',
        album: 'YouTube Stream',
        duration: 0,
        artworkPath: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        artworkUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        filePath: `https://www.youtube.com/watch?v=${videoId}`,
        audioUrl: `https://www.youtube.com/watch?v=${videoId}`,
        isOnline: true,
        isYouTube: true,
        videoId: videoId
      } as any

      const updatedQueue = [...queue, ytSong]
      usePlayerStore.getState().setQueue(updatedQueue, updatedQueue.length - 1)
      usePlayerStore.getState().setIsPlaying(true)
      usePlayerStore.setState({ isBuffering: false, isAudioActive: true })
      await ensureHostRoom(true, true)
      setMessage(`Playing YouTube: "${ytSong.title}"`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      console.error('[handleSelectYouTube] Failed:', err)
      setMessage('Failed to load YouTube stream.')
    } finally {
      setBusy(false)
    }
  }

  const handleSelectSystemAudio = async () => {
    setBusy(true)
    try {
      setMessage('Starting system audio broadcast...')
      await startDeviceAudioSharing()
      setMessage('Broadcasting system audio live to session!')
      setTimeout(() => setMessage(''), 3500)
    } catch (err: any) {
      console.error('[handleSelectSystemAudio] Failed:', err)
      setMessage(err?.message || 'System audio capture was cancelled or denied.')
    } finally {
      setBusy(false)
    }
  }

  const [replaceSearchQuery, setReplaceSearchQuery] = useState('')
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [hostName, setHostName] = useState('Friend')
  const [members, setMembers] = useState<RoomMemberInfo[]>([])
  const [selectedMember, setSelectedMember] = useState<RoomMemberInfo | null>(null)
  const [liveFriends, setLiveFriends] = useState<LiveFriendSession[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [showAllQueue, setShowAllQueue] = useState(false)
  const [hostQueueTab, setHostQueueTab] = useState<'all' | 'priority' | 'local'>('all')
  const [listenerQueueTab, setListenerQueueTab] = useState<'all' | 'priority' | 'local'>('all')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [allFriends, setAllFriends] = useState<
    Array<{ id: string; username: string; display_name: string; avatar_url: string | null }>
  >([])
  const [, setInviteModalTab] = useState<'friends' | 'share'>('friends')
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState('')
  const [isInvitingId, setIsInvitingId] = useState<string | null>(null)

  const sentInvitationsByRoom = useNotificationStore((s) => s.sentInvitationsByRoom)
  const sendRoomInvitation = useNotificationStore((s) => s.sendRoomInvitation)
  const loadSentInvitations = useNotificationStore((s) => s.loadSentInvitations)

  const directJoinAttempt = useRef<string | null>(null)

  // Live synced playback position for guest view when tuned into host session
  const [syncedGuestTime, setSyncedGuestTime] = useState(0)

  useEffect(() => {
    if (!joinedRoom || !joinedRoom.song) {
      setSyncedGuestTime(0)
      return
    }

    const calcCurrentTime = () => {
      const hostPos =
        typeof joinedRoom.song?.hostPosition === 'number'
          ? joinedRoom.song.hostPosition
          : joinedRoom.position_seconds || 0
      const hostTimestamp =
        typeof joinedRoom.song?.hostTimestamp === 'number'
          ? joinedRoom.song.hostTimestamp
          : new Date(joinedRoom.updated_at).getTime()
      const duration = joinedRoom.song?.duration || 0
      return roomClockSync.calculateTargetTime(
        hostPos,
        hostTimestamp,
        joinedRoom.is_playing,
        0,
        duration
      )
    }

    setSyncedGuestTime(calcCurrentTime())

    if (joinedRoom.is_playing) {
      const interval = setInterval(() => {
        setSyncedGuestTime(calcCurrentTime())
      }, 500)
      return () => clearInterval(interval)
    }
    return undefined
  }, [joinedRoom?.position_seconds, joinedRoom?.updated_at, joinedRoom?.is_playing, joinedRoom?.song?.title, joinedRoom?.song?.artist, joinedRoom?.song?.localId, joinedRoom?.id])

  const activeSubstitute = joinedRoom?.song ? substitutes[getSongKey(joinedRoom.song)] : undefined
  const activeRoom = joinedRoom || hostRoom

  const currentPlayingTrack = useMemo(() => {
    if (currentSongIndex >= 0 && currentSongIndex < queue.length) {
      return queue[currentSongIndex]
    }
    return undefined
  }, [queue, currentSongIndex])

  const upcomingTracks = useMemo(() => {
    if (currentSongIndex < 0) return queue.filter(Boolean).map((song, idx) => ({ song, idx }))
    return queue.slice(currentSongIndex + 1).filter(Boolean).map((song, i) => ({ song, idx: currentSongIndex + 1 + i }))
  }, [queue, currentSongIndex])

  const priorityTracksList = useMemo(() => {
    return upcomingTracks.filter((t) => Boolean(t?.song?.isPriority))
  }, [upcomingTracks])

  const backgroundTracksList = useMemo(() => {
    return upcomingTracks.filter((t) => Boolean(t?.song && !t.song.isPriority))
  }, [upcomingTracks])

  const shareUrl = useMemo(() => {
    const code = hostRoom?.code || ''
    const fallbackWebUrl = `https://felo.feloapp.workers.dev/#/online/listen?code=${code}`
    if (typeof window === 'undefined') return fallbackWebUrl

    const origin = window.location.origin || ''
    if (!origin || origin.startsWith('file:') || origin === 'null' || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return fallbackWebUrl
    }

    return `${origin}${window.location.pathname}#/online/listen?code=${code}`
  }, [hostRoom?.code])

  // 1. Handle ?room=... direct join link from URL (e.g. shared link)
  useEffect(() => {
    const requestedRoomId = searchParams.get('room')
    if (!user || !requestedRoomId || directJoinAttempt.current === requestedRoomId) return
    directJoinAttempt.current = requestedRoomId
    setBusy(true)
    setMessage('Connecting to friend session...')

    void joinRoomById(requestedRoomId)
      .then((room) => {
        setMessage(`Listening along with ${room.name}!`)
        setSearchParams({}, { replace: true })
        setTimeout(() => setMessage(''), 3000)
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : 'Could not join session.')
      })
      .finally(() => setBusy(false))
  }, [searchParams, user?.id, joinRoomById, setSearchParams])

  // 1b. Handle ?code=... direct join link from URL (e.g. invite code link or host auto-provision)
  useEffect(() => {
    const requestedCode = searchParams.get('code')
    const shouldHost = searchParams.get('host') === 'true'
    if (!user || !requestedCode || directJoinAttempt.current === requestedCode) return
    directJoinAttempt.current = requestedCode
    setBusy(true)

    if (shouldHost) {
      setMessage(`Starting session as host for room ${requestedCode}...`)
      void ensureHostRoom(true, true, requestedCode)
        .then((room) => {
          if (room) {
            setMessage(`Started hosting room ${room.code}!`)
          } else {
            setMessage('Could not initialize room.')
          }
          setSearchParams({}, { replace: true })
          setTimeout(() => setMessage(''), 3000)
        })
        .catch((err) => {
          setMessage(err instanceof Error ? err.message : 'Could not host session.')
        })
        .finally(() => setBusy(false))
      return
    }

    setMessage('Joining session with room code...')

    void joinRoomByCode(requestedCode)
      .then((room) => {
        setMessage(`Joined ${room.name}!`)
        setSearchParams({}, { replace: true })
        setTimeout(() => setMessage(''), 3000)
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : 'Could not join session.')
      })
      .finally(() => setBusy(false))
  }, [searchParams, user?.id, joinRoomByCode, ensureHostRoom, setSearchParams])

  // 1c. Re-attach existing active host room if user already has one active
  useEffect(() => {
    if (!hostRoom && !joinedRoom && user?.id) {
      void ensureHostRoom(true, false).catch(() => undefined)
    }
  }, [user?.id, hostRoom, joinedRoom, ensureHostRoom])

  // 2. Load host display name when in a joined room
  useEffect(() => {
    if (!joinedRoom) return
    void getSupabase()
      .from('profiles')
      .select('display_name')
      .eq('id', joinedRoom.host_id)
      .maybeSingle()
      .then(({ data }) => setHostName(data?.display_name || 'Friend'))
  }, [joinedRoom?.host_id])

  // 3. Load full library for replace modal
  useEffect(() => {
    if (showReplaceModal) {
      window.api?.getSongs?.().then((songs) => {
        setLibrarySongs((songs || []) as Song[])
      }).catch(console.error)
    }
  }, [showReplaceModal])

  // 4. Fetch room member profiles for active room (joined room or host room)
  const loadMembers = useCallback(async () => {
    if (!activeRoom) {
      setMembers([])
      return
    }
    try {
      const supabase = getSupabase()
      const { data: memberRows } = await supabase
        .from('listening_room_members')
        .select('user_id, role, speaker_role, sub_cutoff')
        .eq('room_id', activeRoom.id)

      if (!memberRows || memberRows.length === 0) {
        setMembers([])
        return
      }

      const userIds = memberRows.map((r: any) => r.user_id)
      const roleMap = new Map(
        memberRows.map((r: any) => [
          r.user_id,
          {
            role: (r.role as 'host' | 'co_host' | 'listener') || 'listener',
            speakerRole: (r.speaker_role as SpeakerRole) || 'center',
            subCutoff: typeof r.sub_cutoff === 'number' ? r.sub_cutoff : 120
          }
        ])
      )

      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', userIds)

      const memberList: RoomMemberInfo[] = (profileRows || []).map((p) => {
        const info = roleMap.get(p.id)
        const role = p.id === activeRoom.host_id ? 'host' : info?.role || 'listener'
        const effectiveAvatar =
          p.avatar_url ||
          (p.id === user?.id
            ? profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null
            : null)
        return {
          userId: p.id,
          displayName: p.display_name || (p.id === user?.id ? (profile?.display_name || 'User') : 'User'),
          avatarUrl: effectiveAvatar,
          isHost: role === 'host',
          role,
          speaker_role: info?.speakerRole || 'center',
          sub_cutoff: info?.subCutoff ?? 120,
          username: p.username
        }
      })

      setMembers(memberList)
    } catch {
      // ignore
    }
  }, [activeRoom?.id, activeRoom?.host_id])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers, memberCount, activeRoom?.id])

  // 5. Load Live Friends currently listening to music or in an active party room
  const loadLiveFriends = useCallback(async () => {
    if (!user) return
    setLoadingFriends(true)
    try {
      const supabase = getSupabase()

      try {
        const { data: sessionData } = await supabase.auth.getSession()
        if (!sessionData?.session?.user) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      } catch {
        // ignore
      }

      let { data: reqs } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted')

      if (!reqs || reqs.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const retryResult = await supabase
          .from('friend_requests')
          .select('*')
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
          .eq('status', 'accepted')
        if (retryResult.data) reqs = retryResult.data
      }

      if (!reqs || reqs.length === 0) {
        setLiveFriends([])
        setAllFriends([])
        return
      }

      const friendIds = reqs.map((r) => (r.requester_id === user.id ? r.addressee_id : r.requester_id))

      const [{ data: profileRows }, { data: hostRoomRows }, { data: memberRows }] = await Promise.all([
        supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', friendIds),
        supabase
          .from('listening_rooms')
          .select('*')
          .in('host_id', friendIds)
          .eq('is_active', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('listening_room_members')
          .select('user_id, room_id')
          .in('user_id', friendIds)
      ])

      const profilesMap = new Map((profileRows || []).map((p) => [p.id, p]))
      friendIds.forEach((id) => {
        if (!profilesMap.has(id)) {
          profilesMap.set(id, {
            id,
            username: `user_${id.slice(0, 8)}`,
            display_name: 'Friend',
            avatar_url: null
          })
        }
      })
      setAllFriends(Array.from(profilesMap.values()))

      const friendRoomsMap = new Map<string, ListeningRoom>()
      ;((hostRoomRows || []) as ListeningRoom[]).forEach((r) => {
        if (!friendRoomsMap.has(r.host_id)) friendRoomsMap.set(r.host_id, r)
      })

      const unassignedMemberIds = (memberRows || []).filter((m: any) => !friendRoomsMap.has(m.user_id))
      const memberRoomIds = [...new Set(unassignedMemberIds.map((m: any) => m.room_id).filter(Boolean))]

      if (memberRoomIds.length > 0) {
        const { data: attendedRooms } = await supabase
          .from('listening_rooms')
          .select('*')
          .in('id', memberRoomIds)
          .eq('is_active', true)

        if (attendedRooms) {
          const roomMap = new Map((attendedRooms as ListeningRoom[]).map((r) => [r.id, r]))
          unassignedMemberIds.forEach((m: any) => {
            if (!friendRoomsMap.has(m.user_id)) {
              const r = roomMap.get(m.room_id)
              if (r) friendRoomsMap.set(m.user_id, r)
            }
          })
        }
      }

      const activeList: LiveFriendSession[] = []
      const roomsDict: Record<string, ListeningRoom> = {}
      friendRoomsMap.forEach((room, friendId) => {
        roomsDict[friendId] = room
        activeList.push({
          profile: profilesMap.get(friendId) || {
            id: friendId,
            username: `user_${friendId.slice(0, 8)}`,
            display_name: 'Friend',
            avatar_url: null
          },
          room
        })
      })

      setLiveFriends(activeList)
      useListeningStore.getState().setLiveFriendRooms(roomsDict)
    } catch (err) {
      console.warn('Could not load live friends:', err)
    } finally {
      setLoadingFriends(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadLiveFriends()
    const timer = window.setInterval(() => void loadLiveFriends(), 10000)
    return () => window.clearInterval(timer)
  }, [loadLiveFriends])

  useEffect(() => {
    if (showShareModal && hostRoom?.code) {
      QRCode.toDataURL(shareUrl, {
        width: 180,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      })
        .then(setQrDataUrl)
        .catch(console.error)
    }
    if (showShareModal && hostRoom?.id) {
      void loadSentInvitations(hostRoom.id)
      void loadLiveFriends()
    }
  }, [showShareModal, hostRoom?.id, hostRoom?.code, shareUrl, loadSentInvitations, loadLiveFriends])

  // 6. Real-time Subscription for joined room
  useEffect(() => {
    if (!joinedRoom) return
    const supabase = getSupabase()

    void loadMessages(joinedRoom.id)

    const channel = supabase
      .channel(`room-realtime:${joinedRoom.id}`, {
        config: { presence: { key: user?.id || 'listener' } }
      })
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState()
        const onlineIds = new Set(Object.keys(presenceState))
        const presenceMap = new Map<string, any>()
        Object.values(presenceState).forEach((presences: any) => {
          if (Array.isArray(presences) && presences[0]) {
            const p = presences[0]
            if (p.userId) presenceMap.set(p.userId, p)
          }
        })
        setMembers((prev) =>
          prev.map((m) => {
            const p = presenceMap.get(m.userId)
            return {
              ...m,
              isOnline: onlineIds.has(m.userId),
              displayName: p?.displayName || m.displayName,
              avatarUrl: p?.avatarUrl || m.avatarUrl,
              speaker_role: p?.speakerRole || m.speaker_role || 'center',
              sub_cutoff: typeof p?.subCutoff === 'number' ? p.subCutoff : m.sub_cutoff
            }
          })
        )
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_room_members', filter: `room_id=eq.${joinedRoom.id}` },
        () => {
          void refreshMemberCount(joinedRoom.id)
          void loadMembers()
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'listening_room_messages',
          filter: `room_id=eq.${joinedRoom.id}`
        },
        (payload) => {
          void addIncoming(payload.new as any)
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && user) {
          await channel.track({
            userId: user.id,
            displayName: profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
            avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            isHost: false,
            speakerRole: useDspStore.getState().speakerRole || 'center',
            subCutoff: useDspStore.getState().subCutoff || 120
          })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [joinedRoom?.id, user, handleHostSongChange, handleHostPauseResume, handleHostDisconnect, refreshMemberCount, loadMembers, loadMessages, addIncoming])

  // 6b. Real-time chat subscription for active host room
  useEffect(() => {
    if (!hostRoom?.id || joinedRoom) return
    const supabase = getSupabase()

    void loadMessages(hostRoom.id)

    const channel = supabase
      .channel(`host-chat:${hostRoom.id}`, {
        config: { presence: { key: user?.id || 'host' } }
      })
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState()
        const onlineIds = new Set(Object.keys(presenceState))
        const presenceMap = new Map<string, any>()
        Object.values(presenceState).forEach((presences: any) => {
          if (Array.isArray(presences) && presences[0]) {
            const p = presences[0]
            if (p.userId) presenceMap.set(p.userId, p)
          }
        })
        setMembers((prev) =>
          prev.map((m) => {
            const p = presenceMap.get(m.userId)
            return {
              ...m,
              isOnline: onlineIds.has(m.userId),
              displayName: p?.displayName || m.displayName,
              avatarUrl: p?.avatarUrl || m.avatarUrl,
              speaker_role: p?.speakerRole || m.speaker_role || 'center',
              sub_cutoff: typeof p?.subCutoff === 'number' ? p.subCutoff : m.sub_cutoff
            }
          })
        )
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'listening_room_messages',
          filter: `room_id=eq.${hostRoom.id}`
        },
        (payload) => {
          void addIncoming(payload.new as any)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_room_members',
          filter: `room_id=eq.${hostRoom.id}`
        },
        () => {
          void refreshMemberCount(hostRoom.id)
          void loadMembers()
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && user) {
          await channel.track({
            userId: user.id,
            displayName: profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'Host',
            avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            isHost: true,
            speakerRole: useDspStore.getState().speakerRole || 'center',
            subCutoff: useDspStore.getState().subCutoff || 120
          })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hostRoom?.id, joinedRoom, user, loadMessages, addIncoming, refreshMemberCount, loadMembers])

  // Handlers
  const handleListenAlong = async (friendId: string) => {
    setBusy(true)
    setMessage('')
    try {
      const room = await listenAlongWithFriend(friendId)
      setMessage(`Now listening along with ${room.name}!`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Failed to start listening along.')
    } finally {
      setBusy(false)
    }
  }

  const handleLeaveSession = async () => {
    setBusy(true)
    try {
      await leaveJoinedRoom()
      clearMessages()
      setSearchParams({})
      setMessage('Stopped listening along.')
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Error leaving session.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleDeviceAudio = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      if (isDeviceAudioSharing) {
        await stopDeviceAudioSharing()
        setMessage('Stopped device audio sharing.')
      } else {
        setMessage('Capturing system audio (WASAPI loopback)...')
        await startDeviceAudioSharing()
        setMessage('Broadcasting system audio live to session!')
      }
    } catch (err: any) {
      console.error('Device audio share toggle failed:', err)
      const errText = err?.message || 'Failed to toggle device audio sharing.'
      setMessage(
        errText.includes('NotAllowedError') || errText.includes('Permission')
          ? 'Audio capture was cancelled or not permitted.'
          : errText
      )
    } finally {
      setBusy(false)
      setTimeout(() => setMessage(''), 4000)
    }
  }

  const handleEndHostSession = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      if (isDeviceAudioSharing) {
        await stopDeviceAudioSharing()
      }
      await deactivateHostRoom()
      clearMessages()
      setMessage('Ended hosting session.')
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Error ending hosting session.')
    } finally {
      setBusy(false)
    }
  }

  const handleInviteFriend = async (friendId: string, friendName: string) => {
    if (!hostRoom?.id) return
    setIsInvitingId(friendId)
    try {
      const res = await sendRoomInvitation(hostRoom.id, friendId)
      if (res.success) {
        setInviteSuccessMsg(`Invited ${friendName}!`)
        setTimeout(() => setInviteSuccessMsg(''), 4000)
      } else {
        setMessage(res.error || 'Failed to send invite')
      }
    } catch (err) {
      console.error('Error inviting friend:', err)
    } finally {
      setIsInvitingId(null)
    }
  }

  const handleJoinWithCode = async (event: FormEvent) => {
    event.preventDefault()
    const cleanCode = sanitizeCodeInput(joinCodeInput)
    if (!cleanCode) return
    setBusy(true)
    setMessage('Connecting to session...')
    try {
      const joined = await joinRoomByCode(cleanCode)
      setShowJoinModal(false)
      setJoinCodeInput('')
      setSearchParams({})
      setMessage(`Joined ${joined.name}!`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Failed to join session with code.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleCreateRoom = async () => {
    setBusy(true)
    setMessage('')
    try {
      if (joinedRoom) {
        await leaveJoinedRoom()
      }
      const room = await ensureHostRoom(true, true)
      if (!room) {
        const storeError = useListeningStore.getState().error
        setMessage(storeError || 'Failed to create room. Please try again.')
      } else {
        setMessage(`Room created successfully! Code: ${room.code}`)
        setTimeout(() => setMessage(''), 4000)
      }
    } catch (err: any) {
      setMessage(err?.message || 'Failed to create room.')
    } finally {
      setBusy(false)
    }
  }

  const handleDownloadMissingSong = () => {
    if (!missingSong) return
    onOpenDownloadPanel?.({
      id: missingSong.localId || 'remote-track',
      title: missingSong.title,
      artist: missingSong.artist,
      album: missingSong.album || '',
      duration: missingSong.duration || 0,
      artworkPath: missingSong.artworkUrl,
      artworkUrl: missingSong.artworkUrl,
      isOnline: true,
      autoDownload: false,
      autoPlay: false
    })
  }

  const openReplaceModal = () => {
    const rawTitle = joinedRoom?.song?.title || missingSong?.title || ''
    const cleanTitle = rawTitle.replace(/\s*\([^)]*(qobuz|deezer|soulseek|youtube|spotify|tidal|apple)[^)]*\)/gi, '').trim()
    setReplaceSearchQuery(cleanTitle || rawTitle)
    setShowReplaceModal(true)
  }

  const handleSelectSubstitute = (song: Song) => {
    if (!joinedRoom?.song) return
    setSubstituteSong(joinedRoom.song, song)

    const player = usePlayerStore.getState()
    const currentQueue = player.queue
    const subIndex = currentQueue.findIndex((s) => s.id === song.id)
    if (subIndex >= 0) {
      player.playSong(subIndex)
    } else {
      player.setQueue([song, ...currentQueue], 0)
    }
    const seekTarget = currentTime || syncedGuestTime
    if (seekTarget > 0) {
      player.seek(seekTarget)
    }
    player.setIsPlaying(joinedRoom.is_playing)

    setShowReplaceModal(false)
    setMessage(`Replaced with "${song.title}"!`)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleResetSubstitute = () => {
    if (!joinedRoom?.song) return
    setSubstituteSong(joinedRoom.song, null)
    if (joinedRoom) {
      void useListeningStore.getState().handleHostSongChange(joinedRoom)
    }
    setMessage('Reset to host song.')
    setTimeout(() => setMessage(''), 3000)
  }

  const filteredLibrary = librarySongs.filter((song) => {
    if (!replaceSearchQuery.trim()) return true
    const q = replaceSearchQuery.toLowerCase()
    return song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q)
  })

  // VIEW A: CURRENTLY LISTENING ALONG WITH A FRIEND
  if (joinedRoom) {
    return (
      <GuestRoomView
        joinedRoom={joinedRoom}
        hostName={hostName}
        activeSubstitute={activeSubstitute}
        autoDownloadMissing={autoDownloadMissing}
        setAutoDownloadMissing={setAutoDownloadMissing}
        setIsManualSyncModalOpen={setIsManualSyncModalOpen}
        manualSyncOffsetMs={manualSyncOffsetMs}
        handleLeaveSession={handleLeaveSession}
        busy={busy}
        isReceivingDeviceStream={isReceivingDeviceStream}
        isAutoplayBlocked={isAutoplayBlocked}
        unmuteDeviceStream={unmuteDeviceStream}
        isLosslessMasterActive={isLosslessMasterActive}
        deviceAudioClientState={deviceAudioClientState}
        deviceAudioStats={deviceAudioStats}
        disconnectFromDeviceStream={disconnectFromDeviceStream}
        connectToDeviceStream={connectToDeviceStream}
        deviceAudioVolume={deviceAudioVolume}
        setDeviceAudioVolume={setDeviceAudioVolume}
        deviceAudioClientLevel={deviceAudioClientLevel}
        jitStatus={jitStatus}
        syncStatus={syncStatus}
        missingSong={missingSong}
        openReplaceModal={openReplaceModal}
        handleDownloadMissingSong={handleDownloadMissingSong}
        leaveJoinedRoom={leaveJoinedRoom}
        handleResetSubstitute={handleResetSubstitute}
        isPlaying={isPlaying}
        currentTime={currentTime}
        syncedGuestTime={syncedGuestTime}
        members={members}
        setSelectedMember={setSelectedMember}
        user={user}
        setMessage={setMessage}
        listenerQueueTab={listenerQueueTab}
        setListenerQueueTab={setListenerQueueTab}
        transfers={transfers}
        onOpenDownloadPanel={onOpenDownloadPanel}
        showReplaceModal={showReplaceModal}
        setShowReplaceModal={setShowReplaceModal}
        replaceSearchQuery={replaceSearchQuery}
        setReplaceSearchQuery={setReplaceSearchQuery}
        filteredLibrary={filteredLibrary}
        handleSelectSubstitute={handleSelectSubstitute}
      />
    )
  }

  // VIEW B: LIVE SESSIONS HUB (DEFAULT SPOTIFY-STYLE EXPERIENCE)
  return (
    <div className="mx-auto flex min-h-full flex-1 w-full max-w-4xl flex-col px-4 sm:px-6 md:px-8 py-5 sm:py-7 pb-36 sm:pb-32 md:pb-24 select-none">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <Radio className="h-3.5 w-3.5 text-text" />
            <span>Live Audio Sync</span>
          </div>
          <h1 className="mt-1.5 text-2xl sm:text-3xl font-extrabold text-text tracking-tight">
            Listen Together
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-text-muted">
            Listen along with friends in real-time with instant auto-sync.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {!hostRoom?.code && (
            <div
              title="Ephemeral In-RAM streaming: Audio streams live without saving permanent files to listener drives."
              className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-3.5 py-1.5 text-xs font-semibold text-text shadow-sm"
            >
              <Radio className="h-3.5 w-3.5 text-text-muted" />
              <span>Lossless Stereo Sync</span>
              <span className="text-[10px] text-text-muted font-mono hidden sm:inline">• In-RAM Stream</span>
            </div>
          )}

          {hostRoom?.code && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-3.5 py-1.5 text-xs font-semibold text-text shadow-sm">
                <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
                <span>Hosting Active Session</span>
                <span className="text-[10px] text-text-muted font-mono hidden sm:inline">
                  • {members.length || 1} participant{members.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      {message && (
        <div className="mt-4 rounded-xl border border-border/60 bg-surface-elevated/80 p-3 text-xs font-bold text-text text-center">
          {message}
        </div>
      )}

      {/* When idle: Bento Grid for Host / Join */}
      {!hostRoom?.code && !joinedRoom && (
        <LobbyBentoGrid
          handleCreateRoom={handleCreateRoom}
          busy={busy}
          joinCodeInput={joinCodeInput}
          setJoinCodeInput={setJoinCodeInput}
          handleJoinWithCode={handleJoinWithCode}
        />
      )}

      {/* When hosting: Active Host Session Controls & Queue */}
      {hostRoom?.code && (
        <HostSessionSection
          hostRoom={hostRoom}
          members={members}
          setSelectedMember={setSelectedMember}
          copied={copied}
          handleCopyCode={handleCopyCode}
          setShowShareModal={setShowShareModal}
          setInviteModalTab={setInviteModalTab}
          showHostChat={showHostChat}
          setShowHostChat={setShowHostChat}
          handleEndHostSession={handleEndHostSession}
          busy={busy}
          queue={queue}
          currentSongIndex={currentSongIndex}
          jitStatus={jitStatus}
          isDeviceAudioSharing={isDeviceAudioSharing}
          isDeviceAudioMuted={isDeviceAudioMuted}
          toggleDeviceAudioMute={toggleDeviceAudioMute}
          handleToggleDeviceAudio={handleToggleDeviceAudio}
          deviceAudioBitrate={deviceAudioBitrate}
          setDeviceAudioBitrate={setDeviceAudioBitrate}
          deviceAudioLevel={deviceAudioLevel}
          deviceAudioPeerCount={deviceAudioPeerCount}
          discordPriorityEnabled={discordPriorityEnabled}
          setDiscordPriorityEnabled={setDiscordPriorityEnabled}
          setShowSelectMediaModal={setShowSelectMediaModal}
          playNext={playNext}
          ensureHostRoom={ensureHostRoom}
          playTrackByIndex={playTrackByIndex}
          removeSongFromQueueByIndex={removeSongFromQueueByIndex}
          bumpSongToPriority={bumpSongToPriority}
          showAllQueue={showAllQueue}
          setShowAllQueue={setShowAllQueue}
          hostQueueTab={hostQueueTab}
          setHostQueueTab={setHostQueueTab}
          currentPlayingTrack={currentPlayingTrack}
          priorityTracksList={priorityTracksList}
          backgroundTracksList={backgroundTracksList}
          setMessage={setMessage}
        />
      )}

      {/* Friends Listening Right Now Hub */}
      <FriendSessionsSection
        liveFriends={liveFriends}
        loadingFriends={loadingFriends}
        loadLiveFriends={loadLiveFriends}
        handleListenAlong={handleListenAlong}
        busy={busy}
      />

      {/* Join with Code Modal */}
      <JoinCodeModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        joinCodeInput={joinCodeInput}
        setJoinCodeInput={setJoinCodeInput}
        onSubmit={handleJoinWithCode}
        busy={busy}
      />

      {/* Invite Friends & QR Code Modal */}
      {hostRoom?.code && (
        <InviteFriendsModal
          isOpen={showShareModal}
          onClose={() => {
            setShowShareModal(false)
            setInviteSuccessMsg('')
          }}
          roomCode={hostRoom.code}
          shareUrl={shareUrl}
          qrDataUrl={qrDataUrl}
          allFriends={allFriends}
          members={members}
          sentInvitations={hostRoom.id ? sentInvitationsByRoom[hostRoom.id] || [] : []}
          onInviteFriend={handleInviteFriend}
          isInvitingId={isInvitingId}
          inviteSuccessMsg={inviteSuccessMsg}
        />
      )}

      {/* Member Profile & Add Friend Modal */}
      {selectedMember && (
        <RoomMemberProfileModal
          userId={selectedMember.userId}
          initialProfile={{
            id: selectedMember.userId,
            displayName: selectedMember.displayName,
            avatarUrl: selectedMember.avatarUrl,
            username: selectedMember.username
          }}
          isHost={selectedMember.isHost}
          role={selectedMember.role}
          isRoomHost={activeRoom?.host_id === user?.id}
          onPromote={async (newRole) => {
            await promoteMember(selectedMember.userId, newRole)
            await loadMembers()
          }}
          onKick={async () => {
            await kickMember(selectedMember.userId)
            await loadMembers()
          }}
          onClose={() => setSelectedMember(null)}
        />
      )}

      {/* Select Media Modal (Local Files, YouTube, System Audio) */}
      <SelectMediaModal
        isOpen={showSelectMediaModal}
        onClose={() => setShowSelectMediaModal(false)}
        onSelectLocalFiles={handleSelectLocalFiles}
        onSelectYouTube={handleSelectYouTube}
        onSelectSystemAudio={handleSelectSystemAudio}
        onOpenLibrary={() => setShowAddLibraryModal(true)}
      />

      {/* Add From Library Modal */}
      <AddFromLibraryModal
        isOpen={showAddLibraryModal}
        onClose={() => setShowAddLibraryModal(false)}
        existingQueueSongIds={new Set(queue.map((s) => s.id))}
        onAddSong={(song) => void handleSelectLibrarySongs([song])}
        onAddSongs={(songs) => void handleSelectLibrarySongs(songs)}
      />
    </div>
  )
}

export default function ListenTogetherPage({ onOpenDownloadPanel }: ListenTogetherPageProps): ReactElement {
  return (
    <OnlineGate>
      <ListenTogetherWorkspace onOpenDownloadPanel={onOpenDownloadPanel} />
    </OnlineGate>
  )
}
