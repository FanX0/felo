import fs from 'fs'
import path from 'path'
import * as mm from 'music-metadata'
import { getDb } from '../database'
import crypto from 'crypto'
import { app } from 'electron'

const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.wma']
const ARTWORK_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

export class LibraryService {
  static async importDownloadedFile(filePath: string, rootId?: string | null) {
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

    const metadata = await mm.parseFile(resolvedPath)
    const stats = fs.statSync(resolvedPath)
    const songId = crypto.createHash('md5').update(resolvedPath).digest('hex')
    const artistName = metadata.common.artist || 'Unknown Artist'
    const albumTitle = metadata.common.album || 'Unknown Album'
    const albumArtist = metadata.common.albumartist || artistName
    const artistId = crypto.createHash('md5').update(artistName.toLowerCase()).digest('hex')
    const albumId = crypto
      .createHash('md5')
      .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
      .digest('hex')
    const artworkPath = this.extractArtwork(metadata.common.picture)

    db.prepare('INSERT OR IGNORE INTO artists (id, name, sortName) VALUES (?, ?, ?)').run(
      artistId,
      artistName,
      artistName.toLowerCase()
    )
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
      metadata.common.title || path.basename(resolvedPath, path.extname(resolvedPath)),
      artistName,
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
    return db.prepare('SELECT * FROM songs WHERE id = ?').get(songId)
  }

