import { useState, useEffect, type ReactElement } from 'react'
import { User } from 'lucide-react'
import { cn } from '../../lib/utils'
import { getInitials, resolveAvatarUrl } from '../../lib/avatar'

export type AvatarSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'custom'

export interface AvatarProps {
  src?: string | null
  fallbackText?: string
  metadataFallback?: string | null
  cacheBust?: string | number
  size?: AvatarSize
  className?: string
  alt?: string
  showInitials?: boolean
  maxInitials?: number
}

const SIZE_CLASSES: Record<Exclude<AvatarSize, 'custom'>, string> = {
  '2xs': 'h-5 w-5 text-[9px]',
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
  '2xl': 'h-40 w-40 text-5xl sm:h-48 sm:w-48'
}

export default function Avatar({
  src,
  fallbackText,
  metadataFallback,
  cacheBust,
  size = 'md',
  className,
  alt = '',
  showInitials = true,
  maxInitials = 2
}: AvatarProps): ReactElement {
  const resolvedUrl = resolveAvatarUrl(src, metadataFallback, cacheBust)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const hasError = failedUrl !== null && failedUrl === resolvedUrl

  useEffect(() => {
    setFailedUrl(null)
  }, [src, metadataFallback])

  const rawInitials = showInitials && fallbackText ? getInitials(fallbackText, maxInitials) : null
  const initials = rawInitials && rawInitials !== '?' ? rawInitials : null

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-elevated font-black text-text select-none shadow-sm',
        size !== 'custom' && SIZE_CLASSES[size],
        className
      )}
    >
      {resolvedUrl && !hasError ? (
        <img
          src={resolvedUrl}
          alt={alt || fallbackText || 'Avatar'}
          className="absolute inset-0 h-full w-full object-cover select-none"
          loading="lazy"
          onError={() => setFailedUrl(resolvedUrl)}
        />
      ) : initials ? (
        <span aria-hidden="true" className="font-bold select-none leading-none">
          {initials}
        </span>
      ) : (
        <User className="w-1/2 h-1/2 text-text-muted" aria-hidden="true" />
      )}
    </div>
  )
}
