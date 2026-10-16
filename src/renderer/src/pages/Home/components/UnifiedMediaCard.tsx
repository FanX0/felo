import { Play } from 'lucide-react'
import { ArtworkImage } from './ArtworkImage'

export interface UnifiedMediaCardProps {
  title: string
  subtitle: string
  artworkUrl?: string
  badge?: string
  sourceTag?: string
  score?: number | null
  onClick?: () => void
  onAction?: (e: React.MouseEvent) => void
  actionIcon?: React.ReactNode
  actionTitle?: string
  actionLoading?: boolean
  actionText?: string
}

export function UnifiedMediaCard({
  title,
  subtitle,
  artworkUrl,
  badge,
  sourceTag,
  score,
  onClick,
  onAction,
  actionIcon,
  actionTitle,
  actionLoading,
  actionText
}: UnifiedMediaCardProps) {
  const scoreColor =
    score == null
      ? ''
      : score >= 85
        ? 'bg-white text-black font-black'
        : score >= 70
          ? 'bg-white/20 text-white font-extrabold'
          : 'bg-white/10 text-text-muted font-bold'

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.()
        }
      }}
      className="group flex flex-col cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-elevated/70 p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-surface-elevated"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface shadow-inner">
        <ArtworkImage
          src={artworkUrl}
          title={title}
          artist={subtitle}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Critic score badge */}
        {score != null && (
          <span
            className={`absolute top-2 left-2 z-20 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums shadow-md ${scoreColor}`}
            title="Critic score"
          >
            {score}
          </span>
        )}

        {/* Badge in top right */}
        {badge && (
          <span className="absolute top-2 right-2 z-20 rounded-md bg-black/75 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white border border-white/10 shadow">
            {badge}
          </span>
        )}

        {/* Source tag in bottom left */}
        {sourceTag && (
          <span className="absolute bottom-2 left-2 z-20 rounded bg-black/60 backdrop-blur-md px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-muted border border-white/10">
            {sourceTag}
          </span>
        )}

        {/* Floating Action Button */}
        {onAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAction(e)
            }}
            title={actionTitle}
            disabled={actionLoading}
            className={`absolute right-2 bottom-2 z-20 flex items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-primary-foreground shadow-md transition-all duration-200 hover:scale-105 active:scale-95 ${
              actionText
                ? 'px-3 py-1 text-[11px] font-bold'
                : 'h-9 w-9 opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
            }`}
          >
            {actionLoading ? (
              <span className="text-xs font-bold animate-pulse">...</span>
            ) : actionIcon ? (
              actionIcon
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
            {actionText && <span className="ml-1">{actionText}</span>}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-sm font-semibold text-text transition-colors group-hover:text-primary"
            title={title}
          >
            {title}
          </h3>
          <p className="truncate text-xs text-text-muted mt-0.5" title={subtitle}>
            {subtitle}
          </p>
        </div>
      </div>
    </article>
  )
}
