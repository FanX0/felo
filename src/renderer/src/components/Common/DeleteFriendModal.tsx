import { useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { UserMinus, X, Loader2 } from 'lucide-react'
import Avatar from './Avatar'

export interface DeleteFriendModalProps {
  isOpen: boolean
  friendName: string
  username?: string
  avatarUrl?: string | null
  isLoading?: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

export default function DeleteFriendModal({
  isOpen,
  friendName,
  username,
  avatarUrl,
  isLoading = false,
  onClose,
  onConfirm
}: DeleteFriendModalProps): ReactElement | null {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-friend-title"
      className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => {
        if (!isLoading) onClose()
      }}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#161618] p-5 shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col gap-4 text-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger border border-danger/30">
              <UserMinus className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 id="delete-friend-title" className="text-sm font-bold text-white">
                Remove Friend
              </h3>
              <p className="text-[11px] text-zinc-400">Confirmation</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close"
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Friend info card */}
        <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
          <Avatar
            src={avatarUrl}
            fallbackText={friendName || username || 'Friend'}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{friendName || 'Friend'}</p>
            {username && <p className="truncate text-xs text-zinc-400">@{username}</p>}
          </div>
        </div>

        {/* Description / Confirmation text */}
        <div className="space-y-1.5 text-xs text-zinc-300 leading-relaxed">
          <p>
            Are you sure you want to remove{' '}
            <span className="font-semibold text-white">{friendName || username || 'this friend'}</span> from your
            friends?
          </p>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            You will no longer see each other&apos;s listening activity or join private rooms directly.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isLoading}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-danger hover:bg-danger/90 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Removing...</span>
              </>
            ) : (
              <>
                <UserMinus className="h-3.5 w-3.5" />
                <span>Remove Friend</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
