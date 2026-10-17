import { FormEvent, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Award,
  Camera,
  Check,
  ClipboardPaste,
  Clock,
  Clock3,
  Compass,
  Link2,
  ListMusic,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  Music,
  Play,
  Radio,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  X
} from 'lucide-react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import Avatar from '../../components/Common/Avatar'
import DeleteFriendModal from '../../components/Common/DeleteFriendModal'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { useListeningStore } from '../../hooks/useListeningStore'
import { getSupabase } from '../../lib/supabase'
import { toMediaUrl } from '../../lib/media'
import { validateAvatarFile, extractImageFromClipboard } from '../../lib/avatar'
import type {
  FriendRequest,
  ListeningRoom,
  OnlineProfile,
  SharedPlaylist,
  UserListeningStats
} from '../../online/types'
import { findMatchingLibrarySong } from '../../lib/songMatching'
import {
  PersonalizationService,
  type UserTasteMetrics
} from '../../services/PersonalizationService'
import type { Song } from '../Library/Library'
import {
  PLAYED_SONGS_STORAGE_KEY,
  PLAY_STATS_STORAGE_KEY,
  RECENTLY_PLAYED_STORAGE_KEY
} from '../../hooks/usePlayerStore'

interface LocalPlayStats {
  playCount: number
  lastPlayedAt: number
}

interface ProfileSong extends Song {
  playCount?: number
  lastPlayedAt?: number
}

interface ListeningHistoryData {
  recent: ProfileSong[]
  allRecent: ProfileSong[]
  mostPlayed: ProfileSong[]
  allMostPlayed: ProfileSong[]
  artists: Array<{ artist: string; playCount: number }>
  allArtists: Array<{ artist: string; playCount: number }>
  totalPlays: number
  totalTracks: number
}

function readListeningHistory(): ListeningHistoryData {
  try {
    const recent = JSON.parse(
      localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]'
    ) as ProfileSong[]
    const playedSongs = JSON.parse(
      localStorage.getItem(PLAYED_SONGS_STORAGE_KEY) || '{}'
    ) as Record<string, ProfileSong>
    const stats = JSON.parse(localStorage.getItem(PLAY_STATS_STORAGE_KEY) || '{}') as Record<
      string,
      LocalPlayStats
    >
    const knownSongs = { ...playedSongs }
    recent.forEach((song) => {
      knownSongs[song.id] = song
    })
    const withStats = recent.map((song) => ({ ...song, ...(stats[song.id] || {}) }))
    const allMostPlayed = Object.entries(stats)
      .map(([id, value]): ProfileSong | null => {
        const song = knownSongs[id]
        return song ? ({ ...song, ...value } as ProfileSong) : null
      })
      .filter((song): song is ProfileSong => song !== null)
      .sort((left, right) => (right.playCount || 0) - (left.playCount || 0))

    const artistTotals = new Map<string, number>()
    let totalPlays = 0
    Object.entries(stats).forEach(([id, value]) => {
      totalPlays += value.playCount || 0
      const song = knownSongs[id]
      if (song) {
        const artist = song.artist || 'Unknown Artist'
        artistTotals.set(artist, (artistTotals.get(artist) || 0) + (value.playCount || 1))
      }
    })
    const allArtists = [...artistTotals.entries()]
      .map(([artist, playCount]) => ({ artist, playCount }))
      .sort((left, right) => right.playCount - left.playCount)

    return {
      recent: withStats.slice(0, 6),
      allRecent: withStats,
      mostPlayed: allMostPlayed.slice(0, 6),
      allMostPlayed,
      artists: allArtists.slice(0, 5),
      allArtists,
      totalPlays,
      totalTracks: Object.keys(knownSongs).length
    }
  } catch {
    return {
      recent: [],
      allRecent: [],
      mostPlayed: [],
      allMostPlayed: [],
      artists: [],
      allArtists: [],
      totalPlays: 0,
      totalTracks: 0
    }
  }
}

function ProfileAvatar({
  profile,
  large = false,
  className
}: {
  profile: OnlineProfile
  large?: boolean
  className?: string
}): ReactElement {
  return (
    <Avatar
      src={profile.avatar_url}
      fallbackText={profile.display_name || profile.username}
      size={large ? '2xl' : 'md'}
      className={className}
      alt={profile.display_name}
    />
  )
}

