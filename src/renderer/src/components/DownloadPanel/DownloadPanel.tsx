import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Headphones,
  Loader2,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Video,
  X
} from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  DOWNLOAD_SOURCES,
  DownloadConflictMode,
  DownloadSourceId,
  PLAYBACK_STORAGE_SETTING,
  PlaybackStorageMode,
  STREAMING_ACCOUNTS_SETTING
} from '../../lib/downloadConfig'

interface DownloadPanelProps {
  onClose: () => void
  targetSong?: DownloadTarget | null
}

export type DownloadTarget = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  filePath?: string
  artworkPath?: string
  artworkUrl?: string
  size?: number
  sampleRate?: number
  isOnline?: boolean
}

interface StreamingAccounts {
  qobuzAuthMethod?: 'token' | 'password'
  qobuzUser?: string
  qobuzSecret?: string
  qobuzAppId?: string
  qobuzAppSecret?: string
  qobuzQuality?: string
  deezerArl?: string
  deezerQuality?: string
}

interface SourceResult {
  id: string
  title: string
  artist: string
  album: string
  quality: string
  sourceName: string
  size: string
  confidence: string
  meta?: string
}

export default function DownloadPanel({ onClose, targetSong }: DownloadPanelProps) {
  const { queue, currentSongIndex, isPlaying, togglePlay, setQueue } = usePlayerStore()
  const { transfers, queueTransfer, updateTransfer } = useDownloadStore()
  const currentSong = queue[currentSongIndex]
  const panelSong = targetSong || currentSong
  const artworkUrl = targetSong?.artworkUrl || toMediaUrl(panelSong?.artworkPath)
  const isLibraryTrack = Boolean(panelSong?.filePath && !targetSong?.isOnline)
  const [query, setQuery] = useState('')
  const [activeSource, setActiveSource] = useState<DownloadSourceId>('qobuz')
  const [isSearching, setIsSearching] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [conflictMode, setConflictMode] = useState<DownloadConflictMode>('replace')
  const [priority, setPriority] = useState<DownloadSourceId[]>(DEFAULT_DOWNLOAD_PRIORITY)
  const [playbackMode, setPlaybackMode] = useState<PlaybackStorageMode>('stream')
  const [accounts, setAccounts] = useState<StreamingAccounts>({})
  const [sourceResults, setSourceResults] = useState<SourceResult[]>([])
  const [resultCounts, setResultCounts] = useState<Partial<Record<DownloadSourceId, number>>>({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const automaticSearchKey = useRef('')

  useEffect(() => {
    if (panelSong) {
      setQuery(`${panelSong.artist} ${panelSong.title}`)
      setStatusMessage('')
      setSourceResults([])
      setResultCounts({})
      setConflictMode(isLibraryTrack ? 'replace' : 'keep_both')
    }
  }, [panelSong?.id, isLibraryTrack])

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
        const savedMode = await window.api?.getSetting?.(PLAYBACK_STORAGE_SETTING)
        const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
        if (Array.isArray(savedPriority) && savedPriority.length > 0) {
          setPriority(savedPriority)
          setActiveSource(savedPriority[0])
        }
        if (savedMode === 'stream' || savedMode === 'download') {
          setPlaybackMode(savedMode)
        }
        if (savedAccounts && typeof savedAccounts === 'object') {
          setAccounts(savedAccounts)
        }
      } catch (err) {
        console.error('Failed to load download settings:', err)
      } finally {
        setSettingsLoaded(true)
      }
    }
    loadSettings()
  }, [])

  const activeSourceInfo = DOWNLOAD_SOURCES.find((source) => source.id === activeSource)
  const orderedSources = useMemo(
    () => priority.map((id) => DOWNLOAD_SOURCES.find((source) => source.id === id)).filter(Boolean),
    [priority]
  )
  const isQobuzConfigured = Boolean(
    accounts.qobuzUser?.trim() && accounts.qobuzSecret?.trim()
  )
  const isDeezerConfigured = Boolean(
    accounts.deezerArl?.trim() && accounts.deezerArl.trim().length >= 32
  )
  const isActiveSourceConfigured =
    activeSource === 'qobuz'
      ? isQobuzConfigured
      : activeSource === 'deezer'
        ? isDeezerConfigured
        : true
  const handlePlayExisting = () => {
    if (!panelSong || !isLibraryTrack) return
    if (queue[currentSongIndex]?.id === panelSong.id) {
      togglePlay()
      return
    }
    setQueue([panelSong as any], 0)
  }

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    setStatusMessage('')
    setSourceResults([])
    try {
      if (activeSource !== 'qobuz' && activeSource !== 'deezer') {
        throw new Error(`${activeSourceInfo?.name || 'Source'} connector is not installed yet.`)
      }
      if (!isActiveSourceConfigured) {
        throw new Error(
          `${activeSourceInfo?.name || 'Source'} account is not configured completely.`
        )
      }
      const results = await window.api.searchDownloadSource(activeSource, query.trim(), accounts)
      const mappedResults: SourceResult[] = results.map((result: any, index: number) => ({
        id: String(result.id),
        title: result.title || panelSong?.title || query.trim(),
        artist: result.artist || panelSong?.artist || '',
        album: panelSong?.album || 'Track result',
        quality: result.quality || activeSourceInfo?.quality || 'Provider quality',
        sourceName: activeSourceInfo?.name || activeSource,
        size: 'Size calculated during download',
        confidence: index === 0 ? 'Best match' : 'Provider match',
        meta: `Track ID ${result.id}`
      }))
      setSourceResults(mappedResults)
      setResultCounts((counts) => ({ ...counts, [activeSource]: mappedResults.length }))
      setStatusMessage(
        `${activeSourceInfo?.name || 'Source'} returned ${mappedResults.length} real provider matches.`
      )
    } catch (error) {
      setResultCounts((counts) => ({ ...counts, [activeSource]: 0 }))
      setStatusMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSearching(false)
    }
  }

  const handleQueueDownload = async (result: SourceResult) => {
    const transferId = queueTransfer({
      source: activeSource,
      sourceName: result.sourceName,
      title: result.title,
      artist: panelSong?.artist || result.artist,
      quality: result.quality,
      size: result.size,
      conflictMode,
      status: 'queued',
      progress: 2,
      message: `Starting ${result.sourceName} download...`
    })
    try {
      if (activeSource !== 'qobuz' && activeSource !== 'deezer') {
        throw new Error(`${result.sourceName} connector is not installed yet.`)
      }
      await window.api.startDownload({
        transferId,
        source: activeSource,
        resultId: result.id,
        title: result.title,
        artist: result.artist,
        songId: panelSong?.id || '',
        conflictMode,
        accounts
      })
      setStatusMessage(
        `${result.sourceName} download started for "${result.title}". Open Transfers to track it.`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateTransfer(transferId, { status: 'failed', progress: 0, message })
      setStatusMessage(message)
    }
  }

  useEffect(() => {
    if (!settingsLoaded || !panelSong || !query.trim()) return
    const key = `${panelSong.id}:${activeSource}`
    if (automaticSearchKey.current === key) return
    automaticSearchKey.current = key
    void handleSearch()
  }, [settingsLoaded, panelSong?.id, activeSource])

  const getSourceResultCount = (sourceId: DownloadSourceId) => {
    return resultCounts[sourceId] || 0
  }

  const getSourceIcon = (sourceId: DownloadSourceId) => {
    if (sourceId === 'soulseek') return <Network className="h-4 w-4" />
    if (sourceId === 'youtube') return <Video className="h-4 w-4" />
    if (sourceId === 'deezer') return <Headphones className="h-4 w-4" />
    return <Download className="h-4 w-4" />
  }

  const isYoutube = activeSource === 'youtube'
  const searchButtonLabel = isSearching
    ? `Searching ${activeSourceInfo?.name || 'Source'}...`
    : `Search ${activeSourceInfo?.name || 'Source'}`

  if (!panelSong) {
    return (
      <aside className="w-[380px] h-full bg-[#111317] border-l border-border/70 shrink-0 flex flex-col shadow-2xl">
        <div className="h-14 flex items-center justify-between px-4 border-b border-border/60">
          <h2 className="text-sm font-bold text-text">Download Source</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center text-text-muted gap-3">
          <Download className="h-10 w-10 opacity-60" />
          <p className="text-sm">Select or play a track to search authorized download sources.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-[390px] h-full bg-[#111317] border-l border-border/70 shrink-0 flex flex-col shadow-2xl">
      <div className="h-14 flex items-center justify-between px-4 border-b border-border/60">
        <h2 className="text-sm font-bold text-text">Download Source</h2>
        <button
          type="button"
          onClick={onClose}
          className="h-8 w-8 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-hover"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex flex-col items-center text-center">
          <div className="relative h-28 w-28 rounded-md bg-surface-elevated border border-border overflow-hidden shadow-lg">
            {artworkUrl ? (
              <img
                src={artworkUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.hidden = true
                }}
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-xs text-text-muted">
                Art
              </div>
            )}
          </div>
          <h3 className="mt-4 text-lg font-extrabold text-text leading-tight">
            {panelSong.title}
          </h3>
          <p className="text-sm text-text-muted">{panelSong.artist}</p>
          <p className="text-xs italic text-text-muted/70">{panelSong.album}</p>
        </div>

        <div
          className={`mt-5 rounded-lg border p-3 ${
            isLibraryTrack
              ? 'border-success/30 bg-success/10'
              : 'border-secondary-cyan/30 bg-secondary-cyan/10'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div
              className={`flex items-center gap-2 text-xs font-bold ${
                isLibraryTrack ? 'text-success' : 'text-secondary-cyan'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {isLibraryTrack ? 'Already in Library' : 'Online Track'}
            </div>
            <span
              className={`rounded border px-2 py-1 text-[10px] font-bold uppercase ${
                isLibraryTrack
                  ? 'border-success/30 bg-success/15 text-success'
                  : 'border-secondary-cyan/30 bg-secondary-cyan/15 text-secondary-cyan'
              }`}
            >
              {isLibraryTrack ? 'Replace Mode' : 'Download Mode'}
            </span>
          </div>

          {isLibraryTrack && (
            <div className="mt-3 flex items-center gap-3 rounded-md bg-white/[0.04] p-2">
            <button
              type="button"
              onClick={handlePlayExisting}
              className="h-9 w-9 rounded-full bg-success text-white flex items-center justify-center shadow-[0_0_14px_rgba(16,185,129,0.35)]"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
            </button>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-bold text-text">{panelSong.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                <span className="rounded bg-black/30 px-1.5 py-0.5 font-bold text-text">
                  {(panelSong.sampleRate ? panelSong.sampleRate / 1000 : 44.1).toFixed(1)}kHz
                </span>
                <span>
                  {panelSong.size ? (panelSong.size / 1024 / 1024).toFixed(2) : '0'} MB
                </span>
                <span>
                  {panelSong.duration
                    ? `${Math.floor(panelSong.duration / 60)}:${String(panelSong.duration % 60).padStart(2, '0')}`
                    : '0:00'}
                </span>
              </div>
            </div>
          </div>
          )}

          {isLibraryTrack && (
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => setConflictMode('replace')}
                className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[11px] font-bold ${
                  conflictMode === 'replace'
                    ? 'bg-success/20 text-success'
                    : 'text-text-muted hover:text-text hover:bg-hover'
                }`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Replace File
              </button>
              <button
                type="button"
                onClick={() => setConflictMode('keep_both')}
                className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[11px] font-bold ${
                  conflictMode === 'keep_both'
                    ? 'bg-secondary-cyan/20 text-secondary-cyan'
                    : 'text-text-muted hover:text-text hover:bg-hover'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                Keep Both
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 text-sm text-text-muted">
          Search results for <span className="font-bold text-success">"{query}"</span>
        </div>

        <form onSubmit={handleSearch} className="mt-3 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              isYoutube
                ? 'Refine YouTube search...'
                : activeSource === 'soulseek'
                  ? 'Refine Soulseek search...'
                  : `Search ${activeSourceInfo?.name || 'source'}...`
            }
            className="min-w-0 flex-1 rounded-md border border-border bg-black/30 px-3 py-2 text-sm text-text outline-none focus:border-secondary-cyan"
          />
          <button
            type="submit"
            disabled={isSearching}
            className={`flex min-w-[116px] items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-bold text-white disabled:opacity-60 ${
              activeSource === 'youtube'
                ? 'bg-danger'
                : activeSource === 'qobuz'
                  ? 'bg-secondary-cyan'
                  : activeSource === 'deezer'
                    ? 'bg-purple-600'
                    : 'bg-success'
            }`}
          >
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="truncate">{searchButtonLabel}</span>
          </button>
        </form>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {orderedSources.map((source) => {
            if (!source) return null
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => {
                  if (source.id !== activeSource) setSourceResults([])
                  setActiveSource(source.id)
                }}
                className={`relative h-14 rounded-md border px-1 text-[11px] font-bold transition-colors ${
                  activeSource === source.id
                    ? 'border-secondary-cyan bg-secondary-cyan/10 text-secondary-cyan'
                    : 'border-border bg-surface-elevated text-text-muted hover:text-text'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-1">
                  {getSourceIcon(source.id)}
                  <span className="leading-tight">{source.name}</span>
                </div>
                {getSourceResultCount(source.id) > 0 && (
                  <span className="absolute right-1.5 top-1 rounded-full bg-success px-1.5 text-[9px] font-extrabold text-canvas">
                    {getSourceResultCount(source.id)}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-5 rounded-lg border border-border bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-text">{activeSourceInfo?.name}</div>
              <div className="mt-1 text-xs text-text-muted">{activeSourceInfo?.quality}</div>
            </div>
            <span className="rounded-full bg-surface-elevated px-2.5 py-1 text-[10px] font-bold uppercase text-text-muted">
              {playbackMode === 'stream' ? 'Stream Mode' : 'Download Mode'}
            </span>
          </div>

          <div className="mt-5">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center gap-3 py-5 text-center text-text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Searching {activeSourceInfo?.name}...</span>
              </div>
            ) : sourceResults.length > 0 ? (
              <div className="space-y-2">
                {sourceResults.map((result) => {
                  const queuedTransfer = transfers.find(
                    (transfer) =>
                        transfer.source === activeSource &&
                        transfer.title === result.title &&
                        transfer.status !== 'failed'
                  )
                  const queuedProgress = queuedTransfer
                    ? Math.max(0, Math.min(100, Math.round(queuedTransfer.progress || 0)))
                    : 0
                  const isQueuedComplete = queuedTransfer?.status === 'completed'
                  return (
                    <div
                      key={result.id}
                      className="rounded-md border border-border/60 bg-surface-elevated/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-text">{result.title}</div>
                          <div className="truncate text-xs text-text-muted">
                            {result.artist} · {result.album}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                          {result.confidence}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
                        <span className="rounded bg-black/30 px-1.5 py-0.5 font-bold text-text">
                          {result.quality}
                        </span>
                        <span>{result.size}</span>
                        <span>{result.sourceName}</span>
                        {'meta' in result && result.meta && <span>{result.meta}</span>}
                        <span>
                          {playbackMode === 'stream' ? 'Stream cache' : 'Library download'}
                        </span>
                      </div>
                      {queuedTransfer ? (
                        <div className="mt-3 rounded-md border border-success/30 bg-success/10 p-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-success">
                              {isQueuedComplete ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                              ) : (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                              )}
                              <span className="truncate">
                                {isQueuedComplete ? 'Download complete' : 'Download in transfers'}
                              </span>
                            </div>
                            <span className="shrink-0 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-black tabular-nums text-success">
                              {queuedProgress}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/35">
                            <div
                              className="h-full rounded-full bg-success transition-[width]"
                              style={{ width: `${queuedProgress}%` }}
                            />
                          </div>
                          <div className="mt-2 truncate text-[10px] font-medium text-text-muted">
                            {queuedTransfer.message || queuedTransfer.status}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleQueueDownload(result)}
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-success px-3 py-2 text-xs font-bold text-white hover:bg-success/90"
                        >
                          <Download className="h-4 w-4" />
                          {conflictMode === 'replace' && isLibraryTrack
                            ? 'Replace With This Version'
                            : 'Download New Copy'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-5 text-center text-text-muted">
                <ShieldAlert className="h-6 w-6 text-warning" />
                <p className="text-xs leading-relaxed">
                  {activeSource === 'qobuz' || activeSource === 'deezer'
                    ? isActiveSourceConfigured
                      ? `No ${activeSourceInfo?.name || 'provider'} matches were found. Refine the search and try again.`
                      : `${activeSourceInfo?.name || 'Source'} is not configured completely. Check the account fields in Settings and save them.`
                    : `${activeSourceInfo?.name || 'Source'} results require a dedicated connector before download matches can be listed.`}
                </p>
              </div>
            )}
          </div>

          {statusMessage && (
            <div className="rounded-md border border-secondary-cyan/30 bg-secondary-cyan/10 px-3 py-2 text-xs text-secondary-cyan">
              {statusMessage}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
