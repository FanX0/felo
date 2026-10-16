import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExchangeCode = vi.fn()
const mockSetSession = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mockExchangeCode,
      setSession: mockSetSession
    }
  }))
}))

import { completeOAuthSignIn } from '../../../src/renderer/src/lib/supabase'

describe('Renderer: completeOAuthSignIn', () => {
  beforeEach(() => {
    mockExchangeCode.mockReset()
    mockSetSession.mockReset()
  })

  it('exchanges PKCE authorization code and passes flowId option', async () => {
    mockExchangeCode.mockResolvedValueOnce({ data: { session: {} }, error: null })

    await completeOAuthSignIn('felo://auth/callback?code=test-code-123&sb_flow_id=test-flow-abc')

    expect(mockExchangeCode).toHaveBeenCalledTimes(1)
    expect(mockExchangeCode).toHaveBeenCalledWith('test-code-123', { flowId: 'test-flow-abc' })
  })

  it('exchanges code without flowId when sb_flow_id is omitted', async () => {
    mockExchangeCode.mockResolvedValueOnce({ data: { session: {} }, error: null })

    await completeOAuthSignIn('felo://auth/callback?code=simple-code')

    expect(mockExchangeCode).toHaveBeenCalledTimes(1)
    expect(mockExchangeCode).toHaveBeenCalledWith('simple-code', undefined)
  })

  it('sets session when access_token and refresh_token are in hash fragment', async () => {
    mockSetSession.mockResolvedValueOnce({ data: { session: {} }, error: null })

    await completeOAuthSignIn('felo://auth/callback#access_token=token-xyz&refresh_token=refresh-123')

    expect(mockSetSession).toHaveBeenCalledTimes(1)
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'token-xyz',
      refresh_token: 'refresh-123'
    })
  })

  it('extracts error_description and throws informative error', async () => {
    await expect(
      completeOAuthSignIn('felo://auth/callback?error=access_denied&error_description=User%20declined')
    ).rejects.toThrow('User declined')
  })

  it('extracts error from hash fragment and throws', async () => {
    await expect(
      completeOAuthSignIn('felo://auth/callback#error=unauthorized_client&error_description=Client%20mismatch')
    ).rejects.toThrow('Client mismatch')
  })

  it('throws when callback contains neither code nor tokens', async () => {
    await expect(completeOAuthSignIn('felo://auth/callback')).rejects.toThrow(
      'The OAuth callback did not contain an authorization code or tokens.'
    )
  })
})
