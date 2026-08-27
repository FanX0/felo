import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  CheckCircle2,
  Radio,
  RotateCw,
  Heart,
  Play,
  Download,
  Music2,
  ArrowLeft,
  Plus
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import { useDownloadStore } from '../../hooks/useDownloadStore'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_PRIORITY_SETTING,
  STREAMING_ACCOUNTS_SETTING
} from '../../lib/downloadConfig'
import type { Song } from '../Library/Library'
import {
  CHART_CATEGORIES,
  ChartCategory,
  ChartTrack,
  ChartsService,
  AppleChartSection,
  stripSourceSuffix
} from '../../services/ChartsService'
import { findMatchingLibrarySong, isSongInLibrary } from '../../lib/songMatching'
import {
  spotifyPlaylists,
  SpotifyPlaylistItem,
  SpotifySection
} from '../../data/spotifyPlaylists'

export interface HomeSongItem {
  id: string
  title: string
  artist: string
  album?: string
  year?: string | number
  duration: number
  artworkUrl?: string
  quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
  isExplicit?: boolean
  previewUrl?: string
}

export interface HomeAlbumItem {
  id: string
  title: string
  artist: string
  year?: string | number
  artworkUrl?: string
  songCount?: number
  genre?: string
}

interface HomeProps {
  onOpenDownloadPanel?: (target: DownloadTarget) => void
}

function readCachedHomeList<T>(key: string, fallback: T[]): T[] {
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null')
    return Array.isArray(cached) && cached.length > 0 ? cached : fallback
  } catch {
    return fallback
  }
}

const HOME_RECOMMENDED_SONGS_KEY = 'felo_home_recommended_songs'
const HOME_RECOMMENDED_ALBUMS_KEY = 'felo_home_recommended_albums'

type TabType = 'home' | 'hot_new' | 'apple' | 'spotify' | 'aoty' | 'lastfm'

interface ArtworkImageProps {
  src?: string
  title: string
  artist: string
  alt?: string
  className: string
  loading?: 'lazy' | 'eager'
}

function ArtworkImage({ src, title, artist, alt = '', className, loading = 'lazy' }: ArtworkImageProps) {
  const [imageSrc, setImageSrc] = useState(src || '')
  const [failed, setFailed] = useState(!src)
  const [isLoading, setIsLoading] = useState(Boolean(src))
  const fallbackAttempted = useRef(false)

  useEffect(() => {
    setImageSrc(src || '')
    setFailed(!src)
    setIsLoading(Boolean(src))
    fallbackAttempted.current = false
  }, [src])

  const handleError = async () => {
    setFailed(true)
    setIsLoading(true)
    if (fallbackAttempted.current) {
      setIsLoading(false)
      return
    }
    fallbackAttempted.current = true

    try {
      const params = new URLSearchParams({ term: `${artist} ${title}`, entity: 'song', limit: '1' })
      const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`)
      const result = await response.json()
      const artwork = result?.results?.[0]?.artworkUrl100
      if (typeof artwork === 'string' && artwork) {
        setImageSrc(artwork.replace('100x100bb', '600x600bb'))
        setFailed(false)
        return
      }
    } catch {
      // Fall through to the placeholder when the artwork service is unavailable.
    }

    setIsLoading(false)
    setFailed(true)
  }

  if (failed && !isLoading) {
    return <Music2 className="h-5 w-5 text-[#555] m-auto mt-3" />
  }

  return (
    <div className="relative h-full w-full">
      {isLoading && <div className="absolute inset-0 animate-pulse bg-white/10" aria-hidden="true" />}
      {!failed && (
        <img
          src={imageSrc}
          alt={alt}
          className={`${className} relative transition-opacity duration-200 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          loading={loading}
          onLoad={() => setIsLoading(false)}
          onError={() => void handleError()}
        />
      )}
    </div>
  )
}

// ─── Unified Media Card Convention ───────────────────────────────────────────
interface UnifiedMediaCardProps {
  title: string
  subtitle: string
  artworkUrl?: string
  badge?: string
  sourceTag?: string
  score?: number | null
  onClick?: () => void
  onAction?: (e: React.MouseEvent) => void
  actionIcon?: React.ReactNode
  actionTitle?: string
  actionLoading?: boolean
  actionText?: string
}

function UnifiedMediaCard({
  title,
  subtitle,
  artworkUrl,
  badge,
  sourceTag,
  score,
  onClick,
  onAction,
  actionIcon,
  actionTitle,
  actionLoading,
  actionText
}: UnifiedMediaCardProps) {
  const scoreColor =
    score == null
      ? ''
      : score >= 85
        ? 'bg-[#1ed760] text-black'
        : score >= 70
          ? 'bg-[#f5a623] text-black'
          : 'bg-[#e55353] text-white'

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.()
        }
      }}
      className="group flex flex-col cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-[#181818] p-3 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#222222]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#222] shadow-md">
        <ArtworkImage
          src={artworkUrl}
          title={title}
          artist={subtitle}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Critic score badge */}
        {score != null && (
          <span
            className={`absolute top-2 left-2 z-20 rounded px-1.5 py-0.5 text-[11px] font-black tabular-nums shadow ${scoreColor}`}
            title="Critic score"
          >
            {score}
          </span>
        )}

        {/* Badge in top right */}
        {badge && (
          <span className="absolute top-2 right-2 z-20 rounded bg-black/75 backdrop-blur-xs px-2 py-0.5 text-[10px] font-black tracking-wide text-white border border-white/10 shadow">
            {badge}
          </span>
        )}

        {/* Source tag in bottom left */}
        {sourceTag && (
          <span className="absolute bottom-2 left-2 z-20 rounded bg-black/55 backdrop-blur-xs px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white border border-white/10">
            {sourceTag}
          </span>
        )}

        {/* Floating Action Button */}
        {onAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAction(e)
            }}
            title={actionTitle}
            disabled={actionLoading}
            className={`absolute right-2 bottom-2 z-20 flex items-center justify-center rounded-full bg-white text-black shadow-lg transition-all ${
              actionText
                ? 'px-3 py-1 text-[11px] font-black hover:scale-105'
                : 'h-9 w-9 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105'
            }`}
          >
            {actionLoading ? (
              <span className="text-xs font-bold">...</span>
            ) : actionIcon ? (
              actionIcon
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            {actionText && <span className="ml-1">{actionText}</span>}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-white group-hover:underline" title={title}>
            {title}
          </h3>
          <p className="truncate text-xs text-[#a7a7a7] mt-0.5" title={subtitle}>
            {subtitle}
          </p>
        </div>
      </div>
    </article>
  )
}

