import { useCallback, useEffect, useRef } from 'react'
import { Volume2 } from 'lucide-react'
import { registerActiveAudioElement, notifyAudioTrackChanged } from '../lib/audioBridge'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { usePrivateSessionStore } from '../hooks/usePrivateSessionStore'
import { toMediaUrl } from '../lib/media'
import { recordCertifiedScrobble } from '../lib/playbackEvents'
import type { Song } from '../pages/Library/Library'
import { remoteClient } from '../pages/Remote/remoteClient'
import { resolveSongAudioUrl } from '../lib/songAudioResolver'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { useDownloadStore } from '../hooks/useDownloadStore'
import { useListeningStore } from '../hooks/useListeningStore'
import { setIsSessionSyncing, needsInitialSync, setNeedsInitialSync } from '../stores/listening/helpers'
import { audioDspEngine } from '../lib/audioDspEngine'
import { getLocalSlotPoolFile } from '../lib/jitAudioPipeline'
import { getTrackDisplayTitle } from '../lib/songUtils'
import { isYouTubeSong } from '../lib/youtubeService'
import { isElectron } from '../lib/appConfig'

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
  // CRITICAL: Filter out any file: or media: schemes that throw SecurityError on web browsers
  const safeSrcs = srcs.filter((s) => s && /^(https?:|data:|blob:|\/|\.\/)/i.test(s))
  return safeSrcs.flatMap((src) =>
    MEDIA_ARTWORK_SIZES.map((size) => ({
      src,
      sizes: `${size}x${size}`,
      type
    }))
  )
}

function safeSetMediaMetadata(metadata: {
  title: string
  artist: string
  album?: string
  artwork?: MediaImage[]
} | null): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  try {
    if (!metadata) {
      navigator.mediaSession.metadata = null
      return
    }
    if (typeof MediaMetadata === 'undefined') return

    const safeArtwork = (metadata.artwork || []).filter((art) => {
      if (!art || !art.src) return false
      return /^(https?:|data:|blob:|\/|\.\/)/i.test(art.src)
    })

    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title || '',
      artist: metadata.artist || '',
      album: metadata.album || 'Felo',
      artwork: safeArtwork
    })
  } catch (err) {
    console.warn('[AudioEngine] safeSetMediaMetadata error ignored:', err)
  }
}

function safeSetPlaybackState(state: 'none' | 'paused' | 'playing'): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  try {
    navigator.mediaSession.playbackState = state
  } catch {
    // ignore
  }
}

/**
 * Safari / WebKit AudioSession category hint (direct port from MUSIXQUARE media-session.ts).
 * Declaring 'playback' category ensures audio remains audible across app backgrounding,
 * screen locks, and ignores the physical mute switch on iOS.
 */
function requestPlaybackAudioSession(): void {
  if (typeof navigator === 'undefined') return
  const audioSession = (navigator as any).audioSession
  if (!audioSession) return
  try {
    audioSession.type = 'playback'
  } catch (error) {
    console.debug('[AudioEngine] Playback audio session is unavailable:', error)
  }
}

async function getArtworkSource(song?: Song) {
  const artworkUrl = toMediaUrl(song?.artworkPath) || song?.artworkUrl
  if (!artworkUrl) return null

  // In web environment, file: URLs and media: URLs MUST NOT be passed to MediaSession or fetched
  if (/^file:|^media:/i.test(artworkUrl)) return null

  if (/^(data:|blob:|https?:)/i.test(artworkUrl)) {
    return {
      srcs: [artworkUrl],
      type: getArtworkType(song?.artworkPath || (artworkUrl.includes('.png') ? 'png' : 'jpg'))
    }
  }

  return null
}

function updateMediaPosition(audio: HTMLAudioElement): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return

  try {
    const curTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.max(0, Math.min(curTime, audio.duration))
    })
  } catch (error) {
    console.warn('Failed to update media position state:', error)
  }
}

