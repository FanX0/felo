import { useState, useEffect, useRef } from 'react'
import { X, Mic2, RefreshCw } from 'lucide-react'
import { remoteClient, type RemotePlayerSong } from './remoteClient'

interface MobileLyricsSheetProps {
  song: RemotePlayerSong | null
  currentTime: number
  isOpen: boolean
  onClose: () => void
}

interface ParsedLyricLine {
  time: number
  text: string
}

function parseLrc(lrcText: string): ParsedLyricLine[] {
  const lines = lrcText.split('\n')
  const parsed: ParsedLyricLine[] = []
  const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\]/

  for (const line of lines) {
    const match = timeRegex.exec(line)
    if (match) {
      const minutes = parseInt(match[1], 10)
      const seconds = parseInt(match[2], 10)
      const millis = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0
      const totalTime = minutes * 60 + seconds + millis / 1000
      const text = line.replace(/\[\d{2}:\d{2}\.?\d{2,3}?\]/g, '').trim()
      if (text) {
        parsed.push({ time: totalTime, text })
      }
    }
  }

  return parsed.sort((a, b) => a.time - b.time)
}

export default function MobileLyricsSheet({
  song,
  currentTime,
  isOpen,
  onClose
}: MobileLyricsSheetProps) {
  const [syncedLines, setSyncedLines] = useState<ParsedLyricLine[]>([])
  const [plainLyrics, setPlainLyrics] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || !song?.id) return

    let mounted = true
    setIsLoading(true)
    setSyncedLines([])
    setPlainLyrics('')

    remoteClient
      .getLyrics(song.id)
      .then((data) => {
        if (!mounted) return
        if (data?.syncedLyrics) {
          const parsed = parseLrc(data.syncedLyrics)
          setSyncedLines(parsed)
        } else if (data?.plainLyrics) {
          setPlainLyrics(data.plainLyrics)
        }
      })
      .catch((err) => console.warn('Failed to load lyrics:', err))
      .finally(() => {
        if (mounted) setIsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [isOpen, song?.id])

  // Track active line
  useEffect(() => {
    if (!syncedLines.length) return

    let current = -1
    for (let i = 0; i < syncedLines.length; i++) {
      if (currentTime >= syncedLines[i].time) {
        current = i
      } else {
        break
      }
    }

    if (current !== activeIndex) {
      setActiveIndex(current)
    }
  }, [currentTime, syncedLines, activeIndex])

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [activeIndex])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#121212]/95 backdrop-blur-xl flex flex-col text-white animate-in slide-in-from-bottom duration-200 select-none pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Top Drag Handle Indicator */}
      <div className="w-10 h-1.5 rounded-full bg-white/20 mx-auto mt-2 mb-1 shrink-0" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/40">
        <div className="flex items-center gap-2.5">
          <Mic2 className="w-5 h-5 text-white" />
          <div>
            <h2 className="text-lg font-bold">Lyrics</h2>
            <p className="text-xs text-zinc-400 truncate max-w-[220px]">
              {song ? `${song.title} • ${song.artist}` : 'No track selected'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Lyrics Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-6 py-12 space-y-6 text-center scroll-smooth pb-28"
      >
        {isLoading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin text-white" />
            <span className="text-xs">Finding lyrics...</span>
          </div>
        ) : syncedLines.length > 0 ? (
          syncedLines.map((line, idx) => {
            const isActive = idx === activeIndex
            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : undefined}
                className={`transition-all duration-300 py-1 cursor-pointer ${
                  isActive
                    ? 'text-white text-2xl font-bold scale-105 drop-shadow-[0_0_12px_rgba(30,215,96,0.5)]'
                    : 'text-zinc-500 text-lg font-medium hover:text-zinc-300'
                }`}
                onClick={() => void remoteClient.seek(line.time)}
              >
                {line.text}
              </div>
            )
          })
        ) : plainLyrics ? (
          <div className="text-left max-w-md mx-auto whitespace-pre-line text-base text-zinc-300 leading-relaxed font-medium">
            {plainLyrics}
          </div>
        ) : (
          <div className="py-24 flex flex-col items-center justify-center text-zinc-500 gap-2">
            <Mic2 className="w-10 h-10 opacity-30" />
            <p className="text-sm font-semibold">Lyrics Not Available</p>
            <p className="text-xs text-zinc-600">No synced lyrics found for this track.</p>
          </div>
        )}
      </div>

      {/* Footer attribution */}
      <footer className="p-4 bg-black/60 border-t border-white/5 text-center text-[11px] text-zinc-500">
        Lyrics powered by LRCLIB
      </footer>
    </div>
  )
}
