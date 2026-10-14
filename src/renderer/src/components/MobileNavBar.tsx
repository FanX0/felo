import { Home, Search, Library, Radio, User } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useOnlineStore } from '../hooks/useOnlineStore'

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8)
    } catch {
      // ignore
    }
  }
}

export default function MobileNavBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useOnlineStore()
  const currentPath = location.pathname.toLowerCase()

  const isHome = currentPath === '/' || currentPath === ''
  const isSearch = currentPath.startsWith('/search')
  const isLibrary =
    currentPath.startsWith('/library') ||
    currentPath.startsWith('/playlists') ||
    currentPath.startsWith('/album') ||
    currentPath.startsWith('/artist')
  const isTogether =
    currentPath.startsWith('/listen') ||
    currentPath.startsWith('/together') ||
    currentPath.startsWith('/online/listen')
  const isAccount =
    currentPath.startsWith('/account') ||
    currentPath.startsWith('/profile') ||
    currentPath.startsWith('/settings')

  const handleNav = (targetPath: string, isActive: boolean) => {
    triggerHaptic()
    if (isActive) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#121212]/95 backdrop-blur-xl border-t border-white/10 px-2 py-1 flex items-center justify-around pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] text-[11px] font-medium select-none shadow-2xl touch-manipulation"
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

      {/* 4. Together */}
      <button
        type="button"
        onClick={() => handleNav('/listen-together', isTogether)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isTogether ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Radio className={`w-5 h-5 ${isTogether ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span className={isTogether ? 'text-white' : ''}>Together</span>
        {isTogether && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>

      {/* 5. Account */}
      <button
        type="button"
        onClick={() => handleNav(user ? '/profile' : '/account', isAccount)}
        className={`flex-1 py-1.5 min-h-[44px] flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative outline-none focus:outline-none focus-visible:outline-none focus:ring-0 active:outline-none select-none ${
          isAccount ? 'text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <User className={`w-5 h-5 ${isAccount ? 'stroke-[2.5] text-emerald-400' : 'stroke-[1.8]'}`} />
        <span className={isAccount ? 'text-white' : ''}>Account</span>
        {isAccount && (
          <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-emerald-400" />
        )}
      </button>
    </nav>
  )
}
