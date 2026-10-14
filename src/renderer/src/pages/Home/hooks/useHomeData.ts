import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Song } from '../../Library/Library'
import type { HomeSongItem, HomeAlbumItem } from '../types'
import {
  CURATED_DEFAULT_SONGS,
  CURATED_DEFAULT_ALBUMS,
  HOME_RECOMMENDED_SONGS_KEY,
  HOME_RECOMMENDED_ALBUMS_KEY
} from '../constants/curatedContent'
import {
  PersonalizationService,
  PersonalizedMix,
  UserTasteMetrics
} from '../../../services/PersonalizationService'
import { findMatchingLibrarySong, normalizeForMatching } from '../../../lib/songMatching'
import { toMediaUrl } from '../../../lib/media'
import { AppCapabilities } from '../../../lib/appConfig'

const LIKED_SONGS_KEY = 'felo_home_liked_songs'

function readCachedList<T>(key: string, fallback: T[]): T[] {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(cached) && cached.length > 0 ? cached : fallback
  } catch {
    return fallback
  }
}

function readCachedAlbums(key: string, fallback: HomeAlbumItem[]): HomeAlbumItem[] {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null')
    if (Array.isArray(cached) && cached.length > 0) {
      const fallbackMap = new Map(fallback.map((a) => [a.id, a]))
      const deadHashes = ['7ec9a180', 'e98746c8', '6be06c7a', 'b8158e07']
      const sanitized = cached.map((item: HomeAlbumItem) => {
        const defaultItem = fallbackMap.get(item.id)
        if (defaultItem && (!item.artworkUrl || deadHashes.some((hash) => item.artworkUrl?.includes(hash)))) {
          return { ...item, artworkUrl: defaultItem.artworkUrl }
        }
        return item
      })
      try {
        localStorage.setItem(key, JSON.stringify(sanitized))
      } catch {}
      return sanitized
    }
    return fallback
  } catch {
    return fallback
  }
}

