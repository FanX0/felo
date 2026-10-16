import type { Song } from '../Library/Library'
import { RECENTLY_PLAYED_STORAGE_KEY } from '../../hooks/usePlayerStore'
import type { SearchItem } from './types'

export const RECENT_SEARCHES_STORAGE_KEY = 'felo_recent_searches'

export function readRecentSearches(): string[] {
  try {
    const searches = JSON.parse(localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY) || '[]')
    return Array.isArray(searches)
      ? searches.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function readRecentlyPlayed(): Song[] {
  try {
    const songs = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]')
    return Array.isArray(songs) ? (songs as Song[]) : []
  } catch {
    return []
  }
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bunknown\s+artist\b/g, '')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(/\s*\((?:youtube|official)\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video)\s*$/g,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSearchDuration(duration: string | null): number {
  if (!duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export function formatSongDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function scoreSearchItem(item: SearchItem, query: string): number {
  const normQuery = query.toLowerCase().trim()
  const normTitle = (item.title || '').toLowerCase().trim()
  const normArtist = (item.artist || '').toLowerCase().trim()
  const normAlbum = (item.album || '').toLowerCase().trim()

  let score = 0

  if (normTitle === normQuery) {
    score += 100
  } else if (normTitle.startsWith(normQuery)) {
    score += 70
  } else if (normTitle.includes(normQuery)) {
    score += 40
  }

  if (normArtist === normQuery) {
    score += 85
  } else if (normArtist.startsWith(normQuery)) {
    score += 60
  } else if (normArtist.includes(normQuery)) {
    score += 30
  }

  if (normAlbum === normQuery) {
    score += 50
  } else if (normAlbum.startsWith(normQuery)) {
    score += 35
  }

  const tokens = normQuery.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) {
    const combined = `${normTitle} ${normArtist} ${normAlbum}`
    const allTokensMatch = tokens.every((t) => combined.includes(t))
    if (allTokensMatch) score += 45
  }

  if (item.type === 'Artist') {
    if (normTitle === normQuery || normTitle.startsWith(normQuery)) {
      score += Math.min(30, (item.trackCount || 0) * 2)
    }
  }

  if (item.type === 'Album' && (item.trackCount || 0) > 0) {
    score += Math.min(15, item.trackCount || 0)
  }

  return score
}
