import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Play, Trash2 } from 'lucide-react'
import { useMenuAutoPosition } from '../../../lib/menuPosition'
import type { Playlist } from '../types'

interface PlaylistContextMenuProps {
  playlist: Playlist
  x: number
  y: number
  openUpwards?: boolean
  triggerRect?: DOMRect | { top: number; bottom: number; left: number; right: number } | null
  onClose: () => void
  onPlay: (playlistId: string) => void
  onRename: (playlistId: string) => void
  onDelete: (playlistId: string) => void
}

export function PlaylistContextMenu({
  playlist,
  x,
  y,
  openUpwards,
  triggerRect,
  onClose,
  onPlay,
  onRename,
  onDelete
}: PlaylistContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useMenuAutoPosition({
    menuRef,
    triggerRect,
    initialX: x,
    initialY: y,
    openUpwards
  })

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-[220px] max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border border-white/15 bg-[#1a1a1a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)]"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onPlay(playlist.id)
          onClose()
        }}
        disabled={playlist.songCount === 0}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        <Play className="h-4 w-4 fill-current" />
        <span>Play</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onRename(playlist.id)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <Pencil className="h-4 w-4" />
        <span>Rename playlist</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onDelete(playlist.id)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10 cursor-pointer"
      >
        <Trash2 className="h-4 w-4 fill-current" />
        <span>Remove playlist</span>
      </button>
    </div>,
    document.body
  )
}
