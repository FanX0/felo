import { FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Crown,
  Download,
  Headphones,
  ListMusic,
  Loader2,
  LogOut,
  MessageSquare,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  X,
  Link2,
  Activity,
  MicOff,
  Volume2,
  VolumeX,
  Wifi,
  Plus,
  Sparkles,
  ClipboardPaste
} from 'lucide-react'
import QRCode from 'qrcode'
import { useSearchParams, NavLink } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useShallow } from 'zustand/react/shallow'
import { useRoomChatStore } from '../../hooks/useRoomChatStore'
import RoomChat from '../../components/RoomChat/RoomChat'
import RoomMemberProfileModal from '../../components/Online/RoomMemberProfileModal'
import { getSupabase } from '../../lib/supabase'
import type { ListeningRoom } from '../../online/types'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import type { Song } from '../Library/Library'

interface ListenTogetherPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

interface RoomMemberInfo {
  userId: string
  displayName: string
  avatarUrl: string | null
  isHost: boolean
  username?: string
  isOnline?: boolean
}

interface LiveFriendSession {
  profile: {
    id: string
    username: string
    display_name: string
    avatar_url: string | null
  }
  room: ListeningRoom
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function getSongKey(song?: any): string {
  if (!song) return ''
  return `${song.artist} - ${song.title}`.trim().toLowerCase()
}

function ListenTogetherWorkspace({ onOpenDownloadPanel }: ListenTogetherPageProps): ReactElement {
  const { user } = useOnlineStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isPlaying, currentTime, queue, currentSongIndex, playSong } = usePlayerStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
      currentTime: s.currentTime,
      queue: s.queue,
      currentSongIndex: s.currentSongIndex,
      playSong: s.playSong
    }))
  )

  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const memberCount = useListeningStore((state) => state.memberCount)
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const missingSong = useListeningStore((state) => state.missingSong)
  const autoDownloadMissing = useListeningStore((state) => state.autoDownloadMissing)
  const substitutes = useListeningStore((state) => state.substitutes)

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
  const setDeviceAudioBitrate = useListeningStore((state) => state.setDeviceAudioBitrate)
  const toggleDeviceAudioMute = useListeningStore((state) => state.toggleDeviceAudioMute)
  const setDeviceAudioVolume = useListeningStore((state) => state.setDeviceAudioVolume)
  const unmuteDeviceStream = useListeningStore((state) => state.unmuteDeviceStream)

  const loadMessages = useRoomChatStore((state) => state.loadMessages)
  const addIncoming = useRoomChatStore((state) => state.addIncoming)
  const clearMessages = useRoomChatStore((state) => state.clearMessages)

  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showHostChat, setShowHostChat] = useState(false)
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
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedDiscord, setCopiedDiscord] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const directJoinAttempt = useRef<string | null>(null)

  const activeSubstitute = joinedRoom?.song ? substitutes[getSongKey(joinedRoom.song)] : undefined
  const activeRoom = joinedRoom || hostRoom

  const shareUrl = typeof window !== 'undefined' && window.location.origin && !window.location.origin.startsWith('file:') && window.location.origin !== 'null'
    ? `${window.location.origin}${window.location.pathname}#/online/listen?code=${hostRoom?.code || ''}`
    : `felo://listen?code=${hostRoom?.code || ''}`

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
  }, [showShareModal, hostRoom?.code, shareUrl])

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

  // 1b. Handle ?code=... direct join link from URL (e.g. invite code link)
  useEffect(() => {
    const requestedCode = searchParams.get('code')
    if (!user || !requestedCode || directJoinAttempt.current === requestedCode) return
    directJoinAttempt.current = requestedCode
    setBusy(true)
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
  }, [searchParams, user?.id, joinRoomByCode, setSearchParams])

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
        .select('user_id')
        .eq('room_id', activeRoom.id)

      if (!memberRows || memberRows.length === 0) {
        setMembers([])
        return
      }

      const userIds = memberRows.map((r) => r.user_id)
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', userIds)

      const memberList: RoomMemberInfo[] = (profileRows || []).map((p) => ({
        userId: p.id,
        displayName: p.display_name || 'User',
        avatarUrl: p.avatar_url,
        isHost: p.id === activeRoom.host_id,
        username: p.username
      }))

      setMembers(memberList)
    } catch {
      // ignore
    }
  }, [activeRoom?.id, activeRoom?.host_id])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers, memberCount, activeRoom?.id])

  // 5. Load Live Friends currently listening to music
  const loadLiveFriends = useCallback(async () => {
    if (!user) return
    setLoadingFriends(true)
    try {
      const supabase = getSupabase()
      const { data: reqs } = await supabase
        .from('friend_requests')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq('status', 'accepted')

      if (!reqs || reqs.length === 0) {
        setLiveFriends([])
        return
      }

      const friendIds = reqs.map((r) => (r.requester_id === user.id ? r.addressee_id : r.requester_id))

      const [{ data: profileRows }, { data: roomRows }] = await Promise.all([
        supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', friendIds),
        supabase
          .from('listening_rooms')
          .select('*')
          .in('host_id', friendIds)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
      ])

      const profilesMap = new Map((profileRows || []).map((p) => [p.id, p]))
      const activeList: LiveFriendSession[] = (roomRows || [])
        .filter((r) => r.is_playing && r.song)
        .map((r) => ({
          profile: profilesMap.get(r.host_id) || {
            id: r.host_id,
            username: 'friend',
            display_name: 'Friend',
            avatar_url: null
          },
          room: r as ListeningRoom
        }))

      setLiveFriends(activeList)
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

  // 6. Real-time Subscription for joined room (session updates + real-time chat)
  useEffect(() => {
    if (!joinedRoom) return
    const supabase = getSupabase()

    // Load initial chat messages
    void loadMessages(joinedRoom.id)

    const channel = supabase
      .channel(`room-realtime:${joinedRoom.id}`, {
        config: { presence: { key: user?.id || 'listener' } }
      })
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState()
        const onlineIds = new Set(Object.keys(presenceState))
        setMembers((prev) =>
          prev.map((m) => ({
            ...m,
            isOnline: onlineIds.has(m.userId)
          }))
        )
      })
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listening_rooms', filter: `id=eq.${joinedRoom.id}` },
        (payload) => {
          const next = payload.new as ListeningRoom
          if (!next.is_active) {
            setMessage('Host ended the session.')
            void handleHostDisconnect()
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const songChanged =
            next.song?.title !== currentRoom?.song?.title ||
            next.song?.artist !== currentRoom?.song?.artist ||
            next.song?.localId !== currentRoom?.song?.localId

          useListeningStore.getState().setJoinedRoom(next)

          if (songChanged) {
            void handleHostSongChange(next)
          } else {
            handleHostPauseResume(next)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'listening_rooms', filter: `id=eq.${joinedRoom.id}` },
        () => {
          setMessage('Host ended the listening session.')
          void handleHostDisconnect()
        }
      )
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
            displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
            avatarUrl: user.user_metadata?.avatar_url || null,
            isHost: false
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
        setMembers((prev) =>
          prev.map((m) => ({
            ...m,
            isOnline: onlineIds.has(m.userId)
          }))
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
            displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Host',
            avatarUrl: user.user_metadata?.avatar_url || null,
            isHost: true
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

  const handleJoinWithCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!joinCodeInput.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const joined = await joinRoomByCode(joinCodeInput)
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
      isOnline: true,
      autoDownload: true,
      autoPlay: true
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

    // Immediately play the replacement track so the footer title and playback update instantly
    const player = usePlayerStore.getState()
    const currentQueue = player.queue
    const subIndex = currentQueue.findIndex((s) => s.id === song.id)
    if (subIndex >= 0) {
      player.playSong(subIndex)
    } else {
      player.setQueue([song, ...currentQueue], 0)
    }
    if (currentTime > 0) {
      player.seek(currentTime)
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

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW A: CURRENTLY LISTENING ALONG WITH A FRIEND
  // ──────────────────────────────────────────────────────────────────────────
  if (joinedRoom) {
    const displaySong = activeSubstitute || joinedRoom.song
    const songDuration = displaySong?.duration || 0
    const songProgress = songDuration > 0 ? Math.min(100, (currentTime / songDuration) * 100) : 0

    return (
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 sm:px-6 md:px-8 py-5 sm:py-7 pb-36 sm:pb-32 md:pb-24 select-none">
        {/* Active Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <Radio className="h-4 w-4 animate-pulse text-emerald-400" />
              <span>Listening Along Live</span>
            </div>
            <h1 className="mt-1.5 text-2xl sm:text-3xl font-extrabold text-text tracking-tight">
              {joinedRoom.name}
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              Synchronized in real-time with <strong className="text-text">{hostName}</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Ephemeral Stream vs Save toggle */}
            <button
              type="button"
              onClick={() => setAutoDownloadMissing(!autoDownloadMissing)}
              title={
                autoDownloadMissing
                  ? 'Saving full tracks to local library (Personal copy)'
                  : 'Stream Mode: Ephemeral playback in RAM only (Safe & Compliant • No file saved)'
              }
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border cursor-pointer ${
                autoDownloadMissing
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>{autoDownloadMissing ? 'Save to Library: ON' : 'Lossless RAM Stream'}</span>
            </button>

            {/* Leave / Stop Syncing button */}
            <button
              type="button"
              onClick={handleLeaveSession}
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-danger/15 border border-danger/30 hover:bg-danger hover:text-white px-4 py-2 text-xs font-bold text-danger transition-all disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              <span>Stop Listening</span>
            </button>
          </div>
        </header>

        {/* Compliance & Fidelity Notice */}
        <div className="mt-4 p-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
              <Radio className="w-4 h-4" />
            </span>
            <div>
              <span className="font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Lossless Ephemeral Audio Sync</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-mono">
                  100% Studio Lossless • In-RAM
                </span>
              </span>
              <p className="text-[11px] text-emerald-100/70 mt-0.5">
                Audio streams in synchronized lossless quality for this session only. No permanent files are saved to your drive.
              </p>
            </div>
          </div>
        </div>

        {/* Autoplay Blocked Alert Banner (Mobile / Browser User Gesture Required) */}
        {(isReceivingDeviceStream || joinedRoom.song?.isDeviceStream || joinedRoom.is_device_stream) && isAutoplayBlocked && (
          <div className="mt-4 rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-500/20 via-surface-elevated to-surface p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/25 text-amber-400 border border-amber-500/35">
                <VolumeX className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  Audio playback paused by your browser
                </p>
                <p className="text-xs text-amber-200/80 mt-0.5">
                  Mobile and web browsers require a single tap to enable live WebRTC audio output.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void unmuteDeviceStream()}
              className="flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black px-5 py-2.5 text-xs font-black transition-all shadow-md cursor-pointer shrink-0"
            >
              <Volume2 className="h-4 w-4" />
              <span>Tap to Listen Now</span>
            </button>
          </div>
        )}

        {/* Live Device / System Audio Stream Status Banner */}
        {(isReceivingDeviceStream || joinedRoom.song?.isDeviceStream || joinedRoom.is_device_stream) && (
          <div className="mt-4 rounded-xl border border-primary-amber/40 bg-gradient-to-r from-primary-amber/15 via-surface-elevated to-surface p-4 shadow-lg flex flex-col gap-3 animate-fade-in">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-amber/20 text-primary-amber border border-primary-amber/30">
                  <Volume2 className="h-6 w-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white">Live System Audio Stream</span>
                    <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                      {deviceAudioClientState === 'connected' ? 'Ultra-Low Latency Opus Stereo' : deviceAudioClientState}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    Listening live to {hostName}'s computer audio (Spotify, games, browser) via ultra-low latency WebRTC.
                  </p>
                </div>
              </div>

              {/* WebRTC Telemetry chip */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 rounded-lg bg-surface border border-border/60 px-2.5 py-1 text-[11px] font-mono text-text-muted">
                  <Wifi className="h-3 w-3 text-emerald-400" />
                  <span>{deviceAudioStats?.rttMs != null ? `${deviceAudioStats.rttMs}ms RTT` : 'Direct P2P'}</span>
                  {deviceAudioStats?.bitrateKbps ? (
                    <span className="text-text font-bold">• {Math.round(deviceAudioStats.bitrateKbps)} kbps</span>
                  ) : null}
                </div>
                <span className="text-[11px] font-bold text-emerald-400/90 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  Mode A: RAM Stream
                </span>
              </div>
            </div>

            {/* Listener Dedicated Stream Volume & VU Output Level */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-border/40">
              {/* Stream Volume Control */}
              <div className="flex items-center gap-2.5 min-w-[200px]">
                <button
                  type="button"
                  onClick={() => setDeviceAudioVolume(deviceAudioVolume > 0 ? 0 : 1)}
                  className="text-text-muted hover:text-white transition-colors cursor-pointer"
                  title={deviceAudioVolume === 0 ? 'Unmute' : 'Mute'}
                >
                  {deviceAudioVolume === 0 ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={deviceAudioVolume}
                  onChange={(e) => setDeviceAudioVolume(parseFloat(e.target.value))}
                  className="w-28 sm:w-36 h-1.5 bg-surface-elevated rounded-lg appearance-none cursor-pointer accent-primary-amber"
                  title="Stream Volume"
                />
                <span className="text-[11px] font-mono text-text-muted min-w-[32px]">
                  {Math.round(deviceAudioVolume * 100)}%
                </span>
              </div>

              {/* Real-time Listener VU Level Meter */}
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <span className="text-[10px] font-mono font-bold text-text-muted uppercase">VU</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface border border-border/60">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-primary-amber to-red-500 transition-all duration-75 ease-out"
                    style={{ width: `${Math.min(100, Math.max(2, deviceAudioClientLevel))}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-text-muted min-w-[24px]">
                  {Math.round(deviceAudioClientLevel)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Missing Song Alert Banner */}
        {syncStatus === 'missing_song' && missingSong && !activeSubstitute && !isReceivingDeviceStream && !joinedRoom.song?.isDeviceStream && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 animate-fade-in shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  "{missingSong.title}" is missing locally
                </p>
                <p className="text-xs text-amber-200/70 mt-0.5">
                  {autoDownloadMissing
                    ? 'Downloading track in the background... It will start playing automatically once ready.'
                    : 'Download the track or choose a local substitute to keep listening.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={openReplaceModal}
                className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 px-3.5 py-2 text-xs font-bold text-white transition-all"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Replace</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadMissingSong}
                className="flex items-center gap-1.5 rounded-full bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-black text-black transition-all"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Substitute Song Banner */}
        {activeSubstitute && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-secondary-cyan/40 bg-secondary-cyan/10 p-4 animate-fade-in shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-cyan/20 text-secondary-cyan">
                <Music2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">
                  Playing local substitute: <strong className="text-secondary-cyan">"{activeSubstitute.title}"</strong>
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  Host is playing: "{joinedRoom.song?.title}" by {joinedRoom.song?.artist}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openReplaceModal}
                className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-all"
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleResetSubstitute}
                className="rounded-full bg-danger/20 hover:bg-danger text-danger hover:text-white px-3 py-1.5 text-xs font-bold transition-all"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {/* Main Synced Player Card */}
        <div className="py-8 flex flex-col items-center">
          <div className="w-full max-w-lg text-center">
            {/* Animated Headphones Avatar */}
            <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-tr from-surface-elevated to-surface border border-border shadow-xl shadow-black/40">
              <Headphones className={`h-12 w-12 text-text ${isPlaying ? 'animate-bounce' : ''}`} />
              {isPlaying && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-white"></span>
                </span>
              )}
            </div>

            {/* Song Details */}
            <div className="mt-6">
              <h2 className="text-2xl font-black text-text truncate max-w-md mx-auto">
                {displaySong?.title || 'Waiting for song...'}
              </h2>
              <p className="mt-1 text-sm font-semibold text-text-muted truncate max-w-md mx-auto">
                {displaySong?.artist || hostName}
              </p>

              {/* Quick fix / replace trigger */}
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openReplaceModal}
                  title="Fix wrong track or choose a substitute"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/15 px-3.5 py-1 text-[11px] font-bold text-text-muted hover:text-white transition-all shadow-sm cursor-pointer"
                >
                  <SlidersHorizontal className="h-3 w-3 text-primary-amber" />
                  <span>Wrong track? Fix / Replace</span>
                </button>
              </div>
            </div>

            {/* Synced Progress Bar */}
            <div className="mt-6 w-full">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300 ease-linear"
                  style={{ width: `${songProgress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-bold text-text-muted">
                <span>{formatTime(currentTime)}</span>
                <span className="flex items-center gap-1 text-[11px] text-text">
                  <Radio className="h-3 w-3" /> Live Sync
                </span>
                <span>{formatTime(songDuration)}</span>
              </div>
            </div>

            {/* Members in session */}
            {/* Members in session */}
            <div className="mt-8 flex flex-col items-center justify-center gap-3">
              <p className="text-xs font-bold text-text-muted uppercase tracking-wider">
                Listening with ({members.length || 1}) • Click profile to add friend
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {members.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => setSelectedMember(m)}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated pl-1.5 pr-3 py-1 text-xs font-bold text-text hover:border-white/40 hover:bg-hover transition-all cursor-pointer shadow-sm group"
                    title={`Click to view profile of ${m.displayName}`}
                  >
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full overflow-hidden border border-border bg-surface text-[10px] font-black text-text">
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        m.displayName.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    {m.isOnline && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Online" />
                    )}
                    {m.isHost && <Crown className="h-3 w-3 text-amber-400 shrink-0" />}
                    <span className="group-hover:text-white transition-colors">{m.displayName}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Session Queue from Host */}
            {joinedRoom.queue && joinedRoom.queue.length > 0 && (
              <div className="mt-8 w-full text-left rounded-2xl border border-border/80 bg-surface-elevated/50 p-5 shadow-lg backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-text-muted" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-text">
                      Live Session Queue
                    </h3>
                  </div>
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-bold text-text-muted border border-border/40">
                    {joinedRoom.queue.length} Tracks
                  </span>
                </div>

                <div className="divide-y divide-border/20 max-h-56 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                  {joinedRoom.queue.map((song, idx) => {
                    const isNowPlaying =
                      idx === 0 ||
                      (song.title === joinedRoom.song?.title && song.artist === joinedRoom.song?.artist)
                    return (
                      <div
                        key={`${song.title}-${song.artist}-${idx}`}
                        className={`flex items-center justify-between p-2 rounded-xl transition-all ${
                          isNowPlaying
                            ? 'bg-white/10 text-text font-bold'
                            : 'text-text-muted hover:text-text'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-5 text-center text-[10px] font-bold opacity-60">
                            {isNowPlaying ? (
                              <Radio className="h-3 w-3 animate-pulse text-text mx-auto" />
                            ) : (
                              idx + 1
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold">{song.title}</p>
                            <p className="truncate text-[10px] opacity-70">{song.artist}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono opacity-60 shrink-0 ml-2">
                          {formatTime(song.duration || 0)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Real-time Room Chat */}
            <div className="mt-8 w-full text-left">
              <RoomChat
                roomId={joinedRoom.id}
                roomName={joinedRoom.name}
                onSelectUser={(userId, initialProfile) => {
                  setSelectedMember({
                    userId,
                    displayName: initialProfile?.displayName || 'User',
                    avatarUrl: initialProfile?.avatarUrl || null,
                    isHost: userId === joinedRoom.host_id
                  })
                }}
              />
            </div>
          </div>
        </div>

        {/* Replace Modal */}
        {showReplaceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <h3 className="text-base font-bold text-text">Choose Replacement Track</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    For "{joinedRoom.song?.title || 'Song'}" by {joinedRoom.song?.artist || 'Host'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReplaceModal(false)}
                  className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search your library..."
                  value={replaceSearchQuery}
                  onChange={(e) => setReplaceSearchQuery(e.target.value)}
                  className="w-full h-10 rounded-xl border border-border bg-surface-elevated py-2 pl-9 pr-4 text-xs font-medium text-text placeholder-text-muted focus:border-white/50 focus:outline-none"
                />
              </div>

              <div className="mt-3 max-h-56 overflow-y-auto space-y-1">
                {filteredLibrary.length === 0 ? (
                  <div className="py-6 text-center text-xs text-text-muted">
                    No matching songs found in your library.
                  </div>
                ) : (
                  filteredLibrary.slice(0, 30).map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      onClick={() => handleSelectSubstitute(song)}
                      className="w-full flex items-center justify-between rounded-lg p-2.5 text-left hover:bg-hover transition-colors"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="truncate text-xs font-bold text-text">{song.title}</p>
                        <p className="truncate text-[11px] text-text-muted">{song.artist}</p>
                      </div>
                      <span className="text-[10px] font-bold text-text-muted">
                        {formatTime(song.duration)}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {/* Provider alternative search */}
              <div className="pt-3 border-t border-border mt-3 flex items-center justify-between gap-3">
                <span className="text-[11px] text-text-muted">Need a different version?</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowReplaceModal(false)
                    if (joinedRoom.song) {
                      onOpenDownloadPanel?.({
                        id: '',
                        title: joinedRoom.song.title,
                        artist: joinedRoom.song.artist,
                        album: joinedRoom.song.album || '',
                        duration: joinedRoom.song.duration || 0,
                        artworkPath: joinedRoom.song.artworkUrl,
                        isOnline: true
                      })
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary-amber text-canvas px-3.5 py-1.5 text-xs font-bold transition-all hover:opacity-90 shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Search All Providers</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VIEW B: LIVE SESSIONS HUB (DEFAULT SPOTIFY-STYLE EXPERIENCE)
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 sm:px-6 md:px-8 py-5 sm:py-7 pb-36 sm:pb-32 md:pb-24 select-none">
      {/* Top Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
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
              className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-semibold text-emerald-400 shadow-sm"
            >
              <Radio className="h-3.5 w-3.5 animate-pulse" />
              <span>Lossless Stereo Sync</span>
              <span className="text-[10px] text-emerald-300/80 font-mono hidden sm:inline">• In-RAM Stream</span>
            </div>
          )}

          {hostRoom?.code && (
            <>
              <button
                type="button"
                onClick={() => setShowHostChat((prev) => !prev)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                  showHostChat
                    ? 'border-white bg-white/10 text-text'
                    : 'border-border bg-surface-elevated text-text hover:bg-hover'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Host Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-black text-black transition-all hover:bg-white/90 cursor-pointer shadow-sm"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Invite Friends</span>
              </button>

              <button
                type="button"
                onClick={handleEndHostSession}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 hover:bg-danger text-danger hover:text-white px-4 py-2 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                title="End hosting this group session"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>End Session</span>
              </button>
            </>
          )}
        </div>
      </header>

      {message && (
        <div className="mt-4 rounded-xl border border-border/60 bg-surface-elevated/80 p-3 text-xs font-bold text-text text-center">
          {message}
        </div>
      )}

      {/* 2-Column Responsive Bento Grid: Host vs Join (when not hosting) */}
      {!hostRoom?.code && !joinedRoom && (
        <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 animate-fade-in">
          {/* Card 1: Host a Session */}
          <div className="group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] via-surface-elevated/90 to-surface p-5 sm:p-6 shadow-xl backdrop-blur-sm transition-all duration-200 hover:border-white/25 hover:shadow-2xl">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-white/10 text-white border border-white/15 group-hover:scale-105 transition-transform shadow-inner">
                  <Radio className="h-5 w-5 sm:h-6 sm:w-6 animate-pulse" />
                </div>
                <span className="rounded-full bg-white/10 border border-white/15 px-2.5 py-1 text-[10px] font-mono font-bold text-white tracking-wider">
                  HOST ROOM
                </span>
              </div>

              <h2 className="mt-4 text-lg sm:text-xl font-black text-text tracking-tight">
                Start a Listening Room
              </h2>
              <p className="mt-2 text-xs text-text-muted leading-relaxed">
                Create an instant live room for your friends. Broadcast your local music queue or stream your computer's audio with zero driver setup.
              </p>

              {/* Feature bullet list */}
              <ul className="mt-4 space-y-2 border-t border-border/40 pt-3 text-[11px] text-text-muted">
                <li className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>Real-time queue auto-sync & friend join</span>
                </li>
                <li className="flex items-center gap-2">
                  <Volume2 className="h-3.5 w-3.5 text-primary-amber shrink-0" />
                  <span>Lossless WASAPI system audio broadcast</span>
                </li>
                <li className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-secondary-cyan shrink-0" />
                  <span>In-room live chat & Discord bot integration</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-border/40">
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={busy}
                className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white hover:bg-white/90 text-black px-5 py-2.5 text-xs font-black transition-all shadow-md hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 stroke-[3]" />}
                <span>Create Room Now</span>
              </button>
            </div>
          </div>

          {/* Card 2: Join with Room Code */}
          <div className="group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-surface-elevated via-surface-elevated/90 to-surface p-5 sm:p-6 shadow-xl backdrop-blur-sm transition-all duration-200 hover:border-white/25 hover:shadow-2xl">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-surface border border-border text-text group-hover:scale-105 transition-transform shadow-inner">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <span className="rounded-full bg-surface border border-border px-2.5 py-1 text-[10px] font-mono font-bold text-text-muted tracking-wider">
                  LISTENER ACCESS
                </span>
              </div>

              <h2 className="mt-4 text-lg sm:text-xl font-black text-text tracking-tight">
                Join with Room Code
              </h2>
              <p className="mt-2 text-xs text-text-muted leading-relaxed">
                Have a 6-character room code from a friend or Discord? Enter it below to sync playback instantly in your browser or desktop.
              </p>

              {/* Helpful tips */}
              <div className="mt-4 rounded-xl border border-border/50 bg-black/20 p-3 text-[11px] text-text-muted">
                <p className="leading-snug">
                  💡 Tip: Codes are 6 letters (e.g. <strong className="text-text font-mono">AB12CD</strong>). You can also click or paste invite links.
                </p>
              </div>
            </div>

            <form onSubmit={handleJoinWithCode} className="mt-6 pt-4 border-t border-border/40">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    maxLength={8}
                    placeholder="ENTER CODE"
                    value={joinCodeInput}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase().trim())}
                    className="h-11 w-full rounded-xl border border-border bg-surface px-3 pr-10 text-center sm:text-left sm:pl-3.5 text-sm sm:text-base font-black font-mono tracking-widest text-text outline-none focus:border-white/50 transition-colors uppercase placeholder:normal-case placeholder:tracking-normal placeholder:font-medium placeholder:text-text-muted/40"
                  />
                  {/* Quick Paste button from clipboard */}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText()
                        if (text) {
                          const codeMatch = text.match(/code=([A-Za-z0-9]+)/i) || text.match(/[A-Za-z0-9]{6}/)
                          const extracted = codeMatch ? (codeMatch[1] || codeMatch[0]) : text.trim()
                          setJoinCodeInput(extracted.toUpperCase().slice(0, 8))
                        }
                      } catch {
                        // ignore if clipboard permissions not granted
                      }
                    }}
                    title="Paste from clipboard"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-text-muted hover:text-white hover:bg-hover transition-colors cursor-pointer"
                  >
                    <ClipboardPaste className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={busy || !joinCodeInput.trim()}
                  className="flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white px-6 text-xs font-black text-black transition-all hover:bg-white/90 disabled:opacity-50 cursor-pointer shrink-0 shadow-sm hover:scale-[1.01] active:scale-[0.99]"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-black" />}
                  <span>Join Session</span>
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* New User Guide: 3 Easy Steps to Join */}
      {!hostRoom?.code && !joinedRoom && (
        <section className="mt-8 rounded-2xl border border-border/60 bg-surface-elevated/40 p-5 sm:p-6 backdrop-blur-sm animate-fade-in">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <h3 className="text-xs font-black uppercase tracking-wider text-text">
              How to Join as a New User • 3 Quick Steps
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div className="rounded-xl border border-border/40 bg-surface/60 p-4 transition-all hover:border-white/20">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-mono text-xs font-black">
                  1
                </span>
                <h4 className="text-xs font-bold text-text">Get Your 6-Letter Code</h4>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Ask your friend for their code (e.g. <strong className="text-text font-mono">XKFRM5</strong>), or type <span className="font-mono text-text bg-white/5 px-1 py-0.5 rounded">/invite</span> or <span className="font-mono text-text bg-white/5 px-1 py-0.5 rounded">/join</span> in Discord.
              </p>
            </div>

            <div className="rounded-xl border border-border/40 bg-surface/60 p-4 transition-all hover:border-white/20">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-amber/20 text-primary-amber font-mono text-xs font-black">
                  2
                </span>
                <h4 className="text-xs font-bold text-text">Enter Code or Click Link</h4>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Paste the code into the box above and hit <strong>Join Session</strong>, or click any direct 1-click web invite link to connect instantly.
              </p>
            </div>

            <div className="rounded-xl border border-border/40 bg-surface/60 p-4 transition-all hover:border-white/20">
              <div className="flex items-center gap-2.5 mb-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-secondary-cyan/20 text-secondary-cyan font-mono text-xs font-black">
                  3
                </span>
                <h4 className="text-xs font-bold text-text">Lossless Stereo Playback</h4>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                You're in! You will immediately hear the host's queue in real-time. Missing tracks stream in lossless quality directly in RAM.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Active Host Session Details & Live Member Roster */}
      {hostRoom?.code && (
        <section className="mt-6 rounded-2xl border border-border/60 bg-surface-elevated/80 p-5 shadow-lg backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-primary-amber">
                <Radio className="h-4 w-4 animate-pulse" />
                <span>Hosting Active Session</span>
              </div>
              <h2 className="mt-1 text-lg font-black text-text">
                {hostRoom.name}
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Share this room code with friends or in Discord so anyone can listen along in real-time!
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Code:</span>
                <span className="font-mono text-base font-black tracking-widest text-text">{hostRoom.code}</span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyCode(hostRoom.code)}
                className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-black text-black transition-all hover:bg-white/90 cursor-pointer shadow-sm"
                title="Copy Room Code"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>

              {/* Share Device Sound Toggle (When Not Already Sharing) */}
              {!isDeviceAudioSharing && (
                <button
                  type="button"
                  onClick={handleToggleDeviceAudio}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-primary-amber/40 bg-primary-amber/15 hover:bg-primary-amber/25 text-primary-amber px-3.5 py-2 text-xs font-bold transition-all cursor-pointer shadow-sm"
                  title="Broadcast all audio playing on your computer (Spotify, YouTube, games) to session listeners"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Share Device Sound</span>
                </button>
              )}
            </div>
          </div>

          {/* Live System Audio Broadcast Dashboard Card */}
          {isDeviceAudioSharing && (
            <div className="mt-4 rounded-xl border border-primary-amber/40 bg-gradient-to-r from-primary-amber/10 via-surface-elevated to-surface p-4 animate-fade-in shadow-inner">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    isDeviceAudioMuted
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      : 'bg-primary-amber/20 text-primary-amber border-primary-amber/30'
                  }`}>
                    {isDeviceAudioMuted ? <VolumeX className="h-5 w-5" /> : <Activity className="h-5 w-5 animate-pulse" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-wider text-text">
                        Broadcasting Device Sound Live
                      </span>
                      {isDeviceAudioMuted ? (
                        <span className="rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-red-300">
                          BROADCAST MUTED
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                          {deviceAudioBitrate === 320000 ? '320 kbps Studio Stereo' : deviceAudioBitrate === 192000 ? '192 kbps Balanced' : '96 kbps Saver'} (48kHz)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      All audio from your computer is streaming in real-time to {deviceAudioPeerCount} listener{deviceAudioPeerCount === 1 ? '' : 's'}.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Mute Broadcast Button */}
                  <button
                    type="button"
                    onClick={toggleDeviceAudioMute}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border cursor-pointer ${
                      isDeviceAudioMuted
                        ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                        : 'border-border/80 bg-surface hover:bg-hover text-text'
                    }`}
                    title={isDeviceAudioMuted ? 'Unmute outgoing stream' : 'Temporarily mute outgoing audio without disconnecting'}
                  >
                    {isDeviceAudioMuted ? <VolumeX className="h-3.5 w-3.5 text-amber-400" /> : <Volume2 className="h-3.5 w-3.5" />}
                    <span>{isDeviceAudioMuted ? 'Unmute Stream' : 'Mute Stream'}</span>
                  </button>

                  {/* Stop Sharing Button */}
                  <button
                    type="button"
                    onClick={handleToggleDeviceAudio}
                    className="flex items-center gap-1.5 rounded-full bg-red-500 hover:bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
                  >
                    <MicOff className="h-3.5 w-3.5" />
                    <span>Stop Sharing</span>
                  </button>
                </div>
              </div>

              {/* Bitrate Selector & VU Level Meter */}
              <div className="mt-4 pt-3 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Quality Presets */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-bold text-text-muted text-[10px] uppercase tracking-wider mr-1">Quality:</span>
                  {[
                    { label: 'Studio 320k', value: 320000, desc: 'Lossless stereo' },
                    { label: 'Balanced 192k', value: 192000, desc: 'Optimal for normal Wi-Fi' },
                    { label: 'Saver 96k', value: 96000, desc: 'Low bandwidth / mobile' }
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setDeviceAudioBitrate(preset.value)}
                      title={preset.desc}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                        deviceAudioBitrate === preset.value
                          ? 'bg-primary-amber text-black shadow-sm'
                          : 'bg-surface hover:bg-hover text-text-muted hover:text-text border border-border/40'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Real-time VU Level Meter Bar */}
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <span className="text-[10px] font-mono font-bold text-text-muted uppercase">VU</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface border border-border/60">
                    <div
                      className={`h-full rounded-full transition-all duration-75 ease-out ${
                        isDeviceAudioMuted
                          ? 'bg-text-muted/30'
                          : 'bg-gradient-to-r from-emerald-500 via-primary-amber to-red-500'
                      }`}
                      style={{ width: `${isDeviceAudioMuted ? 0 : Math.min(100, Math.max(2, deviceAudioLevel))}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-text-muted min-w-[24px]">
                    {isDeviceAudioMuted ? 'OFF' : `${Math.round(deviceAudioLevel)}%`}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Active Participants in Host Room */}
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-wider">
              <Users className="h-3.5 w-3.5 text-text-muted" />
              <span>Participants ({members.length || 1}) • Click profile to add friend</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {members.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => setSelectedMember(m)}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated pl-1.5 pr-3 py-1 text-xs font-bold text-text hover:border-white/40 hover:bg-hover transition-all cursor-pointer shadow-sm group"
                  title={`Click to view profile of ${m.displayName}`}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full overflow-hidden border border-border bg-surface text-[10px] font-black text-text">
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      m.displayName.slice(0, 1).toUpperCase()
                    )}
                  </div>
                  {m.isOnline && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Online" />
                  )}
                  {m.isHost && <Crown className="h-3 w-3 text-amber-400 shrink-0" />}
                  <span className="group-hover:text-white transition-colors">{m.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Host Room Chat panel when toggled */}
      {showHostChat && hostRoom?.id && (
        <div className="mt-6 animate-fade-in">
          <RoomChat
            roomId={hostRoom.id}
            roomName={hostRoom.name || 'Your Room Session'}
            onSelectUser={(userId, initialProfile) => {
              setSelectedMember({
                userId,
                displayName: initialProfile?.displayName || 'User',
                avatarUrl: initialProfile?.avatarUrl || null,
                isHost: userId === hostRoom.host_id
              })
            }}
          />
        </div>
      )}

      {/* Host Active Session Queue */}
      {hostRoom?.id && queue.length > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-surface-elevated/70 p-5 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-text-muted" />
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-text">
                  Your Live Session Queue
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Broadcasted live to all session listeners. Click any song to jump.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-[10px] font-medium text-text-muted border border-border/60">
              {queue.length} Tracks
            </span>
          </div>

          <div className="divide-y divide-border/20 max-h-60 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
            {queue.map((song, idx) => {
              const isCurrent = idx === currentSongIndex
              return (
                <button
                  key={`${song.id}-${idx}`}
                  type="button"
                  onClick={() => playSong(idx)}
                  className={`w-full flex items-center justify-between p-2 rounded-xl text-left transition-all group ${
                    isCurrent
                      ? 'bg-white/10 text-white font-bold shadow-sm'
                      : 'hover:bg-hover text-text-muted hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-5 text-center text-xs font-bold opacity-60">
                      {isCurrent ? (
                        <Radio className="h-3.5 w-3.5 animate-pulse text-text mx-auto" />
                      ) : (
                        idx + 1
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{song.title}</p>
                      <p className="truncate text-[10px] opacity-75">{song.artist}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] font-mono opacity-70">
                      {formatTime(song.duration || 0)}
                    </span>
                    <Play className="h-3 w-3 opacity-0 group-hover:opacity-100 text-white transition-opacity" />
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Live Friends Section */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-text flex items-center gap-2">
            <span>Friends Listening Right Now</span>
            {liveFriends.length > 0 && (
              <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border/60">
                {liveFriends.length} Active
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => void loadLiveFriends()}
            disabled={loadingFriends}
            className="flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingFriends ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {liveFriends.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {liveFriends.map(({ profile, room }) => (
              <div
                key={room.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface-elevated/70 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-white/30 hover:bg-surface-elevated"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <NavLink
                      to={`/profile/${encodeURIComponent(profile.username)}`}
                      className="flex items-center gap-3 min-w-0"
                    >
                      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-sm font-black text-text">
                        {profile.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt=""
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : (
                          profile.display_name.slice(0, 1).toUpperCase()
                        )}
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-text group-hover:text-white transition-colors">
                          {profile.display_name}
                        </p>
                        <p className="truncate text-[11px] text-text-muted">@{profile.username}</p>
                      </div>
                    </NavLink>

                    <div className="flex items-center gap-1 text-text">
                      <span className="h-2 w-0.5 animate-pulse bg-white rounded-full" />
                      <span className="h-3.5 w-0.5 animate-pulse bg-white rounded-full delay-75" />
                      <span className="h-2.5 w-0.5 animate-pulse bg-white rounded-full delay-150" />
                    </div>
                  </div>

                  {/* Song Info */}
                  <div className="mt-4 rounded-xl border border-white/5 bg-black/20 p-3">
                    <p className="truncate text-xs font-black text-white">
                      {room.song?.title || 'Music Track'}
                    </p>
                    <p className="truncate text-[11px] text-text-muted mt-0.5">
                      {room.song?.artist || 'Unknown Artist'}
                    </p>
                  </div>
                </div>

                {/* 1-Click Listen Along Button */}
                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-text-muted">
                    {formatTime(room.position_seconds)} / {formatTime(room.song?.duration || 0)}
                  </span>

                  <button
                    type="button"
                    onClick={() => void handleListenAlong(profile.id)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-black text-black transition-all hover:scale-105 hover:bg-white/90 active:scale-95 disabled:opacity-50"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    Listen Along
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-surface-elevated/30 py-8 sm:py-10 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated border border-border text-text-muted">
              <Headphones className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-sm font-bold text-text">No friends are broadcasting right now</h3>
            <p className="mt-1 max-w-sm text-xs text-text-muted leading-relaxed">
              When an online friend starts playing music or hosts a room, their live session will automatically appear here so you can tune in with 1 click.
            </p>
          </div>
        )}
      </section>

      {/* Join with Code Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleJoinWithCode}
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Join with Room Code</h3>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Enter the 6-character room code shared by your friend.
            </p>

            <div className="relative mt-4">
              <input
                type="text"
                required
                maxLength={8}
                placeholder="e.g. AB12CD"
                value={joinCodeInput}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase().trim())}
                className="h-12 w-full rounded-xl border border-border bg-surface-elevated px-3 pr-10 text-center text-lg font-black font-mono tracking-widest text-text outline-none focus:border-white/50 uppercase"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text) {
                      const codeMatch = text.match(/code=([A-Za-z0-9]+)/i) || text.match(/[A-Za-z0-9]{6}/)
                      const extracted = codeMatch ? (codeMatch[1] || codeMatch[0]) : text.trim()
                      setJoinCodeInput(extracted.toUpperCase().slice(0, 8))
                    }
                  } catch {
                    // ignore
                  }
                }}
                title="Paste from clipboard"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white cursor-pointer"
              >
                <ClipboardPaste className="h-4 w-4" />
              </button>
            </div>

            <button
              type="submit"
              disabled={busy || !joinCodeInput.trim()}
              className="mt-5 flex h-11 min-h-[44px] w-full items-center justify-center rounded-xl bg-white text-xs font-black text-black transition-all hover:bg-white/90 disabled:opacity-50 cursor-pointer shadow-sm hover:scale-[1.01] active:scale-[0.99]"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join Session'}
            </button>
          </form>
        </div>
      )}

      {/* Invite / Share Code Modal */}
      {showShareModal && hostRoom?.code && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Invite Friends</h3>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Share your room code or scan the QR code to join this session:
            </p>

            <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4">
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">Room Code</span>
              <p className="text-3xl font-black font-mono tracking-widest text-text mt-0.5">{hostRoom.code}</p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyCode(hostRoom.code)}
                className="flex h-11 min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-xs font-black text-black transition-all hover:bg-white/90 cursor-pointer shadow-sm"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied Code!' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl)
                  setCopiedLink(true)
                  setTimeout(() => setCopiedLink(false), 2500)
                }}
                className="flex h-11 min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-elevated text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-success" /> : <Link2 className="h-3.5 w-3.5" />}
                <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const discordMsg = `🎵 **Listen together with me on Felo!**\n🔑 **Room Code:** \`${hostRoom.code}\`\n🎧 **1-Click Web Join:** ${shareUrl}`
                void navigator.clipboard.writeText(discordMsg)
                setCopiedDiscord(true)
                setTimeout(() => setCopiedDiscord(false), 2500)
              }}
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border/80 bg-surface-elevated/70 text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer"
            >
              {copiedDiscord ? <Check className="h-3.5 w-3.5 text-success" /> : <MessageSquare className="h-3.5 w-3.5 text-secondary-cyan" />}
              <span>{copiedDiscord ? 'Copied Discord Invite!' : 'Copy Formatted Discord Invite'}</span>
            </button>

            {/* QR Code Section */}
            {qrDataUrl && (
              <div className="mt-4 pt-4 border-t border-border/40 flex flex-col items-center">
                <div className="rounded-2xl bg-white p-2.5 shadow-md">
                  <img src={qrDataUrl} alt="Scan QR code to join" className="h-28 w-28" />
                </div>
                <span className="mt-2 text-[11px] text-text-muted">Scan with phone camera to join</span>
              </div>
            )}
          </div>
        </div>
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
          onClose={() => setSelectedMember(null)}
        />
      )}
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
