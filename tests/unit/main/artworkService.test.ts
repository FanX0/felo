import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ArtworkService } from '../../../src/main/services/ArtworkService'

describe('Main Process: ArtworkService', () => {
  const tmpDir = path.join(os.tmpdir(), `felo-art-vitest-${Date.now()}`)

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  describe('detectImageExtension', () => {
    it('detects JPEG format by magic bytes', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
      expect(ArtworkService.detectImageExtension(jpeg)).toBe('jpg')
    })

    it('detects PNG format by magic bytes', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(ArtworkService.detectImageExtension(png)).toBe('png')
    })

    it('detects WebP format by magic bytes', () => {
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])
      expect(ArtworkService.detectImageExtension(webp)).toBe('webp')
    })

    it('detects GIF format by magic bytes', () => {
      const gif = Buffer.from('GIF89a...')
      expect(ArtworkService.detectImageExtension(gif)).toBe('gif')
    })

    it('returns null for HTML, text, or corrupted headers', () => {
      const html = Buffer.from('<!DOCTYPE html><html>404 Not Found</html>')
      expect(ArtworkService.detectImageExtension(html)).toBeNull()
      expect(ArtworkService.detectImageExtension(Buffer.alloc(4))).toBeNull()
    })
  })

  describe('isValidArtworkFile', () => {
    it('flags empty, null, or non-existent files as invalid', () => {
      expect(ArtworkService.isValidArtworkFile('')).toBe(false)
      expect(ArtworkService.isValidArtworkFile(null)).toBe(false)
      expect(ArtworkService.isValidArtworkFile(path.join(tmpDir, 'nonexistent.jpg'))).toBe(false)
    })

    it('flags 0-byte or corrupted small files as invalid', () => {
      const zeroFile = path.join(tmpDir, 'zero.jpg')
      fs.writeFileSync(zeroFile, Buffer.alloc(0))
      expect(ArtworkService.isValidArtworkFile(zeroFile)).toBe(false)

      const smallInvalidFile = path.join(tmpDir, 'small.jpg')
      fs.writeFileSync(smallInvalidFile, Buffer.from('not an image'))
      expect(ArtworkService.isValidArtworkFile(smallInvalidFile)).toBe(false)
    })

    it('validates authentic image files on disk', () => {
      const validFile = path.join(tmpDir, 'valid.jpg')
      const validHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
      const validData = Buffer.concat([validHeader, Buffer.alloc(300, 0xaa)])
      fs.writeFileSync(validFile, validData)

      expect(ArtworkService.isValidArtworkFile(validFile)).toBe(true)
    })
  })
})
