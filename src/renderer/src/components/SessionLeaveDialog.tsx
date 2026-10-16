import { type ReactElement } from 'react'
import { Radio, LogOut, X } from 'lucide-react'
import { useListeningStore } from '../hooks/useListeningStore'

export default function SessionLeaveDialog(): ReactElement | null {
  const pendingLeaveAndPlay = useListeningStore((state) => state.pendingLeaveAndPlay)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const confirmLeaveAndPlay = useListeningStore((state) => state.confirmLeaveAndPlay)
  const cancelLeaveAndPlay = useListeningStore((state) => state.cancelLeaveAndPlay)

  if (!pendingLeaveAndPlay || !joinedRoom) return null

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-[#161618] rounded-2xl border border-white/10 shadow-2xl p-5 overflow-hidden flex flex-col gap-4 text-text animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Leave Session?</h3>
              <p className="text-[11px] text-zinc-400">Active Group Session</p>
            </div>
          </div>
          <button
            onClick={cancelLeaveAndPlay}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="text-xs text-zinc-300 leading-relaxed">
          You are currently listening together in{' '}
          <span className="font-semibold text-white">{joinedRoom.name || 'this session'}</span>.
          Starting your own playback will disconnect you from the room.
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={cancelLeaveAndPlay}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Stay in Session
          </button>
          <button
            onClick={() => void confirmLeaveAndPlay()}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 border border-red-500/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-red-500/10"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Leave & Play</span>
          </button>
        </div>
      </div>
    </div>
  )
}
