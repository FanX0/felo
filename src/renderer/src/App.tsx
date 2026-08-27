import { useState, useRef, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import { cn } from './lib/utils'
import Sidebar from './components/Sidebar/Sidebar'
import Footer from './components/Footer/Footer'
import AudioEngine from './components/AudioEngine'
import DownloadPanel from './components/DownloadPanel/DownloadPanel'
import type { DownloadTarget } from './components/DownloadPanel/DownloadPanel'
import DownloadEventBridge from './components/DownloadEventBridge'
import FriendActivityPanel from './components/FriendActivity/FriendActivityPanel'
import ListeningPresenceBridge from './components/ListeningPresenceBridge'

import Home from './pages/Home/Home'
import Library from './pages/Library/Library'
import Search from './pages/Search/Search'
import Playlists from './pages/Playlists/Playlists'
import PlaylistDetail from './pages/Playlists/PlaylistDetail'
import AlbumPage from './pages/Album/AlbumPage'
import ArtistPage from './pages/Artist/ArtistPage'
import LyricsPage from './pages/Lyrics/LyricsPage'
import Settings from './pages/Settings/Settings'
import AccountPage from './pages/Online/AccountPage'
import ProfilePage from './pages/Online/ProfilePage'
import ChatPage from './pages/Online/ChatPage'

import ListenTogetherPage from './pages/Online/ListenTogetherPage'
import {
  Search as SearchIcon,
  Settings as SettingsIcon,
  User,
  LogOut,
  EyeOff,
  Globe,
  Database,
  HardDrive,
  Radio,
  ChevronLeft,
  ChevronRight,
  Users,
  Minus,
  Square,
  X
} from 'lucide-react'
import { useAppStore } from './hooks/useAppStore'
import { useOnlineStore } from './hooks/useOnlineStore'

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
  const [isPrivateSession, setIsPrivateSession] = useState(false)
  const [isDownloadPanelOpen, setIsDownloadPanelOpen] = useState(false)
  const [isFriendActivityOpen, setIsFriendActivityOpen] = useState(false)
  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => localStorage.getItem('felo_sidebar_open') !== 'false'
  )
  const { configured, initialized, user, profile, initialize, signOut } = useOnlineStore()

  const searchModeRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

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
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleTopSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate('/search')
    }
  }

  return (
    <div
      className={cn(
        'h-screen w-screen flex flex-col bg-canvas text-text font-sans antialiased overflow-hidden'
      )}
    >
      <AudioEngine />
      <DownloadEventBridge />
      <ListeningPresenceBridge enabled={!isPrivateSession} />

      {/* Top Application Bar (Draggable) */}
      <header className="absolute top-0 left-0 right-0 h-16 draggable-header flex items-center justify-between px-4 z-50 pointer-events-none">
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
            className="flex items-center bg-surface-elevated rounded-full pl-5 pr-2 py-2 w-[625px] no-drag focus-within:ring-1 focus-within:ring-text transition-all shadow-md relative"
          >
            <SearchIcon className="w-5 h-5 text-text-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => navigate('/search')}
              placeholder="What do you want to search for?"
              className="bg-transparent border-none outline-none text-[14px] font-medium text-text placeholder:text-text-muted w-full px-3"
            />

            {/* Search Mode Selector */}
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
                {searchMode === 'lastfm' && (
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
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'local' ? 'text-primary-amber bg-primary-amber/10' : 'text-text-muted hover:bg-hover hover:text-text'}`}
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
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'apple_music' ? 'text-primary-amber bg-primary-amber/10' : 'text-text-muted hover:bg-hover hover:text-text'}`}
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
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'musicbrainz' ? 'text-primary-amber bg-primary-amber/10' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                  >
                    <Database className="w-4 h-4" />
                    MusicBrainz
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSearchMode('lastfm')
                      setIsSearchModeOpen(false)
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${searchMode === 'lastfm' ? 'text-primary-amber bg-primary-amber/10' : 'text-text-muted hover:bg-hover hover:text-text'}`}
                  >
                    <Radio className="w-4 h-4" />
                    Last.fm
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto mr-2">
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
              title="Profile"
              className="w-10 h-10 rounded-full bg-surface-elevated text-text-muted flex items-center justify-center no-drag hover:bg-hover hover:text-text transition-all shadow-sm"
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
            </button>

            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-surface-elevated border border-border rounded-lg shadow-xl py-1.5 z-[100] animate-in fade-in slide-in-from-top-1">
                {/* User Info */}
                <div className="px-4 py-3 border-b border-border">
                  <p className="truncate text-sm font-bold text-text">
                    {profile?.display_name || (user ? 'Online profile' : 'Local listener')}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {user?.email || (configured && initialized ? 'Not signed in' : 'Local account')}
                  </p>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setIsProfileOpen(false)
                      navigate(user ? '/profile' : '/account')
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors"
                  >
                    <User className="w-4 h-4" />
                    {user ? 'Profile' : 'Sign in'}
                  </button>
                  <button
                    onClick={() => {
                      setIsProfileOpen(false)
                      navigate('/settings')
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    Settings
                  </button>
                  <button
                    onClick={() => setIsPrivateSession(!isPrivateSession)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors"
                  >
                    <span className="flex items-center gap-3">
                      <EyeOff className="w-4 h-4" />
                      Private session
                    </span>
                    <div
                      className={`w-9 h-5 rounded-full transition-colors relative ${isPrivateSession ? 'bg-primary-amber' : 'bg-border'}`}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isPrivateSession ? 'translate-x-4' : 'translate-x-0.5'}`}
                      />
                    </div>
                  </button>
                </div>

                <div className="border-t border-border py-1">
                  {user && (
                    <button
                      onClick={() => {
                        setIsProfileOpen(false)
                        void signOut()
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Log out
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
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
        </div>
      </header>

      {/* Main Layout Container */}
      <div className="flex-1 flex overflow-hidden pt-[64px] pb-2 px-2 gap-2 relative z-0">
        {/* Left Sidebar */}
        <div
          className={`h-full shrink-0 transition-[width] duration-300 ease-out ${
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

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full overflow-hidden bg-surface rounded-xl relative z-10 shadow-lg">
          <section className="flex-1 overflow-y-auto relative no-drag">
            <div className="h-full">
              <Routes>
                <Route
                  path="/"
                  element={
                    <Home
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route
                  path="/library"
                  element={
                    <Library
                      onOpenDownloadPanel={() => {
                        setDownloadTarget(null)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route
                  path="/search"
                  element={
                    <Search
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route path="/playlists" element={<Playlists />} />
                <Route
                  path="/playlists/:id"
                  element={
                    <PlaylistDetail
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route
                  path="/artist/:name"
                  element={
                    <ArtistPage
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route
                  path="/album/:artist/:title"
                  element={
                    <AlbumPage
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
                <Route path="/lyrics" element={<LyricsPage />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/profile/:username" element={<ProfilePage />} />
                <Route
                  path="/chat"
                  element={
                    <ChatPage
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />

                <Route
                  path="/listen-together"
                  element={
                    <ListenTogetherPage
                      onOpenDownloadPanel={(target) => {
                        setDownloadTarget(target)
                        setIsFriendActivityOpen(false)
                        setIsDownloadPanelOpen(true)
                      }}
                    />
                  }
                />
              </Routes>
            </div>
          </section>
        </main>
        {isDownloadPanelOpen && (
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
      </div>

      <div className="px-2 pb-2">
        <Footer
          onOpenDownloadPanel={(target) => {
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
    </div>
  )
}

export default App
