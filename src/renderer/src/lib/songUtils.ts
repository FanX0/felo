import type { Song } from '../pages/Library/Library'
import type { PlaybackContext } from '../hooks/usePlayerStore'
import { isElectron } from './appConfig'

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
  if (isElectron && !song.isOnline && song.filePath && !song.filePath.startsWith('virtual:')) {
    return true
  }

  return false
}
