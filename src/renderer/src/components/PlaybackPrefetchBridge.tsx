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

export default function PlaybackPrefetchBridge(): null {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  const queue = usePlayerStore((s) => s.queue)
  const isShuffle = usePlayerStore((s) => s.isShuffle)
  const repeatMode = usePlayerStore((s) => s.repeatMode)
  const currentTime = usePlayerStore((s) => s.currentTime)

  const prefetchingKeyRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!isPlaying || queue.length === 0 || currentSongIndex < 0) return

    // Allow 3 seconds of stable playback before prefetching the next track
    if (currentTime < 3) return

    // Calculate target next track
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

    // If next track already has a valid local file, no need to prefetch
    if (nextSong.filePath && !nextSong.filePath.startsWith('virtual:')) return

    const key = `${nextSong.title.toLowerCase()}::${(nextSong.artist || '').toLowerCase()}`
    if (prefetchingKeyRef.current === key || inFlightRef.current) return

    // Check if next track is already in the download queue
    const transfers = useDownloadStore.getState().transfers
    const isAlreadyDownloading = transfers.some(
      (t) =>
        t.title.toLowerCase() === nextSong.title.toLowerCase() &&
        (t.status === 'downloading' || t.status === 'queued')
    )
    if (isAlreadyDownloading) {
      prefetchingKeyRef.current = key
      return
    }

    inFlightRef.current = true
    prefetchingKeyRef.current = key

    const prefetchTrack = async () => {
      try {
        if (!window.api?.searchDownloadSource || !window.api?.startDownload) return

        // 1. Check if the song was already downloaded or exists in the local library
        const librarySongs = (await window.api.getSongs?.()) || []
        const localMatch = findMatchingLibrarySong(nextSong.title, nextSong.artist, librarySongs)
        if (localMatch && localMatch.filePath) {
          usePlayerStore.getState().updateSong(localMatch as any)
          inFlightRef.current = false
          return
        }

        // 2. Load user preferences for sources and accounts
        const [prioritySetting, accountsSetting, storageSetting] = await Promise.all([
          window.api.getSetting?.(DOWNLOAD_PRIORITY_SETTING),
          window.api.getSetting?.(STREAMING_ACCOUNTS_SETTING),
          window.api.getSetting?.(PLAYBACK_STORAGE_SETTING)
        ])

        const priority: DownloadSourceId[] = Array.isArray(prioritySetting) && prioritySetting.length > 0
          ? prioritySetting
          : DEFAULT_DOWNLOAD_PRIORITY
        const accounts = accountsSetting || {}
        const storageMode = storageSetting || 'download'
        const query = cleanSearchQuery(nextSong.artist, nextSong.title) || `${nextSong.artist || ''} ${nextSong.title}`.trim()

        let chosenSource: DownloadSourceId | null = null
        let chosenResult: any = null

        // 3. Search sources in priority order for a high-confidence match
        for (const source of priority) {
          try {
            const rawResults = await window.api.searchDownloadSource(source, query, accounts)
            const results = Array.isArray(rawResults) ? rawResults : []
            if (results.length === 0) continue

            // Score candidate results to ensure we don't prefetch the wrong remix or live cut
            const scored = results.map((item: any) => {
              const match = scoreProviderMatch(
                { title: nextSong.title, artist: nextSong.artist, duration: nextSong.duration },
                item
              )
              return { ...item, _score: match.score }
            }).sort((a: any, b: any) => b._score - a._score)

            const topResult = scored[0]
            if (topResult && topResult._score >= 60) {
              chosenSource = source
              chosenResult = topResult
              break
            }
          } catch (err) {
            console.warn(`Prefetch search failed on ${source}:`, err)
          }
        }

        if (!chosenSource || !chosenResult) {
          inFlightRef.current = false
          return
        }

        // 4. Register transfer in background mode (autoPlay: false, openDrawer: false)
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
            resultId: chosenResult.id
          },
          { openDrawer: false }
        )

        // 5. Start background download
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
        inFlightRef.current = false
      }
    }

    void prefetchTrack()
  }, [isPlaying, currentSongIndex, queue, isShuffle, repeatMode, currentTime])

  return null
}
