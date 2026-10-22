import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard, readFromClipboard } from '../../../src/renderer/src/lib/clipboard'

describe('Clipboard Utility (copyToClipboard & readFromClipboard)', () => {
  const originalWindow = global.window
  const originalNavigator = global.navigator
  const originalDocument = global.document

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // restore globals if modified
  })

  describe('copyToClipboard', () => {
    it('returns false when passing an empty string or non-string', async () => {
      expect(await copyToClipboard('')).toBe(false)
      expect(await copyToClipboard(null as any)).toBe(false)
      expect(await copyToClipboard(undefined as any)).toBe(false)
    })

    it('uses window.api.writeClipboard when available (Electron environment)', async () => {
      const mockWrite = vi.fn().mockResolvedValue(true)
      ;(window as any).api = {
        writeClipboard: mockWrite
      }

      const result = await copyToClipboard('TQQHMO')
      expect(result).toBe(true)
      expect(mockWrite).toHaveBeenCalledWith('TQQHMO')

      ;(window as any).api = undefined
    })

    it('falls back to navigator.clipboard.writeText if window.api.writeClipboard fails', async () => {
      const mockWriteApi = vi.fn().mockRejectedValue(new Error('IPC failed'))
      const mockWriteNav = vi.fn().mockResolvedValue(undefined)
      ;(window as any).api = {
        writeClipboard: mockWriteApi
      }
      Object.assign(navigator, {
        clipboard: {
          writeText: mockWriteNav
        }
      })

      const result = await copyToClipboard('TQQHMO')
      expect(result).toBe(true)
      expect(mockWriteApi).toHaveBeenCalledWith('TQQHMO')
      expect(mockWriteNav).toHaveBeenCalledWith('TQQHMO')

      ;(window as any).api = undefined
    })

    it('falls back to document.execCommand copy if navigator.clipboard throws', async () => {
      ;(window as any).api = undefined
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error('Document is not focused'))
        }
      })

      const execCommandSpy = vi.fn().mockReturnValue(true)
      document.execCommand = execCommandSpy

      const result = await copyToClipboard('TQQHMO')
      expect(result).toBe(true)
      expect(execCommandSpy).toHaveBeenCalledWith('copy')
    })
  })

  describe('readFromClipboard', () => {
    it('uses window.api.readClipboard when available', async () => {
      const mockRead = vi.fn().mockResolvedValue('PASTED_CODE')
      ;(window as any).api = {
        readClipboard: mockRead
      }

      const result = await readFromClipboard()
      expect(result).toBe('PASTED_CODE')
      expect(mockRead).toHaveBeenCalledTimes(1)

      ;(window as any).api = undefined
    })

    it('falls back to navigator.clipboard.readText if window.api.readClipboard fails', async () => {
      const mockReadApi = vi.fn().mockRejectedValue(new Error('IPC read failed'))
      const mockReadNav = vi.fn().mockResolvedValue('NAVIGATOR_PASTE')
      ;(window as any).api = {
        readClipboard: mockReadApi
      }
      Object.assign(navigator, {
        clipboard: {
          readText: mockReadNav
        }
      })

      const result = await readFromClipboard()
      expect(result).toBe('NAVIGATOR_PASTE')
      expect(mockReadNav).toHaveBeenCalledTimes(1)

      ;(window as any).api = undefined
    })

    it('returns empty string if all clipboard reading mechanisms fail', async () => {
      ;(window as any).api = undefined
      Object.assign(navigator, {
        clipboard: {
          readText: vi.fn().mockRejectedValue(new Error('Permission denied'))
        }
      })

      const result = await readFromClipboard()
      expect(result).toBe('')
    })
  })
})
