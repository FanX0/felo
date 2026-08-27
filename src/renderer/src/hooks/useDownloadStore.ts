import { create } from 'zustand'
import type { DownloadConflictMode, DownloadSourceId } from '../lib/downloadConfig'
import type { Song } from '../pages/Library/Library'

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
  resultId?: string
  song?: Song
}

interface DownloadStore {
  transfers: TransferItem[]
  isTransfersOpen: boolean
  queueTransfer: (transfer: Omit<TransferItem, 'id' | 'createdAt'>) => string
  updateTransfer: (id: string, update: Partial<TransferItem>) => void
  setTransfersOpen: (isOpen: boolean) => void
  toggleTransfers: () => void
  removeTransfer: (id: string) => void
  clearTransfers: () => void
}

export const useDownloadStore = create<DownloadStore>((set) => ({
  transfers: [],
  isTransfersOpen: false,
  queueTransfer: (transfer) => {
    const id = `${transfer.source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({
      transfers: [{ ...transfer, id, createdAt: Date.now() }, ...state.transfers],
      isTransfersOpen: true
    }))
    return id
  },
  updateTransfer: (id, update) =>
    set((state) => ({
      transfers: state.transfers.map((transfer) =>
        transfer.id === id ? { ...transfer, ...update } : transfer
      )
    })),
  setTransfersOpen: (isTransfersOpen) => set({ isTransfersOpen }),
  toggleTransfers: () => set((state) => ({ isTransfersOpen: !state.isTransfersOpen })),
  removeTransfer: (id) =>
    set((state) => ({ transfers: state.transfers.filter((transfer) => transfer.id !== id) })),
  clearTransfers: () => set({ transfers: [] })
}))
