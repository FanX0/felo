import type { LibrarySortKey } from './types'

export const sortLabels: Record<LibrarySortKey, string> = {
  default: 'Original order',
  title: 'Title',
  dateAdded: 'Recently added',
  artist: 'Artist',
  album: 'Album',
  duration: 'Duration'
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const totalSeconds = Math.floor(seconds)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '0 MB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function formatRelativeDate(timestamp?: number): string {
  if (!timestamp) return 'Unknown'
  const ms = timestamp > 1e11 ? timestamp : timestamp * 1000
  const elapsed = Math.max(0, Date.now() - ms)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

export { getCleanDeviceName } from '../../lib/deviceInfo'
