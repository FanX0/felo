import type { Song } from '../pages/Library/Library'
import type { HomeSongItem } from '../pages/Home/Home'
import {
  PLAYED_SONGS_STORAGE_KEY,
  PLAY_STATS_STORAGE_KEY,
  RECENTLY_PLAYED_STORAGE_KEY
} from '../hooks/usePlayerStore'
import { normalizeForMatching } from '../lib/songMatching'

export interface PersonalizedMix {
  id: string
  title: string
  subtitle: string
  description: string
  gradient: string
  category: 'daily_mix' | 'discover' | 'repeat'
  tracks: HomeSongItem[]
}

const MIX_CACHE_STORAGE_KEY = 'felo_personalized_mixes'
const MIX_CACHE_TIMESTAMP_KEY = 'felo_personalized_mixes_ts'
const MIX_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

const MIX_GRADIENTS = [
  'from-rose-600 via-pink-700 to-purple-900',
  'from-cyan-600 via-blue-700 to-indigo-950',
  'from-emerald-600 via-teal-700 to-slate-900',
  'from-amber-600 via-orange-700 to-red-950',
  'from-violet-600 via-purple-800 to-slate-950'
]

/**
 * Reads user listening history from localStorage and SQLite to compute seed artists and top tracks.
 */
function extractUserTasteProfile(librarySongs: Song[] = []): {
  topArtists: string[]
  onRepeatTracks: HomeSongItem[]
} {
  try {
    const stats = JSON.parse(localStorage.getItem(PLAY_STATS_STORAGE_KEY) || '{}') as Record<
      string,
      { playCount: number; lastPlayedAt: number }
    >
    const playedSongs = JSON.parse(
      localStorage.getItem(PLAYED_SONGS_STORAGE_KEY) || '{}'
    ) as Record<string, Song>
    const recent = JSON.parse(
      localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]'
    ) as Song[]

    const knownMap: Record<string, Song> = { ...playedSongs }
    recent.forEach((s) => {
      if (s?.id) knownMap[s.id] = s
    })
    librarySongs.forEach((s) => {
      if (s?.id && !knownMap[s.id]) knownMap[s.id] = s
    })

    // Compute artist play counts
    const artistScores = new Map<string, number>()
    const trackEntries: Array<{ song: Song; playCount: number; lastPlayedAt: number }> = []

    Object.entries(stats).forEach(([id, st]) => {
      const song = knownMap[id]
      if (song && (st.playCount || 0) > 0) {
        trackEntries.push({ song, playCount: st.playCount, lastPlayedAt: st.lastPlayedAt })
        const artist = (song.artist || '').trim()
        if (artist && !/unknown/i.test(artist)) {
          artistScores.set(artist, (artistScores.get(artist) || 0) + st.playCount)
        }
      }
    })

    // Sort top artists
    let topArtists = [...artistScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0])

    // If history is young, augment with artists from local library
    if (topArtists.length < 3 && librarySongs.length > 0) {
      const libArtistCounts = new Map<string, number>()
      librarySongs.forEach((s) => {
        const a = (s.artist || '').trim()
        if (a && !/unknown/i.test(a)) {
          libArtistCounts.set(a, (libArtistCounts.get(a) || 0) + 1)
        }
      })
      const topLib = [...libArtistCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map((e) => e[0])

      topArtists = Array.from(new Set([...topArtists, ...topLib])).slice(0, 5)
    }

    // Sort On Repeat tracks
    const onRepeatTracks: HomeSongItem[] = trackEntries
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 25)
      .map((entry) => ({
        id: `repeat-${entry.song.id}`,
        title: entry.song.title,
        artist: entry.song.artist,
        album: entry.song.album || undefined,
        duration: entry.song.duration || 0,
        artworkUrl: entry.song.artworkPath || undefined,
        quality: 'FLAC'
      }))

    return { topArtists: topArtists.slice(0, 5), onRepeatTracks }
  } catch (err) {
    console.warn('Failed to extract user taste profile:', err)
    return { topArtists: [], onRepeatTracks: [] }
  }
}

export class PersonalizationService {
  /**
   * Generates Spotify-style personalized mixes:
   * - Daily Mix 1-3 (clustered by user's top played artists)
   * - Discover Weekly (recommended fresh tracks in user's affinity circle)
   * - On Repeat (user's most played tracks)
   */
  static async generatePersonalizedMixes(
    librarySongs: Song[] = [],
    forceRefresh = false
  ): Promise<PersonalizedMix[]> {
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(MIX_CACHE_STORAGE_KEY)
        const ts = Number(localStorage.getItem(MIX_CACHE_TIMESTAMP_KEY) || '0')
        if (cached && Date.now() - ts < MIX_CACHE_TTL) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch {}
    }

