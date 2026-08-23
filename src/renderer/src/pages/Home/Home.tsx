import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Radio,
  RotateCw,
  Heart,
  Play,
  Download,
  Music2,
  Disc3
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import type { DownloadTarget } from '../../components/DownloadPanel/DownloadPanel'
import type { Song } from '../Library/Library'

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

type TabType = 'home' | 'hot_new' | 'editors_picks' | 'aoty'

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

function upgradeArtwork(url?: string): string | undefined {
  if (!url) return undefined
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.')
}

export default function Home({ onOpenDownloadPanel }: HomeProps) {
  const navigate = useNavigate()
  const { queue, currentSongIndex, setQueue } = usePlayerStore()

  const [activeTab, setActiveTab] = useState<TabType>('home')
  const [recommendedSongs, setRecommendedSongs] = useState<HomeSongItem[]>(CURATED_DEFAULT_SONGS)
  const [recommendedAlbums, setRecommendedAlbums] = useState<HomeAlbumItem[]>(CURATED_DEFAULT_ALBUMS)
  const [hotSongs, setHotSongs] = useState<HomeSongItem[]>([])
  const [editorPicks, setEditorPicks] = useState<HomeSongItem[]>([])
  const [aotyAlbums, setAotyAlbums] = useState<HomeAlbumItem[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [likedSongIds, setLikedSongIds] = useState<Set<string>>(new Set())

  const currentSong = queue[currentSongIndex]

  // Fetch online charts & recommendations from iTunes RSS / Search
  const fetchFeed = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // 1. Fetch Top Trending Songs
      const songsRes = await fetch('https://itunes.apple.com/us/rss/topsongs/limit=50/json')
      if (songsRes.ok) {
        const data = await songsRes.json()
        const entries = data?.feed?.entry || []
        if (Array.isArray(entries) && entries.length > 0) {
          const mapped: HomeSongItem[] = entries.slice(0, 30).map((entry: any, i: number) => {
            const rawTitle = entry?.['im:name']?.label || entry?.title?.label || 'Unknown Track'
            const artist = entry?.['im:artist']?.label || 'Unknown Artist'
            const rawImages = entry?.['im:image'] || []
            const rawArtwork = rawImages[rawImages.length - 1]?.label
            const releaseDate = entry?.['im:releaseDate']?.label
            const year = releaseDate ? new Date(releaseDate).getFullYear() : undefined
            const isExplicit = Boolean(entry?.['im:contentAdvisory']?.label?.toLowerCase().includes('explicit'))

            return {
              id: entry?.id?.attributes?.['im:id'] || `online-${i}`,
              title: rawTitle,
              artist,
              album: entry?.['im:collection']?.['im:name']?.label || '',
              year: year || '2024',
              duration: 180 + ((i * 17) % 110),
              artworkUrl: upgradeArtwork(rawArtwork),
              quality: i % 3 === 0 ? 'HD FLAC' : 'FLAC',
              isExplicit
            }
          })

          setHotSongs(mapped)
          // Mix curated with fresh hits for recommended
          const shuffled = [...CURATED_DEFAULT_SONGS].sort(() => 0.5 - Math.random())
          setRecommendedSongs([...shuffled.slice(0, 10), ...mapped.slice(0, 11)])
        }
      }

      // 2. Fetch Top Albums
      const albumsRes = await fetch('https://itunes.apple.com/us/rss/topalbums/limit=30/json')
      if (albumsRes.ok) {
        const data = await albumsRes.json()
        const entries = data?.feed?.entry || []
        if (Array.isArray(entries) && entries.length > 0) {
          const mappedAlbums: HomeAlbumItem[] = entries.slice(0, 18).map((entry: any, i: number) => {
            const title = entry?.['im:name']?.label || 'Unknown Album'
            const artist = entry?.['im:artist']?.label || 'Unknown Artist'
            const rawImages = entry?.['im:image'] || []
            const rawArtwork = rawImages[rawImages.length - 1]?.label
            const releaseDate = entry?.['im:releaseDate']?.label
            const year = releaseDate ? new Date(releaseDate).getFullYear() : undefined
            const songCount = Number(entry?.['im:itemCount']?.label) || 12

            return {
              id: entry?.id?.attributes?.['im:id'] || `album-${i}`,
              title,
              artist,
              year: year || '2024',
              artworkUrl: upgradeArtwork(rawArtwork),
              songCount
            }
          })

          setAotyAlbums(mappedAlbums.slice(0, 12))
          setRecommendedAlbums([...CURATED_DEFAULT_ALBUMS, ...mappedAlbums.slice(0, 6)])
        }
      }

      // 3. Curate Editor Picks
      setEditorPicks(CURATED_DEFAULT_SONGS.slice(0, 15))
    } catch (err) {
      console.warn('Using curated home defaults due to network:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchFeed()
  }, [fetchFeed])

  const toggleLike = (songId: string) => {
    setLikedSongIds((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  const handleDownload = (song: HomeSongItem) => {
    onOpenDownloadPanel?.({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      duration: song.duration,
      artworkPath: song.artworkUrl,
      isOnline: true
    })
  }

  const handlePlaySong = (song: HomeSongItem) => {
    const queueItem: Song = {
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
    setQueue([queueItem], 0)
  }

  const handleStartInfiniteRadio = () => {
    const list: Song[] = recommendedSongs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      duration: song.duration,
      filePath: `virtual:online:${song.id}`,
      artworkPath: song.artworkUrl,
      size: 0,
      dateAdded: Math.floor(Date.now() / 1000)
    }))
    setQueue(list, 0)
  }

  const displayedSongs = useMemo(() => {
    if (activeTab === 'hot_new') return hotSongs.length ? hotSongs : recommendedSongs
    if (activeTab === 'editors_picks') return editorPicks.length ? editorPicks : recommendedSongs
    return recommendedSongs
  }, [activeTab, hotSongs, editorPicks, recommendedSongs])

  const displayedAlbums = useMemo(() => {
    if (activeTab === 'aoty') return aotyAlbums.length ? aotyAlbums : recommendedAlbums
    return recommendedAlbums
  }, [activeTab, aotyAlbums, recommendedAlbums])

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
          onClick={() => setActiveTab('hot_new')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'hot_new' ? 'text-white font-extrabold' : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Hot & New</span>
          {activeTab === 'hot_new' && (
            <span className="absolute -bottom-3 left-0 right-0 h-0.5 rounded-full bg-[#1ed760]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('editors_picks')}
          className={`relative text-sm font-bold tracking-tight transition-colors ${
            activeTab === 'editors_picks'
              ? 'text-white font-extrabold'
              : 'text-[#a7a7a7] hover:text-white'
          }`}
        >
          <span>Editor's Picks</span>
          {activeTab === 'editors_picks' && (
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
      </div>

      <div className="px-8 pt-6 space-y-10">
        {/* Section 1: Recommended Songs */}
        {activeTab !== 'aoty' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-black tracking-tight text-white">
                  {activeTab === 'hot_new'
                    ? 'Trending Now'
                    : activeTab === 'editors_picks'
                      ? "Editor's Selection"
                      : 'Recommended Songs'}
                </h2>
                {activeTab === 'home' && (
                  <button
                    type="button"
                    onClick={handleStartInfiniteRadio}
                    className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#e67e22] to-[#d35400] px-3 py-1 text-xs font-bold text-white shadow-md transition-transform hover:scale-105 active:scale-95"
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

            {/* 3-column songs grid matching reference screenshot */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
              {displayedSongs.map((song) => {
                const isCurrent = currentSong?.title === song.title
                const isLiked = likedSongIds.has(song.id)

                return (
                  <div
                    key={song.id}
                    className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-white/10"
                  >
                    {/* Thumbnail & Title/Artist */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-[#282828] shadow-sm">
                        {song.artworkUrl ? (
                          <img
                            src={song.artworkUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Music2 className="h-5 w-5 text-[#555] m-auto mt-3" />
                        )}
                        <button
                          type="button"
                          onClick={() => handlePlaySong(song)}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Play className="h-5 w-5 fill-white text-white" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`truncate text-[14px] font-bold ${
                              isCurrent ? 'text-[#1ed760]' : 'text-white'
                            }`}
                            title={song.title}
                          >
                            {song.title}
                          </span>
                          {song.isExplicit && (
                            <span className="shrink-0 rounded bg-white/20 px-1 py-0.2 text-[9px] font-bold text-[#b3b3b3]">
                              E
                            </span>
                          )}
                          {song.quality && (
                            <span className="shrink-0 rounded border border-white/20 bg-black/40 px-1 py-0.2 text-[9px] font-bold text-[#b3b3b3]">
                              {song.quality}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-[#a7a7a7]" title={song.artist}>
                          {song.artist}
                          {song.year ? ` • ${song.year}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Actions: Heart, Duration, Download */}
                    <div className="flex shrink-0 items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => toggleLike(song.id)}
                        className={`transition-transform hover:scale-110 ${
                          isLiked ? 'text-[#1ed760]' : 'text-[#a7a7a7] hover:text-white'
                        }`}
                        title={isLiked ? 'Liked' : 'Like'}
                      >
                        <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                      </button>

                      <span className="w-8 text-right font-mono text-xs text-[#a7a7a7]">
                        {formatDuration(song.duration)}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleDownload(song)}
                        title="Download track"
                        className="hidden rounded-full p-1 text-[#a7a7a7] transition-colors hover:text-[#1ed760] group-hover:block"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Section 2: Recommended Albums */}
        <section className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black tracking-tight text-white">
              {activeTab === 'aoty' ? 'Albums of the Year' : 'Recommended Albums'}
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
              <div
                key={album.id}
                onClick={() => navigate(`/search`)}
                className="group flex flex-col rounded-xl bg-[#181818] p-3 transition-all hover:bg-[#282828] cursor-pointer"
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#222] shadow-md">
                  {album.artworkUrl ? (
                    <img
                      src={album.artworkUrl}
                      alt={album.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <Disc3 className="h-10 w-10 text-[#555] m-auto mt-12" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
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
                    title="Download album"
                    className="absolute right-2 bottom-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#1ed760] text-black shadow-lg opacity-0 translate-y-2 transition-all group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3">
                  <h3 className="truncate text-sm font-bold text-white group-hover:underline">
                    {album.title}
                  </h3>
                  <p className="truncate text-xs text-[#a7a7a7] mt-0.5">
                    {album.artist}
                    {album.year ? ` • ${album.year}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
