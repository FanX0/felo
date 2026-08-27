import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  DownloadCloud,
  Loader2,
  Play,
  Plus,
  Music2,
  ListMusic,
  RotateCcw,
  X
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useDownloadStore, type TransferItem } from '../../hooks/useDownloadStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'
import { STREAMING_ACCOUNTS_SETTING } from '../../lib/downloadConfig'
import type { Playlist } from '../../pages/Playlists/types'
import CreatePlaylistModal from '../../pages/Playlists/CreatePlaylistModal'

interface SidebarProps {
  isOpen?: boolean
  onToggle?: () => void
}

type UpdateStatus = Awaited<ReturnType<Window['api']['checkForUpdates']>>

export default function Sidebar({ isOpen = true, onToggle }: SidebarProps) {
  const [songCount, setSongCount] = useState<number>(0)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const {
    transfers,
    isTransfersOpen,
    setTransfersOpen,
    toggleTransfers,
    updateTransfer,
    removeTransfer,
    clearTransfers
  } = useDownloadStore()
  const { setQueue } = usePlayerStore()
  const navigate = useNavigate()

  const loadStats = async () => {
    try {
      if (window.api?.getSongs) {
        const songs = await window.api.getSongs()
        setSongCount(songs?.length || 0)
      }
      if (window.api?.getPlaylists) {
        setPlaylists(((await window.api.getPlaylists()) || []) as Playlist[])
      }
    } catch (err) {
      console.error('Failed to load song count:', err)
    }
  }

  useEffect(() => {
    loadStats()
    const handleLibraryUpdate = () => loadStats()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    window.addEventListener('felo:playlists-updated', handleLibraryUpdate)
    return () => {
      window.removeEventListener('felo:library-updated', handleLibraryUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdate)
      window.removeEventListener('felo:playlists-updated', handleLibraryUpdate)
    }
  }, [])

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const result = await window.api.checkForUpdates()
        if (active) setUpdateStatus(result)
      } catch (error) {
        console.error('Failed to check for updates:', error)
      }
    }

    void check()
    const interval = window.setInterval(check, 6 * 60 * 60 * 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const handleCancelOrRemoveTransfer = async (transfer: TransferItem) => {
    const isActive =
      transfer.status === 'downloading' ||
      transfer.status === 'queued' ||
      transfer.status === 'waiting_connector'

    if (isActive) {
      try {
        await window.api?.cancelDownload?.(transfer.id)
      } catch (err) {
        console.warn('Failed to cancel download:', err)
      }
      updateTransfer(transfer.id, {
        status: 'failed',
        progress: 0,
        message: 'Cancelled'
      })
    } else {
      removeTransfer(transfer.id)
    }
  }

  const handleRetryTransfer = async (transfer: TransferItem) => {
    updateTransfer(transfer.id, {
      status: 'queued',
      progress: 2,
      message: `Retrying ${transfer.sourceName} download...`
    })
    try {
      const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
      const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}
      const res = await window.api?.startDownload?.({
        transferId: transfer.id,
        source: transfer.source,
        resultId: transfer.resultId || '',
        title: transfer.title,
        artist: transfer.artist,
        songId: transfer.song?.id || '',
        conflictMode: transfer.conflictMode,
        accounts
      })
      if (res?.alreadyExists) {
        updateTransfer(transfer.id, {
          status: 'completed',
          progress: 100,
          message: 'Already downloaded'
        })
      }
    } catch (error) {
      updateTransfer(transfer.id, {
        status: 'failed',
        progress: 0,
        message: error instanceof Error ? error.message : 'Retry failed'
      })
    }
  }

  if (!isOpen) {
    return (
      <aside className="flex h-full w-full select-none flex-col items-center bg-canvas text-text-muted">
        <div className="h-10 w-full shrink-0 draggable-header" />

        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            title="Expand library"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text no-drag"
          >
            <ListMusic className="h-5 w-5" />
          </button>

          <NavLink
            to="/library"
            title={`Local Songs - ${songCount} songs`}
            className={({ isActive }) =>
              cn(
                'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#2b2b2b] shadow-sm transition-colors no-drag',
                isActive ? 'ring-2 ring-success' : 'hover:bg-hover'
              )
            }
          >
            <Music2 className="h-5 w-5 text-white" />
          </NavLink>

          {playlists.length > 0 ? (
            playlists.map((playlist) => (
              <NavLink
                key={playlist.id}
                to={`/playlists/${playlist.id}`}
                title={playlist.name}
                className={({ isActive }) =>
                  cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#2b2b2b] shadow-sm transition-colors no-drag',
                    isActive ? 'ring-2 ring-success' : 'hover:bg-hover'
                  )
                }
              >
                {playlist.artworkPath ? (
                  <img
                    src={toMediaUrl(playlist.artworkPath) ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ListMusic className="h-5 w-5 text-text-muted" />
                )}
              </NavLink>
            ))
          ) : (
            <NavLink
              to="/playlists"
              title="Playlists"
              className={({ isActive }) =>
                cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#2b2b2b] shadow-sm transition-colors no-drag',
                  isActive ? 'ring-2 ring-success' : 'hover:bg-hover'
                )
              }
            >
              <ListMusic className="h-5 w-5" />
            </NavLink>
          )}
        </div>

        <div className="w-full border-t border-border/40 bg-surface px-3 py-3">
          <button
            type="button"
            onClick={() => {
              onToggle?.()
              setTransfersOpen(true)
            }}
            title={
              transfers.length === 0
                ? 'Transfers'
                : `${transfers.length} transfer${transfers.length === 1 ? '' : 's'}`
            }
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a] text-[#b3b3b3] transition-colors hover:bg-[#353535] no-drag"
          >
            <Download className="h-4 w-4" />
            {transfers.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                {transfers.length > 9 ? '9+' : transfers.length}
              </span>
            )}
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-full text-text-muted flex flex-col h-full select-none bg-canvas">
      {/* Draggable header area above sidebar content */}
      <div className="h-10 draggable-header w-full shrink-0"></div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {/* Your Library Section */}
        <div className="rounded-lg bg-surface p-2">
          <div className="flex items-center justify-between text-text-muted hover:text-text transition-colors group mb-2 px-2">
            <button
              type="button"
              onClick={onToggle}
              title="Collapse sidebar"
              className="min-w-0 flex items-center gap-2.5 font-black text-[15px] tracking-wide text-white hover:text-white no-drag"
            >
              <ListMusic className="h-5 w-5 shrink-0 text-[#b3b3b3]" />
              <span className="truncate">Your Library</span>
            </button>
            <div className="flex items-center gap-1.5 no-drag">
              <button
                type="button"
                onClick={() => setIsCreatePlaylistOpen(true)}
                title="Create playlist"
                className="flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1 text-xs font-bold text-white transition-all hover:scale-105 active:scale-95 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Create</span>
              </button>

            </div>
          </div>

          <div className="flex flex-col gap-1">
            <NavLink
              to="/library"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-2 py-2 no-drag transition-colors',
                  isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/60'
                )
              }
            >
              <div className="w-12 h-12 rounded bg-[#2b2b2b] flex items-center justify-center shrink-0 shadow-sm">
                <Music2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-[15px] font-bold text-text truncate">Local Songs</span>
                <span className="text-[12px] text-text-muted truncate">
                  Playlist • {songCount} songs
                </span>
              </div>
            </NavLink>

            {playlists.length > 0 ? (
              playlists.map((playlist) => (
                <NavLink
                  key={playlist.id}
                  to={`/playlists/${playlist.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-2 py-2 no-drag transition-colors',
                      isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/60'
                    )
                  }
                >
                  {playlist.artworkPath ? (
                    <img
                      src={toMediaUrl(playlist.artworkPath) ?? undefined}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded object-cover shadow-sm"
                    />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded bg-[#2b2b2b] flex items-center justify-center shadow-sm">
                      <ListMusic className="h-5 w-5 text-text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex flex-col">
                    <span className="truncate text-[15px] font-bold text-text">
                      {playlist.name}
                    </span>
                    <span className="truncate text-[12px] text-text-muted">
                      Playlist • {playlist.songCount || 0} songs
                    </span>
                  </div>
                </NavLink>
              ))
            ) : (
              <NavLink
                to="/playlists"
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-2 py-2 no-drag transition-colors',
                    isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/60'
                  )
                }
              >
                <div className="h-12 w-12 shrink-0 rounded bg-[#2b2b2b] flex items-center justify-center shadow-sm">
                  <ListMusic className="h-5 w-5 text-text-muted" />
                </div>
                <div className="min-w-0 flex flex-col">
                  <span className="truncate text-[15px] font-bold text-text">
                    Create your first playlist
                  </span>
                  <span className="truncate text-[12px] text-text-muted">Playlist • 0 songs</span>
                </div>
              </NavLink>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto p-4 pb-3">
        <button
          type="button"
          onClick={() => {
            if (updateStatus?.status === 'available' && updateStatus.releaseUrl) {
              void window.api.openExternal(updateStatus.releaseUrl)
            } else {
              navigate('/settings')
            }
          }}
          title={
            updateStatus?.status === 'available'
              ? `Felo ${updateStatus.latestVersion} is available on GitHub`
              : updateStatus?.status === 'error'
                ? updateStatus.message
                : updateStatus?.status === 'unavailable'
                  ? 'GitHub update source is not configured'
                  : 'Felo is up to date'
          }
          className={`flex w-full items-center justify-between rounded-md px-4 py-2.5 transition-colors no-drag ${
            updateStatus?.status === 'available'
              ? 'bg-primary-amber/10 hover:bg-primary-amber/15'
              : 'bg-surface hover:bg-hover'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 rounded-full ${
                updateStatus?.status === 'available'
                  ? 'animate-pulse bg-primary-amber'
                  : updateStatus === null
                    ? 'animate-pulse bg-text-muted'
                    : 'bg-success'
              }`}
            />
            <span
              className={`truncate text-left text-[12px] font-bold ${
                updateStatus?.status === 'available' ? 'text-primary-amber' : 'text-text'
              }`}
            >
              {updateStatus?.status === 'available' ? 'Update available' : 'Local-First Engine'}
            </span>
          </div>
          <span className="shrink-0 text-[11px] font-mono text-text-muted">
            v
            {updateStatus?.latestVersion || updateStatus?.currentVersion || '1.0.0'}
          </span>
        </button>
      </div>

      {/* Transfers / Download Footer */}
      <div className="relative border-t border-border/40 bg-surface">
        {isTransfersOpen && (
          <div className="absolute bottom-full left-0 right-0 z-50 h-[380px] max-h-[70vh] overflow-hidden rounded-t-xl border border-border/70 border-b-0 bg-[#181818] shadow-[0_-8px_24px_rgba(0,0,0,0.6)]">
            <div className="flex h-14 items-center justify-between border-b border-border/60 bg-black/20 px-4">
              <div className="flex items-center gap-2">
                <DownloadCloud className="h-5 w-5 text-white" />
                <span className="text-sm font-bold text-text">Transfers & Queue</span>
              </div>
              <button
                type="button"
                onClick={() => setTransfersOpen(false)}
                title="Close transfers panel"
                className="rounded p-1 text-text-muted transition-colors hover:bg-hover hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex h-[calc(100%-56px)] flex-col">
              {transfers.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                  <Download className="h-16 w-16 text-black/45" />
                  <p className="mt-5 text-lg text-text">No recent downloads</p>
                  <p className="mt-2 text-sm text-text-muted/70">
                    Queued transfers will appear here
                  </p>
                </div>
              ) : (
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {transfers.map((transfer) => {
                    const progress = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)))

                    return (
                      <div
                        key={transfer.id}
                        className="rounded-md border border-border/60 bg-surface-elevated p-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a] text-[#b3b3b3]">
                            {transfer.status === 'completed' ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : transfer.status === 'failed' ? (
                              <AlertCircle className="h-4 w-4 text-danger" />
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-text">
                              {transfer.title}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-text-muted">
                              {transfer.sourceName} · {transfer.quality} · {transfer.size}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-medium">
                              <span
                                className={`min-w-0 truncate ${
                                  transfer.status === 'failed' ? 'text-danger' : 'text-warning'
                                }`}
                              >
                                {transfer.message || transfer.status}
                              </span>
                              <span className="shrink-0 tabular-nums text-white">
                                {progress}%
                              </span>
                            </div>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/30">
                              <div
                                className="h-full bg-white transition-[width]"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {transfer.status === 'completed' && transfer.song && (
                              <button
                                type="button"
                                onClick={() => setQueue([transfer.song!], 0)}
                                title="Play downloaded song"
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a2a2a] text-white transition-all hover:scale-105 hover:bg-[#353535]"
                              >
                                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                              </button>
                            )}
                            {transfer.status === 'failed' && (
                              <button
                                type="button"
                                onClick={() => handleRetryTransfer(transfer)}
                                title="Retry download"
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white transition-all hover:scale-105 hover:bg-white/20"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCancelOrRemoveTransfer(transfer)}
                              title={
                                transfer.status === 'downloading' ||
                                transfer.status === 'queued' ||
                                transfer.status === 'waiting_connector'
                                  ? 'Cancel download'
                                  : 'Remove transfer'
                              }
                              className="rounded p-1 text-text-muted hover:bg-hover hover:text-text"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="flex items-center gap-2 border-t border-border/50 p-3">
                <button
                  type="button"
                  onClick={() => navigate('/settings')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border/50 bg-surface-elevated px-3 py-2 text-xs font-bold text-text hover:bg-hover"
                >
                  <Download className="h-4 w-4 text-white" />
                  Download Settings
                </button>
                {transfers.length > 0 && (
                  <button
                    type="button"
                    onClick={clearTransfers}
                    className="rounded-md border border-border/50 px-3 py-2 text-xs font-bold text-text-muted hover:bg-hover hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={toggleTransfers}
          title="Click to view download transfers"
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-hover no-drag"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#2a2a2a] text-[#b3b3b3]">
              <Download className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-text">Transfers</span>
              <span className="block truncate text-[11px] text-text-muted">
                {transfers.length === 0
                  ? 'No recent downloads'
                  : `${transfers.length} transfer${transfers.length === 1 ? '' : 's'} in queue`}
              </span>
            </span>
          </span>
          {isTransfersOpen ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronUp className="h-4 w-4 text-text-muted" />
          )}
        </button>
      </div>

      {isCreatePlaylistOpen && (
        <CreatePlaylistModal
          onClose={() => setIsCreatePlaylistOpen(false)}
          onCreated={(newPlaylist) => {
            setIsCreatePlaylistOpen(false)
            void loadStats()
            navigate(`/playlists/${newPlaylist.id}`)
          }}
        />
      )}
    </aside>
  )
}
