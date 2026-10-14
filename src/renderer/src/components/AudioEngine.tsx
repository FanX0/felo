import { useCallback, useEffect, useRef } from 'react'
import { registerActiveAudioElement } from '../lib/audioBridge'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { usePrivateSessionStore } from '../hooks/usePrivateSessionStore'
import { toMediaUrl } from '../lib/media'
import { recordCertifiedScrobble } from '../lib/playbackEvents'
import type { Song } from '../pages/Library/Library'
import { remoteClient } from '../pages/Remote/remoteClient'

function shouldMaskMediaSession(): boolean {
  const { isPrivateSession, maskMediaSession } = usePrivateSessionStore.getState()
  return isPrivateSession && maskMediaSession
}

const MEDIA_ARTWORK_SIZES = [96, 128, 192, 256, 384, 512]

function getArtworkType(artworkPath?: string | null) {
  const extension = artworkPath?.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg'
  }
}

function getArtworkEntries(srcs: string[], type: string): MediaImage[] {
  return srcs.flatMap((src) =>
    MEDIA_ARTWORK_SIZES.map((size) => ({
      src,
      sizes: `${size}x${size}`,
      type
    }))
  )
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function getArtworkSource(song?: Song) {
  const artworkUrl = toMediaUrl(song?.artworkPath) || song?.artworkUrl
  if (!artworkUrl) return null

  const sources = [artworkUrl]
  if (song?.artworkPath && !/^(blob:|data:|https?:)/i.test(song.artworkPath)) {
    sources.push(`file:///${song.artworkPath.replace(/\\/g, '/').replace(/^\/+/, '')}`)
  }

  if (/^data:|^blob:|^https?:/i.test(artworkUrl)) {
    return {
      srcs: sources,
      type: getArtworkType(song?.artworkPath || (artworkUrl.includes('.png') ? 'png' : 'jpg'))
    }
  }

  try {
    const response = await fetch(artworkUrl)
    if (!response.ok) return null
    const blob = await response.blob()
    sources.unshift(await blobToDataUrl(blob))
    return {
      srcs: sources,
      type: blob.type || getArtworkType(song?.artworkPath)
    }
  } catch (error) {
    console.warn('Failed to load media session artwork:', error)
    return null
  }
}

function updateMediaPosition(audio: HTMLAudioElement): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return

  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration)
    })
  } catch (error) {
    console.warn('Failed to update media position state:', error)
  }
}

