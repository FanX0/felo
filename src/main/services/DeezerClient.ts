import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'

export interface DeezerConfig {
  arl?: string
  quality?: 'lossless' | 'mp3-320' | 'mp3-128'
}

export interface DeezerTrackResult {
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  quality: string
  isrc?: string
}

const DEEZER_BLOWFISH_SECRET = 'g4el58wc0zvf9na1'
const API_BASE = 'https://api.deezer.com'
const GW_LIGHT_URL = 'https://www.deezer.com/ajax/gw-light.php'

export class DeezerClient {
  private arl: string
  private sessionId: string = ''
  private apiToken: string = ''
  private licenseToken: string = ''

  constructor(config: DeezerConfig) {
    this.arl = (config.arl || '').trim()
  }

  /**
   * Derive the 16-byte Blowfish CBC decryption key from the track ID.
   */
  static getBlowfishKey(trackId: string | number): Buffer {
    const idStr = String(trackId)
    const md5Hex = crypto.createHash('md5').update(idStr, 'ascii').digest('hex')
    const key = Buffer.alloc(16)

    for (let i = 0; i < 16; i++) {
      key[i] =
        md5Hex.charCodeAt(i) ^
        md5Hex.charCodeAt(i + 16) ^
        DEEZER_BLOWFISH_SECRET.charCodeAt(i)
    }

    return key
  }

