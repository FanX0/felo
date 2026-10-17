import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Disc3,
  Download,
  FileText,
  FolderOpen,
  ListPlus,
  Play,
  Trash2,
  User
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AppCapabilities } from '../../../lib/appConfig'
import { parseArtists } from '../../../lib/artistParser'
import type { Song } from '../../Library/Library'

interface PlaylistSongMenuProps {
  song: Song
  x: number
  y: number
  onClose: () => void
  onPlay: (song: Song) => void
  onEnqueue: (song: Song) => void
  onShowCredits: (song: Song) => void
  onDownloadTrack: (song: Song) => void
  onChooseSource: (song: Song) => void
  onRemove: (songId: string) => void
}

export function PlaylistSongMenu({
  song,
  x,
  y,
  onClose,
  onPlay,
  onEnqueue,
  onShowCredits,
  onDownloadTrack,
  onChooseSource,
  onRemove
}: PlaylistSongMenuProps) {
  const navigate = useNavigate()

  const menuArtists =
    song.artists && song.artists.length > 0
      ? song.artists
      : parseArtists(song.artist)

  const isNearRightEdge = x > window.innerWidth - 440
  const isNearBottomEdge = y > window.innerHeight - 250

  return createPortal(
    <div
      className="fixed z-[9999] w-[220px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)]"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onPlay(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <Play className="h-4 w-4 fill-current" />
        <span>Play</span>
      </button>

      <button
        type="button"
        onClick={() => {
          onEnqueue(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <ListPlus className="h-4 w-4" />
        <span>Add to Queue</span>
      </button>

      {song.album && (
        <button
          type="button"
          onClick={() => {
            navigate(`/album/${encodeURIComponent(song.album || '')}`)
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <Disc3 className="h-4 w-4" />
          <span>Go to Album</span>
        </button>
      )}

      {menuArtists.length <= 1 ? (
        <button
          type="button"
          onClick={() => {
            const artistName = menuArtists[0]?.name || song.artist || 'Unknown Artist'
            navigate(`/artist/${encodeURIComponent(artistName)}`)
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <User className="h-4 w-4" />
          <span>Go to Artist</span>
        </button>
      ) : (
        <div className="relative group/artist-sub">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <User className="h-4 w-4" />
              <span>Go to Artist</span>
            </div>
            <ChevronRight className="h-4 w-4 text-text-muted/60 transition-transform group-hover/artist-sub:translate-x-0.5" />
          </button>
          <div
            className={`absolute ${
              isNearRightEdge ? 'right-full mr-1' : 'left-full ml-1'
            } ${
              isNearBottomEdge ? 'bottom-0' : 'top-0'
            } hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-white/15 bg-[#1a1a1a] p-1.5 shadow-2xl backdrop-blur-md z-50`}
          >
            <div className="px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-white/10 mb-1">
              Track Artists
            </div>
            {menuArtists.map((a, i) => (
              <button
                key={`${a.name}-${i}`}
                type="button"
                onClick={() => {
                  navigate(`/artist/${encodeURIComponent(a.name)}`)
                  onClose()
                }}
                className="flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors cursor-pointer"
              >
                <span className="truncate pr-2">{a.name}</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/5 text-text-muted/70">
                  {i === 0 && a.role !== 'featured' ? 'Lead' : 'Feat'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          onShowCredits(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <FileText className="h-4 w-4" />
        <span>Show Credits</span>
      </button>

      {Boolean(
        song.filePath &&
          !song.filePath.startsWith('virtual:') &&
          !song.filePath.startsWith('http://') &&
          !song.filePath.startsWith('https://')
      ) && (
        <button
          type="button"
          onClick={async () => {
            if (song.filePath) {
              try {
                await window.api?.revealInExplorer?.(song.filePath)
              } catch (err) {
                console.error('Failed to open file location:', err)
              }
            }
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <FolderOpen className="h-4 w-4" />
          <span>Open file location</span>
        </button>
      )}

      {AppCapabilities.downloads && (
        <>
          {(!song.filePath || song.filePath.startsWith('virtual:')) && (
            <button
              type="button"
              onClick={() => {
                onDownloadTrack(song)
                onClose()
              }}
              className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
            >
              <Download className="h-4 w-4" />
              <span>Download to library</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onChooseSource(song)
              onClose()
            }}
            className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Choose download source...</span>
          </button>
        </>
      )}

      <div className="mx-2 my-1 h-px bg-white/10" />

      <button
        type="button"
        onClick={() => {
          onRemove(song.id)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10 cursor-pointer"
      >
        <Trash2 className="h-4 w-4 fill-current" />
        <span>Remove from playlist</span>
      </button>
    </div>,
    document.body
  )
}
