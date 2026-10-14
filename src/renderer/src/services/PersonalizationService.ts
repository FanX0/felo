import type { Song } from '../pages/Library/Library'
import type { HomeSongItem } from '../pages/Home/Home'
import {
  PLAYED_SONGS_STORAGE_KEY,
  PLAY_STATS_STORAGE_KEY,
  RECENTLY_PLAYED_STORAGE_KEY
} from '../lib/playbackConstants'
import { normalizeForMatching, findMatchingLibrarySong } from '../lib/songMatching'

export interface PersonalizedMix {
  id: string
  title: string
  subtitle: string
  description: string
  gradient: string
  category: 'daily_mix' | 'discover' | 'repeat'
  tracks: HomeSongItem[]
}

export interface UserTasteMetrics {
  totalMinutes: number
  formattedTime: string
  chronotype: {
    label: string
    description: string
    icon: 'morning' | 'afternoon' | 'evening' | 'night'
  }
  topGenres: string[]
  listenerTier: {
    title: string
    badge: string
    minPlays: number
  }
  totalPlays: number
  topArtist?: string
}

const MIX_CACHE_STORAGE_KEY = 'felo_personalized_mixes'
const MIX_CACHE_TIMESTAMP_KEY = 'felo_personalized_mixes_ts'
const MIX_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours
const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000

const MIX_GRADIENTS = [
  'from-rose-600 via-pink-700 to-purple-900',
  'from-cyan-600 via-blue-700 to-indigo-950',
  'from-emerald-600 via-teal-700 to-slate-900',
  'from-amber-600 via-orange-700 to-red-950',
  'from-violet-600 via-purple-800 to-slate-950'
]

/**
 * Reads user listening history from localStorage and SQLite to compute seed artists,
 * current rotation (On Repeat), and past favorites (Repeat Rewind).
 */
function extractUserTasteProfile(librarySongs: Song[] = []): {
  topArtists: string[]
  onRepeatTracks: HomeSongItem[]
  repeatRewindTracks: HomeSongItem[]
  totalPlays: number
  totalDurationSeconds: number
  playTimestamps: number[]
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

    const artistScores = new Map<string, number>()
    const recentRotation: Array<{ song: Song; playCount: number; lastPlayedAt: number }> = []
    const olderRotation: Array<{ song: Song; playCount: number; lastPlayedAt: number }> = []
    const now = Date.now()
    let totalPlays = 0
    let totalDurationSeconds = 0
    const playTimestamps: number[] = []

    Object.entries(stats).forEach(([id, st]) => {
      const song = knownMap[id]
      const count = st.playCount || 0
      if (song && count > 0) {
        totalPlays += count
        totalDurationSeconds += (song.duration || 180) * count
        const lastPlayedMs = st.lastPlayedAt ? (st.lastPlayedAt < 10_000_000_000 ? st.lastPlayedAt * 1000 : st.lastPlayedAt) : 0
        if (lastPlayedMs) playTimestamps.push(lastPlayedMs)

        const artist = (song.artist || '').trim()
        if (artist && !/unknown/i.test(artist)) {
          artistScores.set(artist, (artistScores.get(artist) || 0) + count)
        }

        const isRecent = lastPlayedMs > 0 && (now - lastPlayedMs) <= TWENTY_ONE_DAYS_MS
        if (isRecent) {
          recentRotation.push({ song, playCount: count, lastPlayedAt: lastPlayedMs })
        } else if (count >= 2) {
          olderRotation.push({ song, playCount: count, lastPlayedAt: lastPlayedMs })
        }
      }
    })

    let topArtists = [...artistScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0])

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

    const toHomeSong = (entry: { song: Song; playCount: number }, prefix: string): HomeSongItem => ({
      id: `${prefix}-${entry.song.id}`,
      title: entry.song.title,
      artist: entry.song.artist,
      album: entry.song.album || undefined,
      duration: entry.song.duration || 0,
      artworkUrl: entry.song.artworkPath || undefined,
      quality: 'FLAC'
    })

    const onRepeatTracks = recentRotation
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 25)
      .map((e) => toHomeSong(e, 'repeat'))

    const repeatRewindTracks = olderRotation
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 25)
      .map((e) => toHomeSong(e, 'rewind'))

    return {
      topArtists: topArtists.slice(0, 5),
      onRepeatTracks,
      repeatRewindTracks,
      totalPlays,
      totalDurationSeconds,
      playTimestamps
    }
  } catch (err) {
    console.warn('Failed to extract user taste profile:', err)
    return {
      topArtists: [],
      onRepeatTracks: [],
      repeatRewindTracks: [],
      totalPlays: 0,
      totalDurationSeconds: 0,
      playTimestamps: []
    }
  }
}

