import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react'
import { AlertCircle, MessageSquare, Send, Smile } from 'lucide-react'
import { useRoomChatStore } from '../../hooks/useRoomChatStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'

interface RoomChatProps {
  roomId: string
  roomName?: string
  className?: string
}

function formatMessageTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export default function RoomChat({ roomId, roomName = 'Room', className = '' }: RoomChatProps): ReactElement {
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

    const text = inputText
    setInputText('')

    try {
      await sendMessage(roomId, text)
    } catch (err: any) {
      setSendError(err?.message || 'Failed to send message')
      setInputText(text) // Restore on failure
    }
  }

  return (
    <div
      className={`flex flex-col rounded-2xl border border-border/80 bg-surface/95 shadow-xl backdrop-blur-md overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 bg-surface-elevated/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-success/15 text-success">
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
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-success border-t-transparent mr-2" />
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
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-[11px] font-bold text-text overflow-hidden">
                    {msg.sender_avatar_url ? (
                      <img
                        src={msg.sender_avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (msg.sender_display_name || 'U').slice(0, 1).toUpperCase()
                    )}
                  </div>
                )}

                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
                    isMe
                      ? 'rounded-br-none bg-success text-canvas font-medium'
                      : 'rounded-bl-none border border-border/60 bg-surface-elevated text-text'
                  }`}
                >
                  {!isMe && (
                    <p className="text-[10px] font-extrabold text-success mb-0.5 truncate">
                      {msg.sender_display_name || 'Friend'}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
                    {msg.body}
                  </p>
                  <p
                    className={`mt-1 text-[9px] text-right ${
                      isMe ? 'text-canvas/70' : 'text-text-muted'
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
          className="flex-1 rounded-full border border-border/70 bg-surface px-4 py-2 text-xs font-medium text-text placeholder-text-muted focus:border-success focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || sending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-canvas shadow transition-all hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
          title="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  )
}
