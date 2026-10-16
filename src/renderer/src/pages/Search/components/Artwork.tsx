import type { ReactNode } from 'react'
import { Disc3, ListMusic, Music2, User as UserIcon } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { ArtworkImage } from '../../Home/components/ArtworkImage'
import type { SearchItem } from '../types'

export function Artwork({
  item,
  className,
  artist = false
}: {
  item: SearchItem
  className: string
  artist?: boolean
}): ReactNode {
  const fallbackIcon = artist ? (
    <UserIcon className="w-1/3 h-1/3 text-text-muted" />
  ) : item.type === 'Playlist' ? (
    <ListMusic className="w-1/3 h-1/3 text-text-muted" />
  ) : item.type === 'Album' ? (
    <Disc3 className="w-1/3 h-1/3 text-text-muted" />
  ) : (
    <Music2 className="w-1/3 h-1/3 text-text-muted" />
  )

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden bg-surface-elevated border border-border/40 flex items-center justify-center transition-all',
        artist && 'rounded-full',
        className
      )}
    >
      <ArtworkImage
        src={item.thumbnail}
        title={item.title}
        artist={item.artist || ''}
        className="absolute inset-0 h-full w-full object-cover"
        fallbackIcon={fallbackIcon}
      />
    </div>
  )
}
