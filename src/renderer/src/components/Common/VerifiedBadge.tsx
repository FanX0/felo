import { type ReactElement } from 'react'

export interface VerifiedBadgeProps {
  className?: string
  /**
   * 'spotify': Spotify's official scalloped/rosette verified artist badge (default)
   * 'circle': Clean circular verified badge with no outer white border
   */
  variant?: 'spotify' | 'circle'
}

/**
 * Standard Verified Badge for verified artists and profiles.
 * Eliminates accidental stroke rings from icon libraries and follows
 * official streaming platform UI/UX design conventions.
 */
export default function VerifiedBadge({
  className = 'h-4 w-4 sm:h-5 sm:w-5',
  variant = 'spotify'
}: VerifiedBadgeProps): ReactElement {
  if (variant === 'circle') {
    return (
      <svg
        className={`shrink-0 ${className}`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" fill="#3d91f4" />
        <path
          d="m8.5 12 2.5 2.5 5-5"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  // Official Spotify Verified Artist rosette/scalloped badge
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10.814.5a1.658 1.658 0 0 1 2.372 0l2.512 2.572 3.595-.043a1.658 1.658 0 0 1 1.678 1.678l-.042 3.595 2.572 2.512c.667.65.667 1.722 0 2.372l-2.572 2.512.042 3.595a1.658 1.658 0 0 1-1.678 1.678l-3.595-.042-2.512 2.572a1.658 1.658 0 0 1-2.372 0l-2.512-2.572-3.595.042a1.658 1.658 0 0 1-1.678-1.678l.042-3.595-2.572-2.512a1.658 1.658 0 0 1 0-2.372l2.572-2.512-.042-3.595a1.658 1.658 0 0 1 1.678-1.678l3.595.043L10.814.5z"
        fill="#3d91f4"
      />
      <path
        d="M15.607 8.146a.75.75 0 0 0-1.06 0L9.75 13.06l-1.543-1.543a.75.75 0 0 0-1.06 1.06l2.073 2.074a.75.75 0 0 0 1.06 0l5.327-5.327a.75.75 0 0 0 0-1.06z"
        fill="#ffffff"
      />
    </svg>
  )
}