  /**
   * Create a stream Transform that decrypts Deezer encrypted chunks.
   * Deezer encrypts every 3rd chunk (indices 0, 3, 6, 9...) of 2048 bytes with Blowfish CBC.
   */
  static createDecryptionTransform(trackId: string | number): Transform {
    const key = DeezerClient.getBlowfishKey(trackId)
    const iv = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])
    const CHUNK_SIZE = 2048

    let buffer = Buffer.alloc(0)
    let chunkIndex = 0

    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= CHUNK_SIZE) {
          const currentChunk = buffer.subarray(0, CHUNK_SIZE)
          buffer = buffer.subarray(CHUNK_SIZE)

          if (chunkIndex % 3 === 0) {
            try {
              const decipher = crypto.createDecipheriv('bf-cbc', key, iv)
              decipher.setAutoPadding(false)
              const decrypted = Buffer.concat([decipher.update(currentChunk), decipher.final()])
              this.push(decrypted)
            } catch {
              // Fallback to push raw chunk if decipher fails
              this.push(currentChunk)
            }
          } else {
            this.push(currentChunk)
          }

          chunkIndex++
        }

        callback()
      },
      flush(callback) {
        // Any remaining bytes less than 2048 at the end are NOT encrypted
        if (buffer.length > 0) {
          this.push(buffer)
        }
        callback()
      }
    })
  }

  /**
   * Authenticate session using ARL cookie.
   */
  async ensureSession(): Promise<void> {
    if (this.sessionId && this.apiToken) return
    if (!this.arl) {
      throw new Error('Deezer ARL token is missing. Please add your ARL in Settings.')
    }

    // Call getUserData on gateway to validate ARL and obtain CSRF token / session
    const res = await fetch(
      `${GW_LIGHT_URL}?method=deezer.getUserData&input=3&api_version=1.0&api_token=`,
      {
        headers: {
          Cookie: `arl=${this.arl}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    )

    if (!res.ok) {
      throw new Error(`Failed to initialize Deezer session (${res.status})`)
    }

    const data = (await res.json()) as any
    if (data.error && Object.keys(data.error).length > 0) {
      throw new Error(`Deezer session error: ${JSON.stringify(data.error)}`)
    }

    const user = data.results?.USER
    if (!user || user.USER_ID === 0) {
      throw new Error('Invalid or expired Deezer ARL token. Please log into Deezer and copy a fresh ARL cookie.')
    }

    this.apiToken = data.results?.checkForm || ''
    this.licenseToken = data.results?.USER?.OPTIONS?.license_token || ''

    // Capture set-cookie headers if available
    const setCookie = res.headers.get('set-cookie') || ''
    const sidMatch = /sid=([^;]+)/.exec(setCookie)
    if (sidMatch) {
      this.sessionId = sidMatch[1]
    }
  }

  /**
   * Search tracks on Deezer.
   */
  async searchTracks(query: string, limit = 15): Promise<DeezerTrackResult[]> {
    const params = new URLSearchParams({
      q: query.trim(),
      limit: String(limit)
    })

    const res = await fetch(`${API_BASE}/search/track?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!res.ok) {
      throw new Error(`Deezer search error: ${res.statusText}`)
    }

    const data = (await res.json()) as any
    const items = data.data || []

    return items.map((item: any) => ({
      id: String(item.id),
      title: item.title || item.title_short || 'Unknown Title',
      artist: item.artist?.name || 'Unknown Artist',
      album: item.album?.title || '',
      duration: item.duration || 0,
      quality: 'FLAC 16-bit / 44.1 kHz or MP3 320k',
      isrc: item.isrc
    }))
  }

  /**
   * Resolve downloadable stream URL for a given track.
   */
  async getTrackStreamUrl(
    trackId: string,
    quality: 'lossless' | 'mp3-320' | 'mp3-128' = 'lossless'
  ): Promise<{ url: string; format: string }> {
    await this.ensureSession()

    // 1. Get track info from gateway
    const trackInfoRes = await fetch(
      `${GW_LIGHT_URL}?method=deezer.pageTrack&input=3&api_version=1.0&api_token=${encodeURIComponent(this.apiToken)}`,
      {
        method: 'POST',
        headers: {
          Cookie: `arl=${this.arl}${this.sessionId ? `; sid=${this.sessionId}` : ''}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ sng_id: trackId })
      }
    )

    if (!trackInfoRes.ok) {
      throw new Error(`Failed to fetch Deezer track info for ID ${trackId}`)
    }

    const trackInfoJson = (await trackInfoRes.json()) as any
    const trackData = trackInfoJson.results?.DATA
    const trackToken = trackData?.TRACK_TOKEN

    if (!trackToken) {
      throw new Error('Track token unavailable from Deezer. The track might be geo-restricted or unavailable.')
    }

    // Determine target formats in order of preference
    const formatOrder =
      quality === 'lossless'
        ? ['FLAC', 'MP3_320', 'MP3_128']
        : quality === 'mp3-320'
          ? ['MP3_320', 'MP3_128']
          : ['MP3_128', 'MP3_320']

    // 2. Request download URL from media service
    const mediaRes = await fetch('https://media.deezer.com/v1/get_url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        license_token: this.licenseToken,
        media: [
          {
            type: 'FULL',
            formats: formatOrder.map((fmt) => ({ cipher: 'BF_CBC_STRIPED', format: fmt }))
          }
        ],
        track_tokens: [trackToken]
      })
    })

    if (!mediaRes.ok) {
      throw new Error(`Failed to resolve Deezer audio stream: ${mediaRes.statusText}`)
    }

    const mediaData = (await mediaRes.json()) as any
    const mediaItem = mediaData.data?.[0]?.media?.[0]
    const streamUrl = mediaItem?.sources?.[0]?.url
    const chosenFormat = mediaItem?.format || 'MP3_320'

    if (!streamUrl) {
      throw new Error('Deezer did not return a valid audio stream URL for this track.')
    }

    return { url: streamUrl, format: chosenFormat }
  }

  /**
   * Download and decrypt track to the destination file.
   */
  async downloadTrack(
    trackId: string,
    destinationPath: string,
    quality: 'lossless' | 'mp3-320' | 'mp3-128' = 'lossless',
    onProgress?: (progress: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<{ filePath: string; format: string }> {
    const { url, format } = await this.getTrackStreamUrl(trackId, quality)

    const response = await fetch(url)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download audio from Deezer CDN: ${response.statusText}`)
    }

    const totalBytes = Number(response.headers.get('content-length') || 0)
    let downloadedBytes = 0

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true })

    const readable = Readable.fromWeb(response.body as any)
    const decryptor = DeezerClient.createDecryptionTransform(trackId)
    const fileStream = fs.createWriteStream(destinationPath)

    readable.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length
      if (totalBytes > 0 && onProgress) {
        const pct = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
        onProgress(pct, downloadedBytes, totalBytes)
      }
    })

    await pipeline(readable, decryptor, fileStream)
    return { filePath: destinationPath, format }
  }

  /**
   * Test Deezer credentials and connection.
   */
  static async testConnection(config: DeezerConfig): Promise<{ success: boolean; message: string }> {
    try {
      const client = new DeezerClient(config)
      await client.ensureSession()
      return {
        success: true,
        message: 'Deezer ARL validated and connected successfully!'
      }
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to connect to Deezer.'
      }
    }
  }
}
