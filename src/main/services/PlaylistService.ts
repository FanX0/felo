import crypto from 'crypto'
import { getDb } from '../database'

export interface CreatePlaylistInput {
  name: string
  description?: string
  songIds?: string[]
}

export class PlaylistService {
  static getPlaylists() {
    return getDb()
      .prepare(
        `
        SELECT
          p.*,
          COUNT(pi.id) AS songCount,
          COALESCE(
            p.artworkPath,
            (
              SELECT s.artworkPath
              FROM playlist_items cover_item
              JOIN songs s ON s.id = cover_item.songId
              WHERE cover_item.playlistId = p.id AND s.artworkPath IS NOT NULL
              ORDER BY cover_item.sortOrder ASC, cover_item.dateAdded ASC
              LIMIT 1
            )
          ) AS artworkPath
        FROM playlists p
        LEFT JOIN playlist_items pi ON pi.playlistId = p.id
        GROUP BY p.id
        ORDER BY p.dateModified DESC, p.dateCreated DESC
      `
      )
      .all()
  }

  static getPlaylist(playlistId: string) {
    const playlist = getDb()
      .prepare(
        `
        SELECT
          p.*,
          COUNT(pi.id) AS songCount,
          COALESCE(
            p.artworkPath,
            (
              SELECT s.artworkPath
              FROM playlist_items cover_item
              JOIN songs s ON s.id = cover_item.songId
              WHERE cover_item.playlistId = p.id AND s.artworkPath IS NOT NULL
              ORDER BY cover_item.sortOrder ASC, cover_item.dateAdded ASC
              LIMIT 1
            )
          ) AS artworkPath
        FROM playlists p
        LEFT JOIN playlist_items pi ON pi.playlistId = p.id
        WHERE p.id = ?
        GROUP BY p.id
      `
      )
      .get(playlistId) as any

    if (!playlist) return null

    playlist.songs = getDb()
      .prepare(
        `
        SELECT s.*, pi.dateAdded AS playlistDateAdded, pi.sortOrder AS playlistSortOrder
        FROM playlist_items pi
        JOIN songs s ON s.id = pi.songId
        WHERE pi.playlistId = ?
        ORDER BY pi.sortOrder ASC, pi.dateAdded ASC
      `
      )
      .all(playlistId)

    return playlist
  }

  static createPlaylist(input: CreatePlaylistInput) {
    const name = input.name.trim()
    if (!name) throw new Error('Playlist name is required')

    const id = crypto.randomUUID()
    const db = getDb()
    const songIds = [...new Set(input.songIds || [])]
    const create = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO playlists (id, name, description)
          VALUES (?, ?, ?)
        `
      ).run(id, name, input.description?.trim() || null)

      const insertItem = db.prepare(
        `
          INSERT INTO playlist_items (id, playlistId, songId, sortOrder)
          SELECT ?, ?, id, ? FROM songs WHERE id = ?
        `
      )
      songIds.forEach((songId, index) => insertItem.run(crypto.randomUUID(), id, index, songId))
    })
    create()

    return this.getPlaylist(id)
  }

  static deletePlaylist(playlistId: string) {
    getDb().prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
  }

  static addSong(playlistId: string, songId: string) {
    const db = getDb()
    const exists = db
      .prepare('SELECT 1 FROM playlist_items WHERE playlistId = ? AND songId = ?')
      .get(playlistId, songId)
    if (exists) return this.getPlaylist(playlistId)

    const order = db
      .prepare(
        'SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM playlist_items WHERE playlistId = ?'
      )
      .get(playlistId) as { nextOrder: number }

    const addSong = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO playlist_items (id, playlistId, songId, sortOrder)
        VALUES (?, ?, ?, ?)
      `
      ).run(crypto.randomUUID(), playlistId, songId, order.nextOrder)
      db.prepare("UPDATE playlists SET dateModified = strftime('%s', 'now') WHERE id = ?").run(
        playlistId
      )
    })
    addSong()

    return this.getPlaylist(playlistId)
  }

  static removeSong(playlistId: string, songId: string) {
    const db = getDb()
    const removeSong = db.transaction(() => {
      db.prepare('DELETE FROM playlist_items WHERE playlistId = ? AND songId = ?').run(
        playlistId,
        songId
      )
      db.prepare("UPDATE playlists SET dateModified = strftime('%s', 'now') WHERE id = ?").run(
        playlistId
      )
    })
    removeSong()

    return this.getPlaylist(playlistId)
  }
}
