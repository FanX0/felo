import { useDownloadStore } from '../hooks/useDownloadStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  PLAYBACK_STORAGE_SETTING,
  STREAMING_ACCOUNTS_SETTING,
  type DownloadSourceId,
  type DownloadConflictMode
} from './downloadConfig'
import { cleanSearchQuery, findMatchingLibrarySong, scoreProviderMatch } from './songMatching'

export interface DownloadSongOptions {
  conflictMode?: DownloadConflictMode
  autoPlay?: boolean
  playAction?: 'play_now' | 'play_next' | 'enqueue'
  requestedBy?: string
  openDrawer?: boolean
  skipIfExists?: boolean
}

export interface QueuedDownloadTask {
  transferId: string
  song: {
    id?: string
    title: string
    artist?: string
    album?: string
    duration?: number
    artworkUrl?: string
    artworkPath?: string
  }
  options: DownloadSongOptions
  resolve?: (value: { success: boolean; transferId: string; message?: string }) => void
}

// ─────────────────────────────────────────────────────────────
// Sequential 1-by-1 Download Queue Worker
// ─────────────────────────────────────────────────────────────
const downloadQueue: QueuedDownloadTask[] = []
let isWorkerRunning = false
let activeTransferId: string | null = null

export function getActiveTransferId(): string | null {
  return activeTransferId
}

export function getDownloadQueueLength(): number {
  return downloadQueue.length
}

export function cancelQueuedDownload(transferId: string): void {
  const index = downloadQueue.findIndex((t) => t.transferId === transferId)
  if (index !== -1) {
    const [removed] = downloadQueue.splice(index, 1)
    removed.resolve?.({ success: false, transferId, message: 'Cancelled' })
  }
}

export function cancelBatchDownloads(transferIds: string[]): void {
  const set = new Set(transferIds)
  for (let i = downloadQueue.length - 1; i >= 0; i--) {
    if (set.has(downloadQueue[i].transferId)) {
      const [removed] = downloadQueue.splice(i, 1)
      removed.resolve?.({ success: false, transferId: removed.transferId, message: 'Cancelled' })
    }
  }
}

/**
 * Wait for a transfer to reach 'completed' or 'failed' status
 */
function waitForTransferCompletion(transferId: string, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve) => {
    const isDone = () => {
      const item = useDownloadStore.getState().transfers.find((t) => t.id === transferId)
      return item && (item.status === 'completed' || item.status === 'failed')
    }

    if (isDone()) {
      resolve()
      return
    }

    let unsubProgress: (() => void) | undefined
    let unsubStore: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = () => {
      if (timer) clearTimeout(timer)
      unsubProgress?.()
      unsubStore?.()
      resolve()
    }

    if (window.api?.onDownloadProgress) {
      unsubProgress = window.api.onDownloadProgress((event: any) => {
        if (
          event?.transferId === transferId &&
          (event.status === 'completed' || event.status === 'failed')
        ) {
          finish()
        }
      })
    }

    unsubStore = useDownloadStore.subscribe((state) => {
      const item = state.transfers.find((t) => t.id === transferId)
      if (item && (item.status === 'completed' || item.status === 'failed')) {
        finish()
      }
    })

    timer = setTimeout(() => {
      finish()
    }, timeoutMs)
  })
}

const sourceName = (source: string) =>
  source === 'qobuz'
    ? 'Qobuz'
    : source === 'deezer'
      ? 'Deezer'
      : source === 'soulseek'
        ? 'Soulseek P2P'
        : 'YouTube Music'

/**
 * Executes provider search and downloads a single track to completion.
 */
