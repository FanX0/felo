import { create } from 'zustand'

export type SearchMode = 'local' | 'apple_music' | 'musicbrainz' | 'lastfm'

interface AppState {
  searchQuery: string
  searchMode: SearchMode
  setSearchQuery: (query: string) => void
  setSearchMode: (mode: SearchMode) => void
}

export const useAppStore = create<AppState>((set) => ({
  searchQuery: '',
  searchMode: 'local',
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode })
}))