export class PersonalizationService {
  /**
   * Generates Spotify-style personalized mixes:
   * - Daily Mix 1-3 (clustered by user's top played artists)
   * - Discover Weekly (recommended fresh tracks in user's affinity circle)
   * - On Repeat (user's most played tracks in current rotation)
   * - Repeat Rewind (past favorites not heard recently)
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

    const { topArtists, onRepeatTracks, repeatRewindTracks } = extractUserTasteProfile(librarySongs)
    const mixes: PersonalizedMix[] = []

    // 1. On Repeat Mix (Current rotation)
    if (onRepeatTracks.length >= 3) {
      mixes.push({
        id: 'felo-on-repeat',
        title: 'On Repeat',
        subtitle: 'The songs you love right now',
        description: 'Auto-updating playlist of your most listened-to tracks in current rotation',
        gradient: 'from-emerald-500 via-teal-700 to-cyan-950',
        category: 'repeat',
        tracks: onRepeatTracks
      })
    }

    // 2. Repeat Rewind (Past favorites from weeks/months ago)
    if (repeatRewindTracks.length >= 3) {
      mixes.push({
        id: 'felo-repeat-rewind',
        title: 'Repeat Rewind',
        subtitle: 'Past favorites you haven’t heard in a while',
        description: 'The tracks you used to play heavily, ready to rediscover',
        gradient: 'from-amber-600 via-rose-700 to-indigo-950',
        category: 'repeat',
        tracks: repeatRewindTracks
      })
    }

    // 3. Daily Mixes based on top artists
    const discoveryCandidates: HomeSongItem[] = []
    const playedTitles = new Set([
      ...onRepeatTracks.map((t) => normalizeForMatching(t.title)),
      ...repeatRewindTracks.map((t) => normalizeForMatching(t.title))
    ])

    for (let i = 0; i < Math.min(topArtists.length, 3); i++) {
      const seedArtist = topArtists[i]
      try {
        let rawTracks: any[] = []
        if (window.api?.fetchDeezerRecommendations) {
          rawTracks = await window.api.fetchDeezerRecommendations(seedArtist)
        }

        if (Array.isArray(rawTracks) && rawTracks.length > 0) {
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

    // 4. Discover Weekly Mix
    if (discoveryCandidates.length >= 6) {
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

    if (mixes.length > 0) {
      try {
        localStorage.setItem(MIX_CACHE_STORAGE_KEY, JSON.stringify(mixes))
        localStorage.setItem(MIX_CACHE_TIMESTAMP_KEY, String(Date.now()))
      } catch {}
    }

    return mixes
  }

  /**
   * Generates a 25-track Spotify-style Radio Station seeded by an artist or track.
   * Interleaves ~30% local familiar favorites from related artists with ~70% top discovery tracks.
   */
  static async generateRadioStation(
    seed: { title?: string; artist: string; album?: string; artworkUrl?: string; filePath?: string; id?: string },
    librarySongs: Song[] = []
  ): Promise<Song[]> {
    const artistName = (seed.artist || '').trim()
    if (!artistName) return []

    const station: Song[] = []
    const seenKeys = new Set<string>()

    // 1. Seed Song always starts at index 0 (if provided)
    if (seed.title) {
      const seedKey = `${normalizeForMatching(seed.title)}:::${normalizeForMatching(artistName)}`
      seenKeys.add(seedKey)
      station.push({
        id: seed.id || `radio-seed-${Date.now()}`,
        title: seed.title,
        artist: artistName,
        album: seed.album || '',
        duration: 0,
        artworkPath: seed.artworkUrl || '',
        filePath: seed.filePath || `virtual:${seed.title} - ${artistName}`
      })
    }

    // 2. Fetch related artist discovery tracks from Deezer Proxy
    let rawRecommendations: any[] = []
    try {
      if (window.api?.fetchDeezerRecommendations) {
        rawRecommendations = await window.api.fetchDeezerRecommendations(artistName)
      }
    } catch (err) {
      console.warn('Radio Deezer recommendations lookup failed:', err)
    }

    // 3. Collect familiar library tracks by the seed artist or related artists
    const artistLower = artistName.toLowerCase()
    const familiarLocalTracks = librarySongs.filter((song) => {
      const sArtist = (song.artist || '').toLowerCase()
      return sArtist.includes(artistLower) || artistLower.includes(sArtist)
    })

    // 4. Map recommendations to Song objects
    const recommendedSongs: Song[] = []
    for (const item of rawRecommendations) {
      const rTitle = (item.title_short || item.title || '').trim()
      const rArtist = (item.artist?.name || '').trim()
      if (!rTitle || !rArtist) continue

      const key = `${normalizeForMatching(rTitle)}:::${normalizeForMatching(rArtist)}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      // Check if user already owns this track locally
      const localMatch = findMatchingLibrarySong(rTitle, rArtist, librarySongs)
      if (localMatch) {
        recommendedSongs.push(localMatch)
      } else {
        const artwork =
          item.album?.cover_xl ||
          item.album?.cover_big ||
          item.album?.cover_medium ||
          item.album?.cover ||
          ''
        recommendedSongs.push({
          id: `radio-dz-${item.id}`,
          title: rTitle,
          artist: rArtist,
          album: item.album?.title || '',
          duration: Number(item.duration) || 180,
          artworkPath: artwork,
          filePath: `virtual:${rTitle} - ${rArtist}`
        })
      }
    }

    // 5. Interleave familiar library tracks with discovery tracks (Spotify Radio 30/70 formula)
    let localIdx = 0
    let recIdx = 0
    const desiredTotal = 25

    while (station.length < desiredTotal && (localIdx < familiarLocalTracks.length || recIdx < recommendedSongs.length)) {
      // Add 2 discovery tracks
      if (recIdx < recommendedSongs.length) {
        station.push(recommendedSongs[recIdx++])
      }
      if (recIdx < recommendedSongs.length && station.length < desiredTotal) {
        station.push(recommendedSongs[recIdx++])
      }
      // Add 1 familiar track
      if (localIdx < familiarLocalTracks.length && station.length < desiredTotal) {
        const candidate = familiarLocalTracks[localIdx++]
        const cKey = `${normalizeForMatching(candidate.title)}:::${normalizeForMatching(candidate.artist)}`
        if (!seenKeys.has(cKey)) {
          seenKeys.add(cKey)
          station.push(candidate)
        }
      }
    }

    return station
  }

  /**
   * Alias for calculateTasteMetrics.
   */
  static getUserTasteMetrics(librarySongs: Song[] = []): UserTasteMetrics {
    return this.calculateTasteMetrics(librarySongs)
  }

  /**
   * Computes personalized taste metrics (total time, chronotype, sonic tags, listener tier).
   * Used for the Profile page and Mini-Wrapped experience.
   */
  static calculateTasteMetrics(
    librarySongs: Song[] = [],
    remoteData?: {
      totalPlays?: number
      totalDurationSeconds?: number
      playTimestamps?: number[]
      topArtists?: string[]
      topGenres?: string[]
    }
  ): UserTasteMetrics {
    const profile = remoteData
      ? {
          totalPlays: remoteData.totalPlays || 0,
          totalDurationSeconds:
            remoteData.totalDurationSeconds ?? (remoteData.totalPlays ? remoteData.totalPlays * 195 : 0),
          playTimestamps: remoteData.playTimestamps || [],
          topArtists: remoteData.topArtists || []
        }
      : extractUserTasteProfile(librarySongs)

    const totalMinutes = Math.round(profile.totalDurationSeconds / 60)

    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    const formattedTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`

    // Calculate chronotype by hour of day
    let morningCount = 0 // 05:00 - 11:59
    let afternoonCount = 0 // 12:00 - 17:59
    let eveningCount = 0 // 18:00 - 22:59
    let nightCount = 0 // 23:00 - 04:59

    profile.playTimestamps.forEach((ts) => {
      const ms = ts < 10_000_000_000 ? ts * 1000 : ts
      const hour = new Date(ms).getHours()
      if (hour >= 5 && hour < 12) morningCount++
      else if (hour >= 12 && hour < 18) afternoonCount++
      else if (hour >= 18 && hour < 23) eveningCount++
      else nightCount++
    })

    const maxPeriod = Math.max(morningCount, afternoonCount, eveningCount, nightCount)
    let chronotype: UserTasteMetrics['chronotype'] = {
      label: 'Evening Chill',
      description: 'You do your best listening winding down in the evening',
      icon: 'evening'
    }

    if (maxPeriod > 0) {
      if (maxPeriod === nightCount) {
        chronotype = {
          label: 'Night Owl',
          description: 'You find your musical groove in the quiet late hours',
          icon: 'night'
        }
      } else if (maxPeriod === morningCount) {
        chronotype = {
          label: 'Morning Flow',
          description: 'Music kickstarts your day and powers your mornings',
          icon: 'morning'
        }
      } else if (maxPeriod === afternoonCount) {
        chronotype = {
          label: 'Afternoon Focus',
          description: 'You listen most during daytime routines and creative flow',
          icon: 'afternoon'
        }
      }
    }

    // Determine Top Genres (from remoteData or library)
    let topGenres = remoteData?.topGenres || []
    if (topGenres.length === 0) {
      const genreCounts = new Map<string, number>()
      librarySongs.forEach((song) => {
        const genre = (song.genre || '').trim()
        if (genre && !/unknown/i.test(genre)) {
          genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)
        }
      })
      topGenres = [...genreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((e) => e[0])
    }

    // Determine Listener Tier
    const plays = profile.totalPlays
    let listenerTier: UserTasteMetrics['listenerTier'] = {
      title: 'Curious Explorer',
      badge: 'Level 1',
      minPlays: 0
    }
    if (plays >= 800) {
      listenerTier = {
        title: 'Super Listener',
        badge: 'Tier IV',
        minPlays: 800
      }
    } else if (plays >= 200) {
      listenerTier = {
        title: 'Dedicated Audiophile',
        badge: 'Tier III',
        minPlays: 200
      }
    } else if (plays >= 50) {
      listenerTier = {
        title: 'Music Enthusiast',
        badge: 'Tier II',
        minPlays: 50
      }
    }

    return {
      totalMinutes,
      formattedTime,
      chronotype,
      topGenres,
      listenerTier,
      totalPlays: profile.totalPlays,
      topArtist: profile.topArtists[0]
    }
  }
}
