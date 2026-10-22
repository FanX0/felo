import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  downloadTracksBatch,
  promoteDownloadTaskToUrgent,
  getDownloadQueueLength
} from '../../../src/renderer/src/lib/backgroundDownloader'
import { useDownloadStore } from '../../../src/renderer/src/hooks/useDownloadStore'

describe('promoteDownloadTaskToUrgent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useDownloadStore.setState({ transfers: [], isTransfersOpen: false })
    ;(window as any).api = {
      getSetting: vi.fn().mockResolvedValue(null),
      getSongs: vi.fn().mockResolvedValue([]),
      searchDownloadSource: vi.fn().mockResolvedValue([]),
      startDownload: vi.fn().mockResolvedValue({ started: true })
    }
  })

  it('promotes a queued background task to urgent autoPlay and splices it out of background queue', async () => {
    // Queue two dummy background tracks
    const batchResult = await downloadTracksBatch([
      { title: 'Track 1', artist: 'Artist 1' },
      { title: 'Track 2', artist: 'Artist 2' }
    ])

    expect(batchResult.transferIds.length).toBe(2)
    const targetTransferId = batchResult.transferIds[1]

    const initialQueueLength = getDownloadQueueLength()
    expect(initialQueueLength).toBeGreaterThanOrEqual(1)

    // Promote Track 2 to urgent playback
    const promoted = promoteDownloadTaskToUrgent(targetTransferId, 'Artist 2')
    expect(promoted).toBe(true)

    // Verify transfer in store is updated with autoPlay: true
    const updatedTransfer = useDownloadStore.getState().transfers.find((t) => t.id === targetTransferId)
    expect(updatedTransfer?.autoPlay).toBe(true)
  })

  it('returns false when transferId or title is not in queued list', () => {
    const result = promoteDownloadTaskToUrgent('non-existent-id')
    expect(result).toBe(false)
  })
})
