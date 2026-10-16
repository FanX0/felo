import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import { Artwork } from './Artwork'
import { formatSongDuration } from '../utils'
import type { SearchItem } from '../types'

interface RecentlyPlayedListProps {
  songs: SearchItem[]
  onPlay: (item: SearchItem) => void
}

export function RecentlyPlayedList({ songs, onPlay }: RecentlyPlayedListProps): ReactNode {
  return (
    <div className="w-full overflow-hidden border border-border/30 rounded-xl bg-surface-elevated/30">
      <div className="grid grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 border-b border-border/20 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted md:px-4">
        <div className="text-center">#</div>
        <div>Title</div>
        <div>Artist</div>
        <div>Album</div>
        <div className="text-right">Time</div>
      </div>
      <div className="divide-y divide-border/10">
        {songs.map((song, index) => (
          <button
            type="button"
            key={song.id}
            onClick={() => onPlay(song)}
            className="group grid w-full grid-cols-[36px_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_64px] items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-elevated md:px-4 cursor-pointer"
          >
            <span className="text-center text-text-muted tabular-nums group-hover:hidden">
              {index + 1}
            </span>
            <span className="hidden group-hover:flex items-center justify-center text-primary">
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </span>
            <div className="flex items-center gap-3 min-w-0">
              <Artwork item={song} className="w-8 h-8 rounded shrink-0" />
              <span className="min-w-0 truncate font-semibold text-text group-hover:text-primary transition-colors">
                {song.title}
              </span>
            </div>
            <span className="min-w-0 truncate text-text-muted text-xs">
              <ArtistLinks
                artist={song.artist}
                artists={song.localSong?.artists}
                linkClassName="text-text-muted hover:text-text hover:underline text-xs"
              />
            </span>
            <span className="min-w-0 truncate text-text-muted text-xs">{song.album || '-'}</span>
            <span className="text-right text-text-muted tabular-nums text-xs">
              {formatSongDuration(song.localSong?.duration || 0)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
