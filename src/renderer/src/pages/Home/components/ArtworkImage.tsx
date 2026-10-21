import { ReactNode, useEffect, useRef } from 'react'
import { Music2 } from 'lucide-react'
import { useResolvedArtwork } from '../../../lib/artworkResolver'

export interface ArtworkImageProps {
  src?: string
  title: string
  artist: string
  alt?: string
  className?: string
  loading?: 'lazy' | 'eager'
  fallbackIcon?: ReactNode
}

export function ArtworkImage({
  src,
  title,
  artist,
  alt = '',
  className = '',
  loading = 'lazy',
  fallbackIcon
}: ArtworkImageProps) {
  const { artworkUrl, isLoading, hasFailed, handleError, handleLoad } = useResolvedArtwork({
    src,
    title,
    artist
  })

  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      handleLoad()
    }
  }, [artworkUrl, handleLoad])

  if (hasFailed && !isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-elevated/70">
        {fallbackIcon || <Music2 className="h-6 w-6 text-text-muted/50" />}
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 animate-pulse bg-white/10" aria-hidden="true" />
      )}
      {artworkUrl && (
        <img
          ref={imgRef}
          src={artworkUrl}
          alt={alt || title}
          className={`${className} relative transition-opacity duration-200 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
          loading={loading}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
