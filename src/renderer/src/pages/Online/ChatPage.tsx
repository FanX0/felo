import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Headphones,
  Loader2,
  MessageCircle,
  Music2,
  Play,
  Radio,
  Search,
  Send,
  User,
  Users
} from 'lucide-react'
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useAppStore } from '../../hooks/useAppStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useDirectChatStore } from '../../hooks/useDirectChatStore'
import { getSupabase } from '../../lib/supabase'
import type { ChatMessage, SharedSong } from '../../online/types'
import type { Song } from '../Library/Library'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'

function songPayload(song: Song): SharedSong {
  return {
    localId: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    artworkUrl: /^https?:\/\//i.test(song.artworkPath || '') ? song.artworkPath : undefined
  }
}

function formatTime(seconds?: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatRelativeTime(dateString: string): string {
  try {
    const now = new Date().getTime()
    const msgTime = new Date(dateString).getTime()
    const diff = Math.max(0, Math.floor((now - msgTime) / 1000))

    if (diff < 60) return 'Just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return new Date(dateString).toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function formatMessageTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

interface ChatPageProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

function ChatWorkspace({ onOpenDownloadPanel }: ChatPageProps): ReactElement {
  const { user } = useOnlineStore()
  const { queue, currentSongIndex, setQueue } = usePlayerStore()
  const { setSearchQuery } = useAppStore()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const {
    conversations,
    activeConversation,
    messages,
    friends,
    isLoadingConversations,
    isLoadingMessages,
    sending,
    error,
    loadConversations,
    loadFriends,
    selectOrStartConversation,
    setActiveConversation,
    sendMessage,
    addIncomingMessage
  } = useDirectChatStore()

  const currentSong = queue[currentSongIndex]
  const [inputBody, setInputBody] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 1. Load conversations & friends on mount
  useEffect(() => {
    if (!user) return
    void loadConversations()
    void loadFriends()
  }, [user?.id, loadConversations, loadFriends])

  // 2. Handle ?friend=... query param from friend activity or profile
  useEffect(() => {
    const targetFriendId = searchParams.get('friend')
    if (!user || !targetFriendId) return

    void selectOrStartConversation(targetFriendId).then(() => {
      // Clear search param so back navigation works cleanly
      setSearchParams({})
    })
  }, [searchParams, user?.id, selectOrStartConversation, setSearchParams])

  // 3. Real-time Subscription for active conversation
  useEffect(() => {
    if (!activeConversation?.id) return
    const supabase = getSupabase()

    const channel = supabase
      .channel(`conversation-messages:${activeConversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversation.id}`
        },
        (payload) => {
          addIncomingMessage(payload.new as ChatMessage)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeConversation?.id, addIncomingMessage])

  // 4. Global subscription for incoming direct messages (updates sidebar in background)
  useEffect(() => {
    if (!user?.id) return
    const supabase = getSupabase()

    const channel = supabase
      .channel('user-direct-messages-global')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage
          // If not the sender, update conversation preview in sidebar
          if (newMsg.sender_id !== user.id) {
            addIncomingMessage(newMsg)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, addIncomingMessage])

  // 5. Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // 6. Handle pending song share from sessionStorage
  useEffect(() => {
    if (!activeConversation?.id) return
    const pending = sessionStorage.getItem('felo:pending-chat-song')
    if (!pending) return

    try {
      const song = JSON.parse(pending) as SharedSong
      sessionStorage.removeItem('felo:pending-chat-song')
      void sendMessage(activeConversation.id, '', song)
    } catch {
      sessionStorage.removeItem('felo:pending-chat-song')
    }
  }, [activeConversation?.id, sendMessage])

  const handleSendMessage = async (e?: FormEvent, song?: SharedSong) => {
    e?.preventDefault()
    if (!activeConversation?.id || (!inputBody.trim() && !song) || sending) return
    setSendError(null)

    const text = inputBody
    setInputBody('')

    try {
      await sendMessage(activeConversation.id, text, song)
    } catch (err: any) {
      setSendError(err?.message || 'Failed to send message')
      if (text) setInputBody(text)
    }
  }

  const playSharedSong = async (song: SharedSong): Promise<void> => {
    const songs = (await window.api?.getSongs?.()) as Song[] | undefined
    const match = songs?.find(
      (candidate) =>
        candidate.title.toLowerCase() === song.title.toLowerCase() &&
        candidate.artist.toLowerCase() === song.artist.toLowerCase()
    )
    if (match && songs) {
      setQueue(songs, songs.indexOf(match))
    } else if (onOpenDownloadPanel) {
      onOpenDownloadPanel({
        id: song.localId || `shared-${song.artist}-${song.title}`,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        duration: song.duration || 0,
        artworkPath: song.artworkUrl,
        isOnline: true,
        autoDownload: true,
        autoPlay: true
      })
    } else {
      setSearchQuery(`${song.title} ${song.artist}`)
      navigate('/search')
    }
  }

  // Filter conversations & friends by search query
  const filteredConversations = conversations.filter((c) => {
    if (!searchFilter.trim()) return true
    const q = searchFilter.toLowerCase()
    const name = c.otherMember.display_name.toLowerCase()
    const username = c.otherMember.username.toLowerCase()
    const lastMsg = (c.lastMessage?.body || '').toLowerCase()
    return name.includes(q) || username.includes(q) || lastMsg.includes(q)
  })

  const filteredFriends = friends.filter((f) => {
    if (!searchFilter.trim()) return true
    const q = searchFilter.toLowerCase()
    return f.display_name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)
  })

  return (
    <div className="relative flex h-full w-full select-none overflow-hidden bg-canvas">
      {/* ─── LEFT SIDEBAR: CONVERSATIONS & FRIENDS ───────────────────────── */}
      <aside className="flex w-80 flex-col border-r border-border/80 bg-surface/50 backdrop-blur-sm">
        {/* Sidebar Header */}
        <div className="border-b border-border/60 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-black tracking-tight text-text flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-text" />
              <span>Direct Messages</span>
            </h1>
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-bold text-text-muted border border-border/40">
              {conversations.length}
            </span>
          </div>

          {/* Search Bar */}
          <div className="mt-3 relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-text-muted" />
            <input
              type="text"
              placeholder="Search conversations or friends..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full rounded-xl border border-border/60 bg-surface-elevated py-1.5 pl-8 pr-3 text-xs font-medium text-text placeholder-text-muted focus:border-border focus:outline-none transition-colors"
            />
          </div>
        </div>

        {/* Friends Quick Row */}
        {friends.length > 0 && (
          <div className="border-b border-border/50 p-3 bg-surface-elevated/20">
            <p className="text-[10px] font-black uppercase tracking-wider text-text-muted mb-2 px-1">
              Friends ({friends.length})
            </p>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {filteredFriends.map((friend) => {
                const isActive = activeConversation?.otherMember.id === friend.id
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => void selectOrStartConversation(friend.id)}
                    className={`group flex flex-col items-center gap-1 shrink-0 p-1.5 rounded-xl transition-all ${
                      isActive ? 'bg-surface-elevated text-text border border-border' : 'hover:bg-hover text-text-muted hover:text-text'
                    }`}
                    title={`Chat with ${friend.display_name}`}
                  >
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-xs font-black text-text overflow-hidden shadow-sm">
                      {friend.avatar_url ? (
                        <img src={friend.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        friend.display_name.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <span className={`max-w-[54px] truncate text-[10px] font-bold ${isActive ? 'text-text' : 'text-text-muted'}`}>
                      {friend.display_name.split(' ')[0]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border/20 p-2 space-y-1">
          {isLoadingConversations && conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted mb-2" />
              Loading conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-text-muted">
              <Users className="h-8 w-8 text-text-muted/60 mb-2" />
              <p className="text-xs font-bold text-text">No conversations yet</p>
              <p className="text-[11px] text-text-muted mt-1">
                Click on any friend above or visit their profile to start chatting!
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = activeConversation?.id === conv.id
              const lastMsgText = conv.lastMessage
                ? conv.lastMessage.song
                  ? `🎵 Shared: ${conv.lastMessage.song.title}`
                  : conv.lastMessage.body
                : 'No messages yet'

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setActiveConversation(conv)}
                  className={`w-full flex items-center gap-3 rounded-xl p-2.5 text-left transition-all ${
                    isSelected
                      ? 'bg-surface-elevated border border-white/20 shadow-sm'
                      : 'hover:bg-hover border border-transparent'
                  }`}
                >
                  {/* Friend Avatar */}
                  <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-sm font-black text-text overflow-hidden">
                    {conv.otherMember.avatar_url ? (
                      <img
                        src={conv.otherMember.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      conv.otherMember.display_name.slice(0, 1).toUpperCase()
                    )}
                  </div>

                  {/* Conv Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-bold text-text">
                        {conv.otherMember.display_name}
                      </span>
                      {conv.lastMessage && (
                        <span className="shrink-0 text-[10px] text-text-muted">
                          {formatRelativeTime(conv.lastMessage.created_at)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-text-muted mt-0.5">{lastMsgText}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* ─── RIGHT PANE: ACTIVE CHAT THREAD ─────────────────────────────── */}
      <section className="flex flex-1 flex-col overflow-hidden bg-surface/20">
        {activeConversation ? (
          <>
            {/* Thread Header */}
            <header className="flex items-center justify-between border-b border-border/70 bg-surface/80 px-6 py-3.5 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-sm font-black text-text overflow-hidden">
                  {activeConversation.otherMember.avatar_url ? (
                    <img
                      src={activeConversation.otherMember.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    activeConversation.otherMember.display_name.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-black text-text">
                    {activeConversation.otherMember.display_name}
                  </h2>
                  <p className="text-[11px] text-text-muted">
                    @{activeConversation.otherMember.username}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Listen Together quick link */}
                <button
                  type="button"
                  onClick={() => {
                    void useListeningStore
                      .getState()
                      .listenAlongWithFriend(activeConversation.otherMember.id)
                      .then(() => navigate('/listen-together'))
                      .catch(() => navigate('/listen-together'))
                  }}
                  title="Listen together in real-time"
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated hover:bg-hover hover:text-text px-3.5 py-1.5 text-xs font-bold text-text-muted transition-all shadow-sm"
                >
                  <Radio className="h-3.5 w-3.5" />
                  <span>Listen Together</span>
                </button>

                {/* Profile Link */}
                <NavLink
                  to={`/profile/${encodeURIComponent(activeConversation.otherMember.username)}`}
                  className="flex items-center gap-1 rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text-muted hover:text-text hover:bg-hover transition-all"
                >
                  <User className="h-3.5 w-3.5" />
                  <span>Profile</span>
                </NavLink>
              </div>
            </header>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {isLoadingMessages && messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-text-muted">
                  <Loader2 className="h-5 w-5 animate-spin text-text-muted mr-2" />
                  Loading chat history...
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-text-muted py-12">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-text-muted mb-3">
                    <MessageCircle className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-text">
                    This is the start of your conversation with {activeConversation.otherMember.display_name}
                  </h3>
                  <p className="text-xs text-text-muted mt-1 max-w-sm">
                    Say hello or share your favorite song!
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const isMe = message.sender_id === user?.id

                  return (
                    <div
                      key={message.id}
                      className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isMe && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-[11px] font-bold text-text overflow-hidden">
                          {activeConversation.otherMember.avatar_url ? (
                            <img
                              src={activeConversation.otherMember.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            activeConversation.otherMember.display_name.slice(0, 1).toUpperCase()
                          )}
                        </div>
                      )}

                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm ${
                          isMe
                            ? 'rounded-br-none bg-white/10 border border-white/20 text-white font-medium'
                            : 'rounded-bl-none border border-border/70 bg-surface-elevated text-text'
                        }`}
                      >
                        {/* Text Body */}
                        {message.body && (
                          <p className="text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
                            {message.body}
                          </p>
                        )}

                        {/* Interactive Shared Song Card */}
                        {message.song && (
                          <div
                            className={`mt-2 rounded-xl p-3 border transition-all ${
                              isMe
                                ? 'bg-black/20 border-black/30 text-canvas'
                                : 'bg-surface border-border/70 text-text'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-amber/20 text-primary-amber border border-primary-amber/30">
                                <Music2 className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-black">
                                  {message.song.title}
                                </span>
                                <span className="block truncate text-[11px] opacity-75">
                                  {message.song.artist}
                                </span>
                              </div>
                            </div>

                            <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                              <span className="text-[10px] opacity-70">
                                {formatTime(message.song.duration)}
                              </span>

                              <button
                                type="button"
                                onClick={() => void playSharedSong(message.song!)}
                                className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3.5 py-1 text-xs font-bold text-text hover:bg-hover transition-all shadow-sm"
                                title="Play song (auto-downloads if not in library)"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                <span>Play</span>
                              </button>
                            </div>
                          </div>
                        )}

                        <span
                          className={`mt-1 block text-[9px] text-right ${
                            isMe ? 'text-canvas/70' : 'text-text-muted'
                          }`}
                        >
                          {formatMessageTime(message.created_at)}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Error Banner */}
            {(sendError || error) && (
              <div className="border-t border-danger/30 bg-danger/10 px-6 py-2 text-xs font-bold text-danger">
                {sendError || error}
              </div>
            )}

            {/* Bottom Input Area */}
            <div className="border-t border-border/70 bg-surface/80 p-4 backdrop-blur-md">
              <form
                onSubmit={(e) => void handleSendMessage(e)}
                className="mx-auto flex max-w-3xl items-center gap-2"
              >
                {/* Share Currently Playing Track button */}
                <button
                  type="button"
                  disabled={!currentSong || sending}
                  onClick={() => currentSong && void handleSendMessage(undefined, songPayload(currentSong))}
                  title={
                    currentSong
                      ? `Share now playing: "${currentSong.title}"`
                      : 'Play a song to share it in chat'
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-text-muted hover:border-border hover:bg-hover hover:text-text disabled:opacity-30 transition-all"
                >
                  <Music2 className="h-4 w-4" />
                </button>

                {/* Input Field */}
                <input
                  type="text"
                  value={inputBody}
                  onChange={(e) => setInputBody(e.target.value)}
                  placeholder={`Message @${activeConversation.otherMember.username}...`}
                  maxLength={1000}
                  className="h-10 flex-1 rounded-full border border-border/80 bg-canvas px-4 text-xs font-medium text-text placeholder-text-muted focus:border-border focus:outline-none transition-colors"
                />

                {/* Send Button */}
                <button
                  type="submit"
                  disabled={!inputBody.trim() || sending}
                  title="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-text font-bold shadow-md hover:bg-hover disabled:opacity-40 transition-all"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Empty State when no conversation is selected */
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-text-muted">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-elevated text-text-muted mb-4 shadow-md">
              <Headphones className="h-8 w-8 text-text" />
            </div>
            <h2 className="text-xl font-black text-text">Your Music Conversations</h2>
            <p className="mt-1.5 max-w-sm text-xs text-text-muted leading-relaxed">
              Select a conversation from the sidebar or click a friend below to start chatting and sharing tracks in real time.
            </p>

            {friends.length > 0 && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                {friends.map((friend) => (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => void selectOrStartConversation(friend.id)}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:border-border hover:bg-hover hover:text-text transition-all shadow-sm"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-[10px] font-black overflow-hidden">
                      {friend.avatar_url ? (
                        <img src={friend.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        friend.display_name.slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <span>Chat with {friend.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Error Banner - visible in both active and empty states */}
      {error && (
        <div className="absolute bottom-16 left-80 right-0 border-t border-danger/30 bg-danger/10 px-6 py-2 text-xs font-bold text-danger z-10">
          ⚠ {error}
        </div>
      )}
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
