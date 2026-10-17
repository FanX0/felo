import { getSupabase } from './supabase'
import type { OnlineProfile } from '../online/types'

export type FriendProfile = Pick<
  OnlineProfile,
  'id' | 'username' | 'display_name' | 'avatar_url'
>

export interface SearchProfilesOptions {
  query: string
  currentUserId?: string
  limit?: number
  signal?: AbortSignal
}

/**
 * Normalizes and sanitizes search queries for user/friend lookups:
 * - Strips leading `@` handles (e.g. "@alex" -> "alex")
 * - Trims leading/trailing whitespace
 * - Collapses repeated whitespace
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query) return ''
  return query
    .trim()
    .replace(/^@+/, '')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Industry-standard multi-tier ranking scoring for client-side sorting:
 * 1 = Exact username match
 * 2 = Exact display name match
 * 3 = Username prefix match
 * 4 = Display name prefix match
 * 5 = Username substring match
 * 6 = Display name substring match
 * 7 = Other
 */
export function calculateProfileRank(profile: FriendProfile, cleanQuery: string): number {
  const q = cleanQuery.toLowerCase()
  const uname = (profile.username || '').toLowerCase()
  const dname = (profile.display_name || '').toLowerCase()

  if (uname === q) return 1
  if (dname === q) return 2
  if (uname.startsWith(q)) return 3
  if (dname.startsWith(q)) return 4
  if (uname.includes(q)) return 5
  if (dname.includes(q)) return 6
  return 7
}

/**
 * In-memory LRU cache to provide instant results for backspaces and repeated searches,
 * avoiding unnecessary database load.
 */
class SearchCache {
  private cache = new Map<string, { timestamp: number; data: FriendProfile[] }>()
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(maxEntries = 50, ttlMs = 60_000) {
    this.maxEntries = maxEntries
    this.ttlMs = ttlMs
  }

  get(key: string): FriendProfile[] | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return null
    }
    // Refresh access order (LRU)
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.data
  }

  set(key: string, data: FriendProfile[]): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, { timestamp: Date.now(), data })
  }

  clear(): void {
    this.cache.clear()
  }
}

export const profileSearchCache = new SearchCache(50, 60_000)

/**
 * High-performance search for users/friends.
 * Utilizes Postgres RPC `search_profiles` backed by GIN trigram and B-tree prefix indexes.
 * If the database RPC is unavailable (e.g. before migration), gracefully falls back to an
 * optimized single `.or(...)` query with client-side multi-tier ranking.
 */
export async function searchProfiles({
  query,
  currentUserId,
  limit = 8,
  signal
}: SearchProfilesOptions): Promise<FriendProfile[]> {
  const cleanTerm = sanitizeSearchQuery(query)
  if (!cleanTerm || cleanTerm.length < 2) {
    return []
  }

  const cacheKey = `${currentUserId || 'anon'}:${cleanTerm.toLowerCase()}:${limit}`
  const cached = profileSearchCache.get(cacheKey)
  if (cached) {
    return cached
  }

  if (signal?.aborted) {
    return []
  }

  const supabase = getSupabase()

  // 1. Primary path: Call the optimized RPC function
  try {
    const { data, error } = await supabase.rpc('search_profiles', {
      search_query: cleanTerm,
      result_limit: limit
    })

    if (signal?.aborted) {
      return []
    }

    if (!error && Array.isArray(data)) {
      const results = (data as FriendProfile[]).filter((p) => p.id !== currentUserId)
      profileSearchCache.set(cacheKey, results)
      return results
    }
  } catch {
    // RPC failed or is not available; proceed to fallback
  }

  if (signal?.aborted) {
    return []
  }

  // 2. Fallback path: Single combined query with client-side ranking
  // Escapes SQL wildcards for pattern matching
  const safeWildcard = cleanTerm.replace(/[%_]/g, '')
  if (safeWildcard.length < 2) {
    return []
  }

  const pattern = `%${safeWildcard}%`
  let queryBuilder = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .limit(limit * 2)

  if (currentUserId) {
    queryBuilder = queryBuilder.neq('id', currentUserId)
  }

  const { data: fallbackData, error: fallbackError } = await queryBuilder

  if (signal?.aborted) {
    return []
  }

  if (fallbackError) {
    throw new Error(fallbackError.message)
  }

  const rawList = (fallbackData || []) as FriendProfile[]

  // Deduplicate and rank results client-side matching industry standard logic
  const uniqueMap = new Map<string, FriendProfile>()
  for (const item of rawList) {
    if (!currentUserId || item.id !== currentUserId) {
      uniqueMap.set(item.id, item)
    }
  }

  const ranked = [...uniqueMap.values()]
    .sort((a, b) => {
      const rankA = calculateProfileRank(a, safeWildcard)
      const rankB = calculateProfileRank(b, safeWildcard)
      if (rankA !== rankB) return rankA - rankB
      if (a.username.length !== b.username.length) return a.username.length - b.username.length
      return a.username.localeCompare(b.username)
    })
    .slice(0, limit)

  profileSearchCache.set(cacheKey, ranked)
  return ranked
}
