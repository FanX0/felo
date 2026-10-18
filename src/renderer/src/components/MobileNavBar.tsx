import { Home, Search, Library, Users, User } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useOnlineStore } from '../hooks/useOnlineStore'
import Avatar from './Common/Avatar'
import { cn } from '../lib/utils'

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8)
    } catch {
      // ignore
    }
  }
}

interface MobileNavBarProps {
  onOpenAccountMenu?: () => void
}

export default function MobileNavBar({ onOpenAccountMenu }: MobileNavBarProps = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useOnlineStore()
  const currentPath = location.pathname.toLowerCase()

  const isHome = currentPath === '/' || currentPath === ''
  const isSearch = currentPath.startsWith('/search')
  const isLibrary =
    currentPath.startsWith('/library') ||
    currentPath.startsWith('/playlists') ||
    currentPath.startsWith('/album') ||
    currentPath.startsWith('/artist')
  const isFriendActivity =
    currentPath.startsWith('/friends') ||
    currentPath.startsWith('/friend') ||
    currentPath.startsWith('/activity')
  const isAccount =
    currentPath.startsWith('/account') ||
    currentPath.startsWith('/profile') ||
    currentPath.startsWith('/settings')

  const handleNav = (targetPath: string, isActive: boolean) => {
    triggerHaptic()
    if (isActive) {
      if ((targetPath === '/profile' || targetPath === '/account') && onOpenAccountMenu) {
        onOpenAccountMenu()
        return
      }
      const scrollContainer = document.querySelector<HTMLElement>('main section')
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
      if (targetPath === '/search') {
        const input = document.querySelector<HTMLInputElement>('input[type="search"]')
        input?.focus()
      }
    } else {
      navigate(targetPath)
    }
  }

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#121212]/95 backdrop-blur-xl border-t border-white/10 px-2 py-1 flex items-center justify-around pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] text-[11px] font-medium select-none shadow-2xl touch-manipulation"
    >
      {/* 1. Home */}
      <button
        type="button"
        onClick={() => handleNav('/', isHome)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isHome ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Home className={`w-5 h-5 ${isHome ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span className={isHome ? 'text-white' : ''}>Home</span>
        {isHome && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* 2. Search */}
      <button
        type="button"
        onClick={() => handleNav('/search', isSearch)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isSearch ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Search className={`w-5 h-5 ${isSearch ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span className={isSearch ? 'text-white' : ''}>Search</span>
        {isSearch && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* 3. Your Library */}
      <button
        type="button"
        onClick={() => handleNav('/library', isLibrary)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isLibrary ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Library className={`w-5 h-5 ${isLibrary ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span className={isLibrary ? 'text-white' : ''}>Library</span>
        {isLibrary && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* 4. Friend Activity */}
      <button
        type="button"
        onClick={() => handleNav('/friends', isFriendActivity)}
        title="Friend Activity"
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isFriendActivity ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Users className={`w-5 h-5 ${isFriendActivity ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span
          className={cn(
            'truncate max-w-[74px] text-center text-[10px] sm:text-[11px]',
            isFriendActivity ? 'text-white' : ''
          )}
        >
          Friend Activity
        </span>
        {isFriendActivity && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* 5. Account / Profile */}
      <button
        type="button"
        onClick={() => handleNav(user ? '/profile' : '/account', isAccount)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isAccount ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        {user ? (
          <div className="relative flex items-center justify-center">
            <Avatar
              src={profile?.avatar_url}
              fallbackText={profile?.display_name || user?.email}
              metadataFallback={user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
              size="2xs"
              className={cn(
                'border transition-all',
                isAccount
                  ? 'border-emerald-400 ring-2 ring-emerald-400/40 text-emerald-300'
                  : 'border-white/20 text-zinc-300'
              )}
              showInitials={true}
              maxInitials={1}
            />
          </div>
        ) : (
          <User className={`w-5 h-5 ${isAccount ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        )}
        <span className={isAccount ? 'text-white' : ''}>{user ? 'Profile' : 'Account'}</span>
        {isAccount && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>
    </nav>
  )
}