export default function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const resumeAfterSeekRef = useRef(false)
  const mediaMetadataGenerationRef = useRef(0)
  const currentSourceRef = useRef<string | null>(null)
  const retryCountRef = useRef(0)
  const lastPositionUpdateTimeRef = useRef(0)
  const scrobbledSongIdRef = useRef<string | null>(null)
  const playTimeAccumulatedRef = useRef<number>(0)
  const lastPlayTickRef = useRef<number>(0)
  const isChangingSourceRef = useRef(false)

  useEffect(() => {
    registerActiveAudioElement(audioRef.current)
    return () => registerActiveAudioElement(null)
  }, [])
  const volume = usePlayerStore((s) => s.volume)
  const seekRequest = usePlayerStore((s) => s.seekRequest)
  const playNext = usePlayerStore((s) => s.playNext)
  const playPrevious = usePlayerStore((s) => s.playPrevious)
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime)
  const setDuration = usePlayerStore((s) => s.setDuration)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)
  const setIsBuffering = usePlayerStore((s) => s.setIsBuffering)
  const seek = usePlayerStore((s) => s.seek)
  const clearSeekRequest = usePlayerStore((s) => s.clearSeekRequest)

  const applySeek = useCallback(
    (time: number) => {
      const audio = audioRef.current
      if (!audio) return false

      resumeAfterSeekRef.current = usePlayerStore.getState().isPlaying && !audio.paused

      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeekRef.current = time
        return false
      }

      const duration = Number.isFinite(audio.duration) ? audio.duration : time
      audio.currentTime = Math.max(0, Math.min(time, duration))
      setCurrentTime(audio.currentTime)

      return true
    },
    [setCurrentTime]
  )

  const startPlayback = (audio: HTMLAudioElement) => {
    remoteClient.pauseMobileAudio()
    audio.play().then(
      () => undefined,
      (error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // If we are currently changing sources or audio is still decoding/fetching metadata,
        // play() naturally rejects before the browser decodes data.
        // DO NOT reset isPlaying to false in that case! onCanPlay will resume playback.
        if (isChangingSourceRef.current || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return
        }
        console.warn('Playback failed:', error)
        usePlayerStore.getState().setIsPlaying(false)
      }
    )
  }

  const resumePendingPlayback = (audio: HTMLAudioElement) => {
    const state = usePlayerStore.getState()
    if (!state.isPlaying || !state.isAudioActive || !audio.paused) return
    startPlayback(audio)
  }

  // Zustand subscriptions run inside the original click event. This keeps browser
  // playback within the user activation required by strict autoplay policies.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const syncAudio = (state: ReturnType<typeof usePlayerStore.getState>) => {
      const song = state.queue[state.currentSongIndex]
      const isVirtual = !song?.filePath || song.filePath.startsWith('virtual:')
      if (isVirtual) {
        currentSourceRef.current = null
        retryCountRef.current = 0
        if ('mediaSession' in navigator) {
          if (song) {
            if (shouldMaskMediaSession()) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: 'Private Session',
                artist: 'Felo',
                album: 'Private Listening',
                artwork: []
              })
              navigator.mediaSession.playbackState = (state.isPlaying && state.isAudioActive) || state.isBuffering ? 'playing' : 'paused'
            } else {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: song.title || 'Buffering Track...',
                artist: song.artist || '',
                album: song.album || 'Felo',
                artwork: []
              })
              navigator.mediaSession.playbackState = (state.isPlaying && state.isAudioActive) || state.isBuffering ? 'playing' : 'paused'
              void getArtworkSource(song).then((artwork) => {
                if (!artwork || shouldMaskMediaSession()) return
                navigator.mediaSession.metadata = new MediaMetadata({
                  title: song.title || 'Buffering Track...',
                  artist: song.artist || '',
                  album: song.album || 'Felo',
                  artwork: getArtworkEntries(artwork.srcs, artwork.type)
                })
              })
            }
          } else {
            navigator.mediaSession.metadata = null
            navigator.mediaSession.playbackState = 'none'
          }
        }
        if (audio.src) {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        }
        return
      }

      const sourceUrl = toMediaUrl(song.filePath) ?? ''
      if (currentSourceRef.current !== sourceUrl) {
        currentSourceRef.current = sourceUrl
        isChangingSourceRef.current = true
        retryCountRef.current = 0
        scrobbledSongIdRef.current = null
        playTimeAccumulatedRef.current = 0
        lastPlayTickRef.current = performance.now()
        audio.src = sourceUrl
        audio.currentTime = 0
        setCurrentTime(0)
        setDuration(song.duration || 0)
      }

      if ('mediaSession' in navigator) {
        if (shouldMaskMediaSession()) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Private Session',
            artist: 'Felo',
            album: 'Private Listening',
            artwork: []
          })
          navigator.mediaSession.playbackState = state.isPlaying && state.isAudioActive ? 'playing' : 'paused'
          updateMediaPosition(audio)
        } else {
          const metadataGeneration = ++mediaMetadataGenerationRef.current
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || 'Unknown Track',
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Felo',
            artwork: []
          })
          navigator.mediaSession.playbackState = state.isPlaying && state.isAudioActive ? 'playing' : 'paused'
          updateMediaPosition(audio)

          void getArtworkSource(song).then((artwork) => {
            if (metadataGeneration !== mediaMetadataGenerationRef.current || shouldMaskMediaSession()) return
            navigator.mediaSession.metadata = new MediaMetadata({
              title: song.title || 'Unknown Track',
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Felo',
              artwork: artwork ? getArtworkEntries(artwork.srcs, artwork.type) : []
            })
            navigator.mediaSession.playbackState = usePlayerStore.getState().isPlaying && usePlayerStore.getState().isAudioActive ? 'playing' : 'paused'
            updateMediaPosition(audio)
          })
        }
      }

      // ONLY play audio if this tab is the designated active audio instance
      if (state.isPlaying && state.isAudioActive) {
        startPlayback(audio)
      } else {
        audio.pause()
      }
    }

    syncAudio(usePlayerStore.getState())
    return usePlayerStore.subscribe((state, previousState) => {
      const song = state.queue[state.currentSongIndex]
      const previousSong = previousState.queue[previousState.currentSongIndex]
      if (
        state.isPlaying !== previousState.isPlaying ||
        state.isAudioActive !== previousState.isAudioActive ||
        song?.id !== previousSong?.id ||
        song?.filePath !== previousSong?.filePath
      ) {
        syncAudio(state)
      }
    })
  }, [setCurrentTime, setDuration])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    const setHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
    setHandler('play', () => setIsPlaying(true))
    setHandler('pause', () => setIsPlaying(false))
    setHandler('previoustrack', playPrevious)
    setHandler('nexttrack', () => playNext(true))
    setHandler('seekbackward', (details) => {
      const audio = audioRef.current
      const offset = details.seekOffset || 10
      if (audio) seek(Math.max(0, audio.currentTime - offset))
    })
    setHandler('seekforward', (details) => {
      const audio = audioRef.current
      const offset = details.seekOffset || 10
      if (audio) seek(Math.min(audio.duration || Number.MAX_SAFE_INTEGER, audio.currentTime + offset))
    })
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })

    return () => {
      setHandler('play', null)
      setHandler('pause', null)
      setHandler('previoustrack', null)
      setHandler('nexttrack', null)
      setHandler('seekbackward', null)
      setHandler('seekforward', null)
      setHandler('seekto', null)
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
    }
  }, [playNext, playPrevious, seek, setIsPlaying])

  // Handle volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
    }
  }, [volume])

  // Handle seek requests from UI
  useEffect(() => {
    if (seekRequest !== null) {
      applySeek(seekRequest)
      clearSeekRequest()
    }
  }, [seekRequest, applySeek, clearSeekRequest])

  return (
    <audio
      ref={audioRef}
      preload="auto"
      playsInline
      onLoadedMetadata={(event) => {
        isChangingSourceRef.current = false
        if (pendingSeekRef.current !== null) {
          const pendingSeek = pendingSeekRef.current
          pendingSeekRef.current = null
          applySeek(pendingSeek)
        }
        resumePendingPlayback(event.currentTarget)
      }}
      onCanPlay={(event) => {
        isChangingSourceRef.current = false
        setIsBuffering(false)
        resumePendingPlayback(event.currentTarget)
      }}
      onWaiting={() => {
        if (usePlayerStore.getState().isPlaying) {
          setIsBuffering(true)
        }
      }}
      onPlaying={(event) => {
        isChangingSourceRef.current = false
        setIsBuffering(false)
        lastPlayTickRef.current = performance.now()
        if (!usePlayerStore.getState().isPlaying) {
          setIsPlaying(true)
        }
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
        updateMediaPosition(event.currentTarget)
      }}
      onPause={(event) => {
        const storeState = usePlayerStore.getState()
        const activeSong = storeState.queue[storeState.currentSongIndex]
        const isVirtual = !activeSong?.filePath || activeSong.filePath.startsWith('virtual:')
        if (!isVirtual && !storeState.isBuffering) {
          setIsBuffering(false)
        }
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
        // Synchronize store if paused externally (Bluetooth, OS controls, etc.)
        // ONLY if this tab is the active audio owner!
        if (
          !isChangingSourceRef.current &&
          !resumeAfterSeekRef.current &&
          !isVirtual &&
          storeState.isPlaying &&
          storeState.isAudioActive &&
          !storeState.isBuffering &&
          event.currentTarget.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          setIsPlaying(false)
        }
      }}
      onTimeUpdate={(e) => {
        const storeState = usePlayerStore.getState()
        if (!storeState.isAudioActive) return

        const currentTime = e.currentTarget.currentTime
        setCurrentTime(currentTime)

        // Accumulate active playback time (exclude pause/buffering)
        const nowPerf = performance.now()
        if (!e.currentTarget.paused && !e.currentTarget.seeking) {
          if (lastPlayTickRef.current > 0) {
            const delta = (nowPerf - lastPlayTickRef.current) / 1000
            if (delta > 0 && delta < 5) {
              playTimeAccumulatedRef.current += delta
            }
          }
        }
        lastPlayTickRef.current = nowPerf

        // Check scrobble threshold (>= 30s or >= 50% completion)
        const activeSong = storeState.queue[storeState.currentSongIndex]
        if (activeSong && scrobbledSongIdRef.current !== activeSong.id) {
          const songDur = e.currentTarget.duration || activeSong.duration || 0
          const isThirtySeconds = playTimeAccumulatedRef.current >= 30
          const isHalfway = songDur > 0 && (currentTime / songDur >= 0.5)

          if (isThirtySeconds || isHalfway) {
            scrobbledSongIdRef.current = activeSong.id
            const contextType = storeState.playbackContext?.type || 'library'
            void recordCertifiedScrobble(
              activeSong,
              songDur || playTimeAccumulatedRef.current,
              songDur > 0 ? currentTime / songDur : 1.0,
              contextType
            )
          }
        }

        // Throttle position updates to MediaSession to avoid spamming OS media session IPC
        const now = Date.now()
        if (now - lastPositionUpdateTimeRef.current > 3000) {
          lastPositionUpdateTimeRef.current = now
          updateMediaPosition(e.currentTarget)
        }
      }}
      onDurationChange={(e) => {
        const storeState = usePlayerStore.getState()
        if (!storeState.isAudioActive) return
        setDuration(e.currentTarget.duration || 0)
        updateMediaPosition(e.currentTarget)
      }}
      onError={(event) => {
        const storeState = usePlayerStore.getState()
        if (!storeState.isAudioActive) return
        const activeSong = storeState.queue[storeState.currentSongIndex]
        const isVirtual = !activeSong?.filePath || activeSong.filePath.startsWith('virtual:')
        if (isVirtual || !event.currentTarget.src) {
          // Virtual track or cleared audio source; ignore synthetic DOM error
          return
        }
        setIsBuffering(false)
        const error = event.currentTarget.error
        console.warn('Audio source error:', error)
        if (retryCountRef.current < 1 && audioRef.current?.src) {
          retryCountRef.current += 1
          console.log('Retrying audio playback once...')
          isChangingSourceRef.current = true
          audioRef.current.load()
          return
        }
        console.warn('Audio playback unrecoverable for track, advancing to next:', activeSong?.title)
        setIsBuffering(false)
        if (storeState.queue.length > 1) {
          playNext()
        } else {
          setIsPlaying(false)
        }
      }}
      onSeeked={(e) => {
        const storeState = usePlayerStore.getState()
        if (!storeState.isAudioActive) return
        const shouldResume = resumeAfterSeekRef.current
        resumeAfterSeekRef.current = false
        setCurrentTime(e.currentTarget.currentTime)
        updateMediaPosition(e.currentTarget)

        if (shouldResume && storeState.isPlaying && e.currentTarget.paused) {
          e.currentTarget.play().catch((err) => {
            console.warn('Playback failed after seek:', err)
          })
        }
      }}
      onEnded={() => {
        const storeState = usePlayerStore.getState()
        if (!storeState.isAudioActive) return
        const activeSong = storeState.queue[storeState.currentSongIndex]
        if (activeSong && scrobbledSongIdRef.current !== activeSong.id) {
          scrobbledSongIdRef.current = activeSong.id
          const contextType = storeState.playbackContext?.type || 'library'
          void recordCertifiedScrobble(
            activeSong,
            activeSong.duration || playTimeAccumulatedRef.current,
            1.0,
            contextType
          )
        }
        playNext(false)
      }}
      style={{ display: 'none' }}
    />
  )
}
