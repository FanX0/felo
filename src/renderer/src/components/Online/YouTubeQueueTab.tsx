import { useState, useEffect, useRef, type ReactElement } from 'react'
import {
  Search,
  Loader2,
  Play,
  Plus,
  Star,
  ClipboardPaste,
  X,
  Music2
} from 'lucide-react'
import YouTubeIcon from '../Common/YouTubeIcon'
import { useListeningStore } from '../../hooks/useListeningStore'
import { extractYouTubeVideoId, fetchYouTubeMetadata } from '../../lib/youtubeService'

interface YouTubeSearchResult {
  id: string
  title: string
  artist: string
  duration?: string
  artworkUrl?: string
}

interface YouTubeQueueTabProps {
  onSongAdded?: (title: string) => void
}

export default function YouTubeQueueTab({ onSongAdded }: YouTubeQueueTabProps): ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<YouTubeSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounceTimerRef = useRef<any>(null)

  const addYouTubeTrackToQueue = useListeningStore((state) => state.addYouTubeTrackToQueue)

  // Handle live search / URL detection
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setIsLoading(false)
      setError(null)
      return
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Check if user entered a direct YouTube URL or video ID
    const extractedId = extractYouTubeVideoId(trimmed)
    if (extractedId) {
      setIsLoading(true)
      setError(null)
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const meta = await fetchYouTubeMetadata(extractedId)
          if (meta) {
            setResults([
              {
                id: extractedId,
                title: meta.title,
                artist: meta.channel || 'YouTube',
                artworkUrl: meta.thumbnailUrl || `https://img.youtube.com/vi/${extractedId}/hqdefault.jpg`
              }
            ])
          } else {
            setResults([
              {
                id: extractedId,
                title: 'YouTube Track',
                artist: 'YouTube',
                artworkUrl: `https://img.youtube.com/vi/${extractedId}/hqdefault.jpg`
              }
            ])
          }
        } catch {
          setError('Failed to load video details from YouTube link.')
        } finally {
          setIsLoading(false)
        }
      }, 300)
      return
    }

    // Keyword search using window.api.searchDownloadSource
    setIsLoading(true)
    setError(null)
    debounceTimerRef.current = setTimeout(async () => {
      try {
        if (typeof window !== 'undefined' && (window as any).api?.searchDownloadSource) {
          const raw = await (window as any).api.searchDownloadSource('youtube', trimmed, {})
          if (Array.isArray(raw)) {
            const parsed: YouTubeSearchResult[] = raw.map((item: any) => ({
              id: item.id,
              title: item.title,
              artist: item.artist,
              duration: item.meta?.split('·')?.[0]?.trim() || '',
              artworkUrl: item.artworkUrl || `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`
            }))
            setResults(parsed)
          } else {
            setResults([])
          }
        } else {
          setError('Search is only available in the Felo desktop app. Paste a direct YouTube link instead.')
          setResults([])
        }
      } catch (err: any) {
        console.warn('[YouTubeQueueTab] Search error:', err)
        setError('Error fetching search results. Please try again or paste a direct link.')
      } finally {
        setIsLoading(false)
      }
    }, 400)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [query])

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setQuery(text.trim())
      }
    } catch {
      // ignore
    }
  }

  const handlePlayNow = async (item: YouTubeSearchResult) => {
    setAddingId(item.id)
    try {
      await addYouTubeTrackToQueue(
        item.id,
        item.title,
        item.artist,
        undefined,
        false,
        true
      )
      onSongAdded?.(item.title)
    } catch (err: any) {
      console.warn('[YouTubeQueueTab] Play track failed:', err)
    } finally {
      setAddingId(null)
    }
  }

  const handleAddTrack = async (item: YouTubeSearchResult, isPriority: boolean) => {
    setAddingId(item.id)
    try {
      await addYouTubeTrackToQueue(
        item.id,
        item.title,
        item.artist,
        undefined,
        isPriority
      )
      onSongAdded?.(item.title)
    } catch (err: any) {
      console.warn('[YouTubeQueueTab] Add track failed:', err)
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-3.5 shadow-xs">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <YouTubeIcon className="h-4 w-4 text-danger" />
          <span className="text-xs font-bold uppercase tracking-wider text-text">
            Search & Add to YouTube Stream
          </span>
        </div>
        <span className="text-[10px] text-text-muted">
          Type keywords or paste YouTube URL
        </span>
      </div>

      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-3.5 w-3.5 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube or paste link (e.g. https://youtu.be/...)"
          className="w-full rounded-lg border border-border bg-surface-elevated pl-9 pr-20 py-2 text-xs text-text placeholder-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
        />
        <div className="absolute right-1.5 flex items-center gap-1">
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setResults([])
              }}
              className="p-1 rounded text-text-muted hover:text-text cursor-pointer"
              title="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="flex items-center gap-1 px-2 py-1 rounded bg-surface hover:bg-hover border border-border text-[10px] font-semibold text-text-muted hover:text-text transition-all cursor-pointer"
              title="Paste from clipboard"
            >
              <ClipboardPaste className="h-3 w-3" />
              <span>Paste</span>
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-text-muted animate-fade-in">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>Searching YouTube...</span>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="mt-2 text-[11px] text-danger/90 bg-danger/10 border border-danger/20 rounded-lg p-2 text-center">
          {error}
        </div>
      )}

      {/* Results List */}
      {!isLoading && results.length > 0 && (
        <div className="mt-3 max-h-60 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/40">
          {results.map((item) => {
            const isAdding = addingId === item.id
            return (
              <div
                key={item.id}
                className="pt-1.5 first:pt-0 flex items-center justify-between gap-3 p-1.5 rounded-lg hover:bg-hover transition-colors group"
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative h-9 w-12 shrink-0 rounded bg-black/60 overflow-hidden border border-border flex items-center justify-center">
                    {item.artworkUrl ? (
                      <img
                        src={item.artworkUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Music2 className="h-4 w-4 text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-text truncate group-hover:text-primary transition-colors">
                      {item.title}
                    </p>
                    <p className="text-[10px] text-text-muted truncate">
                      {item.artist} {item.duration ? `• ${item.duration}` : ''}
                    </p>
                  </div>
                </div>

                {/* Action Buttons: Play Now, Queue, Next */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => handlePlayNow(item)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-xs"
                    title="Play now immediately"
                  >
                    {isAdding ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 fill-current" />
                    )}
                    <span>Play</span>
                  </button>
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => handleAddTrack(item, false)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-surface-elevated hover:bg-hover border border-border text-text transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                    title="Add to end of queue"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Queue</span>
                  </button>
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => handleAddTrack(item, true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-surface-elevated hover:bg-hover border border-border text-text-muted hover:text-text transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                    title="Play next after current track"
                  >
                    <Star className="h-3 w-3" />
                    <span>Next</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
