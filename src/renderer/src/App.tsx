import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { cn } from './lib/utils'
import Sidebar from './components/Sidebar/Sidebar'
import Footer from './components/Footer/Footer'
import AudioEngine from './components/AudioEngine'
import YouTubePlayerBridge from './components/Audio/YouTubePlayerBridge'
import CrossTabSyncBridge from './components/CrossTabSyncBridge'
import DownloadPanel from './components/DownloadPanel/DownloadPanel'
import type { DownloadTarget } from './components/DownloadPanel/DownloadPanel'
import DownloadEventBridge from './components/DownloadEventBridge'
import LibraryScanEventBridge from './components/LibraryScanEventBridge'
import LibraryScanPill from './components/LibraryScanProgress/LibraryScanPill'
import FriendActivityPanel from './components/FriendActivity/FriendActivityPanel'
import ListeningPresenceBridge from './components/ListeningPresenceBridge'
import PlaybackControlBridge from './components/PlaybackControlBridge'
import PlaybackStreamBridge from './components/PlaybackStreamBridge'
import PlaybackNoticeToast from './components/PlaybackNoticeToast'
import QueueDrawer from './components/Queue/QueueDrawer'
import RemotePhoneView from './pages/Remote/RemotePhoneView'
import OfflineNoticeToast from './components/OfflineNoticeToast'
import ErrorBoundary from './components/ErrorBoundary'
import FileDropOverlay from './components/Common/FileDropOverlay'
import MobileNavBar from './components/MobileNavBar'
import AccountDropdownMenu from './components/AccountMenu/AccountDropdownMenu'
import NotificationDropdown from './components/Notifications/NotificationDropdown'
import InvitationToast from './components/Notifications/InvitationToast'
import MobileDockedPlayer from './components/MobileDockedPlayer'
import MobileNowPlaying from './pages/Remote/MobileNowPlaying'
import MobileDeviceSheet from './pages/Remote/MobileDeviceSheet'
import MobileLyricsSheet from './pages/Remote/MobileLyricsSheet'
import DevicePresenceBridge from './components/DevicePresenceBridge'
import PlaybackTransferModal from './components/PlaybackTransferModal'
import SessionLeaveDialog from './components/SessionLeaveDialog'
import UpdateModalDialog from './components/Common/UpdateModalDialog'
import { triggerChunkLoadRecovery } from './lib/swUpdateCoordinator'
import AudioFxModal from './components/Audio/AudioFxModal'
import ManualSyncModal from './components/Online/ManualSyncModal'
import { initUiSounds } from './lib/uiSounds'
import { remoteClient, type RemotePlayerState } from './pages/Remote/remoteClient'
import { resolveEffectivePlaybackState } from './lib/playbackStateResolver'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from './hooks/useConnectedDeviceStore'
import { getCurrentDeviceId } from './lib/deviceInfo'
import { AppCapabilities, isElectron } from './lib/appConfig'
import { useIsMobile } from './hooks/useIsMobile'
import { usePrivateSessionStore } from './hooks/usePrivateSessionStore'
import { useListeningStore, useIsPlayerLocked } from './hooks/useListeningStore'

import { AppRoutes } from './routes'
import {
  Search as SearchIcon,
  User,
  EyeOff,
  Globe,
  Database,
  HardDrive,
  Radio,
  ChevronLeft,
  ChevronRight,
  Users,
  Bell,
  Minus,
  Square,
  X
} from 'lucide-react'
import { useAppStore } from './hooks/useAppStore'
import { useOnlineStore } from './hooks/useOnlineStore'
import { usePlayerStore } from './hooks/usePlayerStore'
import { useNotificationStore } from './stores/useNotificationStore'


