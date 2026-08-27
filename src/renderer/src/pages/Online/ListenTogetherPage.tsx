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
  X
} from 'lucide-react'
import { useSearchParams, NavLink } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useRoomChatStore } from '../../hooks/useRoomChatStore'
import RoomChat from '../../components/RoomChat/RoomChat'
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
  const { isPlaying, currentTime, queue, currentSongIndex, playSong } = usePlayerStore()

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
  const handleHostSongChange = useListeningStore((state) => state.handleHostSongChange)
  const handleHostPauseResume = useListeningStore((state) => state.handleHostPauseResume)
  const handleHostDisconnect = useListeningStore((state) => state.handleHostDisconnect)
  const refreshMemberCount = useListeningStore((state) => state.refreshMemberCount)

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
  const [liveFriends, setLiveFriends] = useState<LiveFriendSession[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)

  const directJoinAttempt = useRef<string | null>(null)

  const activeSubstitute = joinedRoom?.song ? substitutes[getSongKey(joinedRoom.song)] : undefined

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
        setTimeout(() => setMessage(''), 3000)
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : 'Could not join session.')
      })
      .finally(() => setBusy(false))
  }, [searchParams, user?.id, joinRoomById])

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

  // 4. Fetch room member profiles when in a joined room
  const loadMembers = useCallback(async () => {
    if (!joinedRoom) return
    try {
      const supabase = getSupabase()
      const { data: memberRows } = await supabase
        .from('listening_room_members')
        .select('user_id')
        .eq('room_id', joinedRoom.id)

      if (!memberRows || memberRows.length === 0) {
        setMembers([])
        return
      }

      const userIds = memberRows.map((r) => r.user_id)
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)

      const memberList: RoomMemberInfo[] = (profileRows || []).map((p) => ({
        userId: p.id,
        displayName: p.display_name || 'User',
        avatarUrl: p.avatar_url,
        isHost: p.id === joinedRoom.host_id
      }))

      setMembers(memberList)
    } catch {
      // ignore
    }
  }, [joinedRoom?.id, joinedRoom?.host_id])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers, memberCount])

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
      .channel(`room-realtime:${joinedRoom.id}`)
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

          useListeningStore.getState().setJoinedRoom(next)
          const songChanged =
            next.song?.title !== joinedRoom.song?.title ||
            next.song?.artist !== joinedRoom.song?.artist ||
            next.song?.localId !== joinedRoom.song?.localId

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
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [joinedRoom?.id, handleHostSongChange, handleHostPauseResume, handleHostDisconnect, refreshMemberCount, loadMembers, loadMessages, addIncoming])

  // 6b. Real-time chat subscription for active host room
  useEffect(() => {
    if (!hostRoom?.id || joinedRoom) return
    const supabase = getSupabase()

    void loadMessages(hostRoom.id)

    const channel = supabase
      .channel(`host-chat:${hostRoom.id}`)
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
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hostRoom?.id, joinedRoom, loadMessages, addIncoming])

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
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-7 overflow-y-auto pb-24 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Active Header */}
        <header className="flex items-center justify-between border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-success">
              <Radio className="h-4 w-4 animate-pulse" />
              Listening Along Live
            </div>
            <h1 className="mt-1.5 text-3xl font-extrabold text-text tracking-tight">
              {joinedRoom.name}
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              Synchronized in real-time with <strong className="text-text">{hostName}</strong>.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto-download toggle */}
            <button
              type="button"
              onClick={() => setAutoDownloadMissing(!autoDownloadMissing)}
              title="Automatically download missing tracks in background"
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border ${
                autoDownloadMissing
                  ? 'border-success/40 bg-success/15 text-success'
                  : 'border-border bg-surface-elevated text-text-muted hover:text-text'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Auto-Download {autoDownloadMissing ? 'ON' : 'OFF'}</span>
            </button>

            {/* Leave / Stop Syncing button */}
            <button
              type="button"
              onClick={handleLeaveSession}
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-danger/15 border border-danger/30 hover:bg-danger hover:text-white px-4 py-2 text-xs font-bold text-danger transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Stop Listening Along
            </button>
          </div>
        </header>

        {/* Missing Song Alert Banner */}
        {syncStatus === 'missing_song' && missingSong && !activeSubstitute && (
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
              <Headphones className={`h-12 w-12 text-success ${isPlaying ? 'animate-bounce' : ''}`} />
              {isPlaying && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-success"></span>
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
                  className="h-full rounded-full bg-success transition-all duration-300 ease-linear"
                  style={{ width: `${songProgress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs font-bold text-text-muted">
                <span>{formatTime(currentTime)}</span>
                <span className="flex items-center gap-1 text-[11px] text-success">
                  <Radio className="h-3 w-3" /> Live Sync
                </span>
                <span>{formatTime(songDuration)}</span>
              </div>
            </div>

            {/* Members in session */}
            <div className="mt-8 flex flex-col items-center justify-center gap-3">
              <p className="text-xs font-bold text-text-muted uppercase tracking-wider">
                Listening with ({members.length || 1})
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3 py-1 text-xs font-bold text-text"
                  >
                    {m.isHost && <Crown className="h-3 w-3 text-amber-400" />}
                    <span>{m.displayName}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Session Queue from Host */}
            {joinedRoom.queue && joinedRoom.queue.length > 0 && (
              <div className="mt-8 w-full text-left rounded-2xl border border-border/80 bg-surface-elevated/50 p-5 shadow-lg backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-success" />
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
                            ? 'bg-success/15 text-success font-bold'
                            : 'text-text-muted hover:text-text'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-5 text-center text-[10px] font-bold opacity-60">
                            {isNowPlaying ? (
                              <Radio className="h-3 w-3 animate-pulse text-success mx-auto" />
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
              <RoomChat roomId={joinedRoom.id} roomName={joinedRoom.name} />
            </div>
          </div>
        </div>

        {/* Replace Modal */}
        {showReplaceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
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
                  className="rounded-full p-1 text-text-muted hover:bg-hover hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search your library..."
                  value={replaceSearchQuery}
                  onChange={(e) => setReplaceSearchQuery(e.target.value)}
                  className="w-full rounded-full border border-border bg-surface-elevated py-2 pl-9 pr-4 text-xs font-medium text-text placeholder-text-muted focus:border-success focus:outline-none"
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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-7 overflow-y-auto pb-24 select-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-success">
            <Radio className="h-4 w-4 animate-pulse" />
            Spotify-Style Live Sessions
          </div>
          <h1 className="mt-1.5 text-3xl font-extrabold text-text tracking-tight">
            Listen Together
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            Listen along with your friends in real-time with instant auto-sync.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowJoinModal(true)}
            className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover hover:border-text-muted transition-all"
          >
            <Users className="h-3.5 w-3.5" />
            Join with Code
          </button>

          {hostRoom?.code && (
            <>
              <button
                type="button"
                onClick={() => setShowHostChat((prev) => !prev)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold transition-all ${
                  showHostChat
                    ? 'border-success bg-success/20 text-success'
                    : 'border-border bg-surface-elevated text-text hover:bg-hover'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Host Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-2 rounded-full bg-success px-4 py-2 text-xs font-black text-black transition-all hover:bg-success/90"
              >
                <Copy className="h-3.5 w-3.5" />
                Invite Friends
              </button>
            </>
          )}
        </div>
      </header>

      {message && (
        <div className="mt-4 rounded-xl border border-success/30 bg-success/10 p-3 text-xs font-bold text-success text-center">
          {message}
        </div>
      )}

      {/* Host Room Chat panel when toggled */}
      {showHostChat && hostRoom?.id && (
        <div className="mt-6 animate-fade-in">
          <RoomChat roomId={hostRoom.id} roomName={hostRoom.name || 'Your Room Session'} />
        </div>
      )}

      {/* Host Active Session Queue */}
      {hostRoom?.id && queue.length > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-surface-elevated/70 p-5 shadow-lg backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-success" />
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-text">
                  Your Live Session Queue
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Broadcasted live to all session listeners. Click any song to jump.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-black text-success border border-success/30">
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
                      ? 'bg-success/20 text-success font-bold shadow-sm'
                      : 'hover:bg-hover text-text-muted hover:text-text'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="w-5 text-center text-xs font-bold opacity-60">
                      {isCurrent ? (
                        <Radio className="h-3.5 w-3.5 animate-pulse text-success mx-auto" />
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
                    <Play className="h-3 w-3 opacity-0 group-hover:opacity-100 text-success transition-opacity" />
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
              <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-black text-success">
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
                className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface-elevated/70 p-5 shadow-lg backdrop-blur-sm transition-all hover:border-success/40 hover:bg-surface-elevated"
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
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-success" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-text group-hover:text-success transition-colors">
                          {profile.display_name}
                        </p>
                        <p className="truncate text-[11px] text-text-muted">@{profile.username}</p>
                      </div>
                    </NavLink>

                    <div className="flex items-center gap-1 text-success">
                      <span className="h-2 w-0.5 animate-pulse bg-success rounded-full" />
                      <span className="h-3.5 w-0.5 animate-pulse bg-success rounded-full delay-75" />
                      <span className="h-2.5 w-0.5 animate-pulse bg-success rounded-full delay-150" />
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
                    className="flex items-center gap-1.5 rounded-full bg-success px-4 py-1.5 text-xs font-black text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-50 shadow-md shadow-success/20"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    Listen Along
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-elevated/30 py-12 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-elevated text-text-muted">
              <Headphones className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-sm font-bold text-text">No friends are listening right now</h3>
            <p className="mt-1 max-w-sm text-xs text-text-muted">
              When an online friend starts playing music, their live session will automatically appear here so you can tune in with 1 click.
            </p>
          </div>
        )}
      </section>

      {/* Join with Code Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleJoinWithCode}
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Join with Room Code</h3>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="rounded-full p-1 text-text-muted hover:bg-hover hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Enter the 6-character room code shared by your friend.
            </p>

            <input
              type="text"
              required
              maxLength={8}
              placeholder="e.g. AB12CD"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              className="mt-4 h-11 w-full rounded-xl border border-border bg-surface-elevated px-3 text-center text-lg font-black tracking-widest text-text outline-none focus:border-success"
            />

            <button
              type="submit"
              disabled={busy || !joinCodeInput.trim()}
              className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-success text-xs font-black text-black transition-all hover:brightness-110 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join Session'}
            </button>
          </form>
        </div>
      )}

      {/* Invite / Share Code Modal */}
      {showShareModal && hostRoom?.code && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl text-center">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">Invite Friends</h3>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="rounded-full p-1 text-text-muted hover:bg-hover hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Share your room code with friends so they can join your live session:
            </p>

            <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4">
              <p className="text-3xl font-black tracking-widest text-success">{hostRoom.code}</p>
            </div>

            <button
              type="button"
              onClick={() => handleCopyCode(hostRoom.code)}
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-success text-xs font-black text-black transition-all hover:brightness-110"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied Code!' : 'Copy Room Code'}
            </button>
          </div>
        </div>
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