async function executeSingleTrackDownload(
  task: QueuedDownloadTask
): Promise<{ success: boolean; transferId: string; message?: string }> {
  const { transferId, song, options } = task
  const {
    conflictMode = 'keep_both',
    autoPlay = false,
    skipIfExists = true
  } = options

  try {
    const [savedPriority, savedAccounts, savedStorage] = await Promise.all([
      window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING),
      window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING),
      window.api?.getSetting?.(PLAYBACK_STORAGE_SETTING)
    ])

    const priority: DownloadSourceId[] =
      Array.isArray(savedPriority) && savedPriority.length > 0
        ? savedPriority
        : DEFAULT_DOWNLOAD_PRIORITY
    const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}
    const storageMode = savedStorage || 'download'
    const query = cleanSearchQuery(song.artist, song.title) || `${song.artist || ''} ${song.title}`.trim()

    let chosenSource: DownloadSourceId | null = null
    let chosenResult: any = null

    for (const source of priority) {
      // Fast-skip provider if login/credentials are required but not configured
      if (source === 'qobuz' && !accounts.qobuzSecret && !accounts.qobuzUser) {
        continue
      }
      if (source === 'deezer' && !accounts.deezerArl) {
        continue
      }
      if (source === 'soulseek' && !accounts.soulseekUser && !accounts.soulseekPassword) {
        continue
      }

      useDownloadStore.getState().updateTransfer(transferId, {
        source,
        sourceName: sourceName(source),
        message: `Searching ${sourceName(source)} for "${song.title}"...`
      })

      try {
        const searchPromise = window.api?.searchDownloadSource?.(source, query, accounts)
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Search timed out (12s)')), 12000)
        })
        const rawResults = await Promise.race([searchPromise, timeoutPromise]).finally(() => {
          if (timer) clearTimeout(timer)
        })
        const results = Array.isArray(rawResults) ? rawResults : []
        if (results.length === 0) continue

        const scored = results
          .map((item: any) => {
            const match = scoreProviderMatch(
              { title: song.title, artist: song.artist, duration: song.duration },
              item
            )
            return {
              ...item,
              _score: match.score,
              _isAcceptable: match.isAcceptable,
              _rejectReason: match.rejectReason
            }
          })
          .filter((item: any) => item._isAcceptable && item._score >= 60)
          .sort((a: any, b: any) => b._score - a._score)

        if (scored[0]) {
          chosenSource = source
          chosenResult = scored[0]
          break
        }
      } catch (searchErr) {
        console.warn(`Background search failed on ${source}:`, searchErr)
      }
    }

    if (!chosenSource || !chosenResult) {
      const errMsg = `No authorized source found a high-confidence match for "${song.title}".`
      useDownloadStore.getState().updateTransfer(transferId, {
        status: 'failed',
        progress: 0,
        message: errMsg
      })
      const failDetail = {
        transferId,
        songId: song.id,
        title: song.title,
        artist: song.artist,
        message: errMsg
      }
      window.dispatchEvent(
        new CustomEvent('fanxmusic:download-failed', {
          detail: failDetail
        })
      )
      window.dispatchEvent(
        new CustomEvent('felo:download-failed', {
          detail: failDetail
        })
      )
      return { success: false, transferId, message: errMsg }
    }

    const safeResultId = String(chosenResult.id)
    useDownloadStore.getState().updateTransfer(transferId, {
      quality: chosenResult.quality || 'Auto',
      size: chosenResult.size || '',
      resultId: safeResultId,
      message: `Starting ${sourceName(chosenSource)} download...`
    })

    const response = await window.api.startDownload({
      transferId,
      source: chosenSource,
      resultId: safeResultId,
      title: chosenResult.title || song.title,
      artist: chosenResult.artist || song.artist,
      songId: song.id || '',
      conflictMode,
      accounts,
      storageMode,
      autoPlay,
      skipIfExists,
      artworkUrl: chosenResult.artworkUrl || song.artworkUrl || song.artworkPath,
      album: chosenResult.album || song.album
    })

    if (response?.alreadyExists) {
      useDownloadStore.getState().updateTransfer(transferId, {
        status: 'completed',
        progress: 100,
        message: 'Already downloaded'
      })
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
      window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))
      return { success: true, transferId }
    }

    if (response?.started === false) {
      const errMsg = (response as any)?.error || 'Failed to start download'
      useDownloadStore.getState().updateTransfer(transferId, {
        status: 'failed',
        progress: 0,
        message: errMsg
      })
      const failDetail = {
        transferId,
        songId: song.id,
        title: song.title,
        artist: song.artist,
        message: errMsg
      }
      window.dispatchEvent(new CustomEvent('fanxmusic:download-failed', { detail: failDetail }))
      window.dispatchEvent(new CustomEvent('felo:download-failed', { detail: failDetail }))
      return { success: false, transferId, message: errMsg }
    }

    // Wait until this download completes or fails in main process before continuing
    await waitForTransferCompletion(transferId)

    const finalItem = useDownloadStore.getState().transfers.find((t) => t.id === transferId)
    const isSuccess = finalItem?.status === 'completed'
    return {
      success: isSuccess ?? true,
      transferId,
      message: finalItem?.message
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Download failed to start'
    useDownloadStore.getState().updateTransfer(transferId, {
      status: 'failed',
      progress: 0,
      message: errMsg
    })
    const failDetail = {
      transferId,
      songId: song.id,
      title: song.title,
      artist: song.artist,
      message: errMsg
    }
    window.dispatchEvent(new CustomEvent('fanxmusic:download-failed', { detail: failDetail }))
    window.dispatchEvent(new CustomEvent('felo:download-failed', { detail: failDetail }))
    return { success: false, transferId, message: errMsg }
  }
}