function FeloMark({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 172.13 159.19" className={`${className} fill-current`} aria-hidden="true">
      <path d="M7.17,46.95c2.89-9.32,5.73-18.66,8.71-27.95.96-3.01,2.09-5.99,3.46-8.83C23.62,1.26,31.39-2.37,40.93,1.6c15.93,6.62,32.09,13.1,47.04,21.6,32.45,18.42,59.11,43.66,81.14,73.77.88,1.2,1.66,2.46,3.02,4.49-8.67,7.04-17.04,14.33-25.94,20.9-5.45,4.02-12.25,2.16-16.59-3.79-9.77-13.38-20.77-25.6-33.36-36.38-20.64-17.66-44.07-30.37-69.74-38.98-6.78-2.27-13.12-1.1-19.32,3.74Z" />
      <path d="M.07,120.4c0-5.93-.19-10.51.04-15.07.42-8.31.94-16.61,1.67-24.9.87-9.75,7.22-14.4,16.54-11.8,40.68,11.38,71.62,35.56,93.38,71.66.58.96.91,2.07,1.78,4.08-11.33,4.85-22.27,10.03-33.59,14.19-5.61,2.06-10.14-1.32-13.46-6.15-11.54-16.77-26.78-28.88-45.68-36.54-7.47-3.02-14.12-3.34-20.67,4.51Z" />
      <path d="M54.38,77.26c-10.22-4.11-20.93-8.55-31.74-12.72-5.34-2.06-10.87-3.22-16.17.6-2.27-10.44,6.86-20.05,17-17.66,7.37,1.74,14.4,4.97,21.52,7.7.88.34,1.64,1.57,2.02,2.56,2.62,6.76,5.13,13.55,7.37,19.51Z" />
    </svg>
  )
}

