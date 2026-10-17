import { getSupabase, isSupabaseConfigured } from './supabase'

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB
export const ALLOWED_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const ALLOWED_AVATAR_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']

/**
 * Validates an image file before upload.
 */
export function validateAvatarFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file selected.' }
  }

  const type = file.type?.toLowerCase() || ''
  if (!ALLOWED_AVATAR_MIME_TYPES.includes(type)) {
    return {
      valid: false,
      error: 'Unsupported image format. Please select a PNG, JPEG, WebP, or GIF image.'
    }
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `Image file is too large (${sizeMb} MB). Maximum allowed size is 5 MB.`
    }
  }

  return { valid: true }
}

/**
 * Extracts a File object from clipboard DataTransfer (items or files) if an image is present.
 */
export function extractImageFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null

  // 1. Check DataTransferItemList (items)
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          const ext =
            blob.type === 'image/jpeg'
              ? 'jpg'
              : blob.type === 'image/webp'
                ? 'webp'
                : blob.type === 'image/gif'
                  ? 'gif'
                  : 'png'
          return new File([blob], `pasted-image-${Date.now()}.${ext}`, { type: blob.type })
        }
      }
    }
  }

  // 2. Check FileList (files)
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i]
      if (file.type.startsWith('image/')) {
        return file
      }
    }
  }

  return null
}

/**
 * Resolves a profile avatar URL or storage path to an absolute, renderable URL.
 * Supports external HTTP(S) URLs, data URLs, blob URLs, Supabase storage paths,
 * and metadata fallbacks with optional cache-busting.
 */
export function resolveAvatarUrl(
  pathOrUrl?: string | null,
  metadataFallback?: string | null,
  cacheBust?: string | number
): string | null {
  const candidate = (pathOrUrl || '').trim() || (metadataFallback || '').trim()
  if (!candidate) return null

  // Filter out invalid placeholder strings like 'null', 'undefined', etc.
  const lowered = candidate.toLowerCase()
  if (
    lowered === 'null' ||
    lowered === 'undefined' ||
    lowered === '[object object]' ||
    lowered === 'none' ||
    lowered === 'false' ||
    lowered === 'true' ||
    lowered === 'nan'
  ) {
    return null
  }

  // If already an absolute web URL, data URI, or blob URI:
  if (/^(blob:|data:|https?:)/i.test(candidate)) {
    if (cacheBust && !candidate.startsWith('blob:') && !candidate.startsWith('data:')) {
      return appendCacheBust(candidate, cacheBust)
    }
    return candidate
  }

  // If it's a Supabase storage path (e.g. "avatars/{userId}/xxx.png" or "{userId}/xxx.png")
  let cleanPath = candidate.replace(/^\/+/, '')
  if (cleanPath.startsWith('avatars/')) {
    cleanPath = cleanPath.slice('avatars/'.length)
  }

  if (!cleanPath) return null

  try {
    if (isSupabaseConfigured) {
      const { data } = getSupabase().storage.from('avatars').getPublicUrl(cleanPath)
      if (data?.publicUrl) {
        return cacheBust ? appendCacheBust(data.publicUrl, cacheBust) : data.publicUrl
      }
    }
  } catch (err) {
    console.warn('[Avatar] Failed to resolve Supabase avatar URL:', err)
  }

  return null
}

/**
 * Appends a cache-busting query parameter to a URL safely.
 */
function appendCacheBust(url: string, cacheBust: string | number): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('t', String(cacheBust))
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}t=${encodeURIComponent(String(cacheBust))}`
  }
}

/**
 * Generates 1-2 uppercase initial characters from a display name or username.
 */
export function getInitials(name?: string | null, maxInitials = 2): string {
  if (!name) return '?'
  const clean = name.trim()
  if (!clean) return '?'

  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    if (maxInitials === 1) {
      return (parts[0][0] || '').toUpperCase()
    }
    const first = parts[0][0] || ''
    const second = parts[parts.length - 1][0] || ''
    return (first + second).toUpperCase()
  }

  return clean.slice(0, 1).toUpperCase()
}

/**
 * Uploads a profile avatar image to the public Supabase 'avatars' bucket.
 * Returns the resolved public URL of the uploaded avatar.
 */
export async function uploadAvatarImage(file: File, userId: string): Promise<string> {
  const validation = validateAvatarFile(file)
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid avatar image')
  }

  if (!userId) {
    throw new Error('User authentication required to upload avatar')
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const safeExt = ALLOWED_AVATAR_EXTENSIONS.includes(ext) ? ext : 'png'
  const filePath = `${userId}/avatar-${Date.now()}.${safeExt}`

  const supabase = getSupabase()
  const { data, error } = await supabase.storage.from('avatars').upload(filePath, file, {
    contentType: file.type,
    upsert: true
  })

  if (error) {
    throw error
  }

  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(data.path)
  return publicUrlData.publicUrl
}

/**
 * Deletes an avatar image from the 'avatars' storage bucket if it belongs to the user.
 */
export async function deleteAvatarImage(avatarUrlOrPath: string, userId: string): Promise<void> {
  if (!avatarUrlOrPath || !userId) return

  let relativePath = avatarUrlOrPath
  if (relativePath.includes('/storage/v1/object/public/avatars/')) {
    relativePath = relativePath.split('/storage/v1/object/public/avatars/')[1]
  } else if (relativePath.startsWith('avatars/')) {
    relativePath = relativePath.slice('avatars/'.length)
  }

  // Strip query parameters
  relativePath = relativePath.split('?')[0]

  // Enforce security boundary: only delete from own directory
  if (!relativePath.startsWith(`${userId}/`)) {
    return
  }

  try {
    const supabase = getSupabase()
    await supabase.storage.from('avatars').remove([relativePath])
  } catch (err) {
    console.warn('[Avatar] Failed to delete avatar from storage:', err)
  }
}
