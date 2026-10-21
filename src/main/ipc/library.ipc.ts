import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import path, { resolve } from 'path'
import fs from 'fs'
import { LibraryService } from '../services/LibraryService'
import { findFfmpegLocation } from '../services/DownloadService'
import { getDb } from '../database'
import {
  validateWith,
  SafeFolderPathSchema,
  SafeEntityIdSchema
} from '../../shared/validators/ipcSchemas'
import { resolveMediaPath } from '../protocols'

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

  // Library: Toggle song favorite (Like / Unlike)
  ipcMain.handle(
    'library:toggleFavorite',
    async (_, songId: string, isFavorite?: boolean, songData?: any) => {
      try {
        const validSongId = validateWith(SafeEntityIdSchema, songId)
        return await LibraryService.toggleFavorite(validSongId, isFavorite, songData)
      } catch {
        return { id: songId, isFavorite: false }
      }
    }
  )

  // Library: Get liked songs
  ipcMain.handle('library:getLikedSongs', async () => {
    return await LibraryService.getLikedSongs()
  })

  // Library: Get liked count
  ipcMain.handle('library:getLikedCount', async () => {
    return await LibraryService.getLikedCount()
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

        // Strip media:// and file:// prefix if present
        if (filePath.startsWith('media://')) {
          filePath = resolveMediaPath(filePath)
        } else if (filePath.startsWith('file://')) {
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

  // Library: Compress audio file to low-bitrate preview (64k MP3 or Opus) for rapid Listen Together join streaming
  ipcMain.handle(
    'library:compressAudio',
    async (
      _event,
      songIdOrPath: string,
      options?: { bitrate?: string; format?: string; explicitPath?: string }
    ) => {
      try {
        let filePath = options?.explicitPath || songIdOrPath
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

        if (filePath.startsWith('file://')) {
          filePath = filePath.replace(/^file:\/\/\/?/i, '')
        }

        const resolved = resolve(filePath)
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found on disk: ${resolved}` }
        }

        const ffmpegBin = findFfmpegLocation() || 'ffmpeg'

        const format = options?.format === 'opus' ? 'opus' : 'mp3'
        const bitrate = options?.bitrate || '256k'
        const tempOut = path.join(
          app.getPath('temp'),
          `felo-preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${format}`
        )

        const codecArgs =
          format === 'opus'
            ? ['-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-application', 'audio', '-ac', '2']
            : ['-c:a', 'libmp3lame', '-b:a', bitrate, '-q:a', '0', '-ac', '2']

        const args = ['-y', '-i', resolved, ...codecArgs, tempOut]

        await new Promise<void>((resolvePromise, rejectPromise) => {
          const proc = spawn(ffmpegBin, args, { windowsHide: true })
          let stderr = ''
          proc.stderr?.on('data', (d) => {
            stderr += d.toString()
          })
          proc.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempOut)) {
              resolvePromise()
            } else {
              rejectPromise(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`))
            }
          })
          proc.on('error', (err) => {
            rejectPromise(err)
          })
        })

        const buffer = await fs.promises.readFile(tempOut)
        try {
          await fs.promises.unlink(tempOut)
        } catch {}

        return {
          success: true,
          data: buffer,
          contentType: format === 'opus' ? 'audio/opus' : 'audio/mpeg',
          size: buffer.byteLength
        }
      } catch (err: any) {
        console.warn('[Main] compressAudio error:', err?.message || err)
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
