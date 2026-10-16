import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'

describe('Main Process: SQLite Database Schema & Pragmas', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')

    db.exec(`
      CREATE TABLE IF NOT EXISTS library_roots (
        id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        label TEXT,
        isActive INTEGER DEFAULT 1,
        dateAdded INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sortName TEXT,
        dateAdded INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artistId TEXT,
        year INTEGER,
        artworkPath TEXT,
        dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (artistId) REFERENCES artists(id) ON DELETE SET NULL
      );

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

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        coverArt TEXT,
        dateCreated INTEGER DEFAULT (strftime('%s', 'now')),
        dateModified INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS playlist_songs (
        playlistId TEXT NOT NULL,
        songId TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (playlistId, songId, position),
        FOREIGN KEY (playlistId) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (songId) REFERENCES songs(id) ON DELETE CASCADE
      );
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('enforces foreign key constraints', () => {
    const pragma = db.pragma('foreign_keys', { simple: true })
    expect(pragma).toBe(1)
  })

  it('inserts and queries songs and artists with relations', () => {
    db.prepare('INSERT INTO artists (id, name) VALUES (?, ?)').run('art-1', 'The Weeknd')
    db.prepare('INSERT INTO albums (id, title, artistId) VALUES (?, ?, ?)').run('alb-1', 'After Hours', 'art-1')
    db.prepare(`
      INSERT INTO songs (id, title, artist, artistId, album, albumId, duration, filePath)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('s-1', 'Blinding Lights', 'The Weeknd', 'art-1', 'After Hours', 'alb-1', 200, 'D:\\Music\\bl.flac')

    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get('s-1') as any
    expect(song.title).toBe('Blinding Lights')
    expect(song.artistId).toBe('art-1')
    expect(song.albumId).toBe('alb-1')
  })

  it('rejects duplicate file paths due to UNIQUE constraint', () => {
    db.prepare(`
      INSERT INTO songs (id, title, filePath) VALUES (?, ?, ?)
    `).run('s-1', 'Song 1', 'C:\\track.mp3')

    expect(() => {
      db.prepare(`
        INSERT INTO songs (id, title, filePath) VALUES (?, ?, ?)
      `).run('s-2', 'Song 2', 'C:\\track.mp3')
    }).toThrow(/UNIQUE constraint failed/)
  })

  it('cascades delete on playlist_songs when playlist is deleted', () => {
    db.prepare('INSERT INTO songs (id, title, filePath) VALUES (?, ?, ?)').run('s-1', 'Song 1', 'C:\\track.mp3')
    db.prepare('INSERT INTO playlists (id, name) VALUES (?, ?)').run('p-1', 'Favorites')
    db.prepare('INSERT INTO playlist_songs (playlistId, songId, position) VALUES (?, ?, ?)').run('p-1', 's-1', 0)

    expect(db.prepare('SELECT COUNT(*) as count FROM playlist_songs').get()).toEqual({ count: 1 })

    db.prepare('DELETE FROM playlists WHERE id = ?').run('p-1')
    expect(db.prepare('SELECT COUNT(*) as count FROM playlist_songs').get()).toEqual({ count: 0 })
  })
})
