import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { usePlaybackArbitration } from '../hooks/usePlaybackArbitration'
import { useListeningStore } from '../hooks/useListeningStore'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import type { Song } from '../types/song'

export default function AutoPlayBridge(): null {
  const { requestPlayQueue } = usePlaybackArbitration()
  const hasTriggeredInitialAutoplay = useRef(false)

  useEffect(() => {
    let isCancelled = false

    const attemptAutoPlayFirstLocalSong = async (isStartup = false) => {
      // 1. Check if the player already has a track or is playing
      const player = usePlayerStore.getState()
      if (player.queue.length > 0 && player.currentSongIndex >= 0 && player.queue[player.currentSongIndex]) {
        return
      }

      // 2. Check if this device is joined in an active Listen Together room or remote session
      const joinedRoom = useListeningStore.getState().joinedRoom
      if (joinedRoom && joinedRoom.song) {
        return
      }
      const activeRemote = useConnectedDeviceStore.getState().activePlayback
      if (activeRemote?.isPlaying && activeRemote.song) {
        return
      }

      try {
        // 3. Fetch local songs from Electron IPC / webApi
        let songs: Song[] = []
        if (typeof window !== 'undefined' && window.api?.getSongs) {
          try {
            songs = (await window.api.getSongs()) || []
          } catch (err) {
            console.warn('[AutoPlayBridge] Failed to fetch library songs:', err)
          }
        }

        // Fallback for web or remote mode: check cached / PC library songs
        if (songs.length === 0) {
          const pcSongs = useConnectedDeviceStore.getState().pcLibrarySongs
          if (pcSongs && pcSongs.length > 0) {
            songs = pcSongs
          }
        }

        if (isCancelled || songs.length === 0) return

        // Check again: ensure no other playback started while awaiting getSongs()
        const latestPlayer = usePlayerStore.getState()
        if (latestPlayer.queue.length > 0 && latestPlayer.currentSongIndex >= 0) {
          return
        }

        // 4. Sort songs by date added descending (newest first, identical to local library order)
        const sorted = [...songs].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
        const firstSong = sorted[0]
        if (!firstSong) return

        const isAutoplay = latestPlayer.isAutoplay

        console.log(
          `[AutoPlayBridge] Auto-initializing player with first local song: "${firstSong.title}" by "${firstSong.artist}" (autoplay=${isAutoplay})`
        )

        if (isAutoplay || !isStartup) {
          // Auto-play the first song immediately
          requestPlayQueue(sorted, 0, {
            type: 'library',
            title: 'Your Library',
            route: '/library'
          })
        } else {
          // If user specifically has autoplay disabled, load queue with the first song paused
          latestPlayer.setQueue(sorted, 0, {
            type: 'library',
            title: 'Your Library',
            route: '/library'
          })
          latestPlayer.setIsPlaying(false)
        }
      } catch (error) {
        console.warn('[AutoPlayBridge] Error during auto-play attempt:', error)
      }
    }

    // Run startup auto-play check once on initial mount
    if (!hasTriggeredInitialAutoplay.current) {
      hasTriggeredInitialAutoplay.current = true
      // Short delay (80ms) to allow IPC bridges and stores to settle
      const timer = setTimeout(() => {
        void attemptAutoPlayFirstLocalSong(true)
      }, 80)

      const handleLibraryUpdated = () => {
        void attemptAutoPlayFirstLocalSong(false)
      }

      window.addEventListener('felo:library-updated', handleLibraryUpdated)
      window.addEventListener('fanxmusic:library-updated', handleLibraryUpdated)

      return () => {
        isCancelled = true
        clearTimeout(timer)
        window.removeEventListener('felo:library-updated', handleLibraryUpdated)
        window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdated)
      }
    }

    return () => {
      isCancelled = true
    }
  }, [requestPlayQueue])

  return null
}
