import { RotateCw, Sparkles, Clock } from 'lucide-react'
import type { UserTasteMetrics } from '../../../services/PersonalizationService'

interface HomeGreetingProps {
  tasteMetrics?: UserTasteMetrics | null
  isRefreshing: boolean
  onRefresh: () => void
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function HomeGreeting({ tasteMetrics, isRefreshing, onRefresh }: HomeGreetingProps) {
  const greeting = getGreeting()

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {greeting}
          </h1>
          {tasteMetrics?.listenerTier && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-surface-elevated border border-border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text">
              <Sparkles className="h-3 w-3 text-text-muted" />
              {tasteMetrics.listenerTier.title}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-muted flex items-center gap-2">
          <span>Your daily music recommendations and customized mixes</span>
          {tasteMetrics?.chronotype && (
            <>
              <span className="text-white/20">•</span>
              <span className="inline-flex items-center gap-1 text-white/70">
                <Clock className="h-3 w-3 text-text-muted" />
                {tasteMetrics.chronotype.label}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 self-start sm:self-auto">
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh recommendations"
          disabled={isRefreshing}
          className="flex h-8 items-center gap-2 rounded-full border border-border bg-surface-elevated px-3.5 text-xs font-semibold text-text-muted transition-all hover:bg-hover hover:text-white disabled:opacity-50"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  )
}