export function useHomeData() {
  const [recommendedSongs, setRecommendedSongs] = useState<HomeSongItem[]>(() =>
    AppCapabilities.onlineDiscovery
      ? readCachedList(HOME_RECOMMENDED_SONGS_KEY, CURATED_DEFAULT_SONGS)
      : []
  )
  const [recommendedAlbums, setRecommendedAlbums] = useState<HomeAlbumItem[]>(() =>
    AppCapabilities.onlineDiscovery
      ? readCachedAlbums(HOME_RECOMMENDED_ALBUMS_KEY, CURATED_DEFAULT_ALBUMS)
      : []
  )
  const [hotSongs, setHotSongs] = useState<HomeSongItem[]>([])
  const [hotNewAlbums, setHotNewAlbums] = useState<HomeAlbumItem[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [personalizedMixes, setPersonalizedMixes] = useState<PersonalizedMix[]>([])
  const [isLoadingMixes, setIsLoadingMixes] = useState(false)
  const [tasteMetrics, setTasteMetrics] = useState<UserTasteMetrics | null>(null)

  const [likedSongIds, setLikedSongIds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIKED_SONGS_KEY) || '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch {
      return new Set()
    }
  })

  // Load local library songs
  const loadLibraryStatus = useCallback(async () => {
    try {
      const songs = await window.api?.getSongs?.()
      const localSongs = (songs || []) as Song[]
      setLibrarySongs(localSongs)
    } catch (error) {
      console.warn('Unable to load homepage library status:', error)
    }
  }, [])

  useEffect(() => {
    void loadLibraryStatus()
    const handleLibraryUpdate = () => void loadLibraryStatus()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    return () => {
      window.removeEventListener('felo:library-updated', handleLibraryUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    }
  }, [loadLibraryStatus])

  // Fast library matching index
  const libraryIndex = useMemo(() => {
    const validSongs = librarySongs.filter(
      (s) => s.filePath && !String(s.filePath).startsWith('virtual:')
    )
    const titleAndArtistSet = new Set<string>()

    for (const song of validSongs) {
      const normTitle = normalizeForMatching(song.title || '')
      const normArtist = normalizeForMatching(song.artist || '')
      if (normTitle) {
        if (normArtist) {
          titleAndArtistSet.add(`${normTitle}:::${normArtist}`)
          titleAndArtistSet.add(`${normArtist}:::${normTitle}`)
        }
        titleAndArtistSet.add(`${normTitle}:::`)
      }
    }

    return {
      has: (title: string, artist: string): boolean => {
        const normTargetTitle = normalizeForMatching(title)
        const normTargetArtist = normalizeForMatching(artist)
        if (!normTargetTitle) return false
        if (
          normTargetArtist &&
          (titleAndArtistSet.has(`${normTargetTitle}:::${normTargetArtist}`) ||
            titleAndArtistSet.has(`${normTargetArtist}:::${normTargetTitle}`))
        ) {
          return true
        }
        return Boolean(findMatchingLibrarySong(title, artist, validSongs))
      }
    }
  }, [librarySongs])

  // Fetch explore feed (Monochrome-style)
  const fetchFeed = useCallback(async () => {
    if (!AppCapabilities.onlineDiscovery) {
      setIsRefreshing(false)
      return
    }
    setIsRefreshing(true)
    try {
      if (window.api?.fetchExploreFeed) {
        const feed = await window.api.fetchExploreFeed()
        if (feed) {
          if (Array.isArray(feed.trendingSongs) && feed.trendingSongs.length > 0) {
            setRecommendedSongs(feed.trendingSongs)
          }
          if (Array.isArray(feed.hotNewSongs) && feed.hotNewSongs.length > 0) {
            setHotSongs(feed.hotNewSongs)
          }
          if (Array.isArray(feed.recommendedAlbums) && feed.recommendedAlbums.length > 0) {
            setRecommendedAlbums(feed.recommendedAlbums)
          }
          if (Array.isArray(feed.hotNewAlbums) && feed.hotNewAlbums.length > 0) {
            setHotNewAlbums(feed.hotNewAlbums)
          }
        }
      }
    } catch (err) {
      console.warn('Explore feed error, falling back to curated:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchFeed()
  }, [fetchFeed])

  // When online discovery is disabled, populate recommended songs & albums directly from local library
  useEffect(() => {
    if (!AppCapabilities.onlineDiscovery && librarySongs.length > 0) {
      const valid = librarySongs.filter(
        (s) => s.filePath && !String(s.filePath).startsWith('virtual:')
      )
      const localRecommendations: HomeSongItem[] = valid.slice(0, 30).map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration: s.duration,
        artworkUrl: (toMediaUrl(s.artworkPath) || undefined) as string | undefined
      }))
      setRecommendedSongs(localRecommendations)

      const albumMap = new Map<string, HomeAlbumItem>()
      for (const song of valid) {
        if (!song.album || albumMap.has(song.album)) continue
        albumMap.set(song.album, {
          id: `local-album-${song.album}`,
          title: song.album,
          artist: song.artist || 'Various Artists',
          artworkUrl: (toMediaUrl(song.artworkPath) || undefined) as string | undefined,
          songCount: 1
        })
      }
      setRecommendedAlbums(Array.from(albumMap.values()).slice(0, 12))
    }
  }, [librarySongs])

  // Load personalized mixes and taste metrics
  const loadPersonalizedMixes = useCallback(
    async (force = false) => {
      setIsLoadingMixes(true)
      try {
        const mixes = await PersonalizationService.generatePersonalizedMixes(librarySongs, force)
        setPersonalizedMixes(mixes)
        const metrics = PersonalizationService.getUserTasteMetrics(librarySongs)
        setTasteMetrics(metrics)
      } catch (err) {
        console.warn('Personalized mixes load error:', err)
      } finally {
        setIsLoadingMixes(false)
      }
    },
    [librarySongs]
  )

  useEffect(() => {
    void loadPersonalizedMixes()
  }, [loadPersonalizedMixes])

  useEffect(() => {
    const handleHistoryUpdated = () => void loadPersonalizedMixes(true)
    window.addEventListener('felo:recently-played-updated', handleHistoryUpdated)
    window.addEventListener('fanxmusic:recently-played-updated', handleHistoryUpdated)
    return () => {
      window.removeEventListener('felo:recently-played-updated', handleHistoryUpdated)
      window.removeEventListener('fanxmusic:recently-played-updated', handleHistoryUpdated)
    }
  }, [loadPersonalizedMixes])

  // Persist recommendations
  useEffect(() => {
    if (AppCapabilities.onlineDiscovery) {
      localStorage.setItem(HOME_RECOMMENDED_SONGS_KEY, JSON.stringify(recommendedSongs))
      localStorage.setItem(HOME_RECOMMENDED_ALBUMS_KEY, JSON.stringify(recommendedAlbums))
    }
  }, [recommendedSongs, recommendedAlbums])

  // Toggle like
  const toggleLike = useCallback((songId: string) => {
    setLikedSongIds((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      try {
        localStorage.setItem(LIKED_SONGS_KEY, JSON.stringify([...next]))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  return {
    recommendedSongs,
    setRecommendedSongs,
    recommendedAlbums,
    setRecommendedAlbums,
    hotSongs,
    hotNewAlbums,
    isRefreshing,
    fetchFeed,
    librarySongs,
    setLibrarySongs,
    libraryIndex,
    personalizedMixes,
    isLoadingMixes,
    loadPersonalizedMixes,
    tasteMetrics,
    likedSongIds,
    toggleLike
  }
}
