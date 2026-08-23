import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { toMediaUrl } from '../lib/media'
import type { Song } from '../pages/Library/Library'

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
  const artworkUrl = toMediaUrl(song?.artworkPath)
  if (!artworkUrl) return null

  const sources = [artworkUrl]
  if (song?.artworkPath && !/^(blob:|data:|https?:)/i.test(song.artworkPath)) {
    sources.push(`file:///${song.artworkPath.replace(/\\/g, '/').replace(/^\/+/, '')}`)
  }

  if (/^data:|^blob:|^https?:/i.test(artworkUrl)) {
    return {
      srcs: sources,
      type: getArtworkType(song?.artworkPath)
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
  const {
    volume,
    playNext,
    playPrevious,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    seek,
    seekRequest,
    clearSeekRequest
  } = usePlayerStore()

  const applySeek = (time: number) => {
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
  }

  const startPlayback = (audio: HTMLAudioElement) => {
    audio.play().then(
      () => undefined,
      (error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.warn('Playback failed:', error)
        usePlayerStore.getState().setIsPlaying(false)
      }
    )
  }

  const resumePendingPlayback = (audio: HTMLAudioElement) => {
    if (!usePlayerStore.getState().isPlaying || !audio.paused) return
    startPlayback(audio)
  }

  // Zustand subscriptions run inside the original click event. This keeps browser
  // playback within the user activation required by strict autoplay policies.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const syncAudio = (state: ReturnType<typeof usePlayerStore.getState>) => {
      const song = state.queue[state.currentSongIndex]
      if (!song?.filePath) {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = null
          navigator.mediaSession.playbackState = 'none'
        }
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        return
      }

      const sourceUrl = toMediaUrl(song.filePath) ?? ''
      if (audio.src !== sourceUrl) {
        audio.src = sourceUrl
        audio.currentTime = 0
        setCurrentTime(0)
        setDuration(song.duration || 0)
      }

      if ('mediaSession' in navigator) {
        const metadataGeneration = ++mediaMetadataGenerationRef.current
        navigator.mediaSession.metadata = new MediaMetadata({
          title: song.title || 'Unknown Track',
          artist: song.artist || 'Unknown Artist',
          album: song.album || 'Felo',
          artwork: []
        })
        navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused'
        updateMediaPosition(audio)

        void getArtworkSource(song).then((artwork) => {
          if (metadataGeneration !== mediaMetadataGenerationRef.current) return
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.title || 'Unknown Track',
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Felo',
            artwork: artwork ? getArtworkEntries(artwork.srcs, artwork.type) : []
          })
          navigator.mediaSession.playbackState = usePlayerStore.getState().isPlaying ? 'playing' : 'paused'
          updateMediaPosition(audio)
        })
      }

      if (state.isPlaying) {
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
    setHandler('nexttrack', playNext)
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
  }, [seekRequest])

  return (
    <audio
      ref={audioRef}
      preload="auto"
      playsInline
      onLoadedMetadata={(event) => {
        if (pendingSeekRef.current !== null) {
          const pendingSeek = pendingSeekRef.current
          pendingSeekRef.current = null
          applySeek(pendingSeek)
        }
        resumePendingPlayback(event.currentTarget)
      }}
      onCanPlay={(event) => resumePendingPlayback(event.currentTarget)}
      onPlaying={(event) => {
        setIsPlaying(true)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
        updateMediaPosition(event.currentTarget)
      }}
      onPause={() => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
      }}
      onTimeUpdate={(e) => {
        setCurrentTime(e.currentTarget.currentTime)
        updateMediaPosition(e.currentTarget)
      }}
      onDurationChange={(e) => {
        setDuration(e.currentTarget.duration || 0)
        updateMediaPosition(e.currentTarget)
      }}
      onError={(event) => {
        console.warn('Audio source error:', event.currentTarget.error)
        setIsPlaying(false)
      }}
      onSeeked={(e) => {
        const shouldResume = resumeAfterSeekRef.current
        resumeAfterSeekRef.current = false
        setCurrentTime(e.currentTarget.currentTime)

        if (shouldResume && usePlayerStore.getState().isPlaying && e.currentTarget.paused) {
          e.currentTarget.play().catch((err) => {
            console.warn('Playback failed after seek:', err)
          })
        }
      }}
      onEnded={playNext}
      style={{ display: 'none' }}
    />
  )
}
