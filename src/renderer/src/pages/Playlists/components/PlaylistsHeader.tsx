import { useRef } from 'react'
import { Plus, Search } from 'lucide-react'

interface PlaylistsHeaderProps {
  totalCount: number
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearchOpen: boolean
  setIsSearchOpen: (open: boolean) => void
  onCreateClick: () => void
}

export function PlaylistsHeader({
  totalCount,
  searchQuery,
  setSearchQuery,
  isSearchOpen,
  setIsSearchOpen,
  onCreateClick
}: PlaylistsHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 md:gap-8 border-b border-white/10 pb-6 md:pb-11">
      <div className="flex min-w-0 items-baseline justify-between sm:justify-start gap-3 sm:gap-5">
        <h1 className="truncate text-2xl sm:text-4xl md:text-[56px] font-black leading-tight sm:leading-none tracking-tight">
          Your Playlists
        </h1>
        <span className="shrink-0 text-xs sm:text-base md:text-[18px] text-[#c9d7f2]">
          {totalCount} playlists
        </span>
      </div>

      <div className="flex shrink-0 items-center justify-between sm:justify-end gap-2 sm:gap-4 w-full sm:w-auto">
        <div
          className={`flex h-10 sm:h-[52px] origin-right items-center overflow-hidden rounded-full border border-border/60 bg-surface-elevated transition-all duration-300 ${
            isSearchOpen ? 'w-full sm:w-[315px] px-3 sm:px-4' : 'w-10 sm:w-[52px]'
          }`}
        >
          <button
            type="button"
            title="Search playlists"
            onClick={() => {
              setIsSearchOpen(true)
              setTimeout(() => searchInputRef.current?.focus(), 50)
            }}
            className="flex h-10 sm:h-[52px] w-10 sm:w-[52px] shrink-0 items-center justify-center text-[#b3b3b3] hover:text-white cursor-pointer"
          >
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onBlur={() => !searchQuery && setIsSearchOpen(false)}
            placeholder="Search playlists..."
            className={`h-full min-w-0 flex-1 bg-transparent pr-2 sm:pr-3 text-sm sm:text-[16px] text-white outline-none placeholder:text-[#bdbdbd] ${
              isSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          />
        </div>

        <button
          type="button"
          onClick={onCreateClick}
          className="flex h-10 sm:h-[52px] shrink-0 items-center gap-2 sm:gap-3 rounded-full bg-white px-4 sm:px-7 text-xs sm:text-[16px] font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 cursor-pointer shadow-md"
        >
          <Plus className="h-4 w-4 sm:h-5 sm:w-5 stroke-[3]" />
          <span>Create Playlist</span>
        </button>
      </div>
    </header>
  )
}
