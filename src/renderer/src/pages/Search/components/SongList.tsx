import { Play, Pause, Download, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'
import { AppCapabilities } from '../../../lib/appConfig'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import SongAddButton from '../../../components/Common/SongAddButton'
import { HighlightMatch } from '../../../components/Common/HighlightMatch'
import { Artwork } from './Artwork'
import type { SearchItem } from '../types'
import type { Song } from '../../Library/Library'

interface SongListProps {
  songs: SearchItem[]
  query?: string
  onPlay: (item: SearchItem) => void | Promise<void>
  onDownload: (item: SearchItem) => void
  onChooseSource: (item: SearchItem) => void
  isLocal: (item: SearchItem) => Song | undefined
  fullView?: boolean
}

export function SongList({
  songs,
  query,
  onPlay,
  onDownload,
  onChooseSource,
  isLocal,
  fullView = false
}: SongListProps) {
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const queue = usePlayerStore((s) => s.queue)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const transfers = useDownloadStore((s) => s.transfers)
  const currentTrack = queue[currentSongIndex]

  return (
    <div className={cn('flex flex-col', fullView && 'border border-border/30 rounded-xl overflow-hidden bg-surface-elevated/20')}>
      {fullView && (
        <div className="grid grid-cols-[36px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px] items-center gap-3 border-b border-border/30 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-muted md:px-4">
          <div className="text-center">#</div>
          <div>Title</div>
          <div className="hidden md:block">Artist</div>
          <div className="hidden lg:block">Album</div>
          <div className="text-right pr-2">Duration</div>
        </div>
      )}
      {songs.map((song, index) => {
        const localSong = isLocal(song)
        const isCurrentSong =
          currentTrack &&
          ((localSong && currentTrack.id === localSong.id) ||
            (song.localSong && currentTrack.id === song.localSong.id) ||
            (currentTrack.title.toLowerCase() === song.title.toLowerCase() &&
              (!song.artist ||
                currentTrack.artist.toLowerCase().includes(song.artist.toLowerCase()))))
        const isSongPlaying = isCurrentSong && isPlaying

        const transfer = transfers.find(
          (t) =>
            t.title.toLowerCase() === song.title.toLowerCase() &&
            (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
            (t.status === 'downloading' || t.status === 'queued')
        )
        const isDownloading = Boolean(transfer)

        return (
          <div
            role="button"
            tabIndex={0}
            key={song.id || `${song.title}-${index}`}
            onClick={() => {
              if (localSong || !AppCapabilities.downloads) {
                onPlay(song)
              } else {
                onChooseSource(song)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (localSong || !AppCapabilities.downloads) {
                  onPlay(song)
                } else {
                  onChooseSource(song)
                }
              }
            }}
            className={cn(
              'flex items-center justify-between gap-4 px-3 rounded-lg hover:bg-surface-elevated group text-left transition-colors cursor-pointer',
              fullView ? 'h-14 md:px-4 border-b border-border/10 last:border-b-0' : 'h-14'
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              {fullView && (
                <span className="w-5 text-center text-xs text-text-muted tabular-nums shrink-0">
                  {index + 1}
                </span>
              )}

              <div className="relative group/art shrink-0">
                <Artwork item={song} className="w-10 h-10 rounded-md" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onPlay(song)
                  }}
                  title={isSongPlaying ? 'Pause' : 'Play'}
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-md bg-black/60 transition-opacity cursor-pointer',
                    isSongPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  {isSongPlaying ? (
                    <Pause className="w-4 h-4 fill-white text-white" />
                  ) : (
                    <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-sm font-semibold truncate',
                      isCurrentSong ? 'text-primary' : 'text-text'
                    )}
                  >
                    <HighlightMatch text={song.title} query={query} />
                  </span>
                  {song.explicit && (
                    <span className="text-[9px] font-bold px-1 rounded bg-surface-elevated text-text-muted border border-border/40">
                      E
                    </span>
                  )}
                  {localSong && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60">
                      In Library
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted truncate mt-0.5">
                  <ArtistLinks
                    artist={song.artist}
                    artists={song.localSong?.artists || (localSong ? localSong.artists : undefined)}
                    linkClassName="text-xs text-text-muted hover:text-text hover:underline"
                  />
                  {fullView && song.album && (
                    <span className="md:hidden opacity-75"> • {song.album}</span>
                  )}
                </div>
              </div>
            </div>

            {fullView && (
              <div className="hidden lg:block min-w-0 max-w-[200px] truncate text-xs text-text-muted">
                {song.album || '-'}
              </div>
            )}

            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
              <SongAddButton
                song={
                  localSong || {
                    id: song.id,
                    title: song.title,
                    artist: song.artist,
                    album: song.album || '',
                    duration: 0,
                    artworkUrl: song.thumbnail,
                    isFavorite: song.localSong?.isFavorite
                  }
                }
                size="sm"
              />
              {song.duration && (
                <span className="text-xs text-text-muted tabular-nums">{song.duration}</span>
              )}

              {AppCapabilities.downloads && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (localSong) {
                      onChooseSource(song)
                    } else {
                      onDownload(song)
                    }
                  }}
                  title={
                    isDownloading
                      ? `Downloading (${transfer?.progress || 0}%)...`
                      : localSong
                        ? 'In your library (Click to choose source or replace)'
                        : 'Download track to library'
                  }
                  className={cn(
                    'h-8 w-8 flex items-center justify-center rounded-full transition-all cursor-pointer',
                    isDownloading
                      ? 'text-primary'
                      : localSong
                        ? 'text-text-muted hover:text-white hover:bg-white/10'
                        : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                  )}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : localSong ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
