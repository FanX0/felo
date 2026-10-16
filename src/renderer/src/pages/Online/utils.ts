export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

export function getSongKey(song?: any): string {
  if (!song) return ''
  return `${song.artist} - ${song.title}`.trim().toLowerCase()
}

export function sanitizeCodeInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const urlCodeMatch = trimmed.match(/[?&]code=([A-Za-z0-9]+)/i)
  const directMatch = trimmed.match(/([A-Za-z0-9]{6})/i)
  if (trimmed.length > 8) {
    const extracted = urlCodeMatch ? urlCodeMatch[1] : (directMatch ? directMatch[1] : trimmed)
    return extracted.toUpperCase().trim().slice(0, 8)
  }
  return trimmed.toUpperCase()
}
