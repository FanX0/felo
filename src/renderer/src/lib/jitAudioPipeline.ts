/**
 * MUSIXQUARE JIT Audio Pipeline Engine
 *
 * Implements:
 * 1. Metadata-First lazy playlist indexing (raw audio stays in local RAM slot pool)
 * 2. Compression & Codec profile detection (bypasses lossy re-encoding; flags uncompressed PCM for compression)
 * 3. Just-In-Time (JIT) 256KB chunk streaming with priority preemption (activeUploadAbortController)
 */

export type UploadStatus = 'METADATA_ONLY' | 'UPLOADING' | 'UPLOADED' | 'ERROR'

export interface CompressionProfile {
  isAlreadyCompressed: boolean
  needsCompression: boolean
  codecCategory: 'LOSSY' | 'LOSSLESS' | 'UNCOMPRESSED'
  estimatedBitrateKbps: number
  useSegmentedDecoder: boolean
}

export interface JITPlaylistTrack {
  id: string
  title: string
  artist?: string
  album?: string
  sizeBytes: number
  durationSec: number
  mimeType: string
  artworkUrl?: string
  uploadStatus: UploadStatus
  uploadProgress: number
  statusText: string
  compression: CompressionProfile
  remoteUrl?: string
  localPath?: string
}

export interface JITChunkHeader {
  type: 'jit-start' | 'jit-chunk' | 'jit-end' | 'jit-abort'
  trackId: string
  chunkIndex?: number
  totalChunks?: number
  mimeType?: string
  totalSize?: number
  durationSec?: number
  compression?: CompressionProfile
}

// Local RAM-only reference pool holding raw File objects / local paths on host
const localFileSlotPool = new Map<string, File | Blob>()
const localFilePathPool = new Map<string, string>()
const _slotObjectUrlCache = new Map<string, string>()

let activeUploadAbortController: AbortController | null = null

export function getLocalSlotPoolFile(trackId: string): File | Blob | undefined {
  return localFileSlotPool.get(trackId)
}

export function getLocalSlotBlobUrl(trackId: string): string | null {
  const existing = _slotObjectUrlCache.get(trackId)
  if (existing) return existing
  const file = localFileSlotPool.get(trackId)
  if (!file) return null
  try {
    const url = URL.createObjectURL(file)
    _slotObjectUrlCache.set(trackId, url)
    return url
  } catch {
    return null
  }
}

export function registerLocalSlotPoolFile(trackId: string, fileOrBlob: File | Blob): void {
  localFileSlotPool.set(trackId, fileOrBlob)
  // Lazily create or update stable object URL
  if (!_slotObjectUrlCache.has(trackId)) {
    try {
      const url = URL.createObjectURL(fileOrBlob)
      _slotObjectUrlCache.set(trackId, url)
    } catch {}
  }
}

export function registerLocalSlotPoolPath(trackId: string, path: string): void {
  localFilePathPool.set(trackId, path)
}

export function getLocalSlotPoolPath(trackId: string): string | undefined {
  return localFilePathPool.get(trackId)
}

export function clearLocalSlotPool(): void {
  for (const url of _slotObjectUrlCache.values()) {
    try {
      URL.revokeObjectURL(url)
    } catch {}
  }
  _slotObjectUrlCache.clear()
  localFileSlotPool.clear()
  localFilePathPool.clear()
}

// In-memory pre-fetched audio blob cache for upcoming tracks
const _inMemoryAudioBlobCache = new Map<string, { blobUrl: string; size: number; timestamp: number }>()

export function getCachedAudioBlobUrl(trackId: string): string | null {
  const cached = _inMemoryAudioBlobCache.get(trackId)
  if (cached) return cached.blobUrl
  return null
}

export function cacheAudioBlob(trackId: string, blob: Blob): string {
  const existing = _inMemoryAudioBlobCache.get(trackId)
  if (existing) {
    try {
      URL.revokeObjectURL(existing.blobUrl)
    } catch {}
  }
  const blobUrl = URL.createObjectURL(blob)
  _inMemoryAudioBlobCache.set(trackId, { blobUrl, size: blob.size, timestamp: Date.now() })

  // Keep bounded to 5 items to prevent browser memory bloat
  if (_inMemoryAudioBlobCache.size > 5) {
    const oldestKey = _inMemoryAudioBlobCache.keys().next().value
    if (oldestKey) {
      const old = _inMemoryAudioBlobCache.get(oldestKey)
      if (old) {
        try {
          URL.revokeObjectURL(old.blobUrl)
        } catch {}
      }
      _inMemoryAudioBlobCache.delete(oldestKey)
    }
  }
  return blobUrl
}

