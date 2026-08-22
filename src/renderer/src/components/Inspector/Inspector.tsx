import { X, Info, FileAudio, Tag } from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'

interface InspectorProps {
  isOpen: boolean
  onClose: () => void
}

export default function Inspector({ isOpen, onClose }: InspectorProps) {
  const { queue, currentSongIndex } = usePlayerStore()
  const currentSong = queue[currentSongIndex]
  const artworkUrl = toMediaUrl(currentSong?.artworkPath)

  if (!isOpen) return null

  return (
    <div className="w-80 h-full bg-surface border-l border-border flex flex-col shrink-0 z-10 transition-all">
      <div className="h-14 flex items-center justify-between px-4 border-b border-border">
        <h2 className="text-sm font-bold text-text">Inspector</h2>
        <button
          onClick={onClose}
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-hover text-text-muted hover:text-text transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {currentSong ? (
          <>
            {/* Artwork */}
            <div className="relative w-full aspect-square rounded-md bg-surface-elevated shadow-md flex items-center justify-center overflow-hidden border border-border">
              <FileAudio className="w-16 h-16 text-text-muted" />
              {artworkUrl && (
                <img
                  src={artworkUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.hidden = true
                  }}
                />
              )}
            </div>

            {/* Title / Artist */}
            <div className="flex flex-col gap-1 text-center">
              <h3 className="text-lg font-bold text-text leading-tight">{currentSong.title}</h3>
              <p className="text-primary-amber font-medium text-sm">{currentSong.artist}</p>
              <p className="text-text-muted text-xs mt-1">{currentSong.album}</p>
            </div>

            {/* Properties */}
            <div className="flex flex-col gap-3 mt-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-text uppercase tracking-wider mb-1">
                <Info className="w-4 h-4 text-secondary-cyan" />
                Audio Details
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Codec</span>
                <span className="text-text font-mono bg-surface-elevated px-2 py-0.5 rounded">
                  {currentSong.codec || 'FLAC'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Bitrate</span>
                <span className="text-text">
                  {currentSong.bitrate
                    ? Math.round(currentSong.bitrate / 1000) + ' kbps'
                    : 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Sample Rate</span>
                <span className="text-text">
                  {currentSong.sampleRate
                    ? (currentSong.sampleRate / 1000).toFixed(1) + ' kHz'
                    : '44.1 kHz'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Bit Depth</span>
                <span className="text-text">{currentSong.bitDepth || 16}-bit</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-text uppercase tracking-wider mb-1">
                <Tag className="w-4 h-4 text-secondary-cyan" />
                Tags
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Genre</span>
                <span className="text-text">{currentSong.genre || 'Unknown'}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-text-muted">Year</span>
                <span className="text-text">2023</span>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-text-muted gap-2">
            <Info className="w-8 h-8 opacity-50" />
            <p className="text-sm">Select a track to inspect metadata</p>
          </div>
        )}
      </div>
    </div>
  )
}
