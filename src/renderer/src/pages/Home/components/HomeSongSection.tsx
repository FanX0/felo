import { Play, Heart, Download, CheckCircle2, Loader2, Radio } from 'lucide-react'
import type { HomeSongItem } from '../types'
import { ArtworkImage } from './ArtworkImage'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import { useDownloadStore } from '../../../hooks/useDownloadStore'
import { AppCapabilities } from '../../../lib/appConfig'

interface HomeSongSectionProps {
  songs: HomeSongItem[]
  title: string
  subtitle?: string
  likedSongIds: Set<string>
  onToggleLike: (songId: string) => void
  onPlaySong: (song: HomeSongItem) => void
  onDownloadSong: (song: HomeSongItem) => void
  onChooseSourceOrReplace: (song: HomeSongItem) => void
  libraryIndex: { has: (title: string, artist: string) => boolean }
  onStartRadio?: () => void
  isRadioActive?: boolean
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function PlayingEqualizer() {
  return (
    <div className="flex items-end justify-center gap-0.5 h-3.5 w-3.5" aria-label="Playing">
      <span className="w-0.5 bg-white rounded-full animate-bounce [animation-duration:0.6s]" style={{ height: '60%' }} />
      <span className="w-0.5 bg-white rounded-full animate-bounce [animation-duration:0.8s] [animation-delay:0.2s]" style={{ height: '100%' }} />
      <span className="w-0.5 bg-white rounded-full animate-bounce [animation-duration:0.7s] [animation-delay:0.4s]" style={{ height: '75%' }} />
    </div>
  )
}

export function HomeSongSection({
  songs,
  title,
  subtitle,
  likedSongIds,
  onToggleLike,
  onPlaySong,
  onDownloadSong,
  onChooseSourceOrReplace,
  libraryIndex,
  onStartRadio,
  isRadioActive
}: HomeSongSectionProps) {
  const { queue, currentSongIndex, isPlaying } = usePlayerStore()
  const { transfers } = useDownloadStore()
  const currentTrack = queue[currentSongIndex]

  if (songs.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">{title}</h2>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>

        {onStartRadio && (
          <button
            type="button"
            onClick={onStartRadio}
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-4 text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95 ${
              isRadioActive
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                : 'border-white/10 bg-surface-elevated text-text-muted hover:text-white hover:bg-hover'
            }`}
          >
            <Radio className={`h-3.5 w-3.5 ${isRadioActive ? 'animate-pulse text-emerald-400' : ''}`} />
            <span>{isRadioActive ? 'Radio Streaming' : 'Start Infinite Radio'}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
        {songs.map((song) => {
          const isThisTrack =
            currentTrack?.title.toLowerCase() === song.title.toLowerCase() &&
            (!song.artist || !currentTrack?.artist || currentTrack.artist.toLowerCase() === song.artist.toLowerCase())
          const isCurrentlyPlaying = isThisTrack && isPlaying
          const isLiked = likedSongIds.has(song.id)
          const isInLibrary = libraryIndex.has(song.title, song.artist)

          const transfer = transfers.find(
            (t) =>
              t.title.toLowerCase() === song.title.toLowerCase() &&
              (!song.artist || !t.artist || t.artist.toLowerCase() === song.artist.toLowerCase()) &&
              (t.status === 'downloading' || t.status === 'queued')
          )
          const isDownloading = Boolean(transfer)

          return (
            <div
              key={song.id}
              className={`group flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 transition-all duration-200 ${
                isThisTrack
                  ? 'bg-surface-elevated/90 border border-white/30 shadow-md'
                  : 'hover:bg-hover border border-transparent'
              }`}
            >
              {/* Thumbnail & Info */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-surface shadow-sm">
                  <ArtworkImage
                    src={song.artworkUrl}
                    title={song.title}
                    artist={song.artist}
                    alt={song.title}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => onPlaySong(song)}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Play className="h-4 w-4 fill-white text-white ml-0.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {isCurrentlyPlaying && <PlayingEqualizer />}
                    <p
                      onClick={() => onPlaySong(song)}
                      className={`truncate text-sm font-bold cursor-pointer transition-colors ${
                        isThisTrack ? 'text-white font-black' : 'text-white hover:underline'
                      }`}
                      title={song.title}
                    >
                      {song.title}
                    </p>
                    {song.isExplicit && (
                      <span className="rounded bg-white/20 px-1 py-0.2 text-[9px] font-black uppercase text-text-muted">
                        E
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-text-muted mt-0.5" title={song.artist}>
                    {song.artist}
                  </p>
                </div>
              </div>

              {/* Actions & Meta */}
              <div className="flex items-center gap-3">
                {song.quality && (
                  <span className="hidden sm:inline-block rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-black text-text-muted uppercase tracking-wider">
                    {song.quality}
                  </span>
                )}

                {/* Like Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleLike(song.id)
                  }}
                  className={`text-xs transition-colors ${
                    isLiked
                      ? 'text-rose-500'
                      : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white'
                  }`}
                  title={isLiked ? 'Unlike track' : 'Like track'}
                >
                  <Heart className={`h-4 w-4 ${isLiked ? 'fill-current' : ''}`} />
                </button>

                {/* Download / In Library Button */}
                {AppCapabilities.downloads && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isInLibrary) {
                        onChooseSourceOrReplace(song)
                      } else {
                        onDownloadSong(song)
                      }
                    }}
                    title={
                      isDownloading
                        ? `Downloading (${transfer?.progress || 0}%)...`
                        : isInLibrary
                          ? 'In your library (Click to choose source or replace)'
                          : 'Download track to library'
                    }
                    className={`h-7 w-7 flex items-center justify-center rounded-full transition-all ${
                      isDownloading
                        ? 'text-white'
                        : isInLibrary
                          ? 'text-text-muted hover:text-white hover:bg-white/10'
                          : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {isDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isInLibrary ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </button>
                )}

                <span className="w-9 text-right text-xs text-text-muted tabular-nums">
                  {formatDuration(song.duration)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
