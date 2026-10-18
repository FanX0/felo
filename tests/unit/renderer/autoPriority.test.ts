import { describe, it, expect, beforeEach } from 'vitest'
import {
  evaluateAutoPriority,
  recordUserRequest,
  DEFAULT_AUTO_PRIORITY_CONFIG
} from '../../../src/renderer/src/lib/autoPriority'

describe('Auto-Priority & Fair Rotation System', () => {
  let userCounts: Map<string, number>

  beforeEach(() => {
    userCounts = new Map<string, number>()
  })

  it('promotes first request from a new listener to priority (fair rotation)', () => {
    const result = evaluateAutoPriority({
      senderKey: 'Alice',
      artist: 'Daft Punk',
      duration: 240,
      isExplicitPriority: false,
      recentArtists: ['The Weeknd'],
      userRequestCounts: userCounts
    })

    expect(result.isPriority).toBe(true)
    expect(result.reason).toBe('first_request')
  })

  it('demotes subsequent requests from the same user to standard queue', () => {
    recordUserRequest('Alice', userCounts)

    const result = evaluateAutoPriority({
      senderKey: 'Alice',
      artist: 'Justice',
      duration: 210,
      isExplicitPriority: false,
      recentArtists: ['The Weeknd'],
      userRequestCounts: userCounts
    })

    expect(result.isPriority).toBe(false)
    expect(result.reason).toBe('standard')
  })

  it('demotes short tracks (< 60s) even if first request from user', () => {
    const result = evaluateAutoPriority({
      senderKey: 'Bob',
      artist: 'Short Intro Clip',
      duration: 25,
      isExplicitPriority: true,
      recentArtists: [],
      userRequestCounts: userCounts
    })

    expect(result.isPriority).toBe(false)
    expect(result.reason).toBe('short_duration_demoted')
  })

  it('demotes duplicate artist played within recent 5 tracks', () => {
    const result = evaluateAutoPriority({
      senderKey: 'Charlie',
      artist: 'Radiohead',
      duration: 280,
      isExplicitPriority: true,
      recentArtists: ['Coldplay', 'Muse', 'Radiohead', 'Oasis'],
      userRequestCounts: userCounts
    })

    expect(result.isPriority).toBe(false)
    expect(result.reason).toBe('duplicate_artist_demoted')
  })

  it('allows artist if played beyond the recent history window', () => {
    const result = evaluateAutoPriority({
      senderKey: 'David',
      artist: 'Radiohead',
      duration: 280,
      isExplicitPriority: true,
      // Radiohead is at index 0, but window is 5 and there are 6 tracks
      recentArtists: ['Radiohead', 'Track1', 'Track2', 'Track3', 'Track4', 'Track5'],
      userRequestCounts: userCounts,
      config: { maxRecentArtistWindow: 5 }
    })

    expect(result.isPriority).toBe(true)
  })

  it('falls back strictly to explicit priority flag when disabled', () => {
    const withExplicit = evaluateAutoPriority({
      senderKey: 'Eve',
      artist: 'Daft Punk',
      duration: 30, // short duration, normally demoted
      isExplicitPriority: true,
      userRequestCounts: userCounts,
      config: { enabled: false }
    })
    expect(withExplicit.isPriority).toBe(true)
    expect(withExplicit.reason).toBe('explicit')

    const withoutExplicit = evaluateAutoPriority({
      senderKey: 'Eve',
      artist: 'Daft Punk',
      duration: 200,
      isExplicitPriority: false,
      userRequestCounts: userCounts,
      config: { enabled: false }
    })
    expect(withoutExplicit.isPriority).toBe(false)
    expect(withoutExplicit.reason).toBe('standard')
  })

  it('recordUserRequest correctly updates and increments counts in case-insensitive manner', () => {
    expect(recordUserRequest('Frank', userCounts)).toBe(1)
    expect(recordUserRequest('frank', userCounts)).toBe(2)
    expect(recordUserRequest('  FRANK  ', userCounts)).toBe(3)
    expect(userCounts.get('frank')).toBe(3)
  })
})
