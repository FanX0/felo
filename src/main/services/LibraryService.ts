import fs from 'fs'
import path from 'path'
import * as mm from 'music-metadata'
import { getDb } from '../database'
import crypto from 'crypto'
import { ArtworkService } from './ArtworkService'
import { parseArtists, formatArtistsDisplay, getArtistId } from '../../shared/artistParser'

const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.wma']

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

export class LibraryService {
  private static readonly checkedSongArtworkIds = new Set<string>()

  static async importDownloadedFile(
    filePath: string,
    rootId?: string | null,
    metadataOverrides?: { title?: string; artist?: string; album?: string; artworkUrl?: string }
  ) {
    const resolvedPath = path.resolve(filePath)
    const db = getDb()
    const root = rootId
      ? (db.prepare('SELECT * FROM library_roots WHERE id = ?').get(rootId) as any)
      : (db
          .prepare('SELECT * FROM library_roots WHERE isActive = 1 ORDER BY dateAdded ASC LIMIT 1')
          .get() as any)
    const effectiveRootId =
      root?.id || crypto.createHash('md5').update(path.dirname(resolvedPath)).digest('hex')

    if (!root) {
      db.prepare('INSERT OR IGNORE INTO library_roots (id, path, label) VALUES (?, ?, ?)').run(
        effectiveRootId,
        path.dirname(resolvedPath),
        path.basename(path.dirname(resolvedPath))
      )
    }

    let metadata: any
    try {
      metadata = await mm.parseFile(resolvedPath)
    } catch (metaErr) {
      console.warn('music-metadata parsing warning, using fallback metadata:', metaErr)
      metadata = {
        common: {
          title: metadataOverrides?.title || path.basename(resolvedPath, path.extname(resolvedPath)),
          artist: metadataOverrides?.artist || 'Unknown Artist',
          album: metadataOverrides?.album || 'Unknown Album'
        },
        format: {
          duration: 0,
          bitrate: 0,
          sampleRate: 0,
          bitsPerSample: null,
          numberOfChannels: null,
          codec: null,
          container: path.extname(resolvedPath).replace('.', '')
        }
      }
    }
    const stats = fs.statSync(resolvedPath)
    const songId = crypto.createHash('md5').update(resolvedPath).digest('hex')
    const rawArtist = metadataOverrides?.artist || metadata.common.artist || 'Unknown Artist'
    const songTitle =
      metadataOverrides?.title || metadata.common.title || path.basename(resolvedPath, path.extname(resolvedPath))
    const parsedArtists = parseArtists(rawArtist, metadata.common.artists, songTitle)
    const primaryArtist = parsedArtists[0]?.name || rawArtist
    const displayArtist = formatArtistsDisplay(parsedArtists)
    const albumTitle = metadataOverrides?.album || metadata.common.album || 'Unknown Album'
    const albumArtist = metadata.common.albumartist || primaryArtist
    const artistId = getArtistId(primaryArtist)
    const albumId = crypto
      .createHash('md5')
      .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
      .digest('hex')

    let artworkPath = await ArtworkService.extractFromAudioFile(resolvedPath)
    if (!artworkPath && metadataOverrides?.artworkUrl) {
      artworkPath = await ArtworkService.fetchArtworkUrl(metadataOverrides.artworkUrl)
    }

    const insertArtistStmt = db.prepare('INSERT OR IGNORE INTO artists (id, name, sortName) VALUES (?, ?, ?)')
    const insertSongArtistStmt = db.prepare(
      'INSERT OR REPLACE INTO song_artists (songId, artistId, role, sortOrder) VALUES (?, ?, ?, ?)'
    )
    for (const a of parsedArtists) {
      const aId = getArtistId(a.name)
      insertArtistStmt.run(aId, a.name, a.name.toLowerCase())
    }

    db.prepare('INSERT OR IGNORE INTO albums (id, title, artistId, year) VALUES (?, ?, ?, ?)').run(
      albumId,
      albumTitle,
      artistId,
      metadata.common.year || null
    )
    db.prepare(
      `
      INSERT OR REPLACE INTO songs (
        id, title, artist, artistId, album, albumId, trackNumber, discNumber, genre,
        duration, filePath, rootId, size, bitrate, sampleRate, bitDepth, channels,
        codec, container, artworkPath
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      songId,
      songTitle,
      displayArtist,
      artistId,
      albumTitle,
      albumId,
      metadata.common.track?.no || null,
      metadata.common.disk?.no || null,
      metadata.common.genre?.[0] || null,
      metadata.format.duration ? Math.floor(metadata.format.duration) : 0,
      resolvedPath,
      effectiveRootId,
      stats.size,
      metadata.format.bitrate || 0,
      metadata.format.sampleRate || 0,
      metadata.format.bitsPerSample || null,
      metadata.format.numberOfChannels || null,
      metadata.format.codec || null,
      metadata.format.container || null,
      artworkPath
    )

    db.prepare('DELETE FROM song_artists WHERE songId = ?').run(songId)
    for (let i = 0; i < parsedArtists.length; i++) {
      const a = parsedArtists[i]
      insertSongArtistStmt.run(songId, getArtistId(a.name), a.role, i)
    }

    if (artworkPath) {
      db.prepare('UPDATE albums SET artworkPath = COALESCE(artworkPath, ?) WHERE id = ?').run(
        artworkPath,
        albumId
      )
    }
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as any
    if (song) {
      song.artists = parsedArtists.map((a) => ({
        id: getArtistId(a.name),
        name: a.name,
        role: a.role
      }))
    }
    return song
  }

  static async replaceSongFile(
    songId: string,
    filePath: string,
    metadataOverrides?: { title?: string; artist?: string; album?: string; artworkUrl?: string }
  ) {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as any
    if (!existing) throw new Error('The library song being replaced no longer exists.')
    const resolvedPath = path.resolve(filePath)
    let metadata: any
    try {
      metadata = await mm.parseFile(resolvedPath)
    } catch (metaErr) {
      console.warn('music-metadata parsing warning in replaceSongFile, using fallback metadata:', metaErr)
      metadata = {
        common: {
          title: metadataOverrides?.title || existing.title || path.basename(resolvedPath, path.extname(resolvedPath)),
          artist: metadataOverrides?.artist || existing.artist || 'Unknown Artist',
          album: metadataOverrides?.album || existing.album || 'Unknown Album'
        },
        format: {
          duration: existing.duration || 0,
          bitrate: existing.bitrate || 0,
          sampleRate: existing.sampleRate || 0,
          bitsPerSample: existing.bitDepth || null,
          numberOfChannels: existing.channels || null,
          codec: existing.codec || null,
          container: path.extname(resolvedPath).replace('.', '')
        }
      }
    }
    const stats = fs.statSync(resolvedPath)

    const rawTitle = metadata.common.title || metadataOverrides?.title
    const title =
      (rawTitle && rawTitle.trim()) ||
      path.basename(resolvedPath, path.extname(resolvedPath)) ||
      existing.title

    const rawArtist =
      (metadata.common.artist && metadata.common.artist !== 'Unknown Artist'
        ? metadata.common.artist
        : undefined) ||
      (metadataOverrides?.artist && metadataOverrides.artist !== 'Unknown Artist'
        ? metadataOverrides.artist
        : undefined) ||
      metadata.common.artist ||
      metadataOverrides?.artist ||
      existing.artist ||
      'Unknown Artist'
    const artistName = rawArtist.trim()

    const rawAlbum =
      metadata.common.album ||
      metadataOverrides?.album ||
      existing.album ||
      'Unknown Album'
    const albumTitle = rawAlbum.trim()

    const parsedArtists = parseArtists(artistName, metadata.common.artists, title)
    const primaryArtist = parsedArtists[0]?.name || artistName
    const displayArtist = formatArtistsDisplay(parsedArtists)

    const albumArtist = metadata.common.albumartist || primaryArtist
    const artistId = getArtistId(primaryArtist)
    const albumId = crypto
      .createHash('md5')
      .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
      .digest('hex')

    let artworkPath = await ArtworkService.extractFromAudioFile(resolvedPath)
    if (!artworkPath && ArtworkService.isValidArtworkFile(existing.artworkPath)) {
      artworkPath = existing.artworkPath
    }
    if (!artworkPath && metadataOverrides?.artworkUrl) {
      artworkPath = await ArtworkService.fetchArtworkUrl(metadataOverrides.artworkUrl)
    }

    const replace = db.transaction(() => {
      for (const a of parsedArtists) {
        const aId = getArtistId(a.name)
        db.prepare('INSERT OR IGNORE INTO artists (id, name, sortName) VALUES (?, ?, ?)').run(
          aId,
          a.name,
          a.name.toLowerCase()
        )
      }
      db.prepare(
        'INSERT OR IGNORE INTO albums (id, title, artistId, year) VALUES (?, ?, ?, ?)'
      ).run(albumId, albumTitle, artistId, metadata.common.year || null)
      if (artworkPath) {
        db.prepare('UPDATE albums SET artworkPath = COALESCE(artworkPath, ?) WHERE id = ?').run(
          artworkPath,
          albumId
        )
      }
      db.prepare(
        `
        UPDATE songs SET
          title = ?, artist = ?, artistId = ?, album = ?, albumId = ?, trackNumber = ?,
          discNumber = ?, genre = ?, duration = ?, filePath = ?, size = ?, bitrate = ?,
          sampleRate = ?, bitDepth = ?, channels = ?, codec = ?, container = ?, artworkPath = ?
        WHERE id = ?
      `
      ).run(
        title,
        displayArtist,
        artistId,
        albumTitle,
        albumId,
        metadata.common.track?.no || existing.trackNumber,
        metadata.common.disk?.no || existing.discNumber,
        metadata.common.genre?.[0] || existing.genre,
        metadata.format.duration ? Math.floor(metadata.format.duration) : existing.duration,
        resolvedPath,
        stats.size,
        metadata.format.bitrate || 0,
        metadata.format.sampleRate || 0,
        metadata.format.bitsPerSample || null,
        metadata.format.numberOfChannels || null,
        metadata.format.codec || null,
        metadata.format.container || null,
        artworkPath,
        songId
      )

      db.prepare('DELETE FROM song_artists WHERE songId = ?').run(songId)
      const insertSongArtist = db.prepare(
        'INSERT OR REPLACE INTO song_artists (songId, artistId, role, sortOrder) VALUES (?, ?, ?, ?)'
      )
      for (let i = 0; i < parsedArtists.length; i++) {
        const a = parsedArtists[i]
        insertSongArtist.run(songId, getArtistId(a.name), a.role, i)
      }
    })
    replace()
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as any
    if (song) {
      song.artists = parsedArtists.map((a) => ({
        id: getArtistId(a.name),
        name: a.name,
        role: a.role
      }))
    }
    return song
  }

  private static async getAllAudioFilesAsync(
    dirPath: string,
    onDiscovered?: (count: number) => void,
    signal?: AbortSignal
  ): Promise<string[]> {
    const audioFiles: string[] = []
    const queue: string[] = [dirPath]

    while (queue.length > 0) {
      if (signal?.aborted) break
      const currentDir = queue.shift()!
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          if (signal?.aborted) break
          const fullPath = path.join(currentDir, entry.name)
          if (entry.isDirectory()) {
            if (
              !entry.name.startsWith('.') &&
              entry.name !== 'node_modules' &&
              entry.name !== '$RECYCLE.BIN' &&
              entry.name !== 'System Volume Information'
            ) {
              queue.push(fullPath)
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (SUPPORTED_EXTENSIONS.includes(ext)) {
              audioFiles.push(fullPath)
              if (onDiscovered && audioFiles.length % 25 === 0) {
                onDiscovered(audioFiles.length)
              }
            }
          }
        }
      } catch {
        // Skip inaccessible folders
      }
    }
    if (onDiscovered) onDiscovered(audioFiles.length)
    return audioFiles
  }

  /**
   * Scan a folder recursively, extract metadata, and insert into the database.
   * Also registers the folder as a library root if not already present.
   * Reports live progress, supports incremental caching and graceful cancellation.
   */
  static async scanFolder(
    folderPath: string,
    onProgress?: (progress: LibraryScanProgress) => void,
    signal?: AbortSignal
  ): Promise<number> {
    const db = getDb()
    const normalizedPath = path.resolve(folderPath)
    const folderName = path.basename(normalizedPath)

    // Register library root
    const rootId = crypto.createHash('md5').update(normalizedPath).digest('hex')
    db.prepare(
      `
      INSERT OR IGNORE INTO library_roots (id, path, label)
      VALUES (?, ?, ?)
    `
    ).run(rootId, normalizedPath, folderName)

    const startTime = Date.now()
    let lastProgressEmit = 0

    const emitProgress = (
      status: LibraryScanProgress['status'],
      totalFiles: number,
      processedFiles: number,
      addedCount: number,
      updatedCount: number,
      skippedCount: number,
      currentFile?: string,
      currentTrack?: { title: string; artist: string },
      force = false,
      error?: string
    ) => {
      const now = Date.now()
      if (!force && now - lastProgressEmit < 80) return
      lastProgressEmit = now

      const percent = totalFiles > 0 ? Math.min(100, Math.round((processedFiles / totalFiles) * 100)) : 0
      const elapsedMs = now - startTime
      const speed = elapsedMs > 500 && processedFiles > 0 ? processedFiles / (elapsedMs / 1000) : undefined
      const remainingFiles = Math.max(0, totalFiles - processedFiles)
      const estimatedRemainingMs =
        speed && speed > 0 && remainingFiles > 0 ? Math.round((remainingFiles / speed) * 1000) : undefined

      onProgress?.({
        status,
        folderPath: normalizedPath,
        folderName,
        totalFiles,
        processedFiles,
        addedCount,
        updatedCount,
        skippedCount,
        currentFile,
        currentTrack,
        percent,
        speed: speed ? Math.round(speed * 10) / 10 : undefined,
        elapsedMs,
        estimatedRemainingMs,
        error
      })
    }

    emitProgress('discovering', 0, 0, 0, 0, 0, undefined, undefined, true)

    // 1. Asynchronous non-blocking file discovery
    const audioFiles = await this.getAllAudioFilesAsync(
      normalizedPath,
      (count) => {
        emitProgress('discovering', count, 0, 0, 0, 0, undefined, undefined, false)
      },
      signal
    )

    if (signal?.aborted) {
      emitProgress('cancelled', audioFiles.length, 0, 0, 0, 0, undefined, undefined, true)
      return 0
    }

    if (audioFiles.length === 0) {
      emitProgress('completed', 0, 0, 0, 0, 0, undefined, undefined, true)
      return 0
    }

    // 2. Incremental Cache Lookup: Map existing songs in this root
    const existingSongs = db
      .prepare('SELECT id, filePath, size, dateAdded FROM songs WHERE rootId = ?')
      .all(rootId) as Array<{ id: string; filePath: string; size: number; dateAdded: number }>
    const existingMap = new Map<string, { id: string; size: number; dateAdded: number }>()
    for (const song of existingSongs) {
      existingMap.set(path.resolve(song.filePath), song)
    }

    const songStmt = db.prepare(`
      INSERT INTO songs (
        id, title, artist, album, trackNumber, discNumber, genre,
        duration, filePath, rootId, size, bitrate, sampleRate,
        bitDepth, channels, codec, container, artworkPath, dateAdded
      ) VALUES (
        @id, @title, @artist, @album, @trackNumber, @discNumber, @genre,
        @duration, @filePath, @rootId, @size, @bitrate, @sampleRate,
        @bitDepth, @channels, @codec, @container, @artworkPath, @dateAdded
      )
      ON CONFLICT(filePath) DO UPDATE SET
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        trackNumber = excluded.trackNumber,
        discNumber = excluded.discNumber,
        genre = excluded.genre,
        duration = excluded.duration,
        size = excluded.size,
        bitrate = excluded.bitrate,
        sampleRate = excluded.sampleRate,
        bitDepth = excluded.bitDepth,
        channels = excluded.channels,
        codec = excluded.codec,
        container = excluded.container,
        artworkPath = COALESCE(excluded.artworkPath, songs.artworkPath)
    `)

    const artistStmt = db.prepare(`
      INSERT OR IGNORE INTO artists (id, name, sortName)
      VALUES (?, ?, ?)
    `)

    const albumStmt = db.prepare(`
      INSERT OR IGNORE INTO albums (id, title, artistId, year)
      VALUES (?, ?, ?, ?)
    `)

    const updateSongArtistAlbum = db.prepare(`
      UPDATE songs SET artistId = ?, albumId = ? WHERE id = ?
    `)
    const updateAlbumArtwork = db.prepare(`
      UPDATE albums
      SET artworkPath = COALESCE(artworkPath, ?)
      WHERE id = ?
    `)

    const songArtistStmt = db.prepare(`
      INSERT OR REPLACE INTO song_artists (songId, artistId, role, sortOrder)
      VALUES (?, ?, ?, ?)
    `)
    const clearSongArtistsStmt = db.prepare(`
      DELETE FROM song_artists WHERE songId = ?
    `)

    let processedFiles = 0
    let addedCount = 0
    let updatedCount = 0
    let skippedCount = 0
    let pendingBatch: any[] = []

    const flushBatch = () => {
      if (pendingBatch.length === 0) return
      const batchToCommit = [...pendingBatch]
      pendingBatch = []
      const insertTransaction = db.transaction(() => {
        for (const item of batchToCommit) {
          if (Array.isArray(item.artists)) {
            for (const a of item.artists) {
              artistStmt.run(a.id, a.name, a.name.toLowerCase())
            }
          } else {
            artistStmt.run(item.artistId, item.artistName, item.artistName.toLowerCase())
          }
          albumStmt.run(item.albumId, item.albumTitle, item.artistId, item.year)
          songStmt.run(item.song)
          updateSongArtistAlbum.run(item.artistId, item.albumId, item.songId)
          if (item.song.artworkPath) {
            updateAlbumArtwork.run(item.song.artworkPath, item.albumId)
          }
          if (Array.isArray(item.artists) && item.artists.length > 0) {
            clearSongArtistsStmt.run(item.songId)
            for (let i = 0; i < item.artists.length; i++) {
              const a = item.artists[i]
              songArtistStmt.run(item.songId, a.id, a.role, i)
            }
          }
        }
      })
      insertTransaction()
    }

    emitProgress('indexing', audioFiles.length, 0, 0, 0, 0, undefined, undefined, true)

    // 3. Concurrent Worker Pool for metadata parsing & batch saving
    let nextIndex = 0
    const workerCount = Math.min(6, audioFiles.length)

    const worker = async () => {
      while (nextIndex < audioFiles.length) {
        if (signal?.aborted) break
        const currentIndex = nextIndex++
        const file = audioFiles[currentIndex]
        const resolvedFilePath = path.resolve(file)
        const baseFileName = path.basename(file)

        try {
          const stats = await fs.promises.stat(resolvedFilePath)
          const existing = existingMap.get(resolvedFilePath)

          // Check if file is completely unchanged (mtime & size match)
          const fileMtimeSec = Math.floor((stats.mtimeMs || stats.ctimeMs || 0) / 1000)
          if (existing && existing.size === stats.size && fileMtimeSec <= existing.dateAdded) {
            skippedCount++
            processedFiles++
            emitProgress(
              'indexing',
              audioFiles.length,
              processedFiles,
              addedCount,
              updatedCount,
              skippedCount,
              baseFileName
            )
            continue
          }

          // Read metadata with duration and artwork
          const metadata = await mm.parseFile(resolvedFilePath)
          const songId = existing?.id || crypto.createHash('md5').update(resolvedFilePath).digest('hex')

          const rawArtist = (metadata.common.artist || 'Unknown Artist').trim()
          const title = (metadata.common.title || path.basename(file, path.extname(file))).trim()
          const parsedArtists = parseArtists(rawArtist, metadata.common.artists, title)
          const primaryArtist = parsedArtists[0]?.name || rawArtist
          const displayArtist = formatArtistsDisplay(parsedArtists)
          const albumTitle = (metadata.common.album || 'Unknown Album').trim()
          const albumArtist = (metadata.common.albumartist || primaryArtist).trim()
          const year = metadata.common.year || null

          const artistId = getArtistId(primaryArtist)
          const albumId = crypto
            .createHash('md5')
            .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
            .digest('hex')

          const artistsList = parsedArtists.map((a) => ({
            id: getArtistId(a.name),
            name: a.name,
            role: a.role
          }))

          // Extract artwork directly from already-parsed metadata picture buffer
          let artworkPath: string | null = null
          if (metadata.common.picture?.[0]?.data?.length) {
            const pic = metadata.common.picture[0]
            const buffer = Buffer.from(pic.data)
            const ext = ArtworkService.detectImageExtension(buffer) || 'jpg'
            artworkPath = ArtworkService.saveArtworkBuffer(buffer, ext)
          }

          const dateAdded = Math.floor((stats.birthtimeMs || stats.mtimeMs || Date.now()) / 1000)

          pendingBatch.push({
            songId,
            artistId,
            artistName: primaryArtist,
            artists: artistsList,
            albumId,
            albumTitle,
            albumArtist,
            year,
            song: {
              id: songId,
              title,
              artist: displayArtist,
              album: albumTitle,
              trackNumber: metadata.common.track?.no || null,
              discNumber: metadata.common.disk?.no || null,
              genre: metadata.common.genre?.[0] || null,
              duration: metadata.format.duration ? Math.floor(metadata.format.duration) : 0,
              filePath: resolvedFilePath,
              rootId,
              size: stats.size,
              bitrate: metadata.format.bitrate || 0,
              sampleRate: metadata.format.sampleRate || 0,
              bitDepth: metadata.format.bitsPerSample || null,
              channels: metadata.format.numberOfChannels || null,
              codec: metadata.format.codec || null,
              container: metadata.format.container || null,
              artworkPath,
              dateAdded
            }
          })

          if (existing) {
            updatedCount++
          } else {
            addedCount++
          }

          if (pendingBatch.length >= 50) {
            flushBatch()
          }

          processedFiles++
          emitProgress(
            'indexing',
            audioFiles.length,
            processedFiles,
            addedCount,
            updatedCount,
            skippedCount,
            baseFileName,
            { title, artist: displayArtist }
          )
        } catch (err) {
          console.warn(`Error parsing audio file ${file}:`, err)
          processedFiles++
          skippedCount++
          emitProgress(
            'indexing',
            audioFiles.length,
            processedFiles,
            addedCount,
            updatedCount,
            skippedCount,
            baseFileName
          )
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))

    // Commit any remaining items
    if (pendingBatch.length > 0) {
      emitProgress('committing', audioFiles.length, processedFiles, addedCount, updatedCount, skippedCount, undefined, undefined, true)
      flushBatch()
    }

    if (signal?.aborted) {
      emitProgress('cancelled', audioFiles.length, processedFiles, addedCount, updatedCount, skippedCount, undefined, undefined, true)
      return addedCount + updatedCount
    }

    emitProgress('completed', audioFiles.length, processedFiles, addedCount, updatedCount, skippedCount, undefined, undefined, true)
    return addedCount + updatedCount + skippedCount
  }

  static attachSongArtists(songs: any[]) {
    if (!songs || songs.length === 0) return songs
    const db = getDb()
    try {
      const rows = db
        .prepare(
          `
        SELECT sa.songId, sa.artistId as id, sa.role, sa.sortOrder, a.name
        FROM song_artists sa
        JOIN artists a ON sa.artistId = a.id
        ORDER BY sa.sortOrder ASC
      `
        )
        .all() as Array<{
        songId: string
        id: string
        role: 'primary' | 'featured'
        sortOrder: number
        name: string
      }>

      const artistMap = new Map<string, Array<{ id: string; name: string; role: 'primary' | 'featured' }>>()
      for (const row of rows) {
        let list = artistMap.get(row.songId)
        if (!list) {
          list = []
          artistMap.set(row.songId, list)
        }
        list.push({ id: row.id, name: row.name, role: row.role })
      }

      for (const song of songs) {
        const directArtists = artistMap.get(song.id)
        if (directArtists && directArtists.length > 0) {
          song.artists = directArtists
        } else if (song.artist) {
          const parsed = parseArtists(song.artist, undefined, song.title)
          song.artists = parsed.map((a) => ({
            id: getArtistId(a.name),
            name: a.name,
            role: a.role
          }))
        } else {
          song.artists = []
        }
      }
    } catch (err) {
      console.warn('Error attaching song artists:', err)
      for (const song of songs) {
        if (!song.artists && song.artist) {
          song.artists = [{ id: song.artistId, name: song.artist, role: 'primary' }]
        }
      }
    }
    return songs
  }

  static async getSongs() {
    const songs = getDb()
      .prepare(
        "SELECT * FROM songs WHERE filePath NOT LIKE 'virtual:%' ORDER BY dateAdded DESC, rowid DESC"
      )
      .all() as any[]
    this.attachSongArtists(songs)
    void this.backfillMissingArtwork(songs)
    return songs
  }

  static getArtists() {
    return getDb()
      .prepare(
        `
      SELECT a.*, COUNT(DISTINCT s.id) as songCount
      FROM artists a
      LEFT JOIN song_artists sa ON sa.artistId = a.id
      LEFT JOIN songs s ON (s.id = sa.songId OR s.artistId = a.id) AND s.filePath NOT LIKE 'virtual:%'
      GROUP BY a.id
      HAVING songCount > 0
      ORDER BY a.name ASC
    `
      )
      .all()
  }

  static getAlbums() {
    return getDb()
      .prepare(
        `
      SELECT al.*, ar.name as artistName, COUNT(s.id) as songCount
      FROM albums al
      LEFT JOIN artists ar ON al.artistId = ar.id
      LEFT JOIN songs s ON s.albumId = al.id AND s.filePath NOT LIKE 'virtual:%'
      GROUP BY al.id
      HAVING songCount > 0
      ORDER BY al.title ASC
    `
      )
      .all()
  }

  static getLibraryRoots() {
    return getDb()
      .prepare(
        `
      SELECT lr.*, COUNT(s.id) as songCount
      FROM library_roots lr
      LEFT JOIN songs s ON s.rootId = lr.id AND s.filePath NOT LIKE 'virtual:%'
      GROUP BY lr.id
      ORDER BY lr.dateAdded DESC
    `
      )
      .all()
  }

  static removeLibraryRoot(rootId: string) {
    const db = getDb()
    const deleteRoot = db.transaction(() => {
      // Delete songs associated with this root
      db.prepare('DELETE FROM songs WHERE rootId = ?').run(rootId)
      // Delete the root itself
      db.prepare('DELETE FROM library_roots WHERE id = ?').run(rootId)
      // Clean up orphaned artists and albums
      db.prepare(
        'DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artistId FROM songs WHERE artistId IS NOT NULL)'
      ).run()
      db.prepare(
        'DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT albumId FROM songs WHERE albumId IS NOT NULL)'
      ).run()
    })
    deleteRoot()
  }

  static relinkVirtualSong(songId: string, replacementSongId: string): void {
    if (!songId || !replacementSongId || songId === replacementSongId) return
    const db = getDb()
    const virtualSong = db.prepare('SELECT filePath FROM songs WHERE id = ?').get(songId) as any
    if (!String(virtualSong?.filePath || '').startsWith('virtual:')) return

    const relink = db.transaction(() => {
      db.prepare('UPDATE OR IGNORE playlist_items SET songId = ? WHERE songId = ?').run(
        replacementSongId,
        songId
      )
      db.prepare('DELETE FROM playlist_items WHERE songId = ?').run(songId)
      db.prepare('DELETE FROM play_events WHERE songId = ?').run(songId)
      db.prepare('DELETE FROM songs WHERE id = ?').run(songId)
    })
    relink()
  }

  static removeSong(songId: string) {
    const db = getDb()
    const deleteSong = db.transaction(() => {
      db.prepare('DELETE FROM playlist_items WHERE songId = ?').run(songId)
      db.prepare('DELETE FROM play_events WHERE songId = ?').run(songId)
      db.prepare('DELETE FROM songs WHERE id = ?').run(songId)
      db.prepare(
        'DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artistId FROM songs WHERE artistId IS NOT NULL)'
      ).run()
      db.prepare(
        'DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT albumId FROM songs WHERE albumId IS NOT NULL)'
      ).run()
    })
    deleteSong()
  }

  static async searchSongs(query: string) {
    const db = getDb()
    const trimmed = query.trim()
    if (!trimmed) return []

    const pattern = `%${trimmed}%`
    const prefixPattern = `${trimmed}%`
    const exact = trimmed.toLowerCase()
    const tokens = trimmed.split(/\s+/).filter(Boolean)

    let sql = `
      SELECT DISTINCT s.* FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.songId
      LEFT JOIN artists a ON sa.artistId = a.id
      WHERE (
        s.title LIKE ?
        OR s.artist LIKE ?
        OR s.album LIKE ?
        OR s.genre LIKE ?
        OR a.name LIKE ?
        OR (COALESCE(s.artist, '') || ' ' || COALESCE(s.title, '')) LIKE ?
        OR (COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '')) LIKE ?
        OR (COALESCE(s.album, '') || ' ' || COALESCE(s.title, '')) LIKE ?
    `
    const params: any[] = [
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      pattern
    ]

    if (tokens.length > 1) {
      sql += ` OR (`
      sql += tokens
        .map(
          () =>
            `(COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '') || ' ' || COALESCE(s.album, '') || ' ' || COALESCE(a.name, '')) LIKE ?`
        )
        .join(' AND ')
      sql += `)`
      tokens.forEach((t) => params.push(`%${t}%`))
    }

    sql += `)
      ORDER BY
        CASE
          WHEN lower(s.title) = ? THEN 0
          WHEN lower(COALESCE(s.artist, '') || ' ' || COALESCE(s.title, '')) = ? THEN 1
          WHEN lower(COALESCE(s.title, '') || ' ' || COALESCE(s.artist, '')) = ? THEN 1
          WHEN lower(s.title) LIKE ? THEN 2
          WHEN lower(s.artist) = ? THEN 3
          WHEN lower(COALESCE(s.artist, '') || ' ' || COALESCE(s.title, '')) LIKE ? THEN 4
          WHEN lower(s.artist) LIKE ? THEN 5
          WHEN lower(coalesce(s.album, '')) = ? THEN 6
          WHEN lower(coalesce(s.album, '')) LIKE ? THEN 7
          ELSE 8
        END ASC,
        s.playCount DESC,
        s.title ASC
      LIMIT 100
    `

    params.push(
      exact,
      exact,
      exact,
      prefixPattern,
      exact,
      prefixPattern,
      exact,
      prefixPattern
    )

    const songs = db.prepare(sql).all(...params) as any[]
    this.attachSongArtists(songs)
    void this.backfillMissingArtwork(songs)
    return songs
  }

  static searchArtists(query: string) {
    const db = getDb()
    const trimmed = query.trim()
    if (!trimmed) return []

    const pattern = `%${trimmed}%`
    const prefixPattern = `${trimmed}%`
    const exact = trimmed.toLowerCase()

    return db
      .prepare(
        `
      SELECT a.*, COUNT(DISTINCT s.id) as songCount
      FROM artists a
      LEFT JOIN song_artists sa ON sa.artistId = a.id
      LEFT JOIN songs s ON (s.id = sa.songId OR s.artistId = a.id) AND s.filePath NOT LIKE 'virtual:%'
      WHERE a.name LIKE ?
      GROUP BY a.id
      ORDER BY
        CASE
          WHEN lower(a.name) = ? THEN 0
          WHEN lower(a.name) LIKE ? THEN 1
          ELSE 2
        END ASC,
        songCount DESC,
        a.name ASC
      LIMIT 30
    `
      )
      .all(pattern, exact, prefixPattern)
  }

  static searchAlbums(query: string) {
    const db = getDb()
    const trimmed = query.trim()
    if (!trimmed) return []

    const pattern = `%${trimmed}%`
    const prefixPattern = `${trimmed}%`
    const exact = trimmed.toLowerCase()
    const tokens = trimmed.split(/\s+/).filter(Boolean)

    let sql = `
      SELECT al.*, ar.name as artistName, COUNT(s.id) as songCount
      FROM albums al
      LEFT JOIN artists ar ON al.artistId = ar.id
      LEFT JOIN songs s ON s.albumId = al.id AND s.filePath NOT LIKE 'virtual:%'
      WHERE (
        al.title LIKE ?
        OR ar.name LIKE ?
        OR (COALESCE(ar.name, '') || ' ' || COALESCE(al.title, '')) LIKE ?
        OR (COALESCE(al.title, '') || ' ' || COALESCE(ar.name, '')) LIKE ?
    `
    const params: any[] = [pattern, pattern, pattern, pattern]

    if (tokens.length > 1) {
      sql += ` OR (`
      sql += tokens
        .map(() => `(COALESCE(al.title, '') || ' ' || COALESCE(ar.name, '')) LIKE ?`)
        .join(' AND ')
      sql += `)`
      tokens.forEach((t) => params.push(`%${t}%`))
    }

    sql += `)
      GROUP BY al.id
      HAVING songCount > 0
      ORDER BY
        CASE
          WHEN lower(al.title) = ? THEN 0
          WHEN lower(COALESCE(ar.name, '') || ' ' || COALESCE(al.title, '')) = ? THEN 1
          WHEN lower(COALESCE(al.title, '') || ' ' || COALESCE(ar.name, '')) = ? THEN 1
          WHEN lower(al.title) LIKE ? THEN 2
          WHEN lower(coalesce(ar.name, '')) = ? THEN 3
          WHEN lower(coalesce(ar.name, '')) LIKE ? THEN 4
          ELSE 5
        END ASC,
        songCount DESC,
        al.title ASC
      LIMIT 30
    `

    params.push(exact, exact, exact, prefixPattern, exact, prefixPattern)

    return db.prepare(sql).all(...params)
  }

  private static async backfillMissingArtwork(songs: any[]) {
    const missing = songs.filter(
      (song) =>
        !this.checkedSongArtworkIds.has(song.id) &&
        !ArtworkService.isValidArtworkFile(song.artworkPath) &&
        Boolean(song.filePath)
    )
    if (missing.length === 0) return

    // Heal up to 5 tracks per cycle to keep library queries non-blocking
    for (const song of missing.slice(0, 5)) {
      this.checkedSongArtworkIds.add(song.id)
      try {
        const resolved = await ArtworkService.verifyAndEnrichTrackArtwork({
          filePath: song.filePath,
          title: song.title,
          artist: song.artist,
          album: song.album,
          songId: song.id,
          albumId: song.albumId
        })
        if (resolved) {
          song.artworkPath = resolved
        }
      } catch (err) {
        console.warn(`Error healing artwork for ${song.filePath}:`, err)
      }
    }
  }


}