/**
 * Worker loop that processes queued downloads 1-by-1 sequentially.
 */
async function runQueueWorker(): Promise<void> {
  if (isWorkerRunning) return
  isWorkerRunning = true

  try {
    while (downloadQueue.length > 0) {
      // Prioritize urgent autoPlay tasks if any
      const urgentIndex = downloadQueue.findIndex((t) => t.options.autoPlay)
      const task =
        urgentIndex !== -1 ? downloadQueue.splice(urgentIndex, 1)[0] : downloadQueue.shift()!

      // Check if item was cancelled by user while sitting in queue
      const current = useDownloadStore.getState().transfers.find((t) => t.id === task.transferId)
      if (!current || (current.status !== 'queued' && current.status !== 'downloading')) {
        task.resolve?.({ success: false, transferId: task.transferId, message: 'Cancelled' })
        continue
      }

      activeTransferId = task.transferId
      const result = await executeSingleTrackDownload(task)
      task.resolve?.(result)
      activeTransferId = null

      // Cooldown pause (500ms) to allow network sockets, file handles, and provider APIs to rest
      if (downloadQueue.length > 0) {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  } finally {
    isWorkerRunning = false
    activeTransferId = null
  }
}

/**
 * Public API: Download a single track in background using the sequential queue.
 */
export async function downloadTrackInBackground(
  song: {
    id?: string
    title: string
    artist?: string
    album?: string
    duration?: number
    artworkUrl?: string
    artworkPath?: string
  },
  options: DownloadSongOptions = {}
): Promise<{ success: boolean; transferId: string; message?: string }> {
  const {
    conflictMode = 'keep_both',
    autoPlay = false,
    playAction,
    requestedBy,
    openDrawer = false,
    skipIfExists = true
  } = options

  // 1. Check if already exists in local library (bypass when replacing an existing file)
  if (skipIfExists && conflictMode !== 'replace') {
    try {
      const librarySongs = (await window.api?.getSongs?.()) || []
      const localMatch = findMatchingLibrarySong(song.title, song.artist || '', librarySongs)
      if (localMatch?.filePath && !localMatch.filePath.startsWith('virtual:')) {
        if (autoPlay || playAction === 'play_now') {
          const player = usePlayerStore.getState()
          const currentSong = player.queue[player.currentSongIndex]
          const isCurrentVirtual =
            !currentSong?.filePath || currentSong.filePath.startsWith('virtual:')

          if (
            isCurrentVirtual ||
            currentSong?.id === song.id ||
            currentSong?.title.toLowerCase() === song.title.toLowerCase()
          ) {
            player.updateSong(localMatch, currentSong?.id || song.id)
            player.setIsBuffering(false)
            player.claimAudioOwnership()
            player.setIsPlaying(true)
          } else if (player.queue.length === 0) {
            player.setQueue([localMatch], 0)
            player.claimAudioOwnership()
            player.setIsPlaying(true)
          } else {
            player.enqueueSongPriority(localMatch)
            player.claimAudioOwnership()
            player.playSong(player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1)
            player.setIsPlaying(true)
          }
        }
        return { success: true, transferId: '', message: 'Already exists in library' }
      }
    } catch {}
  }

  // 2. Check if already active in transfers (match both title and artist)
  const transfers = useDownloadStore.getState().transfers
  const isAlreadyActive = transfers.some((t) => {
    if (t.status !== 'downloading' && t.status !== 'queued' && t.status !== 'waiting_connector') {
      return false
    }
    const titleMatches = t.title.toLowerCase() === song.title.toLowerCase()
    if (!titleMatches) return false
    if (song.artist && t.artist && song.artist.toLowerCase() !== 'unknown artist') {
      return t.artist.toLowerCase() === song.artist.toLowerCase()
    }
    return true
  })
  if (isAlreadyActive) {
    return { success: true, transferId: '', message: 'Already in transfers' }
  }

  const initialSource = DEFAULT_DOWNLOAD_PRIORITY[0]
  const isFirstAndIdle = !isWorkerRunning && downloadQueue.length === 0
  const transferId = useDownloadStore.getState().queueTransfer(
    {
      source: initialSource,
      sourceName: 'Searching providers',
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      quality: 'Auto',
      size: 'Searching...',
      conflictMode,
      status: 'queued',
      progress: isFirstAndIdle ? 2 : 0,
      message: isFirstAndIdle
        ? `Searching sources for "${song.title}"...`
        : `Waiting in queue (#${downloadQueue.length + 1})...`,
      autoPlay,
      playAction: playAction || (autoPlay ? 'play_now' : undefined),
      requestedBy,
      song: song as any
    },
    { openDrawer }
  )

  const task: QueuedDownloadTask = {
    transferId,
    song,
    options
  }

  // If urgent autoplay, prioritize to front of queue
  if (autoPlay) {
    downloadQueue.unshift(task)
  } else {
    downloadQueue.push(task)
  }

  void runQueueWorker()
  return { success: true, transferId }
}

/**
 * Public API: Batch download multiple tracks sequentially 1-by-1 (for albums & playlists).
 */
export async function downloadTracksBatch(
  songs: Array<{
    id?: string
    title: string
    artist?: string
    album?: string
    duration?: number
    artworkUrl?: string
    artworkPath?: string
  }>,
  options: DownloadSongOptions = {}
): Promise<{ enqueued: number; transferIds: string[] }> {
  let librarySongs: any[] = []
  try {
    librarySongs = (await window.api?.getSongs?.()) || []
  } catch {}

  const existingTransfers = useDownloadStore.getState().transfers
  const transferIds: string[] = []

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i]

    // 1. Skip if already exists in library
    if (options.skipIfExists !== false && options.conflictMode !== 'replace') {
      const localMatch = findMatchingLibrarySong(song.title, song.artist || '', librarySongs)
      if (localMatch?.filePath && !localMatch.filePath.startsWith('virtual:')) {
        continue
      }
    }

    // 2. Skip if already active in transfers
    const isAlreadyQueued = existingTransfers.some((t) => {
      if (t.status !== 'downloading' && t.status !== 'queued' && t.status !== 'waiting_connector') {
        return false
      }
      return (
        t.title.toLowerCase() === song.title.toLowerCase() &&
        (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase())
      )
    })
    if (isAlreadyQueued) continue

    const initialSource = DEFAULT_DOWNLOAD_PRIORITY[0]
    const isFirstAndIdle = !isWorkerRunning && downloadQueue.length === 0 && transferIds.length === 0
    const transferId = useDownloadStore.getState().queueTransfer(
      {
        source: initialSource,
        sourceName: 'Searching providers',
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        quality: 'Auto',
        size: 'Searching...',
        conflictMode: options.conflictMode || 'keep_both',
        status: 'queued',
        progress: isFirstAndIdle ? 2 : 0,
        message: isFirstAndIdle
          ? `Searching sources for "${song.title}"...`
          : `Waiting in queue (#${downloadQueue.length + transferIds.length + 1})...`,
        autoPlay: false,
        playAction: options.playAction,
        requestedBy: options.requestedBy,
        song: song as any
      },
      { openDrawer: options.openDrawer ?? false }
    )

    transferIds.push(transferId)
    downloadQueue.push({
      transferId,
      song,
      options
    })
  }

  void runQueueWorker()
  return { enqueued: transferIds.length, transferIds }
}