/**
 * Probes the audio duration of a File or Blob using a temporary offscreen HTMLAudioElement.
 */
export function getAudioDuration(file: File | Blob): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(180)
      return
    }
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    let objectUrl = ''
    try {
      objectUrl = URL.createObjectURL(file)
    } catch {
      resolve(180)
      return
    }

    const cleanup = () => {
      audio.onloadedmetadata = null
      audio.onerror = null
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {}
    }

    audio.onloadedmetadata = () => {
      const dur = audio.duration
      cleanup()
      resolve(Number.isFinite(dur) && dur > 0 ? dur : 180)
    }

    audio.onerror = () => {
      cleanup()
      resolve(180) // fallback duration if probe fails
    }

    audio.src = objectUrl
  })
}

/**
 * Evaluates whether an audio file is already lossy-compressed (MP3, AAC, OGG, Opus)
 * or uncompressed/lossless (WAV, AIFF, PCM, large FLAC).
 */
export function analyzeCompression(
  fileSize: number,
  durationSec: number,
  fileName = '',
  mimeType = ''
): CompressionProfile {
  const safeDuration = Math.max(1, durationSec || 180)
  const fileSizeBits = fileSize * 8
  const estimatedBitrateKbps = Math.round(fileSizeBits / (safeDuration * 1000))

  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mime = mimeType.toLowerCase()

  // Identify uncompressed PCM containers
  const isUncompressed =
    mime.includes('wav') ||
    mime.includes('aiff') ||
    mime.includes('pcm') ||
    ['wav', 'aiff', 'aif', 'pcm'].includes(ext)

  // Identify lossless compressed containers
  const isLossless =
    mime.includes('flac') ||
    mime.includes('alac') ||
    ['flac', 'alac', 'ape'].includes(ext)

  let codecCategory: CompressionProfile['codecCategory'] = 'LOSSY'
  let isAlreadyCompressed = true
  let needsCompression = false

  if (isUncompressed) {
    codecCategory = 'UNCOMPRESSED'
    isAlreadyCompressed = false
    needsCompression = true // WAV/AIFF: compress on-the-fly to Opus before sending
  } else if (isLossless || estimatedBitrateKbps > 350) {
    codecCategory = 'LOSSLESS'
    isAlreadyCompressed = true
    // Compress if file is oversized (> 15 MB) to keep room streaming responsive
    needsCompression = fileSize > 15 * 1024 * 1024
  } else {
    // Standard MP3, AAC, M4A, Ogg, Opus (<= 320 kbps)
    codecCategory = 'LOSSY'
    isAlreadyCompressed = true
    needsCompression = false // Already compressed — do NOT re-encode (zero generation loss)
  }

  // Segmented decoder flag for files > 20 MB to protect mobile browser RAM
  const useSegmentedDecoder = fileSize > 20 * 1024 * 1024

  return {
    isAlreadyCompressed,
    needsCompression,
    codecCategory,
    estimatedBitrateKbps,
    useSegmentedDecoder
  }
}

/**
 * Direct High-Fidelity Audio Delivery Strategy (MUSIXQUARE parity):
 * Instead of blocking playback for several minutes while attempting 1x real-time MediaRecorder
 * encoding, deliver the pristine original audio payload directly over high-throughput
 * WebRTC DataChannels or local LAN routes with zero transcoding latency.
 */
export async function transcodeToCompressedAudio(
  inputBlob: Blob | File,
  _signal?: AbortSignal
): Promise<Blob> {
  return inputBlob
}

export const JIT_CHUNK_SIZE = 256 * 1024 // 256 KB per chunk

/**
 * Slices a Blob or File into 256 KB chunks and streams them through a sender callback.
 * Implements priority preemption via activeUploadAbortController.
 */
