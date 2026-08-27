import crypto from 'crypto'
import { getDb } from '../database'

export interface CreatePlaylistTrackInput {
  title: string
  artist?: string
  album?: string
  duration?: number
  matchedSongId?: string
  coverArt?: string
}

export interface CreatePlaylistInput {
  name: string
  description?: string
  songIds?: string[]
  tracks?: CreatePlaylistTrackInput[]
}

function normalizeMatching(value?: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|audio|lyrics|hd|4k|remastered|remaster)\s*$/gi,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findMatchingLocalSong(title: string, artist: string, localSongs: any[]): any | undefined {
  const normTargetTitle = normalizeMatching(title)
  const normTargetArtist = normalizeMatching(artist)
  if (!normTargetTitle) return undefined

  const targetFull = normalizeMatching(`${artist} ${title}`)
  const targetFullRev = normalizeMatching(`${title} ${artist}`)

  return localSongs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false
    const normLocalTitle = normalizeMatching(song.title || '')
    const normLocalArtist = normalizeMatching(song.artist || '')
    if (!normLocalTitle) return false

    if (normLocalTitle === normTargetTitle) {
      if (!normTargetArtist || !normLocalArtist || normLocalArtist === normTargetArtist) return true
      if (normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist)) return true
    }

    const localFull = normalizeMatching(`${song.artist || ''} ${song.title || ''}`)
    const localFullRev = normalizeMatching(`${song.title || ''} ${song.artist || ''}`)
    if (
      localFull === targetFull ||
      localFull === targetFullRev ||
      localFullRev === targetFull ||
      localFullRev === targetFullRev
    ) {
      return true
    }

    if (normTargetTitle.length >= 3 && normLocalTitle.includes(normTargetTitle)) {
      if (
        !normTargetArtist ||
        !normLocalArtist ||
        normLocalArtist === normTargetArtist ||
        normLocalTitle.includes(normTargetArtist) ||
        normTargetArtist.includes(normLocalArtist) ||
        normLocalArtist.includes(normTargetArtist)
      ) {
        return true
      }
    }
    return false
  })
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

    const playlistSongs = getDb()
      .prepare(
        `
        SELECT s.*, pi.dateAdded AS playlistDateAdded, pi.sortOrder AS playlistSortOrder
        FROM playlist_items pi
        JOIN songs s ON s.id = pi.songId
        WHERE pi.playlistId = ?
        ORDER BY pi.sortOrder ASC, pi.dateAdded ASC
      `
      )
      .all(playlistId) as any[]

    const db = getDb()
    const allLocalSongs = db
      .prepare("SELECT * FROM songs WHERE filePath IS NOT NULL AND filePath NOT LIKE 'virtual:%'")
      .all() as any[]

    for (let i = 0; i < playlistSongs.length; i++) {
      const s = playlistSongs[i]
      if (s.filePath && String(s.filePath).startsWith('virtual:')) {
        const match = findMatchingLocalSong(s.title, s.artist, allLocalSongs)
        if (match) {
          try {
            db.prepare('UPDATE OR IGNORE playlist_items SET songId = ? WHERE playlistId = ? AND songId = ?').run(
              match.id,
              playlistId,
              s.id
            )
          } catch {}
          playlistSongs[i] = {
            ...match,
            playlistDateAdded: s.playlistDateAdded,
            playlistSortOrder: s.playlistSortOrder
          }
        }
      }
    }

    playlist.songs = playlistSongs

    return playlist
  }

  static findPlaylistByDescription(description: string) {
    return getDb()
      .prepare('SELECT id FROM playlists WHERE description = ? LIMIT 1')
      .get(description) as { id: string } | undefined
  }

  static createPlaylist(input: CreatePlaylistInput) {
    const name = input.name.trim()
    if (!name) throw new Error('Playlist name is required')

    const id = crypto.randomUUID()
    const db = getDb()
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
          VALUES (?, ?, ?, ?)
        `
      )

      let sortOrder = 0

      if (Array.isArray(input.tracks) && input.tracks.length > 0) {
        for (const track of input.tracks) {
          let songId = track.matchedSongId

          if (!songId) {
            songId = crypto.randomUUID()
            const title = (track.title || 'Unknown Track').trim()
            const artist = (track.artist || 'Unknown Artist').trim()
            const album = (track.album || '').trim()
            const duration = Number(track.duration) || 0
            const virtualPath = `virtual:imported:${crypto.randomUUID()}`

            db.prepare(
              `
                INSERT INTO songs (id, title, artist, album, duration, filePath, size, isFavorite, playCount)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
              `
            ).run(songId, title, artist, album, duration, virtualPath)
          }

          insertItem.run(crypto.randomUUID(), id, songId, sortOrder++)
        }
      } else if (Array.isArray(input.songIds) && input.songIds.length > 0) {
        const songIds = [...new Set(input.songIds)]
        for (const songId of songIds) {
          const exists = db.prepare('SELECT 1 FROM songs WHERE id = ?').get(songId)
          if (exists) {
            insertItem.run(crypto.randomUUID(), id, songId, sortOrder++)
          }
        }
      }
    })
    create()

    return this.getPlaylist(id)
  }

  static deletePlaylist(playlistId: string) {
    getDb().prepare('DELETE FROM playlists WHERE id = ?').run(playlistId)
  }

  static renamePlaylist(playlistId: string, name: string) {
    const trimmedName = name.trim()
    if (!trimmedName) throw new Error('Playlist name is required')
    const db = getDb()
    const result = db
      .prepare("UPDATE playlists SET name = ?, dateModified = strftime('%s', 'now') WHERE id = ?")
      .run(trimmedName, playlistId)
    if (result.changes === 0) throw new Error('Playlist not found')
    return this.getPlaylist(playlistId)
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
