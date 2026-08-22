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
  MessageCircle,
  Radio,
  Users,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'

interface SidebarProps {
  isOpen?: boolean
  onToggle?: () => void
}

type UpdateStatus = Awaited<ReturnType<Window['api']['checkForUpdates']>>

export default function Sidebar({ isOpen = true, onToggle }: SidebarProps) {
  const [songCount, setSongCount] = useState<number>(0)
  const [isScanning, setIsScanning] = useState<boolean>(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const {
    transfers,
    isTransfersOpen,
    setTransfersOpen,
    toggleTransfers,
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
    } catch (err) {
      console.error('Failed to load song count:', err)
    }
  }

  useEffect(() => {
    loadStats()
    const handleLibraryUpdate = () => loadStats()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    return () => window.removeEventListener('felo:library-updated', handleLibraryUpdate)
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

  const handleAddFolder = async () => {
    try {
      if (!window.api) {
        alert('This feature requires running in the Electron desktop app.')
        return
      }
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        setIsScanning(true)
        await window.api.scanLibrary(folderPath)
        setIsScanning(false)
        await loadStats()
      }
    } catch (err) {
      console.error('Error adding folder from sidebar:', err)
      setIsScanning(false)
    }
  }

  return (
    <aside className="w-full text-text-muted flex flex-col h-full select-none bg-canvas">
      {/* Draggable header area above sidebar content */}
      <div className="h-10 draggable-header w-full shrink-0"></div>

      <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-6">
        {/* Your Library Section */}
        <div>
          <div className="flex items-center justify-between text-text-muted hover:text-text transition-colors group mb-4 px-2">
            <div className="flex items-center gap-3 font-bold text-[15px] tracking-wide">
              Your Library
            </div>
            <div className="flex items-center gap-1 no-drag">
              <button
                onClick={handleAddFolder}
                title="Add Music Folder"
                disabled={isScanning}
                className="p-1 rounded-full text-text-muted opacity-0 transition-colors hover:bg-hover hover:text-text group-hover:opacity-100"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onToggle}
                title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-text"
              >
                {isOpen ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <NavLink
              to="/library"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-2 py-2 rounded-md no-drag transition-colors',
                  isActive ? 'bg-surface-elevated' : 'hover:bg-hover/50'
                )
              }
            >
              <div className="w-10 h-10 rounded-md bg-gradient-to-br from-violet-500 via-indigo-400 to-cyan-200 flex items-center justify-center shrink-0 shadow-md">
                <Music2 className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-[15px] font-bold text-text truncate">Local Songs</span>
                <span className="text-[12px] text-text-muted truncate">{songCount} songs</span>
              </div>
            </NavLink>

            <NavLink
              to="/playlists"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-2 py-2 rounded-md no-drag transition-colors',
                  isActive ? 'bg-surface-elevated' : 'hover:bg-hover/50'
                )
              }
            >
              <div className="w-10 h-10 rounded-md bg-gradient-to-br from-sky-500 to-cyan-300 flex items-center justify-center shrink-0 shadow-md">
                <ListMusic className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-[15px] font-bold text-text truncate">Your Playlists</span>
                <span className="text-[12px] text-text-muted truncate">Local Playlists</span>
              </div>
            </NavLink>
          </div>
        </div>

        <div>
          <div className="mb-2 px-2 text-[11px] font-bold uppercase text-text-muted">Online</div>
          <div className="flex flex-col gap-1">
            <NavLink to="/chat" className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2.5 no-drag transition-colors', isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/50')}>
              <MessageCircle className="h-5 w-5 shrink-0" /><span className="truncate text-sm font-bold">Chat</span>
            </NavLink>
            <NavLink to="/shared-playlists" className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2.5 no-drag transition-colors', isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/50')}>
              <Users className="h-5 w-5 shrink-0" /><span className="truncate text-sm font-bold">Together playlists</span>
            </NavLink>
            <NavLink to="/listen-together" className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2.5 no-drag transition-colors', isActive ? 'bg-surface-elevated text-text' : 'hover:bg-hover/50')}>
              <Radio className="h-5 w-5 shrink-0" /><span className="truncate text-sm font-bold">Listen together</span>
            </NavLink>
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
            {updateStatus?.status === 'available'
              ? updateStatus.latestVersion
              : updateStatus?.currentVersion || '1.0.0'}
          </span>
        </button>
      </div>

      {/* Transfers / Download Footer */}
      <div className="relative border-t border-border/40 bg-surface">
        {isTransfersOpen && (
          <div className="absolute bottom-full left-0 right-0 z-50 h-[380px] max-h-[70vh] overflow-hidden rounded-t-xl border border-border/70 border-b-0 bg-[#181818] shadow-[0_-8px_24px_rgba(0,0,0,0.6)]">
            <div className="flex h-14 items-center justify-between border-b border-border/60 bg-black/20 px-4">
              <div className="flex items-center gap-2">
                <DownloadCloud className="h-5 w-5 text-success" />
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
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-black/25 text-success">
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
                              <span className="shrink-0 tabular-nums text-success">
                                {progress}%
                              </span>
                            </div>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/30">
                              <div
                                className="h-full bg-success transition-[width]"
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
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-success text-black transition-transform hover:scale-105"
                              >
                                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeTransfer(transfer.id)}
                              title="Remove transfer"
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
                  <Download className="h-4 w-4 text-success" />
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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-success/30 bg-success/10 text-success">
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
    </aside>
  )
}
