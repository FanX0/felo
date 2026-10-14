import { useNavigate } from 'react-router-dom'
import { Download } from 'lucide-react'
import type { HomeAlbumItem } from '../types'
import { UnifiedMediaCard } from './UnifiedMediaCard'

interface AlbumsGridSectionProps {
  albums: HomeAlbumItem[]
  title: string
  subtitle?: string
}

export function AlbumsGridSection({ albums, title, subtitle }: AlbumsGridSectionProps) {
  const navigate = useNavigate()

  if (albums.length === 0) return null

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{title}</h2>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {albums.map((album) => (
          <UnifiedMediaCard
            key={album.id}
            title={album.title}
            subtitle={`${album.artist}${album.year ? ` • ${album.year}` : ''}`}
            artworkUrl={album.artworkUrl}
            sourceTag="Album"
            onClick={() =>
              navigate(
                `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
              )
            }
            onAction={() => {
              navigate(
                `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
              )
            }}
            actionTitle="View & download album tracks"
            actionIcon={<Download className="h-4 w-4" />}
          />
        ))}
      </div>
    </section>
  )
}
