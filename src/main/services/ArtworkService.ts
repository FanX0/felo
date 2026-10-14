import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as mm from 'music-metadata'
import { getDb } from '../database'

export class ArtworkService {
  private static readonly validArtworkCache = new Set<string>()
  private static readonly invalidArtworkCache = new Set<string>()

  /**
   * Get and ensure the artwork storage directory in userData.
   */
  static getArtworkDirectory(): string {
    const dir = path.join(app.getPath('userData'), 'artwork')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /**
   * Identify image extension from buffer magic bytes.
   */
  static detectImageExtension(buffer: Buffer): string | null {
    if (!buffer || buffer.length < 8) return null
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'jpg'
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'png'
    }
    // WEBP: RIFF .... WEBP
    if (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'webp'
    }
    // GIF: GIF8
    if (buffer.toString('ascii', 0, 4) === 'GIF8') {
      return 'gif'
    }
    return null
  }

  /**
   * Check whether a file path points to an existing, non-empty, valid image file.
   * Utilizes an in-memory cache to avoid repeated synchronous disk reads.
   */
  static isValidArtworkFile(filePath?: string | null): boolean {
    if (!filePath || typeof filePath !== 'string') return false
    if (this.validArtworkCache.has(filePath)) return true
    if (this.invalidArtworkCache.has(filePath)) return false

    const ext = path.extname(filePath).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
      this.invalidArtworkCache.add(filePath)
      return false
    }

