import { useState, useEffect, useRef } from 'react'
import { X, Mic2, RefreshCw, Maximize2 } from 'lucide-react'
import { remoteClient } from './remoteClient'

export interface MobileLyricsSong {
  id: string
  title: string
  artist: string
  album?: string
  duration?: number
  artworkUrl?: string
}

interface MobileLyricsSheetProps {
  song: MobileLyricsSong | null
  currentTime?: number
  isPlaying?: boolean
  getCurrentTime?: () => number
  isOpen: boolean
  onClose: () => void
  onExpand?: () => void
  onSeek?: (seconds: number) => void
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
  currentTime = 0,
  isPlaying = false,
  getCurrentTime,
  isOpen,
  onClose,
  onExpand,
  onSeek
}: MobileLyricsSheetProps) {
  const [syncedLines, setSyncedLines] = useState<ParsedLyricLine[]>([])
  const [plainLyrics, setPlainLyrics] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const activeLineRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const lastSyncRef = useRef<{ position: number; timestamp: number }>({
    position: currentTime,
    timestamp: performance.now()
  })

  useEffect(() => {
    lastSyncRef.current = {
      position: currentTime,
      timestamp: performance.now()
    }
  }, [currentTime])

  const getCurrentTimeRef = useRef(getCurrentTime)
  getCurrentTimeRef.current = getCurrentTime

  useEffect(() => {
    if (!isOpen || !song) return

    let mounted = true
    setIsLoading(true)
    setSyncedLines([])
    setPlainLyrics('')

    const loadLyrics = async () => {
      try {
        let result: { syncedLyrics?: string; plainLyrics?: string } | null = null

        // 0. Check localStorage cached lyrics from DevicePresenceBridge (broadcast from host PC)
        if (song.id) {
          const cachedStr = localStorage.getItem(`felo_lyrics_${song.id}`)
          if (cachedStr) {
            try {
              const cached = JSON.parse(cachedStr)
              if (cached.syncedLyrics || cached.plainLyrics) {
                result = cached
              }
            } catch {}
          }
        }

        // 1. Try direct LAN remote endpoint if connected to desktop Electron app
        if (!result && remoteClient.getIsConnected() && song.id) {
          try {
            const lanLyrics = await remoteClient.getLyrics(song.id)
            if (lanLyrics && (lanLyrics.syncedLyrics || lanLyrics.plainLyrics)) {
              result = lanLyrics
            }
          } catch {
            // fallback to webApi
          }
        }

        // 2. Fallback to universal webApi / LRCLIB fetcher
        if (!result && window.api?.fetchLyrics) {
          try {
            const fetched = await window.api.fetchLyrics({
              title: song.title,
              artist: song.artist,
              album: song.album,
              duration: song.duration
            })
            if (fetched && (fetched.syncedLyrics || fetched.plainLyrics)) {
              result = fetched
            }
          } catch (err) {
            console.warn('[MobileLyricsSheet] LRCLIB fetch failed:', err)
          }
        }

        if (!mounted) return

        if (result?.syncedLyrics) {
          const parsed = parseLrc(result.syncedLyrics)
          setSyncedLines(parsed)
        } else if (result?.plainLyrics) {
          setPlainLyrics(result.plainLyrics)
        }
      } catch (err) {
        console.warn('[MobileLyricsSheet] Failed to load lyrics:', err)
      } finally {
        if (!mounted) setIsLoading(false)
      }
    }

    void loadLyrics()

    return () => {
      mounted = false
    }
  }, [isOpen, song?.id, song?.title, song?.artist])

  // High-precision smooth active line tracking
  useEffect(() => {
    if (!isOpen || !syncedLines.length) return

    const checkActiveLine = () => {
      let time: number
      if (getCurrentTimeRef.current) {
        time = getCurrentTimeRef.current()
      } else {
        const { position, timestamp } = lastSyncRef.current
        time = isPlaying ? position + (performance.now() - timestamp) / 1000 : position
      }

      let current = -1
      for (let i = 0; i < syncedLines.length; i++) {
        if (time >= syncedLines[i].time) {
          current = i
        } else {
          break
        }
      }

      setActiveIndex((prev) => (prev === current ? prev : current))
    }

    checkActiveLine()

    if (!isPlaying && !getCurrentTimeRef.current) return

    const interval = setInterval(checkActiveLine, 100)
    return () => clearInterval(interval)
  }, [isOpen, isPlaying, syncedLines, currentTime])

  // Auto-scroll to active line
  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [activeIndex])

  const handleLineClick = (time: number) => {
    if (onSeek) {
      onSeek(time)
    } else {
      void remoteClient.seek(time)
    }
  }

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
        <div className="flex items-center gap-2.5 min-w-0 pr-3">
          <Mic2 className="w-5 h-5 text-white shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Lyrics</h2>
            <p className="text-xs text-zinc-400 truncate max-w-[200px] sm:max-w-[320px]">
              {song ? `${song.title} • ${song.artist}` : 'No track selected'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title="Expand to Full Lyrics"
              className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Lyrics Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-6 py-12 space-y-6 text-center scroll-smooth pb-28 [scrollbar-width:none]"
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
                className={`transition-all duration-300 py-1.5 cursor-pointer rounded-lg px-2 ${
                  isActive
                    ? 'text-white text-2xl font-bold scale-105 drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]'
                    : 'text-zinc-500 text-lg font-medium hover:text-zinc-300'
                }`}
                onClick={() => handleLineClick(line.time)}
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
