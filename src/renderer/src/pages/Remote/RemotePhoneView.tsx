import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { remoteClient, type RemotePlayerState } from './remoteClient'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'
import MobileNowPlaying from './MobileNowPlaying'
import MobileQueueSheet from './MobileQueueSheet'
import MobileSearchSheet from './MobileSearchSheet'
import MobileDeviceSheet from './MobileDeviceSheet'
import MobileLyricsSheet from './MobileLyricsSheet'
import MobileSleepTimerModal from './MobileSleepTimerModal'
import AudioFxModal from '../../components/Audio/AudioFxModal'
import ManualSyncModal from '../../components/Online/ManualSyncModal'

export default function RemotePhoneView() {
  const navigate = useNavigate()
  const [state, setState] = useState<RemotePlayerState>(remoteClient.getState())
  const [isConnected, setIsConnected] = useState(remoteClient.getIsConnected())
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isDevicesOpen, setIsDevicesOpen] = useState(false)
  const [isLyricsOpen, setIsLyricsOpen] = useState(false)
  const [isSleepTimerOpen, setIsSleepTimerOpen] = useState(false)
  const activePlayback = useConnectedDeviceStore((s) => s.activePlayback)

  // Sleep Timer state
  const [sleepTimer, setSleepTimer] = useState<{
    endTimestamp: number
    endOfTrack?: boolean
    songIdAtStart?: string
  } | null>(null)
  const [sleepTimerBadge, setSleepTimerBadge] = useState<string | null>(null)

  useEffect(() => {
    // Ensure viewport meta for mobile screens
    let meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'viewport'
      document.head.appendChild(meta)
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'

    // Update document title for mobile PWA
    document.title = 'Felo Remote'

    // Connect to desktop SSE stream
    remoteClient.connect()

    const unsubState = remoteClient.subscribe(setState)
    const unsubConn = remoteClient.subscribeConnection(setIsConnected)

    return () => {
      unsubState()
      unsubConn()
      remoteClient.disconnect()
    }
  }, [])

  // OS Lock Screen / Bluetooth AVRCP Media Session Integration
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !state.song) return

    try {
      const artworkSrc = state.song.artworkUrl ? remoteClient.getFullArtworkUrl(state.song.artworkUrl) : ''
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.song.title || 'Unknown Title',
        artist: state.song.artist || 'Unknown Artist',
        album: state.song.album || '',
        artwork: artworkSrc ? [{ src: artworkSrc, sizes: '512x512', type: 'image/png' }] : []
      })

      navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused'

      navigator.mediaSession.setActionHandler('play', () => {
        void remoteClient.play()
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        void remoteClient.pause()
      })
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        void remoteClient.next()
      })
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        void remoteClient.previous()
      })
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) void remoteClient.seek(details.seekTime)
      })
    } catch {
      // mediaSession error safety
    }
  }, [state.song?.id, state.song?.title, state.song?.artist, state.isPlaying])

  // Sleep Timer Countdown & Trigger Logic
  useEffect(() => {
    if (!sleepTimer) {
      setSleepTimerBadge(null)
      return
    }

    const interval = setInterval(() => {
      if (sleepTimer.endOfTrack) {
        setSleepTimerBadge('Track')
        // Check if track changed from when timer started
        if (sleepTimer.songIdAtStart && state.song?.id && state.song.id !== sleepTimer.songIdAtStart) {
          void remoteClient.pause()
          setSleepTimer(null)
        }
      } else {
        const remainingMs = sleepTimer.endTimestamp - Date.now()
        if (remainingMs <= 0) {
          void remoteClient.pause()
          setSleepTimer(null)
        } else {
          const mins = Math.ceil(remainingMs / 60000)
          setSleepTimerBadge(`${mins}m`)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [sleepTimer, state.song?.id])

  const handleSetSleepTimer = (minutes: number | null, endOfTrack = false) => {
    if (minutes === null) {
      setSleepTimer(null)
      setSleepTimerBadge(null)
      return
    }

    if (endOfTrack) {
      setSleepTimer({
        endTimestamp: 0,
        endOfTrack: true,
        songIdAtStart: state.song?.id
      })
      setSleepTimerBadge('Track')
    } else {
      const endTimestamp = Date.now() + minutes * 60 * 1000
      setSleepTimer({ endTimestamp })
      setSleepTimerBadge(`${minutes}m`)
    }
  }

  const handleExitRemote = () => {
    // If the URL has hash or query parameters locking into remote mode, clear them
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    if (hash.toLowerCase().includes('remote') || search.toLowerCase().includes('mode=remote')) {
      const cleanUrl = window.location.origin + window.location.pathname.replace(/\/remote.*/, '')
      window.location.href = cleanUrl.endsWith('/') ? cleanUrl : cleanUrl + '/'
    } else {
      navigate('/')
    }
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] min-h-[100dvh] max-h-[100dvh] bg-[#0c0c0c] overflow-hidden flex flex-col items-center justify-center font-sans select-none antialiased">
      <div className="w-full max-w-md h-full flex flex-col relative shadow-2xl bg-[#121212] overflow-hidden">
        {/* Main Full-Screen Spotify Player View */}
        <MobileNowPlaying
          state={state}
          isConnected={isConnected}
          onOpenQueue={() => setIsQueueOpen(true)}
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenDevices={() => setIsDevicesOpen(true)}
          onOpenLyrics={() => setIsLyricsOpen(true)}
          onOpenSleepTimer={() => setIsSleepTimerOpen(true)}
          sleepTimerBadge={sleepTimerBadge}
          onExitRemote={handleExitRemote}
        />

        {/* Up Next / Queue Overlay Sheet */}
        <MobileQueueSheet
          state={state}
          isOpen={isQueueOpen}
          onClose={() => setIsQueueOpen(false)}
        />

        {/* Search Library Overlay Sheet */}
        <MobileSearchSheet
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          targetDeviceId={activePlayback?.activeDeviceId}
          targetDeviceName={activePlayback?.activeDeviceName}
        />

        {/* Spotify Connect Devices Overlay Sheet */}
        <MobileDeviceSheet
          state={state}
          isConnected={isConnected}
          isOpen={isDevicesOpen}
          onClose={() => setIsDevicesOpen(false)}
        />

        {/* Real-time Synced Karaoke Lyrics Sheet */}
        <MobileLyricsSheet
          song={state.song}
          currentTime={state.position}
          isPlaying={state.isPlaying}
          isOpen={isLyricsOpen}
          onClose={() => setIsLyricsOpen(false)}
          onSeek={(time) => void remoteClient.seek(time)}
        />

        {/* Sleep Timer Modal */}
        <MobileSleepTimerModal
          isOpen={isSleepTimerOpen}
          onClose={() => setIsSleepTimerOpen(false)}
          onTimerSet={handleSetSleepTimer}
          activeTimer={sleepTimer}
        />

        {/* Spatial Audio & Multi-Device DSP Modal (Virtual Effects, EQ, Reverb) */}
        <AudioFxModal />

        {/* Manual Sync (ms) Latency Calibration Modal */}
        <ManualSyncModal />
      </div>
    </div>
  )
}
