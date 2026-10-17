import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeSearchQuery,
  calculateProfileRank,
  searchProfiles,
  profileSearchCache,
  type FriendProfile
} from '../../../src/renderer/src/lib/profileSearch'

// Mock Supabase
const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('../../../src/renderer/src/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: mockFrom
  })
}))

describe('profileSearch logic & industry-standard optimizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profileSearchCache.clear()
  })

  describe('sanitizeSearchQuery', () => {
    it('strips leading "@" symbols (handles social handle typing)', () => {
      expect(sanitizeSearchQuery('@alex')).toBe('alex')
      expect(sanitizeSearchQuery('@@@john_doe')).toBe('john_doe')
    })

    it('trims leading/trailing whitespace and normalizes internal whitespace', () => {
      expect(sanitizeSearchQuery('   hello   world   ')).toBe('hello world')
      expect(sanitizeSearchQuery('   ')).toBe('')
    })

    it('preserves valid characters including underscores in usernames', () => {
      expect(sanitizeSearchQuery('john_doe')).toBe('john_doe')
    })
  })

  describe('calculateProfileRank (multi-tier relevance scoring)', () => {
    const profile: FriendProfile = {
      id: 'p1',
      username: 'alexander',
      display_name: 'Alex Smith',
      avatar_url: null
    }

    it('assigns rank 1 for exact username match', () => {
      expect(
        calculateProfileRank(
          { id: '1', username: 'alex', display_name: 'Alexander', avatar_url: null },
          'alex'
        )
      ).toBe(1)
    })

    it('assigns rank 2 for exact display name match', () => {
      expect(
        calculateProfileRank(
          { id: '1', username: 'alex_123', display_name: 'Alex', avatar_url: null },
          'alex'
        )
      ).toBe(2)
    })

    it('assigns rank 3 for username prefix match', () => {
      expect(calculateProfileRank(profile, 'alex')).toBe(3)
    })

    it('assigns rank 4 for display name prefix match', () => {
      expect(
        calculateProfileRank(
          { id: '1', username: 'zalex', display_name: 'Alexandre', avatar_url: null },
          'alex'
        )
      ).toBe(4)
    })

    it('assigns rank 5 for username infix/substring match', () => {
      expect(
        calculateProfileRank(
          { id: '1', username: 'valexander', display_name: 'Bob', avatar_url: null },
          'alex'
        )
      ).toBe(5)
    })

    it('assigns rank 6 for display name infix/substring match', () => {
      expect(
        calculateProfileRank(
          { id: '1', username: 'superbob', display_name: 'Bob Alexander', avatar_url: null },
          'alex'
        )
      ).toBe(6)
    })

    it('assigns rank 7 when neither matches', () => {
      expect(calculateProfileRank(profile, 'charlie')).toBe(7)
    })
  })

  describe('searchProfiles execution and caching', () => {
    it('returns empty array immediately if query length < 2', async () => {
      const result = await searchProfiles({ query: 'a' })
      expect(result).toEqual([])
      expect(mockRpc).not.toHaveBeenCalled()
      expect(mockFrom).not.toHaveBeenCalled()
    })

    it('executes search_profiles RPC and caches results in memory', async () => {
      const mockUsers: FriendProfile[] = [
        { id: 'u1', username: 'alex', display_name: 'Alex', avatar_url: null },
        { id: 'u2', username: 'alexander', display_name: 'Alex The Great', avatar_url: null }
      ]

      mockRpc.mockResolvedValueOnce({ data: mockUsers, error: null })

      const firstCall = await searchProfiles({ query: '@alex', currentUserId: 'self-123', limit: 8 })
      expect(firstCall).toEqual(mockUsers)
      expect(mockRpc).toHaveBeenCalledWith('search_profiles', {
        search_query: 'alex',
        result_limit: 8
      })

      // Second call for the same query should hit memory cache (0 DB calls)
      const secondCall = await searchProfiles({ query: 'alex', currentUserId: 'self-123', limit: 8 })
      expect(secondCall).toEqual(mockUsers)
      expect(mockRpc).toHaveBeenCalledTimes(1)
    })

    it('falls back to single .or(...) query if RPC fails (e.g. before migration deployed)', async () => {
      mockRpc.mockRejectedValueOnce(new Error('function search_profiles does not exist'))

      const fallbackUsers: FriendProfile[] = [
        { id: 'u2', username: 'valexander', display_name: 'Val', avatar_url: null },
        { id: 'u1', username: 'alex', display_name: 'Alex', avatar_url: null }
      ]

      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValueOnce({ data: fallbackUsers, error: null })
      }
      mockFrom.mockReturnValue(mockQueryBuilder)

      const results = await searchProfiles({ query: 'alex', currentUserId: 'self-123', limit: 8 })

      // Verifies client-side multi-tier ranking sorted 'alex' (exact match) before 'valexander' (infix match)
      expect(results[0].username).toBe('alex')
      expect(results[1].username).toBe('valexander')
      expect(mockFrom).toHaveBeenCalledWith('profiles')
    })

    it('handles aborted requests cleanly', async () => {
      const controller = new AbortController()
      controller.abort()

      const results = await searchProfiles({
        query: 'alex',
        signal: controller.signal
      })

      expect(results).toEqual([])
      expect(mockRpc).not.toHaveBeenCalled()
    })
  })
})
