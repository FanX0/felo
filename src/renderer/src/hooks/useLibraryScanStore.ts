import { create } from 'zustand'

export interface LibraryScanProgress {
  status: 'idle' | 'discovering' | 'indexing' | 'committing' | 'completed' | 'cancelled' | 'error'
  folderPath: string
  folderName: string
  totalFiles: number
  processedFiles: number
  addedCount: number
  updatedCount: number
  skippedCount: number
  currentFile?: string
  currentTrack?: {
    title: string
    artist: string
  }
  percent: number
  speed?: number
  elapsedMs?: number
  estimatedRemainingMs?: number
  error?: string
}

interface LibraryScanStore {
  isScanning: boolean
  progress: LibraryScanProgress | null
  isPillExpanded: boolean
  isDismissed: boolean
  updateProgress: (progress: LibraryScanProgress) => void
  togglePillExpanded: () => void
  setPillExpanded: (expanded: boolean) => void
  dismiss: () => void
  cancelScan: () => Promise<void>
}

export const useLibraryScanStore = create<LibraryScanStore>((set) => ({
  isScanning: false,
  progress: null,
  isPillExpanded: false,
  isDismissed: false,
  updateProgress: (progress) => {
    const isScanning =
      progress.status === 'discovering' ||
      progress.status === 'indexing' ||
      progress.status === 'committing'

    set((state) => ({
      progress,
      isScanning,
      isDismissed: isScanning ? false : state.isDismissed
    }))
  },
  togglePillExpanded: () => set((state) => ({ isPillExpanded: !state.isPillExpanded })),
  setPillExpanded: (isPillExpanded) => set({ isPillExpanded }),
  dismiss: () => set({ isDismissed: true }),
  cancelScan: async () => {
    try {
      if (window.api?.cancelLibraryScan) {
        await window.api.cancelLibraryScan()
      }
    } catch (err) {
      console.warn('Failed to cancel scan:', err)
    }
  }
}))