// High-quality curated default recommendations matching the screenshot reference
const CURATED_DEFAULT_SONGS: HomeSongItem[] = [
  {
    id: 'curated-1',
    title: "Don't Worry My Love",
    artist: 'KAIVON',
    year: '2021',
    duration: 187,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/4b/3e/2a/4b3e2a0f-1555-e41c-3b95-d2ad4f7a2db1/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-2',
    title: 'worth my weight in gold',
    artist: 'One Hope',
    year: '2020',
    duration: 167,
    quality: 'FLAC',
    isExplicit: true,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/bf/25/7e/bf257e84-1886-f131-0118-2e069c9b4e54/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-3',
    title: '1&Only',
    artist: 'XLOV',
    year: '2025',
    duration: 175,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/0d/16/e0/0d16e0b7-4b72-f1df-29bb-432d6fb601ab/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-4',
    title: '2.0',
    artist: 'BTS',
    year: '2026',
    duration: 170,
    quality: 'HD FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d5/43/e7/d543e742-b062-8418-5a21-987819ea2bcf/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-5',
    title: 'like JENNIE',
    artist: 'JENNIE',
    year: '2025',
    duration: 124,
    quality: 'HD FLAC',
    isExplicit: true,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/71/54/1b/71541bee-b9d9-bbba-c397-bb783709b119/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-6',
    title: 'Go To Sleep (feat. Kailee Morgue)',
    artist: 'Bearson, Kailee Morgue',
    year: '2018',
    duration: 227,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/e5/2a/e0/e52ae07b-8ffc-18ff-5561-26c79aebc19b/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-7',
    title: '1-800-hot-n-fun',
    artist: 'LE SSERAFIM',
    year: '2024',
    duration: 173,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/58/63/12/58631248-cb58-2940-d9d8-9477eb372767/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-8',
    title: 'Walls Down',
    artist: 'MEMBA, Evan Gila',
    year: '2021',
    duration: 193,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/e4/2d/cb/e42dcb20-6eb6-dc3c-851a-7b3bc0c4d296/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-9',
    title: 'Broken',
    artist: 'Bryce Savage',
    year: '2022',
    duration: 134,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/80/cb/c7/80cbc7bf-d8dc-0676-e175-1033621ae1c0/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-10',
    title: 'SWIM',
    artist: 'BTS',
    year: '2026',
    duration: 159,
    quality: 'HD FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/91/9a/9a/919a9a3b-c56a-1296-1c25-06be44d9326e/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-11',
    title: "I'm a Sucker for a Liar in a Red Dress",
    artist: 'Adam Jensen',
    year: '2022',
    duration: 224,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/05/bb/e6/05bbe686-e7e7-eeec-67a3-5c74381ae2bc/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-12',
    title: 'Never Done This',
    artist: 'twocolors',
    year: '2023',
    duration: 177,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/e5/7a/7d/e57a7d45-66ec-7ae1-ae86-ca4587db287e/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-13',
    title: 'Hypnotize',
    artist: 'Fairlane, Grant',
    year: '2022',
    duration: 188,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/80/7e/d3/807ed33f-80ff-27c1-7d1d-bb61f8a85e49/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-14',
    title: 'Visionaries (feat. Novet)',
    artist: 'Inzo',
    year: '2017',
    duration: 283,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/ee/12/37/ee1237a8-12c8-89c5-8495-231f82f25b29/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-15',
    title: 'Invisible',
    artist: 'Julius Dreisig, Zeus X Crona',
    year: '2018',
    duration: 201,
    quality: 'HD FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/21/5a/03/215a0376-e82b-0f62-3117-6ffecbe3ebc0/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-16',
    title: 'Run It (feat. Annika Wells)',
    artist: 'Midnight Kids',
    year: '2019',
    duration: 219,
    quality: 'FLAC',
    isExplicit: true,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/f4/64/a1/f464a132-7212-32b0-96f3-9d1ef546c243/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-17',
    title: 'IRIS OUT',
    artist: 'Kenshi Yonezu',
    year: '2025',
    duration: 152,
    quality: 'HD FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/df/e3/37/dfe337e7-37fb-a1e4-8025-a13cb244e83f/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-18',
    title: 'Pins & Needles (Xan Griffin Remix)',
    artist: '888',
    year: '2019',
    duration: 212,
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/c3/97/bb/c397bb6e-8219-c705-cb6d-bfd6c7b39ea3/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-19',
    title: 'Black Hole Sun',
    artist: 'Prismo',
    year: '2019',
    duration: 174,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/a7/b0/0f/a7b00fef-d897-4001-c866-e3d81bfa6bc9/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'curated-20',
    title: 'CEMETERY',
    artist: 'AViVA',
    year: '2020',
    duration: 186,
    quality: 'FLAC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e5/b9/64/e5b96495-234b-4899-7ee4-245c4ffbdcba/artwork.jpg/600x600bb.jpg'
  }
]

const CURATED_DEFAULT_ALBUMS: HomeAlbumItem[] = [
  {
    id: 'album-1',
    title: 'NEFFEX',
    artist: 'NEFFEX',
    year: '2023',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/7e/c9/a1/7ec9a180-877c-7d9a-986a-77e828d115aa/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'album-2',
    title: 'FACELESS',
    artist: 'Unknown Brain',
    year: '2021',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/58/06/66/5806660f-7b79-e5fe-dc44-f5a60064fcf8/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'album-3',
    title: 'DESTINY',
    artist: 'Slushii & Kaivon',
    year: '2022',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/e9/87/46/e98746c8-5dc6-6e42-70b9-8e4ceea2be9c/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'album-4',
    title: 'METAMORPHOSIS',
    artist: 'The Score',
    year: '2022',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/6b/e0/6c/6be06c7a-9a99-b1d6-4444-2ea6f3c1a851/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'album-5',
    title: 'WALK THE MOON',
    artist: 'WALK THE MOON',
    year: '2021',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/c7/a9/f7/c7a9f7e8-bbf7-10ea-f1e1-e1e5b88ff9f2/artwork.jpg/600x600bb.jpg'
  },
  {
    id: 'album-6',
    title: 'The Everlove',
    artist: 'The Everlove',
    year: '2020',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/b8/15/8e/b8158e07-fc55-e41c-ffec-8cf4b3f87b8d/artwork.jpg/600x600bb.jpg'
  }
]

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Strip source-suffix noise like "(Qobuz)", "(YouTube Music)", etc. from display titles. */
function displayTitle(raw: string): string {
  return stripSourceSuffix(raw)
}

