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
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r ${
        topMix.gradient || 'from-indigo-900 via-purple-900 to-slate-900'
      } p-6 sm:p-8 shadow-2xl transition-all`}
    >
      {/* Background ambient decorative glow */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-black/30 blur-2xl" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-md px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white border border-white/10">
              <Sparkles className="h-3 w-3 text-primary-amber" />
              Featured For You
            </span>
            <span className="text-xs font-bold text-white/70">
              {topMix.tracks.length} curated tracks
            </span>
          </div>

          <h2
            onClick={() => onSelectMix(topMix)}
            className="text-2xl sm:text-4xl font-black tracking-tight text-white cursor-pointer hover:underline"
          >
            {topMix.title}
          </h2>

          <p className="text-sm text-white/80 line-clamp-2 leading-relaxed">
            {topMix.description || topMix.subtitle}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onPlayMix(topMix)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-black text-black shadow-xl transition-all duration-200 hover:scale-105 active:scale-95"
            >
              <Play className="h-4 w-4 fill-current ml-0.5" />
              <span>Play Now</span>
            </button>

            <button
              type="button"
              onClick={onStartRadio}
              className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95 ${
                isInfiniteRadioActive
                  ? 'border-primary-amber bg-primary-amber/20 text-white'
                  : 'border-white/20 bg-black/30 backdrop-blur-md text-white hover:bg-black/50'
              }`}
            >
              <Radio className={`h-3.5 w-3.5 ${isInfiniteRadioActive ? 'animate-pulse text-primary-amber' : ''}`} />
              <span>{isInfiniteRadioActive ? 'Radio Streaming' : 'Start Infinite Radio'}</span>
            </button>
          </div>
        </div>

        {/* Right preview stacked cards visual */}
        <div
          onClick={() => onSelectMix(topMix)}
          className="hidden md:flex flex-col items-center justify-center cursor-pointer group"
        >
          <div className="relative h-36 w-36 overflow-hidden rounded-2xl bg-black/40 backdrop-blur-md border border-white/20 shadow-2xl transition-transform duration-300 group-hover:scale-105 flex items-center justify-center">
            <Music2 className="h-16 w-16 text-white/80" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
              <Play className="h-8 w-8 fill-white text-white drop-shadow-lg" />
            </div>
          </div>
          <span className="mt-2 text-[11px] font-bold text-white/70 group-hover:text-white">
            View Tracklist
          </span>
        </div>
      </div>
    </div>
  )
}