    try {
      if (!fs.existsSync(filePath)) {
        this.invalidArtworkCache.add(filePath)
        return false
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size < 200) {
        this.invalidArtworkCache.add(filePath)
        return false
      }

      this.validArtworkCache.add(filePath)
      return true
    } catch {
      this.invalidArtworkCache.add(filePath)
      return false
    }
  }

  /**
   * Persist an image buffer to the app artwork directory using SHA-1 deduplication.
   */
  static saveArtworkBuffer(buffer: Buffer, formatHint = 'jpg'): string {
    const ext = this.detectImageExtension(buffer) || formatHint || 'jpg'
    const hash = crypto.createHash('sha1').update(buffer).digest('hex')
    const artworkDir = this.getArtworkDirectory()
    const targetPath = path.join(artworkDir, `${hash}.${ext}`)

    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, buffer)
    }
    this.validArtworkCache.add(targetPath)
    return targetPath
  }

  /**
   * Extract embedded picture metadata from a local audio file.
   */
  static async extractFromAudioFile(filePath: string): Promise<string | null> {
    if (!filePath || !fs.existsSync(filePath)) return null
    try {
      const metadata = await mm.parseFile(filePath, { duration: false })
      const picture = metadata.common.picture?.[0]
      if (!picture?.data?.length) return null

      const buffer = Buffer.from(picture.data)
      const ext = this.detectImageExtension(buffer) || 'jpg'
      return this.saveArtworkBuffer(buffer, ext)
    } catch {
      return null
    }
  }

  private static isSafeArtworkUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      const hostname = parsed.hostname.toLowerCase()
      if (!hostname) return false
      if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false
      if (hostname === '127.0.0.1' || hostname.startsWith('127.')) return false
      if (hostname === '0.0.0.0' || hostname === '::1' || hostname === '[::1]') return false
      if (hostname.startsWith('169.254.')) return false
      return true
    } catch {
      return false
    }
  }

  /**
   * Fetch an image from a remote HTTP(S) URL and save it to the artwork directory.
   */
  static async fetchArtworkUrl(url: string, timeoutMs = 12000): Promise<string | null> {
    if (!url || typeof url !== 'string' || !this.isSafeArtworkUrl(url)) return null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
        }
      })
      clearTimeout(timer)
      if (!res.ok) return null

      const arrayBuf = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuf)
      if (buffer.length < 200) return null

      const ext = this.detectImageExtension(buffer)
      if (!ext) return null

      return this.saveArtworkBuffer(buffer, ext)
    } catch {
      return null
    }
  }

  /**
   * Search for companion cover art in the same directory as the audio file.
   */
  static findCompanionArtwork(audioFilePath: string): string | null {
    if (!audioFilePath || !fs.existsSync(audioFilePath)) return null
    try {
      const dir = path.dirname(audioFilePath)
      if (!fs.existsSync(dir)) return null

      const ext = path.extname(audioFilePath)
      const baseName = path.basename(audioFilePath, ext)

      const candidateNames = [
        'cover.jpg',
        'cover.jpeg',
        'cover.png',
        'cover.webp',
        'folder.jpg',
        'folder.png',
        'front.jpg',
        'front.png',
        'artwork.jpg',
        'artwork.png',
        'album.jpg',
        'album.png',
        `${baseName}.jpg`,
        `${baseName}.jpeg`,
        `${baseName}.png`,
        `${baseName}.webp`
      ]

      for (const name of candidateNames) {
        const candidatePath = path.join(dir, name)
        if (this.isValidArtworkFile(candidatePath)) {
          const buffer = fs.readFileSync(candidatePath)
          const imgExt = this.detectImageExtension(buffer) || 'jpg'
          return this.saveArtworkBuffer(buffer, imgExt)
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Fetch thumbnail for YouTube videos by ID or URL.
   */
  static async fetchYouTubeThumbnail(videoIdOrUrl: string): Promise<string | null> {
    if (!videoIdOrUrl) return null
    let videoId = videoIdOrUrl
    if (videoIdOrUrl.includes('youtube.com/') || videoIdOrUrl.includes('youtu.be/')) {
      const idMatch = /(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/.exec(videoIdOrUrl)
      if (idMatch) videoId = idMatch[1]
    }
    videoId = videoId.trim()
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null

    // Try maxresdefault first (1280x720)
    const maxresUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
    const maxres = await this.fetchArtworkUrl(maxresUrl, 8000)
    if (maxres && this.isValidArtworkFile(maxres)) return maxres

    // Fall back to hqdefault (480x360)
    const hqUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    const hq = await this.fetchArtworkUrl(hqUrl, 8000)
    if (hq && this.isValidArtworkFile(hq)) return hq

    // Fall back to mqdefault (320x180)
    const mqUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    return this.fetchArtworkUrl(mqUrl, 8000)
  }

  /**
   * Fetch album cover for Deezer tracks by track ID.
   */
  static async fetchDeezerTrackCover(trackId: string): Promise<string | null> {
    if (!trackId || !/^\d+$/.test(trackId)) return null
    try {
      const res = await fetch(`https://api.deezer.com/track/${trackId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      if (!res.ok) return null
      const data = (await res.json()) as any
      const coverUrl =
        data.album?.cover_xl || data.album?.cover_big || data.album?.cover_medium
      if (coverUrl) {
        return this.fetchArtworkUrl(coverUrl)
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Clean search queries by removing noise words, brackets, and file extensions.
   */
  private static cleanQuery(artist: string, title: string, album?: string): string {
    let cleanArtist = (artist || '')
      .replace(/^unknown artist$/i, '')
      .replace(/\s*-\s*topic$/i, '')
      .replace(/\s*(?:vevo|official|records|topic)$/i, '')
      .replace(/\b(feat|ft|featuring)\.?\s+.*/gi, '')
      .trim()

    let cleanTitle = (title || '')
      .replace(
        /\s*\([^)]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3|deluxe|bonus|visualizer)[^)]*\)/gi,
        ''
      )
      .replace(
        /\s*\[[^\]]*(?:official|video|audio|remaster|lyric|hd|4k|hq|kbps|flac|mp3|deluxe|bonus|visualizer)[^\]]*\]/gi,
        ''
      )
      .replace(/\s*\([^)]*(?:feat|ft|featuring|prod\b)[^)]*\)/gi, '')
      .replace(/\s*\[[^\]]*(?:feat|ft|featuring|prod\b)[^\]]*\]/gi, '')
      .replace(/\.(mp3|flac|wav|m4a|ogg|opus)$/i, '')
      .replace(/[<>:"/\\|?*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const dashParts = cleanTitle.split(/\s+-\s+/)
    if (dashParts.length >= 2) {
      const titleArtist = dashParts[0].trim()
      const normArtist = cleanArtist.toLowerCase().replace(/[^a-z0-9]/g, '')
      const normTitleArtist = titleArtist.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (
        !cleanArtist ||
        normArtist === normTitleArtist ||
        normArtist.includes(normTitleArtist) ||
        normTitleArtist.includes(normArtist)
      ) {
        cleanArtist = titleArtist
        cleanTitle = dashParts.slice(1).join(' ').trim()
      }
    } else if (cleanArtist && cleanTitle.toLowerCase().startsWith(`${cleanArtist.toLowerCase()} - `)) {
      cleanTitle = cleanTitle.slice(cleanArtist.length + 3).trim()
    }

    let cleanAlbum = (album || '').trim()
    if (/^(youtube|youtube music|single|unknown album|unknown)$/i.test(cleanAlbum)) {
      cleanAlbum = ''
    }

    return [cleanArtist, cleanTitle, cleanAlbum].filter(Boolean).join(' ')
  }

  /**
   * Search iTunes Search API for high-resolution 600x600 cover artwork.
   */
  static async searchItunesArtwork(
    artist: string,
    title: string,
    album?: string
  ): Promise<string | null> {
    const query = this.cleanQuery(artist, title, album)
    if (!query) return null

    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5&country=US`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
          }
        }
      )
      if (!res.ok) return null
      const data = (await res.json()) as any
      const results = data?.results || []
      if (!results.length) {
        // Fallback search with title only if combined query had no matches
        const titleOnly = this.cleanQuery('', title, '')
        if (artist && titleOnly && titleOnly !== query) {
          return this.searchItunesArtwork('', titleOnly)
        }
        return null
      }

      for (const item of results) {
        const rawArtwork = item.artworkUrl100
        if (typeof rawArtwork === 'string' && rawArtwork.trim()) {
          const highResArtwork = rawArtwork.replace('100x100bb', '600x600bb')
          const saved = await this.fetchArtworkUrl(highResArtwork)
          if (saved && this.isValidArtworkFile(saved)) return saved
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Search Deezer Public Search API for cover artwork.
   */
  static async searchDeezerArtwork(
    artist: string,
    title: string,
    album?: string
  ): Promise<string | null> {
    const query = this.cleanQuery(artist, title, album)
    if (!query) return null

    try {
      const res = await fetch(
        `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        }
      )
      if (!res.ok) return null
      const data = (await res.json()) as any
      const results = data?.data || []
      if (!results.length) {
        const titleOnly = this.cleanQuery('', title, '')
        if (artist && titleOnly && titleOnly !== query) {
          return this.searchDeezerArtwork('', titleOnly)
        }
        return null
      }

      for (const item of results) {
        const coverUrl =
          item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium
        if (coverUrl) {
          const saved = await this.fetchArtworkUrl(coverUrl)
          if (saved && this.isValidArtworkFile(saved)) return saved
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Update SQLite records for song and album with the resolved artwork.
   */
  static updateDatabaseArtwork(artworkPath: string, songId?: string, albumId?: string): void {
    if (!artworkPath) return
    try {
      const db = getDb()
      if (songId) {
        db.prepare('UPDATE songs SET artworkPath = ? WHERE id = ?').run(artworkPath, songId)
      }
      if (albumId) {
        db.prepare(
          'UPDATE albums SET artworkPath = COALESCE(artworkPath, ?) WHERE id = ?'
        ).run(artworkPath, albumId)
      }
    } catch (err) {
      console.warn('Failed to update artwork in database:', err)
    }
  }

  /**
   * Master validation & multi-tier enrichment pipeline. Runs on every download.
   */
  static async verifyAndEnrichTrackArtwork(params: {
    filePath: string
    stagingDirectory?: string
    title: string
    artist: string
    album?: string
    source?: string
    resultId?: string
    hintArtworkUrl?: string
    songId?: string
    albumId?: string
  }): Promise<string | null> {
    const {
      filePath,
      stagingDirectory,
      title,
      artist,
      album,
      source,
      resultId,
      hintArtworkUrl,
      songId,
      albumId
    } = params

    // Test 1: Check if audio file has embedded picture metadata
    if (filePath && fs.existsSync(filePath)) {
      const embedded = await this.extractFromAudioFile(filePath)
      if (embedded && this.isValidArtworkFile(embedded)) {
        this.updateDatabaseArtwork(embedded, songId, albumId)
        return embedded
      }
    }

    // Test 2: Check staging directory for any image files written during download
    if (stagingDirectory && fs.existsSync(stagingDirectory)) {
      try {
        const entries = fs.readdirSync(stagingDirectory)
        for (const entry of entries) {
          const ext = path.extname(entry).toLowerCase()
          if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const stagingImagePath = path.join(stagingDirectory, entry)
            if (this.isValidArtworkFile(stagingImagePath)) {
              const buffer = fs.readFileSync(stagingImagePath)
              const saved = this.saveArtworkBuffer(buffer, ext.replace('.', ''))
              if (saved && this.isValidArtworkFile(saved)) {
                this.updateDatabaseArtwork(saved, songId, albumId)
                return saved
              }
            }
          }
        }
      } catch {}
    }

    // Test 3: Check companion cover art in the same directory as the audio file
    if (filePath && fs.existsSync(filePath)) {
      const companion = this.findCompanionArtwork(filePath)
      if (companion && this.isValidArtworkFile(companion)) {
        this.updateDatabaseArtwork(companion, songId, albumId)
        return companion
      }
    }

    // Fallback Tier 1: Caller-provided artwork hint URL
    if (hintArtworkUrl && /^https?:\/\//i.test(hintArtworkUrl)) {
      const saved = await this.fetchArtworkUrl(hintArtworkUrl)
      if (saved && this.isValidArtworkFile(saved)) {
        this.updateDatabaseArtwork(saved, songId, albumId)
        return saved
      }
    }

    // Fallback Tier 2: Source-specific fetchers (YouTube or Deezer ID)
    if (source === 'youtube') {
      const ytTarget = resultId || hintArtworkUrl
      if (ytTarget) {
        const saved = await this.fetchYouTubeThumbnail(ytTarget)
        if (saved && this.isValidArtworkFile(saved)) {
          this.updateDatabaseArtwork(saved, songId, albumId)
          return saved
        }
      }
    }

    if (source === 'deezer') {
      const deezerTarget = resultId || hintArtworkUrl || ''
      const trackIdMatch = /\b(\d{5,})\b/.exec(deezerTarget)
      const trackId = trackIdMatch ? trackIdMatch[1] : deezerTarget
      if (trackId && /^\d+$/.test(trackId)) {
        const saved = await this.fetchDeezerTrackCover(trackId)
        if (saved && this.isValidArtworkFile(saved)) {
          this.updateDatabaseArtwork(saved, songId, albumId)
          return saved
        }
      }
    }

    // Fallback Tier 3: Universal iTunes Search API (high-resolution)
    const itunesArt = await this.searchItunesArtwork(artist, title, album)
    if (itunesArt && this.isValidArtworkFile(itunesArt)) {
      this.updateDatabaseArtwork(itunesArt, songId, albumId)
      return itunesArt
    }

    // Fallback Tier 4: Universal Deezer Search API
    const deezerArt = await this.searchDeezerArtwork(artist, title, album)
    if (deezerArt && this.isValidArtworkFile(deezerArt)) {
      this.updateDatabaseArtwork(deezerArt, songId, albumId)
      return deezerArt
    }

    return null
  }
}
