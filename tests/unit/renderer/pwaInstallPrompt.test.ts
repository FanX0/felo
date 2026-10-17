import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { detectOS, checkIsStandalone } from '../../../src/renderer/src/hooks/usePwaInstallPrompt'

describe('usePwaInstallPrompt OS detection', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true
    })
  })

  it('detects Android user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      configurable: true
    })
    expect(detectOS()).toBe('android')
  })

  it('detects iOS iPhone user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      configurable: true
    })
    expect(detectOS()).toBe('ios')
  })

  it('detects Windows user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true
    })
    expect(detectOS()).toBe('windows')
  })

  it('detects Mac user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true
    })
    expect(detectOS()).toBe('mac')
  })

  it('detects Linux user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true
    })
    expect(detectOS()).toBe('linux')
  })

  it('checks standalone mode correctly', () => {
    expect(typeof checkIsStandalone()).toBe('boolean')
  })
})
