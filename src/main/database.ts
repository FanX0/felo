import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs'

const appDataPath = app.getPath('appData')
app.setName('Felo')
const feloUserDataPath = join(appDataPath, 'felo')
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

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

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
  CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
  CREATE INDEX IF NOT EXISTS idx_songs_album ON songs(album);
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

  -- App settings
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
  );
`)

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
    const path = require('path')
    const defaultPath = path.resolve('C:\\Users\\farid\\OneDrive\\Documents\\Felo_Songs\\downloads')
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
