import { ipcMain } from 'electron'
import { DownloadService } from '../services/DownloadService'
import {
  validateWith,
  StartDownloadRequestSchema,
  TransferIdSchema
} from '../../shared/validators/ipcSchemas'

export function registerDownloadsIpc(): void {
  ipcMain.handle(
    'downloads:search',
    async (
      _,
      source: 'qobuz' | 'deezer' | 'soulseek' | 'youtube',
      query: string,
      accounts: any
    ) => {
      if (
        source !== 'qobuz' &&
        source !== 'deezer' &&
        source !== 'soulseek' &&
        source !== 'youtube'
      ) {
        throw new Error(`The ${source} download connector is not available.`)
      }
      return DownloadService.search(source, query, accounts || {})
    }
  )

  ipcMain.handle('downloads:start', (_, request: any) => {
    const validatedRequest = validateWith(StartDownloadRequestSchema, request)
    return DownloadService.start(validatedRequest)
  })

  ipcMain.handle('downloads:cancel', (_, transferId: string) => {
    try {
      const validTransferId = validateWith(TransferIdSchema, transferId)
      return DownloadService.cancel(validTransferId)
    } catch {
      return false
    }
  })

  ipcMain.handle('downloads:checkDependencies', async () => {
    return DownloadService.checkDependencies()
  })

  ipcMain.handle('downloads:installDependencies', async (event) => {
    return DownloadService.installDependencies((chunk) => {
      event.sender.send('downloads:installLog', chunk)
    })
  })

  ipcMain.handle('downloads:acquireAndDownload', async (_, query: string, artist?: string) => {
    return DownloadService.acquireAndDownload(query, artist)
  })
}
