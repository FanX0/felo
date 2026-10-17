import { Download, Loader2, MoreVertical, Play } from 'lucide-react'
import { toMediaUrl } from '../../../lib/media'
import { ArtworkImage } from '../../Home/components/ArtworkImage'
import ArtistLinks from '../../../components/Common/ArtistLinks'
import SongAddButton from '../../../components/Common/SongAddButton'
import { AppCapabilities } from '../../../lib/appConfig'
import type { Song } from '../../Library/Library'
import { formatBytes, formatDuration, formatRelativeDate, qualityLabel } from '../utils'

interface PlaylistTrackRowProps {
  song: Song & { playlistDateAdded?: number; playlistSortOrder?: number }
  index: number
  isCurrent: boolean
  isPlayingSong: boolean
  isDownloaded: boolean
  downloadTransfer?: { status: string; progress: number }
  onTrackClick: (song: Song) => void
  onPlayOrDownload: (song: Song) => void
  onDownloadTrack: (song: Song) => void
  onOpenMenu: (song: Song, rect: DOMRect) => void
}

export function PlaylistTrackRow({
  song,
  index,
  isCurrent,
  isPlayingSong,
  isDownloaded,
  downloadTransfer,
  onTrackClick,
  onPlayOrDownload,
  onDownloadTrack,
  onOpenMenu
}: PlaylistTrackRowProps) {
  const songArtwork = toMediaUrl(song.artworkPath) || song.artworkUrl

  return (
    <div
      onClick={() => onTrackClick(song)}
      onDoubleClick={(event) => event.preventDefault()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenMenu(song, e.currentTarget.getBoundingClientRect())
      }}
      className={`group grid h-16 w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_76px] items-center gap-2 rounded px-2 text-sm hover:bg-white/10 md:grid-cols-[32px_minmax(0,2fr)_minmax(0,1fr)_64px] md:gap-3 xl:grid-cols-[32px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_minmax(0,1.1fr)_64px] xl:gap-4 xl:px-4 cursor-pointer ${
        isCurrent ? 'bg-white/10' : !isDownloaded ? 'opacity-75 hover:opacity-100' : ''
      }`}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onPlayOrDownload(song)
        }}
        className={`relative flex h-8 items-center justify-start cursor-pointer ${
          isPlayingSong ? 'text-primary' : 'text-text-muted'
        }`}
      >
        <span className="group-hover:hidden">{index + 1}</span>
        {isDownloaded ? (
          <Play
            className={`hidden h-4 w-4 fill-current group-hover:block ${
              isPlayingSong ? 'text-primary' : 'text-white'
            }`}
          />
        ) : (
          <Download className="hidden h-4 w-4 text-white group-hover:block" />
        )}
      </button>

      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-surface border border-border">
          <ArtworkImage
            src={songArtwork}
            title={song.title}
            artist={song.artist}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[15px] font-semibold ${
                isPlayingSong ? 'text-primary' : 'text-white'
              }`}
            >
              {song.title}
            </span>
            {!isDownloaded && (
              <span className="shrink-0 rounded bg-surface-elevated border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                Missing
              </span>
            )}
          </div>
          <div className="block max-w-full truncate text-left text-xs text-text-muted">
            <ArtistLinks
              artist={song.artist}
              artists={song.artists}
              linkClassName="text-text-muted hover:text-white hover:underline text-xs"
              separatorClassName="text-text-muted/60"
            />
          </div>
        </div>
      </div>

      <div className="hidden min-w-0 truncate text-text-muted text-xs md:block">
        {song.album || 'Unknown Album'}
      </div>

      <div
        className="hidden min-w-0 truncate text-text-muted text-xs xl:block"
        title={new Date((song.playlistDateAdded || song.dateAdded || 0) * 1000).toLocaleString()}
      >
        {formatRelativeDate(song.playlistDateAdded || song.dateAdded || 0)}
      </div>

      <div className="hidden min-w-0 items-center gap-2 overflow-hidden text-text-muted xl:flex">
        {isDownloaded ? (
          <>
            <span className="hidden shrink-0 font-mono text-xs text-text-muted 2xl:inline">
              {formatBytes(song.size)}
            </span>
            <span className="truncate">{qualityLabel(song)}</span>
          </>
        ) : AppCapabilities.downloads ? (
          downloadTransfer ? (
            <span className="flex items-center gap-1.5 text-xs text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Downloading ({downloadTransfer.progress || 0}%)...
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDownloadTrack(song)
              }}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-white transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download track</span>
            </button>
          )
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2">
        {!isDownloaded && AppCapabilities.downloads && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDownloadTrack(song)
            }}
            title="Download to library"
            className="h-8 w-8 shrink-0 rounded-[3px] flex items-center justify-center text-text-muted hover:text-white transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
          >
            <Download className="h-4 w-4" />
          </button>
        )}
        <SongAddButton song={song} size="sm" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onOpenMenu(song, event.currentTarget.getBoundingClientRect())
          }}
          className="h-8 w-8 shrink-0 rounded-[3px] flex items-center justify-center text-[#a7a7a7] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        <span className="tabular-nums text-[#c4cad4] group-hover:hidden">
          {formatDuration(song.duration)}
        </span>
      </div>
    </div>
  )
}
