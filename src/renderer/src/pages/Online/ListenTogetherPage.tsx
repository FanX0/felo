import { FormEvent, type ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Headphones, Loader2, LogOut, Radio, Users } from 'lucide-react'
import OnlineGate from '../../components/Online/OnlineGate'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { getSupabase } from '../../lib/supabase'
import type { ListeningRoom, SharedSong } from '../../online/types'
import type { Song } from '../Library/Library'

function makeCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function toSharedSong(song: Song): SharedSong {
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration
  }
}

function ListenTogetherWorkspace(): ReactElement {
  const { user, profile } = useOnlineStore()
  const { queue, currentSongIndex, isPlaying, currentTime } = usePlayerStore()
  const [room, setRoom] = useState<ListeningRoom | null>(null)
  const [roomName, setRoomName] = useState('Listening room')
  const [joinCode, setJoinCode] = useState('')
  const [memberCount, setMemberCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const applyingRemote = useRef(false)
  const currentSong = queue[currentSongIndex]
  const isHost = room?.host_id === user?.id

  const countMembers = useCallback(async (roomId: string): Promise<void> => {
    const { count } = await getSupabase()
      .from('listening_room_members')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId)
    setMemberCount(count || 0)
  }, [])

  const applyRemoteState = useCallback(
    async (nextRoom: ListeningRoom): Promise<void> => {
      if (!nextRoom.song || nextRoom.host_id === user?.id) return
      applyingRemote.current = true
      try {
        const state = usePlayerStore.getState()
        let targetIndex = state.queue.findIndex(
          (song) =>
            song.title.toLowerCase() === nextRoom.song!.title.toLowerCase() &&
            song.artist.toLowerCase() === nextRoom.song!.artist.toLowerCase()
        )
        let targetQueue = state.queue
        if (targetIndex < 0) {
          targetQueue = ((await window.api?.getSongs?.()) || []) as Song[]
          targetIndex = targetQueue.findIndex(
            (song) =>
              song.title.toLowerCase() === nextRoom.song!.title.toLowerCase() &&
              song.artist.toLowerCase() === nextRoom.song!.artist.toLowerCase()
          )
        }
        if (targetIndex < 0) {
          setMessage(`${nextRoom.song.title} is not in your local library.`)
          return
        }
        const selected = state.queue[state.currentSongIndex]
        if (!selected || selected.id !== targetQueue[targetIndex].id)
          usePlayerStore.getState().setQueue(targetQueue, targetIndex)
        const elapsed = nextRoom.is_playing
          ? Math.max(0, (Date.now() - new Date(nextRoom.updated_at).getTime()) / 1000)
          : 0
        const targetTime = nextRoom.position_seconds + elapsed
        if (Math.abs(usePlayerStore.getState().currentTime - targetTime) > 1.5)
          usePlayerStore.getState().seek(targetTime)
        usePlayerStore.getState().setIsPlaying(nextRoom.is_playing)
        setMessage('Synchronized with the host')
      } finally {
        window.setTimeout(() => {
          applyingRemote.current = false
        }, 400)
      }
    },
    [user?.id]
  )

  useEffect(() => {
    if (!room) return
    const countTimer = window.setTimeout(() => void countMembers(room.id), 0)
    const supabase = getSupabase()
    const channel = supabase
      .channel(`room:${room.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listening_rooms', filter: `id=eq.${room.id}` },
        (payload) => {
          const next = payload.new as ListeningRoom
          setRoom(next)
          void applyRemoteState(next)
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_room_members',
          filter: `room_id=eq.${room.id}`
        },
        () => void countMembers(room.id)
      )
      .subscribe()
    if (!isHost) void applyRemoteState(room)
    return () => {
      window.clearTimeout(countTimer)
      void supabase.removeChannel(channel)
    }
  }, [room?.id, isHost, applyRemoteState, countMembers])

  const publishState = useCallback(async (): Promise<void> => {
    if (!room || !isHost || applyingRemote.current) return
    const state = usePlayerStore.getState()
    const song = state.queue[state.currentSongIndex]
    await getSupabase()
      .from('listening_rooms')
      .update({
        song: song ? toSharedSong(song) : null,
        position_seconds: Math.round(state.currentTime),
        is_playing: state.isPlaying,
        updated_at: new Date().toISOString()
      })
      .eq('id', room.id)
  }, [room?.id, isHost])

  useEffect(() => {
    if (!isHost || !room) return
    void publishState()
    const timer = window.setInterval(() => void publishState(), 3000)
    return () => window.clearInterval(timer)
  }, [room?.id, isHost, currentSong?.id, isPlaying, publishState])

  const createRoom = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!user || !roomName.trim()) return
    setBusy(true)
    setMessage('')
    const { data, error } = await getSupabase()
      .from('listening_rooms')
      .insert({
        host_id: user.id,
        code: makeCode(),
        name: roomName.trim(),
        song: currentSong ? toSharedSong(currentSong) : null,
        position_seconds: Math.round(currentTime),
        is_playing: isPlaying
      })
      .select()
      .single()
    if (error) setMessage(error.message)
    else {
      const { error: memberError } = await getSupabase()
        .from('listening_room_members')
        .insert({ room_id: data.id, user_id: user.id })
      if (memberError) setMessage(memberError.message)
      else setRoom(data as ListeningRoom)
    }
    setBusy(false)
  }

  const joinRoom = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!user || !joinCode.trim()) return
    setBusy(true)
    setMessage('')
    const { data, error } = await getSupabase()
      .from('listening_rooms')
      .select('*')
      .eq('code', joinCode.trim().toUpperCase())
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) setMessage(error?.message || 'Active room not found')
    else {
      const { error: joinError } = await getSupabase()
        .from('listening_room_members')
        .upsert({ room_id: data.id, user_id: user.id })
      if (joinError) setMessage(joinError.message)
      else {
        setRoom(data as ListeningRoom)
        void applyRemoteState(data as ListeningRoom)
      }
    }
    setBusy(false)
  }

  const leaveRoom = async (): Promise<void> => {
    if (!room || !user) return
    if (isHost)
      await getSupabase()
        .from('listening_rooms')
        .update({ is_active: false, is_playing: false })
        .eq('id', room.id)
    await getSupabase()
      .from('listening_room_members')
      .delete()
      .eq('room_id', room.id)
      .eq('user_id', user.id)
    setRoom(null)
    setMessage('')
  }

  if (room)
    return (
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-7">
        <header className="flex items-start justify-between border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-success">
              <Radio className="h-4 w-4" />
              Live session
            </div>
            <h1 className="mt-2 text-3xl font-bold text-text">{room.name}</h1>
            <p className="mt-1 text-sm text-text-muted">
              Hosted by {isHost ? 'you' : profile?.display_name || 'a listener'}
            </p>
          </div>
          <button
            onClick={() => void leaveRoom()}
            className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-bold text-text-muted hover:bg-hover hover:text-text"
          >
            <LogOut className="h-4 w-4" />
            Leave
          </button>
        </header>
        <div className="grid flex-1 place-items-center">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-surface-elevated">
              <Headphones className="h-11 w-11 text-success" />
            </div>
            <h2 className="mt-6 truncate text-2xl font-bold text-text">
              {room.song?.title || 'Waiting for music'}
            </h2>
            <p className="mt-1 truncate text-text-muted">
              {room.song?.artist ||
                (isHost ? 'Start playing a local song' : 'The host has not started yet')}
            </p>
            <div className="mt-7 flex items-center justify-center gap-3">
              <button
                onClick={() => void navigator.clipboard.writeText(room.code)}
                className="flex items-center gap-3 rounded-full border border-border bg-canvas px-5 py-3 text-text hover:bg-hover"
              >
                <span className="font-mono text-lg font-bold tracking-[0.2em]">{room.code}</span>
                <Copy className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 rounded-full bg-surface-elevated px-4 py-3 text-sm text-text-muted">
                <Users className="h-4 w-4" />
                {memberCount}
              </div>
            </div>
            <p className="mt-5 text-sm text-text-muted">
              {isHost
                ? 'Your playback controls everyone in this room.'
                : 'Playback follows the host automatically.'}
            </p>
            {message && <p className="mt-3 text-xs text-success">{message}</p>}
          </div>
        </div>
      </div>
    )

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text">Listen together</h1>
        <p className="mt-2 text-sm text-text-muted">
          Share a room code and keep everyone on the same song and position.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <form onSubmit={createRoom} className="rounded-md border border-border bg-canvas p-6">
          <Radio className="h-6 w-6 text-success" />
          <h2 className="mt-4 text-lg font-bold text-text">Host a room</h2>
          <p className="mt-1 text-sm text-text-muted">
            Your player becomes the session controller.
          </p>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="mt-5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-success"
          />
          <button
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-text py-2.5 text-sm font-bold text-canvas disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Create room
          </button>
        </form>
        <form onSubmit={joinRoom} className="rounded-md border border-border bg-canvas p-6">
          <Users className="h-6 w-6 text-text-muted" />
          <h2 className="mt-4 text-lg font-bold text-text">Join a room</h2>
          <p className="mt-1 text-sm text-text-muted">
            Enter the six-character code from the host.
          </p>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC123"
            className="mt-5 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-center font-mono text-lg font-bold tracking-[0.2em] outline-none focus:border-success"
          />
          <button
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-border py-2.5 text-sm font-bold text-text hover:bg-hover disabled:opacity-50"
          >
            Join room
          </button>
        </form>
      </div>
      {message && <p className="mt-4 text-sm text-danger">{message}</p>}
    </div>
  )
}

export default function ListenTogetherPage(): ReactElement {
  return (
    <OnlineGate>
      <ListenTogetherWorkspace />
    </OnlineGate>
  )
}
