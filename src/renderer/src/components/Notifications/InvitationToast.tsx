import { type ReactElement, useEffect } from 'react'
import { Headphones, Music2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useListeningStore } from '../../stores/listening'

export default function InvitationToast(): ReactElement | null {
  const navigate = useNavigate()
  const activeToast = useNotificationStore((s) => s.activeToast)
  const dismissToast = useNotificationStore((s) => s.dismissToast)
  const acceptRoomInvitation = useNotificationStore((s) => s.acceptRoomInvitation)
  const joinRoomByCode = useListeningStore((s) => s.joinRoomByCode)

  // Auto-dismiss after 12 seconds
  useEffect(() => {
    if (!activeToast) return
    const timer = setTimeout(() => {
      dismissToast()
    }, 12000)
    return () => clearTimeout(timer)
  }, [activeToast, dismissToast])

  if (!activeToast) return null

  const inviter = activeToast.inviter
  const room = activeToast.room

  const handleJoin = async () => {
    const invId = activeToast.id
    const roomCode = room?.code || ''
    dismissToast()
    try {
      await acceptRoomInvitation(invId)
      navigate(`/online/listen?code=${encodeURIComponent(roomCode)}`)
      if (roomCode) {
        void joinRoomByCode(roomCode)
      }
    } catch (err) {
      console.error('Failed to join room from toast:', err)
    }
  }

  return (
    <div className="fixed bottom-24 right-6 z-[90] max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-200">
      <div className="rounded-2xl border border-primary-amber/40 bg-surface-elevated/95 p-4 shadow-2xl backdrop-blur-xl text-text">
        <div className="flex items-start gap-3">
          {/* Inviter Avatar */}
          <div className="relative h-10 w-10 shrink-0 rounded-full border border-border bg-surface overflow-hidden text-xs font-black flex items-center justify-center text-text">
            {inviter?.avatar_url ? (
              <img src={inviter.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              inviter?.display_name?.slice(0, 1).toUpperCase() || 'H'
            )}
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 border border-canvas" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-black uppercase tracking-wider text-primary-amber">
                Room Invitation
              </span>
              <button
                type="button"
                onClick={dismissToast}
                className="h-5 w-5 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <p className="text-xs font-bold text-text mt-0.5 truncate">
              {inviter?.display_name || 'A friend'} invited you
            </p>

            <p className="text-xs text-text-muted truncate">
              to join <span className="font-semibold text-text">"{room?.name || 'Listening Room'}"</span>
            </p>

            {room?.song && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-text truncate bg-surface/80 rounded-lg px-2 py-1 border border-border/50">
                <Music2 className="h-3 w-3 text-primary-amber shrink-0 animate-spin-slow" />
                <span className="truncate text-[11px]">
                  {room.song.title} <span className="text-text-muted">· {room.song.artist}</span>
                </span>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleJoin}
                className="flex-1 h-8 rounded-lg bg-primary-amber text-canvas text-xs font-black flex items-center justify-center gap-1.5 hover:bg-primary-amber/90 active:scale-95 transition-all cursor-pointer shadow-sm"
              >
                <Headphones className="h-3.5 w-3.5" />
                <span>Join Session</span>
              </button>
              <button
                type="button"
                onClick={dismissToast}
                className="h-8 px-3 rounded-lg border border-border/80 bg-surface text-text-muted hover:text-text hover:bg-hover text-xs font-bold transition-all cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
