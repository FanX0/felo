import { Check, Pause, Play, MoreVertical } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { toMediaUrl } from '../../../lib/media'
import { ArtworkImage } from '../../Home/components/ArtworkImage'
import { HighlightMatch } from '../../../components/Common/HighlightMatch'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import { AnimatedPlayingWave } from './AnimatedPlayingWave'
import { QualityPill } from './QualityPill'
import SongAddButton from '../../../components/Common/SongAddButton'
import { formatDuration, formatSize, formatRelativeDate } from '../utils'
import type { Song, LibraryViewMode } from '../types'

interface LibrarySongRowProps {
  song: Song
  index: number
  isActive: boolean
  isPlaying: boolean
  isSelected: boolean
  hasMultiSelection: boolean
  viewMode: LibraryViewMode
  rowHeight: number
  searchQuery: string
  top: number
  size: number
  isMenuActive: boolean
  onClick: (event: React.MouseEvent) => void
  onMenuOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
  onAlbumClick: (event: React.MouseEvent) => void
}

export function LibrarySongRow({
  song,
  index,
  isActive,
  isPlaying,
  isSelected,
  hasMultiSelection,
  viewMode,
  rowHeight,
  searchQuery,
  top,
  size,
  isMenuActive,
  onClick,
  onMenuOpen,
  onAlbumClick
}: LibrarySongRowProps) {
  const artworkUrl = toMediaUrl(song.artworkPath) || song.artworkUrl

  return (
    <div
      onClick={onClick}
      className={cn(
        'absolute top-0 left-0 grid w-full grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 rounded-lg px-2 text-[13px] group cursor-pointer transition-colors md:grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_160px] md:gap-3 md:px-3 xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(110px,0.8fr)_minmax(200px,1fr)] xl:gap-4 xl:px-4 2xl:grid-cols-[40px_minmax(0,2.2fr)_minmax(0,1.25fr)_minmax(120px,0.8fr)_minmax(270px,1fr)]',
        isSelected
          ? 'bg-white/10 border border-white/20 text-white'
          : isActive
            ? 'bg-hover'
            : 'hover:bg-hover/50'
      )}
      style={{
        height: `${viewMode === 'compact' ? rowHeight : size}px`,
        transform: `translateY(${top}px)`
      }}
    >
      {/* Index / Animated Soundwave / Checkmark / Play-Pause Icon */}
      <div className="relative flex h-5 items-center justify-center text-center font-medium">
        {isSelected ? (
          <div className="flex items-center justify-center text-primary">
            <Check className="h-4 w-4 stroke-[2.5]" />
          </div>
        ) : hasMultiSelection ? (
          <div className="h-3.5 w-3.5 rounded border border-border/70 group-hover:border-primary flex items-center justify-center transition-colors" />
        ) : isActive && isPlaying ? (
          <>
            <span className="group-hover:hidden">
              <AnimatedPlayingWave />
            </span>
            <span className="hidden group-hover:flex items-center justify-center text-primary">
              <Pause className="h-4 w-4 fill-current" />
            </span>
          </>
        ) : isActive && !isPlaying ? (
          <>
            <span className="text-primary group-hover:hidden text-xs">❚❚</span>
            <span className="hidden group-hover:flex items-center justify-center text-primary">
              <Play className="h-4 w-4 fill-current ml-0.5" />
            </span>
          </>
        ) : (
          <>
            <span className="text-text-muted group-hover:hidden text-xs tabular-nums">
              {index + 1}
            </span>
            <span className="hidden group-hover:flex items-center justify-center text-text">
              <Play className="h-4 w-4 fill-current ml-0.5" />
            </span>
          </>
        )}
      </div>

      {/* Title + Artwork + Artist */}
      <div className="flex items-center gap-3 overflow-hidden">
        <div
          className={cn(
            'relative rounded-md bg-surface-elevated shrink-0 shadow-sm flex items-center justify-center overflow-hidden border border-border/30',
            viewMode === 'compact' ? 'h-8 w-8' : 'h-10 w-10'
          )}
        >
          <ArtworkImage
            src={artworkUrl}
            title={song.title}
            artist={song.artist}
            className="absolute inset-0 h-full w-full object-cover"
            fallbackIcon={<span className="text-[8px] text-text-muted font-bold">Art</span>}
          />
        </div>
        <div className="flex flex-col overflow-hidden">
          <span
            className={cn(
              'font-semibold truncate text-sm',
              isActive ? 'text-primary' : 'text-text'
            )}
          >
            <HighlightMatch text={song.title} query={searchQuery} />
          </span>
          <div className="text-[12px] truncate max-w-full text-text-muted">
            <ArtistLinks
              artist={song.artist}
              artists={song.artists}
              linkClassName="text-text-muted hover:text-text hover:underline text-[12px]"
            />
          </div>
        </div>
      </div>

      {/* Album Column */}
      <div
        onClick={onAlbumClick}
        title={song.album ? `Go to album: ${song.album}` : undefined}
        className="hidden min-w-0 truncate text-xs text-text-muted hover:underline hover:text-text md:block cursor-pointer"
      >
        {song.album ? <HighlightMatch text={song.album} query={searchQuery} /> : '-'}
      </div>

      {/* Date Added Column */}
      <div
        className="hidden min-w-0 truncate text-xs text-text-muted xl:block"
        title={
          song.dateAdded
            ? new Date(song.dateAdded > 1e11 ? song.dateAdded : song.dateAdded * 1000).toLocaleString()
            : undefined
        }
      >
        {formatRelativeDate(song.dateAdded)}
      </div>

      {/* Quality Badges + Duration + Menu Actions */}
      <div className="flex min-w-0 items-center justify-end gap-2 pr-1 text-text-muted xl:gap-3 xl:pr-2">
        <div className="hidden xl:flex items-center shrink-0 min-w-[84px] justify-start">
          <QualityPill song={song} />
        </div>
        <SongAddButton
          song={song}
          size="sm"
          className={cn(!song.isFavorite && 'hidden md:flex')}
        />
        <span className="shrink-0 text-xs tabular-nums text-text-muted min-w-[38px] text-right">
          {formatDuration(song.duration)}
        </span>
        <span className="hidden shrink-0 text-[11px] font-mono text-text-muted/60 min-w-[58px] text-right 2xl:inline">
          {formatSize(song.size)}
        </span>
        <button
          type="button"
          onClick={onMenuOpen}
          title="More options"
          className={cn(
            'h-7 w-7 shrink-0 rounded-md flex items-center justify-center transition-all cursor-pointer',
            isMenuActive
              ? 'opacity-100 text-text bg-hover'
              : 'opacity-70 md:opacity-0 text-text-muted md:group-hover:opacity-100 hover:text-text hover:bg-hover'
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
