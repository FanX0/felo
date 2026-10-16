import { ArrowLeft, Play, Download, CheckCircle2, Music2, RotateCw } from 'lucide-react'
import type { PersonalizedMix } from '../../../services/PersonalizationService'
import type { HomeSongItem } from '../types'
import { AppCapabilities } from '../../../lib/appConfig'

interface PersonalizedMixesSectionProps {
  mixes: PersonalizedMix[]
  selectedMix: PersonalizedMix | null
  onSelectMix: (mix: PersonalizedMix | null) => void
  onPlayMix: (mix: PersonalizedMix, startIndex?: number) => void
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
  isLoadingMixes: boolean
  onRefreshMixes: () => void
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function PersonalizedMixesSection({
  mixes,
  selectedMix,
  onSelectMix,
  onPlayMix,
  onPlaySong,
  onDownloadSong,
  libraryIndex,
  isLoadingMixes,
  onRefreshMixes
}: PersonalizedMixesSectionProps) {
  // Drill-down view
  if (selectedMix) {
    return (
      <section className="space-y-6">
        <button
          type="button"
          onClick={() => onSelectMix(null)}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-semibold text-text transition-all hover:bg-hover hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </button>

        {/* Hero Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-border bg-surface-elevated p-6 sm:p-8 shadow-sm">
          <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-2xl bg-surface border border-border shadow-sm">
            <Music2 className="h-16 w-16 text-text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Made For You
            </span>
            <h1 className="mt-1 text-3xl font-black text-text sm:text-4xl tracking-tight">
              {selectedMix.title}
            </h1>
            <p className="mt-2 text-sm text-text-muted leading-relaxed max-w-2xl">
              {selectedMix.description}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onPlayMix(selectedMix, 0)}
                className="inline-flex items-center gap-2 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground px-6 py-2.5 text-xs font-bold shadow-sm hover:scale-105 active:scale-95 transition-all"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" />
                <span>Play Mix</span>
              </button>
              <span className="text-xs font-semibold text-text-muted">
                {selectedMix.tracks.length} tracks
              </span>
            </div>
          </div>
        </div>

        {/* Tracklist - Parity with local song list */}
        <div className="flex flex-col rounded-xl border border-border bg-surface overflow-hidden">
          <div className="grid grid-cols-[36px_minmax(0,1fr)_80px] sm:grid-cols-[40px_minmax(0,2fr)_minmax(0,1.2fr)_140px] items-center gap-3 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted bg-surface-elevated/40">
            <div className="text-center font-medium">#</div>
            <div>Title</div>
            <div className="hidden sm:block">Artist</div>
            <div className="text-right pr-2">Duration</div>
          </div>
          <div className="divide-y divide-border/40">
            {selectedMix.tracks.map((track, i) => {
              const isInLibrary = libraryIndex.has(track.title, track.artist)
              return (
                <div
                  key={`${track.id}-${i}`}
                  onClick={() => void onPlaySong(track)}
                  className="group grid grid-cols-[36px_minmax(0,1fr)_80px] sm:grid-cols-[40px_minmax(0,2fr)_minmax(0,1.2fr)_140px] items-center gap-3 px-3 py-2 text-[13px] hover:bg-hover/50 cursor-pointer transition-colors"
                >
                  <div className="text-center text-xs font-medium text-text-muted tabular-nums">
                    {i + 1}
                  </div>
                  <div className="min-w-0 overflow-hidden">
                    <p className="truncate text-sm font-semibold text-text transition-colors">
                      {track.title}
                    </p>
                    <p className="truncate text-xs text-text-muted mt-0.5 sm:hidden">{track.artist}</p>
                  </div>
                  <div className="hidden sm:block min-w-0 truncate text-xs text-text-muted">
                    {track.artist}
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pr-1">
                    {track.duration > 0 && (
                      <span className="text-xs text-text-muted tabular-nums">
                        {formatDuration(track.duration)}
                      </span>
                    )}
                    {AppCapabilities.downloads && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDownloadSong(track)
                        }}
                        title={isInLibrary ? 'In library' : 'Download track'}
                        className="h-7 w-7 flex items-center justify-center rounded-full text-text-muted hover:text-white hover:bg-hover transition-all"
                      >
                        {isInLibrary ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

  if (mixes.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
            Made For You
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Personalized playlists based on your listening taste
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshMixes}
          title="Refresh personalized mixes"
          disabled={isLoadingMixes}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white disabled:opacity-50"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isLoadingMixes ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {mixes.map((mix) => (
          <div
            key={mix.id}
            onClick={() => onSelectMix(mix)}
            className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface-elevated p-4 shadow-sm transition-all duration-200 hover:border-white/20 hover:bg-[#232326] cursor-pointer min-h-[170px]"
          >
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {mix.category === 'repeat' ? 'Heavy Rotation' : 'Daily Mix'}
              </span>
              <h3 className="text-base sm:text-lg font-bold text-text leading-tight mt-1">
                {mix.title}
              </h3>
              <p className="mt-1 text-xs text-text-muted line-clamp-2 leading-relaxed">
                {mix.subtitle}
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border mt-3">
              <span className="text-[11px] font-medium text-text-muted">
                {mix.tracks.length} tracks
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlayMix(mix, 0)
                }}
                title={`Play ${mix.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-primary-foreground shadow-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105 active:scale-95 transition-all"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
