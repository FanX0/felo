import { useEffect } from 'react'
import { X, User, Disc3, Info, Sparkles, Music2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toMediaUrl } from '../../lib/media'
import { parseArtists, type SongArtist } from '../../lib/artistParser'

export interface SongCreditsData {
  id?: string
  title: string
  artist: string
  artists?: SongArtist[]
  album?: string
  duration?: number
  filePath?: string
  artworkPath?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  channels?: number
  codec?: string
  container?: string
  genre?: string
  year?: number
}

interface SongCreditsModalProps {
  song: SongCreditsData | null
  isOpen: boolean
  onClose: () => void
}

export default function SongCreditsModal({ song, isOpen, onClose }: SongCreditsModalProps) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !song) return null

  const resolvedArtists: SongArtist[] =
    song.artists && song.artists.length > 0
      ? song.artists
      : parseArtists(song.artist)

  const artworkUrl = toMediaUrl(song.artworkPath)

  const isLossless =
    (song.codec && ['flac', 'alac', 'wav', 'aiff', 'dsd'].includes(song.codec.toLowerCase())) ||
    (song.container && ['flac', 'wav', 'aiff'].includes(song.container.toLowerCase())) ||
    (song.bitDepth && song.bitDepth >= 16)

  const isHiRes = (song.sampleRate && song.sampleRate >= 88200) || (song.bitDepth && song.bitDepth > 16)

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#141414] shadow-2xl text-white overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary-amber" />
            <h2 className="text-base font-bold tracking-tight">Song Credits</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Track Summary Banner */}
          <div className="flex items-center gap-4 rounded-xl bg-white/[0.03] border border-white/5 p-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#222] shadow">
              {artworkUrl ? (
                <img
                  src={artworkUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <Music2 className="h-6 w-6 text-white/40" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-white">{song.title}</h3>
              <p className="truncate text-xs text-white/60 mt-0.5">
                {song.album || 'Unknown Album'}
              </p>
            </div>
            {isLossless && (
              <span className="shrink-0 rounded bg-primary-amber/15 px-2 py-0.5 text-[11px] font-bold text-primary-amber border border-primary-amber/30">
                {isHiRes ? 'Hi-Res Lossless' : 'Lossless'}
              </span>
            )}
          </div>

          {/* Section: Performed by (Multi-artist breakdown) */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User className="h-4 w-4 text-white/50" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
                Performed by
              </h4>
            </div>
            <div className="space-y-2">
              {resolvedArtists.map((artist, idx) => {
                const isLead = idx === 0 && artist.role !== 'featured'
                return (
                  <div
                    key={`${artist.name}-${idx}`}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.06] transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <button
                        type="button"
                        onClick={() => {
                          onClose()
                          navigate(`/artist/${encodeURIComponent(artist.name)}`)
                        }}
                        className="truncate text-left text-sm font-semibold text-white hover:text-primary-amber hover:underline transition-colors block"
                      >
                        {artist.name}
                      </button>
                      <span className="text-[11px] text-white/50 mt-0.5 block">
                        {isLead ? 'Main Artist / Lead Performer' : 'Featured Artist / Collaborator'}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                        isLead
                          ? 'bg-white/10 text-white'
                          : 'bg-primary-amber/10 text-primary-amber border border-primary-amber/20'
                      }`}
                    >
                      {isLead ? 'Lead' : 'Featured'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Section: Album & Release */}
          {song.album && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Disc3 className="h-4 w-4 text-white/50" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
                  Release
                </h4>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
                <div className="text-sm font-semibold text-white">{song.album}</div>
                <div className="text-xs text-white/50 mt-0.5 flex items-center gap-2">
                  <span>{resolvedArtists[0]?.name || song.artist}</span>
                  {song.year && (
                    <>
                      <span>•</span>
                      <span>{song.year}</span>
                    </>
                  )}
                  {song.genre && (
                    <>
                      <span>•</span>
                      <span>{song.genre}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section: Audio Quality & Specifications */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-white/50" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-white/50">
                Audio Specifications
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <span className="text-white/40 block mb-1">Format & Codec</span>
                <span className="font-semibold text-white uppercase font-mono">
                  {song.codec || song.container || 'Standard Audio'}
                </span>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <span className="text-white/40 block mb-1">Bitrate</span>
                <span className="font-semibold text-white">
                  {song.bitrate ? `${Math.round(song.bitrate / 1000)} kbps` : 'Variable / N/A'}
                </span>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <span className="text-white/40 block mb-1">Sample Rate</span>
                <span className="font-semibold text-white">
                  {song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : 'Standard (44.1 kHz)'}
                </span>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <span className="text-white/40 block mb-1">Bit Depth & Channels</span>
                <span className="font-semibold text-white">
                  {song.bitDepth ? `${song.bitDepth}-bit` : '16-bit'}
                  {song.channels ? ` • ${song.channels === 2 ? 'Stereo' : song.channels === 1 ? 'Mono' : `${song.channels}ch`}` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Section: Local File Source */}
          {song.filePath && (
            <div className="rounded-lg border border-white/5 bg-white/[0.015] p-3 text-[11px] text-white/40 font-mono break-all">
              <span className="text-white/30 block mb-0.5 uppercase tracking-wider text-[9px] font-sans font-bold">
                Local Source File
              </span>
              {song.filePath}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-6 py-3.5 bg-white/[0.02] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-5 py-1.5 text-xs font-bold text-black hover:bg-white/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
