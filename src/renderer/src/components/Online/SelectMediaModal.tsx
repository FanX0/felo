import { useState, useRef, useEffect, useCallback, type ReactElement, type FormEvent } from 'react'
import {
  Upload,
  Volume2,
  X,
  Play,
  Loader2,
  FolderOpen,
  ChevronRight,
  ClipboardPaste,
  Search,
  ArrowLeft,
  Sparkles
} from 'lucide-react'
import YouTubeIcon from '../Common/YouTubeIcon'
import {
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  searchYouTubeVideos,
  type YouTubeSearchResultItem
} from '../../lib/youtubeService'
import { readFromClipboard } from '../../lib/clipboard'

interface SelectMediaModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectLocalFiles: (files: FileList | File[]) => Promise<void>
  onSelectYouTube: (videoId: string, title?: string, channel?: string) => Promise<void>
  onSelectSystemAudio: () => Promise<void>
  onOpenLibrary?: () => void
}

const DISCOVERY_TAGS = [
  'Lofi Hip Hop',
  'Synthwave',
  'Chill Beats',
  'Jazz Piano',
  'Top Hits 2026'
]

export default function SelectMediaModal({
  isOpen,
  onClose,
  onSelectLocalFiles,
  onSelectYouTube,
  onSelectSystemAudio,
  onOpenLibrary
}: SelectMediaModalProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<'picker' | 'youtube'>('picker')
  const [youtubeInput, setYoutubeInput] = useState('')
  const [searchResults, setSearchResults] = useState<YouTubeSearchResultItem[]>([])
  const [directMatch, setDirectMatch] = useState<YouTubeSearchResultItem | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const debounceTimerRef = useRef<any>(null)
  const searchRequestIdRef = useRef<number>(0)

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setActiveTab('picker')
      setYoutubeInput('')
      setSearchResults([])
      setDirectMatch(null)
      setIsSearching(false)
      setIsSubmitting(false)
      setSelectedVideoId(null)
      setErrorMessage('')
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [isOpen])

  // Execute search with race-condition protection
  const executeSearch = useCallback(async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSearchResults([])
      setDirectMatch(null)
      setIsSearching(false)
      return
    }

    const currentRequestId = ++searchRequestIdRef.current
    setIsSearching(true)
    setErrorMessage('')

    try {
      // 1. Direct YouTube link or 11-char ID check
      const videoId = extractYouTubeVideoId(trimmed)
      if (videoId) {
        const meta = await fetchYouTubeMetadata(videoId)
        if (currentRequestId !== searchRequestIdRef.current) return

        const item: YouTubeSearchResultItem = meta
          ? {
              id: videoId,
              title: meta.title,
              channel: meta.channel,
              thumbnailUrl: meta.thumbnailUrl,
              url: meta.url
            }
          : {
              id: videoId,
              title: 'YouTube Track',
              channel: 'YouTube',
              thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              url: `https://www.youtube.com/watch?v=${videoId}`
            }

        setDirectMatch(item)
        setSearchResults([item])
        setIsSearching(false)
        return
      }

      setDirectMatch(null)

      // 2. Keyword Search
      const results = await searchYouTubeVideos(trimmed)
      if (currentRequestId !== searchRequestIdRef.current) return

      setSearchResults(results)
      if (results.length === 0 && typeof window !== 'undefined' && !window.api?.searchDownloadSource) {
        setErrorMessage('Keyword search is enabled in the desktop app. You can also paste any direct YouTube link.')
      }
    } catch (err: any) {
      if (currentRequestId === searchRequestIdRef.current) {
        setErrorMessage(err?.message || 'Failed to search YouTube videos.')
        setSearchResults([])
      }
    } finally {
      if (currentRequestId === searchRequestIdRef.current) {
        setIsSearching(false)
      }
    }
  }, [])

  // Debounced search on input change
  useEffect(() => {
    if (!isOpen || activeTab !== 'youtube') return

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const trimmed = youtubeInput.trim()
    if (!trimmed) {
      setSearchResults([])
      setDirectMatch(null)
      setIsSearching(false)
      return
    }

    // Direct link matches resolve faster (200ms) than general keywords (350ms)
    const isDirectLink = Boolean(extractYouTubeVideoId(trimmed))
    debounceTimerRef.current = setTimeout(() => {
      void executeSearch(trimmed)
    }, isDirectLink ? 200 : 350)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [isOpen, activeTab, youtubeInput, executeSearch])

  const handleLocalClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsSubmitting(true)
      try {
        await onSelectLocalFiles(e.target.files)
        onClose()
      } catch (err: any) {
        setErrorMessage(err?.message || 'Failed to load local audio files.')
      } finally {
        setIsSubmitting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
  }

  const handlePlayVideo = async (item: { id: string; title: string; channel: string }) => {
    setSelectedVideoId(item.id)
    setIsSubmitting(true)
    setErrorMessage('')

    try {
      await onSelectYouTube(item.id, item.title, item.channel)
      onClose()
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load YouTube stream.')
    } finally {
      setIsSubmitting(false)
      setSelectedVideoId(null)
    }
  }

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

    // If we already have a direct match or search results, play the top item immediately
    if (directMatch) {
      void handlePlayVideo(directMatch)
      return
    }
    if (searchResults.length > 0) {
      void handlePlayVideo(searchResults[0])
      return
    }

    if (youtubeInput.trim()) {
      void executeSearch(youtubeInput.trim())
    }
  }

  const handleClearInput = () => {
    setYoutubeInput('')
    setSearchResults([])
    setDirectMatch(null)
    setErrorMessage('')
    setIsSearching(false)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
  }

  const handlePasteClipboard = async () => {
    try {
      const text = await readFromClipboard()
      if (text) {
        const trimmed = text.trim()
        setYoutubeInput(trimmed)
        void executeSearch(trimmed)
      }
    } catch {
      // Ignore clipboard read errors
    }
  }

  const handleSearchTag = (tag: string) => {
    setYoutubeInput(tag)
    void executeSearch(tag)
  }

  const handleSystemAudioClick = async () => {
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      await onSelectSystemAudio()
      onClose()
    } catch (err: any) {
      setErrorMessage(err?.message || 'System audio capture was cancelled or denied.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const isYouTubeTab = activeTab === 'youtube'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="select-media-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div
        className={`relative w-full overflow-hidden rounded-3xl border border-white/[0.12] bg-gradient-to-b from-[#18191d] via-[#121316] to-[#0c0d0f] p-5 sm:p-7 shadow-2xl animate-in zoom-in-95 duration-200 transition-all ${
          isYouTubeTab
            ? 'max-w-2xl h-[580px] max-h-[88vh] flex flex-col'
            : 'max-w-lg'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {isYouTubeTab && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('picker')
                  setErrorMessage('')
                }}
                disabled={isSubmitting}
                className="p-1.5 -ml-1 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all cursor-pointer shrink-0"
                title="Back to media options"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 id="select-media-dialog-title" className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                {isYouTubeTab ? (
                  <>
                    <YouTubeIcon className="h-5 w-5 text-red-500 shrink-0" />
                    <span>Search YouTube</span>
                  </>
                ) : (
                  'Select Media to Play'
                )}
              </h2>
              <p className="text-xs text-text-muted mt-0.5 truncate leading-relaxed">
                {isYouTubeTab
                  ? 'Search by keyword or paste any YouTube link to stream together.'
                  : 'The selected media plays simultaneously on all connected devices.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all cursor-pointer shrink-0 ml-2"
            title="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="mb-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300 font-medium animate-fade-in shrink-0">
            {errorMessage}
          </div>
        )}

        {/* Hidden Local File Input */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".mp3,.wav,.flac,.m4a,.aac,.ogg,.aif,.aiff,.caf,audio/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {activeTab === 'picker' ? (
          /* ================= MEDIA PICKER TAB ================= */
          <div className="space-y-2.5">
            {/* 1. Load Local File Option */}
            <button
              type="button"
              onClick={handleLocalClick}
              disabled={isSubmitting}
              className="group w-full flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#141519] hover:bg-[#1a1c22] hover:border-white/20 p-4 text-left transition-all duration-200 cursor-pointer shadow-sm active:scale-[0.99]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 group-hover:bg-primary/20 group-hover:border-primary/40 group-hover:text-primary transition-all shadow-inner">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-white group-hover:text-white transition-colors block">
                    Load Local Files
                  </span>
                  <p className="text-xs text-text-muted mt-0.5 leading-snug">
                    Stream audio files (.mp3, .flac, .wav, .m4a) from your computer
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            {/* 2. Pick from Local Library Option */}
            {onOpenLibrary && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenLibrary()
                }}
                disabled={isSubmitting}
                className="group w-full flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#141519] hover:bg-[#1a1c22] hover:border-white/20 p-4 text-left transition-all duration-200 cursor-pointer shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 group-hover:bg-primary/20 group-hover:border-primary/40 group-hover:text-primary transition-all shadow-inner">
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white group-hover:text-white transition-colors block">
                      Pick from Local Library
                    </span>
                    <p className="text-xs text-text-muted mt-0.5 leading-snug">
                      Select tracks and albums already indexed in your Felo library
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>
            )}

            {/* 3. YouTube Stream Option */}
            <button
              type="button"
              onClick={() => {
                setActiveTab('youtube')
                setErrorMessage('')
              }}
              disabled={isSubmitting}
              className="group w-full flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#141519] hover:bg-[#1a1c22] hover:border-white/20 p-4 text-left transition-all duration-200 cursor-pointer shadow-sm active:scale-[0.99]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 group-hover:bg-primary/20 group-hover:border-primary/40 group-hover:text-primary transition-all shadow-inner">
                  <Play className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-white group-hover:text-white transition-colors block">
                    YouTube Stream
                  </span>
                  <p className="text-xs text-text-muted mt-0.5 leading-snug">
                    Search videos or paste links to stream synchronized audio & video
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>

            {/* 4. System Audio [BETA] Option */}
            <button
              type="button"
              onClick={handleSystemAudioClick}
              disabled={isSubmitting}
              className="group w-full flex items-center justify-between gap-4 rounded-2xl border border-white/[0.08] bg-[#141519] hover:bg-[#1a1c22] hover:border-white/20 p-4 text-left transition-all duration-200 cursor-pointer shadow-sm active:scale-[0.99]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/90 group-hover:bg-primary/20 group-hover:border-primary/40 group-hover:text-primary transition-all shadow-inner">
                  <Volume2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white group-hover:text-white transition-colors">
                      System Audio
                    </span>
                    <span className="rounded-md bg-surface-elevated border border-border/60 px-1.5 py-0.5 text-[9px] font-bold text-text-muted uppercase tracking-wider">
                      BETA
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mt-0.5 leading-snug">
                    Real-time capture and low-latency broadcast of your desktop sound
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-zinc-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          </div>
        ) : (
          /* ================= YOUTUBE SEARCH & RESULTS VIEW ================= */
          <div className="flex flex-col flex-1 min-h-0 animate-fade-in">
            {/* Search Input Bar */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center mb-3 shrink-0">
              <Search className="absolute left-3.5 h-4 w-4 text-zinc-400 pointer-events-none" />
              <input
                type="text"
                value={youtubeInput}
                onChange={(e) => setYoutubeInput(e.target.value)}
                placeholder="Search songs, artists, or paste YouTube link..."
                disabled={isSubmitting}
                autoFocus
                className="w-full rounded-2xl border border-white/20 bg-black/60 pl-10 pr-24 py-2.5 text-xs sm:text-sm text-white placeholder-text-muted/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
              <div className="absolute right-2 flex items-center gap-1.5">
                {youtubeInput ? (
                  <button
                    type="button"
                    onClick={handleClearInput}
                    disabled={isSubmitting}
                    className="p-1 rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    disabled={isSubmitting}
                    className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Paste from clipboard"
                  >
                    <ClipboardPaste className="h-3 w-3" />
                    <span className="hidden sm:inline">Paste</span>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting || !youtubeInput.trim() || isSearching}
                  className="px-3 py-1 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-40"
                >
                  Search
                </button>
              </div>
            </form>

            {/* Scrollable Results Area */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1 scrollbar-thin">
              {/* 1. Loading Skeletons */}
              {isSearching && (
                <div className="space-y-2.5 animate-pulse">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3.5 p-2.5 rounded-2xl bg-white/5 border border-white/[0.08]"
                    >
                      <div className="w-24 sm:w-28 h-14 sm:h-16 rounded-xl bg-white/10 shrink-0 aspect-video" />
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="h-3.5 bg-white/10 rounded-md w-3/4" />
                        <div className="h-2.5 bg-white/5 rounded-md w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 2. Direct Match Banner Card (when user enters URL or video ID) */}
              {!isSearching && directMatch && (
                <div className="mb-3 p-3.5 rounded-2xl bg-gradient-to-r from-red-500/10 via-primary/10 to-transparent border border-primary/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="relative w-24 sm:w-28 h-14 sm:h-16 rounded-xl overflow-hidden shrink-0 aspect-video bg-black/60 border border-white/10">
                      <img
                        src={directMatch.thumbnailUrl}
                        alt={directMatch.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${directMatch.id}/hqdefault.jpg`
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/20 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold text-primary uppercase tracking-wider mb-1">
                        <Play className="h-2.5 w-2.5 fill-current" />
                        Direct Link Match
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold text-white line-clamp-1" title={directMatch.title}>
                        {directMatch.title}
                      </h4>
                      <p className="text-[11px] text-text-muted mt-0.5 truncate">{directMatch.channel}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePlayVideo(directMatch)}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold px-4 py-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting && selectedVideoId === directMatch.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Starting...</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Play Video</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* 3. Search Results List */}
              {!isSearching && searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map((item) => {
                    const isCurrentLoading = isSubmitting && selectedVideoId === item.id
                    return (
                      <div
                        key={item.id}
                        onClick={() => !isSubmitting && handlePlayVideo(item)}
                        className="group flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-2xl border border-white/[0.06] bg-[#141519] hover:bg-[#1a1c22] hover:border-white/20 transition-all duration-150 cursor-pointer shadow-sm active:scale-[0.995]"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Thumbnail with duration badge */}
                          <div className="relative w-24 sm:w-28 h-14 sm:h-16 rounded-xl overflow-hidden shrink-0 aspect-video bg-black/60 border border-white/10 group-hover:border-primary/40 transition-colors">
                            <img
                              src={item.thumbnailUrl}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={(e) => {
                                ;(e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`
                              }}
                            />
                            {item.duration && (
                              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/85 text-[10px] font-mono font-medium text-white shadow-xs">
                                {item.duration}
                              </span>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <div className="p-1.5 rounded-full bg-primary text-primary-foreground shadow-md">
                                <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                              </div>
                            </div>
                          </div>

                          {/* Video Info */}
                          <div className="min-w-0 flex-1 pr-1">
                            <h4
                              className="text-xs sm:text-sm font-semibold text-white/95 group-hover:text-primary transition-colors line-clamp-2 leading-snug"
                              title={item.title}
                            >
                              {item.title}
                            </h4>
                            <p className="text-[11px] text-text-muted mt-1 truncate">
                              {item.channel}
                            </p>
                          </div>
                        </div>

                        {/* Play Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handlePlayVideo(item)
                          }}
                          disabled={isSubmitting}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 group-hover:bg-primary group-hover:text-primary-foreground text-zinc-300 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                        >
                          {isCurrentLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span className="hidden sm:inline">Starting...</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5 fill-current" />
                              <span className="hidden sm:inline">Play</span>
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 4. Initial Discovery Suggestions (empty input) */}
              {!isSearching && !youtubeInput.trim() && (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <div className="h-12 w-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center mb-3">
                    <YouTubeIcon className="h-6 w-6" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">
                    Search YouTube or Paste a Link
                  </h3>
                  <p className="text-xs text-text-muted max-w-sm mb-4 leading-relaxed">
                    Stream synchronized audio & video to everyone in this room. Search for songs, podcasts, or music videos.
                  </p>

                  {/* Suggestion Chips */}
                  <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
                    {DISCOVERY_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleSearchTag(tag)}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-all cursor-pointer active:scale-95"
                      >
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span>{tag}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Zero Results State */}
              {!isSearching && youtubeInput.trim() && searchResults.length === 0 && !directMatch && (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 text-zinc-400 flex items-center justify-center mb-3">
                    <Search className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1">No videos found</h3>
                  <p className="text-xs text-text-muted max-w-sm mb-4">
                    We couldn&apos;t find any results for &ldquo;{youtubeInput}&rdquo;. Try different keywords or paste a direct YouTube video link.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearInput}
                    className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-all cursor-pointer"
                  >
                    Clear Search
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="mt-4 pt-3.5 border-t border-white/[0.08] flex items-center justify-between text-xs shrink-0">
          <span className="text-[11px] text-text-muted">
            {isSubmitting ? 'Starting stream...' : 'Audio streams synchronously to all connected peers.'}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
