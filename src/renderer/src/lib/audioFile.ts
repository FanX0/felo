/**
 * Fast, decode-free classification and duration probing for local audio files.
 * Aligned with MUSIXQUARE audio-file and decode-admission architecture.
 */

export const AUDIO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  wma: 'audio/x-ms-wma',
  alac: 'audio/mp4'
})

const GENERIC_BINARY_MIME_ESSENCES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/ogg',
  'application/x-ogg'
])

export const AUDIO_FILE_ACCEPT = `${Object.keys(AUDIO_MIME_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(',')},audio/*`

export function mimeEssence(mime?: string): string {
  return typeof mime === 'string' ? (mime.split(';', 1)[0]?.trim().toLowerCase() ?? '') : ''
}

export function filenameExtension(filename: string): string {
  return /\.([^.\\/]+)$/.exec(filename.trim().toLowerCase())?.[1] ?? ''
}

export function audioMimeForExtension(extension: string): string {
  const clean = extension.toLowerCase()
  return Object.prototype.hasOwnProperty.call(AUDIO_MIME_BY_EXTENSION, clean)
    ? AUDIO_MIME_BY_EXTENSION[clean]
    : ''
}

export function inferAudioMimeFromFilename(filename: string): string {
  return audioMimeForExtension(filenameExtension(filename))
}

export function stripRecognizedAudioFileExtension(filename: string): string {
  const match = /\.([^.\\/]+)$/.exec(filename)
  if (!match || !audioMimeForExtension(match[1]!.toLowerCase())) return filename
  return filename.slice(0, -match[0].length) || filename
}

export function meaningfulDeclaredMime(mime?: string): string {
  const declared = typeof mime === 'string' ? mime.trim() : ''
  const essence = mimeEssence(declared)
  if (essence && !GENERIC_BINARY_MIME_ESSENCES.has(essence)) return declared
  return ''
}

export function resolveAudioMime(filename: string, mime?: string): string {
  return meaningfulDeclaredMime(mime) || inferAudioMimeFromFilename(filename)
}

export function isAudioFileCandidate(file: Pick<File, 'name' | 'type'> & { size?: number }): boolean {
  if (!file || (typeof file.size === 'number' && file.size === 0)) return false
  const essence = mimeEssence(file.type)
  if (essence.startsWith('audio/')) return true
  if (essence && !GENERIC_BINARY_MIME_ESSENCES.has(essence)) return false
  return inferAudioMimeFromFilename(file.name) !== ''
}

export function partitionAudioFileCandidates(files: ArrayLike<File>): {
  accepted: File[]
  rejected: File[]
} {
  const accepted: File[] = []
  const rejected: File[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    if (!file || file.size === 0) continue
    if (isAudioFileCandidate(file)) {
      accepted.push(file)
    } else {
      rejected.push(file)
    }
  }
  return { accepted, rejected }
}

/**
 * Fast, non-blocking duration probing via standard HTML5 Audio element.
 * Adopts MUSIXQUARE decode-admission probeAudioDuration pattern.
 */
export function probeAudioDuration(blob: Blob): Promise<number | null> {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const media = document.createElement('audio')
    let objectUrl: string
    try {
      objectUrl = URL.createObjectURL(blob)
    } catch {
      resolve(null)
      return
    }

    let settled = false
    const timeoutId = window.setTimeout(() => finish(null), 3000)

    const finish = (duration: number | null): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      media.removeEventListener('loadedmetadata', onLoadedMetadata)
      media.removeEventListener('error', onError)
      try {
        media.pause()
        media.removeAttribute('src')
        media.load()
      } catch {
        // cleanup best effort
      }
      URL.revokeObjectURL(objectUrl)
      resolve(duration)
    }

    const onLoadedMetadata = (): void => {
      const dur = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null
      finish(dur)
    }

    const onError = (): void => finish(null)

    media.preload = 'metadata'
    media.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
    media.addEventListener('error', onError, { once: true })
    media.src = objectUrl
  })
}

/**
 * Recursively extracts all valid audio candidate files from a DataTransfer payload,
 * supporting individual files, multi-file selections, and deeply nested folders.
 */
export async function extractAudioFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<{ files: File[]; folderName: string }> {
  const files: File[] = []
  let detectedFolderName = 'Uploaded Music'

  const items = dataTransfer.items
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const traverseEntry = async (entry: any, path = ''): Promise<void> => {
      if (!entry) return
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file(
            (file: File) => {
              if (isAudioFileCandidate(file)) {
                const fullPath = path ? `${path}/${file.name}` : file.name
                try {
                  Object.defineProperty(file, 'webkitRelativePath', {
                    value: fullPath,
                    writable: true,
                    configurable: true
                  })
                } catch {
                  // ignore if property cannot be redefined
                }
                files.push(file)
              }
              resolve()
            },
            () => resolve()
          )
        })
      } else if (entry.isDirectory) {
        if (!path) {
          detectedFolderName = entry.name || detectedFolderName
        }
        const dirReader = entry.createReader()
        const readBatch = (): Promise<any[]> =>
          new Promise((resolve) => {
            dirReader.readEntries(
              (entries: any[]) => resolve(entries || []),
              () => resolve([])
            )
          })

        let hasMore = true
        while (hasMore) {
          const batch = await readBatch()
          if (!batch || batch.length === 0) {
            hasMore = false
            break
          }
          for (const child of batch) {
            const childPath = path ? `${path}/${entry.name}` : entry.name
            await traverseEntry(child, childPath)
          }
        }
      }
    }

    const promises: Promise<void>[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) {
        promises.push(traverseEntry(entry))
      }
    }
    await Promise.all(promises)
  }

  // Fallback to standard DataTransfer.files if items API did not yield results
  if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    const { accepted } = partitionAudioFileCandidates(dataTransfer.files)
    files.push(...accepted)
  }

  return { files, folderName: detectedFolderName }
}

export { probeAudioChannelCount, readMp3GaplessTrim, type Mp3GaplessTrim } from './audioHeader'


