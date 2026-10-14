import type { HomeTabType } from '../types'
import { Sparkles, BarChart3, Disc3, Trophy, Radio } from 'lucide-react'
import { AppCapabilities } from '../../../lib/appConfig'

interface HomeTabsProps {
  activeTab: HomeTabType
  onTabChange: (tab: HomeTabType) => void
}

const ALL_TABS: Array<{ id: HomeTabType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'For You', icon: Sparkles },
  { id: 'apple', label: 'Apple Charts', icon: BarChart3 },
  { id: 'spotify', label: 'Spotify Playlists', icon: Disc3 },
  { id: 'aoty', label: 'Critic Picks', icon: Trophy },
  { id: 'lastfm', label: 'Community', icon: Radio }
]

export function HomeTabs({ activeTab, onTabChange }: HomeTabsProps) {
  const visibleTabs = ALL_TABS.filter((tab) => {
    if (tab.id === 'overview') return true
    return AppCapabilities.onlineDiscovery
  })

  // In local-first mode with only 1 tab, hide the tabs bar to maximize space
  if (visibleTabs.length <= 1) {
    return null
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/5 bg-surface/90 px-4 py-3 backdrop-blur-xl sm:px-8">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`group flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all duration-200 ${
                isActive
                  ? 'bg-white text-black shadow-md scale-[1.02]'
                  : 'bg-surface-elevated/70 text-text-muted hover:bg-hover hover:text-white'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 transition-colors ${
                  isActive ? 'text-black' : 'text-text-muted group-hover:text-white'
                }`}
              />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