export default function Home({ onOpenDownloadPanel }: HomeProps) {
  const navigate = useNavigate()
  const { queue, currentSongIndex, setQueue, updateSong, setIsPlaying } = usePlayerStore()
  const { queueTransfer, updateTransfer } = useDownloadStore()

  const [activeTab, setActiveTab] = useState<TabType>('home')
  const [recommendedSongs, setRecommendedSongs] = useState<HomeSongItem[]>(() =>
    readCachedHomeList(HOME_RECOMMENDED_SONGS_KEY, CURATED_DEFAULT_SONGS)
  )
  const [recommendedAlbums, setRecommendedAlbums] = useState<HomeAlbumItem[]>(() =>
    readCachedHomeList(HOME_RECOMMENDED_ALBUMS_KEY, CURATED_DEFAULT_ALBUMS)
  )
  const [hotSongs, setHotSongs] = useState<HomeSongItem[]>([])
  const [hotNewAlbums, setHotNewAlbums] = useState<HomeAlbumItem[]>([])
  const [aotyAlbums, setAotyAlbums] = useState<any[]>([])
  const [aotyCategory, setAotyCategory] = useState<'must-hear' | 'highest-rated' | 'new-releases' | 'anticipated'>('must-hear')
  const [isLoadingAoty, setIsLoadingAoty] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [likedSongIds, setLikedSongIds] = useState<Set<string>>(new Set())
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [importingSpotifyId, setImportingSpotifyId] = useState<string | null>(null)
  const [selectedSpotifyPlaylist, setSelectedSpotifyPlaylist] = useState<SpotifyPlaylistItem | null>(null)
  const [spotifyTracks, setSpotifyTracks] = useState<Array<{ title: string; artist: string; duration?: number }>>([])
  const [isLoadingSpotifyTracks, setIsLoadingSpotifyTracks] = useState(false)
  const [spotifyArtwork, setSpotifyArtwork] = useState<Record<string, string>>({})
  const [spotifySection, setSpotifySection] = useState<SpotifySection>('all')
  const [appleSection, setAppleSection] = useState<AppleChartSection>('all')
  const [selectedAppleChart, setSelectedAppleChart] = useState<ChartCategory | null>(null)
  const [appleTracks, setAppleTracks] = useState<ChartTrack[]>([])
  const [isLoadingAppleTracks, setIsLoadingAppleTracks] = useState(false)
  const [isInfiniteRadio, setIsInfiniteRadio] = useState(false)
  const radioSongsRef = useRef<Song[]>([])
  const radioRequestedRef = useRef<Set<string>>(new Set())
  const radioTransfersRef = useRef<Map<string, string>>(new Map())
  const radioDownloadInFlightRef = useRef(false)

  const currentSong = queue[currentSongIndex]

  useEffect(() => {
    let mounted = true
    const loadLibraryStatus = async () => {
      try {
        const songs = await window.api?.getSongs?.()
        if (!mounted) return
        const localSongs = (songs || []) as Song[]
        setLibrarySongs(localSongs)
      } catch (error) {
        console.warn('Unable to load homepage library status:', error)
      }
    }

    void loadLibraryStatus()
    const handleLibraryUpdate = () => void loadLibraryStatus()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    return () => {
      mounted = false
      window.removeEventListener('felo:library-updated', handleLibraryUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    }
  }, [])

  // Fetch online charts & recommendations via Monochrome-style Explore Feed API
  const fetchFeed = useCallback(async () => {
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
          return
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

  useEffect(() => {
    localStorage.setItem(HOME_RECOMMENDED_SONGS_KEY, JSON.stringify(recommendedSongs))
    localStorage.setItem(HOME_RECOMMENDED_ALBUMS_KEY, JSON.stringify(recommendedAlbums))
  }, [recommendedSongs, recommendedAlbums])

  useEffect(() => {
    if (activeTab !== 'spotify') {
      // Reset drill-down view when navigating away from Spotify tab
      setSelectedSpotifyPlaylist(null)
      return
    }
    let cancelled = false
    // Fetch artwork for all playlists lazily (they are cheap oembed calls)
    void Promise.all(
      spotifyPlaylists.map(async (playlist) => {
        try {
          const metadata = await window.api?.fetchPlaylistImportMetadata?.(
            `https://open.spotify.com/playlist/${playlist.id}`
          )
          return [playlist.id, typeof metadata?.thumbnail === 'string' ? metadata.thumbnail : ''] as const
        } catch {
          return [playlist.id, ''] as const
        }
      })
    ).then((entries) => {
      if (!cancelled) setSpotifyArtwork(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [activeTab])

  useEffect(() => {
    if (!selectedSpotifyPlaylist) {
      setSpotifyTracks([])
      return
    }
    let cancelled = false
    setIsLoadingSpotifyTracks(true)
    window.api?.fetchSpotifyPlaylistTracks?.(selectedSpotifyPlaylist.id)
      .then((res: any) => {
        if (!cancelled) setSpotifyTracks(res?.tracks || [])
      })
      .catch((err: any) => {
        console.warn('Could not load spotify tracks:', err)
        if (!cancelled) setSpotifyTracks([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSpotifyTracks(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedSpotifyPlaylist])

  useEffect(() => {
    if (activeTab !== 'apple') {
      setSelectedAppleChart(null)
      return
    }
  }, [activeTab])

  useEffect(() => {
    if (!selectedAppleChart) {
      setAppleTracks([])
      return
    }
    let cancelled = false
    setIsLoadingAppleTracks(true)
    ChartsService.fetchCategoryTracks(selectedAppleChart, 100)
      .then((tracks) => {
        if (!cancelled) setAppleTracks(tracks)
      })
      .catch((err) => {
        console.warn('Apple chart load failed:', err)
        if (!cancelled) setAppleTracks([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAppleTracks(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAppleChart])

  useEffect(() => {
    if (activeTab !== 'aoty') return
    let cancelled = false
    setIsLoadingAoty(true)
    window.api?.fetchAotyAlbums?.(aotyCategory)
      .then((albums: any[]) => {
        if (!cancelled) {
          setAotyAlbums(Array.isArray(albums) && albums.length > 0 ? albums : [])
        }
      })
      .catch((err: any) => {
        console.warn('AOTY load failed:', err)
        if (!cancelled) setAotyAlbums([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAoty(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, aotyCategory])

  const [lastFmCategory, setLastFmCategory] = useState<string>('tracks')
  const [lastFmItems, setLastFmItems] = useState<any[]>([])
  const [isLoadingLastFm, setIsLoadingLastFm] = useState(false)

  useEffect(() => {
    if (activeTab !== 'lastfm') return
    let cancelled = false
    setIsLoadingLastFm(true)
    const isTag = !['tracks', 'artists'].includes(lastFmCategory)
    window.api?.fetchLastFmCharts?.(isTag ? 'tag' : lastFmCategory, isTag ? lastFmCategory : undefined)
      .then((items: any[]) => {
        if (!cancelled) setLastFmItems(Array.isArray(items) ? items : [])
      })
      .catch((err: any) => {
        console.warn('Last.fm charts load error:', err)
        if (!cancelled) setLastFmItems([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLastFm(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, lastFmCategory])


  const toggleLike = (songId: string) => {
    setLikedSongIds((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  const handleImportSpotifyPlaylist = async (playlist: SpotifyPlaylistItem) => {
    if (importingSpotifyId) return
    setImportingSpotifyId(playlist.id)
    try {
      const localPlaylist = await window.api?.importSpotifyPlaylist?.(playlist.id, playlist.title)
      if (localPlaylist?.id) navigate(`/playlists/${localPlaylist.id}`)
      else throw new Error('Spotify playlist import returned no local playlist.')
    } catch (error) {
      console.error('Failed to import Spotify playlist:', error)
    } finally {
      setImportingSpotifyId(null)
    }
  }

  const handleDownload = (song: HomeSongItem) => {
    onOpenDownloadPanel?.({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      duration: song.duration,
      artworkPath: song.artworkUrl,
      isOnline: true,
      autoDownload: true,
      autoPlay: false
    })
  }

  const handlePlaySong = async (song: HomeSongItem) => {
    let localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)

    // Refresh once on demand so a newly completed download is playable without
    // requiring a hard refresh or waiting for the library event listener.
    if (!localSong?.filePath) {
      try {
        const latestSongs = (await window.api?.getSongs?.()) as Song[] | undefined
        if (latestSongs) {
          setLibrarySongs(latestSongs)
          localSong = findMatchingLibrarySong(song.title, song.artist, latestSongs)
        }
      } catch (error) {
        console.warn('Unable to refresh library before playback:', error)
      }
    }

    if (localSong?.filePath) {
      setQueue([localSong], 0)
      return
    }

    onOpenDownloadPanel?.({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      duration: song.duration,
      artworkPath: song.artworkUrl,
      isOnline: true,
      autoDownload: true,
      autoPlay: true
    })
  }

  const startRadioDownload = async (song: Song): Promise<void> => {
    if (
      radioDownloadInFlightRef.current ||
      radioRequestedRef.current.has(song.id) ||
      (song.filePath && !song.filePath.startsWith('virtual:'))
    ) return

    radioRequestedRef.current.add(song.id)
    radioDownloadInFlightRef.current = true
    const initialSource = DEFAULT_DOWNLOAD_PRIORITY[0]
    const transferId = queueTransfer({
      source: initialSource,
      sourceName: 'Searching providers',
      title: song.title,
      artist: song.artist,
      quality: 'Auto quality',
      size: 'Searching...',
      conflictMode: 'keep_both',
      status: 'queued',
      progress: 0,
      message: `Infinite Radio: searching for ${song.title}...`
    })
    radioTransfersRef.current.set(transferId, song.id)

    const sourceName = (source: string) =>
      source === 'qobuz' ? 'Qobuz' : source === 'deezer' ? 'Deezer' : source === 'soulseek' ? 'Soulseek P2P' : 'YouTube Music'

    try {
      const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
      const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
      const priority = Array.isArray(savedPriority) && savedPriority.length > 0
        ? savedPriority
        : DEFAULT_DOWNLOAD_PRIORITY
      const accounts = savedAccounts && typeof savedAccounts === 'object' ? savedAccounts : {}

      for (const source of priority) {
        updateTransfer(transferId, {
          source,
          sourceName: sourceName(source),
          message: `Infinite Radio: searching ${sourceName(source)}...`
        })
        try {
          const results = await window.api?.searchDownloadSource?.(
            source,
            `${song.artist} ${song.title}`,
            accounts
          )
          const result = results?.[0]
          if (!result) continue

          updateTransfer(transferId, {
            quality: result.quality || 'Auto quality',
            size: result.size || 'Calculating...',
            message: `Infinite Radio: downloading ${song.title} from ${sourceName(source)}...`
          })
          await window.api?.startDownload?.({
            transferId,
            source,
            resultId: String(result.id),
            title: result.title || song.title,
            artist: result.artist || song.artist,
            songId: song.id,
            conflictMode: 'keep_both',
            accounts
          })
          return
        } catch (error) {
          console.warn(`Infinite Radio ${source} attempt failed:`, error)
        }
      }

      updateTransfer(transferId, {
        status: 'failed',
        progress: 0,
        message: `No provider result found for "${song.title}".`
      })
      radioRequestedRef.current.delete(song.id)
      radioDownloadInFlightRef.current = false
    } catch (error) {
      updateTransfer(transferId, {
        status: 'failed',
        progress: 0,
        message: 'Infinite Radio could not start the download.'
      })
      radioRequestedRef.current.delete(song.id)
      radioDownloadInFlightRef.current = false
      console.warn('Infinite Radio download setup failed:', error)
    }
  }

  const handleStartInfiniteRadio = () => {
    const list: Song[] = recommendedSongs.map((song) => {
      const localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)

      return localSong || {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        duration: song.duration,
        filePath: `virtual:online:${song.id}`,
        artworkPath: song.artworkUrl,
        size: 0,
        dateAdded: Math.floor(Date.now() / 1000)
      }
    })
    radioSongsRef.current = list
    radioRequestedRef.current.clear()
    radioTransfersRef.current.clear()
    setIsInfiniteRadio(true)
    setQueue(list, 0)
    void startRadioDownload(list[0])
  }

  useEffect(() => {
    if (!isInfiniteRadio) return

    const unsubscribe = window.api?.onDownloadProgress?.((event: any) => {
      if (event?.status !== 'completed' || !event.transferId) return
      const songId = radioTransfersRef.current.get(event.transferId)
      if (!songId) return

      const songIndex = radioSongsRef.current.findIndex((song) => song.id === songId)
      const song = radioSongsRef.current[songIndex]
      radioDownloadInFlightRef.current = false
      if (!song || !event.filePath) return

      const downloadedSong = { ...song, filePath: event.filePath }
      radioSongsRef.current[songIndex] = downloadedSong
      setLibrarySongs((previous) => [
        ...previous.filter((candidate) => candidate.id !== downloadedSong.id),
        downloadedSong
      ])
      updateSong(downloadedSong)
      // The virtual URL may have failed before the download completed.
      if (songIndex === usePlayerStore.getState().currentSongIndex) setIsPlaying(true)
      radioTransfersRef.current.delete(event.transferId)

      const nextSong = radioSongsRef.current[songIndex + 1]
      const currentIndex = usePlayerStore.getState().currentSongIndex
      if (nextSong && currentIndex >= songIndex) void startRadioDownload(nextSong)
    })

    return () => unsubscribe?.()
  }, [isInfiniteRadio, updateSong])

  useEffect(() => {
    if (!isInfiniteRadio) return

    const nextSong = radioSongsRef.current[currentSongIndex + 1]
    if (nextSong) void startRadioDownload(nextSong)
  }, [currentSongIndex, isInfiniteRadio])

  const displayedSongs = useMemo(() => {
    if (activeTab === 'hot_new') return hotSongs.length ? hotSongs : recommendedSongs
    return recommendedSongs
  }, [activeTab, hotSongs, recommendedSongs])

  const displayedAlbums = useMemo(() => {
    if (activeTab === 'hot_new') return hotNewAlbums.length ? hotNewAlbums : recommendedAlbums
    return recommendedAlbums
  }, [activeTab, hotNewAlbums, recommendedAlbums])

  return (
    <div className="relative min-h-full w-full bg-[#121212] text-white select-none pb-24">
      {/* Top Tabs Navigation Bar */}
      <div className="sticky top-0 z-20 flex items-center gap-8 border-b border-white/10 bg-[#121212]/95 px-8 pt-4 pb-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'home' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Home</span>
          {activeTab === 'home' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('apple')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'apple' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Apple</span>
          {activeTab === 'apple' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('spotify')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'spotify' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Spotify</span>
          {activeTab === 'spotify' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('aoty')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'aoty' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>AOTY</span>
          {activeTab === 'aoty' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('lastfm')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'lastfm' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Last.fm</span>
          {activeTab === 'lastfm' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>
      </div>

      <div className="space-y-10 px-4 pt-5 sm:px-8 sm:pt-6">
        {/* ─── Apple Music Tab (Charts & Curated Playlists) ────────────────────────── */}
        {activeTab === 'apple' && (
          <section className="space-y-5 pt-2">
            {selectedAppleChart ? (
              <div className="space-y-6">
                {/* Back button */}
                <button
                  type="button"
                  onClick={() => setSelectedAppleChart(null)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to Apple charts</span>
                </button>

                {/* Hero Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-[#181818] p-6 shadow-xl">
                  <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-[#222] shadow-2xl">
                    <ArtworkImage
                      src={selectedAppleChart.coverUrl}
                      title={selectedAppleChart.name}
                      artist="Apple Music"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 rounded bg-black/60 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white border border-white/10">
                      {selectedAppleChart.badge || 'Apple Music Chart'}
                    </span>
                    <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-white">
                      {selectedAppleChart.name}
                    </h1>
                    <p className="mt-2 text-sm text-[#a7a7a7]">
                      {selectedAppleChart.description || 'Top chart tracks updated daily from Apple Music.'}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={appleTracks.length === 0}
                        onClick={() => {
                          if (appleTracks.length > 0) {
                            const songItems: Song[] = appleTracks.map((t) => ({
                              id: t.id,
                              title: t.title,
                              artist: t.artist,
                              album: t.album || '',
                              duration: t.duration || 0,
                              filePath: `virtual:apple:${t.id}`,
                              artworkPath: t.artworkUrl,
                              dateAdded: Math.floor(Date.now() / 1000)
                            }))
                            setQueue(songItems, 0)
                          }
                        }}
                        className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-black text-black transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Play className="h-4 w-4 fill-black" />
                        <span>Play Chart</span>
                      </button>
                      <span className="text-xs font-bold text-[#a7a7a7]">{appleTracks.length} tracks</span>
                    </div>
                  </div>
                </div>

                {/* Tracks list */}
                <div className="space-y-2">
                  <h3 className="text-lg font-black text-white">Tracklist</h3>

                  {isLoadingAppleTracks ? (
                    <div className="space-y-2">
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 animate-pulse">
                          <div className="w-7 h-4 rounded bg-white/10" />
                          <div className="h-10 w-10 shrink-0 rounded-lg bg-white/10" />
                          <div className="flex-1 space-y-2">
                            <div className="h-3 w-2/3 rounded bg-white/10" />
                            <div className="h-2.5 w-1/3 rounded bg-white/5" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : appleTracks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                      <Music2 className="h-12 w-12 text-white/20" />
                      <p className="text-sm font-semibold text-[#a7a7a7]">Could not load chart tracks.</p>
                      <button
                        type="button"
                        onClick={() => setSelectedAppleChart({ ...selectedAppleChart })}
                        className="mt-2 rounded-full bg-white/10 px-5 py-2 text-xs font-bold text-white hover:bg-white/20"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {appleTracks.map((track) => {
                        const isInLibrary = isSongInLibrary(track.title, track.artist, librarySongs)
                        const isCurrent = currentSong?.title === track.title
                        const trackSongItem: HomeSongItem = {
                          id: track.id,
                          title: track.title,
                          artist: track.artist,
                          album: track.album || '',
                          duration: track.duration || 0,
                          artworkUrl: track.artworkUrl
                        }

                        return (
                          <div
                            key={track.id}
                            onClick={() => void handlePlaySong(trackSongItem)}
                            className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/10"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="w-7 shrink-0 text-right text-sm font-extrabold text-[#a7a7a7] tabular-nums">
                                {track.rank}
                              </span>

                              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[#282828] shadow-sm">
                                {track.artworkUrl ? (
                                  <img
                                    src={track.artworkUrl}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <Music2 className="h-5 w-5 text-white/30" />
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handlePlaySong(trackSongItem)
                                  }}
                                  className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                  <Play className="h-5 w-5 fill-white text-white" />
                                </button>
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-bold ${isCurrent ? 'text-white' : 'text-white'}`}>
                                  {displayTitle(track.title)}
                                </p>
                                <p className="truncate text-xs text-[#a7a7a7]">
                                  {track.artist}
                                  {track.album && (
                                    <> <span className="text-white/20">•</span> {displayTitle(track.album)}</>
                                  )}
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 pr-2">
                              {track.duration && track.duration > 0 && (
                                <span className="text-xs text-[#a7a7a7] tabular-nums">
                                  {Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, '0')}
                                </span>
                              )}
                              {isInLibrary && (
                                <span title="In your library">
                                  <CheckCircle2 className="h-4 w-4 text-white" />
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white">Apple Music Charts</h2>
                    <p className="mt-1 text-sm text-[#a7a7a7]">
                      Top songs, global leaderboards, and genre charts updated daily.
                    </p>
                  </div>
                  <span className="self-start sm:self-auto rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
                    Live Apple Feeds
                  </span>
                </div>

                {/* Sub-tabs Filter Pills */}
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
                  {[
                    { id: 'all' as const, label: 'All Charts', count: CHART_CATEGORIES.length },
                    {
                      id: 'charts' as const,
                      label: 'Top 100',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'charts').length
                    },
                    {
                      id: 'pop' as const,
                      label: 'Pop',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'pop').length
                    },
                    {
                      id: 'hiphop' as const,
                      label: 'Hip-Hop / Rap',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'hiphop').length
                    },
                    {
                      id: 'rock' as const,
                      label: 'Rock',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'rock').length
                    },
                    {
                      id: 'alternative' as const,
                      label: 'Alternative',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'alternative').length
                    },
                    {
                      id: 'electronic' as const,
                      label: 'Dance & EDM',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'electronic').length
                    },
                    {
                      id: 'rnb' as const,
                      label: 'R&B / Soul',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'rnb').length
                    },
                    {
                      id: 'genres' as const,
                      label: 'Genres',
                      count: CHART_CATEGORIES.filter((c) => c.section === 'genres').length
                    }
                  ].map((tab) => {
                    const isActive = appleSection === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setAppleSection(tab.id)}
                        className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                          isActive
                            ? 'bg-white text-black shadow-md'
                            : 'bg-[#242424] text-[#a7a7a7] hover:bg-[#2e2e2e] hover:text-white'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                            isActive ? 'bg-black/15 text-black' : 'bg-white/10 text-[#a7a7a7]'
                          }`}
                        >
                          {tab.count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Apple Charts Grid */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {(appleSection === 'all'
                    ? CHART_CATEGORIES
                    : CHART_CATEGORIES.filter((c) => c.section === appleSection)
                  ).map((chart) => (
                    <UnifiedMediaCard
                      key={chart.id}
                      title={chart.name}
                      subtitle={chart.description || 'Apple Music Top Chart'}
                      artworkUrl={chart.coverUrl}
                      badge={chart.badge}
                      sourceTag="Apple Music"
                      onClick={() => setSelectedAppleChart(chart)}
                      onAction={() => setSelectedAppleChart(chart)}
                      actionTitle={`Explore ${chart.name}`}
                      actionIcon={<Play className="h-4 w-4 fill-current" />}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ─── Section 1: Recommended Songs ─────────────────────────────────────────── */}
        {(activeTab === 'home' || activeTab === 'hot_new') && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                  {activeTab === 'hot_new' ? 'Trending Now' : 'Recommended Songs'}
                </h2>
                {activeTab === 'home' && (
                  <button
                    type="button"
                    onClick={handleStartInfiniteRadio}
                    className="inline-flex h-8 items-center gap-2 rounded-full bg-[#2a2a2a] px-4 text-xs font-bold text-white shadow-md transition-all hover:bg-[#353535] hover:shadow-lg active:scale-95"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    <span>Start Infinite Radio</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => void fetchFeed()}
                title="Refresh recommendations"
                disabled={isRefreshing}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#a7a7a7] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <RotateCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Keep recommendations readable beside the download panel. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
              {displayedSongs.map((song) => {
                const isCurrent = currentSong?.title === song.title
                const isLiked = likedSongIds.has(song.id)
                const isInLibrary = isSongInLibrary(song.title, song.artist, librarySongs)

                return (
                  <div
                    key={song.id}
                    className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-white/10"
                  >
                    {/* Thumbnail & Title/Artist */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-[#282828] shadow-sm">
                        <ArtworkImage
                          src={song.artworkUrl}
                          title={song.title}
                          artist={song.artist}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void handlePlaySong(song)}
                          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Play className="h-4 w-4 fill-white text-white" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={`truncate text-sm font-bold ${isCurrent ? 'text-white' : 'text-white'}`}>
                            {displayTitle(song.title)}
                          </p>
                          {song.isExplicit && (
                            <span className="rounded bg-white/20 px-1 py-0.5 text-[9px] font-bold uppercase text-[#a7a7a7]">
                              E
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-[#a7a7a7]">{song.artist}</p>
                      </div>
                    </div>

                    {/* Actions & Meta */}
                    <div className="flex items-center gap-3">
                      {song.quality && (
                        <span className="hidden sm:inline-block rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-bold text-[#a7a7a7]">
                          {song.quality}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => toggleLike(song.id)}
                        className={`text-xs transition-colors ${
                          isLiked ? 'text-white' : 'text-[#a7a7a7] opacity-0 group-hover:opacity-100 hover:text-white'
                        }`}
                      >
                        <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownload(song)}
                        title={isInLibrary ? 'Already in your library' : 'Download track'}
                        className={`text-xs transition-colors ${
                          isInLibrary
                            ? 'text-white'
                            : 'text-[#a7a7a7] opacity-0 group-hover:opacity-100 hover:text-white'
                        }`}
                      >
                        {isInLibrary ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>

                      <span className="w-9 text-right text-xs text-[#a7a7a7]">
                        {formatDuration(song.duration)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ─── Spotify Tab ──────────────────────────────────────────────────────────── */}
        {activeTab === 'spotify' && (
          <section className="space-y-5 pt-2">
            {selectedSpotifyPlaylist ? (
              <div className="space-y-6">
                <button
                  type="button"
                  onClick={() => setSelectedSpotifyPlaylist(null)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to Spotify playlists</span>
                </button>

                <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-[#181818] p-6 shadow-xl">
                  <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-[#222] shadow-2xl">
                    {spotifyArtwork[selectedSpotifyPlaylist.id] ? (
                      <img
                        src={spotifyArtwork[selectedSpotifyPlaylist.id]}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-900 to-green-700">
                        <Music2 className="h-16 w-16 text-white/90" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 rounded bg-black/60 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white border border-white/10">
                      Spotify Playlist
                    </span>
                    <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-white">
                      {selectedSpotifyPlaylist.title}
                    </h1>
                    <p className="mt-2 text-sm text-[#a7a7a7]">
                      {selectedSpotifyPlaylist.category} • {selectedSpotifyPlaylist.update}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleImportSpotifyPlaylist(selectedSpotifyPlaylist)}
                        disabled={Boolean(importingSpotifyId)}
                        className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-black text-black transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        <Plus className="h-4 w-4" />
                        <span>{importingSpotifyId === selectedSpotifyPlaylist.id ? 'Importing...' : 'Add to Local Playlists'}</span>
                      </button>
                      <span className="text-xs font-bold text-[#a7a7a7]">{spotifyTracks.length} tracks</span>
                    </div>
                  </div>
                </div>

                {/* Tracks list */}
                <div className="space-y-2">
                  <h3 className="text-lg font-black text-white">Tracklist preview</h3>
                  {isLoadingSpotifyTracks ? (
                    <div className="space-y-2">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-12 rounded-lg bg-white/5 animate-pulse" />
                      ))}
                    </div>
                  ) : spotifyTracks.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#a7a7a7]">No track details loaded for this playlist.</div>
                  ) : (
                    <div className="space-y-1">
                      {spotifyTracks.map((track, i) => {
                        const isInLibrary = isSongInLibrary(track.title, track.artist, librarySongs)
                        const trackSongItem: HomeSongItem = {
                          id: `spotify-${selectedSpotifyPlaylist.id}-${i}`,
                          title: track.title,
                          artist: track.artist,
                          duration: track.duration || 0
                        }

                        return (
                          <div
                            key={i}
                            onClick={() => void handlePlaySong(trackSongItem)}
                            className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-white/10 transition-colors"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="w-6 text-right text-xs font-extrabold text-[#a7a7a7] tabular-nums">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-white">{track.title}</p>
                                <p className="truncate text-xs text-[#a7a7a7]">{track.artist}</p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2 pr-2">
                              {track.duration && track.duration > 0 && (
                                <span className="text-xs text-[#a7a7a7] tabular-nums">
                                  {Math.floor(track.duration / 60)}:{String(Math.floor(track.duration % 60)).padStart(2, '0')}
                                </span>
                              )}
                              {isInLibrary && (
                                <span title="In your library">
                                  <CheckCircle2 className="h-4 w-4 text-white" />
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black tracking-tight text-white">Spotify Playlists</h2>
                    <p className="mt-1 text-sm text-[#a7a7a7]">
                      Explore charts, trending hits, new releases, and curated genres.
                    </p>
                  </div>
                  <span className="self-start sm:self-auto rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
                    Spotify Curated
                  </span>
                </div>

                {/* Sub-tabs Filter Pills */}
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
                  {[
                    { id: 'all' as const, label: 'All Playlists', count: spotifyPlaylists.length },
                    {
                      id: 'popular' as const,
                      label: 'Popular Now',
                      count: spotifyPlaylists.filter((p) => p.section === 'popular').length
                    },
                    {
                      id: 'charts' as const,
                      label: 'Charts',
                      count: spotifyPlaylists.filter((p) => p.section === 'charts').length
                    },
                    {
                      id: 'trending' as const,
                      label: 'Trending & Rising',
                      count: spotifyPlaylists.filter((p) => p.section === 'trending').length
                    },
                    {
                      id: 'new_music' as const,
                      label: 'New Music',
                      count: spotifyPlaylists.filter((p) => p.section === 'new_music').length
                    },
                    {
                      id: 'genres' as const,
                      label: 'Genres',
                      count: spotifyPlaylists.filter((p) => p.section === 'genres').length
                    }
                  ].map((tab) => {
                    const isActive = spotifySection === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSpotifySection(tab.id)}
                        className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                          isActive
                            ? 'bg-white text-black shadow-md'
                            : 'bg-[#242424] text-[#a7a7a7] hover:bg-[#2e2e2e] hover:text-white'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold ${
                            isActive ? 'bg-black/15 text-black' : 'bg-white/10 text-[#a7a7a7]'
                          }`}
                        >
                          {tab.count}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {/* Spotify Playlists Grid */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {(spotifySection === 'all'
                    ? spotifyPlaylists
                    : spotifyPlaylists.filter((p) => p.section === spotifySection)
                  ).map((playlist) => (
                    <UnifiedMediaCard
                      key={playlist.id}
                      title={playlist.title}
                      subtitle={`${playlist.category} • ${playlist.update}`}
                      artworkUrl={spotifyArtwork[playlist.id]}
                      badge={'badge' in playlist ? playlist.badge : undefined}
                      sourceTag="Spotify"
                      onClick={() => setSelectedSpotifyPlaylist(playlist)}
                      onAction={(e) => {
                        e.stopPropagation()
                        void handleImportSpotifyPlaylist(playlist)
                      }}
                      actionTitle={`Add ${playlist.title} to local playlists`}
                      actionLoading={importingSpotifyId === playlist.id}
                      actionText="Add"
                      actionIcon={<Plus className="h-3.5 w-3.5 mr-0.5" />}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ─── AOTY Tab ─────────────────────────────────────────────────────────────── */}
        {activeTab === 'aoty' && (
          <section className="space-y-5 pt-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white">Album of the Year</h2>
                <p className="mt-1 text-sm text-[#a7a7a7]">
                  Curated critic lists from <span className="font-bold text-white">albumoftheyear.org</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLoadingAoty(true)
                  window.api?.fetchAotyAlbums?.(aotyCategory)
                    .then((albums: any[]) => setAotyAlbums(Array.isArray(albums) && albums.length > 0 ? albums : []))
                    .catch(() => {})
                    .finally(() => setIsLoadingAoty(false))
                }}
                title="Refresh AOTY list"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#a7a7a7] transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCw className={`h-4 w-4 ${isLoadingAoty ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              {([
                { id: 'must-hear', label: 'Must Hear' },
                { id: 'highest-rated', label: 'Highest Rated' },
                { id: 'new-releases', label: 'New Releases' },
                { id: 'anticipated', label: 'Anticipated' }
              ] as const).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setAotyCategory(cat.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                    aotyCategory === cat.id
                      ? 'bg-white text-black'
                      : 'bg-white/10 text-[#a7a7a7] hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* AOTY Grid */}
            {isLoadingAoty && aotyAlbums.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex flex-col rounded-xl bg-[#181818] p-3 animate-pulse">
                    <div className="aspect-square w-full rounded-lg bg-white/10" />
                    <div className="mt-3 h-3 w-3/4 rounded bg-white/10" />
                    <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {aotyAlbums.map((album: any) => (
                  <UnifiedMediaCard
                    key={album.id}
                    title={album.title}
                    subtitle={`${album.artist}${album.year ? ` • ${album.year}` : ''}`}
                    artworkUrl={album.coverUrl || album.artworkUrl}
                    score={album.criticScore ?? null}
                    badge={album.mustHear ? 'Must Hear' : undefined}
                    sourceTag="AOTY"
                    onClick={() => navigate(`/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`)}
                    onAction={() => {
                      onOpenDownloadPanel?.({
                        id: album.id,
                        title: album.title,
                        artist: album.artist,
                        album: album.title,
                        duration: 0,
                        artworkPath: album.coverUrl || album.artworkUrl,
                        isOnline: true
                      })
                    }}
                    actionTitle="Download album"
                    actionIcon={<Download className="h-4 w-4" />}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ─── Last.fm Tab ───────────────────────────────────────────────────────── */}
        {activeTab === 'lastfm' && (
          <section className="space-y-5 pt-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-white">Last.fm Scrobbles & Charts</h2>
                <p className="mt-1 text-sm text-[#a7a7a7]">
                  Global listener charts, top played tracks, and curated tag trends from <span className="font-bold text-white">Last.fm</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLoadingLastFm(true)
                  const isTag = !['tracks', 'artists'].includes(lastFmCategory)
                  window.api?.fetchLastFmCharts?.(isTag ? 'tag' : lastFmCategory, isTag ? lastFmCategory : undefined)
                    .then((items: any[]) => setLastFmItems(Array.isArray(items) ? items : []))
                    .catch(() => {})
                    .finally(() => setIsLoadingLastFm(false))
                }}
                title="Refresh Last.fm charts"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#a7a7a7] transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCw className={`h-4 w-4 ${isLoadingLastFm ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'tracks', label: 'Top Tracks' },
                { id: 'artists', label: 'Top Artists' },
                { id: 'indie', label: 'Indie & Alt' },
                { id: 'rock', label: 'Rock' },
                { id: 'electronic', label: 'Electronic' },
                { id: 'hip-hop', label: 'Hip-Hop' },
                { id: 'pop', label: 'Pop' },
                { id: 'shoegaze', label: 'Shoegaze' },
                { id: 'metal', label: 'Metal' }
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setLastFmCategory(cat.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                    lastFmCategory === cat.id
                      ? 'bg-white text-black shadow-md'
                      : 'bg-white/10 text-[#a7a7a7] hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Grid */}
            {isLoadingLastFm && lastFmItems.length === 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex flex-col rounded-xl bg-[#181818] p-3 animate-pulse">
                    <div className="aspect-square w-full rounded-lg bg-white/10" />
                    <div className="mt-3 h-3 w-3/4 rounded bg-white/10" />
                    <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : lastFmItems.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#a7a7a7]">
                No items found for this Last.fm chart.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {lastFmItems.map((item: any) => {
                  const isArtist = item.type === 'artist'
                  const trackSongItem: HomeSongItem = {
                    id: item.id,
                    title: item.title,
                    artist: isArtist ? '' : item.artist,
                    duration: 0,
                    artworkUrl: item.artworkUrl
                  }

                  return (
                    <UnifiedMediaCard
                      key={item.id}
                      title={item.title}
                      subtitle={isArtist ? item.listeners || 'Artist' : item.artist}
                      artworkUrl={item.artworkUrl}
                      badge={item.listeners || (item.playcount ? `#${item.rank}` : undefined)}
                      sourceTag="Last.fm"
                      onClick={() => {
                        if (isArtist) {
                          navigate(`/artist/${encodeURIComponent(item.title)}`)
                        } else {
                          void handlePlaySong(trackSongItem)
                        }
                      }}
                      onAction={() => {
                        if (isArtist) {
                          navigate(`/artist/${encodeURIComponent(item.title)}`)
                        } else {
                          void handlePlaySong(trackSongItem)
                        }
                      }}
                      actionTitle={isArtist ? `Open ${item.title}` : `Play ${item.title}`}
                      actionIcon={isArtist ? <ArrowLeft className="h-4 w-4 rotate-180" /> : <Play className="h-4 w-4 fill-current" />}
                    />
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ─── Section 3: Recommended / New Albums ───────────────────────────────────── */}
        {(activeTab === 'home' || activeTab === 'hot_new') && (
          <section className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black tracking-tight text-white">
                {activeTab === 'hot_new' ? 'New Albums & EPs' : 'Recommended Albums'}
              </h2>

              <button
                type="button"
                onClick={() => void fetchFeed()}
                title="Refresh albums"
                disabled={isRefreshing}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#a7a7a7] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <RotateCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {displayedAlbums.map((album) => (
                <UnifiedMediaCard
                  key={album.id}
                  title={album.title}
                  subtitle={`${album.artist}${album.year ? ` • ${album.year}` : ''}`}
                  artworkUrl={album.artworkUrl}
                  sourceTag="Album"
                  onClick={() => navigate(`/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`)}
                  onAction={() => {
                    onOpenDownloadPanel?.({
                      id: album.id,
                      title: album.title,
                      artist: album.artist,
                      album: album.title,
                      duration: 0,
                      artworkPath: album.artworkUrl,
                      isOnline: true
                    })
                  }}
                  actionTitle="Download album"
                  actionIcon={<Download className="h-4 w-4" />}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
