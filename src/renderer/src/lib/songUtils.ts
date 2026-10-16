import type { Song } from '../pages/Library/Library'
import type { PlaybackContext } from '../hooks/usePlayerStore'
import { isElectron } from './appConfig'
import { stripRecognizedAudioFileExtension } from './audioFile'

/**
 * Determines whether a song is stored locally on this machine/device.
 * Local songs include:
 * - Songs explicitly marked isOnline === false
 * - Songs flagged with isLocal: true
 * - Local filesystem file paths (e.g. C:\..., /storage/..., media://local/...)
 * - Local browser blob URLs (blob:...)
 * - Songs played within a local library playback context ("Your Library", "My Library", "This Device")
 * - In Electron desktop app: tracks with local file paths and not marked as online
 */
export function isLocalSong(song?: Song | null, context?: PlaybackContext | null): boolean {
  if (!song) return false

  if (!isElectron) {
    if (song.filePath?.startsWith('blob:')) return true
    if ((song as any).isLocalToDevice === true) return true
    if (
      context?.type === 'library' &&
      (context.title === 'This Device' ||
        context.title === 'Phone Storage' ||
        context.title === 'Your Library' ||
        context.title === 'My Library' ||
        context.title === 'Local Songs')
    ) {
      return true
    }
    return false
  }

  // In Electron desktop environment:
  // 1. Context check: if playing from local device library
  if (
    context?.type === 'library' &&
    (context.title === 'Your Library' ||
      context.title === 'My Library' ||
      context.title === 'This Device')
  ) {
    return true
  }

  // 2. Explicit flag checks
  if (song.isOnline === false || (song as any).isLocal === true) {
    return true
  }

  // 3. Native local file path checks
  if (song.filePath) {
    if (song.filePath.startsWith('blob:') || song.filePath.startsWith('media://local/')) {
      return true
    }
    // If it's not a remote HTTP/HTTPS or virtual stream URL, it's a local file path
    if (!/^(https?:|data:|virtual:)/i.test(song.filePath)) {
      return true
    }
  }

  // 4. In Electron desktop app, songs without isOnline true are local files
  if (!song.isOnline && song.filePath && !song.filePath.startsWith('virtual:')) {
    return true
  }

  return false
}

export const UNAVAILABLE_TIME_TEXT = '-:--'

/**
 * MUSIXQUARE-standard playback time formatter.
 * Formats seconds into "m:ss" or "h:mm:ss" (when duration >= 1 hour).
 * Keeps short tracks as "m:ss" and promotes long tracks (podcasts, DJ sets)
 * to "h:mm:ss" with zero-padded minutes.
 * Returns fallback (default "-:--") when value is not finite or duration is unavailable.
 */
export function fmtTime(s?: number | null, fallback = UNAVAILABLE_TIME_TEXT): string {
  if (s == null || !Number.isFinite(s) || s < 0) return fallback
  const total = Math.max(0, Math.floor(s))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const ss = sec < 10 ? `0${sec}` : `${sec}`
  if (h > 0) {
    const mm = m < 10 ? `0${m}` : `${m}`
    return `${h}:${mm}:${ss}`
  }
  return `${m}:${ss}`
}

/**
 * Resolve user-facing track title without changing the underlying filename
 * or file path (direct port from MUSIXQUARE track-display.ts).
 */
export function getTrackDisplayTitle(
  track?: { title?: string | null; name?: string | null; filePath?: string | null } | null,
  fallback = 'Unknown Track'
): string {
  if (!track) return fallback
  const title = typeof track.title === 'string' ? track.title.trim() : ''
  const name = typeof track.name === 'string' ? track.name.trim() : ''
  const filename = track.filePath ? track.filePath.split(/[/\\]/).pop() || '' : ''
  const effectiveName = name || filename

  if (title && title !== effectiveName) return title
  return stripRecognizedAudioFileExtension(effectiveName || title) || fallback
}
