import { Play, ListPlus, X } from 'lucide-react'

interface LibraryBatchToolbarProps {
  selectedCount: number
  totalCount: number
  onPlaySelected: () => void
  onQueueSelected: () => void
  onToggleSelectAll: () => void
  onClearSelection: () => void
}

export function LibraryBatchToolbar({
  selectedCount,
  totalCount,
  onPlaySelected,
  onQueueSelected,
  onToggleSelectAll,
  onClearSelection
}: LibraryBatchToolbarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-surface-elevated/95 border border-border/80 px-5 py-2.5 rounded-full shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
      <span className="text-xs font-bold text-text tabular-nums">
        {selectedCount} {selectedCount === 1 ? 'song' : 'songs'} selected
      </span>
      <div className="h-4 w-[1px] bg-border/60" />
      <button
        type="button"
        onClick={onPlaySelected}
        className="flex items-center gap-1.5 text-xs font-bold text-white hover:text-white/80 transition-colors cursor-pointer"
      >
        <Play className="w-3.5 h-3.5 fill-current" /> Play Selected
      </button>
      <button
        type="button"
        onClick={onQueueSelected}
        className="flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text transition-colors cursor-pointer"
      >
        <ListPlus className="w-3.5 h-3.5" /> Add to Queue
      </button>
      <div className="h-4 w-[1px] bg-border/60" />
      <button
        type="button"
        onClick={onToggleSelectAll}
        className="text-xs font-semibold text-text-muted hover:text-text transition-colors cursor-pointer"
      >
        {selectedCount === totalCount ? 'Deselect All' : 'Select All'}
      </button>
      <button
        type="button"
        onClick={onClearSelection}
        title="Clear selection (Esc)"
        className="p-1 rounded-full text-text-muted hover:text-text hover:bg-hover transition-colors ml-1 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