  static async replaceSongFile(songId: string, filePath: string) {
    const db = getDb()
    const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(songId) as any
    if (!existing) throw new Error('The library song being replaced no longer exists.')
    const resolvedPath = path.resolve(filePath)
    const metadata = await mm.parseFile(resolvedPath)
    const stats = fs.statSync(resolvedPath)
    const artistName = metadata.common.artist || existing.artist || 'Unknown Artist'
    const albumTitle = metadata.common.album || existing.album || 'Unknown Album'
    const albumArtist = metadata.common.albumartist || artistName
    const artistId = crypto.createHash('md5').update(artistName.toLowerCase()).digest('hex')
    const albumId = crypto
      .createHash('md5')
      .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
      .digest('hex')
    const artworkPath = this.extractArtwork(metadata.common.picture) || existing.artworkPath

    const replace = db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO artists (id, name, sortName) VALUES (?, ?, ?)').run(
        artistId,
        artistName,
        artistName.toLowerCase()
      )
      db.prepare(
        'INSERT OR IGNORE INTO albums (id, title, artistId, year) VALUES (?, ?, ?, ?)'
      ).run(albumId, albumTitle, artistId, metadata.common.year || null)
      db.prepare(
        `
        UPDATE songs SET
          title = ?, artist = ?, artistId = ?, album = ?, albumId = ?, trackNumber = ?,
          discNumber = ?, genre = ?, duration = ?, filePath = ?, size = ?, bitrate = ?,
          sampleRate = ?, bitDepth = ?, channels = ?, codec = ?, container = ?, artworkPath = ?
        WHERE id = ?
      `
      ).run(
        metadata.common.title || existing.title,
        artistName,
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
    })
    replace()
    return db.prepare('SELECT * FROM songs WHERE id = ?').get(songId)
  }

  /**
   * Scan a folder recursively, extract metadata, and insert into the database.
   * Also registers the folder as a library root if not already present.
   */
  static async scanFolder(folderPath: string): Promise<number> {
    const db = getDb()
    const normalizedPath = path.resolve(folderPath)

    // Register library root
    const rootId = crypto.createHash('md5').update(normalizedPath).digest('hex')
    db.prepare(
      `
      INSERT OR IGNORE INTO library_roots (id, path, label)
      VALUES (?, ?, ?)
    `
    ).run(rootId, normalizedPath, path.basename(normalizedPath))

    // Collect all audio files
    const audioFiles = this.getAllFiles(normalizedPath).filter((f) =>
      SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase())
    )

    const songStmt = db.prepare(`
      INSERT OR REPLACE INTO songs (
        id, title, artist, album, trackNumber, discNumber, genre,
        duration, filePath, rootId, size, bitrate, sampleRate,
        bitDepth, channels, codec, container, artworkPath
      ) VALUES (
        @id, @title, @artist, @album, @trackNumber, @discNumber, @genre,
        @duration, @filePath, @rootId, @size, @bitrate, @sampleRate,
        @bitDepth, @channels, @codec, @container, @artworkPath
      )
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

    let count = 0
    const parsedSongs: any[] = []

    for (const file of audioFiles) {
      try {
        const metadata = await mm.parseFile(file)
        const stats = fs.statSync(file)
        const songId = crypto.createHash('md5').update(file).digest('hex')

        const artistName = metadata.common.artist || 'Unknown Artist'
        const albumTitle = metadata.common.album || 'Unknown Album'
        const albumArtist = metadata.common.albumartist || artistName
        const year = metadata.common.year || null

        const artistId = crypto.createHash('md5').update(artistName.toLowerCase()).digest('hex')
        const albumId = crypto
          .createHash('md5')
          .update(`${albumArtist.toLowerCase()}::${albumTitle.toLowerCase()}`)
          .digest('hex')
        const artworkPath = this.extractArtwork(metadata.common.picture)

        parsedSongs.push({
          songId,
          artistId,
          artistName,
          albumId,
          albumTitle,
          albumArtist,
          year,
          song: {
            id: songId,
            title: metadata.common.title || path.basename(file, path.extname(file)),
            artist: artistName,
            album: albumTitle,
            trackNumber: metadata.common.track?.no || null,
            discNumber: metadata.common.disk?.no || null,
            genre: metadata.common.genre?.[0] || null,
            duration: metadata.format.duration ? Math.floor(metadata.format.duration) : 0,
            filePath: file,
            rootId,
            size: stats.size,
            bitrate: metadata.format.bitrate || 0,
            sampleRate: metadata.format.sampleRate || 0,
            bitDepth: metadata.format.bitsPerSample || null,
            channels: metadata.format.numberOfChannels || null,
            codec: metadata.format.codec || null,
            container: metadata.format.container || null,
            artworkPath
          }
        })
        count++
      } catch (err) {
        console.error(`Error parsing ${file}:`, err)
      }
    }

    // Insert everything in a single transaction
    const insertAll = db.transaction(() => {
      for (const item of parsedSongs) {
        // Upsert artist
        artistStmt.run(item.artistId, item.artistName, item.artistName.toLowerCase())
        // Upsert album
        albumStmt.run(item.albumId, item.albumTitle, item.artistId, item.year)
        // Insert song
        songStmt.run(item.song)
        // Link song → artist + album
        updateSongArtistAlbum.run(item.artistId, item.albumId, item.songId)
        if (item.song.artworkPath) {
          updateAlbumArtwork.run(item.song.artworkPath, item.albumId)
        }
      }
    })
    insertAll()

    return count
  }

  static async getSongs() {
    const songs = getDb()
      .prepare(
        "SELECT * FROM songs WHERE filePath NOT LIKE 'virtual:%' ORDER BY artist ASC, album ASC, trackNumber ASC, title ASC"
      )
      .all() as any[]
    await this.backfillMissingArtwork(songs)
    return songs
  }

  static getArtists() {
    return getDb()
      .prepare(
        `
      SELECT a.*, COUNT(s.id) as songCount
      FROM artists a
      LEFT JOIN songs s ON s.artistId = a.id AND s.filePath NOT LIKE 'virtual:%'
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
    return getDb().prepare('SELECT * FROM library_roots ORDER BY dateAdded DESC').all()
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
    const pattern = `%${query}%`
    const songs = db
      .prepare(
        `
      SELECT * FROM songs
      WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR genre LIKE ?
      ORDER BY artist ASC, title ASC
      LIMIT 100
    `
      )
      .all(pattern, pattern, pattern, pattern) as any[]
    await this.backfillMissingArtwork(songs)
    return songs
  }

  private static extractArtwork(pictures?: mm.IPicture[]): string | null {
    const picture = pictures?.[0]
    if (!picture?.data?.length) return null

    const extension = ARTWORK_EXTENSIONS[picture.format?.toLowerCase()] || 'jpg'
    const data = Buffer.from(picture.data)
    const hash = crypto.createHash('sha1').update(data).digest('hex')
    const artworkDir = path.join(app.getPath('userData'), 'artwork')
    const artworkPath = path.join(artworkDir, `${hash}.${extension}`)

    fs.mkdirSync(artworkDir, { recursive: true })
    if (!fs.existsSync(artworkPath)) {
      fs.writeFileSync(artworkPath, data)
    }

    return artworkPath
  }

  private static async backfillMissingArtwork(songs: any[]) {
    const missing = songs.filter(
      (song) => !song.artworkPath && song.filePath && fs.existsSync(song.filePath)
    )
    if (missing.length === 0) return

    const db = getDb()
    const updateSongArtwork = db.prepare('UPDATE songs SET artworkPath = ? WHERE id = ?')
    const updateAlbumArtwork = db.prepare(`
      UPDATE albums
      SET artworkPath = COALESCE(artworkPath, ?)
      WHERE id = ?
    `)

    for (const song of missing) {
      try {
        const metadata = await mm.parseFile(song.filePath, { duration: false })
        const artworkPath = this.extractArtwork(metadata.common.picture)
        if (!artworkPath) continue

        updateSongArtwork.run(artworkPath, song.id)
        if (song.albumId) {
          updateAlbumArtwork.run(artworkPath, song.albumId)
        }
        song.artworkPath = artworkPath
      } catch (err) {
        console.error(`Error extracting artwork from ${song.filePath}:`, err)
      }
    }
  }

  private static getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
    try {
      const files = fs.readdirSync(dirPath)
      for (const file of files) {
        const fullPath = path.join(dirPath, file)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.isDirectory()) {
            this.getAllFiles(fullPath, arrayOfFiles)
          } else {
            arrayOfFiles.push(fullPath)
          }
        } catch {
          // Skip inaccessible files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
    return arrayOfFiles
  }
}
