import { create } from 'zustand'

export type SearchMode = 'local' | 'apple_music' | 'musicbrainz' | 'lastfm'
export type UiMode = 'studio' | 'classic'

interface AppState {
  searchQuery: string
  searchMode: SearchMode
  uiMode: UiMode
  setSearchQuery: (query: string) => void
  setSearchMode: (mode: SearchMode) => void
  setUiMode: (mode: UiMode) => void
  toggleUiMode: () => void
}

const savedUiMode = (typeof localStorage !== 'undefined' && localStorage.getItem('felo_ui_mode') as UiMode) || 'classic'

export const useAppStore = create<AppState>((set) => ({
  searchQuery: '',
  searchMode: 'local',
  uiMode: savedUiMode,
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  setUiMode: (mode) => {
    try {
      localStorage.setItem('felo_ui_mode', mode)
    } catch {
      // ignore
    }
    set({ uiMode: mode })
  },
  toggleUiMode: () =>
    set((state) => {
      const next = state.uiMode === 'studio' ? 'classic' : 'studio'
      try {
        localStorage.setItem('felo_ui_mode', next)
      } catch {
        // ignore
      }
      return { uiMode: next }
    })
}))
