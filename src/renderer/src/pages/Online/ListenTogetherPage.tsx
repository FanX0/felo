import { FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Crown,
  Download,
  Headphones,
  Loader2,
  LogOut,
  Music2,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  X
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
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
  const { queue, currentSongIndex, isPlaying, currentTime } = usePlayerStore()

  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const memberCount = useListeningStore((state) => state.memberCount)
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const missingSong = useListeningStore((state) => state.missingSong)
  const autoDownloadMissing = useListeningStore((state) => state.autoDownloadMissing)
  const substitutes = useListeningStore((state) => state.substitutes)

  const setAutoDownloadMissing = useListeningStore((state) => state.setAutoDownloadMissing)
  const setSubstituteSong = useListeningStore((state) => state.setSubstituteSong)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const joinRoomById = useListeningStore((state) => state.joinRoomById)
  const joinRoomByCode = useListeningStore((state) => state.joinRoomByCode)
  const leaveJoinedRoom = useListeningStore((state) => state.leaveJoinedRoom)
  const handleHostSongChange = useListeningStore((state) => state.handleHostSongChange)
  const handleHostPauseResume = useListeningStore((state) => state.handleHostPauseResume)
  const handleHostDisconnect = useListeningStore((state) => state.handleHostDisconnect)
  const transferHost = useListeningStore((state) => state.transferHost)
  const refreshMemberCount = useListeningStore((state) => state.refreshMemberCount)

  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [showReplaceModal, setShowReplaceModal] = useState(false)
  const [replaceSearchQuery, setReplaceSearchQuery] = useState('')
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [hostName, setHostName] = useState('Friend')
  const [members, setMembers] = useState<RoomMemberInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [isTransferring, setIsTransferring] = useState<string | null>(null)

  const directJoinAttempt = useRef<string | null>(null)

  const activeRoom: ListeningRoom | null = joinedRoom || hostRoom
  const isHost = Boolean(activeRoom && activeRoom.host_id === user?.id)
  const currentSong = queue[currentSongIndex]

  const activeHostSongKey = getSongKey(activeRoom?.song)
  const activeSubstitute = substitutes[activeHostSongKey]

  // 1. Ensure host room exists immediately if not in someone else's room
  useEffect(() => {
    if (!user) return
    if (!joinedRoom && !hostRoom) {
      void ensureHostRoom(true)
    }
  }, [user?.id, joinedRoom, hostRoom, ensureHostRoom])

  // 2. Handle ?room=... direct join link
  useEffect(() => {
    const requestedRoomId = searchParams.get('room')
    if (!user || !requestedRoomId || directJoinAttempt.current === requestedRoomId) return
    directJoinAttempt.current = requestedRoomId
    setBusy(true)
    setMessage('Connecting to friend session...')

    void joinRoomById(requestedRoomId)
      .then((room) => {
        setMessage(`Joined ${room.name}!`)
        setTimeout(() => setMessage(''), 3000)
      })
      .catch((err) => {
        setMessage(err instanceof Error ? err.message : 'Could not join session.')
      })
      .finally(() => setBusy(false))
  }, [searchParams, user?.id, joinRoomById])

  // 3. Load host display name
  useEffect(() => {
    if (!activeRoom || isHost) return
    void getSupabase()
      .from('profiles')
      .select('display_name')
      .eq('id', activeRoom.host_id)
      .maybeSingle()
      .then(({ data }) => setHostName(data?.display_name || 'Friend'))
  }, [activeRoom?.host_id, isHost])

  // 4. Load full library for replace modal
  useEffect(() => {
    if (showReplaceModal) {
      window.api?.getSongs?.().then((songs) => {
        setLibrarySongs((songs || []) as Song[])
      }).catch(console.error)
    }
  }, [showReplaceModal])

  // 5. Fetch room member profiles
  const loadMembers = useCallback(async () => {
    if (!activeRoom) return
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
        .select('id, display_name, avatar_url')
        .in('id', userIds)

      const memberList: RoomMemberInfo[] = (profileRows || []).map((p) => ({
        userId: p.id,
        displayName: p.display_name || 'User',
        avatarUrl: p.avatar_url,
        isHost: p.id === activeRoom.host_id
      }))

      setMembers(memberList)
    } catch {
      // ignore
    }
  }, [activeRoom?.id, activeRoom?.host_id])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers, memberCount])

  // 6. Real-time Postgres Subscription (Rooms + Members)
  useEffect(() => {
    if (!activeRoom) return
    const supabase = getSupabase()

    const channel = supabase
      .channel(`room-realtime:${activeRoom.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listening_rooms', filter: `id=eq.${activeRoom.id}` },
        (payload) => {
          const next = payload.new as ListeningRoom

          if (!next.is_active) {
            if (!isHost) {
              setMessage('Host ended the session.')
              void handleHostDisconnect()
            }
            return
          }

          if (isHost) {
            useListeningStore.getState().setHostRoom(next)
          } else {
            useListeningStore.getState().setJoinedRoom(next)

            const songChanged =
              next.song?.title !== activeRoom.song?.title ||
              next.song?.artist !== activeRoom.song?.artist ||
              next.song?.localId !== activeRoom.song?.localId

            if (songChanged) {
              void handleHostSongChange(next)
            } else {
              handleHostPauseResume(next)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'listening_rooms', filter: `id=eq.${activeRoom.id}` },
        () => {
          if (!isHost) {
            setMessage('Host closed the listening room.')
            void handleHostDisconnect()
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_room_members', filter: `room_id=eq.${activeRoom.id}` },
        () => {
          void refreshMemberCount(activeRoom.id)
          void loadMembers()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeRoom?.id, isHost, handleHostSongChange, handleHostPauseResume, handleHostDisconnect, refreshMemberCount, loadMembers])

  // 7. Auto-retry song matching when user downloads a track
  useEffect(() => {
    const handleLibraryUpdated = () => {
      if (!isHost && activeRoom && activeRoom.song) {
        void handleHostSongChange(activeRoom)
      }
    }

    window.addEventListener('felo:library-updated', handleLibraryUpdated)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdated)
    return () => {
      window.removeEventListener('felo:library-updated', handleLibraryUpdated)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdated)
    }
  }, [isHost, activeRoom, handleHostSongChange])

  // Handlers
  const handleCopyCode = async () => {
    if (!activeRoom?.code) return
    try {
      await navigator.clipboard.writeText(activeRoom.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
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
      setMessage(err?.message || 'Failed to join room.')
    } finally {
      setBusy(false)
    }
  }

  const handleLeaveSession = async () => {
    setBusy(true)
    try {
      await leaveJoinedRoom()
      setSearchParams({})
      setMessage('Returned to your own listening room.')
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Error leaving room.')
    } finally {
      setBusy(false)
    }
  }

  const handleTransferHost = async (targetUserId: string, targetName: string) => {
    if (!confirm(`Make ${targetName} the host? Their local player will broadcast to everyone.`)) return
    setIsTransferring(targetUserId)
    try {
      await transferHost(targetUserId)
      setMessage(`Transferred hosting to ${targetName}!`)
      setTimeout(() => setMessage(''), 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Failed to transfer hosting.')
    } finally {
      setIsTransferring(null)
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
      isOnline: true
    })
  }

  const handleSelectSubstitute = (song: Song) => {
    if (!activeRoom?.song) return
    setSubstituteSong(activeRoom.song, song)
    setShowReplaceModal(false)
    setMessage(`Replaced with "${song.title}"!`)
    setTimeout(() => setMessage(''), 3000)
  }

  const handleResetSubstitute = () => {
    if (!activeRoom?.song) return
    setSubstituteSong(activeRoom.song, null)
    setMessage('Reset to host song.')
    setTimeout(() => setMessage(''), 3000)
  }

  const filteredLibrary = librarySongs.filter((song) => {
    if (!replaceSearchQuery.trim()) return true
    const q = replaceSearchQuery.toLowerCase()
    return song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q)
  })

  if (busy && searchParams.get('room') && !activeRoom) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
        <Loader2 className="h-7 w-7 animate-spin text-success" />
        <p className="text-sm font-bold">Connecting to your friend's room...</p>
      </div>
    )
  }

  if (!activeRoom) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-muted">
        <Loader2 className="h-7 w-7 animate-spin text-success" />
        <p className="text-sm font-bold">Preparing your listening session...</p>
      </div>
    )
  }

  const displaySong = isHost ? currentSong : (activeSubstitute || activeRoom.song)
  const songDuration = displaySong?.duration || 0
  const songProgress = songDuration > 0 ? Math.min(100, (currentTime / songDuration) * 100) : 0

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-7 overflow-y-auto pb-24 select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-success">
            <Radio className="h-4 w-4 animate-pulse" />
            {isHost ? 'Your Instant Host Room' : 'Connected to Friend'}
          </div>
          <h1 className="mt-1.5 text-3xl font-extrabold text-text tracking-tight">
            {activeRoom.name}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            {isHost
              ? 'Your room is automatically live and ready for friends to join.'
              : `Synchronized live with ${hostName}.`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-download toggle for listener */}
          {!isHost && (
            <button
              type="button"
              onClick={() => setAutoDownloadMissing(!autoDownloadMissing)}
              title="Automatically download missing tracks in background"
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all border ${
                autoDownloadMissing
                  ? 'border-success/40 bg-success/15 text-success'
                  : 'border-border bg-surface-elevated text-text-muted hover:text-text'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Auto-Download {autoDownloadMissing ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {isHost ? (
            <button
              type="button"
              onClick={() => setShowJoinModal(true)}
              className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover hover:border-text-muted transition-all"
            >
              <Users className="h-3.5 w-3.5" />
              Join Friend's Room
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLeaveSession}
              disabled={busy}
              className="flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 hover:bg-danger px-4 py-2 text-xs font-bold text-danger hover:text-white transition-all disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Leave Friend Room
            </button>
          )}
        </div>
      </header>

      {/* Missing Song Alert Banner (For Listeners) */}
      {!isHost && syncStatus === 'missing_song' && missingSong && !activeSubstitute && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 animate-fade-in shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">
                "{missingSong.title}" is not in your local library
              </p>
              <p className="text-xs text-amber-200/70 mt-0.5">
                {autoDownloadMissing
                  ? 'Auto-downloading track in background... Or you can select a local replacement below.'
                  : 'Download the track or choose a local replacement from your library to keep listening.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowReplaceModal(true)}
              className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 px-3.5 py-2 text-xs font-bold text-white transition-all shadow-md"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Replace Song</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadMissingSong}
              className="flex items-center gap-1.5 rounded-full bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-black text-black transition-all hover:scale-105 active:scale-95 shadow-md"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>
      )}

      {/* Active Substitute Song Banner */}
      {!isHost && activeSubstitute && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-secondary-cyan/40 bg-secondary-cyan/10 p-4 animate-fade-in shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary-cyan/20 text-secondary-cyan">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">
                Playing your local replacement: <strong className="text-secondary-cyan">"{activeSubstitute.title}"</strong>
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Host track: "{activeRoom?.song?.title}" by {activeRoom?.song?.artist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReplaceModal(true)}
              className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-all"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleResetSubstitute}
              className="rounded-full bg-danger/20 hover:bg-danger text-danger hover:text-white px-3 py-1.5 text-xs font-bold transition-all"
            >
              Reset to Host Track
            </button>
          </div>
        </div>
      )}

      {/* Main Room Card */}
      <div className="py-6 flex flex-col items-center">
        <div className="w-full max-w-lg text-center">
          {/* Animated Avatar / Headphones Icon */}
          <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-tr from-surface-elevated to-surface border border-border shadow-xl shadow-black/40">
            <Headphones className={`h-12 w-12 text-success ${isPlaying ? 'animate-bounce' : ''}`} />
            {isPlaying && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-success"></span>
              </span>
            )}
          </div>

          {/* Sync Status Badge (For Listeners) */}
          {!isHost && (
            <div className="mt-4 flex justify-center gap-2">
              {syncStatus === 'synced' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 border border-success/30 px-3 py-1 text-xs font-bold text-success">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  {activeSubstitute ? 'Synced (Custom Replacement)' : 'Synchronized with Host'}
                </span>
              )}
              {syncStatus === 'missing_song' && !activeSubstitute && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-bold text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Track Missing in Local Library
                </span>
              )}
              {syncStatus === 'buffering' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 border border-blue-500/30 px-3 py-1 text-xs font-bold text-blue-400">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Catching up with Host...
                </span>
              )}
            </div>
          )}

          {/* Current Song Display */}
          <div className="mt-5">
            <h2 className="truncate text-2xl font-black text-text">
              {isHost
                ? currentSong?.title || 'No song currently playing'
                : displaySong?.title || 'Waiting for host track...'}
            </h2>
            <p className="mt-1 truncate text-sm font-semibold text-text-muted">
              {isHost
                ? currentSong?.artist || 'Play any local song to broadcast live'
                : displaySong?.artist || 'Host is setting up music'}
            </p>

            {/* Playback progress bar */}
            {displaySong && (
              <div className="mt-4 flex items-center gap-3 px-6">
                <span className="text-[11px] font-bold tabular-nums text-text-muted">
                  {formatTime(currentTime)}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-success transition-all duration-300"
                    style={{ width: `${songProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-bold tabular-nums text-text-muted">
                  {formatTime(songDuration)}
                </span>
              </div>
            )}
          </div>

          {/* Replace Song quick trigger for listeners */}
          {!isHost && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowReplaceModal(true)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text-muted hover:text-text hover:bg-hover transition-colors"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>{activeSubstitute ? 'Change local replacement' : 'Replace with different local song'}</span>
              </button>
            </div>
          )}

          {/* Room Code & Listeners Badge */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleCopyCode}
              title="Click to copy room code"
              className="group flex items-center gap-3 rounded-full border border-border bg-canvas/80 px-5 py-3 text-text hover:border-success/60 hover:bg-hover transition-all"
            >
              <span className="text-xs uppercase font-bold text-text-muted group-hover:text-text">
                Code:
              </span>
              <span className="font-mono text-xl font-black tracking-[0.25em] text-success">
                {activeRoom.code}
              </span>
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4 text-text-muted group-hover:text-text" />
              )}
            </button>

            <div
              className="flex items-center gap-2 rounded-full bg-surface-elevated border border-border px-4 py-3 text-sm font-bold text-text"
              title="Current connected members"
            >
              <Users className="h-4 w-4 text-secondary-cyan" />
              <span>{memberCount}</span>
            </div>
          </div>

          {copied && (
            <p className="mt-2 text-xs font-bold text-success animate-fade-in">
              Room code copied to clipboard!
            </p>
          )}

          {/* Leave Session Action Button (For Listeners) */}
          {!isHost && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={handleLeaveSession}
                disabled={busy}
                className="flex items-center gap-2 rounded-full border border-danger/40 bg-danger/10 hover:bg-danger px-6 py-2.5 text-xs font-bold text-danger hover:text-white transition-all shadow-md active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                <span>Leave Session & Return to My Room</span>
              </button>
            </div>
          )}

          {message && <p className="mt-4 text-xs font-bold text-primary-amber">{message}</p>}
        </div>

        {/* Connected Listeners List (With Host Transfer Option) */}
        <div className="mt-10 w-full max-w-lg rounded-xl border border-border bg-surface-elevated p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm font-bold text-text">
              <Users className="h-4 w-4 text-success" />
              <span>Connected Listeners ({members.length})</span>
            </div>
            <button
              type="button"
              onClick={() => void loadMembers()}
              title="Refresh member list"
              className="p-1 rounded-full text-text-muted hover:text-text hover:bg-hover transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white font-bold text-[11px] overflow-hidden">
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      member.displayName.slice(0, 1).toUpperCase()
                    )}
                  </div>
                  <span className="font-semibold text-text">
                    {member.displayName}
                    {member.userId === user?.id ? ' (You)' : ''}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {member.isHost ? (
                    <span className="flex items-center gap-1 rounded-full bg-primary-amber/20 border border-primary-amber/40 px-2.5 py-0.5 font-bold text-primary-amber text-[10px]">
                      <Crown className="h-3 w-3" /> Host
                    </span>
                  ) : isHost ? (
                    <button
                      type="button"
                      onClick={() => handleTransferHost(member.userId, member.displayName)}
                      disabled={isTransferring === member.userId}
                      className="flex items-center gap-1 rounded-full bg-white/10 hover:bg-success hover:text-black px-2.5 py-0.5 text-[10px] font-bold text-text-muted transition-all"
                    >
                      {isTransferring === member.userId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Crown className="h-3 w-3" />
                      )}
                      <span>Make Host</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Replace / Substitute Local Song Modal */}
      {showReplaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-canvas p-6 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h2 className="text-lg font-bold text-text">Choose Local Replacement</h2>
                <p className="text-xs text-text-muted mt-0.5">
                  Pick a song from your library to play while synchronized to the host
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReplaceModal(false)}
                className="rounded-full p-1 text-text-muted hover:text-text"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-text-muted" />
              <input
                type="text"
                value={replaceSearchQuery}
                onChange={(e) => setReplaceSearchQuery(e.target.value)}
                placeholder="Search local songs..."
                autoFocus
                className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-sm text-text outline-none focus:border-success"
              />
            </div>

            <div className="mt-4 flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredLibrary.slice(0, 50).map((song) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => handleSelectSubstitute(song)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-surface hover:bg-hover text-left transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-text truncate group-hover:text-success">
                      {song.title}
                    </p>
                    <p className="text-xs text-text-muted truncate">
                      {song.artist} {song.album ? `• ${song.album}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-text-muted ml-3">
                    {formatTime(song.duration)}
                  </span>
                </button>
              ))}

              {filteredLibrary.length === 0 && (
                <div className="text-center py-8 text-text-muted text-xs">
                  No local songs found matching "{replaceSearchQuery}".
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Join Friend Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-canvas p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-lg font-bold text-text">Join a Friend's Session</h2>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="rounded-full p-1 text-text-muted hover:text-text"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleJoinWithCode} className="mt-4 space-y-4">
              <p className="text-xs text-text-muted">
                Enter your friend's 6-character room code. You'll pause hosting and follow their playback.
              </p>
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="ABC123"
                autoFocus
                className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-center font-mono text-2xl font-extrabold tracking-[0.3em] text-success outline-none focus:border-success"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="rounded-full border border-border px-5 py-2 text-xs font-bold text-text hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!joinCodeInput.trim() || busy}
                  className="flex items-center gap-2 rounded-full bg-success px-6 py-2 text-xs font-black text-black hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join Session'}
                </button>
              </div>
            </form>
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
