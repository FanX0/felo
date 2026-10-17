import { ArrowUp, Clock } from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { LibrarySortKey, SortDirection } from '../types'

interface LibraryTableHeaderProps {
  sortKey: LibrarySortKey
  sortDirection: SortDirection
  onSort: (key: LibrarySortKey) => void
}

export function LibraryTableHeader({ sortKey, sortDirection, onSort }: LibraryTableHeaderProps) {
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)_76px] gap-2 border-b border-border/30 bg-surface px-2 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted sticky top-0 z-10 shrink-0 md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(200px,1fr)] xl:gap-4 xl:px-4 2xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(120px,0.8fr)_minmax(270px,1fr)]">
      <button
        type="button"
        onClick={() => onSort('default')}
        title="Sort by original order"
        className={cn(
          'text-center hover:text-text transition-colors flex items-center justify-center gap-1 cursor-pointer',
          sortKey === 'default' ? 'text-white font-bold' : 'text-text-muted'
        )}
      >
        <span>#</span>
        {sortKey === 'default' && (
          <ArrowUp
            className={cn(
              'w-3 h-3 transition-transform text-white',
              sortDirection === 'desc' && 'rotate-180'
            )}
          />
        )}
      </button>

      <button
        type="button"
        onClick={() => onSort('title')}
        title="Sort by Title"
        className={cn(
          'flex items-center gap-1.5 hover:text-text transition-colors text-left cursor-pointer',
          sortKey === 'title' ? 'text-white font-bold' : 'text-text-muted'
        )}
      >
        <span>Title</span>
        {sortKey === 'title' && (
          <ArrowUp
            className={cn(
              'w-3 h-3 transition-transform text-white',
              sortDirection === 'desc' && 'rotate-180'
            )}
          />
        )}
      </button>

      <button
        type="button"
        onClick={() => onSort('album')}
        title="Sort by Album"
        className={cn(
          'hidden min-w-0 md:flex items-center gap-1.5 hover:text-text transition-colors text-left cursor-pointer',
          sortKey === 'album' ? 'text-white font-bold' : 'text-text-muted'
        )}
      >
        <span>Album</span>
        {sortKey === 'album' && (
          <ArrowUp
            className={cn(
              'w-3 h-3 transition-transform text-white',
              sortDirection === 'desc' && 'rotate-180'
            )}
          />
        )}
      </button>

      <button
        type="button"
        onClick={() => onSort('dateAdded')}
        title="Sort by Date added"
        className={cn(
          'hidden min-w-0 items-center gap-1.5 hover:text-text transition-colors text-left xl:flex cursor-pointer',
          sortKey === 'dateAdded' ? 'text-white font-bold' : 'text-text-muted'
        )}
      >
        <span>Date added</span>
        {sortKey === 'dateAdded' && (
          <ArrowUp
            className={cn(
              'w-3 h-3 transition-transform text-white',
              sortDirection === 'desc' && 'rotate-180'
            )}
          />
        )}
      </button>

      <button
        type="button"
        onClick={() => onSort('duration')}
        title="Sort by Duration"
        className={cn(
          'flex items-center justify-end gap-1.5 pr-1 md:pr-8 hover:text-text transition-colors ml-auto cursor-pointer',
          sortKey === 'duration' ? 'text-white font-bold' : 'text-text-muted'
        )}
      >
        <Clock className="w-3.5 h-3.5" />
        {sortKey === 'duration' && (
          <ArrowUp
            className={cn(
              'w-3 h-3 transition-transform text-white',
              sortDirection === 'desc' && 'rotate-180'
            )}
          />
        )}
      </button>
    </div>
  )
}
