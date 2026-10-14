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
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-elevated/70 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-hover hover:scale-105"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Overview</span>
        </button>

        {/* Hero Header */}
        <div
          className={`flex flex-col sm:flex-row items-start sm:items-end gap-6 rounded-2xl border border-white/10 bg-gradient-to-br ${
            selectedMix.gradient || 'from-indigo-900 to-purple-950'
          } p-6 sm:p-8 shadow-2xl`}
        >
          <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-2xl bg-black/40 backdrop-blur-md border border-white/20 shadow-2xl">
            <Music2 className="h-16 w-16 text-white/90" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
              Made For You
            </span>
            <h1 className="mt-1 text-3xl font-black text-white sm:text-4xl tracking-tight">
              {selectedMix.title}
            </h1>
            <p className="mt-2 text-sm font-medium text-white/80 leading-relaxed max-w-2xl">
              {selectedMix.description}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onPlayMix(selectedMix, 0)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-xs font-black text-black shadow-xl hover:scale-105 active:scale-95 transition-all"
              >
                <Play className="h-4 w-4 fill-current ml-0.5" />
                <span>Play Mix</span>
              </button>
              <span className="text-xs font-bold text-white/70">
                {selectedMix.tracks.length} tracks
              </span>
            </div>
          </div>
        </div>

        {/* Tracklist */}
        <div className="space-y-1 rounded-2xl border border-white/5 bg-surface-elevated/40 p-2 sm:p-4">
          <div className="px-3 py-2 text-xs font-bold text-text-muted uppercase tracking-wider border-b border-white/5 mb-1">
            Tracklist ({selectedMix.tracks.length})
          </div>
          {selectedMix.tracks.map((track, i) => {
            const isInLibrary = libraryIndex.has(track.title, track.artist)
            return (
              <div
                key={`${track.id}-${i}`}
                onClick={() => void onPlaySong(track)}
                className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-hover transition-colors"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="w-6 text-right text-xs font-bold text-text-muted tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white group-hover:text-primary-amber transition-colors">
                      {track.title}
                    </p>
                    <p className="truncate text-xs text-text-muted mt-0.5">{track.artist}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3 pr-2">
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
                      className={`h-7 w-7 flex items-center justify-center rounded-full transition-all ${
                        isInLibrary
                          ? 'text-text-muted hover:text-white'
                          : 'text-text-muted hover:text-white hover:bg-white/10'
                      }`}
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
            className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${
              mix.gradient || 'from-indigo-600 to-purple-900'
            } p-4 shadow-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl cursor-pointer min-h-[170px]`}
          >
            <div>
              <span className="text-[9px] font-black uppercase tracking-wider text-white/70">
                {mix.category === 'repeat' ? 'Heavy Rotation' : 'Daily Mix'}
              </span>
              <h3 className="text-base sm:text-lg font-black text-white leading-tight mt-1">
                {mix.title}
              </h3>
              <p className="mt-1 text-xs text-white/80 line-clamp-2 leading-relaxed">
                {mix.subtitle}
              </p>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/10 mt-3">
              <span className="text-[10px] font-bold text-white/70">
                {mix.tracks.length} tracks
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPlayMix(mix, 0)
                }}
                title={`Play ${mix.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-110 active:scale-95 transition-all"
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
