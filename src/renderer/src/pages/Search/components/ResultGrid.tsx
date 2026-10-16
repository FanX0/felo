import { Play } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { HighlightMatch } from '../../../components/Common/HighlightMatch'
import { Artwork } from './Artwork'
import type { SearchItem } from '../types'

interface ResultGridProps {
  title: string
  items: SearchItem[]
  query?: string
  artist?: boolean
  onSelect: (item: SearchItem) => void
  onPlay?: (item: SearchItem) => void | Promise<void>
  showAllButton?: boolean
  onShowAll?: () => void
}

export function ResultGrid({
  title,
  items,
  query,
  artist = false,
  onSelect,
  onPlay,
  showAllButton = false,
  onShowAll
}: ResultGridProps) {
  const displayItems = showAllButton ? items.slice(0, 6) : items

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text">{title}</h2>
        {showAllButton && onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="text-xs font-semibold text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            See all ({items.length})
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {displayItems.map((item) => (
          <div
            role="button"
            tabIndex={0}
            key={item.id}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(item)
              }
            }}
            className="min-w-0 text-left group p-3 rounded-xl bg-surface-elevated/40 hover:bg-surface-elevated border border-border/20 transition-all shadow-sm hover:shadow-md cursor-pointer relative"
          >
            <div className="relative mb-3">
              <Artwork
                item={item}
                artist={artist}
                className={cn(
                  'w-full aspect-square shadow-md transition-transform group-hover:scale-[1.03]',
                  artist ? 'rounded-full' : 'rounded-lg'
                )}
              />
              {onPlay && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onPlay(item)
                  }}
                  title={`Play ${item.title}`}
                  className="absolute right-2 bottom-2 h-10 w-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-110 hover:bg-white/90 active:scale-95 transition-all opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                </button>
              )}
            </div>
            <div className="font-bold text-sm text-text group-hover:text-primary transition-colors truncate">
              <HighlightMatch text={item.title} query={query} />
            </div>
            <div className="text-xs text-text-muted mt-0.5 truncate">
              {artist
                ? item.trackCount !== undefined
                  ? `${item.trackCount} ${item.trackCount === 1 ? 'song' : 'songs'}`
                  : 'Artist'
                : item.type === 'Playlist'
                  ? item.trackCount !== undefined
                    ? `${item.trackCount} ${item.trackCount === 1 ? 'track' : 'tracks'}`
                    : 'Playlist'
                  : item.artist || (item.trackCount ? `${item.trackCount} tracks` : 'Album')}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
