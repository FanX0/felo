import { describe, it, expect } from 'vitest'
import {
  AllowedSettingsKeySchema,
  DownloadLocationSchema,
  StreamingAccountsSchema,
  validateWith,
  ValidationError,
  StreamingSourceSchema,
  TransferIdSchema
} from '../../../src/shared/validators/ipcSchemas'

describe('Shared Core: ipcSchemas & Validation Security', () => {
  describe('AllowedSettingsKeySchema', () => {
    it('accepts legitimate client-configurable setting keys', () => {
      expect(AllowedSettingsKeySchema.parse('download.priority')).toBe('download.priority')
      expect(AllowedSettingsKeySchema.parse('theme')).toBe('theme')
      expect(AllowedSettingsKeySchema.parse('audio.volume')).toBe('audio.volume')
    })

    it('rejects privileged internal keys that must not be modified via settings:set', () => {
      expect(() => AllowedSettingsKeySchema.parse('felo_remote_control_token')).toThrow()
      expect(() => AllowedSettingsKeySchema.parse('felo_external_playback_api_key')).toThrow()
      expect(() => AllowedSettingsKeySchema.parse('arbitrary_injected_key')).toThrow()
    })
  })

  describe('DownloadLocationSchema security', () => {
    it('accepts valid paths', () => {
      expect(DownloadLocationSchema.parse('D:\\Music\\Downloads')).toBe('D:\\Music\\Downloads')
      expect(DownloadLocationSchema.parse('/home/user/music')).toBe('/home/user/music')
      expect(DownloadLocationSchema.parse('')).toBe('')
    })

    it('rejects null byte injection in paths', () => {
      expect(() => DownloadLocationSchema.parse('D:\\Music\\Downloads\0bad')).toThrow('null bytes')
    })

    it('blocks dangerous system root paths', () => {
      expect(() => DownloadLocationSchema.parse('C:\\')).toThrow(/System roots/)
      expect(() => DownloadLocationSchema.parse('/')).toThrow(/System roots/)
      expect(() => DownloadLocationSchema.parse('c:/windows')).toThrow(/System roots/)
      expect(() => DownloadLocationSchema.parse('C:/Program Files')).toThrow(/System roots/)
      expect(() => DownloadLocationSchema.parse('/etc/hosts')).toThrow(/System roots/)
    })
  })

  describe('StreamingAccountsSchema', () => {
    it('validates streaming credentials structure and limits length', () => {
      const validCreds = {
        qobuzAuthMethod: 'token' as const,
        qobuzUser: 'test_user',
        qobuzSecret: 'test_secret',
        deezerArl: 'arl_sample_123',
        soulseekUser: 'slsk_user',
        soulseekPassword: 'password123'
      }

      const parsed = StreamingAccountsSchema.parse(validCreds)
      expect(parsed.qobuzUser).toBe('test_user')
      expect(parsed.deezerArl).toBe('arl_sample_123')
    })

    it('rejects invalid qobuzAuthMethod enum values', () => {
      expect(() =>
        StreamingAccountsSchema.parse({
          qobuzAuthMethod: 'invalid_method'
        })
      ).toThrow()
    })
  })

  describe('StreamingSourceSchema', () => {
    it('allows valid streaming sources', () => {
      expect(StreamingSourceSchema.parse('qobuz')).toBe('qobuz')
      expect(StreamingSourceSchema.parse('deezer')).toBe('deezer')
      expect(StreamingSourceSchema.parse('soulseek')).toBe('soulseek')
      expect(StreamingSourceSchema.parse('youtube')).toBe('youtube')
    })

    it('rejects unsupported streaming sources', () => {
      expect(() => StreamingSourceSchema.parse('piratebay')).toThrow()
      expect(() => StreamingSourceSchema.parse('napster')).toThrow()
    })
  })

  describe('TransferIdSchema', () => {
    it('allows clean alphanumeric and hyphens in transfer IDs', () => {
      expect(TransferIdSchema.parse('transfer-123_abc')).toBe('transfer-123_abc')
    })

    it('rejects directory traversal characters in transfer IDs', () => {
      expect(() => TransferIdSchema.parse('../../../bad')).toThrow()
      expect(() => TransferIdSchema.parse('transfer;rm -rf')).toThrow()
    })
  })

  describe('validateWith helper', () => {
    it('throws structured ValidationError on invalid input', () => {
      expect(() => validateWith(StreamingSourceSchema, 'invalid')).toThrow(ValidationError)
    })
  })
})
