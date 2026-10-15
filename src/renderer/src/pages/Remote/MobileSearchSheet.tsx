import { useState, useEffect, useRef } from 'react'
import { Search as SearchIcon, X, Play, Plus, Check, Music2, RefreshCw, Download, Library } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { remoteClient, type RemotePlayerSong } from './remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore, normalizeDeviceId } from '../../hooks/useConnectedDeviceStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'

interface MobileSearchSheetProps {
  isOpen: boolean
  onClose: () => void
  targetDeviceId?: string
  targetDeviceName?: string
}

export default function MobileSearchSheet({
  isOpen,
  onClose,
  targetDeviceId,
  targetDeviceName
}: MobileSearchSheetProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RemotePlayerSong[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  const canonicalTargetId = normalizeDeviceId(targetDeviceId)
  const targetSongs = useConnectedDeviceStore((s) => s.getDeviceSongs(canonicalTargetId))

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    if (!query.trim()) {
      // If store already has target device songs, display them immediately
      if (targetSongs.length > 0) {
        setResults(
          targetSongs.map((s) => ({
            id: s.id,
            title: s.title,
            artist: s.artist,
            album: s.album || '',
            duration: s.duration,
            artworkUrl: s.artworkUrl
          }))
        )
        return
      }

      // Otherwise fetch initial batch from remote library service if desktop target
      const isDesktopTarget = canonicalTargetId === 'default-pc'
      if (isDesktopTarget && remoteClient.getIsConnected()) {
        setIsLoading(true)
        remoteLibraryService
          .getSongs({ limit: 100 })
          .then((res) => {
            if (res.songs && res.songs.length > 0) {
              setResults(
                res.songs.map((s) => ({
                  id: s.id,
                  title: s.title,
                  artist: s.artist,
                  album: s.album || '',
                  duration: s.duration,
                  artworkUrl: s.artworkUrl
                }))
              )
            }
          })
          .catch(() => undefined)
          .finally(() => setIsLoading(false))
      }
      return
    }

    const timer = setTimeout(async () => {
      setIsLoading(true)
      const q = query.trim().toLowerCase()
      const localMatches = targetSongs
        .filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.artist.toLowerCase().includes(q) ||
            (s.album && s.album.toLowerCase().includes(q))
        )
        .map((s) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          album: s.album || '',
          duration: s.duration,
          artworkUrl: s.artworkUrl
        }))

      const isDesktopTarget = canonicalTargetId === 'default-pc'
      if (isDesktopTarget && remoteClient.getIsConnected()) {
        try {
          const res = await remoteClient.searchLibrary(query.trim())
          if (res && Array.isArray(res.results) && res.results.length > 0) {
            setResults(res.results)
            setIsLoading(false)
            return
          }
        } catch (err) {
          console.warn('[MobileSearchSheet] LAN search failed, falling back to local results:', err)
        }
      }

      setResults(localMatches)
      setIsLoading(false)
    }, 250)

    return () => clearTimeout(timer)
  }, [query, isOpen, targetSongs, canonicalTargetId])

  if (!isOpen) return null

  const handlePlayNow = (songId: string) => {
    const isDesktopTarget = canonicalTargetId === 'default-pc'
    if (isDesktopTarget || remoteClient.getIsConnected()) {
      void remoteClient.play(songId)
    } else {
      const song = targetSongs.find((s) => s.id === songId)
      if (song) {
        usePlayerStore.getState().setQueue([song], 0, {
          type: 'library',
          title: targetDeviceName ? `${targetDeviceName} Library` : 'Device Library'
        })
      }
    }
    onClose()
  }

  const handleEnqueue = async (e: React.MouseEvent, songId: string) => {
    e.stopPropagation()
    try {
      await remoteClient.enqueue(songId)
      setAddedIds((prev) => new Set(prev).add(songId))
      setTimeout(() => {
        setAddedIds((prev) => {
          const next = new Set(prev)
          next.delete(songId)
          return next
        })
      }, 2000)
    } catch {
      // ignore
    }
  }

  const handleDownload = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation()
    remoteClient.downloadSong(songId)
    setDownloadedIds((prev) => new Set(prev).add(songId))
    setTimeout(() => {
      setDownloadedIds((prev) => {
        const next = new Set(prev)
        next.delete(songId)
        return next
      })
    }, 2500)
  }

  const formatDuration = (secs: number) => {
    if (!secs) return '0:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#121212] flex flex-col text-white animate-in slide-in-from-top duration-200 select-none pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Header with Search Input */}
      <header className="px-4 py-3 border-b border-white/5 bg-[#181818]/60 backdrop-blur-md flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 bg-white/10 rounded-full px-4 py-2 border border-white/10 focus-within:border-white/40 transition">
          <SearchIcon className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={searchInputRef}
            type="search"
            placeholder={targetDeviceName ? `Search ${targetDeviceName} library...` : 'Search library...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-zinc-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onClose()
              window.location.hash = ''
              navigate('/library')
            }}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 px-2 py-1 flex items-center gap-1.5 cursor-pointer bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
            title="Open full Felo Library"
          >
            <Library className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Full Library</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-zinc-300 hover:text-white px-2 py-1 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </header>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <RefreshCw className="w-6 h-6 animate-spin text-white" />
            <span className="text-xs">Loading your desktop music...</span>
          </div>
        ) : query.trim() && results.length === 0 ? (
          <div className="py-16 text-center text-zinc-500 text-xs">
            No playable tracks found on your desktop matching &quot;{query}&quot;.
          </div>
        ) : results.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center text-zinc-500 px-6">
            <SearchIcon className="w-12 h-12 opacity-30 mb-3 text-zinc-400" />
            <p className="text-sm font-semibold text-zinc-400">Search Your Desktop Library</p>
            <p className="text-xs text-zinc-500 max-w-xs mt-1">
              Find any artist, album, or track stored on your computer and start playback immediately.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between mb-2 px-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                {query.trim() ? `Search Results (${results.length})` : `Your PC Songs (${results.length})`}
              </h3>
            </div>
            {results.map((track) => {
              const isAdded = addedIds.has(track.id)
              const isDownloaded = downloadedIds.has(track.id)
              return (
                <div
                  key={track.id}
                  onClick={() => handlePlayNow(track.id)}
                  className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 cursor-pointer transition group"
                >
                  <div className="w-11 h-11 rounded-lg bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center border border-white/5 relative">
                    {track.artworkUrl ? (
                      <img
                        src={remoteClient.getFullArtworkUrl(track.artworkUrl)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Music2 className="w-5 h-5 text-zinc-600" />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                      <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-white truncate group-hover:text-zinc-200 transition">
                      {track.title}
                    </h4>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {track.artist} {track.album ? `• ${track.album}` : ''}
                    </p>
                  </div>

                  <span className="text-xs font-mono text-zinc-500 shrink-0">
                    {formatDuration(track.duration)}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => handleDownload(e, track.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title="Download to phone storage"
                    >
                      {isDownloaded ? (
                        <Check className="w-4 h-4 text-white" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleEnqueue(e, track.id)}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title="Add to queue"
                    >
                      {isAdded ? (
                        <Check className="w-4 h-4 text-white" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
