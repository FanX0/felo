import { useEffect, useRef, useState, useCallback, useMemo, type ReactElement } from 'react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import {
  Minimize2,
  Maximize2,
  Volume2,
  VolumeX,
  SkipForward,
  RefreshCw,
  Radio
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { roomClockSync } from '../../lib/roomClockSync'
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
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isUserFloating, setIsUserFloating] = useState(false)
  const [isFallbackIframe, setIsFallbackIframe] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)

  // Allow stage placeholder to request re-docking
  useEffect(() => {
    const handleDock = () => setIsUserFloating(false)
    window.addEventListener('felo:dock-youtube-stage', handleDock)
    return () => window.removeEventListener('felo:dock-youtube-stage', handleDock)
  }, [])

  // Allow native AudioEngine to enforce immediate YouTube silence on non-YouTube playback
  useEffect(() => {
    const handleStopYouTube = () => {
      try {
        playerRef.current?.pauseVideo?.()
        playerRef.current?.stopVideo?.()
        playerRef.current?.mute?.()
      } catch {}
      setIsFallbackIframe(false)
      activeVideoIdRef.current = null
      setActiveVideoId(null)
    }
    window.addEventListener('felo:stop-youtube', handleStopYouTube)
    return () => window.removeEventListener('felo:stop-youtube', handleStopYouTube)
  }, [])

  // Listen Together context
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const hostRoom = useListeningStore((s) => s.hostRoom)
  const myRole = useListeningStore((s) => s.myRole)
  const manualSyncOffsetMs = useListeningStore((s) => s.manualSyncOffsetMs)
  const activeRoom = joinedRoom || hostRoom
  const isListener = Boolean(joinedRoom && myRole === 'listener')
  const isHost = Boolean(hostRoom && !joinedRoom)

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

  // Track In-Page Stage Dock element (#youtube-stage-dock) on ListenTogetherPage
  const [stageRect, setStageRect] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)

  const updateStageRect = useCallback(() => {
    const el = document.getElementById('youtube-stage-dock')
    if (el) {
      const rect = el.getBoundingClientRect()
      // Dock whenever the stage slot exists and is in the active viewport
      if (rect.width > 50 && rect.height > 50 && rect.bottom > 0 && rect.top < window.innerHeight) {
        setStageRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        })
        return
      }
    }
    setStageRect(null)
  }, [])

  useEffect(() => {
    updateStageRect()
    const handleScrollOrResize = () => updateStageRect()

    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true })
    window.addEventListener('resize', handleScrollOrResize, { passive: true })

    const observer = new MutationObserver(() => updateStageRect())
    observer.observe(document.body, { childList: true, subtree: true })

    const pollTimer = window.setInterval(updateStageRect, 800)

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true })
      window.removeEventListener('resize', handleScrollOrResize)
      observer.disconnect()
      window.clearInterval(pollTimer)
    }
  }, [updateStageRect])

  const isDockedInStage = Boolean(stageRect && !isUserFloating)

  // 1. Initialize YouTube Player Iframe API
  useEffect(() => {
    let unmounted = false
    void loadYouTubeIframeApi().then(() => {
      if (unmounted || !containerRef.current || playerRef.current) return

      try {
        const playerId = 'felo-youtube-iframe-player'
        let playerContainer = document.getElementById(playerId)
        if (!playerContainer) {
          playerContainer = document.createElement('div')
          playerContainer.id = playerId
          containerRef.current.appendChild(playerContainer)
        }

        const state = usePlayerStore.getState()
        const initialSong = state.queue[state.currentSongIndex]
        const initialVid = isYouTubeSong(initialSong)
          ? (initialSong as any)?.videoId ||
            extractYouTubeVideoId(initialSong?.id?.replace(/^yt-/, '')) ||
            extractYouTubeVideoId(initialSong?.audioUrl) ||
            extractYouTubeVideoId(initialSong?.filePath)
          : null

        const playerVars: Record<string, string | number> = {
          autoplay: 1,
          controls: isListener ? 0 : 1,
          disablekb: isListener ? 1 : 0,
          fs: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          iv_load_policy: 3
        }

        const playerOptions: any = {
          height: '100%',
          width: '100%',
          host: 'https://www.youtube-nocookie.com',
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
              } else {
                try {
                  event.target.stopVideo()
                  event.target.mute()
                } catch {}
              }
            },
            onStateChange: (event: any) => {
              if (unmounted) return
              // YT.PlayerState: -1=unstarted, 0=ended, 1=playing, 2=paused, 3=buffering, 5=cued
              if (event.data === 1) {
                // Playing
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
          setActiveVideoId(initialVid)
        }

        playerRef.current = new window.YT.Player(playerId, playerOptions)
      } catch (err) {
        console.warn('[YouTubePlayerBridge] Initialization error:', err)
      }
    })

    return () => {
      unmounted = true
    }
  }, [playNext, isListener])

  // 2. React to Track Changes
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return

    if (isCurrentYouTube && currentVideoId) {
      if (activeVideoIdRef.current !== currentVideoId) {
        try {
          playerRef.current.stopVideo?.()
        } catch {}
        activeVideoIdRef.current = currentVideoId
        setActiveVideoId(currentVideoId)
        setIsFallbackIframe(false)
        setPlayerError(null)

        try {
          const startTime = usePlayerStore.getState().currentTime || 0
          if (isPlaying) {
            try {
              playerRef.current.loadVideoById({ videoId: currentVideoId, startSeconds: startTime })
            } catch {
              playerRef.current.loadVideoById(currentVideoId, startTime)
            }
          } else {
            try {
              playerRef.current.cueVideoById({ videoId: currentVideoId, startSeconds: startTime })
            } catch {
              playerRef.current.cueVideoById(currentVideoId, startTime)
            }
          }

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
      }
    } else {
      // Transitioning away from YouTube to a local file or stopping
      try {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
        playerRef.current.mute?.()
      } catch {}
      activeVideoIdRef.current = null
      setActiveVideoId(null)
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

    if (!isCurrentYouTube || !activeVideoId) {
      try {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
        playerRef.current.mute?.()
      } catch {}
      return
    }

    try {
      const state = playerRef.current.getPlayerState?.()
      if (isPlaying && state !== 1 && state !== 3) {
        playerRef.current.playVideo?.()
      } else if (!isPlaying && state === 1) {
        playerRef.current.pauseVideo?.()
        playerRef.current.stopVideo?.()
      }
    } catch (err) {
      console.warn('[YouTubePlayerBridge] Play/pause dispatch error:', err)
    }
  }, [isPlaying, isPlayerReady, isCurrentYouTube, activeVideoId])

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
        setTimeout(() => {
          isSyncingRef.current = false
        }, 800)
      } catch (err) {
        console.warn('[YouTubePlayerBridge] Seek error:', err)
      }
      clearSeekRequest()
    }
  }, [seekRequest, isPlayerReady, isCurrentYouTube, clearSeekRequest, setCurrentTime])

  // 6. Polling ticker for elapsed position & duration updates
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !isCurrentYouTube || !isPlaying) return

    const timer = setInterval(() => {
      try {
        const time = playerRef.current.getCurrentTime?.()
        const dur = playerRef.current.getDuration?.()
        if (typeof time === 'number' && Number.isFinite(time)) {
          setCurrentTime(time)
        }
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
          setDuration(dur)
        }
      } catch {}
    }, 250)

    return () => clearInterval(timer)
  }, [isPlayerReady, isCurrentYouTube, isPlaying, setCurrentTime, setDuration])

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
        playerRef.current.playVideo?.()
      } catch {}
    }
    useListeningStore.getState().setIsAutoplayBlocked(false)
  }

  const isVisible = isCurrentYouTube && Boolean(currentVideoId)

  // Floating vs Docked positioning styling
  const containerStyle = useMemo<React.CSSProperties>(() => {
    if (!isVisible) {
      return {
        display: 'none',
        pointerEvents: 'none',
        opacity: 0
      }
    }

    if (isDockedInStage && stageRect) {
      return {
        position: 'fixed',
        top: `${stageRect.top}px`,
        left: `${stageRect.left}px`,
        width: `${stageRect.width}px`,
        height: `${stageRect.height}px`,
        zIndex: 35,
        borderRadius: '1.25rem',
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
  }, [isVisible, isDockedInStage, stageRect, isExpanded])

  return (
    <div
      aria-hidden={!isVisible}
      style={containerStyle}
      className={cn(
        'transition-all duration-300 ease-out shadow-2xl border border-white/15 bg-black backdrop-blur-md select-none group/video',
        isVisible ? 'opacity-100 pointer-events-auto' : 'pointer-events-none opacity-0'
      )}
    >
      {/* 1. Underlying YouTube Iframe Target or Direct Embed Fallback */}
      {isFallbackIframe && currentVideoId ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${currentVideoId}?autoplay=1&playsinline=1&modestbranding=1&rel=0`}
          title="YouTube Video Stream"
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div
          ref={containerRef}
          style={{ pointerEvents: isListener ? 'none' : 'auto' }}
          className="relative w-full h-full [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:border-0"
        />
      )}

      {/* 2. Top Live Broadcast HUD (Inspired by Mindory LiveVideoBlock) */}
      <div className="absolute top-0 left-0 right-0 p-2.5 flex items-center justify-between gap-2 z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-200">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600/80 backdrop-blur-xs text-white text-[10px] font-black tracking-wider uppercase shadow-xs">
            <Radio className="h-2.5 w-2.5 animate-pulse" />
            <span>Live Sync</span>
          </div>

          {activeRoom && (
            <span className="hidden sm:inline-block text-[10px] font-semibold text-white/80 bg-black/50 px-2 py-0.5 rounded-full border border-white/10 truncate max-w-[140px]">
              {isHost ? 'Hosting' : `DJ: ${activeRoom.name || 'Host'}`}
            </span>
          )}

          {isListener && isDesynced && (
            <button
              type="button"
              onClick={handleCatchUp}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/90 hover:bg-amber-400 text-black text-[10px] font-black transition-all cursor-pointer shadow-xs animate-bounce"
              title={`Lag detected: ${desyncSeconds.toFixed(1)}s. Click to catch up to host.`}
            >
              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
              <span>Catch Up</span>
            </button>
          )}
        </div>

        {/* Right HUD Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mute / Unmute & Volume */}
          <div className="flex items-center gap-1 bg-black/60 backdrop-blur-xs border border-white/10 rounded-full px-2 py-0.5 shadow-xs">
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
              className="w-12 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            />
          </div>

          {/* Host Skip Button */}
          {isHost && (
            <button
              type="button"
              onClick={() => playNext(true)}
              className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs"
              title="Skip to next track"
            >
              <SkipForward className="h-3 w-3" />
            </button>
          )}

          {/* Miniplayer / Dock Toggle */}
          {stageRect && (
            <button
              type="button"
              onClick={() => setIsUserFloating(!isUserFloating)}
              className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs"
              title={isUserFloating ? 'Dock into stage' : 'Pop out into miniplayer'}
            >
              {isUserFloating ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
            </button>
          )}

          {/* Expand Toggle (when in floating miniplayer) */}
          {!isDockedInStage && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer shadow-xs"
              title={isExpanded ? 'Smaller miniplayer' : 'Expand miniplayer'}
            >
              {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>

      {/* 3. Tap to Unmute Overlay Banner (for Autoplay-restricted guests) */}
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

      {/* 4. Playback Error Diagnostic Toast */}
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
  )
}
