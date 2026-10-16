import { describe, it, expect } from 'vitest'
import { findOAuthCallback, isValidOAuthCallback } from '../../../src/main/oauth'

describe('Main: OAuth Callback Detection & Validation', () => {
  describe('findOAuthCallback', () => {
    it('detects standard felo://auth/callback URL from command-line arguments', () => {
      const args = ['C:\\Program Files\\Felo\\felo.exe', 'felo://auth/callback?code=secret-code&sb_flow_id=slot-1']
      const result = findOAuthCallback(args)
      expect(result).toBe('felo://auth/callback?code=secret-code&sb_flow_id=slot-1')
    })

    it('strips surrounding quotes often added by Windows shell or protocol launchers', () => {
      const args = ['felo.exe', '"felo://auth/callback?code=secret-code"']
      const result = findOAuthCallback(args)
      expect(result).toBe('felo://auth/callback?code=secret-code')
    })

    it('handles trailing slash before query string', () => {
      const args = ['felo.exe', 'felo://auth/callback/?code=secret-code']
      const result = findOAuthCallback(args)
      expect(result).toBe('felo://auth/callback/?code=secret-code')
    })

    it('handles case-insensitive protocol prefix while preserving query param case', () => {
      const args = ['felo.exe', 'FELO://AUTH/CALLBACK?code=SecretCode123']
      const result = findOAuthCallback(args)
      expect(result).toBe('FELO://AUTH/CALLBACK?code=SecretCode123')
    })

    it('handles triple slash variants felo:///auth/callback', () => {
      const args = ['felo.exe', 'felo:///auth/callback?code=secret-code']
      const result = findOAuthCallback(args)
      expect(result).toBe('felo:///auth/callback?code=secret-code')
    })

    it('returns undefined when no oauth callback is present', () => {
      const args = ['felo.exe', '--inspect', '--enable-logging']
      const result = findOAuthCallback(args)
      expect(result).toBeUndefined()
    })

    it('handles empty or non-array inputs safely', () => {
      expect(findOAuthCallback([])).toBeUndefined()
      expect(findOAuthCallback(null as any)).toBeUndefined()
      expect(findOAuthCallback(undefined as any)).toBeUndefined()
    })
  })

  describe('isValidOAuthCallback', () => {
    it('validates standard felo://auth/callback with query params', () => {
      expect(isValidOAuthCallback('felo://auth/callback?code=123')).toBe(true)
    })

    it('validates felo://auth/callback with trailing slash and query params', () => {
      expect(isValidOAuthCallback('felo://auth/callback/?code=123')).toBe(true)
    })

    it('validates felo://auth/callback with hash fragment tokens', () => {
      expect(isValidOAuthCallback('felo://auth/callback#access_token=xyz&refresh_token=abc')).toBe(true)
    })

    it('validates felo:///auth/callback triple slash variant', () => {
      expect(isValidOAuthCallback('felo:///auth/callback?code=123')).toBe(true)
    })

    it('rejects invalid protocols or paths', () => {
      expect(isValidOAuthCallback('https://auth/callback?code=123')).toBe(false)
      expect(isValidOAuthCallback('felo://settings/profile')).toBe(false)
      expect(isValidOAuthCallback('not-a-url')).toBe(false)
      expect(isValidOAuthCallback('')).toBe(false)
    })
  })
})
