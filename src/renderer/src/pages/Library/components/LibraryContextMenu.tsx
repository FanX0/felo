import {
  Laptop2,
  Download,
  Play,
  ListPlus,
  Radio,
  Disc3,
  User,
  ChevronRight,
  FileText,
  Share2,
  FolderOpen,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { parseArtists } from '../../../lib/artistParser'
import { remoteClient } from '../../Remote/remoteClient'
import { resolveSongDownloadUrl } from '../../../lib/songAudioResolver'
import { AppCapabilities } from '../../../lib/appConfig'
import type { Song, ActiveMenuState } from '../types'
import type { DownloadTarget } from '../../../components/DownloadPanel/DownloadPanel'

interface LibraryContextMenuProps {
  activeMenu: ActiveMenuState
  isRemoteConnected: boolean
  onClose: () => void
  onPlaySong: (index: number) => void
  onEnqueueSong: (song: Song) => void
  onStartSongRadio: (song: Song) => void
  onStartArtistRadio: (artist: string) => void
  onGoToAlbum: (artist: string, album: string) => void
  onGoToArtist: (artist: string) => void
  onShowCredits: (song: Song) => void
  onShareSong: (song: Song) => void
  onShowInExplorer: (song: Song) => void
  onRemoveSong: (song: Song) => void
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

export function LibraryContextMenu({
  activeMenu,
  isRemoteConnected,
  onClose,
  onPlaySong,
  onEnqueueSong,
  onStartSongRadio,
  onStartArtistRadio,
  onGoToAlbum,
  onGoToArtist,
  onShowCredits,
  onShareSong,
  onShowInExplorer,
  onRemoveSong,
  onOpenDownloadPanel
}: LibraryContextMenuProps) {
  const song = activeMenu.song

  return (
    <div
      className="fixed z-[9999] w-[250px] rounded-xl border border-white/15 bg-[#1a1a1a] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.8),0_2px_8px_rgba(0,0,0,0.4)] backdrop-blur-md"
      style={{ left: activeMenu.x, top: activeMenu.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {isRemoteConnected && (
        <>
          <button
            type="button"
            onClick={() => {
              void remoteClient.play(song.id)
              onClose()
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-semibold text-text hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Laptop2 className="h-3.5 w-3.5" />
            Play on PC
          </button>
          <button
            type="button"
            onClick={() => {
              const downloadUrl = resolveSongDownloadUrl(song)
              if (downloadUrl) {
                const a = document.createElement('a')
                a.href = downloadUrl
                a.setAttribute('download', '')
                a.target = '_blank'
                a.rel = 'noopener noreferrer'
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
              } else {
                void remoteClient.downloadSong(song.id, song.title)
              }
              onClose()
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Transfer / Download to Phone
          </button>
          <div className="my-1 border-t border-white/10" />
        </>
      )}

      <button
        type="button"
        onClick={() => {
          onPlaySong(activeMenu.index)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <Play className="h-3.5 w-3.5 fill-current" />
        Play
      </button>

      <button
        type="button"
        onClick={() => {
          onEnqueueSong(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <ListPlus className="h-3.5 w-3.5" />
        Add to Queue
      </button>

      <button
        type="button"
        onClick={() => {
          onStartSongRadio(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <Radio className="h-3.5 w-3.5 text-primary-amber" />
        Start Song Radio
      </button>

      {song.artist && (
        <button
          type="button"
          onClick={() => {
            onStartArtistRadio(song.artist || '')
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <Radio className="h-3.5 w-3.5 text-primary-amber" />
          Start Artist Radio
        </button>
      )}

      {song.album && (
        <button
          type="button"
          onClick={() => {
            onGoToAlbum(song.artist || 'Unknown Artist', song.album || '')
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <Disc3 className="h-3.5 w-3.5" />
          Go to Album
        </button>
      )}

      {(() => {
        const menuArtists = song.artists?.length
          ? song.artists
          : parseArtists(song.artist)

        if (menuArtists.length <= 1) {
          const artistName = menuArtists[0]?.name || song.artist || 'Unknown Artist'
          return (
            <button
              type="button"
              onClick={() => {
                onGoToArtist(artistName)
                onClose()
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
            >
              <User className="h-3.5 w-3.5" />
              Go to Artist
            </button>
          )
        }

        const isNearRightEdge = activeMenu.x > window.innerWidth - 440
        const isNearBottomEdge = activeMenu.y > window.innerHeight - 250

        return (
          <div className="relative group/artist-sub">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <User className="h-3.5 w-3.5" />
                <span>Go to Artist</span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-text-muted/60 transition-transform group-hover/artist-sub:translate-x-0.5" />
            </button>
            <div
              className={`absolute ${
                isNearRightEdge ? 'right-full mr-1' : 'left-full ml-1'
              } ${
                isNearBottomEdge ? 'bottom-0' : 'top-0'
              } hidden group-hover/artist-sub:flex flex-col min-w-[200px] rounded-lg border border-border/80 bg-surface-elevated/95 p-1.5 shadow-2xl backdrop-blur-md z-50`}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border/40 mb-1">
                Track Artists
              </div>
              {menuArtists.map((a, i) => (
                <button
                  key={`${a.name}-${i}`}
                  type="button"
                  onClick={() => {
                    onGoToArtist(a.name)
                    onClose()
                  }}
                  className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-white/10 hover:text-text transition-colors cursor-pointer"
                >
                  <span className="truncate pr-2">{a.name}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-white/5 text-text-muted/70">
                    {i === 0 && a.role !== 'featured' ? 'Lead' : 'Feat'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      <button
        type="button"
        onClick={() => {
          onShowCredits(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <FileText className="h-3.5 w-3.5" />
        Show Credits
      </button>

      <button
        type="button"
        onClick={() => {
          onShareSong(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share to Friend Chat
      </button>

      <button
        type="button"
        onClick={() => {
          onShowInExplorer(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        Open file location
      </button>

      {AppCapabilities.downloads && (
        <button
          type="button"
          onClick={() => {
            onOpenDownloadPanel?.({
              id: song.id,
              title: song.title,
              artist: song.artist,
              album: song.album || '',
              duration: song.duration || 0,
              filePath: song.filePath,
              artworkPath: song.artworkPath,
              size: song.size,
              sampleRate: song.sampleRate,
              isOnline: false,
              autoDownload: false,
              autoPlay: false
            })
            onClose()
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Replace Audio / Re-download
        </button>
      )}

      <div className="mx-2 my-1 h-px bg-white/10" />

      <button
        type="button"
        onClick={() => {
          onRemoveSong(song)
          onClose()
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs text-danger transition-colors hover:bg-danger/10 cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5 fill-current" />
        Remove from Library
      </button>
    </div>
  )
}
