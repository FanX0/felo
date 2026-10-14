import { isElectron } from './appConfig'

export function toMediaUrl(filePath?: string | null) {
  if (!filePath || filePath.startsWith('virtual:')) return null
  if (/^(blob:|data:|https?:)/i.test(filePath)) return filePath
  if (!isElectron) {
    // In web / mobile browsers, local file paths and media:// URLs are not supported
    return null
  }
  if (/^media:/i.test(filePath)) return filePath
  let cleanPath = filePath
  if (/^file:\/\//i.test(cleanPath)) {
    cleanPath = cleanPath.replace(/^file:\/\/\/?/i, '')
  }
  const normalizedPath = cleanPath.replace(/\\/g, '/').replace(/^\/+/, '')
  return `media://local/${encodeURIComponent(normalizedPath)}`
}
