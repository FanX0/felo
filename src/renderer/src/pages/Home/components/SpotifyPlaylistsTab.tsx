import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Download, CheckCircle2, Loader2, Music2 } from 'lucide-react'
import {
  spotifyPlaylists,
  SpotifyPlaylistItem,
  SpotifySection
} from '../../../data/spotifyPlaylists'
import type { HomeSongItem } from '../types'
import { UnifiedMediaCard } from './UnifiedMediaCard'
import { useDownloadStore } from '../../../hooks/useDownloadStore'

interface SpotifyPlaylistsTabProps {
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  onChooseSourceOrReplace: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
}

export function SpotifyPlaylistsTab({
  onPlaySong,
  onDownloadSong,
  onChooseSourceOrReplace,
  libraryIndex
}: SpotifyPlaylistsTabProps) {
  const navigate = useNavigate()
  const transfers = useDownloadStore((s) => s.transfers)

  const [spotifySection, setSpotifySection] = useState<SpotifySection>('all')
  const [selectedSpotifyPlaylist, setSelectedSpotifyPlaylist] = useState<SpotifyPlaylistItem | null>(null)
  const [spotifyTracks, setSpotifyTracks] = useState<Array<{ title: string; artist: string; duration?: number }>>([])
  const [isLoadingSpotifyTracks, setIsLoadingSpotifyTracks] = useState(false)
  const [spotifyArtwork, setSpotifyArtwork] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const p of spotifyPlaylists) {
      if (p.artworkUrl) initial[p.id] = p.artworkUrl
    }
    try {
      const cached = JSON.parse(localStorage.getItem('felo:spotify-artwork-cache') || '{}')
      return { ...initial, ...cached }
    } catch {
      return initial
    }
  })
  const [importingSpotifyId, setImportingSpotifyId] = useState<string | null>(null)

  // Fetch live artwork progressively in background to refresh thumbnails
  useEffect(() => {
    let cancelled = false
    const cacheKey = 'felo:spotify-artwork-cache'

    spotifyPlaylists.forEach((playlist) => {
      void (async () => {
        try {
          const metadata = await window.api?.fetchPlaylistImportMetadata?.(
            `https://open.spotify.com/playlist/${playlist.id}`
          )
          const thumb = typeof metadata?.thumbnail === 'string' ? metadata.thumbnail : ''
          if (thumb && !cancelled) {
            setSpotifyArtwork((prev) => {
              if (prev[playlist.id] === thumb) return prev
              const next = { ...prev, [playlist.id]: thumb }
              try {
                localStorage.setItem(cacheKey, JSON.stringify(next))
              } catch {}
              return next
            })
          }
        } catch {
          // Keep existing pre-baked or cached artwork
        }
      })()
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Fetch tracks when playlist selected
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

  // Drilldown View
  if (selectedSpotifyPlaylist) {
    return (
      <section className="space-y-6 pt-2">
        <button
          type="button"
          onClick={() => setSelectedSpotifyPlaylist(null)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-elevated/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-hover hover:scale-105"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Spotify playlists</span>
        </button>

        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-surface-elevated/90 p-6 sm:p-8 shadow-2xl">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-surface shadow-2xl">
            {spotifyArtwork[selectedSpotifyPlaylist.id] || selectedSpotifyPlaylist.artworkUrl ? (
              <img
                src={spotifyArtwork[selectedSpotifyPlaylist.id] || selectedSpotifyPlaylist.artworkUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface-elevated">
                <Music2 className="h-16 w-16 text-text-muted" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-mono text-xs text-text-muted uppercase tracking-wider">
              Spotify Playlist
            </span>
            <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-white">
              {selectedSpotifyPlaylist.title}
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              {selectedSpotifyPlaylist.category} • {selectedSpotifyPlaylist.update}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleImportSpotifyPlaylist(selectedSpotifyPlaylist)}
                disabled={Boolean(importingSpotifyId)}
                className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-black text-black shadow-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-60"
              >
                {importingSpotifyId === selectedSpotifyPlaylist.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span>
                  {importingSpotifyId === selectedSpotifyPlaylist.id
                    ? 'Importing...'
                    : 'Add to Local Playlists'}
                </span>
              </button>
              <span className="text-xs font-bold text-text-muted">
                {spotifyTracks.length} tracks
              </span>
            </div>
          </div>
        </div>

        {/* Tracks List */}
        <div className="space-y-2">
          <h3 className="text-lg font-black text-white px-1">Tracklist preview</h3>
          {isLoadingSpotifyTracks ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-surface-elevated/40 animate-pulse border border-white/5"
                />
              ))}
            </div>
          ) : spotifyTracks.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-muted">
              No track details loaded for this playlist.
            </div>
          ) : (
            <div className="space-y-1">
              {spotifyTracks.map((track, i) => {
                const isInLibrary = libraryIndex.has(track.title, track.artist)
                const trackSongItem: HomeSongItem = {
                  id: `spotify-${selectedSpotifyPlaylist.id}-${i}`,
                  title: track.title,
                  artist: track.artist,
                  duration: track.duration || 0
                }

                const transfer = transfers.find(
                  (t) =>
                    t.title.toLowerCase() === trackSongItem.title.toLowerCase() &&
                    (!trackSongItem.artist ||
                      !t.artist ||
                      t.artist.toLowerCase() === trackSongItem.artist.toLowerCase()) &&
                    (t.status === 'downloading' || t.status === 'queued')
                )
                const isDownloading = Boolean(transfer)

                return (
                  <div
                    key={i}
                    onClick={() => void onPlaySong(trackSongItem)}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover transition-colors"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-6 text-right text-xs font-black text-text-muted tabular-nums">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white group-hover:text-primary-amber transition-colors">
                          {track.title}
                        </p>
                        <p className="truncate text-xs text-text-muted mt-0.5">{track.artist}</p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 pr-2">
                      {track.duration && track.duration > 0 && (
                        <span className="text-xs text-text-muted tabular-nums">
                          {Math.floor(track.duration / 60)}:
                          {String(Math.floor(track.duration % 60)).padStart(2, '0')}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isInLibrary) {
                            onChooseSourceOrReplace(trackSongItem)
                          } else {
                            onDownloadSong(trackSongItem)
                          }
                        }}
                        title={
                          isDownloading
                            ? `Downloading (${transfer?.progress || 0}%)...`
                            : isInLibrary
                              ? 'In your library (Click to choose source or replace)'
                              : 'Download track to library'
                        }
                        className={`h-7 w-7 flex items-center justify-center rounded-full transition-all ${
                          isDownloading
                            ? 'text-primary-amber'
                            : isInLibrary
                              ? 'text-text-muted hover:text-white hover:bg-white/10'
                              : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isInLibrary ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    )
  }

  // Grid View
  const categories = [
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
  ]

  const filteredPlaylists =
    spotifySection === 'all'
      ? spotifyPlaylists
      : spotifyPlaylists.filter((p) => p.section === spotifySection)

  return (
    <section className="space-y-5 pt-2">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">Spotify Playlists</h2>
          <p className="mt-1 text-sm text-text-muted">
            Explore charts, trending hits, new releases, and curated genres.
          </p>
        </div>
        <span className="self-start sm:self-auto rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white border border-white/10">
          Spotify Curated
        </span>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
        {categories.map((tab) => {
          const isActive = spotifySection === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSpotifySection(tab.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                isActive
                  ? 'bg-white text-black shadow-md'
                  : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                  isActive ? 'bg-black/15 text-black' : 'bg-white/10 text-text-muted'
                }`}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {filteredPlaylists.map((playlist) => (
          <UnifiedMediaCard
            key={playlist.id}
            title={playlist.title}
            subtitle={`${playlist.category} • ${playlist.update}`}
            artworkUrl={spotifyArtwork[playlist.id] || playlist.artworkUrl}
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
    </section>
  )
}
