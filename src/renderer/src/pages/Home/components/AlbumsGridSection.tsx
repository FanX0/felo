import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { HomeAlbumItem } from '../types'
import { UnifiedMediaCard } from './UnifiedMediaCard'
import { usePlaybackArbitration } from '../../../hooks/usePlaybackArbitration'
import type { Song } from '../../Library/Library'

interface AlbumsGridSectionProps {
  albums: HomeAlbumItem[]
  title: string
  subtitle?: string
}

export function AlbumsGridSection({ albums, title, subtitle }: AlbumsGridSectionProps) {
  const navigate = useNavigate()
  const { requestPlayQueue } = usePlaybackArbitration()

  if (albums.length === 0) return null

  const handlePlayAlbum = async (e: React.MouseEvent, album: HomeAlbumItem) => {
    e.stopPropagation()
    try {
      let allSongs: Song[] = []
      if (window.api?.getSongs) {
        allSongs = (await window.api.getSongs()) || []
      }
      const albumTracks = allSongs.filter(
        (s) =>
          s.album &&
          s.album.toLowerCase() === album.title.toLowerCase() &&
          (!album.artist || !s.artist || s.artist.toLowerCase().includes(album.artist.toLowerCase()) || album.artist.toLowerCase().includes(s.artist.toLowerCase()))
      )
      if (albumTracks.length > 0) {
        requestPlayQueue(albumTracks, 0, {
          type: 'album',
          title: album.title,
          subtitle: album.artist,
          route: `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
        })
        return
      }
    } catch (err) {
      console.warn('Failed to start album playback:', err)
    }

    // Fallback: navigate to album page
    navigate(`/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`)
  }

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{title}</h2>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {albums.map((album) => {
          const countLabel = album.songCount
            ? ` • ${album.songCount} ${album.songCount === 1 ? 'song' : 'songs'}`
            : album.year
              ? ` • ${album.year}`
              : ''

          return (
            <UnifiedMediaCard
              key={album.id}
              title={album.title}
              subtitle={`${album.artist}${countLabel}`}
              artworkUrl={album.artworkUrl}
              sourceTag="Album"
              onClick={() =>
                navigate(
                  `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
                )
              }
              onAction={(e) => handlePlayAlbum(e, album)}
              actionTitle={`Play ${album.title}`}
              actionIcon={<Play className="h-4 w-4 fill-black text-black ml-0.5" />}
            />
          )
        })}
      </div>
    </section>
  )
}
