import { useState, useEffect, useRef, useCallback } from 'react'
import type { Song } from '../../Library/Library'
import type { HomeSongItem } from '../types'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'
import { usePlaybackArbitration } from '../../../hooks/usePlaybackArbitration'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  STREAMING_ACCOUNTS_SETTING
} from '../../../lib/downloadConfig'
import {
  findMatchingLibrarySong,
  scoreProviderMatch,
  cleanSearchQuery
} from '../../../lib/songMatching'

export function useInfiniteRadio(
  librarySongs: Song[],
  setLibrarySongs: React.Dispatch<React.SetStateAction<Song[]>>
) {
  const { updateSong, setIsPlaying, currentSongIndex } = usePlayerStore()
  const { requestPlayQueue } = usePlaybackArbitration()
  const { queueTransfer, updateTransfer } = useDownloadStore()

  const [isInfiniteRadio, setIsInfiniteRadio] = useState(false)
  const radioSongsRef = useRef<Song[]>([])
  const radioRequestedRef = useRef<Set<string>>(new Set())
  const radioTransfersRef = useRef<Map<string, string>>(new Map())
  const radioDownloadInFlightRef = useRef(false)

  const startRadioDownload = useCallback(
    async (song: Song): Promise<void> => {
      if (
        radioDownloadInFlightRef.current ||
        radioRequestedRef.current.has(song.id) ||
        (song.filePath && !song.filePath.startsWith('virtual:'))
      ) {
        return
      }

      radioRequestedRef.current.add(song.id)
      radioDownloadInFlightRef.current = true
      const initialSource = DEFAULT_DOWNLOAD_PRIORITY[0]
      const transferId = queueTransfer(
        {
          source: initialSource,
          sourceName: 'Searching providers',
          title: song.title,
          artist: song.artist,
          quality: 'Auto quality',
          size: 'Searching...',
          conflictMode: 'keep_both',
          status: 'queued',
          progress: 0,
          message: `Infinite Radio: searching for ${song.title}...`,
          song
        },
        { openDrawer: false }
      )
      radioTransfersRef.current.set(transferId, song.id)

      const sourceName = (source: string) =>
        source === 'qobuz'
          ? 'Qobuz'
          : source === 'deezer'
            ? 'Deezer'
            : source === 'soulseek'
              ? 'Soulseek P2P'
              : 'YouTube Music'

      try {
        const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
        const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
        const priority =
          Array.isArray(savedPriority) && savedPriority.length > 0
            ? savedPriority
            : DEFAULT_DOWNLOAD_PRIORITY
        const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

        for (const source of priority) {
          updateTransfer(transferId, {
            source,
            sourceName: sourceName(source),
            message: `Infinite Radio: searching ${sourceName(source)}...`
          })
          try {
            const searchPromise = window.api?.searchDownloadSource?.(
              source,
              cleanSearchQuery(song.artist, song.title) || `${song.artist} ${song.title}`.trim(),
              accounts
            )
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Infinite Radio search timed out on ${source}`)),
                12000
              )
            )
            const rawResults = await Promise.race([searchPromise, timeoutPromise])
            const results = Array.isArray(rawResults) ? rawResults : []
            if (results.length === 0) continue

            const scored = results
              .map((item: any) => {
                const match = scoreProviderMatch(
                  { title: song.title, artist: song.artist, duration: song.duration },
                  item
                )
                return { ...item, _score: match.score }
              })
              .filter((item: any) => item._score >= 60)
              .sort((a: any, b: any) => b._score - a._score)

            const result = scored[0]
            if (!result) continue

            updateTransfer(transferId, {
              quality: result.quality || 'Auto quality',
              size: result.size || 'Calculating...',
              message: `Infinite Radio: downloading ${song.title} from ${sourceName(source)}...`
            })
            await window.api?.startDownload?.({
              transferId,
              source,
              resultId: String(result.id),
              title: result.title || song.title,
              artist: result.artist || song.artist,
              songId: song.id,
              conflictMode: 'keep_both',
              accounts,
              artworkUrl: result.artworkUrl || (song as any).artworkUrl,
              album: result.album || (song as any).album
            })
            return
          } catch (error) {
            console.warn(`Infinite Radio ${source} attempt failed:`, error)
          }
        }

        updateTransfer(transferId, {
          status: 'failed',
          progress: 0,
          message: `No provider result found for "${song.title}".`
        })
        radioRequestedRef.current.delete(song.id)
        radioDownloadInFlightRef.current = false
        const failDetail = {
          transferId,
          songId: song.id,
          title: song.title,
          artist: song.artist,
          message: `No provider result found for "${song.title}".`
        }
        window.dispatchEvent(new CustomEvent('fanxmusic:download-failed', { detail: failDetail }))
        window.dispatchEvent(new CustomEvent('felo:download-failed', { detail: failDetail }))
      } catch (error) {
        updateTransfer(transferId, {
          status: 'failed',
          progress: 0,
          message: 'Infinite Radio could not start the download.'
        })
        radioRequestedRef.current.delete(song.id)
        radioDownloadInFlightRef.current = false
        console.warn('Infinite Radio download setup failed:', error)
      }
    },
    [queueTransfer, updateTransfer]
  )

  const startInfiniteRadio = useCallback(
    (songs: HomeSongItem[]) => {
      const list: Song[] = songs.map((song) => {
        const localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)

        return (
          localSong || {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album || '',
            duration: song.duration,
            filePath: `virtual:online:${song.id}`,
            artworkPath: song.artworkUrl,
            size: 0,
            dateAdded: Math.floor(Date.now() / 1000)
          }
        )
      })
      radioSongsRef.current = list
      radioRequestedRef.current.clear()
      radioTransfersRef.current.clear()
      setIsInfiniteRadio(true)
      void requestPlayQueue(list, 0, {
        type: 'radio',
        title: 'Infinite Radio'
      })
      if (list[0]) {
        void startRadioDownload(list[0])
      }
    },
    [librarySongs, requestPlayQueue, startRadioDownload]
  )

  useEffect(() => {
    if (!isInfiniteRadio) return

    const unsubscribe = window.api?.onDownloadProgress?.((event: any) => {
      if (event?.status !== 'completed' || !event.transferId) return
      const songId = radioTransfersRef.current.get(event.transferId)
      if (!songId) return

      const songIndex = radioSongsRef.current.findIndex((song) => song.id === songId)
      const song = radioSongsRef.current[songIndex]
      radioDownloadInFlightRef.current = false
      if (!song || !event.filePath) return

      const downloadedSong = { ...song, filePath: event.filePath }
      radioSongsRef.current[songIndex] = downloadedSong
      setLibrarySongs((previous) => [
        ...previous.filter((candidate) => candidate.id !== downloadedSong.id),
        downloadedSong
      ])
      updateSong(downloadedSong)
      if (songIndex === usePlayerStore.getState().currentSongIndex) setIsPlaying(true)
      radioTransfersRef.current.delete(event.transferId)

      const nextSong = radioSongsRef.current[songIndex + 1]
      const currentIndex = usePlayerStore.getState().currentSongIndex
      if (nextSong && currentIndex >= songIndex) void startRadioDownload(nextSong)
    })

    return () => unsubscribe?.()
  }, [isInfiniteRadio, setLibrarySongs, updateSong, setIsPlaying, startRadioDownload])

  useEffect(() => {
    if (!isInfiniteRadio) return

    const nextSong = radioSongsRef.current[currentSongIndex + 1]
    if (nextSong) void startRadioDownload(nextSong)
  }, [currentSongIndex, isInfiniteRadio, startRadioDownload])

  return {
    isInfiniteRadio,
    startInfiniteRadio
  }
}
