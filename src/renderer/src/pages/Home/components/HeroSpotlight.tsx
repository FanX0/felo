import { Play, Radio, Sparkles, Music2 } from 'lucide-react'
import type { PersonalizedMix } from '../../../services/PersonalizationService'

interface HeroSpotlightProps {
  topMix?: PersonalizedMix | null
  onPlayMix: (mix: PersonalizedMix) => void
  onSelectMix: (mix: PersonalizedMix) => void
  onStartRadio: () => void
  isInfiniteRadioActive?: boolean
}

export function HeroSpotlight({
  topMix,
  onPlayMix,
  onSelectMix,
  onStartRadio,
  isInfiniteRadioActive
}: HeroSpotlightProps) {
  if (!topMix) return null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-elevated p-6 sm:p-8 shadow-sm transition-all">
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              <Sparkles className="h-3 w-3 text-text-muted" />
              Featured For You
            </span>
            <span className="text-xs font-semibold text-text-muted">
              {topMix.tracks.length} curated tracks
            </span>
          </div>

          <h2
            onClick={() => onSelectMix(topMix)}
            className="text-2xl sm:text-4xl font-black tracking-tight text-text cursor-pointer hover:underline"
          >
            {topMix.title}
          </h2>

          <p className="text-sm text-text-muted line-clamp-2 leading-relaxed">
            {topMix.description || topMix.subtitle}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onPlayMix(topMix)}
              className="inline-flex items-center gap-2 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground px-6 py-2.5 text-xs font-bold shadow-sm transition-all duration-200 hover:scale-105 active:scale-95"
            >
              <Play className="h-4 w-4 fill-current ml-0.5" />
              <span>Play Now</span>
            </button>

            <button
              type="button"
              onClick={onStartRadio}
              className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-xs font-semibold transition-all duration-200 hover:scale-105 active:scale-95 ${
                isInfiniteRadioActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-surface text-text hover:bg-hover'
              }`}
            >
              <Radio className={`h-3.5 w-3.5 ${isInfiniteRadioActive ? 'animate-pulse text-primary-foreground' : 'text-text-muted'}`} />
              <span>{isInfiniteRadioActive ? 'Radio Streaming' : 'Start Infinite Radio'}</span>
            </button>
          </div>
        </div>

        {/* Right preview stacked cards visual */}
        <div
          onClick={() => onSelectMix(topMix)}
          className="hidden md:flex flex-col items-center justify-center cursor-pointer group"
        >
          <div className="relative h-32 w-32 overflow-hidden rounded-xl bg-surface border border-border shadow-sm transition-transform duration-200 group-hover:scale-105 flex items-center justify-center">
            <Music2 className="h-12 w-12 text-text-muted" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Play className="h-6 w-6 fill-white text-white drop-shadow" />
            </div>
          </div>
          <span className="mt-2 text-[11px] font-semibold text-text-muted group-hover:text-text">
            View Tracklist
          </span>
        </div>
      </div>
    </div>
  )
}
