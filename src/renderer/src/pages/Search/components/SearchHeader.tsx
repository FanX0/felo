import { Globe, HardDrive, Database, Radio } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { AppCapabilities } from '../../../lib/appConfig'
import type { SearchTab, SearchSections } from '../types'

interface SearchHeaderProps {
  activeTab: SearchTab
  searchMode: string
  results: SearchSections
  onTabChange: (tab: SearchTab) => void
  onModeChange: (mode: any) => void
}

export function SearchHeader({
  activeTab,
  searchMode,
  results,
  onTabChange,
  onModeChange
}: SearchHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/40">
      {/* Category Tabs: All, Songs, Artists, Albums, Playlists */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['All', 'Songs', 'Artists', 'Albums', 'Playlists'] as const).map((tab) => {
          const count =
            tab === 'Songs'
              ? results.Songs.length
              : tab === 'Artists'
                ? results.Artists.length
                : tab === 'Albums'
                  ? results.Albums.length
                  : tab === 'Playlists'
                    ? results.Playlists.length
                    : null
          return (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all shrink-0 cursor-pointer',
                activeTab === tab
                  ? 'bg-text text-canvas shadow-sm font-bold'
                  : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text border border-border/40'
              )}
            >
              {tab}
              {count !== null && count > 0 && (
                <span className="ml-1.5 opacity-70 tabular-nums">({count})</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Source Switcher Pills */}
      {AppCapabilities.onlineSearch && (
        <div className="flex items-center gap-1 bg-surface-elevated p-1 rounded-full border border-border/50 text-xs shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => onModeChange('local')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors cursor-pointer',
              searchMode === 'local'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-hover'
            )}
          >
            <HardDrive className="w-3.5 h-3.5" /> Local
          </button>
          <button
            type="button"
            onClick={() => onModeChange('apple_music')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors cursor-pointer',
              searchMode === 'apple_music'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-hover'
            )}
          >
            <Globe className="w-3.5 h-3.5" /> Apple Music
          </button>
          <button
            type="button"
            onClick={() => onModeChange('musicbrainz')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors cursor-pointer',
              searchMode === 'musicbrainz'
                ? 'bg-white text-black font-bold shadow-sm'
                : 'text-text-muted hover:text-text hover:bg-hover'
            )}
          >
            <Database className="w-3.5 h-3.5" /> MusicBrainz
          </button>
          {AppCapabilities.lastFm && (
            <button
              type="button"
              onClick={() => onModeChange('lastfm')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-full font-medium transition-colors cursor-pointer',
                searchMode === 'lastfm'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-text-muted hover:text-text hover:bg-hover'
              )}
            >
              <Radio className="w-3.5 h-3.5" /> Last.fm
            </button>
          )}
        </div>
      )}
    </div>
  )
}