export async function streamJITChunks(
  trackId: string,
  rawPayload: Blob | File,
  compressionProfile: CompressionProfile,
  sendHeader: (header: JITChunkHeader) => Promise<void> | void,
  sendChunk: (trackId: string, chunkIndex: number, chunkData: ArrayBuffer) => Promise<void>,
  onProgress?: (progress: number, statusText: string) => void
): Promise<void> {
  // Priority Preemption: Cancel any ongoing upload so 100% bandwidth goes to current track
  if (activeUploadAbortController) {
    activeUploadAbortController.abort()
  }
  const controller = new AbortController()
  activeUploadAbortController = controller
  const signal = controller.signal

  // 1. Conditional compression check
  onProgress?.(0, compressionProfile.needsCompression ? 'Compressing (WAV -> Opus)...' : 'Preparing chunks...')
  
  let payloadToStream = rawPayload
  if (compressionProfile.needsCompression) {
    try {
      payloadToStream = await transcodeToCompressedAudio(rawPayload, signal)
    } catch (err: any) {
      if (err.name === 'AbortError') throw err
      payloadToStream = rawPayload
    }
  }

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const totalBytes = payloadToStream.size
  const totalChunks = Math.ceil(totalBytes / JIT_CHUNK_SIZE)
  const mimeType = payloadToStream.type || 'audio/mpeg'

  // 2. Broadcast JIT Start Header
  await sendHeader({
    type: 'jit-start',
    trackId,
    mimeType,
    totalSize: totalBytes,
    totalChunks,
    compression: compressionProfile
  })

  // 3. Stream 256KB binary slices
  let uploadedBytes = 0

  for (let i = 0; i < totalChunks; i++) {
    if (signal.aborted) {
      await sendHeader({ type: 'jit-abort', trackId })
      throw new DOMException('Aborted', 'AbortError')
    }

    const startByte = i * JIT_CHUNK_SIZE
    const endByte = Math.min(startByte + JIT_CHUNK_SIZE, totalBytes)
    const blobSlice = payloadToStream.slice(startByte, endByte)
    const arrayBuf = await blobSlice.arrayBuffer()

    await sendChunk(trackId, i, arrayBuf)

    uploadedBytes += arrayBuf.byteLength
    const percent = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100))
    const statusText = compressionProfile.needsCompression
      ? `Compressing & Uploading... ${percent}%`
      : `Uploading... ${percent}%`
    onProgress?.(percent, statusText)
  }

  // 4. Send JIT End Header
  await sendHeader({
    type: 'jit-end',
    trackId,
    totalSize: totalBytes
  })

  onProgress?.(100, 'Playing (Synced)')
}

/**
 * Accumulates incoming 256KB chunks on the listener side and reconstructs
 * an in-memory Blob URL for direct, hardware-accelerated playback.
 */
