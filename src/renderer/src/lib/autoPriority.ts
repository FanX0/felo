/**
 * Auto-Priority & Fair Rotation System
 *
 * Implements industry-standard fairness rules for incoming song requests
 * from Discord commands and room listeners:
 * 1. First request per user auto-promotes to priority (fair rotation)
 * 2. Duplicate artist in recent playback history gets demoted to standard queue
 * 3. Short tracks (< 60s) get demoted to standard queue
 * 4. Explicit manual priority by host/co-host is honored
 */

export interface AutoPriorityConfig {
  enabled: boolean
  firstRequestPriority: boolean
  preventDuplicateArtist: boolean
  minDurationForPriority: number
  maxRecentArtistWindow: number
}

export const DEFAULT_AUTO_PRIORITY_CONFIG: AutoPriorityConfig = {
  enabled: true,
  firstRequestPriority: true,
  preventDuplicateArtist: true,
  minDurationForPriority: 60,
  maxRecentArtistWindow: 5
}

export type AutoPriorityReason =
  | 'explicit'
  | 'first_request'
  | 'duplicate_artist_demoted'
  | 'short_duration_demoted'
  | 'standard'

export interface AutoPriorityEvaluation {
  isPriority: boolean
  reason: AutoPriorityReason
}

export function evaluateAutoPriority(params: {
  senderKey?: string | null
  artist?: string | null
  duration?: number | null
  isExplicitPriority?: boolean
  recentArtists?: string[]
  userRequestCounts?: Map<string, number>
  config?: Partial<AutoPriorityConfig>
}): AutoPriorityEvaluation {
  const cfg: AutoPriorityConfig = {
    ...DEFAULT_AUTO_PRIORITY_CONFIG,
    ...params.config
  }

  // If auto-priority system is globally disabled, fall back strictly to explicit flag
  if (!cfg.enabled) {
    return {
      isPriority: Boolean(params.isExplicitPriority),
      reason: params.isExplicitPriority ? 'explicit' : 'standard'
    }
  }

  const duration = typeof params.duration === 'number' && Number.isFinite(params.duration) ? params.duration : 0
  const cleanArtist = (params.artist || '').trim().toLowerCase()
  const recentArtists = (params.recentArtists || []).map((a) => (a || '').trim().toLowerCase()).filter(Boolean)

  // 1. Short track guard: Clips < minDurationForPriority cannot get priority
  if (duration > 0 && duration < cfg.minDurationForPriority) {
    return {
      isPriority: false,
      reason: 'short_duration_demoted'
    }
  }

  // 2. Duplicate artist guard: If artist was played in recent window, demote to standard queue
  if (cfg.preventDuplicateArtist && cleanArtist) {
    const windowSlice = recentArtists.slice(-cfg.maxRecentArtistWindow)
    const isRecent = windowSlice.some(
      (recent) => recent === cleanArtist || cleanArtist.includes(recent) || recent.includes(cleanArtist)
    )
    if (isRecent) {
      return {
        isPriority: false,
        reason: 'duplicate_artist_demoted'
      }
    }
  }

  // 3. First request from user = auto-promote to priority (Fair rotation)
  const senderKey = (params.senderKey || '').trim().toLowerCase()
  if (cfg.firstRequestPriority && senderKey && params.userRequestCounts) {
    const previousCount = params.userRequestCounts.get(senderKey) || 0
    if (previousCount === 0) {
      return {
        isPriority: true,
        reason: 'first_request'
      }
    }
  }

  // 4. Default: Honor explicit priority flag if provided
  if (params.isExplicitPriority) {
    return {
      isPriority: true,
      reason: 'explicit'
    }
  }

  return {
    isPriority: false,
    reason: 'standard'
  }
}

export function recordUserRequest(
  senderKey: string | null | undefined,
  countsMap: Map<string, number>
): number {
  if (!senderKey) return 0
  const key = senderKey.trim().toLowerCase()
  if (!key) return 0
  const current = countsMap.get(key) || 0
  const updated = current + 1
  countsMap.set(key, updated)
  return updated
}
