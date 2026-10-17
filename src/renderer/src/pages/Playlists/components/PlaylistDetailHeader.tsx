import { useState } from 'react'
import {
  Download,
  Globe,
  Heart,
  Loader2,
  MoreVertical,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Shuffle,
  Trash2
} from 'lucide-react'
import { AppCapabilities } from '../../../lib/appConfig'
import type { Playlist } from '../types'

interface PlaylistDetailHeaderProps {
  playlist: Playlist
  artworkUrl?: string | null
  songsCount: number
  downloadedCount: number
  missingCount: number
  isCurrentPlaylist: boolean
  isPlaying: boolean
  isShuffle: boolean
  isDownloadingMissing: boolean
  isPublishing: boolean
  configured: boolean
  initialized: boolean
  hasUser: boolean
  publishMessage: string
  playlistActionError: string
  setPlaylistActionError: (err: string) => void
  onTogglePlay: () => void
  onShuffle: () => void
  onDownloadMissing: () => void
  onAddSongs: () => void
  onPublish: () => void
  onRename: (newName: string) => Promise<void>
  onDelete: () => Promise<void>
}

export function PlaylistDetailHeader({
  playlist,
  artworkUrl,
  songsCount,
  downloadedCount,
  missingCount,
  isCurrentPlaylist,
  isPlaying,
  isShuffle,
  isDownloadingMissing,
  isPublishing,
  configured,
  initialized,
  hasUser,
  publishMessage,
  playlistActionError,
  setPlaylistActionError,
  onTogglePlay,
  onShuffle,
  onDownloadMissing,
  onAddSongs,
  onPublish,
  onRename,
  onDelete
}: PlaylistDetailHeaderProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renameValue.trim() || isRenaming) return
    setIsRenaming(true)
    try {
      await onRename(renameValue.trim())
      setIsRenameOpen(false)
    } finally {
      setIsRenaming(false)
    }
  }

  return (
    <>
      <header className="relative z-10 flex flex-col sm:flex-row items-center sm:items-end text-center sm:text-left gap-5 sm:gap-8 px-4 sm:px-6 md:px-10 pb-6 sm:pb-8 pt-6 sm:pt-10">
        <div className="flex h-40 w-40 sm:h-[232px] sm:w-[232px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#222] shadow-[0_4px_60px_rgba(0,0,0,0.5)]">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
          ) : playlist.id === 'liked' ? (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#450af5] to-[#8e8ee5] shadow-inner">
              <Heart className="h-20 w-20 sm:h-24 sm:w-24 fill-white text-white drop-shadow-md" />
            </div>
          ) : (
            <Music2 className="h-16 w-16 sm:h-20 sm:w-20 fill-[#5a5a5a] text-[#5a5a5a]" />
          )}
        </div>
        <div className="min-w-0 pb-1">
          <div className="mb-2 sm:mb-3 text-xs font-black uppercase tracking-[1px]">Playlist</div>
          <h1 className="max-w-full break-words text-2xl sm:text-4xl md:text-6xl xl:text-8xl font-black leading-tight sm:leading-[0.95] tracking-tight">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-2 sm:mt-4 max-w-2xl text-xs sm:text-sm text-white/70">{playlist.description}</p>
          )}
          <div className="mt-3 sm:mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs sm:text-sm">
            <span className="font-bold">
              {songsCount} {songsCount === 1 ? 'song' : 'songs'}
            </span>
            {AppCapabilities.downloads && (
              <span className="text-white/65">
                ({downloadedCount} downloaded
                {missingCount > 0 ? `, ${missingCount} not downloaded` : ''})
              </span>
            )}
            <span className="text-white/65">•</span>
            <span>Created {new Date(playlist.dateCreated * 1000).toLocaleDateString()}</span>
          </div>
        </div>
      </header>

      <div className="relative z-30 flex flex-wrap items-center gap-3 sm:gap-6 px-4 sm:px-6 md:px-10 py-4 sm:py-7">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={songsCount === 0}
          title={
            songsCount === 0
              ? 'Playlist has no songs'
              : isCurrentPlaylist && isPlaying
                ? 'Pause playlist'
                : 'Play playlist'
          }
          className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-lg transition-all hover:scale-105 hover:bg-white/90 disabled:opacity-40 cursor-pointer"
        >
          {isCurrentPlaylist && isPlaying ? (
            <Pause className="h-6 w-6 fill-current" />
          ) : (
            <Play className="ml-1 h-6 w-6 fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={onShuffle}
          disabled={songsCount === 0}
          title="Shuffle Playlist"
          className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold transition-all hover:scale-105 cursor-pointer ${
            isShuffle
              ? 'border-white bg-white/10 text-white'
              : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
          } disabled:opacity-40`}
        >
          <Shuffle className="h-4 w-4" />
          <span>Shuffle</span>
        </button>

        {AppCapabilities.downloads && (
          missingCount > 0 ? (
            <button
              type="button"
              onClick={onDownloadMissing}
              title={
                isDownloadingMissing
                  ? 'Click to stop downloading missing tracks'
                  : `Download ${missingCount} missing tracks 1 by 1`
              }
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold shadow-md transition-all cursor-pointer ${
                isDownloadingMissing
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-border/60 bg-surface-elevated text-white hover:bg-hover'
              }`}
            >
              {isDownloadingMissing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                  <span>Downloading missing ({missingCount} left)...</span>
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  <span>Download missing ({missingCount})</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled
              title="All playlist tracks are stored locally"
              className="text-[#b3b3b3] disabled:opacity-50"
            >
              <Download className="h-9 w-9" />
            </button>
          )
        )}

        <button
          type="button"
          onClick={onAddSongs}
          title="Add songs"
          className="text-[#b3b3b3] transition-colors hover:text-white cursor-pointer"
        >
          <Plus className="h-10 w-10" />
        </button>

        {playlist.id !== 'liked' && (
          <button
            type="button"
            onClick={onPublish}
            disabled={isPublishing || (configured && !initialized)}
            title={hasUser ? 'Publish playlist to your profile' : 'Sign in to publish to profile'}
            className="flex h-10 items-center gap-2 rounded-full border border-white/20 px-4 text-sm font-bold text-[#d8d8d8] transition-colors hover:border-white/50 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
            <span>{hasUser ? 'Publish to profile' : 'Sign in to publish'}</span>
          </button>
        )}

        {playlist.id !== 'liked' && (
          <div className="relative">
            <button
              type="button"
              title="Playlist options"
              onClick={() => {
                setIsActionsOpen((open) => !open)
                setPlaylistActionError('')
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[#b3b3b3] transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {isActionsOpen && (
              <div className="pointer-events-auto absolute right-0 top-12 z-50 w-52 rounded-lg border border-white/10 bg-[#282828] p-1.5 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(playlist.name)
                    setIsRenameOpen(true)
                    setIsActionsOpen(false)
                    setPlaylistActionError('')
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 cursor-pointer"
                >
                  <Pencil className="h-4 w-4" />
                  <span>Rename playlist</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsActionsOpen(false)
                    void onDelete()
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-red-400 hover:bg-white/10 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Remove playlist</span>
                </button>
              </div>
            )}
          </div>
        )}

        {publishMessage && <span className="text-sm text-text-muted">{publishMessage}</span>}
        {playlistActionError && <span className="text-sm text-red-300">{playlistActionError}</span>}
      </div>

      {isRenameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <form
            onSubmit={handleRenameSubmit}
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#282828] p-5 shadow-2xl"
          >
            <h2 className="text-lg font-black text-white">Rename playlist</h2>
            <p className="mt-1 text-sm text-[#b3b3b3]">Choose a new name for this playlist.</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="mt-4 w-full rounded-md border border-white/15 bg-[#181818] px-3 py-2.5 text-sm text-white outline-none focus:border-white/40"
              maxLength={120}
            />
            {playlistActionError && (
              <p className="mt-2 text-xs text-red-300">{playlistActionError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRenameOpen(false)}
                className="rounded-full px-4 py-2 text-sm font-bold text-[#b3b3b3] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenaming || !renameValue.trim()}
                className="rounded-full bg-white px-5 py-2 text-sm font-black text-black hover:bg-white/90 disabled:opacity-50 cursor-pointer"
              >
                {isRenaming ? 'Saving...' : 'Save name'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
