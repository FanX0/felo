import { useEffect, useRef } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { toMediaUrl } from '../lib/media'

export default function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeekRef = useRef<number | null>(null)
  const resumeAfterSeekRef = useRef(false)
  const {
    queue,
    currentSongIndex,
    isPlaying,
    volume,
    playNext,
    setCurrentTime,
    setDuration,
    seekRequest,
    clearSeekRequest
  } = usePlayerStore()

  const currentSong = queue[currentSongIndex]

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

  // Handle track/source change
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (currentSong?.filePath) {
      const sourceUrl = toMediaUrl(currentSong.filePath) ?? ''
      if (audio.src !== sourceUrl) {
        audio.src = sourceUrl
        audio.load()
      }
      audio.currentTime = 0

      if (isPlaying) {
        audio.play().catch((err) => {
          console.warn('Playback failed on track change:', err)
        })
      }
    } else {
      audio.removeAttribute('src')
      audio.load()
    }
  }, [currentSong?.id, currentSong?.filePath])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentSong?.filePath) return

    if (isPlaying) {
      audio.play().catch((err) => {
        console.warn('Playback interrupted or failed:', err)
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, currentSong?.filePath])

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
      onLoadedMetadata={() => {
        if (pendingSeekRef.current === null) return
        const pendingSeek = pendingSeekRef.current
        pendingSeekRef.current = null
        applySeek(pendingSeek)
      }}
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
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
