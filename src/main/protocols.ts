import { app, protocol } from 'electron'
import path, { join, normalize, resolve } from 'path'
import fs from 'fs'
import { Readable } from 'stream'

/**
 * Register custom privileged schemes. Must be called before app.ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

export function resolveMediaPath(url: string): string {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.hostname === 'local') {
      let rawPath = decodeURIComponent(parsedUrl.pathname.slice(1))
      if (process.platform !== 'win32' && !rawPath.startsWith('/')) {
        rawPath = '/' + rawPath
      }
      return normalize(rawPath)
    }
  } catch {}

  // Backward-compatible support for older media:///C:/... URLs.
  let filePath = decodeURIComponent(url.replace(/^media:\/\//i, ''))
  if (process.platform === 'win32' && filePath.startsWith('/')) {
    filePath = filePath.slice(1)
  }
  return normalize(filePath)
}

export function getContentType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'mp3':
      return 'audio/mpeg'
    case 'flac':
      return 'audio/flac'
    case 'm4a':
      return 'audio/mp4'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'opus':
      return 'audio/ogg'
    case 'aac':
      return 'audio/aac'
    case 'wma':
      return 'audio/x-ms-wma'
    default:
      return 'application/octet-stream'
  }
}

export function isInsideDirectory(targetPath: string, parentDir: string): boolean {
  try {
    const normTarget = normalize(resolve(targetPath)).toLowerCase()
    const normParent = normalize(resolve(parentDir)).toLowerCase()
    const withSep = normParent.endsWith(path.sep) ? normParent : normParent + path.sep
    return normTarget === normParent || normTarget.startsWith(withSep)
  } catch {
    return false
  }
}

export function isPathAllowedForMedia(targetPath: string): boolean {
  try {
    if (!targetPath || typeof targetPath !== 'string') return false
    const resolvedTarget = resolve(targetPath)
    if (!fs.existsSync(resolvedTarget)) return false

    const stat = fs.statSync(resolvedTarget)
    if (!stat.isFile()) return false

    const contentType = getContentType(resolvedTarget)
    // Audio files and artwork images are always permitted media
    if (contentType.startsWith('audio/') || contentType.startsWith('image/')) {
      return true
    }

    const userData = app.getPath('userData')
    if (isInsideDirectory(resolvedTarget, userData)) return true

    const resourcesDir = app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
    if (isInsideDirectory(resolvedTarget, resourcesDir)) return true

    return false
  } catch {
    return false
  }
}

/**
 * Register protocol handle for media:// streaming and image loading.
 */
export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      })
    }

    const filePath = resolveMediaPath(request.url)

    // Security: verify the file exists and is within a registered library root or asset folder
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }

    if (!isPathAllowedForMedia(filePath)) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }

    const contentType = getContentType(filePath)
    if (contentType.startsWith('image/')) {
      try {
        const imageBuffer = await fs.promises.readFile(filePath)
        return new Response(imageBuffer, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch {
        return new Response('Error reading image', {
          status: 500,
          headers: { 'Access-Control-Allow-Origin': '*' }
        })
      }
    }

    try {
      const fileSize = fs.statSync(filePath).size
      const rangeHeader = request.headers.get('range')
      const commonHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      }

      // 2MB chunk window prevents backpressure deadlock in Node's Readable.toWeb stream
      const MAX_CHUNK_SIZE = 2 * 1024 * 1024

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
        if (!match) {
          return new Response(null, {
            status: 416,
            headers: { ...commonHeaders, 'Content-Range': `bytes */${fileSize}` }
          })
        }

        const requestedStart = match[1] ? parseInt(match[1], 10) : null
        const requestedEnd = match[2] ? parseInt(match[2], 10) : null
        const start = requestedStart ?? Math.max(0, fileSize - (requestedEnd ?? 0))
        const end =
          requestedEnd !== null
            ? Math.min(requestedEnd, fileSize - 1)
            : Math.min(fileSize - 1, start + MAX_CHUNK_SIZE - 1)

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          start > end ||
          start >= fileSize
        ) {
          return new Response(null, {
            status: 416,
            headers: { ...commonHeaders, 'Content-Range': `bytes */${fileSize}` }
          })
        }

        const chunkSize = end - start + 1
        const nodeStream = fs.createReadStream(filePath, { start, end })
        nodeStream.on('error', (err) => {
          console.debug('[MediaProtocol] ReadStream range error ignored:', err?.message)
        })
        const stream = Readable.toWeb(nodeStream)
        return new Response(stream as BodyInit, {
          status: 206,
          headers: {
            ...commonHeaders,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`
          }
        })
      }

      // When no Range header is sent, stream initial 2MB chunk with status 206 so
      // Chromium HTMLMediaElement immediately recognizes byte-range seeking support
      const start = 0
      const end = Math.min(fileSize - 1, MAX_CHUNK_SIZE - 1)
      const chunkSize = end - start + 1
      const nodeStream = fs.createReadStream(filePath, { start, end })
      nodeStream.on('error', (err) => {
        console.debug('[MediaProtocol] ReadStream initial chunk error ignored:', err?.message)
      })
      const stream = Readable.toWeb(nodeStream)
      return new Response(stream as BodyInit, {
        status: 206,
        headers: {
          ...commonHeaders,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`
        }
      })
    } catch (err) {
      console.error('[MediaProtocol] Stream error:', err)
      return new Response('Error loading audio', {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }
  })
}