function App() {
  const { searchQuery, searchMode, setSearchQuery, setSearchMode } = useAppStore()
  const [isSearchModeOpen, setIsSearchModeOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const isPrivateSession = usePrivateSessionStore((s) => s.isPrivateSession)
  const togglePrivateSession = usePrivateSessionStore((s) => s.togglePrivateSession)
  const getRemainingTimeMs = usePrivateSessionStore((s) => s.getRemainingTimeMs)
  const checkExpiration = usePrivateSessionStore((s) => s.checkExpiration)

  const [remainingTimeStr, setRemainingTimeStr] = useState<string | null>(null)
  useEffect(() => {
    initUiSounds()

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason?.message || String(event?.reason || '')
      if (
        /Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError/i.test(
          reason
        )
      ) {
        triggerChunkLoadRecovery(event.reason)
      }
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    checkExpiration()
    const timer = setInterval(() => {
      checkExpiration()
    }, 60_000)
    return () => clearInterval(timer)
  }, [checkExpiration])

  useEffect(() => {
    if (!isPrivateSession) {
      setRemainingTimeStr(null)
      return
    }
    const updateTime = () => {
      const ms = getRemainingTimeMs()
      if (ms === null) {
        setRemainingTimeStr(null)
        return
      }
      const totalMinutes = Math.floor(ms / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      setRemainingTimeStr(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`)
    }
    updateTime()
    const interval = setInterval(updateTime, 30_000)
    return () => clearInterval(interval)
  }, [isPrivateSession, getRemainingTimeMs])
  const [isDownloadPanelOpen, setIsDownloadPanelOpen] = useState(false)
  const [isFriendActivityOpen, setIsFriendActivityOpen] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => localStorage.getItem('felo_sidebar_open') !== 'false'
  )
  const { user, profile, initialize } = useOnlineStore()


  // Mobile & Remote Player State
  const [isMobileNowPlayingOpen, setIsMobileNowPlayingOpen] = useState(false)
  const [isMobileDeviceSheetOpen, setIsMobileDeviceSheetOpen] = useState(false)
  const [isMobileLyricsSheetOpen, setIsMobileLyricsSheetOpen] = useState(false)
  const [remoteState, setRemoteState] = useState<RemotePlayerState>(() => remoteClient.getState())
  const [isRemoteConnected, setIsRemoteConnected] = useState(() => remoteClient.getIsConnected())

  const localQueue = usePlayerStore((s) => s.queue)
  const localIndex = usePlayerStore((s) => s.currentSongIndex)
  const localIsPlaying = usePlayerStore((s) => s.isPlaying)
  const localCurrentTime = usePlayerStore((s) => s.currentTime)
  const localDuration = usePlayerStore((s) => s.duration)
  const localVolume = usePlayerStore((s) => s.volume)
  const localShuffle = usePlayerStore((s) => s.isShuffle)
  const localRepeat = usePlayerStore((s) => s.repeatMode)

  useEffect(() => {
    const unsubState = remoteClient.subscribe(setRemoteState)
    const unsubConn = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => {
      unsubState()
      unsubConn()
    }
  }, [])

  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const isPlayerLocked = useIsPlayerLocked()
  const myDeviceId = getCurrentDeviceId()
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)

  const unified = resolveEffectivePlaybackState({
    localPlayer: {
      queue: localQueue,
      currentSongIndex: localIndex,
      isPlaying: localIsPlaying,
      currentTime: localCurrentTime,
      duration: localDuration,
      volume: localVolume,
      isAudioActive,
      isShuffle: localShuffle,
      repeatMode: localRepeat
    },
    activeRemote,
    lanState: remoteState,
    isLanConnected: isRemoteConnected,
    joinedRoom,
    myDeviceId
  })

  const isCloudRemoteActive = unified.source === 'cloud'

  const activePlayerState: RemotePlayerState = {
    ready: true,
    playbackState: unified.isPlaying ? 'playing' : 'paused',
    isPlaying: unified.isPlaying,
    position: unified.position,
    duration: unified.duration,
    volume: unified.volume,
    volumePercent: unified.volumePercent,
    shuffle: unified.shuffle,
    repeat: unified.repeat,
    targetDevice: unified.targetDevice,
    deviceName: unified.activeDeviceName,
    song: unified.song
      ? {
          id: unified.song.id,
          title: unified.song.title || 'Unknown Title',
          artist: unified.song.artist || 'Unknown Artist',
          album: unified.song.album || 'Library',
          duration: unified.duration || unified.song.duration || 0,
          artworkUrl: unified.artworkUrl || '',
          lyrics: (unified.song as any).lyrics || unified.lyrics
        }
      : null
  }

  const topSearchInputRef = useRef<HTMLInputElement>(null)
  const searchModeRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const notificationRef = useRef<HTMLDivElement>(null)
  const mainContentRef = useRef<HTMLElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const subscribeNotifications = useNotificationStore((s) => s.subscribe)
  const unreadNotificationCount = useNotificationStore(
    (s) => s.invitations.length + s.incomingFriendRequests.length
  )

  useEffect(() => {
    if (!user?.id) return
    const unsub = subscribeNotifications(user.id)
    return () => unsub()
  }, [user?.id, subscribeNotifications])

  // Reset scroll position on route change
  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: 'instant' })
    setIsProfileOpen(false)
    setIsNotificationOpen(false)
  }, [location.pathname])

  const toggleSidebar = (): void => {
    setIsSidebarOpen((isOpen) => {
      const nextIsOpen = !isOpen
      localStorage.setItem('felo_sidebar_open', String(nextIsOpen))
      return nextIsOpen
    })
  }

  useEffect(() => initialize(), [initialize])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false)
      }
      if (searchModeRef.current && !searchModeRef.current.contains(e.target as Node)) {
        setIsSearchModeOpen(false)
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setIsNotificationOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])


  // Global Keyboard Shortcuts (Shuffle, Repeat, Play/Pause, Seek, Volume, Search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      // Search shortcut: Ctrl + K (global)
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        navigate('/search')
        window.setTimeout(() => {
          topSearchInputRef.current?.focus()
          topSearchInputRef.current?.select()
        }, 30)
        return
      }

      // Ignore remaining media shortcuts when user is typing in a text field
      if (isInput) return

      // Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault()
        usePlayerStore.getState().togglePlay()
        return
      }

      // M: Toggle Mute
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        usePlayerStore.getState().toggleMute()
        return
      }

      // J / L: Seek -10s / +10s (standard media shortcut)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        usePlayerStore.getState().skipTime(-10)
        return
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault()
        usePlayerStore.getState().skipTime(10)
        return
      }

      // Plain ArrowLeft / ArrowRight: Seek -5s / +5s
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        usePlayerStore.getState().skipTime(-5)
        return
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        usePlayerStore.getState().skipTime(5)
        return
      }

      // Plain ArrowUp / ArrowDown: Volume +/- 5%
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        const currentVol = usePlayerStore.getState().volume
        usePlayerStore.getState().setVolume(Math.min(1, currentVol + 0.05))
        return
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        const currentVol = usePlayerStore.getState().volume
        usePlayerStore.getState().setVolume(Math.max(0, currentVol - 0.05))
        return
      }

      // Ctrl + S: Toggle Shuffle (prevents browser webpage save)
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        usePlayerStore.getState().toggleShuffle()
        return
      }

      // Ctrl + R: Toggle Repeat (prevents window reload, preserves Ctrl+Shift+R for hard reload)
      if (!e.shiftKey && (e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        usePlayerStore.getState().toggleRepeat()
        return
      }

      // Ctrl + Right: Next Track
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight') {
        e.preventDefault()
        usePlayerStore.getState().playNext(true)
        return
      }

      // Ctrl + Left: Previous Track
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft') {
        e.preventDefault()
        usePlayerStore.getState().playPrevious()
        return
      }

      // Ctrl + Up: Volume Up
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault()
        const currentVol = usePlayerStore.getState().volume
        usePlayerStore.getState().setVolume(Math.min(1, currentVol + 0.05))
        return
      }

      // Ctrl + Down: Volume Down
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault()
        const currentVol = usePlayerStore.getState().volume
        usePlayerStore.getState().setVolume(Math.max(0, currentVol - 0.05))
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  const handleTopSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = searchQuery.trim()
    if (trimmed) {
      try {
        const key = 'felo_recent_searches'
        const existing = JSON.parse(localStorage.getItem(key) || '[]')
        const filtered = Array.isArray(existing)
          ? existing.filter((item: string) => typeof item === 'string' && item.toLowerCase() !== trimmed.toLowerCase())
          : []
        localStorage.setItem(key, JSON.stringify([trimmed, ...filtered].slice(0, 10)))
        window.dispatchEvent(new CustomEvent('felo:recent-searches-updated'))
      } catch (err) {
        console.error('Failed to update recent searches:', err)
      }
      navigate(`/search?q=${encodeURIComponent(trimmed)}`)
    } else {
      navigate('/search')
    }
  }

  const isMobileScreen = useIsMobile()

  const isSubPage =
    location.pathname.startsWith('/album/') ||
    location.pathname.startsWith('/artist/') ||
    location.pathname.startsWith('/playlists/') ||
    location.pathname === '/lyrics' ||
    location.pathname === '/settings' ||
    location.pathname === '/chat' ||
    location.pathname.startsWith('/profile') ||
    location.pathname.startsWith('/online/listen') ||
    location.pathname === '/listen' ||
    location.pathname === '/together'

  const getSubPageTitle = () => {
    if (location.pathname.startsWith('/album/')) return 'Album'
    if (location.pathname.startsWith('/artist/')) return 'Artist'
    if (location.pathname.startsWith('/playlists/')) return 'Playlist'
    if (location.pathname === '/lyrics') return 'Lyrics'
    if (location.pathname === '/settings') return 'Settings'
    if (location.pathname === '/chat') return 'Direct Messages'
    if (location.pathname.startsWith('/profile')) return 'Profile'
    if (
      location.pathname.startsWith('/online/listen') ||
      location.pathname.startsWith('/listen-together') ||
      location.pathname === '/listen' ||
      location.pathname === '/together'
    )
      return 'Listen Together'
    return 'Back'
  }

  const isRemoteMode =
    location.pathname.startsWith('/remote') ||
    ((location.pathname === '/' || location.pathname === '') &&
      (window.location.hash.toLowerCase().includes('remote') ||
        window.location.search.toLowerCase().includes('mode=remote')))

  if (isRemoteMode) {
    return <RemotePhoneView />
  }


  return (
    <div
      className={cn(
        'fixed inset-0 w-full h-full h-[100dvh] flex flex-col bg-canvas text-text font-sans antialiased overflow-hidden'
      )}
    >
      <AudioEngine />
      <YouTubePlayerBridge />
      <CrossTabSyncBridge />
      <OfflineNoticeToast />
      <PlaybackControlBridge />
      <PlaybackStreamBridge />
      {AppCapabilities.downloads && <DownloadEventBridge />}
      <LibraryScanEventBridge />
      <ListeningPresenceBridge enabled={!isPrivateSession} />
      <DevicePresenceBridge />

      {/* Top Application Bar */}
      {isMobileScreen ? (
        <>
          <header className="fixed top-0 left-0 right-0 z-50 bg-canvas/95 backdrop-blur-md border-b border-border-subtle/40 px-3.5 pt-[env(safe-area-inset-top,0px)] h-[calc(3.5rem+env(safe-area-inset-top,0px))] flex items-center justify-between select-none">
          {isSubPage ? (
            <div className="flex items-center gap-1.5 text-text">
              <button
                type="button"
                onClick={() => navigate(-1)}
                title="Go back"
                className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition cursor-pointer -ml-1"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="font-bold text-base tracking-tight truncate max-w-[180px]">
                {getSubPageTitle()}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/')}
              title="Felo Home"
              className="flex items-center gap-2.5 text-text cursor-pointer select-none"
            >
              <FeloMark className="h-6 w-6 text-emerald-400" />
              <span className="font-bold text-base tracking-tight">Felo</span>
            </button>
          )}

          <div className="flex items-center gap-1.5">
            {isPrivateSession && (
              <button
                type="button"
                onClick={togglePrivateSession}
                title="Private session is active (tap to turn off)"
                className="h-9 px-2.5 rounded-full flex items-center gap-1 bg-primary-amber/15 text-primary-amber border border-primary-amber/30 text-xs font-semibold hover:bg-primary-amber/25 transition cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">Private</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (location.pathname === '/search') {
                  const input = document.querySelector<HTMLInputElement>('input[type="search"]')
                  input?.focus()
                } else {
                  navigate('/search')
                }
              }}
              title="Search"
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center transition cursor-pointer',
                location.pathname.startsWith('/search')
                  ? 'bg-hover text-text font-bold'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <SearchIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setIsNotificationOpen((prev) => !prev)}
              title={unreadNotificationCount > 0 ? `Notifications (${unreadNotificationCount} new)` : 'Notifications'}
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition cursor-pointer relative"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 bg-danger text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-canvas shadow-xs">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsProfileOpen((prev) => !prev)}
              title={
                user
                  ? isPrivateSession
                    ? 'Account (Private session active)'
                    : 'Account'
                  : 'Sign in'
              }
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition cursor-pointer relative"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <User className="w-5 h-5" />
              )}
              {isPrivateSession && (
                <span
                  title="Private session active"
                  className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-primary-amber rounded-full border-2 border-canvas shadow"
                />
              )}
            </button>
          </div>
        </header>
        <NotificationDropdown
          isOpen={isNotificationOpen}
          onClose={() => setIsNotificationOpen(false)}
          isMobile={true}
        />
        <AccountDropdownMenu
          isOpen={isProfileOpen}
          onClose={() => setIsProfileOpen(false)}
          isMobile={true}
        />

      </>
      ) : (
        <header className="hidden md:flex absolute top-0 left-0 right-0 h-16 draggable-header items-center justify-between px-4 z-50 pointer-events-none">
        <div className="w-[min(20vw,450px)] flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => navigate(-1)}
            title="Go back"
            className="w-8 h-8 rounded-full no-drag flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => navigate(1)}
            title="Go forward"
            className="w-8 h-8 rounded-full no-drag flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex justify-center pointer-events-auto">
          <button
            type="button"
            onClick={() => {
              setIsSidebarOpen(true)
              navigate('/')
            }}
            title="Home"
            className="mr-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-text no-drag shadow-md transition-colors hover:bg-hover"
          >
            <FeloMark className="h-7 w-7" />
          </button>
          <form
            onSubmit={handleTopSearchSubmit}
            className="flex items-center bg-surface-elevated rounded-full pl-5 pr-2 py-2 w-full max-w-[620px] no-drag focus-within:ring-1 focus-within:ring-text transition-all shadow-md relative"
          >
            <SearchIcon className="w-5 h-5 text-text-muted shrink-0" />
            <input
              ref={topSearchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                const trimmed = searchQuery.trim()
                if (trimmed) {
                  navigate(`/search?q=${encodeURIComponent(trimmed)}`)
                } else {
                  navigate('/search')
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('')
                    navigate('/search')
                  } else {
                    topSearchInputRef.current?.blur()
                  }
                }
              }}
              placeholder={
                AppCapabilities.onlineSearch
                  ? 'What do you want to search for? (Ctrl+K)'
                  : 'Search local library (songs, artists, albums)... (Ctrl+K)'
              }
              className="bg-transparent border-none outline-none text-[14px] font-medium text-text placeholder:text-text-muted w-full px-3"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  navigate('/search')
                  topSearchInputRef.current?.focus()
                }}
                title="Clear search"
                className="p-1.5 rounded-full text-text-muted hover:text-text hover:bg-hover transition-colors shrink-0 mr-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Search Mode Selector */}
            {AppCapabilities.onlineSearch && (
              <div ref={searchModeRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsSearchModeOpen(!isSearchModeOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-canvas hover:bg-hover transition-colors text-xs font-medium text-text-muted hover:text-text border border-border/50"
                >
                  {searchMode === 'local' && (
                    <>
                      <HardDrive className="w-3.5 h-3.5" /> Local
                    </>
                  )}
                  {searchMode === 'apple_music' && (
                    <>
                      <Globe className="w-3.5 h-3.5" /> Apple Music
                    </>
                  )}
                  {searchMode === 'musicbrainz' && (
                    <>
                      <Database className="w-3.5 h-3.5" /> MusicBrainz
                    </>
                  )}
                  {AppCapabilities.lastFm && searchMode === 'lastfm' && (
                    <>
                      <Radio className="w-3.5 h-3.5" /> Last.fm
                    </>
                  )}
                </button>

                {isSearchModeOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-surface-elevated border border-border rounded-lg shadow-xl py-1.5 z-[100] animate-in fade-in slide-in-from-top-1">
                    <div className="px-3 py-2 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                      Search Source
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSearchMode('local')
                        setIsSearchModeOpen(false)
                      }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'local' ? 'text-white bg-white/10 font-medium' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                    >
                      <HardDrive className="w-4 h-4" />
                      Local Library
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSearchMode('apple_music')
                        setIsSearchModeOpen(false)
                      }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'apple_music' ? 'text-white bg-white/10 font-medium' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                    >
                      <Globe className="w-4 h-4" />
                      Apple Music
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSearchMode('musicbrainz')
                        setIsSearchModeOpen(false)
                      }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'musicbrainz' ? 'text-white bg-white/10 font-medium' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                    >
                      <Database className="w-4 h-4" />
                      MusicBrainz
                    </button>

                    {AppCapabilities.lastFm && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchMode('lastfm')
                          setIsSearchModeOpen(false)
                        }}
                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'lastfm' ? 'text-white bg-white/10 font-medium' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                      >
                        <Radio className="w-4 h-4" />
                        Last.fm
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto mr-2">
          {isPrivateSession && (
            <button
              type="button"
              onClick={togglePrivateSession}
              title={`Private session active${remainingTimeStr ? ` (auto-ends in ${remainingTimeStr})` : ''} - click to turn off`}
              className="h-8 px-3 rounded-full flex items-center gap-1.5 bg-primary-amber/15 text-primary-amber border border-primary-amber/30 text-xs font-semibold hover:bg-primary-amber/25 transition cursor-pointer"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>Private</span>
              {remainingTimeStr && (
                <span className="text-[10px] opacity-75 font-normal">({remainingTimeStr})</span>
              )}
            </button>
          )}
          <div ref={notificationRef} className="relative">
            <button
              type="button"
              onClick={() => setIsNotificationOpen((prev) => !prev)}
              title={unreadNotificationCount > 0 ? `Notifications (${unreadNotificationCount} new)` : 'Notifications'}
              className={`w-10 h-10 rounded-full flex items-center justify-center no-drag transition-all shadow-sm relative ${
                isNotificationOpen
                  ? 'bg-primary-amber text-canvas'
                  : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text'
              }`}
            >
              <Bell className="w-5 h-5" />
              {unreadNotificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-danger text-white text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-canvas shadow-md animate-in zoom-in-50">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            <NotificationDropdown
              isOpen={isNotificationOpen}
              onClose={() => setIsNotificationOpen(false)}
              isMobile={false}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setIsFriendActivityOpen((isOpen) => {
                const nextIsOpen = !isOpen
                if (nextIsOpen) {
                  setIsDownloadPanelOpen(false)
                  setDownloadTarget(null)
                }
                return nextIsOpen
              })
            }}
            title="Friend activity"
            className={`w-10 h-10 rounded-full flex items-center justify-center no-drag transition-all shadow-sm ${
              isFriendActivityOpen
                ? 'bg-primary-amber text-canvas'
                : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text'
            }`}
          >
            <Users className="w-5 h-5" />
          </button>
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              title={isPrivateSession ? 'Profile (Private session active)' : 'Profile'}
              className={`w-10 h-10 rounded-full bg-surface-elevated text-text-muted flex items-center justify-center no-drag hover:bg-hover hover:text-text transition-all shadow-sm relative ${
                isPrivateSession ? 'ring-2 ring-primary-amber/60' : ''
              }`}
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <User className="w-5 h-5" />
              )}
              {isPrivateSession && (
                <span
                  title="Private session active"
                  className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-primary-amber text-canvas rounded-full flex items-center justify-center shadow"
                >
                  <EyeOff className="w-2.5 h-2.5" />
                </span>
              )}
            </button>

            <AccountDropdownMenu
              isOpen={isProfileOpen}
              onClose={() => setIsProfileOpen(false)}
              isMobile={false}
            />
          </div>
          {isElectron && (
            <div className="flex items-center gap-2 no-drag">
              <button
                type="button"
                onClick={() => window.api?.minimizeWindow()}
                title="Minimize"
                className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => window.api?.maximizeWindow()}
                title="Maximize"
                className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
              <button
                type="button"
                onClick={() => window.api?.closeWindow()}
                title="Close"
                className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </header>
      )}

      {/* Main Layout Container */}
      <div
        className={cn(
          'flex-1 flex overflow-hidden pb-2 px-2 gap-2 relative',
          isMobileScreen
            ? 'pt-[calc(3.5rem+env(safe-area-inset-top,0px))] px-0 pb-0'
            : 'pt-[64px]'
        )}
      >
        {/* Left Sidebar (Desktop Only) */}
        {!isMobileScreen && (
          <div
            className={`hidden md:block h-full shrink-0 transition-[width] duration-300 ease-out ${
              isSidebarOpen ? 'w-[min(20vw,500px)]' : 'w-[72px]'
            }`}
          >
            <div className="relative h-full w-full overflow-visible rounded-lg bg-canvas">
              <Sidebar
                isOpen={isSidebarOpen}
                onToggle={toggleSidebar}
                onOpenDownloadPanel={(target) => {
                  setDownloadTarget(target)
                  setIsFriendActivityOpen(false)
                  setIsDownloadPanelOpen(true)
                }}
              />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main
          className={cn(
            'flex-1 flex flex-col h-full overflow-hidden bg-surface relative z-10 shadow-lg',
            isMobileScreen ? 'rounded-none' : 'rounded-xl'
          )}
        >
          <section
            ref={mainContentRef}
            className={cn('flex-1 overflow-y-auto relative no-drag', isMobileScreen && 'pb-36')}
          >
            <div className="h-full min-h-full w-full flex flex-col flex-1">
              <ErrorBoundary>
                <AppRoutes
                  onOpenDownloadPanel={(target) => {
                    setDownloadTarget(target)
                    setIsFriendActivityOpen(false)
                    setIsDownloadPanelOpen(true)
                  }}
                />
              </ErrorBoundary>
            </div>
          </section>
        </main>
        {AppCapabilities.downloads && isDownloadPanelOpen && (
          <DownloadPanel
            targetSong={downloadTarget}
            onClose={() => {
              setIsDownloadPanelOpen(false)
              setDownloadTarget(null)
            }}
          />
        )}
        {isFriendActivityOpen && (
          <FriendActivityPanel onClose={() => setIsFriendActivityOpen(false)} />
        )}
        <LibraryScanPill />
        <PlaybackNoticeToast />
        <InvitationToast />
        <PlaybackTransferModal />
        <FileDropOverlay />
      </div>

      {isMobileScreen ? (
        <>
          <MobileDockedPlayer
            onExpand={() => setIsMobileNowPlayingOpen(true)}
            onOpenDevices={() => setIsMobileDeviceSheetOpen(true)}
          />
          <MobileNavBar onOpenAccountMenu={() => setIsProfileOpen((prev) => !prev)} />
          {isMobileNowPlayingOpen && (
            <div className="fixed inset-0 z-50 bg-black animate-in fade-in duration-200">
              <MobileNowPlaying
                state={activePlayerState}
                isConnected={isRemoteConnected || Boolean(isCloudRemoteActive)}
                onClose={() => setIsMobileNowPlayingOpen(false)}
                onOpenQueue={() => {
                  setIsMobileNowPlayingOpen(false)
                  setIsQueueOpen(true)
                }}
                onOpenSearch={() => {
                  setIsMobileNowPlayingOpen(false)
                  navigate('/search')
                }}
                onOpenDevices={() => setIsMobileDeviceSheetOpen(true)}
                onOpenLyrics={() => {
                  setIsMobileLyricsSheetOpen(true)
                }}
                onOpenSleepTimer={() => {
                  // Sleep timer trigger if needed
                }}
              />
            </div>
          )}
          <MobileDeviceSheet
            state={activePlayerState}
            isConnected={isRemoteConnected || Boolean(isCloudRemoteActive)}
            isOpen={isMobileDeviceSheetOpen}
            onClose={() => setIsMobileDeviceSheetOpen(false)}
          />
          <MobileLyricsSheet
            song={activePlayerState.song}
            currentTime={activePlayerState.position}
            isPlaying={activePlayerState.isPlaying}
            isOpen={isMobileLyricsSheetOpen}
            onClose={() => setIsMobileLyricsSheetOpen(false)}
            onExpand={() => {
              setIsMobileLyricsSheetOpen(false)
              setIsMobileNowPlayingOpen(false)
              navigate('/lyrics')
            }}
            onSeek={(seconds) => {
              if (joinedRoom && joinedRoom.song) {
                if (isPlayerLocked) return
                usePlayerStore.getState().seek(seconds)
              } else if (isRemoteConnected) {
                void remoteClient.seek(seconds)
              } else if (isCloudRemoteActive && activeRemote && user?.id) {
                void sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'seek', { seconds })
              } else {
                usePlayerStore.getState().seek(seconds)
              }
            }}
          />
        </>
      ) : (
        <div className="px-2 pb-2">
          <Footer
            isQueueOpen={isQueueOpen}
            onToggleQueue={() => setIsQueueOpen((open) => !open)}
            onOpenDownloadPanel={(target) => {
              if (!AppCapabilities.downloads) return
              if (target) {
                setDownloadTarget(target)
                setIsFriendActivityOpen(false)
                setIsDownloadPanelOpen(true)
              } else {
                setDownloadTarget(null)
                setIsFriendActivityOpen(false)
                setIsDownloadPanelOpen((isOpen) => !isOpen)
              }
            }}
          />
        </div>
      )}

      {/* Play Queue Overlay Drawer */}
      <QueueDrawer isOpen={isQueueOpen} onClose={() => setIsQueueOpen(false)} />

      {/* Session Leave & Play Confirmation Dialog */}
      <SessionLeaveDialog />

      {/* Context-Aware New Version Update Dialog (MUSIXQUARE Architecture) */}
      <UpdateModalDialog />

      {/* Spatial Audio & Multi-Device DSP Modal (MUSIXQUARE Audio) */}
      <AudioFxModal />

      {/* Manual Sync (ms) Latency Calibration Modal (MUSIXQUARE Sync) */}
      <ManualSyncModal />
    </div>
  )
}

export default App
