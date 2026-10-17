import { describe, it, expect } from 'vitest'
import {
  validateAvatarFile,
  getInitials,
  resolveAvatarUrl,
  deleteAvatarImage,
  MAX_AVATAR_SIZE_BYTES,
  extractImageFromClipboard
} from '../../../src/renderer/src/lib/avatar'

describe('Avatar Library: validateAvatarFile', () => {
  it('rejects missing files', () => {
    // @ts-expect-error testing undefined
    const result = validateAvatarFile(undefined)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No file selected')
  })

  it('rejects unsupported MIME types', () => {
    const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' })
    const audioFile = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })

    const textResult = validateAvatarFile(textFile)
    expect(textResult.valid).toBe(false)
    expect(textResult.error).toContain('Unsupported image format')

    const audioResult = validateAvatarFile(audioFile)
    expect(audioResult.valid).toBe(false)
    expect(audioResult.error).toContain('Unsupported image format')
  })

  it('rejects files exceeding 5MB', () => {
    const bigFile = new File([new ArrayBuffer(MAX_AVATAR_SIZE_BYTES + 1024)], 'large.png', {
      type: 'image/png'
    })
    const result = validateAvatarFile(bigFile)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('too large')
  })

  it('accepts valid PNG, JPEG, WebP, and GIF images within 5MB', () => {
    const pngFile = new File(['pngdata'], 'avatar.png', { type: 'image/png' })
    const jpegFile = new File(['jpegdata'], 'avatar.jpg', { type: 'image/jpeg' })
    const webpFile = new File(['webpdata'], 'avatar.webp', { type: 'image/webp' })
    const gifFile = new File(['gifdata'], 'avatar.gif', { type: 'image/gif' })

    expect(validateAvatarFile(pngFile).valid).toBe(true)
    expect(validateAvatarFile(jpegFile).valid).toBe(true)
    expect(validateAvatarFile(webpFile).valid).toBe(true)
    expect(validateAvatarFile(gifFile).valid).toBe(true)
  })
})

describe('Avatar Library: getInitials', () => {
  it('returns ? for undefined or empty strings', () => {
    expect(getInitials(null)).toBe('?')
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
  })

  it('returns single initial for single-word names', () => {
    expect(getInitials('Alice')).toBe('A')
    expect(getInitials('bob')).toBe('B')
  })

  it('returns first and last initials for multi-word names', () => {
    expect(getInitials('John Doe')).toBe('JD')
    expect(getInitials('alice in wonderland')).toBe('AW')
    expect(getInitials('first middle last')).toBe('FL')
  })

  it('respects maxInitials=1 for compact badge rendering', () => {
    expect(getInitials('John Doe', 1)).toBe('J')
    expect(getInitials('Tejo sunandar', 1)).toBe('T')
    expect(getInitials('Single', 1)).toBe('S')
  })
})

describe('Avatar Library: resolveAvatarUrl', () => {
  it('returns null when neither path nor fallback is provided', () => {
    expect(resolveAvatarUrl(null, null)).toBeNull()
    expect(resolveAvatarUrl('', '')).toBeNull()
  })

  it('returns null for stringified placeholder values like null, undefined, none', () => {
    expect(resolveAvatarUrl('null', null)).toBeNull()
    expect(resolveAvatarUrl('undefined', null)).toBeNull()
    expect(resolveAvatarUrl('[object Object]', null)).toBeNull()
    expect(resolveAvatarUrl('none', null)).toBeNull()
  })

  it('resolves relative storage paths to Supabase public URL', () => {
    const result = resolveAvatarUrl('user1/avatar.png', null)
    expect(result).toContain('avatars/user1/avatar.png')
  })

  it('preserves absolute URLs', () => {
    const httpsUrl = 'https://images.unsplash.com/photo-123.jpg'
    expect(resolveAvatarUrl(httpsUrl)).toBe(httpsUrl)

    const blobUrl = 'blob:http://localhost:5173/uuid-test'
    expect(resolveAvatarUrl(blobUrl)).toBe(blobUrl)

    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA'
    expect(resolveAvatarUrl(dataUrl)).toBe(dataUrl)
  })

  it('appends cache-busting timestamp to external URLs when provided', () => {
    const url = 'https://cdn.example.com/avatar.jpg'
    const result = resolveAvatarUrl(url, null, 1700000000)
    expect(result).toBe('https://cdn.example.com/avatar.jpg?t=1700000000')

    const urlWithParams = 'https://cdn.example.com/avatar.jpg?v=1'
    const result2 = resolveAvatarUrl(urlWithParams, null, '2026')
    expect(result2).toContain('t=2026')
  })

  it('falls back to metadata avatar if avatar_url is missing', () => {
    const metaUrl = 'https://lh3.googleusercontent.com/a/oauth-pic'
    expect(resolveAvatarUrl(null, metaUrl)).toBe(metaUrl)
    expect(resolveAvatarUrl('', metaUrl)).toBe(metaUrl)
  })

  it('prioritizes avatar_url over metadata fallback when present', () => {
    const avatarUrl = 'https://example.com/custom-avatar.png'
    const metaUrl = 'https://lh3.googleusercontent.com/oauth-pic'
    expect(resolveAvatarUrl(avatarUrl, metaUrl)).toBe(avatarUrl)
  })
})

describe('Avatar Library: deleteAvatarImage security check', () => {
  it('prevents deleting files outside of user folder', async () => {
    // Should safely return without error and not delete other user's files
    await expect(
      deleteAvatarImage('other_user_id/avatar.png', 'my_user_id')
    ).resolves.toBeUndefined()
  })
})

describe('Avatar Library: extractImageFromClipboard', () => {
  it('returns null for empty or null clipboard data', () => {
    expect(extractImageFromClipboard(null)).toBeNull()
    const emptyDataTransfer = { items: [], files: [] } as unknown as DataTransfer
    expect(extractImageFromClipboard(emptyDataTransfer)).toBeNull()
  })

  it('extracts image from DataTransferItemList', () => {
    const mockBlob = new Blob(['image-bytes'], { type: 'image/png' })
    const mockItem = {
      kind: 'file',
      type: 'image/png',
      getAsFile: () => mockBlob
    }
    const dataTransfer = {
      items: [mockItem],
      files: []
    } as unknown as DataTransfer

    const result = extractImageFromClipboard(dataTransfer)
    expect(result).not.toBeNull()
    expect(result?.type).toBe('image/png')
    expect(result?.name).toMatch(/^pasted-image-\d+\.png$/)
  })

  it('extracts image from FileList fallback', () => {
    const mockFile = new File(['image-bytes'], 'screenshot.webp', { type: 'image/webp' })
    const dataTransfer = {
      items: [],
      files: [mockFile]
    } as unknown as DataTransfer

    const result = extractImageFromClipboard(dataTransfer)
    expect(result).toBe(mockFile)
    expect(result?.type).toBe('image/webp')
  })

  it('ignores non-image files or text items in clipboard', () => {
    const textItem = {
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null
    }
    const pdfFile = new File(['pdf-data'], 'doc.pdf', { type: 'application/pdf' })
    const dataTransfer = {
      items: [textItem],
      files: [pdfFile]
    } as unknown as DataTransfer

    expect(extractImageFromClipboard(dataTransfer)).toBeNull()
  })
})
