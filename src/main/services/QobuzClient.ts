import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

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
}

// Known Qobuz default public app credentials used across open-source players
const DEFAULT_APP_ID = '712108709'
const DEFAULT_APP_SECRET = 'be6759d7cc4e8cfc2f0f81d1eb96db6f'
const BASE_URL = 'https://www.qobuz.com/api.json/0.2'

export class QobuzClient {
  private appId: string
  private appSecret: string
  private userAuthToken: string = ''
  private userId: string = ''

  constructor(config: QobuzConfig) {
    this.appId = config.appId?.trim() || DEFAULT_APP_ID
    this.appSecret = config.appSecret?.trim() || DEFAULT_APP_SECRET

    if (config.authMethod === 'password') {
      // Will authenticate on demand if user/password provided
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

  private async ensureAuth(config: QobuzConfig): Promise<void> {
    if (this.userAuthToken) return

    if (config.authMethod === 'password' && config.user && config.secret) {
      const params = new URLSearchParams({
        username: config.user.trim(),
        password: config.secret.trim(),
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

  async searchTracks(query: string, limit = 15): Promise<QobuzTrackResult[]> {
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

      return {
        id: String(item.id),
        title: item.title || 'Unknown Title',
        artist: item.performer?.name || item.artist?.name || 'Unknown Artist',
        album: item.album?.title || '',
        duration: item.duration || 0,
        quality: qualityBadge,
        hires: isHires,
        bitDepth,
        samplingRate: sampleRate
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

  private generateRequestSignature(
    trackId: string,
    formatId: number,
    intent: string,
    timestamp: number
  ): string {
    // Qobuz signing formula: md5("trackgetFileUrlformat_id<id>intent<intent>track_id<id><timestamp><app_secret>")
    const raw = `trackgetFileUrlformat_id${formatId}intent${intent}track_id${trackId}${timestamp}${this.appSecret}`
    return crypto.createHash('md5').update(raw, 'utf8').digest('hex')
  }

  async getDownloadUrl(trackId: string, formatId?: number): Promise<{ url: string; mimeType: string }> {
    const selectedFormat = formatId ?? 27
    const timestamp = Math.floor(Date.now() / 1000)
    const intent = 'stream'
    const sig = this.generateRequestSignature(trackId, selectedFormat, intent, timestamp)

    const params = new URLSearchParams({
      track_id: trackId,
      format_id: String(selectedFormat),
      intent,
      request_ts: String(timestamp),
      request_sig: sig,
      app_id: this.appId
    })

    if (this.userAuthToken) {
      params.set('user_auth_token', this.userAuthToken)
    }

    const headers: Record<string, string> = {
      'X-App-Id': this.appId,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }

    if (this.userAuthToken) {
      headers['X-User-Auth-Token'] = this.userAuthToken
    }

    const res = await fetch(`${BASE_URL}/track/getFileUrl?${params.toString()}`, { headers })
    if (!res.ok) {
      // Fallback format 6 (CD quality) if 27 / hires is unavailable for this track
      if (selectedFormat !== 6) {
        return this.getDownloadUrl(trackId, 6)
      }
      const err = await res.text().catch(() => '')
      throw new Error(`Failed to get Qobuz download URL: ${err || res.statusText}`)
    }

    const data = (await res.json()) as any
    if (!data.url) {
      if (selectedFormat !== 6) {
        return this.getDownloadUrl(trackId, 6)
      }
      throw new Error('Qobuz API did not return an audio stream URL.')
    }

    return {
      url: data.url,
      mimeType: data.mime_type || (data.url.includes('.flac') ? 'audio/flac' : 'audio/mp3')
    }
  }

  async downloadTrack(
    trackId: string,
    destinationPath: string,
    quality?: string,
    onProgress?: (progress: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<string> {
    const formatId = this.mapQualityToFormatId(quality)
    const { url } = await this.getDownloadUrl(trackId, formatId)

    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download audio from Qobuz CDN: ${response.statusText}`)
    }

    const totalBytes = Number(response.headers.get('content-length') || 0)
    let downloadedBytes = 0

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
    const fileStream = fs.createWriteStream(destinationPath)

    const readable = Readable.fromWeb(response.body as any)

    readable.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length
      if (totalBytes > 0 && onProgress) {
        const pct = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
        onProgress(pct, downloadedBytes, totalBytes)
      }
    })

    await pipeline(readable, fileStream)
    return destinationPath
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