function SongArtwork({
  song,
  fetchedArtwork,
  size = 'small'
}: {
  song: ProfileSong
  fetchedArtwork?: string
  size?: 'small' | 'large'
}): ReactElement {
  const artworkUrl = toMediaUrl(song.artworkPath) || fetchedArtwork
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-elevated text-text-muted ${size === 'large' ? 'h-9 w-9' : 'h-8 w-8'}`}
    >
      <Radio className={size === 'large' ? 'h-5 w-5' : 'h-4 w-4'} />
      {artworkUrl && (
        <img
          src={artworkUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      )}
    </div>
  )
}

function ProfileEditor({
  initialProfile,
  onClose
}: {
  initialProfile: OnlineProfile
  onClose: () => void
}): ReactElement {
  const { user, updateProfile, uploadAvatar, removeAvatar, signOut } = useOnlineStore()
  const [username, setUsername] = useState(initialProfile.username)
  const [displayName, setDisplayName] = useState(initialProfile.display_name)
  const [bio, setBio] = useState(initialProfile.bio)
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatar_url || '')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [isHistoryPublic, setIsHistoryPublic] = useState(initialProfile.is_history_public !== false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleSelectFile = (file: File): void => {
    setUploadError(null)
    const validation = validateAvatarFile(file)
    if (!validation.valid) {
      setUploadError(validation.error || 'Invalid image file.')
      return
    }

    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl)
    }

    const objectUrl = URL.createObjectURL(file)
    setPreviewFile(file)
    setPreviewUrl(objectUrl)
    setAvatarUrl('')
  }

  const handlePasteEvent = useCallback(
    (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      const isTextInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        (target as HTMLInputElement).type !== 'checkbox' &&
        (target as HTMLInputElement).type !== 'file'

      const clipboardData = event.clipboardData
      if (!clipboardData) return

      // 1. Check for image files in clipboard
      const imageFile = extractImageFromClipboard(clipboardData)
      if (imageFile) {
        event.preventDefault()
        handleSelectFile(imageFile)
        return
      }

      // 2. If no image file, but user pasted an image URL or data URL and is NOT focusing a text input:
      if (!isTextInput) {
        const text = clipboardData.getData('text')?.trim()
        if (
          text &&
          (text.startsWith('http://') ||
            text.startsWith('https://') ||
            text.startsWith('data:image/'))
        ) {
          event.preventDefault()
          setUploadError(null)
          setAvatarUrl(text)
          setShowUrlInput(true)
          if (previewFile) setPreviewFile(null)
          if (previewUrl && previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl(null)
          }
        }
      }
    },
    [previewFile, previewUrl]
  )

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent): void => {
      handlePasteEvent(e)
    }
    window.addEventListener('paste', onWindowPaste)
    return () => {
      window.removeEventListener('paste', onWindowPaste)
    }
  }, [handlePasteEvent])

  const handlePasteFromClipboard = async (): Promise<void> => {
    setUploadError(null)
    try {
      if (navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            const imageType = item.types.find((t) => t.startsWith('image/'))
            if (imageType) {
              const blob = await item.getType(imageType)
              const ext =
                blob.type === 'image/jpeg'
                  ? 'jpg'
                  : blob.type === 'image/webp'
                    ? 'webp'
                    : blob.type === 'image/gif'
                      ? 'gif'
                      : 'png'
              const file = new File([blob], `pasted-image-${Date.now()}.${ext}`, {
                type: blob.type
              })
              handleSelectFile(file)
              return
            }
          }
        } catch {
          // If reading clipboard items fails or permission denied, continue to text fallback
        }
      }

      if (navigator.clipboard?.readText) {
        const text = (await navigator.clipboard.readText()).trim()
        if (
          text &&
          (text.startsWith('http://') ||
            text.startsWith('https://') ||
            text.startsWith('data:image/'))
        ) {
          setAvatarUrl(text)
          setShowUrlInput(true)
          if (previewFile) setPreviewFile(null)
          if (previewUrl && previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl(null)
          }
          return
        }
      }

      setUploadError('No image found in clipboard. Copy an image or screenshot first, or press Ctrl+V.')
    } catch {
      setUploadError('Unable to access clipboard. Please press Ctrl+V to paste.')
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (file) {
      handleSelectFile(file)
    }
    event.target.value = ''
  }

  const handleRemoveAvatar = (): void => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewFile(null)
    setPreviewUrl(null)
    setAvatarUrl('')
    setUploadError(null)
  }

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      handleSelectFile(file)
    }
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setUploadError(null)

    try {
      if (previewFile) {
        if (!user) {
          throw new Error('You must be signed in to upload a profile picture.')
        }
        // uploadAvatar applies instant 0ms optimistic update across all UI components,
        // and persists to Supabase storage in the background.
        void uploadAvatar(previewFile).catch((err) => {
          console.error('[ProfileEditor] Background upload error:', err)
        })
      } else if (!avatarUrl && initialProfile.avatar_url && !previewUrl) {
        void removeAvatar().catch((err) => {
          console.error('[ProfileEditor] Background remove error:', err)
        })
      }

      const avatarToSet = previewFile
        ? (previewUrl || null)
        : (avatarUrl ? avatarUrl.trim() : null)

      await updateProfile({
        username,
        display_name: displayName,
        bio,
        avatar_url: avatarToSet,
        is_history_public: isHistoryPublic
      })
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile')
    } finally {
      setBusy(false)
    }
  }

  const currentAvatarSrc = previewUrl || avatarUrl || null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 no-drag"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      <form
        onSubmit={save}
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <h2 id="edit-profile-title" className="text-xl font-black text-text">
            Edit profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Avatar Upload Dropzone & Controls */}
        <div className="mt-5 flex flex-col items-center justify-center text-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <div
            tabIndex={0}
            role="button"
            aria-label="Upload profile image"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`group relative h-28 w-28 cursor-pointer overflow-hidden rounded-full border-2 transition-all outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              isDragging
                ? 'border-white bg-white/10 scale-105'
                : 'border-border hover:border-white/40'
            }`}
          >
            <Avatar
              src={currentAvatarSrc}
              fallbackText={displayName || username}
              size="custom"
              className="h-full w-full"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-bold gap-1">
              <Camera className="h-6 w-6" />
              <span>Change</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3.5 py-1.5 text-xs font-bold text-text hover:bg-hover hover:border-white/30 transition-colors cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5 text-text-muted" />
              <span>Upload photo</span>
            </button>

            <button
              type="button"
              onClick={() => void handlePasteFromClipboard()}
              title="Paste image from clipboard (Ctrl+V)"
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated px-3.5 py-1.5 text-xs font-bold text-text hover:bg-hover hover:border-white/30 transition-colors cursor-pointer"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-text-muted" />
              <span>Paste image</span>
            </button>

            {currentAvatarSrc && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-transparent px-3 py-1.5 text-xs font-bold text-text-muted hover:text-danger hover:border-danger/40 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowUrlInput((prev) => !prev)}
              className="flex items-center gap-1.5 rounded-full border border-border/40 bg-transparent px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>{showUrlInput ? 'Hide URL' : 'Image URL'}</span>
            </button>
          </div>

          <p className="mt-2 text-[11px] text-text-muted">
            PNG, JPG, WebP or GIF up to 5 MB. Drag & drop or paste image (Ctrl+V).
          </p>

          {uploadError && (
            <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs text-danger">
              {uploadError}
            </div>
          )}
        </div>

        {/* Collapsible Image URL input */}
        {showUrlInput && (
          <div className="mt-4 rounded-xl border border-border/80 bg-surface-elevated/40 p-3">
            <label className="text-xs font-bold text-text block">
              Image URL
              <input
                type="url"
                placeholder="https://example.com/avatar.png"
                value={avatarUrl}
                onChange={(event) => {
                  setAvatarUrl(event.target.value)
                  if (previewFile) setPreviewFile(null)
                  if (previewUrl && previewUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(previewUrl)
                    setPreviewUrl(null)
                  }
                }}
                className="mt-1.5 h-10 w-full rounded-md border border-border bg-canvas px-3 text-xs font-normal outline-none focus:border-white/30"
              />
            </label>
            <p className="mt-1 text-[11px] text-text-muted">Direct web link to an image file.</p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-text">
            Display name
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-border bg-canvas px-3 font-normal outline-none focus:border-white/30"
            />
          </label>
          <label className="text-sm font-bold text-text">
            Username
            <input
              required
              pattern="[a-zA-Z0-9_]+"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-border bg-canvas px-3 font-normal outline-none focus:border-white/30"
            />
          </label>
          <label className="text-sm font-bold text-text sm:col-span-2">
            Bio
            <textarea
              rows={3}
              maxLength={240}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              className="mt-2 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-white/30"
            />
          </label>
          <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-border/60 bg-surface-elevated/40 p-3 mt-1">
            <div>
              <p className="text-sm font-bold text-text">Public Listening History</p>
              <p className="text-xs text-text-muted">
                Allow friends and other listeners to see your top songs and recently played tracks
              </p>
            </div>
            <input
              type="checkbox"
              checked={isHistoryPublic}
              onChange={(e) => setIsHistoryPublic(e.target.checked)}
              className="h-5 w-5 rounded border-border accent-white cursor-pointer"
            />
          </div>
        </div>
        {message && <p className="mt-4 text-sm text-danger">{message}</p>}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-2 text-sm font-bold text-text-muted hover:text-danger cursor-pointer transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-black text-text hover:bg-hover transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-5 py-2.5 text-sm font-black text-text disabled:opacity-50 hover:bg-hover hover:border-white/30 transition-colors cursor-pointer"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{' '}
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ─── Concurrency-Controlled Artwork Cache ─────────────────────────────────────
const artworkMemoryCache = new Map<string, string>()

async function fetchArtworkBatch(
  songs: ProfileSong[],
  currentCache: Record<string, string>,
  onUpdate: (updates: Record<string, string>) => void
): Promise<void> {
  const needed = songs.filter(
    (s) => !toMediaUrl(s.artworkPath) && !currentCache[s.id] && !artworkMemoryCache.has(s.id)
  )
  if (needed.length === 0) return

  const updates: Record<string, string> = {}
  const CONCURRENCY = 3

  for (let i = 0; i < needed.length; i += CONCURRENCY) {
    const batch = needed.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (song) => {
        try {
          const results = await window.api?.searchAppleMusic?.(`${song.title} ${song.artist}`)
          const match = results?.Songs?.find((item: { thumbnail?: string }) => item.thumbnail)
          if (match?.thumbnail) {
            updates[song.id] = match.thumbnail
            artworkMemoryCache.set(song.id, match.thumbnail)
          } else {
            artworkMemoryCache.set(song.id, '')
          }
        } catch {
          artworkMemoryCache.set(song.id, '')
        }
      })
    )
    if (Object.keys(updates).length > 0) {
      onUpdate({ ...updates })
    }
  }
}

// ─── Full Listening History Modal ─────────────────────────────────────────────
function FullListeningHistoryModal({
  onClose,
  initialTab = 'recent'
}: {
  onClose: () => void
  initialTab?: 'recent' | 'mostPlayed' | 'artists'
}): ReactElement {
  const { requestPlaySong } = usePlaybackArbitration()
  const [activeTab, setActiveTab] = useState<'recent' | 'mostPlayed' | 'artists'>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  const [historyData, setHistoryData] = useState<ListeningHistoryData>(() => readListeningHistory())
  const [artworks, setArtworks] = useState<Record<string, string>>({})

  // Load artworks progressively for currently visible items
  useEffect(() => {
    let cancelled = false
    const songsToFetch = (
      activeTab === 'mostPlayed' ? historyData.allMostPlayed : historyData.allRecent
    ).slice(0, page * PAGE_SIZE)
    void fetchArtworkBatch(songsToFetch, artworks, (newArtworks) => {
      if (!cancelled) {
        setArtworks((prev) => ({ ...prev, ...newArtworks }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeTab, page, historyData])

  const filteredRecent = useMemo(() => {
    if (!searchQuery.trim()) return historyData.allRecent
    const q = searchQuery.toLowerCase()
    return historyData.allRecent.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    )
  }, [historyData.allRecent, searchQuery])

  const filteredMostPlayed = useMemo(() => {
    if (!searchQuery.trim()) return historyData.allMostPlayed
    const q = searchQuery.toLowerCase()
    return historyData.allMostPlayed.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    )
  }, [historyData.allMostPlayed, searchQuery])

  const filteredArtists = useMemo(() => {
    if (!searchQuery.trim()) return historyData.allArtists
    const q = searchQuery.toLowerCase()
    return historyData.allArtists.filter((a) => a.artist.toLowerCase().includes(q))
  }, [historyData.allArtists, searchQuery])

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear all listening history and play stats?')) {
      localStorage.removeItem(RECENTLY_PLAYED_STORAGE_KEY)
      localStorage.removeItem(PLAYED_SONGS_STORAGE_KEY)
      localStorage.removeItem(PLAY_STATS_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent('felo:recently-played-updated'))
      setHistoryData(readListeningHistory())
    }
  }

  const topArtistName = historyData.allArtists[0]?.artist || 'None yet'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6 no-drag backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/70 p-5 bg-surface-elevated/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated border border-border text-text">
              <Clock3 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-text">Listening History</h2>
              <p className="text-xs text-text-muted">
                {historyData.totalPlays} total plays · {historyData.totalTracks} unique tracks
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearHistory}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs font-bold text-text-muted hover:text-danger hover:border-danger/40 transition-colors"
            >
              Clear History
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Quick Stats Banner */}
        <div className="grid grid-cols-3 gap-3 border-b border-border/50 bg-surface-elevated/10 p-4">
          <div className="rounded-xl border border-border/40 bg-surface-elevated/40 p-3 text-center">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Total Plays
            </span>
            <span className="text-lg font-black text-text">{historyData.totalPlays}</span>
          </div>
          <div className="rounded-xl border border-border/40 bg-surface-elevated/40 p-3 text-center">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Unique Tracks
            </span>
            <span className="text-lg font-black text-text">{historyData.totalTracks}</span>
          </div>
          <div className="rounded-xl border border-border/40 bg-surface-elevated/40 p-3 text-center">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Top Artist
            </span>
            <span className="truncate block text-lg font-black text-text" title={topArtistName}>
              {topArtistName}
            </span>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
          {/* Tab buttons */}
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated/50 p-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab('recent')
                setPage(1)
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
                activeTab === 'recent'
                  ? 'bg-surface-elevated text-text shadow-sm border border-border'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Recently Played ({filteredRecent.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('mostPlayed')
                setPage(1)
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
                activeTab === 'mostPlayed'
                  ? 'bg-surface-elevated text-text shadow-sm border border-border'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Most Played ({filteredMostPlayed.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('artists')
                setPage(1)
              }}
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
                activeTab === 'artists'
                  ? 'bg-surface-elevated text-text shadow-sm border border-border'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Top Artists ({filteredArtists.length})
            </button>
          </div>

          {/* Search bar */}
          <input
            type="text"
            placeholder="Filter history..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            className="w-full sm:w-64 rounded-full border border-border bg-canvas px-4 py-1.5 text-xs text-text placeholder-text-muted outline-none focus:border-white/30"
          />
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {activeTab === 'artists' ? (
            filteredArtists.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {filteredArtists.slice(0, page * PAGE_SIZE).map((item, idx) => (
                  <div
                    key={item.artist}
                    className="flex items-center gap-3 rounded-xl border border-border/40 bg-surface-elevated/40 p-3"
                  >
                    <span className="w-6 text-center text-xs font-black text-text-muted">
                      {idx + 1}
                    </span>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text">
                      <UserCheck className="h-4 w-4" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                      {item.artist}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-bold text-text-muted">
                      {item.playCount} {item.playCount === 1 ? 'play' : 'plays'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-center text-text-muted">
                <Users className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-xs">No artists found in history</p>
              </div>
            )
          ) : (
            <>
              {(() => {
                const list = activeTab === 'mostPlayed' ? filteredMostPlayed : filteredRecent
                const visible = list.slice(0, page * PAGE_SIZE)

                if (visible.length === 0) {
                  return (
                    <div className="flex h-48 flex-col items-center justify-center text-center text-text-muted">
                      <ListMusic className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-xs">No songs found in history</p>
                    </div>
                  )
                }

                return (
                  <div className="space-y-1.5">
                    {visible.map((song, idx) => {
                      const artwork = artworks[song.id]
                      return (
                        <div
                          key={`${song.id}-${idx}`}
                          onClick={() => requestPlaySong(song as Song)}
                          className="group flex items-center gap-3 rounded-xl border border-border/30 bg-surface-elevated/30 p-2.5 text-left transition-all hover:bg-hover hover:border-border cursor-pointer"
                        >
                          <span className="w-6 text-center text-xs font-black text-text-muted">
                            {idx + 1}
                          </span>
                          <SongArtwork song={song} fetchedArtwork={artwork} size="large" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-text group-hover:underline">
                              {song.title}
                            </p>
                            <p className="truncate text-xs text-text-muted">
                              {song.artist}
                              {song.album ? ` · ${song.album}` : ''}
                            </p>
                          </div>
                          {song.lastPlayedAt && activeTab === 'recent' && (
                            <span className="text-[11px] text-text-muted hidden sm:inline">
                              {new Date(
                                song.lastPlayedAt < 10_000_000_000
                                  ? song.lastPlayedAt * 1000
                                  : song.lastPlayedAt
                              ).toLocaleDateString()}
                            </span>
                          )}
                          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-bold text-text-muted">
                            {song.playCount || 1} {(song.playCount || 1) === 1 ? 'play' : 'plays'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              requestPlaySong(song as Song)
                            }}
                            title="Play track"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-elevated text-text opacity-0 group-hover:opacity-100 transition-opacity hover:bg-hover"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Load More Button */}
              {(activeTab === 'mostPlayed' ? filteredMostPlayed.length : filteredRecent.length) >
                page * PAGE_SIZE && (
                <div className="pt-3 text-center">
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-full border border-border bg-surface-elevated px-5 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                  >
                    Load more songs
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfileWorkspace(): ReactElement {
  const { username } = useParams<{ username?: string }>()
  const navigate = useNavigate()
  const { user, profile: ownProfile, uploadAvatar, signOut } = useOnlineStore()
  const { requestPlaySong } = usePlaybackArbitration()
  const [viewedProfile, setViewedProfile] = useState<OnlineProfile | null>(null)
  const [relationship, setRelationship] = useState<FriendRequest | null>(null)
  const [playlists, setPlaylists] = useState<SharedPlaylist[]>([])
  const [followerCount, setFollowerCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [mostPlayed, setMostPlayed] = useState<ProfileSong[]>([])
  const [recentSongs, setRecentSongs] = useState<ProfileSong[]>([])
  const [mostPlayedArtists, setMostPlayedArtists] = useState<
    Array<{ artist: string; playCount: number }>
  >([])
  const [artworkBySongId, setArtworkBySongId] = useState<Record<string, string>>({})
  const [friendRoom, setFriendRoom] = useState<ListeningRoom | null>(null)
  const [tasteMetrics, setTasteMetrics] = useState<UserTasteMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyModalInitialTab, setHistoryModalInitialTab] = useState<
    'recent' | 'mostPlayed' | 'artists'
  >('recent')

  const directAvatarInputRef = useRef<HTMLInputElement>(null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isAvatarDragging, setIsAvatarDragging] = useState(false)
  const [avatarToast, setAvatarToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const isViewingOwnProfile = Boolean(
    (!username && user) ||
      (ownProfile && username && ownProfile.username.toLowerCase() === username.toLowerCase()) ||
      (viewedProfile && user && viewedProfile.id === user.id)
  )

  const activeProfile = isViewingOwnProfile ? (ownProfile || viewedProfile) : viewedProfile
  const isOwnProfile = Boolean(activeProfile && user && activeProfile.id === user.id)

  // Synchronize viewedProfile when viewing own profile and ownProfile changes
  useEffect(() => {
    if (isViewingOwnProfile && ownProfile) {
      setViewedProfile(ownProfile)
    }
  }, [isViewingOwnProfile, ownProfile])

  const handleDirectAvatarFile = async (file: File): Promise<void> => {
    const validation = validateAvatarFile(file)
    if (!validation.valid) {
      setAvatarToast({ message: validation.error || 'Invalid image file.', type: 'error' })
      setTimeout(() => setAvatarToast(null), 4000)
      return
    }

    setIsUploadingAvatar(true)
    try {
      // uploadAvatar updates store profile optimistically in 0ms!
      await uploadAvatar(file)
      setAvatarToast({ message: 'Profile photo updated!', type: 'success' })
      setTimeout(() => setAvatarToast(null), 3000)
    } catch (err) {
      console.error('Failed to update avatar:', err)
      setAvatarToast({
        message: err instanceof Error ? err.message : 'Failed to update profile photo.',
        type: 'error'
      })
      setTimeout(() => setAvatarToast(null), 4000)
    } finally {
      setIsUploadingAvatar(false)
    }
  }

  // Ctrl+V paste support directly on own profile
  useEffect(() => {
    if (!isOwnProfile || isEditing) return
    const onWindowPaste = (e: ClipboardEvent): void => {
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isInput) return

      if (!e.clipboardData) return
      const file = extractImageFromClipboard(e.clipboardData)
      if (file) {
        e.preventDefault()
        void handleDirectAvatarFile(file)
      }
    }
    window.addEventListener('paste', onWindowPaste)
    return () => window.removeEventListener('paste', onWindowPaste)
  }, [isOwnProfile, isEditing])

  const loadFriendRoom = async (profileId: string): Promise<ListeningRoom | null> => {
    const activeSince = new Date(Date.now() - 20_000).toISOString()
    const { data, error: roomError } = await getSupabase()
      .from('listening_rooms')
      .select('*')
      .eq('host_id', profileId)
      .eq('is_active', true)
      .eq('is_playing', true)
      .gte('updated_at', activeSince)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (roomError) throw roomError
    const nextRoom = (data as ListeningRoom | null) || null
    setFriendRoom(nextRoom)
    return nextRoom
  }

  const handlePlayProfileSong = async (song: ProfileSong) => {
    let localSong: Song | undefined
    try {
      const allSongs = (await window.api?.getSongs?.()) as Song[] | undefined
      if (allSongs && allSongs.length > 0) {
        localSong = findMatchingLibrarySong(song.title, song.artist, allSongs)
      }
    } catch {}

    if (localSong?.filePath) {
      void requestPlaySong(localSong)
      return
    }

    void requestPlaySong(song as Song)
  }

  const loadProfile = async (silent = false): Promise<void> => {
    if (!user || !ownProfile) return
    if (!silent) setLoading(true)
    setError('')
    try {
      let nextProfile = ownProfile
      if (username && username.toLowerCase() !== ownProfile.username.toLowerCase()) {
        const { data, error: profileError } = await getSupabase()
          .from('profiles')
          .select('*')
          .eq('username', username.toLowerCase())
          .maybeSingle()
        if (profileError) throw profileError
        if (!data) {
          setViewedProfile(null)
          setRelationship(null)
          setPlaylists([])
          setFriendRoom(null)
          return
        }
        nextProfile = data as OnlineProfile
      }
      const [relationshipsResult, playlistsResult] = await Promise.all([
        getSupabase()
          .from('friend_requests')
          .select('*')
          .or(`requester_id.eq.${nextProfile.id},addressee_id.eq.${nextProfile.id}`),
        getSupabase().from('shared_playlists').select('*').order('updated_at', { ascending: false })
      ])
      if (relationshipsResult.error) throw relationshipsResult.error
      if (playlistsResult.error) throw playlistsResult.error
      const relationships = (relationshipsResult.data || []) as FriendRequest[]
      const pair = relationships.find(
        (request) =>
          request.requester_id === nextProfile.id || request.addressee_id === nextProfile.id
      )
      setViewedProfile(nextProfile)
      setRelationship(nextProfile.id === user.id ? null : pair || null)
      const accepted = relationships.filter((request) => request.status === 'accepted')
      setFollowerCount(accepted.filter((request) => request.addressee_id === nextProfile.id).length)
      setFollowingCount(
        accepted.filter((request) => request.requester_id === nextProfile.id).length
      )
      if (nextProfile.id === user.id) {
        const history = readListeningHistory()
        setRecentSongs(history.recent)
        setMostPlayed(history.mostPlayed)
        setMostPlayedArtists(history.artists)

        try {
          const allSongs = ((await window.api?.getSongs?.()) as Song[]) || []
          setTasteMetrics(PersonalizationService.calculateTasteMetrics(allSongs))
        } catch {
          setTasteMetrics(PersonalizationService.calculateTasteMetrics([]))
        }
      } else if (nextProfile.is_history_public !== false) {
        try {
          const [statsRes, eventsRes] = await Promise.all([
            getSupabase().rpc('get_user_listening_stats', { target_user_id: nextProfile.id }),
            getSupabase()
              .from('user_play_events')
              .select('*')
              .eq('user_id', nextProfile.id)
              .order('played_at', { ascending: false })
              .limit(25)
          ])

          const stats = statsRes.data as UserListeningStats | null
          const events = (eventsRes.data || []) as any[]

          const mappedRecent: ProfileSong[] = events.map((ev, i) => ({
            id: `recent-${ev.id || i}`,
            title: ev.track_title,
            artist: ev.artist_name,
            album: ev.album_name || '',
            artworkPath: ev.artwork_url || '',
            duration: ev.duration || 0,
            playCount: 1,
            lastPlayedAt: new Date(ev.played_at).getTime(),
            filePath: `virtual:${ev.track_title} - ${ev.artist_name}`
          }))

          const mappedTop: ProfileSong[] = (stats?.top_tracks || []).map((t: any, i: number) => ({
            id: `top-${nextProfile.id}-${i}`,
            title: t.title,
            artist: t.artist,
            album: t.album || '',
            artworkPath: t.artwork || '',
            duration: 0,
            playCount: t.play_count || 1,
            filePath: `virtual:${t.title} - ${t.artist}`
          }))

          setRecentSongs(mappedRecent)
          setMostPlayed(mappedTop)
          setMostPlayedArtists(
            (stats?.top_artists || []).map((a: any) => ({
              artist: a.artist,
              playCount: a.playCount ?? a.play_count ?? 1
            }))
          )

          // Calculate friend's taste metrics
          const friendTopArtists = (stats?.top_artists || []).map((a: any) => a.artist)
          const friendTimestamps = events
            .map((ev) => new Date(ev.played_at).getTime())
            .filter(Boolean)
          const friendMetrics = PersonalizationService.calculateTasteMetrics([], {
            totalPlays: stats?.total_plays || events.length,
            playTimestamps: friendTimestamps,
            topArtists: friendTopArtists,
            topGenres: (stats as any)?.top_genres || []
          })
          setTasteMetrics(friendMetrics)
        } catch (historyErr) {
          console.warn('Could not load remote listening history:', historyErr)
          setRecentSongs([])
          setMostPlayed([])
          setMostPlayedArtists([])
          setTasteMetrics(null)
        }
      } else {
        setRecentSongs([])
        setMostPlayed([])
        setMostPlayedArtists([])
        setTasteMetrics(null)
      }
      setPlaylists(
        ((playlistsResult.data || []) as SharedPlaylist[]).filter(
          (playlist) => playlist.owner_id === nextProfile.id
        )
      )
      if (nextProfile.id !== user.id) await loadFriendRoom(nextProfile.id)
      else setFriendRoom(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load profile.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const isFirstLoad = !viewedProfile && !activeProfile
    const timer = window.setTimeout(() => void loadProfile(!isFirstLoad), 0)
    return () => window.clearTimeout(timer)
  }, [username, user?.id, ownProfile?.updated_at, ownProfile?.avatar_url])

  useEffect(() => {
    if (!isOwnProfile) return
    const songs = [...mostPlayed, ...recentSongs]
    const uniqueSongs = Array.from(new Map(songs.map((song) => [song.id, song])).values())
    const songsNeedingArtwork = uniqueSongs.filter(
      (song) => !toMediaUrl(song.artworkPath) && !artworkBySongId[song.id]
    )
    if (songsNeedingArtwork.length === 0) return

    let cancelled = false
    void Promise.all(
      songsNeedingArtwork.map(async (song) => {
        try {
          const results = await window.api.searchAppleMusic(`${song.title} ${song.artist}`)
          const match = results?.Songs?.find((item: { thumbnail?: string }) => item.thumbnail)
          return match?.thumbnail ? { id: song.id, artwork: match.thumbnail } : null
        } catch (error) {
          console.warn(`Could not fetch artwork for ${song.title}:`, error)
          return null
        }
      })
    ).then((matches) => {
      if (cancelled) return
      const nextArtwork = matches.reduce<Record<string, string>>((result, match) => {
        if (match) result[match.id] = match.artwork
        return result
      }, {})
      if (Object.keys(nextArtwork).length > 0) {
        setArtworkBySongId((current) => ({ ...current, ...nextArtwork }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [artworkBySongId, isOwnProfile, mostPlayed, recentSongs])

  useEffect(() => {
    if (!isOwnProfile) return
    const refreshHistory = async (): Promise<void> => {
      const history = readListeningHistory()
      setRecentSongs(history.recent)
      setMostPlayed(history.mostPlayed)
      setMostPlayedArtists(history.artists)
      try {
        const allSongs = ((await window.api?.getSongs?.()) as Song[]) || []
        setTasteMetrics(PersonalizationService.calculateTasteMetrics(allSongs))
      } catch {}
    }
    window.addEventListener('felo:recently-played-updated', () => void refreshHistory())
    return () =>
      window.removeEventListener('felo:recently-played-updated', () => void refreshHistory())
  }, [isOwnProfile])

  useEffect(() => {
    if (!viewedProfile || isOwnProfile) return
    const supabase = getSupabase()
    const channel = supabase
      .channel(`profile-listening:${viewedProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_rooms',
          filter: `host_id=eq.${viewedProfile.id}`
        },
        () => void loadFriendRoom(viewedProfile.id).catch(() => setFriendRoom(null))
      )
      .subscribe()
    const timer = window.setInterval(
      () => void loadFriendRoom(viewedProfile.id).catch(() => setFriendRoom(null)),
      10_000
    )
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [isOwnProfile, viewedProfile?.id])

  const actionLabel = useMemo(() => {
    if (!relationship) return 'Add friend'
    if (relationship.status === 'accepted') return 'Remove friend'
    return relationship.addressee_id === user?.id ? 'Accept request' : 'Cancel request'
  }, [relationship, user?.id])

  const removeRelationship = async (): Promise<void> => {
    if (!relationship) return
    const { error: deleteError } = await getSupabase()
      .from('friend_requests')
      .delete()
      .eq('id', relationship.id)
    if (deleteError) throw deleteError
  }

  const runFriendAction = async (): Promise<void> => {
    if (!user || !viewedProfile || isOwnProfile) return
    setBusy(true)
    setError('')
    try {
      if (!relationship) {
        const { error: insertError } = await getSupabase()
          .from('friend_requests')
          .insert({ requester_id: user.id, addressee_id: viewedProfile.id, status: 'pending' })
        if (insertError) throw insertError
      } else if (relationship.status === 'pending' && relationship.addressee_id === user.id) {
        const { error: updateError } = await getSupabase()
          .from('friend_requests')
          .update({ status: 'accepted' })
          .eq('id', relationship.id)
        if (updateError) throw updateError
      } else {
        await removeRelationship()
      }
      await loadProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Friend action failed.')
    } finally {
      setBusy(false)
    }
  }

  const declineRequest = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await removeRelationship()
      await loadProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not decline request.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmRemoveFriend = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await removeRelationship()
      await loadProfile()
      setIsDeleteModalOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Friend action failed.')
    } finally {
      setBusy(false)
    }
  }

  const listenTogether = async (): Promise<void> => {
    if (!viewedProfile || relationship?.status !== 'accepted') return
    setJoining(true)
    setError('')
    try {
      await useListeningStore.getState().listenAlongWithFriend(viewedProfile.id)
      navigate('/listen-together')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join this listening session.')
    } finally {
      setJoining(false)
    }
  }

  if (loading)
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-text-muted" />
      </div>
    )
  const currentProfile = activeProfile || viewedProfile

  if (loading && !currentProfile)
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-text-muted" />
      </div>
    )
  if (!currentProfile) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center text-center">
        <UserRound className="h-12 w-12 text-text-muted" />
        <h1 className="mt-4 text-2xl font-black text-text">Profile not found</h1>
        <NavLink
          to="/profile"
          className="mt-5 rounded-full bg-text px-5 py-2.5 text-sm font-black text-canvas"
        >
          Back to your profile
        </NavLink>
      </div>
    )
  }

  return (
    <div className="h-full flex-1 overflow-y-auto bg-canvas">
      <header className="flex min-h-[240px] sm:min-h-[300px] items-end bg-gradient-to-b from-surface-elevated/80 to-canvas px-4 sm:px-10 pb-6 sm:pb-7 pt-6 sm:pt-12">
        <div className="flex min-w-0 flex-col items-center gap-4 sm:gap-6 sm:flex-row sm:items-end w-full sm:w-auto">
          {isOwnProfile ? (
            <div className="relative">
              <input
                ref={directAvatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    void handleDirectAvatarFile(file)
                  }
                  e.target.value = ''
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => directAvatarInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsAvatarDragging(true)
                }}
                onDragLeave={() => setIsAvatarDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsAvatarDragging(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) {
                    void handleDirectAvatarFile(file)
                  }
                }}
                title="Click or drag an image to change profile picture instantly"
                className={`group relative rounded-full focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer transition-all ${
                  isAvatarDragging ? 'ring-4 ring-primary-amber scale-105 shadow-xl' : ''
                }`}
              >
                <ProfileAvatar profile={currentProfile} large />
                <div
                  className={`absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/60 transition-opacity text-white text-xs font-bold gap-1 ${
                    isUploadingAvatar || isAvatarDragging
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {isUploadingAvatar ? (
                    <>
                      <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-white" />
                      <span className="text-[11px] font-bold">Updating...</span>
                    </>
                  ) : isAvatarDragging ? (
                    <>
                      <Upload className="h-6 w-6 sm:h-8 sm:w-8 animate-bounce text-primary-amber" />
                      <span className="text-[11px] font-bold text-primary-amber">Drop image</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-6 w-6 sm:h-8 sm:w-8" />
                      <span className="hidden sm:inline text-xs font-bold">Change</span>
                    </>
                  )}
                </div>
              </button>
              {avatarToast && (
                <div
                  className={`absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold shadow-lg animate-in fade-in zoom-in-95 z-20 ${
                    avatarToast.type === 'error'
                      ? 'bg-danger text-white'
                      : 'bg-emerald-600 text-white'
                  }`}
                >
                  {avatarToast.message}
                </div>
              )}
            </div>
          ) : (
            <ProfileAvatar profile={currentProfile} large />
          )}
          <div className="min-w-0 pb-2 text-center sm:text-left">
            <p className="text-xs sm:text-sm font-black text-white">Profile</p>
            <h1 className="mt-1 max-w-full break-words text-2xl sm:text-4xl md:text-6xl lg:text-7xl font-black text-white leading-tight tracking-tight">
              {currentProfile.display_name}
            </h1>
            {currentProfile.bio && (
              <p className="mt-2 sm:mt-3 max-w-2xl text-xs sm:text-sm text-white/75">
                {currentProfile.bio}
              </p>
            )}
            <p className="mt-3 sm:mt-4 text-xs sm:text-sm font-bold text-white/80">
              @{currentProfile.username} <span className="mx-1 text-white/40">•</span>{' '}
              {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
              <span className="mx-1 text-white/40">•</span>
              {followerCount} {followerCount === 1 ? 'follower' : 'followers'}
              <span className="mx-1 text-white/40">•</span>
              {followingCount} following
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-[420px] px-4 sm:px-10 py-4 sm:py-6 pb-36 sm:pb-12">
        <div className="flex min-h-12 items-center gap-3">
          {isOwnProfile ? (
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Edit profile"
                className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 text-xs sm:text-sm font-black text-text hover:bg-hover hover:border-white/40 transition-colors cursor-pointer"
              >
                <Settings className="h-4 w-4 text-text-muted" />
                <span>Edit Profile</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await signOut()
                    navigate('/')
                  } catch (err) {
                    console.error('Failed to sign out:', err)
                  }
                }}
                title="Sign out of your account"
                className="flex h-10 items-center gap-2 rounded-full bg-danger hover:bg-danger/90 px-4 text-xs sm:text-sm font-bold text-white transition-all shadow-sm cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (relationship?.status === 'accepted') {
                    setIsDeleteModalOpen(true)
                  } else {
                    void runFriendAction()
                  }
                }}
                className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-black disabled:opacity-50 ${relationship?.status === 'accepted' || (relationship?.status === 'pending' && relationship.requester_id === user?.id) ? 'border border-border text-text' : 'bg-white text-black hover:bg-white/90'}`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : relationship?.status === 'accepted' ? (
                  <UserMinus className="h-4 w-4" />
                ) : relationship?.status === 'pending' && relationship.requester_id === user?.id ? (
                  <Clock3 className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {actionLabel}
              </button>
              {relationship?.status === 'pending' && relationship.addressee_id === user?.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declineRequest()}
                  className="h-10 rounded-full border border-border px-5 text-sm font-black text-text-muted hover:text-text"
                >
                  Decline
                </button>
              )}
              {relationship?.status === 'accepted' && (
                <>
                  <button
                    type="button"
                    onClick={() => navigate(`/chat?friend=${encodeURIComponent(currentProfile.id)}`)}
                    className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface-elevated px-5 text-sm font-black text-text hover:bg-hover hover:border-white/40 transition-colors"
                  >
                    <MessageCircle className="h-4 w-4 text-text-muted" />
                    Message
                  </button>

                  {friendRoom ? (
                    <button
                      type="button"
                      disabled={joining}
                      onClick={() => void listenTogether()}
                      title={`Join ${currentProfile.display_name}'s room directly without code`}
                      className="flex h-10 items-center gap-2 rounded-full bg-emerald-400 hover:bg-emerald-300 px-5 text-sm font-black text-black transition-all shadow-sm"
                    >
                      {joining ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Radio className="h-4 w-4 animate-pulse" />
                      )}
                      <span>Room Ready • Join</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title={`${currentProfile.display_name} has not created a listening room yet`}
                      className="flex h-10 items-center gap-2 rounded-full bg-surface-elevated px-5 text-sm font-bold text-text-muted cursor-not-allowed opacity-60"
                    >
                      <Radio className="h-4 w-4" />
                      <span>No Active Room</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
        {!isOwnProfile && relationship?.status === 'accepted' && friendRoom?.song && (
          <div className="mt-4 flex max-w-xl items-center gap-3 border-y border-border/60 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-text-muted">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-text">{friendRoom.song.title}</p>
              <p className="truncate text-xs text-text-muted">
                {friendRoom.song.artist} · Playing now
              </p>
            </div>
          </div>
        )}
        {error && (
          <p className="mt-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
        )}
        {currentProfile &&
          (isOwnProfile || currentProfile.is_history_public !== false ? (
            <>
              {/* Taste Profile & Mini-Wrapped Banner */}
              {tasteMetrics && tasteMetrics.totalPlays > 0 && (
                <section className="mt-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-amber-400" />
                        <h2 className="text-2xl font-black text-text">Taste Profile</h2>
                      </div>
                      <p className="mt-1 text-sm text-text-muted">
                        {isOwnProfile
                          ? 'Your sonic personality and listening habits'
                          : `${currentProfile.display_name}'s sonic personality and listening habits`}
                      </p>
                    </div>
                    <span className="rounded-full border border-border/80 bg-surface-elevated/70 px-3 py-1 text-xs font-black tracking-wide text-white/90">
                      {tasteMetrics.listenerTier.title} · {tasteMetrics.listenerTier.badge}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {/* 1. Time Listened */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-gradient-to-br from-surface to-surface-elevated/60 p-4 transition-all hover:border-border">
                      <div className="flex items-center justify-between text-text-muted">
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Listening Time
                        </span>
                        <Clock className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div className="mt-4">
                        <div className="text-2xl font-black text-text">
                          {tasteMetrics.formattedTime}
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {tasteMetrics.totalPlays} total{' '}
                          {tasteMetrics.totalPlays === 1 ? 'play' : 'plays'} recorded
                        </p>
                      </div>
                    </div>

                    {/* 2. Sonic Chronotype */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-gradient-to-br from-surface to-surface-elevated/60 p-4 transition-all hover:border-border">
                      <div className="flex items-center justify-between text-text-muted">
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Sonic Chronotype
                        </span>
                        {tasteMetrics.chronotype.icon === 'night' ? (
                          <Moon className="h-4 w-4 text-indigo-400" />
                        ) : tasteMetrics.chronotype.icon === 'morning' ? (
                          <Sun className="h-4 w-4 text-amber-400" />
                        ) : tasteMetrics.chronotype.icon === 'afternoon' ? (
                          <Compass className="h-4 w-4 text-cyan-400" />
                        ) : (
                          <Clock3 className="h-4 w-4 text-purple-400" />
                        )}
                      </div>
                      <div className="mt-4">
                        <div className="text-lg font-black text-text">
                          {tasteMetrics.chronotype.label}
                        </div>
                        <p className="mt-1 text-xs text-text-muted line-clamp-2">
                          {tasteMetrics.chronotype.description}
                        </p>
                      </div>
                    </div>

                    {/* 3. Top Genres */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-gradient-to-br from-surface to-surface-elevated/60 p-4 transition-all hover:border-border">
                      <div className="flex items-center justify-between text-text-muted">
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Top Genres
                        </span>
                        <Music className="h-4 w-4 text-pink-400" />
                      </div>
                      <div className="mt-4">
                        {tasteMetrics.topGenres.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {tasteMetrics.topGenres.slice(0, 3).map((g) => (
                              <span
                                key={g}
                                className="rounded-md bg-white/5 border border-white/10 px-2 py-0.5 text-xs font-medium text-text"
                              >
                                {g}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm font-bold text-text-muted">Eclectic Mix</span>
                        )}
                        <p className="mt-2 text-xs text-text-muted">
                          Derived from listening preference
                        </p>
                      </div>
                    </div>

                    {/* 4. Top Artist / Identity */}
                    <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-gradient-to-br from-surface to-surface-elevated/60 p-4 transition-all hover:border-border">
                      <div className="flex items-center justify-between text-text-muted">
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Top Artist
                        </span>
                        <Award className="h-4 w-4 text-amber-400" />
                      </div>
                      <div className="mt-4">
                        <div className="truncate text-lg font-black text-text">
                          {tasteMetrics.topArtist || 'Diverse Catalog'}
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {tasteMetrics.listenerTier.title} ({tasteMetrics.listenerTier.badge})
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              <section className="mt-8">
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-text">Most played</h2>
                    <p className="mt-1 text-sm text-text-muted">
                      {isOwnProfile
                        ? 'Your personal listening favourites'
                        : `${currentProfile.display_name}'s listening favourites`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {isOwnProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryModalInitialTab('mostPlayed')
                          setShowHistoryModal(true)
                        }}
                        className="rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors"
                      >
                        View all history
                      </button>
                    )}
                    <Play className="h-5 w-5 text-text" />
                  </div>
                </div>
                {mostPlayed.length > 0 ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {mostPlayed.map((song, index) => (
                      <button
                        key={song.id}
                        type="button"
                        onClick={() => void handlePlayProfileSong(song)}
                        className="flex items-center gap-3 rounded-md bg-surface p-3 text-left hover:bg-hover"
                      >
                        <span className="w-5 text-center text-sm font-black text-text-muted">
                          {index + 1}
                        </span>
                        <SongArtwork
                          song={song}
                          fetchedArtwork={artworkBySongId[song.id]}
                          size="large"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-text">
                            {song.title}
                          </span>
                          <span className="block truncate text-xs text-text-muted">
                            {song.artist}
                          </span>
                        </span>
                        <span className="text-xs font-bold text-text-muted">
                          {song.playCount || 0} plays
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 rounded-md border border-border/60 px-4 py-6 text-sm text-text-muted">
                    {isOwnProfile
                      ? 'Play some music to build your favourites.'
                      : 'No listening data available yet.'}
                  </p>
                )}
              </section>

              <section className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <div className="flex items-end justify-between">
                    <div>
                      <h2 className="text-2xl font-black text-text">Recently played</h2>
                      <p className="mt-1 text-sm text-text-muted">
                        {isOwnProfile
                          ? 'The latest songs in your rotation'
                          : `Recent songs played by ${currentProfile.display_name}`}
                      </p>
                    </div>
                    {isOwnProfile && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setHistoryModalInitialTab('recent')
                            setShowHistoryModal(true)
                          }}
                          className="rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors"
                        >
                          Full history
                        </button>
                        <Clock3 className="h-5 w-5 text-text-muted" />
                      </div>
                    )}
                  </div>
                  <div className="mt-4 space-y-1">
                    {recentSongs.length > 0 ? (
                      recentSongs.map((song) => (
                        <div
                          key={song.id}
                          onClick={() => void handlePlayProfileSong(song)}
                          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-hover cursor-pointer"
                        >
                          <SongArtwork song={song} fetchedArtwork={artworkBySongId[song.id]} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-text">{song.title}</p>
                            <p className="truncate text-xs text-text-muted">{song.artist}</p>
                          </div>
                          <span className="text-xs text-text-muted">
                            {song.lastPlayedAt
                              ? new Date(
                                  song.lastPlayedAt < 10_000_000_000
                                    ? song.lastPlayedAt * 1000
                                    : song.lastPlayedAt
                                ).toLocaleDateString()
                              : ''}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="mt-4 text-sm text-text-muted">
                        {isOwnProfile ? 'Your recent songs will appear here.' : 'No recent songs.'}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-end justify-between">
                    <div>
                      <h2 className="text-2xl font-black text-text">Top artists</h2>
                      <p className="mt-1 text-sm text-text-muted">
                        {isOwnProfile
                          ? 'Artists you play most'
                          : `Artists ${currentProfile.display_name} plays most`}
                      </p>
                    </div>
                    {isOwnProfile && (
                      <button
                        type="button"
                        onClick={() => {
                          setHistoryModalInitialTab('artists')
                          setShowHistoryModal(true)
                        }}
                        className="rounded-full border border-border bg-surface-elevated px-3 py-1 text-xs font-bold text-text hover:bg-hover transition-colors"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <div className="mt-4 space-y-2">
                    {mostPlayedArtists.length > 0 ? (
                      mostPlayedArtists.map((item, index) => (
                        <div
                          key={item.artist}
                          className="flex items-center gap-3 rounded-md bg-surface px-3 py-3"
                        >
                          <span className="w-5 text-center text-sm font-black text-text-muted">
                            {index + 1}
                          </span>
                          <UserCheck className="h-5 w-5 text-text" />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">
                            {item.artist}
                          </span>
                          <span className="text-xs font-bold text-text-muted">
                            {item.playCount} plays
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="mt-4 text-sm text-text-muted">
                        {isOwnProfile
                          ? 'Your top artists will appear here.'
                          : 'No top artists yet.'}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="mt-10 rounded-2xl border border-border/50 bg-surface-elevated/20 p-8 text-center max-w-md mx-auto">
              <Clock3 className="h-10 w-10 text-text-muted mx-auto mb-3 opacity-60" />
              <h3 className="text-base font-bold text-text">Private Listening History</h3>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                {currentProfile.display_name} has chosen to keep their listening activity and top
                songs private.
              </p>
            </div>
          ))}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-black text-text">Playlists</h2>
              <p className="mt-1 text-sm text-text-muted">Playlists available to you</p>
            </div>
          </div>
          {playlists.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {playlists.slice(0, 5).map((playlist) => (
                <div
                  key={playlist.id}
                  onClick={() => {
                    if (playlist.source_local_playlist_id) {
                      navigate(`/playlists/${playlist.source_local_playlist_id}`)
                    }
                  }}
                  className={`group min-w-0 rounded-md bg-surface p-3 transition-colors hover:bg-hover ${playlist.source_local_playlist_id ? 'cursor-pointer' : ''}`}
                >
                  <div className="flex aspect-square items-center justify-center rounded-md bg-surface-elevated">
                    <ListMusic className="h-12 w-12 text-text-muted transition-colors group-hover:text-text" />
                  </div>
                  <p className="mt-3 truncate text-sm font-black text-text">{playlist.name}</p>
                  <p className="mt-1 truncate text-xs text-text-muted">
                    {playlist.description || `By ${currentProfile.display_name}`}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex min-h-40 flex-col items-center justify-center border-y border-border/60 text-center">
              <ListMusic className="h-8 w-8 text-text-muted" />
              <p className="mt-3 text-sm font-bold text-text-muted">No playlists are visible</p>
            </div>
          )}
        </section>
      </main>
      {isEditing && isOwnProfile && (
        <ProfileEditor
          key={currentProfile.updated_at || currentProfile.id}
          initialProfile={currentProfile}
          onClose={() => setIsEditing(false)}
        />
      )}
      {showHistoryModal && isOwnProfile && (
        <FullListeningHistoryModal
          initialTab={historyModalInitialTab}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
      <DeleteFriendModal
        isOpen={isDeleteModalOpen}
        friendName={viewedProfile?.display_name || viewedProfile?.username || 'Friend'}
        username={viewedProfile?.username}
        avatarUrl={viewedProfile?.avatar_url}
        isLoading={busy}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmRemoveFriend}
      />
    </div>
  )
}

export default function ProfilePage(): ReactElement {
  return (
    <OnlineGate>
      <ProfileWorkspace />
    </OnlineGate>
  )
}
