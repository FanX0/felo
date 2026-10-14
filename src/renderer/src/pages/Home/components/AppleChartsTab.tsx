import { useState, useEffect } from 'react'
import { ArrowLeft, Play, Download, CheckCircle2, Loader2, Music2 } from 'lucide-react'
import {
  CHART_CATEGORIES,
  ChartCategory,
  ChartTrack,
  ChartsService,
  AppleChartSection,
  stripSourceSuffix
} from '../../../services/ChartsService'
import type { Song } from '../../Library/Library'
import type { HomeSongItem } from '../types'
import { ArtworkImage } from './ArtworkImage'
import { UnifiedMediaCard } from './UnifiedMediaCard'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'

interface AppleChartsTabProps {
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  onChooseSourceOrReplace: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
}

export function AppleChartsTab({
  onPlaySong,
  onDownloadSong,
  onChooseSourceOrReplace,
  libraryIndex
}: AppleChartsTabProps) {
  const { queue, currentSongIndex, setQueue } = usePlayerStore()
  const { transfers } = useDownloadStore()
  const currentSong = queue[currentSongIndex]

  const [appleSection, setAppleSection] = useState<AppleChartSection>('all')
  const [selectedAppleChart, setSelectedAppleChart] = useState<ChartCategory | null>(null)
  const [appleTracks, setAppleTracks] = useState<ChartTrack[]>([])
  const [isLoadingAppleTracks, setIsLoadingAppleTracks] = useState(false)

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

  const handlePlayChart = () => {
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
  }

  // Drilldown Chart Tracklist View
  if (selectedAppleChart) {
    return (
      <section className="space-y-6 pt-2">
        <button
          type="button"
          onClick={() => setSelectedAppleChart(null)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-elevated/80 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-hover hover:scale-105"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Apple charts</span>
        </button>

        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-surface-elevated/90 p-6 sm:p-8 shadow-2xl">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-surface shadow-2xl">
            <ArtworkImage
              src={selectedAppleChart.coverUrl}
              title={selectedAppleChart.name}
              artist="Apple Music"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white border border-white/10">
              {selectedAppleChart.badge || 'Apple Music Chart'}
            </span>
            <h1 className="mt-2 text-2xl sm:text-4xl font-black tracking-tight text-white">
              {selectedAppleChart.name}
            </h1>
            <p className="mt-2 text-sm text-text-muted leading-relaxed max-w-2xl">
              {selectedAppleChart.description ||
                'Top chart tracks updated daily from Apple Music editorial feeds.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={appleTracks.length === 0}
                onClick={handlePlayChart}
                className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-black text-black shadow-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-black ml-0.5" />
                <span>Play Chart</span>
              </button>
              <span className="text-xs font-bold text-text-muted">
                {appleTracks.length} tracks
              </span>
            </div>
          </div>
        </div>

        {/* Tracks List */}
        <div className="space-y-2">
          <h3 className="text-lg font-black text-white px-1">Tracklist</h3>

          {isLoadingAppleTracks ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl bg-surface-elevated/40 px-4 py-3 animate-pulse"
                >
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
              <p className="text-sm font-semibold text-text-muted">
                Could not load chart tracks.
              </p>
              <button
                type="button"
                onClick={() => setSelectedAppleChart({ ...selectedAppleChart })}
                className="mt-2 rounded-full bg-surface-elevated px-5 py-2 text-xs font-bold text-white hover:bg-hover border border-white/10"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {appleTracks.map((track) => {
                const isInLibrary = libraryIndex.has(track.title, track.artist)
                const isCurrent = currentSong?.title === track.title
                const trackSongItem: HomeSongItem = {
                  id: track.id,
                  title: track.title,
                  artist: track.artist,
                  album: track.album || '',
                  duration: track.duration || 0,
                  artworkUrl: track.artworkUrl
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
                    key={track.id}
                    onClick={() => void onPlaySong(trackSongItem)}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-hover"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="w-7 shrink-0 text-right text-sm font-black text-text-muted tabular-nums">
                        {track.rank}
                      </span>

                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface shadow-sm">
                        <ArtworkImage
                          src={track.artworkUrl}
                          title={track.title}
                          artist={track.artist}
                          alt={track.title}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void onPlaySong(trackSongItem)
                          }}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Play className="h-5 w-5 fill-white text-white ml-0.5" />
                        </button>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm font-bold ${
                            isCurrent ? 'text-primary-amber' : 'text-white'
                          }`}
                        >
                          {stripSourceSuffix(track.title)}
                        </p>
                        <p className="truncate text-xs text-text-muted mt-0.5">
                          {track.artist}
                          {track.album && (
                            <>
                              <span className="text-white/20"> • </span>
                              {stripSourceSuffix(track.album)}
                            </>
                          )}
                        </p>
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
  ]

  const filteredCharts =
    appleSection === 'all'
      ? CHART_CATEGORIES
      : CHART_CATEGORIES.filter((c) => c.section === appleSection)

  return (
    <section className="space-y-5 pt-2">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">Apple Music Charts</h2>
          <p className="mt-1 text-sm text-text-muted">
            Top songs, global leaderboards, and genre charts updated daily from Apple Music.
          </p>
        </div>
        <span className="self-start sm:self-auto rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white border border-white/10">
          Live Apple Feeds
        </span>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-3">
        {categories.map((tab) => {
          const isActive = appleSection === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAppleSection(tab.id)}
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

      {/* Charts Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {filteredCharts.map((chart) => (
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
            actionIcon={<Play className="h-4 w-4 fill-current ml-0.5" />}
          />
        ))}
      </div>
    </section>
  )
}
