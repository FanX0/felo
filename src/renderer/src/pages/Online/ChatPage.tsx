import { FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import { MessageCircle, Music2, Play, Send } from 'lucide-react'
import OnlineGate from '../../components/Online/OnlineGate'
import { useAppStore } from '../../hooks/useAppStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { getSupabase } from '../../lib/supabase'
import type { ChatMessage, Conversation, OnlineProfile, SharedSong } from '../../online/types'
import type { Song } from '../Library/Library'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import { useNavigate, useSearchParams } from 'react-router-dom'

function songPayload(song: Song): SharedSong {
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration
  }
}

interface ChatPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

function ChatWorkspace({ onOpenDownloadPanel }: ChatPageProps): ReactElement {
  const { user, profile } = useOnlineStore()
  const { queue, currentSongIndex, setQueue } = usePlayerStore()
  const { setSearchQuery } = useAppStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentSong = queue[currentSongIndex]
  const [, setConversations] = useState<Conversation[]>([])
  const [active, setActive] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConversations = async (): Promise<void> => {
    const { data, error } = await getSupabase()
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) throw error
    const rows = (data || []) as Conversation[]
    setConversations(rows)
    setActive((current) => current || rows[0] || null)
  }

  useEffect(() => {
    if (!user) return
    const timer = window.setTimeout(() => {
      void loadConversations().catch((cause) => setError(cause.message))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user?.id])

  useEffect(() => {
    if (!active) {
      return
    }
    const supabase = getSupabase()
    void supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', active.id)
      .order('created_at')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setMessages((data || []) as ChatMessage[])
      })
    const channel = supabase
      .channel(`messages:${active.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${active.id}`
        },
        (payload) => {
          setMessages((items) =>
            items.some((item) => item.id === payload.new.id)
              ? items
              : [...items, payload.new as ChatMessage]
          )
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [active?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const startChat = async (person: OnlineProfile): Promise<void> => {
    if (!user) return
    setError('')
    const title = [profile?.username || 'member', person.username].sort().join(', ')
    const { data: conversation, error: createError } = await getSupabase()
      .from('conversations')
      .insert({ owner_id: user.id, title })
      .select()
      .single()
    if (createError) return setError(createError.message)
    const { error: memberError } = await getSupabase()
      .from('conversation_members')
      .insert([
        { conversation_id: conversation.id, user_id: user.id },
        { conversation_id: conversation.id, user_id: person.id }
      ])
    if (memberError) return setError(memberError.message)
    await loadConversations()
    setActive(conversation as Conversation)
  }

  const sendMessage = async (event?: FormEvent, song?: SharedSong): Promise<void> => {
    event?.preventDefault()
    if (!active || !user || (!body.trim() && !song)) return
    const text = body.trim()
    setBody('')
    const { error } = await getSupabase()
      .from('messages')
      .insert({ conversation_id: active.id, sender_id: user.id, body: text, song: song || null })
    if (error) {
      setBody(text)
      setError(error.message)
    }
  }

  useEffect(() => {
    const friendId = searchParams.get('friend')
    if (!user || !friendId || active) return
    void getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', friendId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (data) void startChat(data as OnlineProfile)
      })
  }, [user?.id, searchParams, active?.id])

  useEffect(() => {
    if (!active) return
    const pending = sessionStorage.getItem('felo:pending-chat-song')
    if (!pending) return

    try {
      const song = JSON.parse(pending) as SharedSong
      void sendMessage(undefined, song).then(() => {
        if (sessionStorage.getItem('felo:pending-chat-song') === pending) {
          sessionStorage.removeItem('felo:pending-chat-song')
        }
      })
    } catch {
      sessionStorage.removeItem('felo:pending-chat-song')
    }
  }, [active?.id])

  const playSharedSong = async (song: SharedSong): Promise<void> => {
    const songs = (await window.api?.getSongs?.()) as Song[] | undefined
    const match = songs?.find(
      (candidate) =>
        candidate.title.toLowerCase() === song.title.toLowerCase() &&
        candidate.artist.toLowerCase() === song.artist.toLowerCase()
    )
    if (match && songs) setQueue(songs, songs.indexOf(match))
    else if (onOpenDownloadPanel) {
      onOpenDownloadPanel({
        id: song.localId || `shared-${song.artist}-${song.title}`,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        duration: song.duration || 0,
        artworkUrl: song.artworkUrl,
        isOnline: true,
        autoDownload: true,
        autoPlay: true
      })
    } else {
      setSearchQuery(`${song.title} ${song.artist}`)
      navigate('/search')
    }
  }

  return (
    <div className="flex h-full min-w-0">
      <section className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="border-b border-border px-6 py-4">
              <h2 className="font-bold text-text">{active.title || 'Conversation'}</h2>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="mx-auto max-w-3xl space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[72%] rounded-md px-3 py-2 ${message.sender_id === user?.id ? 'bg-success text-black' : 'bg-surface-elevated text-text'}`}
                    >
                      {message.body && <p className="text-sm">{message.body}</p>}
                      {message.song && (
                        <button
                          onClick={() => void playSharedSong(message.song!)}
                          className="mt-1 flex w-full items-center gap-3 rounded-md bg-black/25 p-2 text-left"
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded bg-black/30">
                            <Music2 className="h-4 w-4" />
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">
                              {message.song.title}
                            </span>
                            <span className="block truncate text-xs opacity-70">
                              {message.song.artist}
                            </span>
                          </span>
                          <Play className="h-4 w-4 fill-current" />
                        </button>
                      )}
                      <span className="mt-1 block text-[10px] opacity-60">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            </div>
            <div className="border-t border-border p-4">
              <form
                onSubmit={(event) => void sendMessage(event)}
                className="mx-auto flex max-w-3xl items-center gap-2"
              >
                <button
                  type="button"
                  disabled={!currentSong}
                  onClick={() =>
                    currentSong && void sendMessage(undefined, songPayload(currentSong))
                  }
                  title="Send current song"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-success disabled:opacity-30"
                >
                  <Music2 className="h-5 w-5" />
                </button>
                <input
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write a message"
                  className="h-10 flex-1 rounded-full border border-border bg-canvas px-4 text-sm outline-none focus:border-success"
                />
                <button
                  title="Send"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-text text-canvas"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
              {error && <p className="mx-auto mt-2 max-w-3xl text-xs text-danger">{error}</p>}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <MessageCircle className="h-10 w-10 text-text-muted" />
            <h2 className="mt-4 text-xl font-bold text-text">Start a conversation</h2>
            <p className="mt-1 text-sm text-text-muted">Search for a username on the left.</p>
          </div>
        )}
      </section>
    </div>
  )
}

export default function ChatPage({ onOpenDownloadPanel }: ChatPageProps): ReactElement {
  return (
    <OnlineGate>
      <ChatWorkspace onOpenDownloadPanel={onOpenDownloadPanel} />
    </OnlineGate>
  )
}
