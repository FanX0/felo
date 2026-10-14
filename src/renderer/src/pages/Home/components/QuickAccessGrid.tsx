import { Play, Music2 } from 'lucide-react'
import type { PersonalizedMix } from '../../../services/PersonalizationService'
import type { HomeAlbumItem } from '../types'
import { ArtworkImage } from './ArtworkImage'

interface QuickAccessGridProps {
  mixes: PersonalizedMix[]
  albums: HomeAlbumItem[]
  onSelectMix: (mix: PersonalizedMix) => void
  onPlayMix: (mix: PersonalizedMix) => void
  onSelectAlbum: (album: HomeAlbumItem) => void
  onStartRadio: () => void
}

export function QuickAccessGrid({
  mixes,
  albums,
  onSelectMix,
  onPlayMix,
  onSelectAlbum
}: QuickAccessGridProps) {
  // Build 6 quick-access items
  const items: Array<{
    id: string
    title: string
    subtitle: string
    type: 'mix' | 'album'
    gradient?: string
    artworkUrl?: string
    onClick: () => void
    onPlay: (e: React.MouseEvent) => void
  }> = []

  // Add mixes first
  mixes.slice(0, 4).forEach((mix) => {
    items.push({
      id: mix.id,
      title: mix.title,
      subtitle: mix.subtitle || 'Personalized Mix',
      type: 'mix',
      gradient: mix.gradient,
      onClick: () => onSelectMix(mix),
      onPlay: (e) => {
        e.stopPropagation()
        onPlayMix(mix)
      }
    })
  })

  // Add albums to fill up to 6
  albums.slice(0, 6 - items.length).forEach((album) => {
    items.push({
      id: album.id,
      title: album.title,
      subtitle: album.artist,
      type: 'album',
      artworkUrl: album.artworkUrl,
      onClick: () => onSelectAlbum(album),
      onPlay: (e) => {
        e.stopPropagation()
        onSelectAlbum(album)
      }
    })
  })

  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={item.onClick}
          className="group relative flex items-center justify-between overflow-hidden rounded-lg bg-surface-elevated/60 pr-3 transition-all duration-300 hover:bg-surface-elevated hover:shadow-lg cursor-pointer border border-white/5 hover:border-white/15"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Visual thumbnail */}
            <div className="relative h-14 w-14 shrink-0 overflow-hidden bg-surface">
              {item.type === 'mix' ? (
                <div
                  className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${
                    item.gradient || 'from-violet-600 to-indigo-900'
                  }`}
                >
                  <Music2 className="h-6 w-6 text-white/90" />
                </div>
              ) : (
                <ArtworkImage
                  src={item.artworkUrl}
                  title={item.title}
                  artist={item.subtitle}
                  alt={item.title}
                  className="h-full w-full object-cover"
                />
              )}
            </div>

            {/* Title & subtitle */}
            <div className="min-w-0 flex-1 py-1">
              <h4 className="truncate text-xs sm:text-sm font-bold text-white transition-colors">
                {item.title}
              </h4>
              <p className="truncate text-[11px] text-text-muted mt-0.5">
                {item.subtitle}
              </p>
            </div>
          </div>

          {/* Instant Play Button */}
          <button
            type="button"
            onClick={item.onPlay}
            title={`Play ${item.title}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-xl opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 hover:scale-105 active:scale-95 transition-all duration-200 ml-2"
          >
            <Play className="h-4 w-4 fill-current ml-0.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