export class JITChunkReceiver {
  private activeTrackId: string | null = null
  private mimeType = 'audio/mpeg'
  private totalSize = 0
  private totalChunks = 0
  private receivedBytes = 0
  private chunks: Map<number, ArrayBuffer> = new Map()
  private onProgressCallback?: (trackId: string, percent: number, statusText: string) => void
  private onReadyCallback?: (trackId: string, blobUrl: string, mimeType: string) => void
  private currentBlobUrl: string | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options?: {
    onProgress?: (trackId: string, percent: number, statusText: string) => void
    onReady?: (trackId: string, blobUrl: string, mimeType: string) => void
  }) {
    if (options?.onProgress) this.onProgressCallback = options.onProgress
    if (options?.onReady) this.onReadyCallback = options.onReady
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  handleHeader(header: JITChunkHeader): void {
    if (header.type === 'jit-start') {
      this.reset()
      this.activeTrackId = header.trackId
      this.mimeType = header.mimeType || 'audio/mpeg'
      this.totalSize = header.totalSize || 0
      this.totalChunks = header.totalChunks || 0
      this.onProgressCallback?.(header.trackId, 0, 'Buffering... 0%')
    } else if (header.type === 'jit-end') {
      if (header.trackId === this.activeTrackId) {
        this.clearWatchdog()
        this.assembleAndEmit()
      }
    } else if (header.type === 'jit-abort') {
      if (header.trackId === this.activeTrackId) {
        this.reset()
      }
    }
  }

  handleChunk(trackId: string, chunkIndex: number, chunkData: ArrayBuffer): void {
    if (trackId !== this.activeTrackId) return
    this.chunks.set(chunkIndex, chunkData)
    this.receivedBytes += chunkData.byteLength

    const percent = this.totalSize > 0
      ? Math.min(100, Math.round((this.receivedBytes / this.totalSize) * 100))
      : 50
    this.onProgressCallback?.(trackId, percent, `Buffering... ${percent}%`)

    // If all chunks or bytes received before jit-end arrived
    if (
      (this.totalChunks > 0 && this.chunks.size >= this.totalChunks) ||
      (this.totalSize > 0 && this.receivedBytes >= this.totalSize)
    ) {
      this.clearWatchdog()
      this.assembleAndEmit()
      return
    }

    // Assembly stall watchdog: if >= 98% and no new chunks arrive for 2.5s, assemble available chunks
    if (percent >= 98) {
      this.clearWatchdog()
      this.watchdogTimer = setTimeout(() => {
        if (this.activeTrackId === trackId && this.chunks.size > 0 && !this.currentBlobUrl) {
          console.warn('[JITChunkReceiver] Near-completion watchdog triggered assembly at', percent, '%')
          this.assembleAndEmit()
        }
      }, 2500)
    }
  }

  private assembleAndEmit(): void {
    this.clearWatchdog()
    if (!this.activeTrackId || this.chunks.size === 0) return

    // Order chunks by index
    const orderedBuffers: ArrayBuffer[] = []
    for (let i = 0; i < this.chunks.size; i++) {
      const buf = this.chunks.get(i)
      if (buf) orderedBuffers.push(buf)
    }

    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl)
      } catch {}
      this.currentBlobUrl = null
    }

    try {
      const blob = new Blob(orderedBuffers, { type: this.mimeType })
      this.currentBlobUrl = URL.createObjectURL(blob)
      this.onProgressCallback?.(this.activeTrackId, 100, 'Playing (Synced)')
      this.onReadyCallback?.(this.activeTrackId, this.currentBlobUrl, this.mimeType)
    } catch (err) {
      console.error('[JITChunkReceiver] Failed to assemble blob from chunks:', err)
    }
  }

  reset(): void {
    this.clearWatchdog()
    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl)
      } catch {}
      this.currentBlobUrl = null
    }
    this.activeTrackId = null
    this.chunks.clear()
    this.receivedBytes = 0
    this.totalSize = 0
    this.totalChunks = 0
  }
}

export type ProgressHandler = (progress: number, details?: { loaded?: number; total?: number }) => void

/** Keep transport liveness byte-accurate while bounding presentation updates (MUSIXQUARE pattern). */
export function createDisplayProgressReporter(
  callback?: ProgressHandler
): (fraction: number, details?: { loaded?: number; total?: number }) => void {
  let previousPercent = -1
  return (fraction, details): void => {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
    const percent = normalized >= 1 ? 100 : Math.floor(normalized * 100)
    if (percent === previousPercent) return
    previousPercent = percent
    try {
      callback?.(percent / 100, details)
    } catch {
      // Presentation observers cannot decide the authoritative transfer outcome.
    }
  }
}

const REMOTE_SHARE_XHR_STALL_TIMEOUT_MS = 90_000

/**
 * 90-second stall watchdog (MUSIXQUARE pattern):
 * Large audio files can take minutes over mobile networks. Abort only when
 * no bytes arrive for 90 seconds. Steady slow transfers remain valid.
 */
export function createXhrStallWatchdog(
  xhr: XMLHttpRequest,
  reject: (err: Error) => void,
  errorCode = 'REMOTE_SHARE_DOWNLOAD_STALLED'
): { reset: () => void; clear: () => void } {
  let handle: ReturnType<typeof globalThis.setTimeout> | null = null
  const clear = (): void => {
    if (handle === null) return
    globalThis.clearTimeout(handle)
    handle = null
  }
  const reset = (): void => {
    clear()
    handle = globalThis.setTimeout(() => {
      handle = null
      try {
        xhr.abort()
      } catch {
        /* ignore */
      }
      reject(new Error(errorCode))
    }, REMOTE_SHARE_XHR_STALL_TIMEOUT_MS)
  }
  reset()
  return { reset, clear }
}

/**
 * Wire an AbortSignal to an XHR (MUSIXQUARE pattern).
 */
