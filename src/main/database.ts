import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs'
import { parseArtists, getArtistId } from '../shared/artistParser'

const appDataPath = app.getPath('appData')
if (process.env.NODE_ENV === 'test') {
  app.setName('Felo-Test')
} else {
  app.setName('Felo')
}
const feloUserDataPath =
  process.env.NODE_ENV === 'test'
    ? join(appDataPath, 'felo-test')
    : join(appDataPath, 'felo')
const legacyUserDataPath = join(appDataPath, 'fanxmusic-temp')

if (!fs.existsSync(feloUserDataPath) && fs.existsSync(legacyUserDataPath)) {
  fs.cpSync(legacyUserDataPath, feloUserDataPath, { recursive: true })
} else {
  fs.mkdirSync(feloUserDataPath, { recursive: true })
}

const copiedLegacyDatabasePath = join(feloUserDataPath, 'fanxmusic.db')
const originalLegacyDatabasePath = join(legacyUserDataPath, 'fanxmusic.db')
const dbPath = join(feloUserDataPath, 'felo.db')
const databaseMigrationMarker = join(feloUserDataPath, '.felo-database-migrated')
const databaseMigrationSource = fs.existsSync(copiedLegacyDatabasePath)
  ? copiedLegacyDatabasePath
  : originalLegacyDatabasePath

