import type { Song } from '../../types'

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

export function formatBytes(bytes = 0): string {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`
}

export function formatRelativeDate(timestamp: number): string {
  if (!timestamp) return ''
  const elapsed = Math.max(0, Date.now() - timestamp * 1000)
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

export function qualityLabel(song: Song): string {
  const rawFormat = String(song.codec || song.container || '').toLowerCase()
  const format =
    rawFormat.includes('mp3') || /mpeg.*layer\s*3/.test(rawFormat)
      ? 'MP3'
      : rawFormat.includes('flac')
        ? 'FLAC'
        : rawFormat.includes('m4a') || rawFormat.includes('aac')
          ? 'AAC'
          : rawFormat.includes('opus')
            ? 'OPUS'
            : rawFormat.includes('wav')
              ? 'WAV'
              : rawFormat.includes('ogg')
                ? 'OGG'
                : rawFormat.toUpperCase()
  const rate = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : ''
  const depth = song.bitDepth ? `${song.bitDepth}-bit` : ''
  const technical = [depth, rate].filter(Boolean).join(' / ')
  return [format, technical].filter(Boolean).join(' • ') || 'Unknown format'
}
