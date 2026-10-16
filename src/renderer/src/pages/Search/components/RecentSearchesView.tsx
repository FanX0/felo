import React from 'react'
import {
  History,
  X,
  HardDrive,
  ListMusic,
  User as UserIcon,
  Disc3,
  Globe,
  Radio,
  Flame
} from 'lucide-react'
import { AppCapabilities } from '../../../lib/appConfig'
import { RecentlyPlayedList } from './RecentlyPlayedList'
import type { SearchItem, SearchTab } from '../types'

interface RecentSearchesViewProps {
  recentSearches: string[]
  playedItems: SearchItem[]
  onSelectRecentSearch: (query: string) => void
  onRemoveRecentSearch: (query: string, e: React.MouseEvent) => void
  onClearRecentSearches: () => void
  onClearRecentlyPlayed: () => void
  onPlayItem: (item: SearchItem) => void
  onNavigate: (path: string) => void
  onBrowseCategory: (mode: any, tab: SearchTab, query: string) => void
}

export function RecentSearchesView({
  recentSearches,
  playedItems,
  onSelectRecentSearch,
  onRemoveRecentSearch,
  onClearRecentSearches,
  onClearRecentlyPlayed,
  onPlayItem,
  onNavigate,
  onBrowseCategory
}: RecentSearchesViewProps) {
  return (
    <>
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-text tracking-tight">Search & Browse</h1>
        <p className="text-xs sm:text-sm text-text-muted mt-1">
          {AppCapabilities.onlineSearch
            ? 'Explore your library or search across global catalog streaming sources.'
            : 'Search and explore your local music library.'}
        </p>
      </div>

      {/* Recent Searches */}
      {recentSearches.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-text flex items-center gap-2">
              <History className="w-4 h-4 text-text-muted" /> Recent Searches
            </h2>
            <button
              type="button"
              onClick={onClearRecentSearches}
              className="text-xs font-medium text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {recentSearches.map((query) => (
              <div
                key={query}
                role="button"
                tabIndex={0}
                onClick={() => onSelectRecentSearch(query)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelectRecentSearch(query)
                }}
                className="group flex items-center gap-2 rounded-full bg-surface-elevated pl-4 pr-2 py-1.5 text-sm text-text hover:bg-hover hover:text-primary transition-colors cursor-pointer border border-border/50 shadow-sm"
              >
                <History className="w-3.5 h-3.5 text-text-muted group-hover:text-primary" />
                <span className="font-medium">{query}</span>
                <button
                  type="button"
                  title="Remove from recent searches"
                  onClick={(e) => onRemoveRecentSearch(query, e)}
                  className="p-1 rounded-full text-text-muted hover:text-white hover:bg-white/10 transition-colors ml-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Browse All Cards */}
      <section>
        <h2 className="text-lg font-bold text-text mb-4">Browse Categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
          <button
            type="button"
            onClick={() => onNavigate('/library')}
            className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
          >
            <span className="text-base font-bold text-text block">Your Library</span>
            <span className="text-[11px] text-text-muted block mt-0.5">Local Tracks</span>
            <HardDrive className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('/playlists')}
            className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
          >
            <span className="text-base font-bold text-text block">Playlists</span>
            <span className="text-[11px] text-text-muted block mt-0.5">Curated Mixes</span>
            <ListMusic className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => onBrowseCategory('local', 'Artists', 'a')}
            className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
          >
            <span className="text-base font-bold text-text block">Artists</span>
            <span className="text-[11px] text-text-muted block mt-0.5">All Creators</span>
            <UserIcon className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => onBrowseCategory('local', 'Albums', 'a')}
            className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
          >
            <span className="text-base font-bold text-text block">Albums</span>
            <span className="text-[11px] text-text-muted block mt-0.5">Discography</span>
            <Disc3 className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
          </button>

          {AppCapabilities.onlineSearch && (
            <button
              type="button"
              onClick={() => onBrowseCategory('apple_music', 'All', 'Billboard Hot 100')}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
            >
              <span className="text-base font-bold text-text block">Apple Music</span>
              <span className="text-[11px] text-text-muted block mt-0.5">Global Catalog</span>
              <Globe className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
            </button>
          )}

          {AppCapabilities.lastFm && (
            <button
              type="button"
              onClick={() => onBrowseCategory('lastfm', 'All', 'Top Tracks')}
              className="relative overflow-hidden h-28 rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] bg-surface-elevated border border-border hover:border-white/20 hover:bg-[#252528] shadow-sm group cursor-pointer"
            >
              <span className="text-base font-bold text-text block">Last.fm</span>
              <span className="text-[11px] text-text-muted block mt-0.5">Scrobbles & Charts</span>
              <Radio className="absolute bottom-2 right-2 w-10 h-10 text-text-muted/15 group-hover:text-text-muted/30 group-hover:rotate-6 transition-all" />
            </button>
          )}
        </div>
      </section>

      {/* Recently Played */}
      {playedItems.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-text flex items-center gap-2">
              <Flame className="w-4 h-4 text-text-muted" /> Recently Played
            </h2>
            <button
              type="button"
              title="Clear recently played"
              onClick={onClearRecentlyPlayed}
              className="text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
          <RecentlyPlayedList songs={playedItems} onPlay={onPlayItem} />
        </section>
      )}
    </>
  )
}
