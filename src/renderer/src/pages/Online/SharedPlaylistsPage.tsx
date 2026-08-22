import { FormEvent, type ReactElement, useEffect, useState } from 'react'
import { ListMusic, Loader2, Music2, Play, Plus, UserPlus } from 'lucide-react'
import OnlineGate from '../../components/Online/OnlineGate'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { getSupabase } from '../../lib/supabase'
import type { SharedPlaylist, SharedPlaylistItem, SharedSong } from '../../online/types'
import type { Song } from '../Library/Library'

function asSharedSong(song: Song): SharedSong {
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration
  }
}

function SharedPlaylistsWorkspace(): ReactElement {
  const { user } = useOnlineStore()
  const { queue, currentSongIndex, setQueue } = usePlayerStore()
  const currentSong = queue[currentSongIndex]
  const [playlists, setPlaylists] = useState<SharedPlaylist[]>([])
  const [active, setActive] = useState<SharedPlaylist | null>(null)
  const [items, setItems] = useState<SharedPlaylistItem[]>([])
  const [newName, setNewName] = useState('')
  const [inviteUsername, setInviteUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadPlaylists = async (): Promise<void> => {
    const { data, error } = await getSupabase()
      .from('shared_playlists')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    const rows = (data || []) as SharedPlaylist[]
    setPlaylists(rows)
    setActive((current) => current || rows[0] || null)
  }

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => {
      void loadPlaylists().catch((error) => setMessage(error.message))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user?.id])

  useEffect(() => {
    if (!active) {
      return
    }
    const supabase = getSupabase()
    const loadItems = (): void =>
      void supabase
        .from('shared_playlist_items')
        .select('*')
        .eq('playlist_id', active.id)
        .order('position')
        .then(({ data, error }) =>
          error ? setMessage(error.message) : setItems((data || []) as SharedPlaylistItem[])
        )
    loadItems()
    const channel = supabase
      .channel(`playlist:${active.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shared_playlist_items',
          filter: `playlist_id=eq.${active.id}`
        },
        loadItems
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [active?.id])

  const createPlaylist = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!user || !newName.trim()) return
    setBusy(true)
    setMessage('')
    const { data, error } = await getSupabase()
      .from('shared_playlists')
      .insert({ owner_id: user.id, name: newName.trim() })
      .select()
      .single()
    if (!error) {
      const { error: memberError } = await getSupabase()
        .from('shared_playlist_members')
        .insert({ playlist_id: data.id, user_id: user.id, role: 'owner' })
      if (memberError) setMessage(memberError.message)
      else {
        setNewName('')
        await loadPlaylists()
        setActive(data as SharedPlaylist)
      }
    } else setMessage(error.message)
    setBusy(false)
  }

  const invite = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!active || !inviteUsername.trim()) return
    setMessage('')
    const { data: person, error } = await getSupabase()
      .from('profiles')
      .select('id, display_name')
      .eq('username', inviteUsername.trim().toLowerCase())
      .maybeSingle()
    if (error || !person) return setMessage(error?.message || 'Username not found')
    const { error: inviteError } = await getSupabase()
      .from('shared_playlist_members')
      .upsert({ playlist_id: active.id, user_id: person.id, role: 'editor' })
    if (inviteError) setMessage(inviteError.message)
    else {
      setInviteUsername('')
      setMessage(`${person.display_name} can now edit this playlist`)
    }
  }

  const addCurrentSong = async (): Promise<void> => {
    if (!active || !user || !currentSong) return
    const { error } = await getSupabase()
      .from('shared_playlist_items')
      .insert({
        playlist_id: active.id,
        added_by: user.id,
        song: asSharedSong(currentSong),
        position: items.length
      })
    setMessage(error?.message || 'Song added')
  }

  const playItem = async (item: SharedPlaylistItem): Promise<void> => {
    const songs = (await window.api?.getSongs?.()) as Song[] | undefined
    const match = songs?.find(
      (song) =>
        song.title.toLowerCase() === item.song.title.toLowerCase() &&
        song.artist.toLowerCase() === item.song.artist.toLowerCase()
    )
    if (match && songs) setQueue(songs, songs.indexOf(match))
    else setMessage('This song is not in your local library.')
  }

  return (
    <div className="grid h-full grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-r border-border bg-canvas/50 p-4">
        <h1 className="text-xl font-bold text-text">Together playlists</h1>
        <form onSubmit={createPlaylist} className="mt-4 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New playlist"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-success"
          />
          <button
            disabled={busy}
            title="Create playlist"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-text text-canvas"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </form>
        <div className="mt-4 space-y-1">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => setActive(playlist)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left ${active?.id === playlist.id ? 'bg-surface-elevated' : 'hover:bg-hover/60'}`}
            >
              <ListMusic className="h-5 w-5 text-success" />
              <span className="truncate text-sm font-bold text-text">{playlist.name}</span>
            </button>
          ))}
        </div>
      </aside>
      {active ? (
        <section className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-xl font-bold text-text">{active.name}</h2>
              <p className="text-xs text-text-muted">{items.length} shared songs</p>
            </div>
            <div className="flex items-center gap-2">
              <form onSubmit={invite} className="flex items-center gap-2">
                <input
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  placeholder="Username"
                  className="h-9 w-36 rounded-full border border-border bg-canvas px-3 text-sm outline-none focus:border-success"
                />
                <button
                  title="Invite editor"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-muted hover:text-text"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
              </form>
              <button
                disabled={!currentSong}
                onClick={() => void addCurrentSong()}
                className="flex h-9 items-center gap-2 rounded-full bg-text px-4 text-sm font-bold text-canvas disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Current song
              </button>
            </div>
          </header>
          {message && (
            <div className="border-b border-border px-6 py-2 text-xs text-text-muted">
              {message}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-5xl space-y-1">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  onDoubleClick={() => void playItem(item)}
                  className="grid w-full grid-cols-[40px_minmax(0,1fr)_minmax(140px,0.7fr)_44px] items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-hover"
                >
                  <span className="text-sm tabular-nums text-text-muted">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-text">
                      {item.song.title}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {item.song.artist}
                    </span>
                  </span>
                  <span className="truncate text-sm text-text-muted">
                    {item.song.album || 'Single'}
                  </span>
                  <Play className="h-4 w-4 text-text-muted" />
                </button>
              ))}
              {items.length === 0 && (
                <div className="py-20 text-center">
                  <Music2 className="mx-auto h-9 w-9 text-text-muted" />
                  <p className="mt-3 text-sm text-text-muted">
                    Play a local song, then add it here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center justify-center">
          <ListMusic className="h-10 w-10 text-text-muted" />
          <p className="mt-3 text-sm text-text-muted">Create a playlist to collaborate.</p>
        </div>
      )}
    </div>
  )
}

export default function SharedPlaylistsPage(): ReactElement {
  return (
    <OnlineGate>
      <SharedPlaylistsWorkspace />
    </OnlineGate>
  )
}
