import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useDownloadStore } from '../hooks/useDownloadStore'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  PLAYBACK_STORAGE_SETTING,
  STREAMING_ACCOUNTS_SETTING,
  type DownloadSourceId
} from '../lib/downloadConfig'
import { findMatchingLibrarySong, scoreProviderMatch, cleanSearchQuery } from '../lib/songMatching'
import type { Song } from '../pages/Library/Library'

export default function PlaybackStreamBridge(): null {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const queue = usePlayerStore((s) => s.queue)
  const repeatMode = usePlayerStore((s) => s.repeatMode)

  const activeStreamingKeyRef = useRef<string | null>(null)
  const activeInFlightRef = useRef(false)
  const prefetchingKeyRef = useRef<string | null>(null)
  const prefetchTransferIdRef = useRef<string | null>(null)
  const prefetchInFlightRef = useRef(false)

  // -------------------------------------------------------------
  // 1. ACTIVE TRACK STREAMING & HEADLESS ACQUISITION
  // -------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false

    if (currentSongIndex < 0 || currentSongIndex >= queue.length) {
      if (isBuffering) usePlayerStore.getState().setIsBuffering(false)
      return () => {
        isCancelled = true
      }
    }

    const currentSong = queue[currentSongIndex]
    if (!currentSong || !currentSong.title) {
      return () => {
        isCancelled = true
      }
    }

    // If active track already has local file on disk, we are ready to play
    if (currentSong.filePath && !currentSong.filePath.startsWith('virtual:')) {
      if (isBuffering) usePlayerStore.getState().setIsBuffering(false)
      activeStreamingKeyRef.current = null
      return () => {
        isCancelled = true
      }
    }

    // Active track has no local file — it is an online track
    if (!isPlaying && !isBuffering) {
      // User explicitly paused or hasn't started playback yet
      return () => {
        isCancelled = true
      }
    }

    const trackKey = `${currentSong.title.toLowerCase()}::${(currentSong.artist || '').toLowerCase()}`
    if (activeStreamingKeyRef.current === trackKey && activeInFlightRef.current) {
      return () => {
        isCancelled = true
      }
    }

    activeStreamingKeyRef.current = trackKey
    activeInFlightRef.current = true
    usePlayerStore.getState().setIsBuffering(true)

    // Preemption: cancel any ongoing background prefetch so 100% bandwidth goes to active song
    if (prefetchTransferIdRef.current) {
      try {
        void window.api?.cancelDownload?.(prefetchTransferIdRef.current)
      } catch {}
      prefetchTransferIdRef.current = null
      prefetchInFlightRef.current = false
      prefetchingKeyRef.current = null
    }

    // Demote any previously active transfers so they do not hijack playback when completed
    const existingTransfers = useDownloadStore.getState().transfers
    for (const t of existingTransfers) {
      if (t.autoPlay && t.title.toLowerCase() !== currentSong.title.toLowerCase()) {
        useDownloadStore.getState().updateTransfer(t.id, { autoPlay: false })
      }
    }

    const acquireActiveTrack = async () => {
      try {
        if (!window.api?.searchDownloadSource || !window.api?.startDownload) {
          if (!isCancelled) usePlayerStore.getState().setIsBuffering(false)
          activeInFlightRef.current = false
          return
        }

        // 1. Check if the song was already downloaded or exists in library
        const librarySongs = (await window.api.getSongs?.()) || []
        if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

        const localMatch = findMatchingLibrarySong(currentSong.title, currentSong.artist, librarySongs)
        if (localMatch && localMatch.filePath) {
          usePlayerStore.getState().updateSong(localMatch as any)
          usePlayerStore.getState().setIsBuffering(false)
          usePlayerStore.getState().setIsPlaying(true)
          activeInFlightRef.current = false
          return
        }

        // 2. Check if already downloading in useDownloadStore
        const transfers = useDownloadStore.getState().transfers
        const existingTransfer = transfers.find((t) => {
          const matchTitle = t.title.toLowerCase() === currentSong.title.toLowerCase()
          const matchArtist = !currentSong.artist || !t.artist || t.artist.toLowerCase() === currentSong.artist.toLowerCase()
          return matchTitle && matchArtist && (t.status === 'downloading' || t.status === 'queued')
        })

        if (existingTransfer) {
          // Promote transfer to autoPlay: true if it was queued as prefetch
          if (!existingTransfer.autoPlay) {
            useDownloadStore.getState().updateTransfer(existingTransfer.id, {
              autoPlay: true,
              message: `Streaming "${currentSong.title}"...`
            })
          }
          activeInFlightRef.current = false
          return
        }

        // 3. Load user accounts and source priority
        const [prioritySetting, accountsSetting, storageSetting] = await Promise.all([
          window.api.getSetting?.(DOWNLOAD_PRIORITY_SETTING),
          window.api.getSetting?.(STREAMING_ACCOUNTS_SETTING),
          window.api.getSetting?.(PLAYBACK_STORAGE_SETTING)
        ])

        if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

        const priority: DownloadSourceId[] =
          Array.isArray(prioritySetting) && prioritySetting.length > 0
            ? prioritySetting
            : DEFAULT_DOWNLOAD_PRIORITY
        const accounts = accountsSetting || {}
        const storageMode = storageSetting || 'download'
        const query = cleanSearchQuery(currentSong.artist, currentSong.title) || `${currentSong.artist || ''} ${currentSong.title}`.trim()

        let chosenSource: DownloadSourceId | null = null
        let chosenResult: any = null

        // 4. Search in priority order for verified high-confidence identity match
        for (const source of priority) {
          if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return
          try {
            const searchPromise = window.api.searchDownloadSource(source, query, accounts)
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Stream search timed out on ${source}`)), 12000)
            )
            const rawResults = await Promise.race([searchPromise, timeoutPromise])
            if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

            const results = Array.isArray(rawResults) ? rawResults : []
            if (results.length === 0) continue

            const scored = results
              .map((item: any) => {
                const match = scoreProviderMatch(
                  { title: currentSong.title, artist: currentSong.artist, duration: currentSong.duration },
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

            const topResult = scored[0]
            if (topResult) {
              chosenSource = source
              chosenResult = topResult
              break
            }
          } catch (err) {
            console.warn(`Stream search error on ${source}:`, err)
          }
        }

        if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

        if (!chosenSource || !chosenResult) {
          console.warn(`No verified studio recording found for "${currentSong.title}". Skipping to next track...`)
          usePlayerStore.getState().setIsBuffering(false)
          activeInFlightRef.current = false

          // Notify user of missing/unobtainable track and auto-advance
          const unavailDetail = {
            title: currentSong.title,
            artist: currentSong.artist,
            message: `No identical studio recording found for "${currentSong.title}". Advancing to next track.`
          }
          window.dispatchEvent(new CustomEvent('fanxmusic:track-unavailable', { detail: unavailDetail }))
          window.dispatchEvent(new CustomEvent('felo:track-unavailable', { detail: unavailDetail }))

          const failDetail = {
            transferId: '',
            songId: currentSong.id,
            title: currentSong.title,
            artist: currentSong.artist,
            message: `No identical studio recording found for "${currentSong.title}". Advancing to next track.`
          }
          window.dispatchEvent(new CustomEvent('fanxmusic:download-failed', { detail: failDetail }))
          window.dispatchEvent(new CustomEvent('felo:download-failed', { detail: failDetail }))

          // Advance only if the active song index still matches
          if (usePlayerStore.getState().currentSongIndex === currentSongIndex) {
            usePlayerStore.getState().playNext()
          }
          return
        }

        // 5. Register active transfer with autoPlay: true
        const transferId = useDownloadStore.getState().queueTransfer(
          {
            source: chosenSource,
            sourceName: chosenResult.sourceName || chosenSource,
            title: chosenResult.title,
            artist: currentSong.artist || chosenResult.artist,
            quality: chosenResult.quality || 'Auto',
            size: chosenResult.size || '',
            conflictMode: 'replace',
            status: 'queued',
            progress: 5,
            message: `Buffering "${currentSong.title}" (${chosenResult.sourceName || chosenSource})...`,
            autoPlay: true,
            resultId: chosenResult.id,
            song: currentSong
          },
          { openDrawer: false }
        )

        if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

        // 6. Initiate download
        await window.api.startDownload({
          transferId,
          source: chosenSource,
          resultId: chosenResult.id,
          title: chosenResult.title,
          artist: chosenResult.artist,
          songId: currentSong.id || '',
          conflictMode: 'replace',
          accounts,
          storageMode,
          autoPlay: true,
          skipIfExists: true,
          artworkUrl: chosenResult.artworkUrl || currentSong.artworkUrl,
          album: currentSong.album || chosenResult.album
        })
      } catch (error) {
        console.warn('Failed to stream active track:', error)
        if (!isCancelled) usePlayerStore.getState().setIsBuffering(false)
      } finally {
        activeInFlightRef.current = false
      }
    }

    void acquireActiveTrack()

    return () => {
      isCancelled = true
      activeInFlightRef.current = false
    }
  }, [currentSongIndex, queue, isPlaying, isBuffering])

  // -------------------------------------------------------------
  // 2. PREDICTIVE LOOKAHEAD PREFETCH (NEXT UPCOMING TRACK)
  // -------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false

    // Only prefetch if currently playing audio stably
    if (!isPlaying || queue.length === 0 || currentSongIndex < 0) return

    // Do NOT prefetch if an active track is buffering (preemption)
    if (isBuffering || activeInFlightRef.current) return

    // Do NOT prefetch if user has single-track repeat enabled
    if (repeatMode === 'one') return

    // Calculate target next track index (respecting linear vs shuffle queue order)
    let nextIndex = currentSongIndex + 1
    if (nextIndex >= queue.length) {
      if (repeatMode === 'all') {
        nextIndex = 0
      } else {
        return
      }
    }

    const nextSong: Song | undefined = queue[nextIndex]
    if (!nextSong || !nextSong.title) return

    // If next track already has local file on disk, nothing to prefetch
    if (nextSong.filePath && !nextSong.filePath.startsWith('virtual:')) return

    const key = `${nextSong.title.toLowerCase()}::${(nextSong.artist || '').toLowerCase()}`

    // If the upcoming target changed (e.g. user toggled shuffle), cancel the old in-flight prefetch
    if (prefetchingKeyRef.current && prefetchingKeyRef.current !== key) {
      if (prefetchTransferIdRef.current) {
        try {
          void window.api?.cancelDownload?.(prefetchTransferIdRef.current)
        } catch {}
        prefetchTransferIdRef.current = null
      }
      prefetchInFlightRef.current = false
    }

    if (prefetchingKeyRef.current === key || prefetchInFlightRef.current) return

    // Check if next track is already downloading in useDownloadStore
    const transfers = useDownloadStore.getState().transfers
    const isAlreadyDownloading = transfers.some((t) => {
      const matchTitle = t.title.toLowerCase() === nextSong.title.toLowerCase()
      const matchArtist = !nextSong.artist || !t.artist || t.artist.toLowerCase() === nextSong.artist.toLowerCase()
      return matchTitle && matchArtist && (t.status === 'downloading' || t.status === 'queued')
    })

    if (isAlreadyDownloading) {
      prefetchingKeyRef.current = key
      return
    }

    // Debounce prefetch by 3 seconds of continuous playback to prevent thrashing
    const timer = setTimeout(() => {
      if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

      prefetchInFlightRef.current = true
      prefetchingKeyRef.current = key

      const prefetchTrack = async () => {
        try {
          if (!window.api?.searchDownloadSource || !window.api?.startDownload) return

          // Check if exists in local library
          const librarySongs = (await window.api.getSongs?.()) || []
          if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

          const localMatch = findMatchingLibrarySong(nextSong.title, nextSong.artist, librarySongs)
          if (localMatch && localMatch.filePath) {
            usePlayerStore.getState().updateSong(localMatch as any)
            prefetchInFlightRef.current = false
            return
          }

          const [prioritySetting, accountsSetting, storageSetting] = await Promise.all([
            window.api.getSetting?.(DOWNLOAD_PRIORITY_SETTING),
            window.api.getSetting?.(STREAMING_ACCOUNTS_SETTING),
            window.api.getSetting?.(PLAYBACK_STORAGE_SETTING)
          ])

          if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

          const priority: DownloadSourceId[] =
            Array.isArray(prioritySetting) && prioritySetting.length > 0
              ? prioritySetting
              : DEFAULT_DOWNLOAD_PRIORITY
          const accounts = accountsSetting || {}
          const storageMode = storageSetting || 'download'
          const query = cleanSearchQuery(nextSong.artist, nextSong.title) || `${nextSong.artist || ''} ${nextSong.title}`.trim()

          let chosenSource: DownloadSourceId | null = null
          let chosenResult: any = null

          for (const source of priority) {
            if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return
            try {
              const searchPromise = window.api.searchDownloadSource(source, query, accounts)
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Prefetch search timed out on ${source}`)), 12000)
              )
              const rawResults = await Promise.race([searchPromise, timeoutPromise])
              if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

              const results = Array.isArray(rawResults) ? rawResults : []
              if (results.length === 0) continue

              const scored = results
                .map((item: any) => {
                  const match = scoreProviderMatch(
                    { title: nextSong.title, artist: nextSong.artist, duration: nextSong.duration },
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

              const topResult = scored[0]
              if (topResult) {
                chosenSource = source
                chosenResult = topResult
                break
              }
            } catch (err) {
              console.warn(`Prefetch search error on ${source}:`, err)
            }
          }

          if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

          if (!chosenSource || !chosenResult) {
            prefetchInFlightRef.current = false
            return
          }

          // Register background transfer (autoPlay: false)
          const transferId = useDownloadStore.getState().queueTransfer(
            {
              source: chosenSource,
              sourceName: chosenResult.sourceName || chosenSource,
              title: chosenResult.title,
              artist: nextSong.artist || chosenResult.artist,
              quality: chosenResult.quality || 'Auto',
              size: chosenResult.size || '',
              conflictMode: 'replace',
              status: 'queued',
              progress: 5,
              message: `Caching next track in background (${chosenResult.sourceName || chosenSource})...`,
              autoPlay: false,
              resultId: chosenResult.id,
              song: nextSong
            },
            { openDrawer: false }
          )
          prefetchTransferIdRef.current = transferId

          if (isCancelled || usePlayerStore.getState().currentSongIndex !== currentSongIndex) return

          await window.api.startDownload({
            transferId,
            source: chosenSource,
            resultId: chosenResult.id,
            title: chosenResult.title,
            artist: chosenResult.artist,
            songId: nextSong.id || '',
            conflictMode: 'replace',
            accounts,
            storageMode,
            autoPlay: false,
            skipIfExists: true,
            artworkUrl: chosenResult.artworkUrl || nextSong.artworkUrl,
            album: nextSong.album || chosenResult.album
          })
        } catch (error) {
          console.warn('Background prefetch failed for next track:', error)
        } finally {
          prefetchInFlightRef.current = false
        }
      }

      void prefetchTrack()
    }, 3000)

    return () => {
      isCancelled = true
      clearTimeout(timer)
      prefetchInFlightRef.current = false
    }
  }, [isPlaying, currentSongIndex, queue, repeatMode, isShuffle, isBuffering])

  return null
}
