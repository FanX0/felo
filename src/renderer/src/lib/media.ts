export function toMediaUrl(filePath?: string | null) {
  if (!filePath) return null
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `media://local/${encodeURIComponent(normalizedPath)}`
}
