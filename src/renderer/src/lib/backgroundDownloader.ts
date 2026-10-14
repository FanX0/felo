import { useDownloadStore } from '../hooks/useDownloadStore'
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
        return { success: true, transferId: '', message: 'Already exists in library' }
      }
    } catch {}
  }

  // 2. Check if already active in transfers (match both title and artist)
  const transfers = useDownloadStore.getState().transfers
  const isAlreadyActive = transfers.some((t) => {
    if (t.status !== 'downloading' && t.status !== 'queued') return false
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
      progress: 2,
      message: `Searching sources for "${song.title}"...`,
      autoPlay,
      playAction: playAction || (autoPlay ? 'play_now' : undefined),
      requestedBy,
      song: song as any
    },
    { openDrawer }
  )

  const sourceName = (source: string) =>
    source === 'qobuz'
      ? 'Qobuz'
      : source === 'deezer'
        ? 'Deezer'
        : source === 'soulseek'
          ? 'Soulseek P2P'
          : 'YouTube Music'

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

    useDownloadStore.getState().updateTransfer(transferId, {
      quality: chosenResult.quality || 'Auto',
      size: chosenResult.size || '',
      resultId: chosenResult.id,
      message: `Starting ${sourceName(chosenSource)} download...`
    })

    const response = await window.api.startDownload({
      transferId,
      source: chosenSource,
      resultId: chosenResult.id,
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

    return { success: true, transferId }
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
}
