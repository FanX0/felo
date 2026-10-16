import { ipcMain } from 'electron'
import path, { resolve } from 'path'
import fs from 'fs'
import { LibraryService } from '../services/LibraryService'
import { getDb } from '../database'
import {
  validateWith,
  SafeFolderPathSchema,
  SafeEntityIdSchema
} from '../../shared/validators/ipcSchemas'

let currentScanAbortController: AbortController | null = null

export function registerLibraryIpc(): void {
  // Library: Scan a folder
  ipcMain.handle('library:scan', async (event, folderPath: string) => {
    try {
      const validatedPath = validateWith(SafeFolderPathSchema, folderPath)
      const resolved = resolve(validatedPath)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        console.warn('[Library] Folder does not exist or is not a directory:', resolved)
        if (!event.sender.isDestroyed()) {
          event.sender.send('library:scan-progress', {
            status: 'error',
            folderPath: resolved,
            folderName: path.basename(resolved),
            totalFiles: 0,
            processedFiles: 0,
            addedCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            percent: 0,
            error: 'Selected folder does not exist or is not a directory.'
          })
        }
        return 0
      }
      currentScanAbortController?.abort()
      const abortController = new AbortController()
      currentScanAbortController = abortController

      const onProgress = (progress: any) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('library:scan-progress', progress)
          }
        } catch {
          // window destroyed/closed
        }
      }

      try {
        return await LibraryService.scanFolder(resolved, onProgress, abortController.signal)
      } finally {
        if (currentScanAbortController === abortController) {
          currentScanAbortController = null
        }
      }
    } catch (err: any) {
      console.warn('[Library] Blocked invalid scan folder path:', err)
      if (!event.sender.isDestroyed()) {
        event.sender.send('library:scan-progress', {
          status: 'error',
          folderPath: typeof folderPath === 'string' ? folderPath : '',
          folderName: typeof folderPath === 'string' ? path.basename(folderPath) : 'Folder',
          totalFiles: 0,
          processedFiles: 0,
          addedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          percent: 0,
          error: err?.message || 'Folder path could not be validated.'
        })
      }
      return 0
    }
  })

  // Library: Cancel active scan
  ipcMain.handle('library:cancel-scan', async () => {
    if (currentScanAbortController) {
      currentScanAbortController.abort()
      currentScanAbortController = null
      return true
    }
    return false
  })

  // Library: Get all songs
  ipcMain.handle('library:getSongs', async () => {
    return await LibraryService.getSongs()
  })

  // Library: Read audio file buffer directly from local disk (for Listen Together cloud ingestion)
  ipcMain.handle(
    'library:readAudioFile',
    async (_event, songIdOrPath: string, explicitPath?: string) => {
      try {
        let filePath = explicitPath || songIdOrPath
        const db = getDb()

        if (songIdOrPath) {
          const row = db
            .prepare('SELECT filePath FROM songs WHERE id = ? OR filePath = ? COLLATE NOCASE LIMIT 1')
            .get(songIdOrPath, songIdOrPath) as { filePath?: string } | undefined
          if (row?.filePath) {
            filePath = row.filePath
          }
        }

        if (!filePath || filePath.startsWith('virtual:')) {
          return { success: false, error: 'File is virtual or missing' }
        }

        // Strip file:// prefix if present
        if (filePath.startsWith('file://')) {
          filePath = filePath.replace(/^file:\/\/\/?/i, '')
        }

        const resolved = resolve(filePath)
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found on disk: ${resolved}` }
        }

        const buffer = await fs.promises.readFile(resolved)
        const ext = path.extname(resolved).toLowerCase()
        const mimeMap: Record<string, string> = {
          '.mp3': 'audio/mpeg',
          '.flac': 'audio/flac',
          '.m4a': 'audio/mp4',
          '.aac': 'audio/aac',
          '.wav': 'audio/wav',
          '.ogg': 'audio/ogg',
          '.opus': 'audio/opus',
          '.webm': 'audio/webm'
        }

        return {
          success: true,
          data: buffer,
          contentType: mimeMap[ext] || 'audio/mpeg',
          size: buffer.byteLength
        }
      } catch (err: any) {
        console.error('[Main] readAudioFile error:', err)
        return { success: false, error: err?.message || String(err) }
      }
    }
  )

  // Library: Get roots
  ipcMain.handle('library:getRoots', () => {
    return LibraryService.getLibraryRoots()
  })

  // Library: Remove a root
  ipcMain.handle('library:removeRoot', (_, rootId: string) => {
    try {
      const validRootId = validateWith(SafeEntityIdSchema, rootId)
      LibraryService.removeLibraryRoot(validRootId)
    } catch (err) {
      console.warn('[Library] Blocked invalid root ID for removal:', err)
    }
  })

  // Library: Remove a song from the database only
  ipcMain.handle('library:removeSong', (_, songId: string) => {
    try {
      const validSongId = validateWith(SafeEntityIdSchema, songId)
      LibraryService.removeSong(validSongId)
    } catch (err) {
      console.warn('[Library] Blocked invalid song ID for removal:', err)
    }
  })

  // Library: Get artists
  ipcMain.handle('library:getArtists', () => {
    return LibraryService.getArtists()
  })

  // Library: Get albums
  ipcMain.handle('library:getAlbums', () => {
    return LibraryService.getAlbums()
  })

  // Library: Search songs
  ipcMain.handle('library:searchSongs', async (_, query: string) => {
    return await LibraryService.searchSongs(query)
  })

  // Library: Search artists
  ipcMain.handle('library:searchArtists', (_, query: string) => {
    return LibraryService.searchArtists(query)
  })

  // Library: Search albums
  ipcMain.handle('library:searchAlbums', (_, query: string) => {
    return LibraryService.searchAlbums(query)
  })
}