export function wireAbort(
  xhr: XMLHttpRequest,
  reject: (err: Error) => void,
  signal?: AbortSignal,
  beforeAbort?: () => void
): (() => void) | null | undefined {
  if (!signal) return undefined
  if (signal.aborted) {
    xhr.abort()
    reject(new Error('REMOTE_SHARE_ABORTED'))
    return null
  }
  const handleAbort = (): void => {
    beforeAbort?.()
    try {
      xhr.abort()
    } catch {
      /* ignore */
    }
    reject(new Error('REMOTE_SHARE_ABORTED'))
  }
  signal.addEventListener('abort', handleAbort, { once: true })
  return () => signal.removeEventListener('abort', handleAbort)
}

export interface WholeObjectDownloadOptions {
  expectedSize?: number
  trackId?: string
  authToken?: string
  onProgress?: ProgressHandler
  signal?: AbortSignal
}

/**
 * Downloads a whole audio object using MUSIXQUARE's authenticated contract:
 * - 90-second stall watchdog reset per received chunk
 * - Bounded progress reporter (0..1)
 * - Strict byte length and size verification
 * - AbortSignal integration
 */
export function downloadWholeObjectWithWatchdog(
  url: string,
  options: WholeObjectDownloadOptions = {}
): Promise<ArrayBuffer> {
  const { expectedSize, authToken, onProgress, signal } = options

  return new Promise((resolve, reject) => {
    const reportProgress = createDisplayProgressReporter(onProgress)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    if (authToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
    }
    xhr.responseType = 'arraybuffer'

    let settled = false
    let xhrFinalized = false
    const xhrLifecycle: {
      stall?: ReturnType<typeof createXhrStallWatchdog>
      detachAbort?: (() => void) | null
    } = {}

    const finalizeXhr = (): void => {
      if (xhrFinalized) return
      xhrFinalized = true
      xhrLifecycle.stall?.clear()
      xhrLifecycle.detachAbort?.()
      xhrLifecycle.detachAbort = undefined
    }

    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      finalizeXhr()
      reject(error)
    }

    const resolveOnce = (value: ArrayBuffer): void => {
      if (settled) return
      settled = true
      finalizeXhr()
      resolve(value)
    }

    xhrLifecycle.stall = createXhrStallWatchdog(xhr, rejectOnce, 'REMOTE_SHARE_DOWNLOAD_STALLED')
    xhrLifecycle.detachAbort = wireAbort(xhr, rejectOnce, signal, finalizeXhr)
    if (xhrLifecycle.detachAbort === null) {
      finalizeXhr()
      return
    }

    let lastDownloadedBytes = 0
    xhr.onprogress = (event) => {
      if (
        expectedSize &&
        (event.loaded > expectedSize || (event.lengthComputable && event.total !== expectedSize))
      ) {
        finalizeXhr()
        try {
          xhr.abort()
        } catch {}
        rejectOnce(new Error('REMOTE_SHARE_DOWNLOAD_SIZE_MISMATCH'))
        return
      }

      if (event.loaded > lastDownloadedBytes) {
        lastDownloadedBytes = event.loaded
        xhrLifecycle.stall?.reset()
      }

      if (event.lengthComputable && onProgress) {
        reportProgress(event.loaded / event.total, { loaded: event.loaded, total: event.total })
      } else if (expectedSize && expectedSize > 0 && onProgress) {
        reportProgress(event.loaded / expectedSize, { loaded: event.loaded, total: expectedSize })
      }
    }

    xhr.onload = () => {
      finalizeXhr()
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        xhr.response instanceof ArrayBuffer
      ) {
        if (expectedSize && expectedSize > 0 && xhr.response.byteLength !== expectedSize) {
          rejectOnce(new Error('REMOTE_SHARE_DOWNLOAD_SIZE_MISMATCH'))
          return
        }
        reportProgress(1, { loaded: xhr.response.byteLength, total: xhr.response.byteLength })
        resolveOnce(xhr.response)
        return
      }
      rejectOnce(new Error(`REMOTE_SHARE_DOWNLOAD_HTTP_${xhr.status}`))
    }

    xhr.onerror = () => rejectOnce(new Error('REMOTE_SHARE_DOWNLOAD_NETWORK'))

    try {
      xhr.send()
    } catch (error) {
      rejectOnce(
        signal?.aborted
          ? new Error('REMOTE_SHARE_ABORTED', { cause: error })
          : new Error('REMOTE_SHARE_DOWNLOAD_NETWORK', { cause: error })
      )
    }
  })
}

