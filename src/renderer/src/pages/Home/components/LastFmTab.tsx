import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCw, ArrowRight, Play, Radio } from 'lucide-react'
import type { HomeSongItem } from '../types'
import { UnifiedMediaCard } from './UnifiedMediaCard'

interface LastFmTabProps {
  onPlaySong: (song: HomeSongItem) => void
}

export function LastFmTab({ onPlaySong }: LastFmTabProps) {
  const navigate = useNavigate()
  const [lastFmCategory, setLastFmCategory] = useState<string>('tracks')
  const [lastFmItems, setLastFmItems] = useState<any[]>([])
  const [isLoadingLastFm, setIsLoadingLastFm] = useState(false)

  const loadCharts = (category: string) => {
    setIsLoadingLastFm(true)
    const isTag = !['tracks', 'artists'].includes(category)
    window.api
      ?.fetchLastFmCharts?.(isTag ? 'tag' : category, isTag ? category : undefined)
      .then((items: any[]) => {
        setLastFmItems(Array.isArray(items) ? items : [])
      })
      .catch((err: any) => {
        console.warn('Last.fm charts load error:', err)
        setLastFmItems([])
      })
      .finally(() => {
        setIsLoadingLastFm(false)
      })
  }

  useEffect(() => {
    loadCharts(lastFmCategory)
  }, [lastFmCategory])

  const categories = [
    { id: 'tracks', label: 'Top Tracks' },
    { id: 'artists', label: 'Top Artists' },
    { id: 'indie', label: 'Indie & Alt' },
    { id: 'rock', label: 'Rock' },
    { id: 'electronic', label: 'Electronic' },
    { id: 'hip-hop', label: 'Hip-Hop' },
    { id: 'pop', label: 'Pop' },
    { id: 'shoegaze', label: 'Shoegaze' },
    { id: 'metal', label: 'Metal' }
  ]

  return (
    <section className="space-y-5 pt-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-white">
              Last.fm Scrobbles & Charts
            </h2>
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary-cyan/15 px-2 py-0.5 text-[10px] font-black text-secondary-cyan border border-secondary-cyan/30">
              <Radio className="h-3 w-3" /> Community Trends
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Global listener scrobbles, top played tracks, and community tag charts from{' '}
            <span className="font-bold text-white">Last.fm</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadCharts(lastFmCategory)}
          title="Refresh Last.fm charts"
          disabled={isLoadingLastFm}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white disabled:opacity-50"
        >
          <RotateCw className={`h-4 w-4 ${isLoadingLastFm ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setLastFmCategory(cat.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
              lastFmCategory === cat.id
                ? 'bg-white text-black shadow-md'
                : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
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
            <div
              key={i}
              className="flex flex-col rounded-xl bg-surface-elevated/40 p-3 animate-pulse border border-white/5"
            >
              <div className="aspect-square w-full rounded-lg bg-white/10" />
              <div className="mt-3 h-3 w-3/4 rounded bg-white/10" />
              <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : lastFmItems.length === 0 ? (
        <div className="py-16 text-center text-sm text-text-muted">
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
                    void onPlaySong(trackSongItem)
                  }
                }}
                onAction={() => {
                  if (isArtist) {
                    navigate(`/artist/${encodeURIComponent(item.title)}`)
                  } else {
                    void onPlaySong(trackSongItem)
                  }
                }}
                actionTitle={isArtist ? `Open ${item.title}` : `Play ${item.title}`}
                actionIcon={
                  isArtist ? (
                    <ArrowRight className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 fill-current ml-0.5" />
                  )
                }
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
