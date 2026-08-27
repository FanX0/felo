import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
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
  Settings as SettingsIcon,
  ShieldAlert,
  Video,
  X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import { toMediaUrl } from '../../lib/media'
import { findMatchingLibrarySong } from '../../lib/songMatching'
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
  autoDownload?: boolean
  autoPlay?: boolean
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
  soulseekUser?: string
  soulseekPassword?: string
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
  const navigate = useNavigate()
  const currentSong = queue[currentSongIndex]
  const panelSong = targetSong || currentSong
  const artworkUrl = targetSong?.artworkUrl || toMediaUrl(panelSong?.artworkPath)
  const isLibraryTrack = Boolean(panelSong?.filePath && !targetSong?.isOnline)
  const [existingLibrarySong, setExistingLibrarySong] = useState<any | null>(null)
  const replaceTargetSong = isLibraryTrack ? panelSong : existingLibrarySong
  const hasLibraryCopy = Boolean(replaceTargetSong?.filePath)
  const [query, setQuery] = useState('')
  const [activeSource, setActiveSource] = useState<DownloadSourceId>('qobuz')
  const [conflictMode, setConflictMode] = useState<DownloadConflictMode>('replace')
  const [priority, setPriority] = useState<DownloadSourceId[]>(DEFAULT_DOWNLOAD_PRIORITY)
  const [playbackMode, setPlaybackMode] = useState<PlaybackStorageMode>('stream')
  const [accounts, setAccounts] = useState<StreamingAccounts>({})
  const [resultsBySource, setResultsBySource] = useState<Partial<Record<DownloadSourceId, SourceResult[]>>>({})
  const [searchingBySource, setSearchingBySource] = useState<Partial<Record<DownloadSourceId, boolean>>>({})
  const [statusBySource, setStatusBySource] = useState<Partial<Record<DownloadSourceId, string>>>({})
  const [statusToneBySource, setStatusToneBySource] = useState<Partial<Record<DownloadSourceId, 'success' | 'error'>>>({})
  const [resultCounts, setResultCounts] = useState<Partial<Record<DownloadSourceId, number>>>({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const automaticSearchKey = useRef('')
  const automaticDownloadKey = useRef('')
  const activeResultsSongId = useRef('')

  useEffect(() => {
    if (panelSong) {
      const newQuery = `${panelSong.artist} ${panelSong.title}`.trim()
      setQuery(newQuery)
      setResultsBySource({})
      setSearchingBySource({})
      setStatusBySource({})
      setStatusToneBySource({})
      setResultCounts({})
      setExistingLibrarySong(null)
      activeResultsSongId.current = ''
    }
  }, [panelSong?.id, isLibraryTrack])

  useEffect(() => {
    let cancelled = false
    const normalized = (value?: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/\bunknown\s+artist\b/g, '')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const findExistingLibrarySong = async () => {
      if (!panelSong || isLibraryTrack) {
        setExistingLibrarySong(null)
        setConflictMode(isLibraryTrack ? 'replace' : 'keep_both')
        return
      }

      try {
        const songs = await window.api?.getSongs?.()
        if (cancelled) return
        const targetTitle = normalized(panelSong.title)
        const targetArtist = normalized(panelSong.artist)
        const match = (songs || []).find((song: any) => {
          if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false
          const songTitle = normalized(song.title)
          const songArtist = normalized(song.artist)
          const titleMatches =
            songTitle === targetTitle ||
            (songTitle && targetTitle && (songTitle.includes(targetTitle) || targetTitle.includes(songTitle)))
          const artistMatches =
            !targetArtist ||
            !songArtist ||
            targetArtist === songArtist ||
            targetArtist === 'unknown' ||
            songArtist === 'unknown'
          return titleMatches && artistMatches
        })
        setExistingLibrarySong(match || null)
        setConflictMode(match ? 'replace' : 'keep_both')
      } catch (error) {
        if (!cancelled) {
          setExistingLibrarySong(null)
          setConflictMode('keep_both')
        }
        console.warn('Could not check existing library song:', error)
      }
    }

    void findExistingLibrarySong()
    return () => {
      cancelled = true
    }
  }, [panelSong?.id, panelSong?.title, panelSong?.artist, isLibraryTrack])

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
    if (!replaceTargetSong?.filePath) return
    if (queue[currentSongIndex]?.id === replaceTargetSong.id) {
      if (!isPlaying) togglePlay()
      return
    }
    setQueue([replaceTargetSong as any], 0)
  }

  const handleSearch = async (
    sourceToSearch: DownloadSourceId = activeSource,
    searchQuery: string = query,
    songId: string = panelSong?.id || '',
    event?: React.FormEvent
  ) => {
    event?.preventDefault()
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) return

    const targetSourceInfo = DOWNLOAD_SOURCES.find((s) => s.id === sourceToSearch)
    const isTargetConfigured =
      sourceToSearch === 'qobuz'
        ? isQobuzConfigured
        : sourceToSearch === 'deezer'
          ? isDeezerConfigured
          : true

    setSearchingBySource((prev) => ({ ...prev, [sourceToSearch]: true }))
    setStatusBySource((prev) => ({ ...prev, [sourceToSearch]: '' }))
    setStatusToneBySource((prev) => ({ ...prev, [sourceToSearch]: undefined }))

    try {
      if (!isTargetConfigured) {
        throw new Error(
          `${targetSourceInfo?.name || 'Source'} account is not configured completely.`
        )
      }
      const results = await window.api.searchDownloadSource(sourceToSearch, trimmedQuery, accounts)
      
      // Discard results if user switched songs while search was in flight
      if (panelSong?.id && songId && panelSong.id !== songId) {
        return
      }

      const mappedResults: SourceResult[] = (results || []).map((result: any, index: number) => ({
        id: String(result.id),
        title: result.title || panelSong?.title || trimmedQuery,
        artist: result.artist || panelSong?.artist || '',
        album: result.album || panelSong?.album || 'Track result',
        quality: result.quality || targetSourceInfo?.quality || 'Provider quality',
        sourceName: targetSourceInfo?.name || sourceToSearch,
        size: result.size || (sourceToSearch === 'youtube' ? 'Standard Audio' : 'Size calculated during download'),
        confidence: index === 0 ? 'Best match' : 'Provider match',
        meta: result.meta || (sourceToSearch === 'soulseek' ? (result.slots ? 'Instant Slot' : 'Queued Slot') : `Track ID ${result.id}`)
      }))

      activeResultsSongId.current = songId
      setResultsBySource((prev) => ({ ...prev, [sourceToSearch]: mappedResults }))
      setResultCounts((prev) => ({ ...prev, [sourceToSearch]: mappedResults.length }))
      setStatusBySource((prev) => ({
        ...prev,
        [sourceToSearch]: `${targetSourceInfo?.name || 'Source'} returned ${mappedResults.length} matches.`
      }))
      setStatusToneBySource((prev) => ({ ...prev, [sourceToSearch]: 'success' }))
    } catch (error) {
      if (panelSong?.id && songId && panelSong.id !== songId) return
      const message = error instanceof Error ? error.message : String(error)
      const isConfigurationError =
        message.toLowerCase().includes('credential') ||
        message.toLowerCase().includes('account') ||
        message.toLowerCase().includes('login') ||
        message.toLowerCase().includes('password') ||
        message.toLowerCase().includes('authentication')
      const friendlyMessage = isConfigurationError
        ? `${targetSourceInfo?.name || 'This provider'} could not log in. Check the account details in Settings, save them, and try again.`
        : `${targetSourceInfo?.name || 'This provider'} search failed. Check your connection and try again.`
      setStatusBySource((prev) => ({ ...prev, [sourceToSearch]: friendlyMessage }))
      setStatusToneBySource((prev) => ({ ...prev, [sourceToSearch]: 'error' }))
      setResultsBySource((prev) => ({ ...prev, [sourceToSearch]: [] }))
      setResultCounts((prev) => ({ ...prev, [sourceToSearch]: 0 }))
    } finally {
      if (!panelSong?.id || !songId || panelSong.id === songId) {
        setSearchingBySource((prev) => ({ ...prev, [sourceToSearch]: false }))
      }
    }
  }

  const handleQueueDownload = async (result: SourceResult, source: DownloadSourceId = activeSource) => {
    const normalized = (value: string) =>
      value
        .toLowerCase()
        .replace(/\bunknown\s+artist\b/g, '')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const resultTitle = normalized(result.title)
    const activeTransferStatuses = new Set(['queued', 'waiting_connector', 'downloading'])
    const duplicateTransfer = useDownloadStore.getState().transfers.find(
      (transfer) =>
        transfer.source === source &&
        activeTransferStatuses.has(transfer.status) &&
        ((transfer.resultId && transfer.resultId === result.id) ||
          normalized(transfer.title) === resultTitle)
    )

    if (duplicateTransfer) {
      setStatusBySource((prev) => ({
        ...prev,
        [source]: 'This track is already in Transfers — duplicate download skipped.'
      }))
      return
    }

    const transferId = queueTransfer({
      source,
      sourceName: result.sourceName,
      title: result.title,
      artist: panelSong?.artist || result.artist,
      quality: result.quality,
      size: result.size,
      conflictMode,
      status: 'queued',
      progress: 2,
      message: `Starting ${result.sourceName} download...`,
      autoPlay: targetSong?.autoPlay,
      resultId: result.id
    })
    try {
      const response = await window.api.startDownload({
        transferId,
        source,
        resultId: result.id,
        title: result.title,
        artist: result.artist,
        songId: replaceTargetSong?.id || panelSong?.id || '',
        conflictMode,
        accounts,
        storageMode: playbackMode,
        autoPlay: targetSong?.autoPlay,
        skipIfExists: targetSong?.autoDownload
      })
      if (response.alreadyExists || response.duplicateRequest) {
        const message = response.alreadyExists
          ? 'Already downloaded — skipped duplicate download.'
          : 'This track is already being downloaded — skipped duplicate request.'
        let existingSong
        if (response.alreadyExists) {
          try {
            const songs = await window.api.getSongs()
            existingSong = findMatchingLibrarySong(result.title, result.artist, songs)
          } catch (error) {
            console.warn('Could not find already downloaded song:', error)
          }
        }
        updateTransfer(transferId, {
          status: 'completed',
          progress: 100,
          message,
          song: existingSong
        })
        window.dispatchEvent(new CustomEvent('felo:library-updated'))
        setStatusBySource((prev) => ({ ...prev, [source]: message }))
        return
      }
      setStatusBySource((prev) => ({
        ...prev,
        [source]: `${result.sourceName} download started for "${result.title}". Open Transfers to track it.`
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateTransfer(transferId, { status: 'failed', progress: 0, message })
      setStatusBySource((prev) => ({ ...prev, [source]: message }))
    }
  }

  useEffect(() => {
    if (!settingsLoaded || !panelSong || !query.trim()) return
    const key = `${panelSong.id}:${query.trim()}`
    if (automaticSearchKey.current === key) return
    automaticSearchKey.current = key

    void Promise.all(
      DOWNLOAD_SOURCES.map((source) => handleSearch(source.id, query.trim(), panelSong.id))
    )
  }, [settingsLoaded, panelSong?.id, query])

  useEffect(() => {
    if (!settingsLoaded || !targetSong?.autoDownload || !panelSong || !query.trim()) return
    const key = `${panelSong.id}:${query.trim()}`
    if (automaticDownloadKey.current === key) return

    // Check sources in strict user priority order.
    // If a higher priority source is still in-flight, wait for it before falling back.
    let chosenSource: DownloadSourceId | null = null
    let chosenResult: SourceResult | null = null

    for (const source of priority) {
      const isSearchingSource = Boolean(searchingBySource[source])
      const sourceResults = resultsBySource[source] || []

      if (sourceResults.length > 0) {
        chosenSource = source
        chosenResult = sourceResults[0]
        break
      }

      if (isSearchingSource) {
        // A higher-priority source is still searching — wait for its result!
        return
      }
    }

    if (!chosenSource || !chosenResult) return

    automaticDownloadKey.current = key
    setActiveSource(chosenSource)
    void handleQueueDownload(chosenResult, chosenSource)
  }, [settingsLoaded, targetSong?.autoDownload, panelSong?.id, query, priority, resultsBySource, searchingBySource])

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
  const isSearching = Boolean(searchingBySource[activeSource])
  const sourceResults = resultsBySource[activeSource] || []
  const statusMessage = statusBySource[activeSource] || ''
  const statusTone = statusToneBySource[activeSource]
  const canConfigureSource = activeSource !== 'youtube'
  const openProviderSettings = () => navigate('/settings')
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

        <div className="mt-5 rounded-lg border border-white/15 bg-[#2a2a2a] p-3">
          <div className="flex items-center justify-between gap-3">
            <div
              className="flex items-center gap-2 text-xs font-bold text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              {hasLibraryCopy ? 'Already in Library' : 'Online Track'}
            </div>
            <span className="rounded-full border border-white/15 bg-[#2a2a2a] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#b3b3b3]">
              {hasLibraryCopy ? 'Replace Mode' : 'Download Mode'}
            </span>
          </div>

          {hasLibraryCopy && (
            <div className="mt-3 flex items-center gap-3 rounded-md bg-white/[0.04] p-2">
            <button
              type="button"
              onClick={handlePlayExisting}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2a2a2a] text-white shadow-md transition-colors hover:bg-[#353535]"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
            </button>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm font-bold text-text">{replaceTargetSong.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                <span className="rounded bg-black/30 px-1.5 py-0.5 font-bold text-text">
                  {(replaceTargetSong.sampleRate ? replaceTargetSong.sampleRate / 1000 : 44.1).toFixed(1)}kHz
                </span>
                <span>
                  {replaceTargetSong.size ? (replaceTargetSong.size / 1024 / 1024).toFixed(2) : '0'} MB
                </span>
                <span>
                  {replaceTargetSong.duration
                    ? `${Math.floor(replaceTargetSong.duration / 60)}:${String(replaceTargetSong.duration % 60).padStart(2, '0')}`
                    : '0:00'}
                </span>
              </div>
            </div>
          </div>
          )}

          {hasLibraryCopy && (
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => setConflictMode('replace')}
                className={`flex items-center justify-center gap-1.5 rounded-[4px] px-2 py-1.5 text-[11px] font-bold ${
                  conflictMode === 'replace'
                    ? 'bg-white/10 text-white'
                    : 'text-text-muted hover:bg-hover hover:text-text'
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
                    ? 'bg-white/10 text-white'
                    : 'text-text-muted hover:bg-hover hover:text-text'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                Keep Both
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 text-sm text-text-muted">
          Search results for <span className="font-bold text-white">"{query}"</span>
        </div>

        <form onSubmit={(e) => handleSearch(activeSource, query, panelSong?.id || '', e)} className="mt-3 flex gap-2">
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
            className="flex min-w-[116px] items-center justify-center gap-2 rounded-full bg-[#2a2a2a] px-4 py-2 text-sm font-bold text-white shadow-md transition-colors hover:bg-[#353535] disabled:opacity-60"
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
                  setActiveSource(source.id)
                }}
                className={`relative h-14 rounded-md border px-1 text-[11px] font-bold transition-colors ${
                  activeSource === source.id
                    ? 'border-white/30 bg-white/10 text-white'
                    : 'border-border bg-surface-elevated text-text-muted hover:text-white'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-1">
                  {getSourceIcon(source.id)}
                  <span className="leading-tight">{source.name}</span>
                </div>
                {getSourceResultCount(source.id) > 0 && (
                  <span className="absolute right-1.5 top-1 rounded-full bg-white/10 px-1.5 text-[9px] font-extrabold text-white">
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
                        <span className="shrink-0 rounded-full border border-white/15 bg-[#2a2a2a] px-2 py-0.5 text-[10px] font-bold text-[#b3b3b3]">
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
                        <div className="mt-3 rounded-md border border-white/15 bg-[#2a2a2a] p-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-xs font-bold text-white">
                              {isQueuedComplete ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                              ) : (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                              )}
                              <span className="truncate">
                                {isQueuedComplete ? 'Download complete' : 'Download in transfers'}
                              </span>
                            </div>
                            <span className="shrink-0 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-black tabular-nums text-white">
                              {queuedProgress}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/35">
                            <div
                              className="h-full rounded-full bg-white transition-[width]"
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
                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#2a2a2a] px-4 py-2 text-xs font-bold text-white shadow-md transition-colors hover:bg-[#353535]"
                        >
                          <Download className="h-4 w-4" />
                          {conflictMode === 'replace' && hasLibraryCopy
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
                {statusTone === 'error' ? (
                  <AlertCircle className="h-6 w-6 text-danger" />
                ) : (
                  <ShieldAlert className="h-6 w-6 text-warning" />
                )}
                <p className="max-w-[290px] text-xs leading-relaxed">
                  {statusTone === 'error' || statusMessage
                    ? statusMessage
                    : !isActiveSourceConfigured
                      ? `${activeSourceInfo?.name || 'Source'} account details are incomplete.`
                      : `No ${activeSourceInfo?.name || 'provider'} matches were found. Refine the search and try again.`}
                </p>
                {(statusTone === 'error' || !isActiveSourceConfigured) && canConfigureSource && (
                  <button
                    type="button"
                    onClick={openProviderSettings}
                    className="flex items-center gap-2 rounded-full border border-white/15 bg-[#2a2a2a] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#353535]"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" />
                    Configure {activeSourceInfo?.name || 'provider'} account
                  </button>
                )}
              </div>
            )}
          </div>

          {statusMessage && sourceResults.length > 0 && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                statusTone === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-white/15 bg-[#2a2a2a] text-white'
              }`}
            >
              {statusMessage}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
