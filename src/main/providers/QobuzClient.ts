import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'

export interface QobuzConfig {
  authMethod?: 'token' | 'password'
  user?: string
  secret?: string // password or user_auth_token
  appId?: string
  appSecret?: string
  quality?: string // 'hires-max' | 'hires' | 'cd' | 'mp3-320'
}

export interface QobuzTrackResult {
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  quality: string
  hires: boolean
  bitDepth?: number
  samplingRate?: number
  artworkUrl?: string
  isrc?: string
}

const BASE_URL = 'https://www.qobuz.com/api.json/0.2'

export class QobuzClient {
  private appId: string
  private appSecret: string
  private userAuthToken: string = ''
  private userId: string = ''
  private config: QobuzConfig

  constructor(config: QobuzConfig) {
    const appId = config.appId?.trim()
    const appSecret = config.appSecret?.trim()

    if (!appId || !appSecret) {
      throw new Error(
        'Qobuz App ID and App Secret are required. Go to Settings → Download Providers → Qobuz and enter your app credentials.'
      )
    }

    this.config = config
    this.appId = appId
    this.appSecret = appSecret

    if (config.authMethod === 'password') {
      // Will authenticate on demand via ensureAuth()
    } else if (config.secret) {
      this.userAuthToken = config.secret.trim()
      this.userId = config.user?.trim() || ''
    }
  }

  getUserId(): string {
    return this.userId
  }

  getUserAuthToken(): string {
    return this.userAuthToken
  }