if (!fs.existsSync(databaseMigrationMarker) && fs.existsSync(databaseMigrationSource)) {
  let legacyDb: Database.Database | null = null
  try {
    legacyDb = new Database(databaseMigrationSource)
    const checkpoint = legacyDb.pragma('wal_checkpoint(FULL)') as Array<{ busy?: number }>
    if (checkpoint.some((result) => Number(result.busy || 0) > 0)) {
      throw new Error('The legacy database is still busy.')
    }
    legacyDb.close()
    legacyDb = null

    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${dbPath}${suffix}`
      if (fs.existsSync(target)) fs.unlinkSync(target)
    }
    fs.copyFileSync(databaseMigrationSource, dbPath)
    fs.writeFileSync(databaseMigrationMarker, new Date().toISOString(), 'utf8')

    for (const suffix of ['', '-wal', '-shm']) {
      const redundantCopy = `${copiedLegacyDatabasePath}${suffix}`
      if (fs.existsSync(redundantCopy)) fs.unlinkSync(redundantCopy)
    }
  } catch (error) {
    legacyDb?.close()
    console.warn('Felo could not complete the legacy database migration yet:', error)
  }
}

if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(feloUserDataPath, { recursive: true })
}

app.setPath('userData', feloUserDataPath)
const db = new Database(dbPath)

// Enable WAL mode for better concurrent read performance and tuned SQLite performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma('temp_store = MEMORY')
db.pragma('cache_size = -64000')

// Migration: Check if the songs table exists and needs new columns
try {
  const tableInfo = db.pragma('table_info(songs)') as any[]
  if (tableInfo.length > 0) {
    const hasRootId = tableInfo.some((col) => col.name === 'rootId')
    if (!hasRootId) {
      // Add missing columns from the old schema
      db.exec(`
        ALTER TABLE songs ADD COLUMN artistId TEXT;
        ALTER TABLE songs ADD COLUMN albumId TEXT;
        ALTER TABLE songs ADD COLUMN trackNumber INTEGER;
        ALTER TABLE songs ADD COLUMN discNumber INTEGER;
        ALTER TABLE songs ADD COLUMN genre TEXT;
        ALTER TABLE songs ADD COLUMN rootId TEXT;
        ALTER TABLE songs ADD COLUMN bitDepth INTEGER;
        ALTER TABLE songs ADD COLUMN channels INTEGER;
        ALTER TABLE songs ADD COLUMN codec TEXT;
        ALTER TABLE songs ADD COLUMN container TEXT;
        ALTER TABLE songs ADD COLUMN isFavorite INTEGER DEFAULT 0;
        ALTER TABLE songs ADD COLUMN playCount INTEGER DEFAULT 0;
        ALTER TABLE songs ADD COLUMN lastPlayedAt INTEGER;
      `)
    }
    const hasSize = tableInfo.some((col) => col.name === 'size')
    if (!hasSize) {
      db.exec('ALTER TABLE songs ADD COLUMN size INTEGER DEFAULT 0;')
    }
    const hasBitrate = tableInfo.some((col) => col.name === 'bitrate')
    if (!hasBitrate) {
      db.exec('ALTER TABLE songs ADD COLUMN bitrate INTEGER DEFAULT 0;')
    }
    const hasSampleRate = tableInfo.some((col) => col.name === 'sampleRate')
    if (!hasSampleRate) {
      db.exec('ALTER TABLE songs ADD COLUMN sampleRate INTEGER DEFAULT 0;')
    }
    const hasArtworkPath = tableInfo.some((col) => col.name === 'artworkPath')
    if (!hasArtworkPath) {
      db.exec('ALTER TABLE songs ADD COLUMN artworkPath TEXT;')
    }
  }
} catch (err) {
  console.error('Migration error:', err)
}

// Initialize schema with proper relational tables
db.exec(`
  -- Library roots the user has authorized
  CREATE TABLE IF NOT EXISTS library_roots (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    label TEXT,
    isActive INTEGER DEFAULT 1,
    dateAdded INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Artists
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sortName TEXT,
    dateAdded INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

  -- Albums
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artistId TEXT,
    year INTEGER,
    artworkPath TEXT,
    dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (artistId) REFERENCES artists(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);
  CREATE INDEX IF NOT EXISTS idx_albums_artistId ON albums(artistId);

  -- Songs (tracks mapped to physical files)
  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT,
    artistId TEXT,
    album TEXT,
    albumId TEXT,
    trackNumber INTEGER,
    discNumber INTEGER,
    genre TEXT,
    duration INTEGER DEFAULT 0,
    filePath TEXT UNIQUE NOT NULL,
    rootId TEXT,
    size INTEGER DEFAULT 0,
    bitrate INTEGER DEFAULT 0,
    sampleRate INTEGER DEFAULT 0,
    bitDepth INTEGER,
    channels INTEGER,
    codec TEXT,
    container TEXT,
    artworkPath TEXT,
    isFavorite INTEGER DEFAULT 0,
    playCount INTEGER DEFAULT 0,
    lastPlayedAt INTEGER,
    dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (artistId) REFERENCES artists(id) ON DELETE SET NULL,
    FOREIGN KEY (albumId) REFERENCES albums(id) ON DELETE SET NULL,
    FOREIGN KEY (rootId) REFERENCES library_roots(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
  CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
  CREATE INDEX IF NOT EXISTS idx_songs_artistId ON songs(artistId);
  CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
  CREATE INDEX IF NOT EXISTS idx_songs_albumId ON songs(albumId);
  CREATE INDEX IF NOT EXISTS idx_songs_isFavorite ON songs(isFavorite);
  CREATE INDEX IF NOT EXISTS idx_songs_filePath ON songs(filePath);
  CREATE INDEX IF NOT EXISTS idx_songs_rootId ON songs(rootId);

  -- Playlists
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    artworkPath TEXT,
    isSmartPlaylist INTEGER DEFAULT 0,
    smartRules TEXT,
    dateCreated INTEGER DEFAULT (strftime('%s', 'now')),
    dateModified INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Playlist items
  CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlistId TEXT NOT NULL,
    songId TEXT NOT NULL,
    sortOrder INTEGER DEFAULT 0,
    dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (playlistId) REFERENCES playlists(id) ON DELETE CASCADE,
    FOREIGN KEY (songId) REFERENCES songs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_playlist_items_playlistId ON playlist_items(playlistId);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_songId ON playlist_items(songId);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_order ON playlist_items(playlistId, sortOrder);

  -- Play events (local listening history)
  CREATE TABLE IF NOT EXISTS play_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    songId TEXT NOT NULL,
    startedAt INTEGER NOT NULL,
    endedAt INTEGER,
    completionPercent REAL DEFAULT 0,
    FOREIGN KEY (songId) REFERENCES songs(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_play_events_songId ON play_events(songId);
  CREATE INDEX IF NOT EXISTS idx_play_events_startedAt ON play_events(startedAt);

  -- App settings
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Lyrics cache
  CREATE TABLE IF NOT EXISTS lyrics_cache (
    id TEXT PRIMARY KEY,
    trackName TEXT,
    artistName TEXT,
    plainLyrics TEXT,
    syncedLyrics TEXT,
    instrumental INTEGER DEFAULT 0,
    source TEXT,
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lyrics_cache_lookup ON lyrics_cache(trackName, artistName);

  -- Song Artists junction table for Many-to-Many tracks to artists (Spotify-style)
  CREATE TABLE IF NOT EXISTS song_artists (
    songId TEXT NOT NULL,
    artistId TEXT NOT NULL,
    role TEXT DEFAULT 'primary',
    sortOrder INTEGER DEFAULT 0,
    PRIMARY KEY (songId, artistId),
    FOREIGN KEY (songId) REFERENCES songs(id) ON DELETE CASCADE,
    FOREIGN KEY (artistId) REFERENCES artists(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_song_artists_artistId ON song_artists(artistId);
  CREATE INDEX IF NOT EXISTS idx_song_artists_songId ON song_artists(songId);
`)

// Migration: Backfill song_artists junction table for existing songs
try {
  const songArtistCount = db.prepare('SELECT COUNT(*) as count FROM song_artists').get() as
    | { count: number }
    | undefined
  const totalSongs = db
    .prepare("SELECT COUNT(*) as count FROM songs WHERE filePath NOT LIKE 'virtual:%'")
    .get() as { count: number } | undefined

  if ((songArtistCount?.count || 0) === 0 && (totalSongs?.count || 0) > 0) {
    const allSongs = db.prepare('SELECT id, title, artist, artistId FROM songs').all() as Array<{
      id: string
      title: string
      artist: string | null
      artistId: string | null
    }>

    const insertArtist = db.prepare(
      'INSERT OR IGNORE INTO artists (id, name, sortName) VALUES (?, ?, ?)'
    )
    const insertSongArtist = db.prepare(
      'INSERT OR IGNORE INTO song_artists (songId, artistId, role, sortOrder) VALUES (?, ?, ?, ?)'
    )

    const migrateTx = db.transaction(() => {
      for (const song of allSongs) {
        if (!song.artist) continue
        const parsed = parseArtists(song.artist, undefined, song.title)
        parsed.forEach((artist, index) => {
          const artistId = getArtistId(artist.name)
          insertArtist.run(artistId, artist.name, artist.name.toLowerCase())
          insertSongArtist.run(song.id, artistId, artist.role, index)
        })
      }
    })
    migrateTx()
  }

  // Ensure any songs with artistId that are missing in song_artists are linked
  db.exec(`
    INSERT OR IGNORE INTO song_artists (songId, artistId, role, sortOrder)
    SELECT id, artistId, 'primary', 0 FROM songs
    WHERE artistId IS NOT NULL AND id NOT IN (SELECT songId FROM song_artists);
  `)
} catch (migErr) {
  console.warn('Error during song_artists backfill migration:', migErr)
}

const legacyArtworkPrefix = join(legacyUserDataPath, 'artwork')
const feloArtworkPrefix = join(feloUserDataPath, 'artwork')
db.prepare(
  `UPDATE songs SET artworkPath = REPLACE(artworkPath, ?, ?) WHERE artworkPath LIKE ?`
).run(legacyArtworkPrefix, feloArtworkPrefix, `${legacyArtworkPrefix}%`)
db.prepare(
  `UPDATE albums SET artworkPath = REPLACE(artworkPath, ?, ?) WHERE artworkPath LIKE ?`
).run(legacyArtworkPrefix, feloArtworkPrefix, `${legacyArtworkPrefix}%`)

// Seed default library root if none exist
try {
  const rootCount = db.prepare('SELECT COUNT(*) as count FROM library_roots').get() as any
  if (rootCount?.count === 0) {
    const crypto = require('crypto')
    const musicDir = app.getPath('music') || app.getPath('documents')
    const defaultPath = join(musicDir, 'Felo')
    if (!fs.existsSync(defaultPath)) {
      try {
        fs.mkdirSync(defaultPath, { recursive: true })
      } catch {}
    }
    const rootId = crypto.createHash('md5').update(defaultPath).digest('hex')
    db.prepare(
      'INSERT OR IGNORE INTO library_roots (id, path, label, isActive) VALUES (?, ?, ?, 1)'
    ).run(rootId, defaultPath, 'Default Music')
  }
} catch (err) {
  console.error('Error seeding default library root:', err)
}

export function getDb() {
  return db
}

export interface PlayRecordInput {
  songId: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  completedPercent?: number
  startedAt?: number
  endedAt?: number
}

export function recordPlayEvent(input: PlayRecordInput): { success: boolean; playCount: number } {
  const startedAt = input.startedAt || Math.floor(Date.now() / 1000)
  const endedAt = input.endedAt || Math.floor(Date.now() / 1000)
  const completedPercent = typeof input.completedPercent === 'number' ? input.completedPercent : 1.0

  try {
    // 1. Check if the song exists in local SQLite
    const existingSong = db.prepare('SELECT id, playCount FROM songs WHERE id = ?').get(input.songId) as
      | { id: string; playCount: number }
      | undefined

    if (existingSong) {
      // Increment play count & update lastPlayedAt
      db.prepare(
        'UPDATE songs SET playCount = COALESCE(playCount, 0) + 1, lastPlayedAt = ? WHERE id = ?'
      ).run(endedAt, input.songId)

      // Insert play event ledger entry
      db.prepare(
        'INSERT INTO play_events (songId, startedAt, endedAt, completionPercent) VALUES (?, ?, ?, ?)'
      ).run(input.songId, startedAt, endedAt, completedPercent)

      return { success: true, playCount: (existingSong.playCount || 0) + 1 }
    }

    // 2. If it's an online or un-indexed song, insert a virtual entry so FK constraint holds
    const safeTitle = (input.title || 'Unknown Track').trim()
    const safeArtist = (input.artist || 'Unknown Artist').trim()
    const safeAlbum = (input.album || '').trim()
    const safeDuration = Number(input.duration) || 0
    const virtualPath = `virtual:${input.songId}`

    db.prepare(`
      INSERT INTO songs (id, title, artist, album, duration, filePath, playCount, lastPlayedAt, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        playCount = COALESCE(songs.playCount, 0) + 1,
        lastPlayedAt = excluded.lastPlayedAt
    `).run(input.songId, safeTitle, safeArtist, safeAlbum, safeDuration, virtualPath, endedAt, endedAt)

    db.prepare(
      'INSERT INTO play_events (songId, startedAt, endedAt, completionPercent) VALUES (?, ?, ?, ?)'
    ).run(input.songId, startedAt, endedAt, completedPercent)

    return { success: true, playCount: 1 }
  } catch (error) {
    console.error('Failed to record play event in SQLite:', error)
    return { success: false, playCount: 0 }
  }
}

function attachArtistsToSongList(songs: any[]) {
  if (!songs || songs.length === 0) return songs
  try {
    const songIds = songs.map((s) => s?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (songIds.length === 0) return songs
    const placeholders = songIds.map(() => '?').join(',')
    const rows = db
      .prepare(
        `
      SELECT sa.songId, sa.artistId as id, sa.role, sa.sortOrder, a.name
      FROM song_artists sa
      JOIN artists a ON sa.artistId = a.id
      WHERE sa.songId IN (${placeholders})
      ORDER BY sa.sortOrder ASC
    `
      )
      .all(...songIds) as Array<{ songId: string; id: string; role: 'primary' | 'featured'; name: string }>

    const map = new Map<string, Array<{ id: string; name: string; role: 'primary' | 'featured' }>>()
    for (const r of rows) {
      let list = map.get(r.songId)
      if (!list) {
        list = []
        map.set(r.songId, list)
      }
      list.push({ id: r.id, name: r.name, role: r.role })
    }
    for (const s of songs) {
      if (!s) continue
      s.artists = map.get(s.id) || (s.artist ? [{ name: s.artist, role: 'primary' }] : [])
    }
  } catch (e) {
    console.warn('Error attaching artists in database.ts:', e)
  }
  return songs
}

export function getListeningHistory(limit = 50) {
  try {
    const recent = db.prepare(`
      SELECT s.*, pe.startedAt, pe.completionPercent
      FROM play_events pe
      JOIN songs s ON pe.songId = s.id
      ORDER BY pe.startedAt DESC
      LIMIT ?
    `).all(limit) as any[]

    const topTracks = db.prepare(`
      SELECT * FROM songs
      WHERE playCount > 0
      ORDER BY playCount DESC, lastPlayedAt DESC
      LIMIT ?
    `).all(limit) as any[]

    attachArtistsToSongList(recent)
    attachArtistsToSongList(topTracks)

    const topArtists = db.prepare(`
      SELECT COALESCE(a.name, s.artist) as artist, SUM(s.playCount) as playCount
      FROM songs s
      LEFT JOIN song_artists sa ON s.id = sa.songId
      LEFT JOIN artists a ON sa.artistId = a.id
      WHERE s.playCount > 0 AND (a.name IS NOT NULL OR (s.artist IS NOT NULL AND TRIM(s.artist) != ''))
      GROUP BY COALESCE(a.name, s.artist)
      ORDER BY playCount DESC
      LIMIT 20
    `).all()

    const totalStats = db.prepare(`
      SELECT COUNT(*) as totalPlays, COUNT(DISTINCT songId) as totalTracks
      FROM play_events
    `).get() as { totalPlays: number; totalTracks: number } | undefined

    return {
      recent: recent || [],
      topTracks: topTracks || [],
      topArtists: topArtists || [],
      totalPlays: totalStats?.totalPlays || 0,
      totalTracks: totalStats?.totalTracks || 0
    }
  } catch (error) {
    console.error('Failed to query listening history from SQLite:', error)
    return {
      recent: [],
      topTracks: [],
      topArtists: [],
      totalPlays: 0,
      totalTracks: 0
    }
  }
}