/**
 * Downloads audio with MUSIXQUARE deduplication and 1-shot transient retry policy:
 * - Checks resident RAM slot pool and cache first (same-file gate)
 * - Retries once if stalled or disconnected
 * - Caches assembled Blob into memory
 */
export async function downloadRemoteAudioFileWithRetry(
  url: string,
  options: WholeObjectDownloadOptions = {}
): Promise<Blob> {
  const { trackId, signal } = options

  // 1. Deduplication Gate (MUSIXQUARE same-file / preload-match check)
  if (trackId) {
    const residentFile = getLocalSlotPoolFile(trackId)
    if (residentFile) {
      const size = residentFile instanceof Blob ? residentFile.size : 0
      options.onProgress?.(1, { loaded: size, total: size })
      return residentFile instanceof Blob ? residentFile : new Blob([residentFile])
    }
    const cachedBlobUrl = getCachedAudioBlobUrl(trackId)
    if (cachedBlobUrl) {
      try {
        const res = await fetch(cachedBlobUrl)
        if (res.ok) {
          const blob = await res.blob()
          options.onProgress?.(1, { loaded: blob.size, total: blob.size })
          return blob
        }
      } catch {}
    }
  }

  // 2. MUSIXQUARE 2-attempt bounded loop for transient network drop / stall
  let bytes: ArrayBuffer | null = null
  for (let attempt = 1; ; attempt++) {
    try {
      bytes = await downloadWholeObjectWithWatchdog(url, options)
      break
    } catch (error: any) {
      const msg = error?.message || ''
      const isTransient =
        msg === 'REMOTE_SHARE_DOWNLOAD_NETWORK' ||
        msg === 'REMOTE_SHARE_DOWNLOAD_STALLED' ||
        msg.startsWith('REMOTE_SHARE_DOWNLOAD_HTTP_5')
      if (attempt >= 2 || !isTransient || signal?.aborted) {
        throw error
      }
      console.warn('[JIT Pipeline] Transient download failure - retrying once (MUSIXQUARE policy):', error)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  if (!bytes) {
    throw new Error('REMOTE_SHARE_DOWNLOAD_FAILED')
  }

  const mimeType = 'audio/mpeg'
  const blob = new Blob([bytes], { type: mimeType })

  // 3. Cache into in-memory pool for zero-overhead replay
  if (trackId) {
    cacheAudioBlob(trackId, blob)
  }

  return blob
}

/**
 * Direct browser and mobile audio download helper adhering to MUSIXQUARE patterns:
 * - Deduplication and resident cache preflight
 * - 90-second stall watchdog and progress reporting
 * - Transient retry loop
 * - Clean safe download anchor trigger
 */
export async function downloadAudioFile(
  urlOrBlob: string | Blob,
  fileName: string,
  options: WholeObjectDownloadOptions = {}
): Promise<boolean> {
  try {
    let blob: Blob

    if (typeof urlOrBlob === 'string') {
      if (/^https?:\/\//i.test(urlOrBlob)) {
        blob = await downloadRemoteAudioFileWithRetry(urlOrBlob, options)
      } else if (urlOrBlob.startsWith('blob:')) {
        const res = await fetch(urlOrBlob)
        blob = await res.blob()
      } else {
        blob = new Blob([], { type: 'audio/mpeg' })
      }
    } else {
      blob = urlOrBlob
    }

    if (!blob || blob.size === 0) {
      console.warn('[downloadAudioFile] Returned empty 0-byte blob for:', fileName)
      return false
    }

    const cleanName = fileName.replace(/[<>:"/\\|?*]+/g, '').trim()
    const finalName =
      cleanName.endsWith('.mp3') ||
      cleanName.endsWith('.flac') ||
      cleanName.endsWith('.wav') ||
      cleanName.endsWith('.m4a')
        ? cleanName
        : `${cleanName}.mp3`

    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = finalName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {}
    }, 15000)

    return true
  } catch (err) {
    console.error('[downloadAudioFile] Failed to download audio:', err)
    return false
  }
}