  async ensureAuth(configOverride?: QobuzConfig): Promise<void> {
    if (this.userAuthToken) return

    const cfg = configOverride || this.config
    if (cfg?.authMethod === 'password' && cfg.user && cfg.secret) {
      const params = new URLSearchParams({
        username: cfg.user.trim(),
        password: cfg.secret.trim(),
        app_id: this.appId
      })

      const res = await fetch(`${BASE_URL}/user/login?${params.toString()}`, {
        headers: {
          'X-App-Id': this.appId,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Qobuz login failed (${res.status}): ${text || res.statusText}`)
      }

      const data = (await res.json()) as any
      if (data.user_auth_token) {
        this.userAuthToken = data.user_auth_token
        this.userId = String(data.user?.id || '')
      } else {
        throw new Error('Qobuz login did not return a user token.')
      }
    }
  }

  async searchTracks(query: string, limit = 25): Promise<QobuzTrackResult[]> {
    await this.ensureAuth()
    const params = new URLSearchParams({
      query: query.trim(),
      limit: String(limit),
      app_id: this.appId
    })

    const headers: Record<string, string> = {
      'X-App-Id': this.appId,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }

    if (this.userAuthToken) {
      headers['X-User-Auth-Token'] = this.userAuthToken
    }

    const res = await fetch(`${BASE_URL}/track/search?${params.toString()}`, { headers })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Qobuz search error: ${errText || res.statusText}`)
    }

    const json = (await res.json()) as any
    const items = json.tracks?.items || []

    return items.map((item: any) => {
      const isHires = Boolean(item.hires || item.hires_streamable)
      const bitDepth = item.maximum_bit_depth || (isHires ? 24 : 16)
      const sampleRate = item.maximum_sampling_rate || (isHires ? 96 : 44.1)

      const qualityBadge = isHires
        ? `${bitDepth}-bit / ${sampleRate} kHz Hi-Res FLAC`
        : '16-bit / 44.1 kHz FLAC'

      const artworkUrl =
        item.album?.image?.large ||
        item.album?.image?.extralarge ||
        item.album?.image?.small ||
        undefined

      return {
        id: String(item.id),
        title: item.title || 'Unknown Title',
        artist: item.performer?.name || item.artist?.name || 'Unknown Artist',
        album: item.album?.title || '',
        duration: item.duration || 0,
        quality: qualityBadge,
        hires: isHires,
        bitDepth,
        samplingRate: sampleRate,
        artworkUrl,
        isrc: item.isrc || undefined
      }
    })
  }

  private mapQualityToFormatId(quality?: string): number {
    switch (quality) {
      case 'hires-max':
        return 27 // 24-bit up to 192kHz
      case 'hires':
        return 7 // 24-bit up to 96kHz
      case 'cd':
        return 6 // FLAC 16-bit / 44.1kHz
      case 'mp3-320':
        return 5 // MP3 320kbps
      default:
        return 27 // Default to best available hires
    }
  }

  private async requestWithSecret(
    trackId: string,
    formatId: number,
    intent: string,
    timestamp: number,
    secret: string
  ): Promise<Response> {
    const raw = `trackgetFileUrlformat_id${formatId}intent${intent}track_id${trackId}${timestamp}${secret}`
    const sig = crypto.createHash('md5').update(raw, 'utf8').digest('hex')
    const params = new URLSearchParams({
      track_id: trackId,
      format_id: String(formatId),
      intent,
      request_ts: String(timestamp),
      request_sig: sig,
      app_id: this.appId,
      user_auth_token: this.userAuthToken
    })
    const headers: Record<string, string> = {
      'X-App-Id': this.appId,
      'X-User-Auth-Token': this.userAuthToken,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    return fetch(`${BASE_URL}/track/getFileUrl?${params.toString()}`, { headers })
  }

  async getDownloadUrl(trackId: string, formatId?: number): Promise<{ url: string; mimeType: string; extension: string }> {
    await this.ensureAuth()
    const selectedFormat = formatId ?? 27
    if (!this.userAuthToken) {
      throw new Error('Qobuz user authentication is required. Enter a valid user auth token in Settings.')
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const intent = 'stream'
    const candidateSecrets = [
      'abb21364945c0583309667d13ca3d93a',
      this.appSecret,
      '806331c3b0b641da923b890aed01d04a',
      'f69a7734686cb9427629378a4b7ac381'
    ].filter((secret, index, values) => secret && values.indexOf(secret) === index)

    let res: Response | undefined
    let lastError = ''
    for (const secret of candidateSecrets) {
      res = await this.requestWithSecret(trackId, selectedFormat, intent, timestamp, secret)
      if (res.ok) break
      const response = res
      lastError = await response.text().catch(() => response.statusText)
      if (!lastError.includes('Invalid Request Signature')) break
    }

    if (!res?.ok) {
      // Fallback format 6 (CD quality) if 27 / hires is unavailable for this track
      if (selectedFormat !== 6) {
        return this.getDownloadUrl(trackId, 6)
      }
      throw new Error(`Failed to get Qobuz download URL: ${lastError || (res ? res.statusText : 'Unknown error')}`)
    }

    const data = (await res.json()) as any
    if (!data.url) {
      if (selectedFormat !== 6) {
        return this.getDownloadUrl(trackId, 6)
      }
      throw new Error('Qobuz API did not return an audio stream URL.')
    }

    if (data.sample) {
      throw new Error(
        'Qobuz only provided a 30-second preview sample. An active Qobuz Studio or Sublime subscription is required for full-length lossless downloads.'
      )
    }

    const mimeType = String(data.mime_type || '').toLowerCase()
    let extension = '.flac'
    if (mimeType.includes('mpeg') || mimeType.includes('mp3') || data.format_id === 5) {
      extension = '.mp3'
    } else if (mimeType.includes('mp4') || mimeType.includes('aac') || data.format_id === 20) {
      extension = '.m4a'
    }

    return {
      url: data.url,
      mimeType: data.mime_type || (extension === '.flac' ? 'audio/flac' : 'audio/mp3'),
      extension
    }
  }

  async downloadTrack(
    trackId: string,
    destinationPath: string,
    quality?: string,
    onProgress?: (progress: number, downloadedBytes: number, totalBytes: number) => void,
    signal?: AbortSignal
  ): Promise<{ filePath: string; format: string }> {
    const formatId = this.mapQualityToFormatId(quality)
    const { url, extension } = await this.getDownloadUrl(trackId, formatId)

    const baseWithoutExt = destinationPath.replace(/\.(flac|mp3|m4a|wav|aac|ogg)$/i, '')
    const finalDestination = `${baseWithoutExt}${extension}`

    const response = await fetch(url, { signal })
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download audio from Qobuz CDN: ${response.statusText}`)
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('html') || contentType.includes('xml')) {
      throw new Error('Qobuz CDN returned an invalid response (expected audio stream).')
    }

    const totalBytes = Number(response.headers.get('content-length') || 0)
    let downloadedBytes = 0

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(finalDestination), { recursive: true })
    const fileStream = fs.createWriteStream(finalDestination)
    const readable = Readable.fromWeb(response.body as any)

    const progressTracker = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.length
        if (totalBytes > 0 && onProgress) {
          const pct = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
          onProgress(pct, downloadedBytes, totalBytes)
        }
        callback(null, chunk)
      }
    })

    try {
      await pipeline(readable, progressTracker, fileStream, { signal })

      // Verify file integrity and magic bytes
      const stat = fs.statSync(finalDestination)
      if (stat.size < 64 * 1024) {
        throw new Error('Downloaded audio stream was incomplete or under minimum audio file size.')
      }

      if (extension === '.flac') {
        const fd = fs.openSync(finalDestination, 'r')
        const magic = Buffer.alloc(4)
        fs.readSync(fd, magic, 0, 4, 0)
        fs.closeSync(fd)
        if (magic.toString('ascii') !== 'fLaC') {
          throw new Error('Downloaded stream is not a valid FLAC audio file (preamble mismatch).')
        }
      }

      return { filePath: finalDestination, format: extension.replace('.', '') }
    } catch (error) {
      try {
        fileStream.destroy()
        if (fs.existsSync(finalDestination)) {
          fs.unlinkSync(finalDestination)
        }
      } catch {}
      throw error
    }
  }

  static async testConnection(config: QobuzConfig): Promise<{ success: boolean; message: string }> {
    try {
      const client = new QobuzClient(config)
      await client.ensureAuth(config)
      const results = await client.searchTracks('test', 1)
      return {
        success: true,
        message: results.length > 0 ? 'Qobuz connection and search verified successfully!' : 'Connected to Qobuz.'
      }
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to connect to Qobuz.'
      }
    }
  }
}
