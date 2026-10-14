import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import { AlertCircle, MessageSquare, Send, Smile, Sparkles, Music, FastForward, Pause, Play, Share2, Download } from 'lucide-react'
import { useRoomChatStore } from '../../hooks/useRoomChatStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { downloadTrackInBackground } from '../../lib/backgroundDownloader'

interface RoomChatProps {
  roomId: string
  roomName?: string
  className?: string
  onSelectUser?: (userId: string, initialProfile?: { id: string; displayName: string; avatarUrl: string | null }) => void
}

function formatMessageTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function RoomChat({
  roomId,
  roomName = 'Room',
  className = '',
  onSelectUser
}: RoomChatProps): ReactElement {
  const { user } = useOnlineStore()
  const { messages, isLoading, sending, error, sendMessage } = useRoomChatStore()
  const [inputText, setInputText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // Auto-scroll when messages update
  useEffect(() => {
    scrollToBottom('smooth')
  }, [messages.length])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || sending) return
    setSendError(null)

    const raw = inputText.trim()
    setInputText('')

    if (raw.startsWith('/')) {
      const parts = raw.slice(1).trim().split(/\s+/)
      const cmd = (parts[0] || '').toLowerCase()
      const query = parts.slice(1).join(' ').trim()

      const listeningState = useListeningStore.getState()
      const isHost = Boolean(
        listeningState.hostRoom ||
        (listeningState.joinedRoom && listeningState.joinedRoom.host_id === user?.id)
      )
      const roomCode = listeningState.hostRoom?.code || listeningState.joinedRoom?.code || ''
      const player = usePlayerStore.getState()
      const currentSong = player.queue[player.currentSongIndex]

      if (cmd === 'invite') {
        const msg = roomCode
          ? `🎧 Room Code: **${roomCode}** • Join our live session in Felo with this code!`
          : `🎧 Listen Together session is active in this room!`
        try {
          await sendMessage(roomId, msg)
        } catch (err: any) {
          setSendError(err?.message || 'Failed to send message')
        }
        return
      }

      if (cmd === 'np' || cmd === 'nowplaying') {
        const msg = currentSong
          ? `🎶 **Now Playing:** **${currentSong.title}** by **${currentSong.artist}**`
          : `🔇 No track currently playing.`
        try {
          await sendMessage(roomId, msg)
        } catch (err: any) {
          setSendError(err?.message || 'Failed to send message')
        }
        return
      }

      if (cmd === 'skip') {
        if (isHost) {
          player.playNext(true)
          try {
            await sendMessage(roomId, `⏭️ Skipped track`)
          } catch {
            // ignore
          }
        } else {
          try {
            await sendMessage(roomId, `⏭️ Requested skip`)
          } catch (err: any) {
            setSendError(err?.message || 'Failed to send message')
          }
        }
        return
      }

      if (cmd === 'pause') {
        if (isHost) {
          player.setIsPlaying(false)
          try {
            await sendMessage(roomId, `⏸️ Paused playback`)
          } catch {
            // ignore
          }
        } else {
          try {
            await sendMessage(roomId, `⏸️ Requested pause`)
          } catch (err: any) {
            setSendError(err?.message || 'Failed to send message')
          }
        }
        return
      }

      if (cmd === 'resume' || (cmd === 'play' && !query)) {
        if (isHost) {
          player.setIsPlaying(true)
          try {
            await sendMessage(roomId, `▶️ Resumed playback`)
          } catch {
            // ignore
          }
        } else {
          try {
            await sendMessage(roomId, `▶️ Requested resume`)
          } catch (err: any) {
            setSendError(err?.message || 'Failed to send message')
          }
        }
        return
      }

      if (cmd === 'play' && query) {
        if (isHost && window.api?.getSongs) {
          try {
            const allSongs = await window.api.getSongs()
            const match = allSongs.find(
              (s: any) =>
                s.title?.toLowerCase().includes(query.toLowerCase()) ||
                s.artist?.toLowerCase().includes(query.toLowerCase())
            )
            if (match) {
              player.enqueueSong(match)
              await sendMessage(roomId, `🎶 Queued: **${match.title}** by **${match.artist}**`)
              return
            } else {
              void downloadTrackInBackground(
                { title: query },
                {
                  playAction: 'enqueue',
                  autoPlay: player.queue.length === 0,
                  conflictMode: 'keep_both'
                }
              )
              await sendMessage(
                roomId,
                `📥 Song not in library. Downloading **"${query}"** via your prioritized providers...`
              )
              return
            }
          } catch {
            // fallback
          }
        }
        try {
          await sendMessage(roomId, `🎵 Song request: "${query}"`)
        } catch (err: any) {
          setSendError(err?.message || 'Failed to send message')
        }
        return
      }

      if (cmd === 'download') {
        try {
          await sendMessage(
            roomId,
            `📥 **Download Felo Music Player:** https://bit.ly/47iv3PK`
          )
        } catch (err: any) {
          setSendError(err?.message || 'Failed to send message')
        }
        return
      }

      if (cmd === 'help') {
        try {
          await sendMessage(
            roomId,
            `💡 Available Chat Commands: /play <song>, /skip, /pause, /resume, /np, /invite, /download`
          )
        } catch (err: any) {
          setSendError(err?.message || 'Failed to send message')
        }
        return
      }
    }

    try {
      await sendMessage(roomId, raw)
    } catch (err: any) {
      setSendError(err?.message || 'Failed to send message')
      setInputText(raw)
    }
  }

  return (
    <div
      className={`flex flex-col rounded-2xl border border-border/80 bg-surface/95 shadow-xl backdrop-blur-md overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-surface-elevated/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-elevated text-text">
            <MessageSquare className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-black text-text tracking-wide uppercase">Live Room Chat</h3>
            <p className="text-[10px] text-text-muted">{roomName}</p>
          </div>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-bold text-text-muted border border-border/40">
          {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[340px]">
        {isLoading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center py-10 text-xs text-text-muted">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent mr-2" />
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated text-text-muted mb-2">
              <Smile className="h-5 w-5" />
            </div>
            <p className="text-xs font-bold text-text">No messages yet</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              Say hello or react to the current track with everyone in the room!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === user?.id
            return (
              <div
                key={msg.id}
                className={`flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                {!isMe && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectUser?.(msg.sender_id, {
                        id: msg.sender_id,
                        displayName: msg.sender_display_name || 'Friend',
                        avatarUrl: msg.sender_avatar_url || null
                      })
                    }
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-[11px] font-bold text-text overflow-hidden hover:scale-105 transition-transform cursor-pointer"
                    title={`View profile of ${msg.sender_display_name || 'User'}`}
                  >
                    {msg.sender_avatar_url ? (
                      <img
                        src={msg.sender_avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (msg.sender_display_name || 'U').slice(0, 1).toUpperCase()
                    )}
                  </button>
                )}

                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
                    isMe
                      ? 'rounded-br-none bg-white text-black font-medium'
                      : 'rounded-bl-none border border-border/60 bg-surface-elevated text-text'
                  }`}
                >
                  {!isMe && (
                    <button
                      type="button"
                      onClick={() =>
                        onSelectUser?.(msg.sender_id, {
                          id: msg.sender_id,
                          displayName: msg.sender_display_name || 'Friend',
                          avatarUrl: msg.sender_avatar_url || null
                        })
                      }
                      className="text-[10px] font-extrabold text-primary-amber mb-0.5 truncate hover:underline block text-left cursor-pointer"
                      title={`View profile of ${msg.sender_display_name || 'User'}`}
                    >
                      {msg.sender_display_name || 'Friend'}
                    </button>
                  )}
                  <p className="text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
                    {msg.body}
                  </p>
                  <p
                    className={`mt-1 text-[9px] text-right ${
                      isMe ? 'text-black/60' : 'text-text-muted'
                    }`}
                  >
                    {formatMessageTime(msg.created_at)}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error alert if any */}
      {(sendError || error) && (
        <div className="flex items-center gap-1.5 bg-danger/10 border-t border-danger/20 px-3 py-1.5 text-[11px] font-bold text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{sendError || error}</span>
        </div>
      )}

      {/* Slash command hints when typing / */}
      {inputText.startsWith('/') && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-border/40 bg-surface/90 px-3 py-1.5 text-[11px] scrollbar-none">
          <span className="text-[10px] font-bold text-text-muted shrink-0 mr-1">COMMANDS:</span>
          {[
            { cmd: '/play ', label: 'play <song>', icon: Music },
            { cmd: '/skip', label: 'skip', icon: FastForward },
            { cmd: '/pause', label: 'pause', icon: Pause },
            { cmd: '/resume', label: 'resume', icon: Play },
            { cmd: '/invite', label: 'invite', icon: Share2 },
            { cmd: '/download', label: 'download', icon: Download },
            { cmd: '/np', label: 'np', icon: Sparkles }
          ].map((item) => (
            <button
              key={item.cmd}
              type="button"
              onClick={() => setInputText(item.cmd)}
              className="flex items-center gap-1 rounded-full bg-surface-elevated hover:bg-white/10 px-2 py-0.5 text-text font-mono text-[10px] border border-border/60 transition-colors shrink-0"
            >
              <item.icon className="h-2.5 w-2.5 text-text-muted" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input Bar */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-border/60 bg-surface-elevated/60 p-2.5"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send a message to the room..."
          maxLength={500}
          className="flex-1 rounded-full border border-border/70 bg-surface px-4 py-2 text-xs font-medium text-text placeholder-text-muted focus:border-white/40 focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || sending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black shadow transition-all hover:scale-105 hover:bg-white/90 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          title="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}