export default function AudioEngine() {
  const isAutoplayBlocked = useListeningStore((s) => s.isAutoplayBlocked)
  const audioRefA = useRef<HTMLAudioElement>(null)
  const audioRefB = useRef<HTMLAudioElement>(null)
  const activeChannelRef = useRef<'A' | 'B'>('A')

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
  const isCrossfadingRef = useRef(false)
  const crossfadeTimerRef = useRef<number | null>(null)
  const preloadedUrlRef = useRef<string | null>(null)
  const decodeGenerationRef = useRef(0)
  const localBufferLoadedSongIdRef = useRef<string | null>(null)
  void decodeGenerationRef
  void localBufferLoadedSongIdRef

  const getActiveAudio = useCallback((): HTMLAudioElement | null => {
    return activeChannelRef.current === 'A' ? audioRefA.current : audioRefB.current
  }, [])

  const getInactiveAudio = useCallback((): HTMLAudioElement | null => {
    return activeChannelRef.current === 'A' ? audioRefB.current : audioRefA.current
  }, [])

  // Mount: Attach both audio channels to the DSP graph and register the active element
  useEffect(() => {
    if (audioRefA.current) {
      audioDspEngine.attachAudioElement(audioRefA.current, 'A')
    }
    if (audioRefB.current) {
      audioDspEngine.attachAudioElement(audioRefB.current, 'B')
    }
    registerActiveAudioElement(getActiveAudio())
    requestPlaybackAudioSession()
    audioDspEngine.setCrossfadeMix(0, 0.01)
    audioDspEngine.setMasterVolume(usePlayerStore.getState().volume, 0)

    return () => {
      registerActiveAudioElement(null)
      audioDspEngine.detachAudioElement()
    }
  }, [getActiveAudio])

  // MUSIXQUARE-style global gesture recovery for mobile browsers (iOS WebKit / Android Chrome)
  useEffect(() => {
    const resumeFromGesture = () => {
      const audio = getActiveAudio()
      if (audio && usePlayerStore.getState().isPlaying && audio.paused) {
        audio.play().then(
          () => useListeningStore.getState().setIsAutoplayBlocked(false),
          () => {}
        )
      }
      void audioDspEngine.resume()
    }
    window.addEventListener('pointerdown', resumeFromGesture, { capture: true, passive: true })
    window.addEventListener('touchstart', resumeFromGesture, { capture: true, passive: true })
    window.addEventListener('keydown', resumeFromGesture, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', resumeFromGesture, { capture: true })
      window.removeEventListener('touchstart', resumeFromGesture, { capture: true })
      window.removeEventListener('keydown', resumeFromGesture, { capture: true })
    }
  }, [getActiveAudio])

  // Pause playback if this device switches to remote controller mode
  useEffect(() => {
    return useConnectedDeviceStore.subscribe((state, previousState) => {
      const isJoinedListeningRoom = Boolean(useListeningStore.getState().joinedRoom)
      if (
        !isJoinedListeningRoom &&
        state.devicePlaybackMode === 'remote_controller' &&
        previousState.devicePlaybackMode !== 'remote_controller'
      ) {
        const audioA = audioRefA.current
        const audioB = audioRefB.current
        if (audioA && !audioA.paused) audioA.pause()
        if (audioB && !audioB.paused) audioB.pause()
      }
    })
  }, [])

  // WebKit Background wake & frozen clock stall health recovery (from MUSIXQUARE)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && usePlayerStore.getState().isPlaying) {
        void audioDspEngine.probeAudioContextHealth({ attemptResume: true }).then((health) => {
          if (health.reason === 'clock-stalled') {
            console.warn('[AudioEngine] WebKit AudioContext clock freeze detected upon foreground return; restarting output')
            const activeAudio = getActiveAudio()
            if (activeAudio && !activeAudio.paused) {
              audioDspEngine.restartAudioContextFromGesture().catch(() => {})
            }
          }
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [getActiveAudio])

  const volume = usePlayerStore((s) => s.volume)
  const seekRequest = usePlayerStore((s) => s.seekRequest)
  const playNext = usePlayerStore((s) => s.playNext)
  const playPrevious = usePlayerStore((s) => s.playPrevious)
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime)
  const setDuration = usePlayerStore((s) => s.setDuration)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)
  const setIsBuffering = usePlayerStore((s) => s.setIsBuffering)
  const seek = usePlayerStore((s) => s.seek)
  const skipTime = usePlayerStore((s) => s.skipTime)
  const clearSeekRequest = usePlayerStore((s) => s.clearSeekRequest)

  const handleEnded = useCallback(
    (channel: 'A' | 'B') => {
      if (isCrossfadingRef.current) return
      if (channel !== activeChannelRef.current) return
      const isBuf = audioDspEngine.isBufferActive(channel)
      const audio = getActiveAudio()
      if (!isBuf && (!audio?.src || audio.src.startsWith('data:audio/'))) return

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
      if (isBuf) {
        audioDspEngine.stopBuffer(channel)
      }

      // LISTEN TOGETHER GUEST: In a shared room, the host controls track transitions and looping!
      // The guest MUST NOT advance the queue or loop independently when their local audio finishes.
      const listeningState = useListeningStore.getState()
      if (listeningState.joinedRoom && !listeningState.isReceivingDeviceStream) {
        console.log('[AudioEngine] Joined room track ended; waiting for host transition or loop')
        if (audio && !audio.paused) {
          audio.pause()
        }
        return
      }

      playNext(false)
    },
    [getActiveAudio, playNext]
  )

  const applySeek = useCallback(
    (time: number) => {
      const inRoom = Boolean(useListeningStore.getState().joinedRoom)
      // Avoid micro-stutter/pop if seekRequest(0) arrives mid-crossfade (unless in room sync loop)
      if (isCrossfadingRef.current && time === 0 && !inRoom) return true

      if (audioDspEngine.isBufferActive(activeChannelRef.current)) {
        const channel = activeChannelRef.current
        const buf = audioDspEngine.getCurrentAudioBuffer(channel)
        audioDspEngine.seekBuffer(time, channel)
        const shouldPlay = resumeAfterSeekRef.current || (inRoom && usePlayerStore.getState().isPlaying)
        if (shouldPlay && !audioDspEngine.isBufferPlaying(channel) && buf) {
          audioDspEngine.playBuffer(buf, time, () => handleEnded(channel), channel)
        }
        setCurrentTime(time)
        return true
      }

      const audio = getActiveAudio()
      if (!audio) return false

      resumeAfterSeekRef.current = usePlayerStore.getState().isPlaying

      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
        pendingSeekRef.current = time
        return false
      }

      const duration = Number.isFinite(audio.duration) ? audio.duration : time
      const wasEnded = audio.ended
      const targetTime = Math.max(0, Math.min(time, duration))
      if (Math.abs(audio.currentTime - targetTime) > 0.05 || wasEnded) {
        audio.currentTime = targetTime
      }
      setCurrentTime(targetTime)

      const shouldResume = resumeAfterSeekRef.current || (inRoom && usePlayerStore.getState().isPlaying)
      if ((wasEnded || audio.paused) && shouldResume) {
        audio.play().catch((err) => {
          console.warn('[AudioEngine] Playback failed resuming after ended:', err)
        })
      }

      return true
    },
    [getActiveAudio, setCurrentTime, handleEnded]
  )

  // Web Audio buffer source position sync ticker
  useEffect(() => {
    let animId: number
    const tick = () => {
      const channel = activeChannelRef.current
      if (audioDspEngine.isBufferPlaying(channel)) {
        const curTime = audioDspEngine.getBufferPosition(channel)
        const buf = audioDspEngine.getCurrentAudioBuffer(channel)
        const dur = buf?.duration || 0
        setCurrentTime(curTime)
        if (dur > 0) setDuration(dur)
        if (usePlayerStore.getState().isBuffering) {
          setIsBuffering(false)
        }

        // Scrobble tracking for buffer source
        const storeState = usePlayerStore.getState()
        const activeSong = storeState.queue[storeState.currentSongIndex]
        if (activeSong && scrobbledSongIdRef.current !== activeSong.id) {
          const songDur = dur || activeSong.duration || 0
          const isThirtySeconds = curTime >= 30
          const isHalfway = songDur > 0 && curTime / songDur >= 0.5
          if (isThirtySeconds || isHalfway) {
            scrobbledSongIdRef.current = activeSong.id
            const contextType = storeState.playbackContext?.type || 'library'
            void recordCertifiedScrobble(
              activeSong,
              songDur,
              songDur > 0 ? curTime / songDur : 1.0,
              contextType
            )
          }
        }
      }
      animId = requestAnimationFrame(tick)
    }
    animId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animId)
  }, [setCurrentTime, setDuration])

  const startPlayback = (audio: HTMLAudioElement) => {
    if (!audio.src) return
    requestPlaybackAudioSession()
    const isJoinedListeningRoom = Boolean(useListeningStore.getState().joinedRoom)
    const mode = useConnectedDeviceStore.getState().devicePlaybackMode
    if (mode === 'remote_controller' && !isJoinedListeningRoom) {
      if (!audio.paused) audio.pause()
      return
    }

    // Stop the inactive channel so two audio elements NEVER play simultaneously
    const otherAudio = audio === audioRefA.current ? audioRefB.current : audioRefA.current
    if (otherAudio && !isCrossfadingRef.current) {
      try {
        if (!otherAudio.paused) otherAudio.pause()
        otherAudio.removeAttribute('src')
        otherAudio.load()
      } catch {}
    }
    audioDspEngine.stopBuffer()
    window.dispatchEvent(new CustomEvent('felo:stop-youtube'))

    remoteClient.pauseMobileAudio()
    audio.muted = false
    void audioDspEngine.resume()
    console.log('[AudioEngine] startPlayback called, src:', audio.src.substring(0, 80), 'readyState:', audio.readyState)
    try {
      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise.then(
          () => {
            console.log('[AudioEngine] play() succeeded')
            useListeningStore.getState().setIsAutoplayBlocked(false)
          },
          (error) => {
            if (error instanceof DOMException && error.name === 'AbortError') return
            if (
              isChangingSourceRef.current ||
              audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
              audio.networkState === HTMLMediaElement.NETWORK_LOADING
            ) {
              console.log('[AudioEngine] play() pending source load, will retry on canplay:', error?.message)
              return
            }
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
              console.warn('[AudioEngine] Autoplay blocked by browser. User tap needed to unlock speaker.')
              useListeningStore.getState().setIsAutoplayBlocked(true)
              return
            }
            console.warn('[AudioEngine] Playback failed (will retry on canplay/loaded):', error)
          }
        )
      }
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        useListeningStore.getState().setIsAutoplayBlocked(true)
        return
      }
      console.warn('Synchronous play() exception:', err)
    }
  }

  const resumePendingPlayback = (audio: HTMLAudioElement) => {
    const state = usePlayerStore.getState()
    if (!state.isPlaying || !state.isAudioActive || !audio.paused) {
      return
    }
    const mode = useConnectedDeviceStore.getState().devicePlaybackMode
    if (mode === 'remote_controller') return
    startPlayback(audio)
  }

  // Preload the upcoming track onto the inactive channel for 0ms gapless transitions
  const schedulePreload = useCallback(() => {
    const state = usePlayerStore.getState()
    let nextSong: Song | undefined
    if (state.repeatMode === 'one') {
      nextSong = state.queue[state.currentSongIndex]
    } else {
      const nextIndex = state.currentSongIndex + 1
      nextSong = state.queue[nextIndex]
      if (!nextSong && state.repeatMode === 'all' && state.queue.length > 0) {
        nextSong = state.queue[0]
      }
    }
    if (!nextSong) {
      preloadedUrlRef.current = null
      const inactive = getInactiveAudio()
      if (inactive && inactive.src) {
        inactive.removeAttribute('src')
        inactive.load()
      }
      return
    }

    const nextUrl = resolveSongAudioUrl(nextSong)
    if (!nextUrl) {
      preloadedUrlRef.current = null
      const inactive = getInactiveAudio()
      if (inactive && inactive.src) {
        inactive.removeAttribute('src')
        inactive.load()
      }
      return
    }

    const inactiveAudio = getInactiveAudio()
    if (!inactiveAudio) return

    if (preloadedUrlRef.current !== nextUrl) {
      preloadedUrlRef.current = nextUrl
      if (/^(https?|media):/i.test(nextUrl)) {
        inactiveAudio.crossOrigin = 'anonymous'
      } else {
        inactiveAudio.removeAttribute('crossOrigin')
      }
      inactiveAudio.src = nextUrl
      inactiveAudio.preload = 'auto'
      inactiveAudio.load()
      console.log(`[AudioEngine] Preloaded track "${nextSong.title}" onto inactive Channel ${activeChannelRef.current === 'A' ? 'B' : 'A'}`)
    }
  }, [getInactiveAudio])

  // Trigger studio-grade equal-power cosine crossfade between Channel A and Channel B
  const triggerCrossfade = useCallback(
    (fadeDuration: number) => {
      if (isCrossfadingRef.current) return
      const state = usePlayerStore.getState()
      let nextSong: Song | undefined
      if (state.repeatMode === 'one') {
        nextSong = state.queue[state.currentSongIndex]
      } else {
        const nextIndex = state.currentSongIndex + 1
        nextSong = state.queue[nextIndex]
        if (!nextSong && state.repeatMode === 'all' && state.queue.length > 0) {
          nextSong = state.queue[0]
        }
      }
      if (!nextSong) return

      const nextUrl = resolveSongAudioUrl(nextSong)
      if (!nextUrl) return

      const outgoingChannel = activeChannelRef.current
      const incomingChannel = outgoingChannel === 'A' ? 'B' : 'A'
      const outgoingAudio = outgoingChannel === 'A' ? audioRefA.current : audioRefB.current
      const incomingAudio = incomingChannel === 'B' ? audioRefB.current : audioRefA.current
      if (!outgoingAudio || !incomingAudio) return

      isCrossfadingRef.current = true
      console.log(`[AudioEngine] Crossfading from Channel ${outgoingChannel} to Channel ${incomingChannel} (${fadeDuration}s) for "${nextSong.title}"`)

      if (incomingAudio.src !== nextUrl) {
        if (/^(https?|media):/i.test(nextUrl)) {
          incomingAudio.crossOrigin = 'anonymous'
        } else {
          incomingAudio.removeAttribute('crossOrigin')
        }
        incomingAudio.src = nextUrl
      }
      incomingAudio.currentTime = 0
      incomingAudio.muted = false

      void audioDspEngine.resume()
      incomingAudio
        .play()
        .then(() => {
          // Equal-power cosine/sine crossfade: 0 = 100% Channel A, 1 = 100% Channel B
          const targetMix = incomingChannel === 'B' ? 1.0 : 0.0
          audioDspEngine.setCrossfadeMix(targetMix, fadeDuration)

          activeChannelRef.current = incomingChannel
          registerActiveAudioElement(incomingAudio)
          currentSourceRef.current = nextUrl
          scrobbledSongIdRef.current = null
          playTimeAccumulatedRef.current = 0
          lastPlayTickRef.current = performance.now()
          preloadedUrlRef.current = null

          // Advance player queue without resetting incoming channel
          state.playNext(false)

          if (crossfadeTimerRef.current !== null) {
            window.clearTimeout(crossfadeTimerRef.current)
          }
          crossfadeTimerRef.current = window.setTimeout(() => {
            try {
              outgoingAudio.pause()
              outgoingAudio.removeAttribute('src')
              outgoingAudio.load()
            } catch {}
            isCrossfadingRef.current = false
            schedulePreload()
          }, Math.round(fadeDuration * 1000) + 120)
        })
        .catch((err) => {
          console.warn('[AudioEngine] Crossfade incoming play error:', err)
          isCrossfadingRef.current = false
        })
    },
    [schedulePreload]
  )

  // Synchronize player store state with active audio channel
  useEffect(() => {
    const syncAudio = (state: ReturnType<typeof usePlayerStore.getState>) => {
      try {
        const listeningState = useListeningStore.getState()
        const isDeviceStreamActive = Boolean(
          listeningState.isReceivingDeviceStream ||
          listeningState.joinedRoom?.is_device_stream ||
          listeningState.joinedRoom?.song?.isDeviceStream ||
          listeningState.hostRoom?.is_device_stream ||
          listeningState.hostRoom?.song?.isDeviceStream
        )

        const song = state.queue[state.currentSongIndex]
        const playableUrl = song ? resolveSongAudioUrl(song) : null
        const isVirtual = !playableUrl
        const audio = getActiveAudio()
        if (!audio) return

        if (isDeviceStreamActive) {
          if (audio.src) {
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
          }
          const otherAudio = getInactiveAudio()
          if (otherAudio && otherAudio.src) {
            otherAudio.pause()
            otherAudio.removeAttribute('src')
            otherAudio.load()
          }
          audioDspEngine.stopBuffer()
          window.dispatchEvent(new CustomEvent('felo:stop-youtube'))
          return
        }

        if (isVirtual) {
          currentSourceRef.current = null
          if (song) {
            if (isYouTubeSong(song)) {
              usePlayerStore.setState({ isBuffering: false, isAudioActive: true })
            }

            const isListenTogetherGuest = Boolean(listeningState.joinedRoom && !listeningState.isReceivingDeviceStream)

            // Web environment: no PlaybackStreamBridge or DownloadEventBridge available,
            // so virtual songs with no playable URL will never resolve outside a Listen Together room.
            if (!isElectron && state.isBuffering && !isListenTogetherGuest) {
              usePlayerStore.setState({ isBuffering: false })
              if (!isYouTubeSong(song)) {
                console.warn('[AudioEngine] Virtual song with no playback path on web:', song.title)
                window.dispatchEvent(new CustomEvent('felo:track-unavailable', {
                  detail: {
                    title: song.title,
                    artist: song.artist,
                    message: `Track "${song.title}" is unavailable for playback in web mode.`
                  }
                }))
                if (state.queue.length > 1) {
                  setTimeout(() => usePlayerStore.getState().playNext(true), 100)
                } else {
                  usePlayerStore.setState({ isPlaying: false })
                }
              }
            }

            if (shouldMaskMediaSession()) {
              safeSetMediaMetadata({
                title: 'Private Session',
                artist: 'Felo',
                album: 'Private Listening',
                artwork: []
              })
              safeSetPlaybackState((state.isPlaying && state.isAudioActive) || state.isBuffering ? 'playing' : 'paused')
            } else {
              safeSetMediaMetadata({
                title: getTrackDisplayTitle(song, 'Buffering Track...'),
                artist: song.artist || '',
                album: song.album || 'Felo',
                artwork: []
              })
              safeSetPlaybackState((state.isPlaying && state.isAudioActive) || state.isBuffering ? 'playing' : 'paused')
              void getArtworkSource(song).then((artwork) => {
                if (!artwork || shouldMaskMediaSession()) return
                safeSetMediaMetadata({
                  title: getTrackDisplayTitle(song, 'Buffering Track...'),
                  artist: song.artist || '',
                  album: song.album || 'Felo',
                  artwork: getArtworkEntries(artwork.srcs, artwork.type)
                })
              })
            }
          } else {
            safeSetMediaMetadata(null)
            safeSetPlaybackState('none')
          }
          if (audio.src) {
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
          }
          const otherAudio = getInactiveAudio()
          if (otherAudio && otherAudio.src) {
            otherAudio.pause()
            otherAudio.removeAttribute('src')
            otherAudio.load()
          }
          audioDspEngine.stopBuffer()
          return
        }

        // Mid-crossfade update: metadata was already aligned, skip reload
        if (isCrossfadingRef.current && currentSourceRef.current === playableUrl) {
          if (shouldMaskMediaSession()) {
            safeSetMediaMetadata({
              title: 'Private Session',
              artist: 'Felo',
              album: 'Private Listening',
              artwork: []
            })
            safeSetPlaybackState('playing')
          } else {
            safeSetMediaMetadata({
              title: getTrackDisplayTitle(song),
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Felo',
              artwork: []
            })
            safeSetPlaybackState('playing')
            void getArtworkSource(song).then((artwork) => {
              if (shouldMaskMediaSession()) return
              safeSetMediaMetadata({
                title: getTrackDisplayTitle(song),
                artist: song.artist || 'Unknown Artist',
                album: song.album || 'Felo',
                artwork: artwork ? getArtworkEntries(artwork.srcs, artwork.type) : []
              })
            })
          }
          updateMediaPosition(audio)
          return
        }

        // Cancel any pending crossfade timer on direct manual song changes
        if (crossfadeTimerRef.current !== null) {
          window.clearTimeout(crossfadeTimerRef.current)
          crossfadeTimerRef.current = null
        }
        if (isCrossfadingRef.current) {
          const other = getInactiveAudio()
          if (other) {
            try {
              if (!other.paused) other.pause()
              other.removeAttribute('src')
              other.load()
            } catch {}
          }
          isCrossfadingRef.current = false
          audioDspEngine.setCrossfadeMix(activeChannelRef.current === 'B' ? 1.0 : 0.0, 0.01)
        }

        const isLocalBrowserSong = !isElectron && Boolean(
          song && (
            (playableUrl && (playableUrl.startsWith('blob:') || playableUrl.startsWith('data:'))) ||
            getLocalSlotPoolFile(song.id) ||
            song.isLocalToDevice ||
            !song.isOnline
          )
        )

        if (isLocalBrowserSong && song) {
          const songKey = song.id || playableUrl || song.title
          const isSameSong = localBufferLoadedSongIdRef.current === songKey && audioDspEngine.isBufferActive(activeChannelRef.current)

          if (!isSameSong) {
            audioDspEngine.clearBuffer(activeChannelRef.current)
            if (audio.src) {
              audio.pause()
              audio.removeAttribute('src')
              audio.load()
            }
            localBufferLoadedSongIdRef.current = songKey
            currentSourceRef.current = playableUrl || song.id
            retryCountRef.current = 0
            scrobbledSongIdRef.current = null
            playTimeAccumulatedRef.current = 0
            lastPlayTickRef.current = performance.now()

            const inRoom = Boolean(useListeningStore.getState().joinedRoom && !useListeningStore.getState().isReceivingDeviceStream)
            const targetTime = inRoom ? useListeningStore.getState().calculateCurrentHostTargetTime() : 0
            const isHostPlaying = inRoom ? (useListeningStore.getState().joinedRoom?.is_playing ?? true) : usePlayerStore.getState().isPlaying

            setCurrentTime(targetTime)
            setDuration(song.duration || 0)

            const decodeGen = ++decodeGenerationRef.current
            setIsBuffering(true)

            void (async () => {
              try {
                let arrayBuffer: ArrayBuffer | null = null
                const slotFile = getLocalSlotPoolFile(song.id)
                if (slotFile) {
                  arrayBuffer = await slotFile.arrayBuffer()
                } else if (typeof window !== 'undefined' && (window as any).api?.readAudioFile) {
                  const res = await (window as any).api.readAudioFile(song.id, song.filePath)
                  if (res?.data) {
                    arrayBuffer = res.data instanceof ArrayBuffer ? res.data : res.data.buffer || null
                  }
                }
                if (!arrayBuffer && playableUrl) {
                  const resp = await fetch(playableUrl)
                  if (resp.ok) {
                    arrayBuffer = await resp.arrayBuffer()
                  }
                }

                if (!arrayBuffer) {
                  console.warn('[AudioEngine] Could not retrieve audio bytes for local song:', song.title)
                  setIsBuffering(false)
                  return
                }

                if (decodeGen !== decodeGenerationRef.current) return

                await audioDspEngine.resume()
                const decoded = await audioDspEngine.decodeAudioData(arrayBuffer)
                if (decodeGen !== decodeGenerationRef.current) return

                setDuration(decoded.duration)
                setCurrentTime(targetTime)
                setIsBuffering(false)

                const shouldPlayNow = (inRoom ? isHostPlaying : usePlayerStore.getState().isPlaying) && usePlayerStore.getState().isAudioActive
                if (shouldPlayNow) {
                  audioDspEngine.setCrossfadeMix(activeChannelRef.current === 'B' ? 1.0 : 0.0, 0.01)
                  audioDspEngine.playBuffer(
                    decoded,
                    targetTime,
                    () => handleEnded(activeChannelRef.current),
                    activeChannelRef.current
                  )
                  safeSetPlaybackState('playing')
                } else {
                  safeSetPlaybackState('paused')
                }
                if (inRoom) {
                  useListeningStore.getState().performOneTimeSyncWithHost({
                    forceSeek: true,
                    logReason: 'Web Audio buffer playback ready'
                  })
                }
                console.log(`[AudioEngine] Web Audio buffer playback ready for "${song.title}" (${decoded.duration.toFixed(1)}s, offset=${targetTime.toFixed(2)}s)`)
              } catch (decodeErr) {
                console.warn('[AudioEngine] Web Audio buffer decode failed, falling back to HTMLAudioElement:', decodeErr)
                setIsBuffering(false)
                if (playableUrl && audio) {
                  audio.src = playableUrl
                  audio.load()
                  startPlayback(audio)
                }
              }
            })()
          } else {
            // Same track: handle play / pause
            const isJoinedListeningRoom = Boolean(useListeningStore.getState().joinedRoom)
            const mode = useConnectedDeviceStore.getState().devicePlaybackMode
            const shouldPlay = state.isPlaying && state.isAudioActive && (mode !== 'remote_controller' || isJoinedListeningRoom)
            if (shouldPlay) {
              const buf = audioDspEngine.getCurrentAudioBuffer(activeChannelRef.current)
              if (buf && !audioDspEngine.isBufferPlaying(activeChannelRef.current)) {
                setIsBuffering(false)
                const pos = audioDspEngine.getBufferPosition(activeChannelRef.current)
                audioDspEngine.playBuffer(buf, pos, () => handleEnded(activeChannelRef.current), activeChannelRef.current)
                safeSetPlaybackState('playing')
              }
            } else {
              if (audioDspEngine.isBufferActive(activeChannelRef.current)) {
                audioDspEngine.pauseBuffer(activeChannelRef.current)
                safeSetPlaybackState('paused')
              }
            }
          }

          if (shouldMaskMediaSession()) {
            safeSetMediaMetadata({
              title: 'Private Session',
              artist: 'Felo',
              album: 'Private Listening',
              artwork: []
            })
            safeSetPlaybackState(state.isPlaying && state.isAudioActive ? 'playing' : 'paused')
          } else {
            const metadataGeneration = ++mediaMetadataGenerationRef.current
            safeSetMediaMetadata({
              title: getTrackDisplayTitle(song),
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Felo',
              artwork: []
            })
            safeSetPlaybackState(state.isPlaying && state.isAudioActive ? 'playing' : 'paused')
            void getArtworkSource(song).then((artwork) => {
              if (metadataGeneration !== mediaMetadataGenerationRef.current || shouldMaskMediaSession()) return
              safeSetMediaMetadata({
                title: getTrackDisplayTitle(song),
                artist: song.artist || 'Unknown Artist',
                album: song.album || 'Felo',
                artwork: artwork ? getArtworkEntries(artwork.srcs, artwork.type) : []
              })
            })
          }

          schedulePreload()
          return
        }

        localBufferLoadedSongIdRef.current = null

        const sourceUrl = playableUrl ?? ''
        const inactiveAudio = getInactiveAudio()

        // Check if the next song was already preloaded on the inactive audio
        const isPreloadedOnInactive = Boolean(inactiveAudio && inactiveAudio.src && inactiveAudio.src === sourceUrl)

        const inRoom = Boolean(useListeningStore.getState().joinedRoom && !useListeningStore.getState().isReceivingDeviceStream)

        if (isPreloadedOnInactive && inactiveAudio) {
          // Instant gapless switch to the preloaded channel with smooth 30ms micro-fade
          const nextChannel = activeChannelRef.current === 'A' ? 'B' : 'A'
          activeChannelRef.current = nextChannel
          registerActiveAudioElement(inactiveAudio)
          audioDspEngine.setCrossfadeMix(nextChannel === 'B' ? 1.0 : 0.0, 0.03)
          if (audio) {
            try {
              if (!audio.paused) audio.pause()
              audio.removeAttribute('src')
              audio.load()
            } catch {}
          }
          currentSourceRef.current = sourceUrl
          retryCountRef.current = 0
          scrobbledSongIdRef.current = null
          playTimeAccumulatedRef.current = 0
          lastPlayTickRef.current = performance.now()

          if (inRoom) {
            const targetTime = useListeningStore.getState().calculateCurrentHostTargetTime()
            inactiveAudio.currentTime = targetTime
            inactiveAudio.playbackRate = 1.0
            setCurrentTime(targetTime)
            setDuration(song.duration || inactiveAudio.duration || 0)
            useListeningStore.getState().performOneTimeSyncWithHost({
              forceSeek: true,
              logReason: 'Preloaded channel switch 1-time sync'
            })
          } else {
            inactiveAudio.currentTime = 0
            inactiveAudio.playbackRate = 1.0
            setCurrentTime(0)
            setDuration(song.duration || inactiveAudio.duration || 0)
          }
        } else if (currentSourceRef.current !== sourceUrl) {
          audioDspEngine.stopBuffer()
          const inactive = getInactiveAudio()
          if (inactive) {
            try {
              if (!inactive.paused) inactive.pause()
              inactive.removeAttribute('src')
              inactive.load()
            } catch {}
          }
          if (audio && !audio.paused) {
            try {
              audio.pause()
            } catch {}
          }
          window.dispatchEvent(new CustomEvent('felo:stop-youtube'))
          currentSourceRef.current = sourceUrl
          isChangingSourceRef.current = true
          retryCountRef.current = 0
          scrobbledSongIdRef.current = null
          playTimeAccumulatedRef.current = 0
          lastPlayTickRef.current = performance.now()
          console.log(`[AudioEngine] Setting Channel ${activeChannelRef.current} audio.src =`, sourceUrl.substring(0, 100))

          if (/^(https?|media):/i.test(sourceUrl)) {
            audio.crossOrigin = 'anonymous'
          } else {
            audio.removeAttribute('crossOrigin')
          }

          audioDspEngine.setCrossfadeMix(activeChannelRef.current === 'B' ? 1.0 : 0.0, 0.01)

          audio.src = sourceUrl
          audio.playbackRate = 1.0

          if (inRoom) {
            const targetTime = useListeningStore.getState().calculateCurrentHostTargetTime()
            const isHostPlaying = useListeningStore.getState().joinedRoom?.is_playing ?? true
            if (targetTime > 0.05 || !isHostPlaying || pendingSeekRef.current === null) {
              pendingSeekRef.current = targetTime
              setCurrentTime(targetTime)
            }
            setNeedsInitialSync(true)
          } else {
            if (audio.currentTime !== 0) {
              audio.currentTime = 0
            }
            setCurrentTime(0)
          }
          setDuration(song.duration || 0)
        }

        const currentActiveAudio = getActiveAudio() || audio
        registerActiveAudioElement(currentActiveAudio)

        if (shouldMaskMediaSession()) {
          safeSetMediaMetadata({
            title: 'Private Session',
            artist: 'Felo',
            album: 'Private Listening',
            artwork: []
          })
          safeSetPlaybackState(state.isPlaying && state.isAudioActive ? 'playing' : 'paused')
          updateMediaPosition(currentActiveAudio)
        } else {
          const metadataGeneration = ++mediaMetadataGenerationRef.current
          safeSetMediaMetadata({
            title: getTrackDisplayTitle(song),
            artist: song.artist || 'Unknown Artist',
            album: song.album || 'Felo',
            artwork: []
          })
          safeSetPlaybackState(state.isPlaying && state.isAudioActive ? 'playing' : 'paused')
          updateMediaPosition(currentActiveAudio)

          void getArtworkSource(song).then((artwork) => {
            if (metadataGeneration !== mediaMetadataGenerationRef.current || shouldMaskMediaSession()) return
            safeSetMediaMetadata({
              title: getTrackDisplayTitle(song),
              artist: song.artist || 'Unknown Artist',
              album: song.album || 'Felo',
              artwork: artwork ? getArtworkEntries(artwork.srcs, artwork.type) : []
            })
            safeSetPlaybackState(usePlayerStore.getState().isPlaying && usePlayerStore.getState().isAudioActive ? 'playing' : 'paused')
            updateMediaPosition(currentActiveAudio)
          })
        }

        const isJoinedListeningRoom = Boolean(useListeningStore.getState().joinedRoom)
        const mode = useConnectedDeviceStore.getState().devicePlaybackMode
        const shouldPlay = state.isPlaying && state.isAudioActive && (mode !== 'remote_controller' || isJoinedListeningRoom)
        if (shouldPlay) {
          if (audioDspEngine.isBufferActive(activeChannelRef.current)) {
            const buf = audioDspEngine.getCurrentAudioBuffer(activeChannelRef.current)
            if (buf && !audioDspEngine.isBufferPlaying(activeChannelRef.current)) {
              setIsBuffering(false)
              const pos = audioDspEngine.getBufferPosition(activeChannelRef.current)
              audioDspEngine.playBuffer(buf, pos, () => handleEnded(activeChannelRef.current), activeChannelRef.current)
            }
          } else {
            startPlayback(currentActiveAudio)
          }
        } else {
          if (audioDspEngine.isBufferActive(activeChannelRef.current)) {
            audioDspEngine.pauseBuffer(activeChannelRef.current)
          }
          currentActiveAudio.pause()
        }

        // Defer preload if current active audio is still buffering its initial frames
        if (currentActiveAudio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          schedulePreload()
        }
      } catch (syncErr) {
        console.warn('[AudioEngine syncAudio caught error]:', syncErr)
      }
    }

    syncAudio(usePlayerStore.getState())

    const handlePrivacyRefresh = () => {
      syncAudio(usePlayerStore.getState())
    }
    window.addEventListener('felo:private-session-changed', handlePrivacyRefresh)
    window.addEventListener('felo:media-session-refresh', handlePrivacyRefresh)

    const handleBlobCached = () => {
      schedulePreload()
    }
    window.addEventListener('felo:audio-blob-cached', handleBlobCached)

    const handleHotSwapQuality = (e: Event) => {
      const customEvent = e as CustomEvent<{
        fullUrl: string
        targetPosition: number
        songId: string
        wasPlaying?: boolean
      }>
      const detail = customEvent.detail
      if (!detail?.fullUrl) return

      const { fullUrl, targetPosition, wasPlaying } = detail
      const activeAudio = getActiveAudio()
      const inactiveAudio = getInactiveAudio()
      if (!inactiveAudio) return

      // If activeAudio is already playing this exact source, ignore
      if (currentSourceRef.current === fullUrl && activeAudio?.src === fullUrl) {
        return
      }

      console.log(`[AudioEngine] Seamless dual-channel hot-swap to full quality on Channel ${activeChannelRef.current === 'A' ? 'B' : 'A'} at ${targetPosition.toFixed(2)}s`)

      const nextChannel = activeChannelRef.current === 'A' ? 'B' : 'A'

      if (/^(https?|media):/i.test(fullUrl)) {
        inactiveAudio.crossOrigin = 'anonymous'
      } else {
        inactiveAudio.removeAttribute('crossOrigin')
      }

      inactiveAudio.src = fullUrl
      inactiveAudio.playbackRate = 1.0

      const performSwap = () => {
        try {
          const hostTarget = useListeningStore.getState().calculateCurrentHostTargetTime() || targetPosition
          inactiveAudio.currentTime = Math.max(0, hostTarget)

          const shouldPlay = typeof wasPlaying === 'boolean' ? wasPlaying : usePlayerStore.getState().isPlaying
          if (shouldPlay) {
            inactiveAudio.play().then(() => {
              activeChannelRef.current = nextChannel
              registerActiveAudioElement(inactiveAudio)
              audioDspEngine.setCrossfadeMix(nextChannel === 'B' ? 1.0 : 0.0, 0.04)

              if (activeAudio && !activeAudio.paused) {
                setTimeout(() => {
                  try {
                    activeAudio.pause()
                    activeAudio.removeAttribute('src')
                    activeAudio.load()
                  } catch {}
                }, 80)
              }
              currentSourceRef.current = fullUrl
              console.log(`[AudioEngine] Seamless hot-swap active on Channel ${nextChannel}`)
            }).catch((playErr) => {
              console.warn('[AudioEngine] Inactive play failed during hot-swap:', playErr)
            })
          } else {
            activeChannelRef.current = nextChannel
            registerActiveAudioElement(inactiveAudio)
            audioDspEngine.setCrossfadeMix(nextChannel === 'B' ? 1.0 : 0.0, 0.01)
            if (activeAudio) {
              activeAudio.pause()
              activeAudio.removeAttribute('src')
              activeAudio.load()
            }
            currentSourceRef.current = fullUrl
          }
        } catch (swapErr) {
          console.warn('[AudioEngine] performSwap error:', swapErr)
        }
      }

      if (inactiveAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        performSwap()
      } else {
        const onCanPlay = () => {
          inactiveAudio.removeEventListener('canplay', onCanPlay)
          performSwap()
        }
        inactiveAudio.addEventListener('canplay', onCanPlay)
        setTimeout(() => {
          inactiveAudio.removeEventListener('canplay', onCanPlay)
        }, 3000)
      }
    }
    window.addEventListener('felo:hot-swap-quality', handleHotSwapQuality as EventListener)

    const unsubscribe = usePlayerStore.subscribe((state, previousState) => {
      const song = state.queue[state.currentSongIndex]
      const previousSong = previousState.queue[previousState.currentSongIndex]
      if (
        state.isPlaying !== previousState.isPlaying ||
        state.isAudioActive !== previousState.isAudioActive ||
        state.isBuffering !== previousState.isBuffering ||
        song?.id !== previousSong?.id ||
        song?.filePath !== previousSong?.filePath ||
        song?.audioUrl !== previousSong?.audioUrl
      ) {
        syncAudio(state)
      } else if (state.queue !== previousState.queue || state.repeatMode !== previousState.repeatMode) {
        schedulePreload()
      }
    })

    return () => {
      window.removeEventListener('felo:private-session-changed', handlePrivacyRefresh)
      window.removeEventListener('felo:media-session-refresh', handlePrivacyRefresh)
      window.removeEventListener('felo:audio-blob-cached', handleBlobCached)
      window.removeEventListener('felo:hot-swap-quality', handleHotSwapQuality as EventListener)
      unsubscribe()
    }
  }, [getActiveAudio, getInactiveAudio, schedulePreload, setCurrentTime, setDuration])

  // OS Media Session command handlers
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    const setHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
    setHandler('play', () => setIsPlaying(true))
    setHandler('pause', () => setIsPlaying(false))
    setHandler('stop', () => setIsPlaying(false))
    setHandler('previoustrack', () => playPrevious())
    setHandler('nexttrack', () => playNext(true))
    setHandler('seekbackward', (details) => {
      skipTime(-(details.seekOffset || 10))
    })
    setHandler('seekforward', (details) => {
      skipTime(details.seekOffset || 10)
    })
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime)
    })

    return () => {
      setHandler('play', null)
      setHandler('pause', null)
      setHandler('stop', null)
      setHandler('previoustrack', null)
      setHandler('nexttrack', null)
      setHandler('seekbackward', null)
      setHandler('seekforward', null)
      setHandler('seekto', null)
      safeSetMediaMetadata(null)
      safeSetPlaybackState('none')
    }
  }, [getActiveAudio, playNext, playPrevious, seek, skipTime, setIsPlaying])

  // Handle volume changes exclusively via Web Audio masterGain for smooth ramps and full dynamic range (MUSIXQUARE parity)
  useEffect(() => {
    if (audioRefA.current) audioRefA.current.volume = 1.0
    if (audioRefB.current) audioRefB.current.volume = 1.0
    audioDspEngine.setMasterVolume(volume, 0.05)
  }, [volume])

  // Handle seek requests from UI
  useEffect(() => {
    if (seekRequest !== null) {
      applySeek(seekRequest)
      clearSeekRequest()
    }
  }, [seekRequest, applySeek, clearSeekRequest])

  // Buffering Stall Watchdog: If isBuffering stays true for 4 seconds without any
  // audio event resolving it (canplay, playing, error recovery, download completion),
  // assume the track is stalled and recover gracefully.
  const isBuffering = usePlayerStore((s) => s.isBuffering)
  const currentSongIndex = usePlayerStore((s) => s.currentSongIndex)
  useEffect(() => {
    if (!isBuffering) return

    const timer = setTimeout(() => {
      const currentState = usePlayerStore.getState()
      if (!currentState.isBuffering) return // already resolved naturally

      const activeSong = currentState.queue[currentState.currentSongIndex]
      if (isYouTubeSong(activeSong)) {
        // YouTube playback and buffering is managed exclusively by YouTubePlayerBridge
        return
      }
      const playableUrl = activeSong ? resolveSongAudioUrl(activeSong) : null

      // Check if this song is actively being downloaded or queued by background downloader
      const isDownloadActive = useDownloadStore.getState().transfers.some(
        (t) =>
          (t.status === 'downloading' || t.status === 'queued') &&
          (t.autoPlay || (activeSong && (t.song?.id === activeSong.id || t.title.toLowerCase() === activeSong.title?.toLowerCase())))
      )
      if (isDownloadActive) {
        // Download is legitimately in progress; do not prematurely abort or advance
        return
      }

      console.warn(
        '[AudioEngine] Buffering stall watchdog triggered after 4s for:',
        activeSong?.title,
        'playableUrl:', playableUrl ? playableUrl.substring(0, 80) : null
      )

      setIsBuffering(false)

      // If the song has no playable URL at all, it will never play — advance
      if (!playableUrl) {
        window.dispatchEvent(new CustomEvent('felo:track-unavailable', {
          detail: {
            title: activeSong?.title,
            artist: activeSong?.artist,
            message: `Track "${activeSong?.title || 'Unknown'}" timed out. Advancing to next track.`
          }
        }))
        if (currentState.queue.length > 1) {
          playNext(true)
        } else {
          setIsPlaying(false)
        }
      }
    }, 4_000)

    return () => clearTimeout(timer)
  }, [isBuffering, currentSongIndex, setIsBuffering, setIsPlaying, playNext])

  // Common audio element event handlers
  const handleLoadedMetadata = (channel: 'A' | 'B', event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    isChangingSourceRef.current = false
    event.currentTarget.muted = false
    setIsBuffering(false)
    if (pendingSeekRef.current !== null) {
      const pendingSeek = pendingSeekRef.current
      pendingSeekRef.current = null
      applySeek(pendingSeek)
    }

    // 1-Time Sync: If in a Listen Together room as a guest and needs initial sync (or after download),
    // sync immediately once metadata is ready
    const listeningState = useListeningStore.getState()
    if (listeningState.joinedRoom && !listeningState.isReceivingDeviceStream && needsInitialSync()) {
      listeningState.performOneTimeSyncWithHost({
        forceSeek: true,
        logReason: 'Audio metadata ready (1-time sync)'
      })
    }

    resumePendingPlayback(event.currentTarget)
    notifyAudioTrackChanged()
  }

  const handleCanPlay = (channel: 'A' | 'B', event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    isChangingSourceRef.current = false
    event.currentTarget.muted = false
    setIsBuffering(false)

    if (pendingSeekRef.current !== null) {
      const pendingSeek = pendingSeekRef.current
      pendingSeekRef.current = null
      applySeek(pendingSeek)
    }

    // Resilient fallback: ensure 1-time sync runs if loadedmetadata didn't catch it
    const listeningState = useListeningStore.getState()
    if (listeningState.joinedRoom && !listeningState.isReceivingDeviceStream && needsInitialSync()) {
      listeningState.performOneTimeSyncWithHost({
        forceSeek: true,
        logReason: 'Audio canplay ready (1-time sync)'
      })
    }

    resumePendingPlayback(event.currentTarget)
    notifyAudioTrackChanged()
    schedulePreload()
  }

  const handleWaiting = (channel: 'A' | 'B') => {
    if (channel === activeChannelRef.current && usePlayerStore.getState().isPlaying) {
      setIsBuffering(true)
    }
  }

  const handlePlaying = (channel: 'A' | 'B', event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    isChangingSourceRef.current = false
    event.currentTarget.muted = false
    setIsBuffering(false)
    lastPlayTickRef.current = performance.now()
    if (!usePlayerStore.getState().isPlaying) {
      setIsPlaying(true)
    }
    safeSetPlaybackState('playing')
    updateMediaPosition(event.currentTarget)
    notifyAudioTrackChanged()
    schedulePreload()
  }

  const handlePause = (channel: 'A' | 'B', event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    if (!event.currentTarget.src || event.currentTarget.src.startsWith('data:audio/')) {
      return
    }
    const storeState = usePlayerStore.getState()
    const activeSong = storeState.queue[storeState.currentSongIndex]
    const isVirtual = !resolveSongAudioUrl(activeSong)
    if (!isVirtual && !storeState.isBuffering) {
      setIsBuffering(false)
    }
    if (!storeState.isPlaying) {
      safeSetPlaybackState('paused')
    }
  }

  const handleTimeUpdate = (channel: 'A' | 'B', e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    if (!e.currentTarget.src || e.currentTarget.src.startsWith('data:audio/')) {
      return
    }
    const storeState = usePlayerStore.getState()
    if (!storeState.isAudioActive) return

    const currentTime = e.currentTarget.currentTime
    setCurrentTime(currentTime)
    if (storeState.isBuffering && currentTime > 0) {
      setIsBuffering(false)
    }

    // Accumulate active playback time
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
      const isHalfway = songDur > 0 && currentTime / songDur >= 0.5

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

    // Throttle position updates to MediaSession
    const now = Date.now()
    if (now - lastPositionUpdateTimeRef.current > 3000) {
      lastPositionUpdateTimeRef.current = now
      updateMediaPosition(e.currentTarget)
    }

    // Dynamic Cosine Crossfade trigger check
    const crossfadeEnabled = storeState.crossfadeEnabled
    const crossfadeDuration = storeState.crossfadeDuration || 4
    const duration = e.currentTarget.duration || 0
    const remaining = duration - currentTime
    if (
      crossfadeEnabled &&
      crossfadeDuration > 0 &&
      duration > 6 &&
      remaining <= crossfadeDuration &&
      remaining > 0.1 &&
      !isCrossfadingRef.current
    ) {
      triggerCrossfade(crossfadeDuration)
    }
  }

  const handleDurationChange = (channel: 'A' | 'B', e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    const storeState = usePlayerStore.getState()
    if (!storeState.isAudioActive) return
    setDuration(e.currentTarget.duration || 0)
    updateMediaPosition(e.currentTarget)
  }

  const handleError = (channel: 'A' | 'B', event: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    const storeState = usePlayerStore.getState()
    if (!storeState.isAudioActive) return
    const activeSong = storeState.queue[storeState.currentSongIndex]
    const playableUrl = activeSong ? resolveSongAudioUrl(activeSong) : null
    if (!playableUrl || !event.currentTarget.src) return

    setIsBuffering(false)
    isChangingSourceRef.current = false
    const error = event.currentTarget.error
    console.warn('[AudioEngine] HTMLAudioElement error:', error, 'src:', event.currentTarget.src)

    // MUSIXQUARE decoding fallback for local files
    if (activeSong && !audioDspEngine.isBufferActive(channel)) {
      const isLocal = Boolean(
        activeSong.filePath ||
        getLocalSlotPoolFile(activeSong.id) ||
        playableUrl.startsWith('media:') ||
        playableUrl.startsWith('blob:')
      )
      if (isLocal) {
        console.log('[AudioEngine] Attempting MUSIXQUARE AudioBuffer decode fallback for:', activeSong.title)
        void (async () => {
          try {
            let arrayBuffer: ArrayBuffer | null = null
            const slotFile = getLocalSlotPoolFile(activeSong.id)
            if (slotFile) {
              arrayBuffer = await slotFile.arrayBuffer()
            } else if (typeof window !== 'undefined' && (window as any).api?.readAudioFile && activeSong.filePath) {
              const res = await (window as any).api.readAudioFile(activeSong.id, activeSong.filePath)
              if (res?.data) {
                arrayBuffer = res.data.buffer
              }
            }
            if (!arrayBuffer && playableUrl) {
              const resp = await fetch(playableUrl)
              if (resp.ok) {
                arrayBuffer = await resp.arrayBuffer()
              }
            }
            if (arrayBuffer) {
              const decoded = await audioDspEngine.decodeAudioData(arrayBuffer)
              setDuration(decoded.duration)
              setIsBuffering(false)
              setIsPlaying(true)
              audioDspEngine.playBuffer(
                decoded,
                0,
                () => handleEnded(channel),
                channel
              )
              console.log('[AudioEngine] Successfully recovered playback with AudioBufferSourceNode!')
              return
            }
          } catch (decodeErr) {
            console.warn('[AudioEngine] AudioBuffer decode fallback error:', decodeErr)
          }

          if (retryCountRef.current < 1 && event.currentTarget.src) {
            retryCountRef.current += 1
            isChangingSourceRef.current = true
            event.currentTarget.load()
            return
          }
          console.warn('Audio playback unrecoverable for track, advancing to next:', activeSong?.title)
          const inRoom = Boolean(useListeningStore.getState().joinedRoom)
          if (!inRoom && storeState.queue.length > 1) {
            playNext(true)
          } else {
            setIsPlaying(false)
          }
        })()
        return
      }
    }

    if (retryCountRef.current < 1 && event.currentTarget.src) {
      retryCountRef.current += 1
      console.log('Retrying audio playback once...')
      isChangingSourceRef.current = true
      event.currentTarget.load()
      return
    }
    console.warn('Audio playback unrecoverable for track, advancing to next:', activeSong?.title)
    setIsBuffering(false)
    const inRoom = Boolean(useListeningStore.getState().joinedRoom)
    if (!inRoom && storeState.queue.length > 1) {
      playNext(true)
    } else {
      setIsPlaying(false)
    }
  }

  const handleSeeked = (channel: 'A' | 'B', e: React.SyntheticEvent<HTMLAudioElement>) => {
    if (channel !== activeChannelRef.current) return
    const storeState = usePlayerStore.getState()
    if (!storeState.isAudioActive) return
    const shouldResume = resumeAfterSeekRef.current
    resumeAfterSeekRef.current = false
    setCurrentTime(e.currentTarget.currentTime)
    updateMediaPosition(e.currentTarget)
    setIsSessionSyncing(false)

    if (shouldResume && storeState.isPlaying && e.currentTarget.paused) {
      e.currentTarget.play().catch((err) => {
        console.warn('Playback failed after seek:', err)
      })
    }
  }

  const renderAudioElement = (channel: 'A' | 'B', ref: React.RefObject<HTMLAudioElement | null>) => (
    <audio
      ref={ref}
      crossOrigin="anonymous"
      preload="auto"
      playsInline
      {...({ 'webkit-playsinline': 'true' } as any)}
      onLoadedMetadata={(event) => handleLoadedMetadata(channel, event)}
      onCanPlay={(event) => handleCanPlay(channel, event)}
      onWaiting={() => handleWaiting(channel)}
      onPlaying={(event) => handlePlaying(channel, event)}
      onPause={(event) => handlePause(channel, event)}
      onTimeUpdate={(event) => handleTimeUpdate(channel, event)}
      onDurationChange={(event) => handleDurationChange(channel, event)}
      onError={(event) => handleError(channel, event)}
      onSeeked={(event) => handleSeeked(channel, event)}
      onEnded={() => handleEnded(channel)}
      style={{
        position: 'fixed',
        bottom: 0,
        left: '-9999px',
        width: '1px',
        height: '1px',
        opacity: 0.01,
        pointerEvents: 'none'
      }}
    />
  )

  return (
    <>
      {renderAudioElement('A', audioRefA)}
      {renderAudioElement('B', audioRefB)}
      {isAutoplayBlocked && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => void useListeningStore.getState().enableSpeakerAudio()}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-6 py-3.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold shadow-[0_10px_35px_rgba(16,185,129,0.5)] animate-bounce cursor-pointer select-none transition-transform active:scale-95"
        >
          <Volume2 className="h-5 w-5 animate-pulse" />
          <span>Tap to Enable Audio</span>
        </div>
      )}
    </>
  )
}