    const { topArtists, onRepeatTracks } = extractUserTasteProfile(librarySongs)
    const mixes: PersonalizedMix[] = []

    // 1. On Repeat Mix (if user has played tracks)
    if (onRepeatTracks.length >= 3) {
      mixes.push({
        id: 'felo-on-repeat',
        title: 'On Repeat',
        subtitle: 'The songs you love right now',
        description: 'Auto-updating playlist of your most listened-to tracks',
        gradient: 'from-emerald-500 via-teal-700 to-cyan-950',
        category: 'repeat',
        tracks: onRepeatTracks
      })
    }

    // 2. Daily Mixes based on top artists
    const discoveryCandidates: HomeSongItem[] = []
    const playedTitles = new Set(onRepeatTracks.map((t) => normalizeForMatching(t.title)))

    for (let i = 0; i < Math.min(topArtists.length, 3); i++) {
      const seedArtist = topArtists[i]
      try {
        // Fetch recommendations from Deezer IPC proxy
        let rawTracks: any[] = []
        if (window.api?.fetchDeezerRecommendations) {
          rawTracks = await window.api.fetchDeezerRecommendations(seedArtist)
        }

        if (Array.isArray(rawTracks) && rawTracks.length > 0) {
          // Normalize candidates
          const mixTracks: HomeSongItem[] = []
          const seen = new Set<string>()

          for (const item of rawTracks) {
            const rawTitle = (item.title_short || item.title || '').trim()
            const rawArtist = (item.artist?.name || '').trim()
            if (!rawTitle || !rawArtist) continue

            const key = `${normalizeForMatching(rawTitle)}:::${normalizeForMatching(rawArtist)}`
            if (seen.has(key)) continue
            seen.add(key)

            const artwork =
              item.album?.cover_xl ||
              item.album?.cover_big ||
              item.album?.cover_medium ||
              item.album?.cover ||
              ''

            const candidate: HomeSongItem = {
              id: `rec-dz-${item.id}`,
              title: rawTitle,
              artist: rawArtist,
              album: item.album?.title || '',
              duration: Number(item.duration) || 180,
              artworkUrl: artwork,
              quality: 'Hi-Res',
              previewUrl: item.preview || undefined
            }

            mixTracks.push(candidate)
            if (!playedTitles.has(normalizeForMatching(rawTitle))) {
              discoveryCandidates.push(candidate)
            }
          }

          if (mixTracks.length >= 5) {
            // Find familiar tracks from user's local library for this artist to blend in (Spotify Daily Mix formula)
            const localFavorites = librarySongs
              .filter((s) => s.artist && s.artist.toLowerCase().includes(seedArtist.toLowerCase()))
              .slice(0, 4)
              .map((s) => ({
                id: s.id,
                title: s.title,
                artist: s.artist,
                album: s.album || '',
                duration: s.duration || 0,
                artworkUrl: s.artworkPath || undefined,
                quality: 'FLAC' as const
              }))

            // Interleave local familiar favorites with online discovery tracks
            const blended = [...localFavorites, ...mixTracks.slice(0, 15)]

            mixes.push({
              id: `felo-daily-mix-${i + 1}`,
              title: `Daily Mix ${i + 1}`,
              subtitle: `${seedArtist} and similar artists`,
              description: `A personalized blend of ${seedArtist} plus fresh discoveries`,
              gradient: MIX_GRADIENTS[i % MIX_GRADIENTS.length],
              category: 'daily_mix',
              tracks: blended
            })
          }
        }
      } catch (err) {
        console.warn(`Could not generate mix for ${seedArtist}:`, err)
      }
    }

    // 3. Discover Weekly Mix (fresh tracks user hasn't heard yet)
    if (discoveryCandidates.length >= 6) {
      // Shuffle discovery candidates for variety
      const shuffled = [...discoveryCandidates].sort(() => Math.random() - 0.5)
      mixes.push({
        id: 'felo-discover-weekly',
        title: 'Discover Weekly',
        subtitle: 'Your weekly mixtape of fresh music',
        description: 'New discoveries matched to your personal listening tastes',
        gradient: 'from-purple-600 via-indigo-800 to-black',
        category: 'discover',
        tracks: shuffled.slice(0, 20)
      })
    }

    // Persist to cache
    if (mixes.length > 0) {
      try {
        localStorage.setItem(MIX_CACHE_STORAGE_KEY, JSON.stringify(mixes))
        localStorage.setItem(MIX_CACHE_TIMESTAMP_KEY, String(Date.now()))
      } catch {}
    }

    return mixes
  }
}
