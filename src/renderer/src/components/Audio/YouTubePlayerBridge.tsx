import { useEffect, useRef, useState, useCallback, useMemo, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import {
  Minimize2,
  Maximize2,
  PictureInPicture2,
  ArrowDownLeft,
  Volume2,
  VolumeX,
  SkipForward,
  RefreshCw
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { roomClockSync } from '../../lib/roomClockSync'
import { registerAudioTimeProvider } from '../../lib/audioBridge'
import {
  extractYouTubeVideoId,
  isYouTubeSong
} from '../../lib/youtubeService'

export { extractYouTubeVideoId, isYouTubeSong }

declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: (() => void) | undefined
  }
}

let _isScriptLoaded = false
export function isYouTubeScriptLoaded(): boolean {
  return _isScriptLoaded
}

let _isScriptLoading = false
const _apiReadyCallbacks: (() => void)[] = []

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.YT && window.YT.Player) {
    _isScriptLoaded = true
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    _apiReadyCallbacks.push(resolve)
    if (_isScriptLoading) return
    _isScriptLoading = true

    const prevCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      _isScriptLoaded = true
      _isScriptLoading = false
      if (typeof prevCallback === 'function') prevCallback()
      _apiReadyCallbacks.forEach((cb) => cb())
      _apiReadyCallbacks.length = 0
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = (err) => {
      _isScriptLoading = false
      console.error('[YouTubePlayerBridge] Failed to load YouTube IFrame API script:', err)
      reject(err)
    }
    document.head.appendChild(script)
  })
}

