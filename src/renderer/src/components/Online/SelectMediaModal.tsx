import { useState, useRef, useEffect, type ReactElement, type FormEvent } from 'react'
import { Upload, Volume2, X, Play, Loader2, FolderOpen, ChevronRight, ClipboardPaste } from 'lucide-react'
import {
  extractYouTubeVideoId,
  fetchYouTubeMetadata,
  type YouTubeMetadata
} from '../../lib/youtubeService'

interface SelectMediaModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectLocalFiles: (files: FileList | File[]) => Promise<void>
  onSelectYouTube: (videoId: string, title?: string, channel?: string) => Promise<void>
  onSelectSystemAudio: () => Promise<void>
  onOpenLibrary?: () => void
}

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
  const [previewData, setPreviewData] = useState<YouTubeMetadata | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setActiveTab('picker')
      setYoutubeInput('')
      setPreviewData(null)
      setIsPreviewLoading(false)
      setIsSubmitting(false)
      setErrorMessage('')
    }
  }, [isOpen])

  // Live debounced preview resolution (matches MUSIXQUARE UX)
  useEffect(() => {
    if (!isOpen || activeTab !== 'youtube' || !youtubeInput.trim()) {
      setPreviewData(null)
      setIsPreviewLoading(false)
      return
    }

    const videoId = extractYouTubeVideoId(youtubeInput)
    if (!videoId) {
      setPreviewData(null)
      setIsPreviewLoading(false)
      return
    }

    let isCurrent = true
    setIsPreviewLoading(true)
    setErrorMessage('')

    const timer = setTimeout(async () => {
      try {
        const meta = await fetchYouTubeMetadata(videoId)
        if (!isCurrent) return
        if (meta) {
          setPreviewData(meta)
        } else {
          setPreviewData(null)
        }
      } catch {
        if (isCurrent) setPreviewData(null)
      } finally {
        if (isCurrent) setIsPreviewLoading(false)
      }
    }, 250)

    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [isOpen, youtubeInput, activeTab])

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

  const handleYouTubeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!youtubeInput.trim()) return

    const videoId = previewData?.videoId || extractYouTubeVideoId(youtubeInput)
    if (!videoId) {
      setErrorMessage('Please enter a valid YouTube video link or 11-character video ID.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      let title = previewData?.title
      let channel = previewData?.channel

      // If preview is still resolving, wait for metadata
      if (!title || title === 'YouTube Track') {
        const meta = await fetchYouTubeMetadata(videoId)
        if (meta) {
          title = meta.title
          channel = meta.channel
        }
      }

      await onSelectYouTube(videoId, title || 'YouTube Track', channel || 'YouTube')
      onClose()
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load YouTube stream.')
    } finally {
      setIsSubmitting(false)
    }
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

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setYoutubeInput(text.trim())
      }
    } catch {}
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="select-media-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.12] bg-gradient-to-b from-[#18191d] via-[#121316] to-[#0c0d0f] p-6 sm:p-7 shadow-2xl animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 id="select-media-dialog-title" className="text-xl font-bold text-white tracking-tight">
              Select Media to Play
            </h2>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              The selected media plays simultaneously on all connected devices.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-all cursor-pointer"
            title="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300 font-medium animate-fade-in">
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

            {/* 3. YouTube Option */}
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
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/25 text-red-500 group-hover:bg-red-500/20 transition-all shadow-inner">
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                    <path d="M21.582 6.186a2.206 2.206 0 0 0-1.553-1.554C18.36 4.17 12 4.17 12 4.17s-6.36 0-8.029.462a2.206 2.206 0 0 0-1.553 1.554C1.956 7.854 1.956 12 1.956 12s0 4.146.462 5.814a2.206 2.206 0 0 0 1.553 1.554c1.669.462 8.029.462 8.029.462s6.36 0 8.029-.462a2.206 2.206 0 0 0 1.553-1.554c.462-1.668.462-5.814.462-5.814s0-4.146-.462-5.814ZM9.75 15.02V8.98L15.5 12l-5.75 3.02Z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold text-white group-hover:text-white transition-colors block">
                    YouTube Stream
                  </span>
                  <p className="text-xs text-text-muted mt-0.5 leading-snug">
                    Paste any YouTube video link to stream synchronized audio & video
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
                    <span className="rounded-md bg-amber-400 text-black px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
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
          /* YouTube Input View */
          <form onSubmit={handleYouTubeSubmit} className="space-y-4 animate-fade-in">
            <div>
              <label htmlFor="youtube-input-field" className="block text-xs font-bold text-white/90 mb-1.5">
                Watch YouTube Together
              </label>
              <p className="text-[11px] text-text-muted mb-3">
                Paste any public YouTube video link or 11-character video ID.
              </p>
              <div className="relative flex items-center">
                <input
                  id="youtube-input-field"
                  type="text"
                  value={youtubeInput}
                  onChange={(e) => setYoutubeInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or Video ID"
                  disabled={isSubmitting}
                  autoFocus
                  className="w-full rounded-2xl border border-white/20 bg-black/60 pl-4 pr-24 py-3 text-sm text-white placeholder-text-muted/60 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 transition-all font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={handlePasteClipboard}
                  className="absolute right-2 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Paste from clipboard"
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  <span>Paste</span>
                </button>
              </div>
            </div>

            {/* Live Preview Card */}
            {isPreviewLoading && (
              <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/5 border border-white/10 animate-pulse">
                <div className="w-24 h-14 rounded-xl bg-white/10 shrink-0 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-3.5 bg-white/10 rounded w-3/4" />
                  <div className="h-2.5 bg-white/5 rounded w-1/3" />
                </div>
              </div>
            )}

            {!isPreviewLoading && previewData && (
              <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 border border-white/15 animate-in fade-in duration-200">
                <img
                  src={previewData.thumbnailUrl}
                  alt={previewData.title}
                  className="w-24 h-14 rounded-xl object-cover border border-white/10 shrink-0 bg-black/40"
                  onError={(e) => {
                    ;(e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${previewData.videoId}/hqdefault.jpg`
                  }}
                />
                <div className="flex-1 min-w-0">
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-500/20 border border-red-500/30 px-1.5 py-0.5 text-[9px] font-bold text-red-400 uppercase tracking-wider mb-1">
                    <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                    Ready to Stream
                  </span>
                  <h4 className="text-xs font-bold text-white line-clamp-1" title={previewData.title}>
                    {previewData.title}
                  </h4>
                  <p className="text-[11px] text-text-muted line-clamp-1 mt-0.5">{previewData.channel}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('picker')
                  setErrorMessage('')
                  setPreviewData(null)
                }}
                disabled={isSubmitting}
                className="rounded-xl px-4 py-2 text-xs font-bold text-white/70 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !youtubeInput.trim() || isPreviewLoading}
                className="flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold px-5 py-2 text-xs transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading Video...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Play Video</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Modal Footer */}
        <div className="mt-6 pt-4 border-t border-white/[0.08] flex items-center justify-between text-xs">
          <span className="text-[11px] text-text-muted">
            {isSubmitting ? 'Processing media...' : 'Audio streams synchronously to all connected peers.'}
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

