export function toMediaUrl(filePath?: string | null) {
  if (!filePath) return null
  if (/^(blob:|data:|https?:)/i.test(filePath)) return filePath
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `media://local/${encodeURIComponent(normalizedPath)}`
}