export default function YouTubePlayerBridge(): ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<any>(null)
  const activeVideoIdRef = useRef<string | null>(null)
  const isSyncingRef = useRef(false)
  const isBufferingRef = useRef(false)

  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isUserFloating, setIsUserFloating] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isFallbackIframe, setIsFallbackIframe] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)

  // Track In-Page Stage Dock element (#youtube-stage-dock) on ListenTogetherPage
  const [dockEl, setDockEl] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    return document.getElementById('youtube-stage-dock')
  })

  useEffect(() => {
    const updateDock = () => {
      const el = document.getElementById('youtube-stage-dock')
      setDockEl((prev) => (prev !== el ? el : prev))
    }

    updateDock()
    const observer = new MutationObserver(updateDock)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
    }
  }, [])

  const isDockedInStage = Boolean(dockEl && !isUserFloating)
  const portalTarget = isDockedInStage ? dockEl : typeof document !== 'undefined' ? document.body : null

  // Native Fullscreen API integration for whole-screen desktop presentation
  const enterFullscreen = useCallback(() => {
    setIsFullscreen(true)
    try {
      const root = containerRef.current || document.documentElement
      if (!document.fullscreenElement && root.requestFullscreen) {
        root.requestFullscreen().catch(() => {})
      }
    } catch {}
  }, [])

  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false)
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
    } catch {}
  }, [])

  // Sync with native HTML5 fullscreen changes (Esc key, YouTube native player fullscreen button)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNative = Boolean(document.fullscreenElement)
      setIsFullscreen(isNative)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Fullscreen keyboard fallback & body overflow lock
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        exitFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [isFullscreen, exitFullscreen])

  useEffect(() => {
    const handleExit = () => exitFullscreen()
    const handleEnter = () => enterFullscreen()
    window.addEventListener('felo:exit-fullscreen-youtube', handleExit)
    window.addEventListener('felo:enter-fullscreen-youtube', handleEnter)
    return () => {
      window.removeEventListener('felo:exit-fullscreen-youtube', handleExit)
      window.removeEventListener('felo:enter-fullscreen-youtube', handleEnter)
    }
  }, [enterFullscreen, exitFullscreen])

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('felo:youtube-fullscreen-status', {
        detail: { isFullscreen }
      })
    )
  }, [isFullscreen])

  // Allow stage placeholder to request re-docking
  useEffect(() => {
    const handleDock = () => {
      exitFullscreen()
      setIsUserFloating(false)
    }
    window.addEventListener('felo:dock-youtube-stage', handleDock)
    return () => window.removeEventListener('felo:dock-youtube-stage', handleDock)
  }, [exitFullscreen])

  // Allow native AudioEngine and Listen Together room exit to enforce immediate YouTube silence & teardown
  useEffect(() => {
    const handleStopYouTube = () => {
      try {
        playerRef.current?.pauseVideo?.()
        playerRef.current?.stopVideo?.()
        playerRef.current?.mute?.()
      } catch {}
      setIsFallbackIframe(false)
      activeVideoIdRef.current = null
      registerAudioTimeProvider(null)
    }
    window.addEventListener('felo:stop-youtube', handleStopYouTube)
    return () => window.removeEventListener('felo:stop-youtube', handleStopYouTube)
  }, [])

  // Listen Together context
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const hostRoom = useListeningStore((s) => s.hostRoom)
  const myRole = useListeningStore((s) => s.myRole)
  const manualSyncOffsetMs = useListeningStore((s) => s.manualSyncOffsetMs)
  const isListener = Boolean(joinedRoom && myRole === 'listener')
  const isHost = Boolean(hostRoom && !joinedRoom)
  const isReceivingDeviceStream = useListeningStore((s) => s.isReceivingDeviceStream)
  const isDeviceStreamActive = Boolean(
    isReceivingDeviceStream ||
    joinedRoom?.is_device_stream ||
    joinedRoom?.song?.isDeviceStream ||
    hostRoom?.is_device_stream ||
    hostRoom?.song?.isDeviceStream
  )

  // Autoplay compliance: Listeners start muted so browser allows programmatic stream playback
  const [isMuted, setIsMuted] = useState<boolean>(() => isListener)
  const [localVolume, setLocalVolume] = useState<number>(() => usePlayerStore.getState().volume || 0.8)
  const [isDesynced, setIsDesynced] = useState(false)
  const [desyncSeconds, setDesyncSeconds] = useState(0)

  // Player store bindings
  const currentSong = usePlayerStore((s) => s.queue[s.currentSongIndex])
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const seekRequest = usePlayerStore((s) => s.seekRequest)
  const clearSeekRequest = usePlayerStore((s) => s.clearSeekRequest)
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime)
  const setDuration = usePlayerStore((s) => s.setDuration)
  const playNext = usePlayerStore((s) => s.playNext)

  const isCurrentYouTube = isYouTubeSong(currentSong)
  const currentVideoId = useMemo(() => {
    if (!isCurrentYouTube || !currentSong) return null
    return (
      (currentSong as any).videoId ||
      extractYouTubeVideoId(currentSong.id?.replace(/^yt-/, '')) ||
      extractYouTubeVideoId(currentSong.audioUrl) ||
      extractYouTubeVideoId(currentSong.filePath)
    )
  }, [isCurrentYouTube, currentSong])

  // Teardown stale player on portal target change (e.g. moving into #youtube-stage-dock)
  useEffect(() => {
    if (playerRef.current) {
      try {
        playerRef.current.destroy?.()
      } catch {}
      playerRef.current = null
      setIsPlayerReady(false)
      activeVideoIdRef.current = null
    }
  }, [portalTarget])

  // Fallback watchdog: If YouTube API player doesn't mount an active iframe within 1.5s,
  // switch to direct iframe embed so user never gets stuck on an empty black screen
  useEffect(() => {
    if (!isCurrentYouTube || !currentVideoId || isFallbackIframe) return

    const timer = setTimeout(() => {
      const hasIframe = Boolean(containerRef.current?.querySelector('iframe'))
      if (!isPlayerReady || !hasIframe) {
        console.warn('[YouTubePlayerBridge] IFrame API initialization timed out, activating direct embed fallback')
        setIsFallbackIframe(true)
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [isCurrentYouTube, currentVideoId, isPlayerReady, isFallbackIframe, portalTarget])

  // 1. Initialize YouTube Player Iframe API
  useEffect(() => {
    let unmounted = false
    void loadYouTubeIframeApi().then(() => {
      if (unmounted || !containerRef.current) return

      // If an active iframe already exists and player is ready, do not duplicate
      if (playerRef.current && containerRef.current.querySelector('iframe')) {
        return
      }

      // Stale player cleanup if container was re-created by portal
      if (playerRef.current) {
        try {
          playerRef.current.destroy?.()
        } catch {}
        playerRef.current = null
        setIsPlayerReady(false)
        activeVideoIdRef.current = null
      }

      try {
        const playerId = `felo-yt-${Math.random().toString(36).slice(2, 8)}`
        const playerContainer = document.createElement('div')
        playerContainer.id = playerId
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(playerContainer)

        const state = usePlayerStore.getState()
        const initialSong = state.queue[state.currentSongIndex]
        const initialVid = currentVideoId || (isYouTubeSong(initialSong)
          ? (initialSong as any)?.videoId ||
            extractYouTubeVideoId(initialSong?.id?.replace(/^yt-/, '')) ||
            extractYouTubeVideoId(initialSong?.audioUrl) ||
            extractYouTubeVideoId(initialSong?.filePath)
          : null)

        const playerVars: Record<string, string | number> = {
          autoplay: 1,
          controls: isListener ? 0 : 1,
          disablekb: isListener ? 1 : 0,
          fs: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          iv_load_policy: 3,
          origin:
            typeof window !== 'undefined' && window.location.origin.startsWith('http')
              ? window.location.origin
              : 'https://www.youtube.com'
        }

        const playerOptions: any = {
          height: '100%',
          width: '100%',
          host: 'https://www.youtube.com',
          playerVars,
          events: {
            onReady: (event: any) => {
              if (unmounted) return
              setIsPlayerReady(true)

              // Explicitly inject security & DRM feature policies on the generated iframe
              try {
                const iframe = containerRef.current?.querySelector('iframe')
                if (iframe) {
                  iframe.setAttribute(
                    'allow',
                    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                  )
                  iframe.setAttribute('allowFullScreen', 'true')
                }
              } catch {}

              // Mute listeners initially to satisfy browser autoplay security
              if (isListener) {
                try {
                  event.target.mute()
                  setIsMuted(true)
                } catch {}
              } else {
                const vol = usePlayerStore.getState().volume
                try {
                  event.target.setVolume(Math.round(vol * 100))
                  if (vol === 0) {
                    event.target.mute()
                    setIsMuted(true)
                  } else {
                    event.target.unMute()
                    setIsMuted(false)
                  }
                } catch {}
              }

              // Synchronize play state if master queue is currently playing and track is genuinely YouTube
              const curState = usePlayerStore.getState()
              const curSong = curState.queue[curState.currentSongIndex]
              if (!isListener && curState.isPlaying && isYouTubeSong(curSong)) {
                try {
                  event.target.playVideo()
                } catch {}
                if (curState.currentTime > 0) {
                  try {
                    event.target.seekTo(curState.currentTime, true)
                  } catch {}
                }
              } else if (isListener && curState.isPlaying && isYouTubeSong(curSong)) {
                try {
                  event.target.mute()
                  setIsMuted(true)
                  const target = curState.currentTime > 0 ? curState.currentTime : 0
                  if (target > 0) {
                    event.target.seekTo(target, true)
                  }
                  event.target.playVideo()
                } catch {}
              } else {
                try {
                  event.target.pauseVideo()
                  if (curState.currentTime > 0) {
                    event.target.seekTo(curState.currentTime, true)
                  }
                } catch {}
              }
            },
            onStateChange: (event: any) => {
              if (unmounted) return
              // YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
              if (event.data === 1) {
                // Playing
                const room = useListeningStore.getState().joinedRoom
                const storeIsPlaying = usePlayerStore.getState().isPlaying
                if (isListener && room && (!room.is_playing || !storeIsPlaying)) {
                  // Host is paused! Immediately pause the video and do not dispatch playing state
                  try {
                    event.target.pauseVideo?.()
                  } catch {}
                  return
                }
                useListeningStore.getState().setIsAutoplayBlocked(false)
                usePlayerStore.setState({ isBuffering: false, isPlaying: true, isAudioActive: true })
                setPlayerError(null)
                try {
                  const dur = event.target.getDuration?.()
                  if (typeof dur === 'number' && dur > 0) {
                    usePlayerStore.setState({ duration: dur })
                  }
                } catch {}
              } else if (event.data === 2) {
                // Paused
                usePlayerStore.setState({ isBuffering: false })
                // Only host dispatches paused state to store; listeners follow host's command
                if (!isListener) {
                  usePlayerStore.setState({ isPlaying: false })
                }
              } else if (event.data === 3) {
                // Buffering
                usePlayerStore.setState({ isBuffering: true })
              } else if (event.data === 5) {
                // Cued
                usePlayerStore.setState({ isBuffering: false })
              } else if (event.data === 0) {
                // Ended -> ONLY the host advances the queue to prevent listener desync
                usePlayerStore.setState({ isBuffering: false })
                if (!isListener) {
                  playNext(false)
                }
              }
            },
            onError: (err: any) => {
              const code = err?.data
              console.warn('[YouTubePlayerBridge] YouTube Player error code:', code)
              usePlayerStore.setState({ isBuffering: false })
              if (code === 101 || code === 150) {
                setPlayerError('Video embedding restricted by owner. Switching to direct embed...')
                setIsFallbackIframe(true)
              } else if (code === 2) {
                setPlayerError('Invalid YouTube video parameters.')
              } else if (code === 100) {
                setPlayerError('Video not found or removed.')
              } else {
                setPlayerError('Playback error occurred on stream.')
                // Switch to direct iframe fallback if API fails
                setIsFallbackIframe(true)
              }
            }
          }
        }

        if (initialVid) {
          playerOptions.videoId = initialVid
          activeVideoIdRef.current = initialVid
        }

        playerRef.current = new window.YT.Player(playerId, playerOptions)
      } catch (err) {
        console.warn('[YouTubePlayerBridge] Initialization error:', err)
        setIsFallbackIframe(true)
      }
    })

    return () => {
      unmounted = true
    }
  }, [playNext, isListener, portalTarget, currentVideoId, isCurrentYouTube])

  // 2. React to Track Changes
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return

    if (isDeviceStreamActive) {
      try {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
        playerRef.current.mute?.()
      } catch {}
      setIsFallbackIframe(false)
      activeVideoIdRef.current = null
      return
    }

    if (isCurrentYouTube && currentVideoId) {
      if (activeVideoIdRef.current !== currentVideoId) {
        try {
          playerRef.current.pauseVideo?.()
        } catch {}
        activeVideoIdRef.current = currentVideoId
        setIsFallbackIframe(false)
        setPlayerError(null)

        try {
          let startTime = usePlayerStore.getState().currentTime || 0
          if (startTime <= 0 && joinedRoom) {
            const hostPos =
              typeof joinedRoom.song?.hostPosition === 'number'
                ? joinedRoom.song.hostPosition
                : joinedRoom.position_seconds || 0
            const hostTimestamp =
              typeof joinedRoom.song?.hostTimestamp === 'number'
                ? joinedRoom.song.hostTimestamp
                : new Date(joinedRoom.updated_at).getTime()
            const target = roomClockSync.calculateTargetTime(
              hostPos,
              hostTimestamp,
              joinedRoom.is_playing,
              (manualSyncOffsetMs || 0) / 1000,
              joinedRoom.song?.duration || 0
            )
            if (target > 0) startTime = target
          }

          isSyncingRef.current = true
          if (isPlaying) {
            try {
              playerRef.current.loadVideoById(currentVideoId, startTime)
            } catch {
              try {
                playerRef.current.loadVideoById({ videoId: currentVideoId, startSeconds: startTime })
              } catch {}
            }
          } else {
            try {
              playerRef.current.cueVideoById(currentVideoId, startTime)
            } catch {
              try {
                playerRef.current.cueVideoById({ videoId: currentVideoId, startSeconds: startTime })
              } catch {}
            }
          }
          setTimeout(() => {
            isSyncingRef.current = false
          }, 1500)

          // Reinforce feature policies on the iframe
          const iframe = containerRef.current?.querySelector('iframe')
          if (iframe) {
            iframe.setAttribute(
              'allow',
              'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
            )
            iframe.setAttribute('allowFullScreen', 'true')
          }
        } catch (err) {
          console.warn('[YouTubePlayerBridge] Error loading video:', err)
        }
      } else if (isPlaying) {
        // Same video ID re-triggered to play (e.g. replay or resume)
        try {
          const pState = playerRef.current.getPlayerState?.()
          if (pState !== 1 && pState !== 3) {
            playerRef.current.playVideo?.()
          }
        } catch {}
      }
    } else {
      // Transitioning away from YouTube to a local file or stopping
      try {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
        playerRef.current.mute?.()
      } catch {}
      activeVideoIdRef.current = null
      setIsFallbackIframe(false)
    }
  }, [isPlayerReady, isCurrentYouTube, currentVideoId, isPlaying])

  const handleRetry = useCallback(() => {
    setPlayerError(null)
    setIsFallbackIframe(true)
  }, [])

  // 3. React to Play/Pause Controls
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return

    if (!isCurrentYouTube || !currentVideoId) {
      try {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
        playerRef.current.mute?.()
      } catch {}
      return
    }

    try {
      const state = playerRef.current.getPlayerState?.()
      if (isPlaying) {
        if (state !== 1 && state !== 3) {
          playerRef.current.playVideo?.()
        }
      } else {
        // Industry-standard pause: ensure paused regardless of buffering (3), cued (5), or playing (1)
        if (state !== 2) {
          playerRef.current.pauseVideo?.()
        }
        // Align listener's video frame cleanly to store currentTime on pause if drifted
        const curTime = usePlayerStore.getState().currentTime || 0
        if (isListener && curTime > 0) {
          const playerTime = playerRef.current.getCurrentTime?.() || 0
          if (Math.abs(playerTime - curTime) > 0.05) {
            playerRef.current.seekTo?.(curTime, true)
            playerRef.current.pauseVideo?.()
          }
        }
      }
    } catch (err) {
      console.warn('[YouTubePlayerBridge] Play/pause dispatch error:', err)
    }
  }, [isPlaying, isPlayerReady, isCurrentYouTube, currentVideoId, isListener])

  // 4. React to Volume Changes
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return
    try {
      if (isMuted || volume === 0) {
        playerRef.current.mute?.()
      } else {
        playerRef.current.unMute?.()
        playerRef.current.setVolume?.(Math.round(volume * 100))
      }
    } catch {}
  }, [volume, isMuted, isPlayerReady])

  // 5. React to Seek Requests
  useEffect(() => {
    if (seekRequest !== null && isPlayerReady && playerRef.current && isCurrentYouTube) {
      try {
        isSyncingRef.current = true
        playerRef.current.seekTo?.(seekRequest, true)
        setCurrentTime(seekRequest)
        if (!isPlaying) {
          playerRef.current.pauseVideo?.()
        }
        setTimeout(() => {
          isSyncingRef.current = false
        }, 1200)
      } catch (err) {
        console.warn('[YouTubePlayerBridge] Seek error:', err)
      }
      clearSeekRequest()
    }
  }, [seekRequest, isPlayerReady, isCurrentYouTube, clearSeekRequest, setCurrentTime, isPlaying])

  // 6. Polling ticker for elapsed position & duration updates
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !isCurrentYouTube || !isPlaying) return

    const timer = setInterval(() => {
      try {
        if (isSyncingRef.current) return
        const pState = playerRef.current.getPlayerState?.()
        // Skip reading position if player is buffering (3) or unstarted (-1)
        if (pState === 3 || pState === -1) return

        const time = playerRef.current.getCurrentTime?.()
        const dur = playerRef.current.getDuration?.()
        if (typeof time === 'number' && Number.isFinite(time)) {
          const curStoreTime = usePlayerStore.getState().currentTime || 0
          // Reject transient near-zero (< 1.0s) dips while song or room was already progressing (> 2.0s)
          if (time < 1.0 && (curStoreTime > 2.0 || (joinedRoom && (joinedRoom.position_seconds || 0) > 2.0))) {
            return
          }
          setCurrentTime(time)
        }
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
          setDuration(dur)
        }
      } catch {}
    }, 250)

    return () => clearInterval(timer)
  }, [isPlayerReady, isCurrentYouTube, isPlaying, setCurrentTime, setDuration, joinedRoom])

  // Register high-resolution audio time provider for room sync & presence bridges
  useEffect(() => {
    if (isCurrentYouTube && isPlayerReady) {
      registerAudioTimeProvider(() => {
        try {
          if (playerRef.current?.getCurrentTime) {
            const t = playerRef.current.getCurrentTime()
            if (typeof t === 'number' && Number.isFinite(t)) return t
          }
        } catch {}
        return null
      })
    } else {
      registerAudioTimeProvider(null)
    }

    return () => {
      registerAudioTimeProvider(null)
    }
  }, [isCurrentYouTube, isPlayerReady])

  // 7. Mindory Continuous Drift Sync Engine (Heartbeat for Listen Together)
  useEffect(() => {
    if (!isListener || !joinedRoom || !isPlayerReady || !playerRef.current || !isCurrentYouTube || !isPlaying) {
      setIsDesynced(false)
      setDesyncSeconds(0)
      return
    }

    const intervalId = window.setInterval(() => {
      if (isSyncingRef.current || isBufferingRef.current) return

      const hostPos =
        typeof joinedRoom.song?.hostPosition === 'number'
          ? joinedRoom.song.hostPosition
          : joinedRoom.position_seconds || 0
      const hostTimestamp =
        typeof joinedRoom.song?.hostTimestamp === 'number'
          ? joinedRoom.song.hostTimestamp
          : new Date(joinedRoom.updated_at).getTime()
      const manualOffsetSec = (manualSyncOffsetMs || 0) / 1000
      const duration = joinedRoom.song?.duration || 0

      const targetTime = roomClockSync.calculateTargetTime(
        hostPos,
        hostTimestamp,
        joinedRoom.is_playing,
        manualOffsetSec,
        duration
      )

      const currentTime = playerRef.current.getCurrentTime ? playerRef.current.getCurrentTime() : 0
      const diff = Math.abs(currentTime - targetTime)

      setDesyncSeconds(diff)
      setIsDesynced(diff > 1.8)
    }, 2000)

    return () => window.clearInterval(intervalId)
  }, [isListener, joinedRoom, isPlayerReady, isCurrentYouTube, isPlaying, manualSyncOffsetMs])

  const handleCatchUp = () => {
    if (!playerRef.current || !joinedRoom) return
    const hostPos =
      typeof joinedRoom.song?.hostPosition === 'number'
        ? joinedRoom.song.hostPosition
        : joinedRoom.position_seconds || 0
    const hostTimestamp =
      typeof joinedRoom.song?.hostTimestamp === 'number'
        ? joinedRoom.song.hostTimestamp
        : new Date(joinedRoom.updated_at).getTime()
    const targetTime = roomClockSync.calculateTargetTime(
      hostPos,
      hostTimestamp,
      joinedRoom.is_playing,
      (manualSyncOffsetMs || 0) / 1000,
      joinedRoom.song?.duration || 0
    )

    isSyncingRef.current = true
    playerRef.current.seekTo?.(targetTime, true)
    setIsDesynced(false)
    setDesyncSeconds(0)
    setTimeout(() => {
      isSyncingRef.current = false
    }, 800)
  }

  const handleUnmute = () => {
    setIsMuted(false)
    if (playerRef.current) {
      try {
        playerRef.current.unMute?.()
        playerRef.current.setVolume?.(Math.round(localVolume * 100))
        if (joinedRoom && joinedRoom.is_playing) {
          const hostPos =
            typeof joinedRoom.song?.hostPosition === 'number'
              ? joinedRoom.song.hostPosition
              : joinedRoom.position_seconds || 0
          const hostTimestamp =
            typeof joinedRoom.song?.hostTimestamp === 'number'
              ? joinedRoom.song.hostTimestamp
              : new Date(joinedRoom.updated_at).getTime()
          const targetTime = roomClockSync.calculateTargetTime(
            hostPos,
            hostTimestamp,
            true,
            (manualSyncOffsetMs || 0) / 1000,
            joinedRoom.song?.duration || 0
          )
          if (targetTime > 0) {
            isSyncingRef.current = true
            playerRef.current.seekTo?.(targetTime, true)
            setCurrentTime(targetTime)
            setTimeout(() => {
              isSyncingRef.current = false
            }, 1200)
          }
        }
        playerRef.current.playVideo?.()
      } catch {}
    }
    useListeningStore.getState().setIsAutoplayBlocked(false)
  }

  const isVisible = isCurrentYouTube && Boolean(currentVideoId) && !isDeviceStreamActive

  // Floating vs Docked positioning styling
  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (!isVisible) {
      return {
        display: 'none',
        pointerEvents: 'none',
        opacity: 0
      }
    }

    if (isFullscreen) {
      return {
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 9999,
        borderRadius: 0,
        border: 'none',
        overflow: 'hidden',
        backgroundColor: '#000000',
        display: 'flex',
        flexDirection: 'column'
      }
    }

    if (isDockedInStage) {
      return {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 10,
        borderRadius: '1rem',
        overflow: 'hidden'
      }
    }

    return {
      position: 'fixed',
      bottom: '6rem',
      right: '1.5rem',
      width: isExpanded ? '560px' : '340px',
      height: isExpanded ? '315px' : '191px',
      zIndex: 45,
      borderRadius: '1.25rem',
      overflow: 'hidden'
    }
  }, [isVisible, isFullscreen, isDockedInStage, isExpanded])

  if (!portalTarget) return null

  return createPortal(
    <div
      aria-hidden={!isVisible}
      style={containerStyle}
      onDoubleClick={() => {
        if (!isFullscreen && !isDockedInStage) {
          setIsExpanded((prev) => !prev)
        }
      }}
      className={cn(
        'shadow-2xl bg-black select-none group/video',
        isVisible ? 'opacity-100 pointer-events-auto' : 'pointer-events-none opacity-0',
        isFullscreen
          ? 'border-none rounded-none'
          : isDockedInStage
            ? 'border-none rounded-2xl'
            : 'border border-white/15 backdrop-blur-md transition-all duration-200'
      )}
    >
      {/* 1. Top HUD / Toolbar */}
      <div
        className={cn(
          'transition-all duration-200 select-none z-20 text-white',
          isFullscreen
            ? 'h-12 sm:h-14 px-3 sm:px-6 bg-black/95 border-b border-white/10 backdrop-blur-md opacity-100 shadow-xl flex items-center justify-between shrink-0 pt-[env(safe-area-inset-top,0px)]'
            : 'absolute top-0 left-0 right-0 flex items-center justify-end gap-2 p-2.5 bg-gradient-to-b from-black/80 via-black/40 to-transparent opacity-90 sm:opacity-0 sm:group-hover/video:opacity-100 transition-opacity duration-200 z-20 pointer-events-auto'
        )}
      >
        {/* Left Info: visible only in Fullscreen mode (or if listener needs to catch up) */}
        <div className="flex items-center gap-2.5 min-w-0">
          {currentSong && isFullscreen && (
            <div className="flex items-center gap-2 min-w-0 truncate">
              <span className="text-xs sm:text-sm font-bold text-white truncate max-w-[200px] sm:max-w-[480px]">
                {currentSong.title}
              </span>
              <span className="text-xs text-white/60 truncate hidden sm:inline">
                • {currentSong.artist}
              </span>
            </div>
          )}

          {isFullscreen && (
            <span className="hidden lg:inline-block text-xs text-white/40 font-medium ml-2">
              Press <kbd className="px-1.5 py-0.5 text-[10px] bg-white/10 border border-white/20 rounded-md font-mono text-white/70">Esc</kbd> to exit full screen
            </span>
          )}

          {isListener && isDesynced && (
            <button
              type="button"
              onClick={handleCatchUp}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/90 hover:bg-amber-400 text-black text-[10px] font-black transition-all cursor-pointer shadow-xs animate-bounce"
              title={`Lag detected: ${desyncSeconds.toFixed(1)}s. Click to catch up to host.`}
            >
              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
              <span>Catch Up</span>
            </button>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Mute / Unmute & Volume — Exclusively in Fullscreen mode */}
          {isFullscreen && (
            <div className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-full px-2 sm:px-2.5 py-1 shadow-xs">
              <button
                type="button"
                onClick={() => {
                  if (isMuted) {
                    handleUnmute()
                  } else {
                    setIsMuted(true)
                  }
                }}
                className="p-1 text-white/80 hover:text-white transition-colors cursor-pointer"
                title={isMuted ? 'Unmute sound' : 'Mute sound'}
              >
                {isMuted ? (
                  <VolumeX className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : localVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  setLocalVolume(val)
                  setIsMuted(val === 0)
                  usePlayerStore.getState().setVolume(val)
                }}
                className="hidden sm:inline-block w-14 sm:w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>
          )}

          {/* Host Skip Button — Exclusively in Fullscreen mode */}
          {isFullscreen && isHost && (
            <button
              type="button"
              onClick={() => playNext(true)}
              className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs"
              title="Skip to next track"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Docked Mode Controls (Inside Stage) */}
          {!isFullscreen && isDockedInStage && (
            <>
              <button
                type="button"
                onClick={() => setIsUserFloating(true)}
                className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Pop out into miniplayer"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={enterFullscreen}
                className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Open Full Screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          {/* Floating Miniplayer Controls */}
          {!isFullscreen && !isDockedInStage && (
            <>
              {dockEl && (
                <button
                  type="button"
                  onClick={() => setIsUserFloating(false)}
                  className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs active:scale-95"
                  title="Dock into stage"
                >
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={enterFullscreen}
                className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs active:scale-95"
                title="Open Full Screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          {/* Fullscreen Mode Exit Button */}
          {isFullscreen && (
            <button
              type="button"
              onClick={exitFullscreen}
              className="flex items-center gap-1.5 h-8 px-2.5 sm:px-3 bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
              title="Exit full screen (Esc)"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exit Fullscreen</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Video Player Stage Container */}
      <div
        className={cn(
          'relative w-full',
          isFullscreen
            ? 'flex-1 min-h-0 flex items-center justify-center p-0 bg-black overflow-hidden'
            : 'h-full'
        )}
      >
        <div
          className={cn(
            'relative flex items-center justify-center w-full h-full',
            isFullscreen
              ? 'rounded-none overflow-hidden shadow-2xl bg-black'
              : 'rounded-none'
          )}
        >
          {/* Underlying YouTube Iframe Target or Direct Embed Fallback */}
          {isFallbackIframe && currentVideoId ? (
            <iframe
              key={currentVideoId}
              src={`https://www.youtube.com/embed/${currentVideoId}?autoplay=1&playsinline=1&modestbranding=1&rel=0&enablejsapi=1`}
              title="YouTube Video Stream"
              className="w-full h-full border-0 absolute inset-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : (
            <div
              ref={containerRef}
              style={{ pointerEvents: joinedRoom ? 'none' : 'auto' }}
              className="relative w-full h-full [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:border-0"
            />
          )}

          {/* Tap to Unmute Overlay */}
          {isMuted && isVisible && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px] transition-all">
              <button
                type="button"
                onClick={handleUnmute}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white text-black font-black text-xs hover:bg-white/90 transition-all shadow-2xl active:scale-95 cursor-pointer border border-white/30 animate-pulse"
              >
                <Volume2 className="h-4 w-4 text-black fill-black" />
                <span>Tap to Unmute Audio</span>
              </button>
            </div>
          )}

          {/* Playback Error Toast */}
          {playerError && (
            <div className="absolute bottom-3 left-3 right-3 z-30 p-2.5 rounded-xl bg-red-950/90 border border-red-500/40 text-red-200 text-xs flex items-center justify-between gap-2 shadow-lg backdrop-blur-md">
              <span className="truncate">{playerError}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="text-[10px] font-bold text-black bg-white hover:bg-white/90 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                >
                  Direct Embed
                </button>
                <button
                  type="button"
                  onClick={() => setPlayerError(null)}
                  className="text-[10px] font-bold text-white bg-red-800/80 hover:bg-red-700 px-2 py-0.5 rounded-md cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    portalTarget
  )
}
