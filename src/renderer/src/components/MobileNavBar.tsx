import { Home, Search, Library, Radio, User } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'

export default function MobileNavBar() {
  const navigate = useNavigate()
  const location = useLocation()
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

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-[#121212]/95 backdrop-blur-xl border-t border-white/10 px-2 py-1.5 flex items-center justify-around pb-[max(0.6rem,env(safe-area-inset-bottom))] text-[11px] font-medium select-none shadow-2xl"
    >
      {/* 1. Home */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className={`flex-1 py-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
          isHome ? 'text-white font-bold scale-105' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Home className={`w-5 h-5 ${isHome ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
        <span>Home</span>
      </button>

      {/* 2. Search */}
      <button
        type="button"
        onClick={() => navigate('/search')}
        className={`flex-1 py-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
          isSearch ? 'text-white font-bold scale-105' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Search className={`w-5 h-5 ${isSearch ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
        <span>Search</span>
      </button>

      {/* 3. Your Library */}
      <button
        type="button"
        onClick={() => navigate('/library')}
        className={`flex-1 py-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
          isLibrary ? 'text-white font-bold scale-105' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Library className={`w-5 h-5 ${isLibrary ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
        <span>Library</span>
      </button>

      {/* 4. Together */}
      <button
        type="button"
        onClick={() => navigate('/listen-together')}
        className={`flex-1 py-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
          isTogether ? 'text-white font-bold scale-105' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <Radio className={`w-5 h-5 ${isTogether ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
        <span>Together</span>
      </button>

      {/* 5. Account */}
      <button
        type="button"
        onClick={() => navigate('/account')}
        className={`flex-1 py-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
          isAccount ? 'text-white font-bold scale-105' : 'text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <User className={`w-5 h-5 ${isAccount ? 'stroke-[2.5]' : 'stroke-[1.8]'}`} />
        <span>Account</span>
      </button>
    </nav>
  )
}
