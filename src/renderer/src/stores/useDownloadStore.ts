import { create } from 'zustand'
import type { DownloadConflictMode, DownloadSourceId } from '../lib/downloadConfig'
import type { Song } from '../types/song'

export type TransferStatus = 'queued' | 'waiting_connector' | 'downloading' | 'completed' | 'failed'

export interface TransferItem {
  id: string
  source: DownloadSourceId
  sourceName: string
  title: string
  artist: string
  quality: string
  size: string
  conflictMode: DownloadConflictMode
  status: TransferStatus
  progress: number
  createdAt: number
  message?: string
  autoPlay?: boolean
  playAction?: 'play_now' | 'play_next' | 'enqueue'
  requestedBy?: string
  resultId?: string
  song?: Song
}

interface DownloadStore {
  transfers: TransferItem[]
  isTransfersOpen: boolean
  queueTransfer: (
    transfer: Omit<TransferItem, 'id' | 'createdAt'> & { id?: string },
    options?: { openDrawer?: boolean }
  ) => string
  updateTransfer: (id: string, update: Partial<TransferItem>) => void
  setTransfersOpen: (isOpen: boolean) => void
  toggleTransfers: () => void
  removeTransfer: (id: string) => void
  clearTransfers: () => void
}

export const useDownloadStore = create<DownloadStore>((set) => ({
  transfers: [],
  isTransfersOpen: false,
  queueTransfer: (transfer, options) => {
    const shouldOpen = options?.openDrawer ?? true
    const id = transfer.id || `${transfer.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({
      transfers: [{ ...transfer, id, createdAt: Date.now() }, ...state.transfers],
      isTransfersOpen: shouldOpen ? true : state.isTransfersOpen
    }))
    return id
  },
  updateTransfer: (id, update) =>
    set((state) => ({
      transfers: state.transfers.map((transfer) => {
        if (transfer.id !== id) return transfer
        // Monotonic progress clamping: during active downloads, progress can never decrease.
        // This prevents jumping progress bars from multi-source fallbacks and yt-dlp fragment resets.
        if (
          update.progress !== undefined &&
          transfer.status === 'downloading' &&
          (update.status === undefined || update.status === 'downloading')
        ) {
          update = { ...update, progress: Math.max(transfer.progress || 0, update.progress) }
        }
        return { ...transfer, ...update }
      })
    })),
  setTransfersOpen: (isTransfersOpen) => set({ isTransfersOpen }),
  toggleTransfers: () => set((state) => ({ isTransfersOpen: !state.isTransfersOpen })),
  removeTransfer: (id) =>
    set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.id !== id) })),
  clearTransfers: () => set({ transfers: [] })
}))
