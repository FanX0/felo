import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseArtists, type SongArtist } from '../../lib/artistParser'

export interface ArtistLinksProps {
  artist?: string
  artists?: Array<SongArtist | string>
  className?: string
  linkClassName?: string
  separatorClassName?: string
  onClickArtist?: (artistName: string, artistId?: string) => void
  navigateOnClick?: boolean
  wrap?: boolean
}

export default function ArtistLinks({
  artist,
  artists,
  className = '',
  linkClassName = '',
  separatorClassName = '',
  onClickArtist,
  navigateOnClick = true,
  wrap = false
}: ArtistLinksProps) {
  const navigate = useNavigate()

  const normalizedArtists = useMemo<SongArtist[]>(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists.map((a) => (typeof a === 'string' ? { name: a.trim() } : a)).filter((a) => Boolean(a.name))
    }
    if (artist && artist.trim()) {
      const parsed = parseArtists(artist)
      return parsed.map((p) => ({ name: p.name, role: p.role }))
    }
    return [{ name: 'Unknown Artist' }]
  }, [artist, artists])

  const handleClick = (e: React.MouseEvent, artistItem: SongArtist) => {
    e.stopPropagation()
    if (!artistItem.name || artistItem.name === 'Unknown Artist') return

    if (onClickArtist) {
      onClickArtist(artistItem.name, artistItem.id)
    } else if (navigateOnClick) {
      navigate(`/artist/${encodeURIComponent(artistItem.name)}`)
    }
  }

  return (
    <span
      className={`inline-flex items-center max-w-full ${
        wrap ? 'flex-wrap' : 'flex-nowrap truncate'
      } ${className}`}
    >
      {normalizedArtists.map((item, idx) => {
        const isLast = idx === normalizedArtists.length - 1
        const isClickable = item.name !== 'Unknown Artist'

        return (
          <span key={`${item.name}-${idx}`} className="inline-flex items-center max-w-full truncate">
            <span
              role={isClickable ? 'link' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onClick={(e) => handleClick(e, item)}
              onKeyDown={(e) => {
                if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  handleClick(e as any, item)
                }
              }}
              title={isClickable ? `Go to artist: ${item.name}` : undefined}
              className={`truncate transition-colors ${
                isClickable
                  ? 'cursor-pointer hover:underline hover:text-text select-none ' + (linkClassName || 'text-text-muted')
                  : 'text-text-muted cursor-default'
              }`}
            >
              {item.name}
            </span>
            {!isLast && (
              <span className={`select-none mx-0.5 text-text-muted/60 shrink-0 ${separatorClassName}`}>
                ,
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
