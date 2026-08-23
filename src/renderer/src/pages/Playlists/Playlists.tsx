import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Link,
  MoreVertical,
  Music2,
  Play,
  Plus,
  Search,
  Trash2,
  UploadCloud,
  Users,
  X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { toMediaUrl } from '../../lib/media'
import { Playlist } from './types'

export default function Playlists() {
  const navigate = useNavigate()
  const { setQueue } = usePlayerStore()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const loadPlaylists = async () => {
    try {
      setIsLoading(true)
      setError('')
      setPlaylists((await window.api.getPlaylists()) || [])
    } catch (err) {
      console.error('Failed to load playlists:', err)
      setError('Failed to load playlists.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadPlaylists()
  }, [])

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus()
  }, [isSearchOpen])

  const filteredPlaylists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return playlists
    return playlists.filter(
      (playlist) =>
        playlist.name.toLowerCase().includes(query) ||
        playlist.description?.toLowerCase().includes(query)
    )
  }, [playlists, searchQuery])

  const playPlaylist = async (playlistId: string) => {
    const playlist = (await window.api.getPlaylist(playlistId)) as Playlist | null
    if (playlist?.songs?.length) setQueue(playlist.songs, 0)
  }

  const deletePlaylist = async (playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!window.confirm(`Delete "${playlist?.name || 'this playlist'}"?`)) return
    await window.api.deletePlaylist(playlistId)
    setPlaylists((current) => current.filter((playlist) => playlist.id !== playlistId))
    setOpenMenuId(null)
  }

  return (
    <div className="h-full overflow-y-auto bg-[#121212] px-10 py-10 text-white">
      <header className="flex items-center justify-between gap-8 border-b border-white/10 pb-11">
        <div className="flex min-w-0 items-baseline gap-5">
          <h1 className="truncate text-[56px] font-black leading-none tracking-normal">
            Your Playlists
          </h1>
          <span className="shrink-0 text-[18px] text-[#c9d7f2]">
            {filteredPlaylists.length} playlists
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-5">
          <div
            className={`flex h-[52px] origin-right items-center overflow-hidden rounded-full bg-[#2a2a2a] transition-all duration-300 ${isSearchOpen ? 'w-[315px] px-4' : 'w-[52px]'}`}
          >
            <button
              type="button"
              title="Search playlists"
              onClick={() => setIsSearchOpen(true)}
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center text-[#b3b3b3] hover:text-white"
            >
              <Search className="h-5 w-5" />
            </button>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onBlur={() => !searchQuery && setIsSearchOpen(false)}
              placeholder="Search playlists..."
              className={`h-full min-w-0 flex-1 bg-transparent pr-3 text-[16px] text-white outline-none placeholder:text-[#bdbdbd] ${isSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            />
          </div>
          <button
            type="button"
            onClick={() => navigate('/shared-playlists')}
            className="flex h-[52px] items-center gap-3 rounded-full border border-white/15 px-6 text-[16px] font-black text-[#d8d8d8] transition-colors hover:border-white/35 hover:text-white"
          >
            <Users className="h-5 w-5" /> Online Playlists
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex h-[52px] items-center gap-3 rounded-full bg-[#2a2a2a] px-7 text-[17px] font-black transition-colors hover:bg-[#353535]"
          >
            <Plus className="h-5 w-5 stroke-[3]" /> Create Playlist
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex min-h-[360px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : error ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center gap-4 text-[#b3b3b3]">
          <p>{error}</p>
          <button
            onClick={() => void loadPlaylists()}
            className="rounded-full bg-white px-5 py-2 font-bold text-black"
          >
            Retry
          </button>
        </div>
      ) : filteredPlaylists.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,234px)] gap-x-8 gap-y-9 pt-16">
          {filteredPlaylists.map((playlist) => {
            const artworkUrl = toMediaUrl(playlist.artworkPath)
            return (
              <div
                key={playlist.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/playlists/${playlist.id}`)}
                onKeyDown={(event) =>
                  event.key === 'Enter' && navigate(`/playlists/${playlist.id}`)
                }
                className="group relative flex h-[317px] w-[234px] cursor-pointer flex-col rounded-lg bg-[#181818] p-5 text-left transition-colors hover:bg-[#282828]"
              >
                <div className="relative mb-5 flex h-[194px] w-[194px] items-center justify-center overflow-hidden rounded bg-[#242424] shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
                  {artworkUrl ? (
                    <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Music2 className="h-16 w-16 fill-[#5f5f5f] text-[#5f5f5f]" />
                  )}
                  {playlist.songCount > 0 && (
                    <button
                      type="button"
                      title={`Play ${playlist.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        void playPlaylist(playlist.id)
                      }}
                      className="absolute bottom-3 right-3 flex h-12 w-12 translate-y-2 items-center justify-center rounded-full bg-[#1ed760] text-black opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
                    >
                      <Play className="ml-0.5 h-5 w-5 fill-current" />
                    </button>
                  )}
                </div>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-black leading-6">{playlist.name}</h2>
                    <p className="mt-2 truncate text-[14px] font-medium text-[#b9c4d8]">
                      {playlist.songCount} {playlist.songCount === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                  <button
                    type="button"
                    title="Playlist options"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenMenuId((current) => (current === playlist.id ? null : playlist.id))
                    }}
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-[#b3b3b3] opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                </div>
                {openMenuId === playlist.id && (
                  <div className="absolute bottom-12 right-3 z-20 w-48 rounded-md border border-white/10 bg-[#282828] p-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void deletePlaylist(playlist.id)
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-red-400 hover:bg-white/10"
                    >
                      <Trash2 className="h-4 w-4" /> Delete playlist
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-[#b3b3b3]">
          <Music2 className="mb-5 h-14 w-14" />
          <h2 className="text-2xl font-black text-white">
            {searchQuery ? 'No playlists found' : 'Create your first playlist'}
          </h2>
          <p className="mt-2 text-sm">
            {searchQuery
              ? 'Try another playlist search.'
              : 'Collect songs into a playlist you can play anytime.'}
          </p>
          {!searchQuery && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-bold text-black"
            >
              <Plus className="h-4 w-4" /> Create Playlist
            </button>
          )}
        </div>
      )}

      {isCreateOpen && (
        <CreatePlaylistModal
          onClose={() => setIsCreateOpen(false)}
          onCreated={(playlist) => {
            setPlaylists((current) => [playlist, ...current])
            setIsCreateOpen(false)
            navigate(`/playlists/${playlist.id}`)
          }}
        />
      )}
    </div>
  )
}

type ImportTab = 'CSV' | 'JSPF' | 'XSPF' | 'XML' | 'M3U'
type ImportService = 'spotify' | 'apple' | 'youtube'

interface ImportedTrack {
  title: string
  artist: string
  album?: string
  coverArt?: string
  duration?: number
  matchedSongId?: string
}

function normalizeImportValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let index = 0; index < input.length; index++) {
    const character = input[index]
    const next = input[index + 1]
    if (character === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        index++
      } else {
        inQuotes = !inQuotes
      }
    } else if (character === ',' && !inQuotes) {
      row.push(field.trim())
      field = ''
    } else if (character === '\n' && !inQuotes) {
      row.push(field.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function findColumn(headers: string[], candidates: string[], avoid: string[] = []) {
  for (const candidate of candidates) {
    const exact = headers.findIndex((header) => header === candidate)
    if (exact >= 0) return exact
  }
  for (const candidate of candidates) {
    const partial = headers.findIndex(
      (header) => header.includes(candidate) && !avoid.some((item) => header.includes(item))
    )
    if (partial >= 0) return partial
  }
  return -1
}

function parseImportCSV(text: string): ImportedTrack[] {
  const rows = parseCSVRows(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const titleIndex = findColumn(
    headers,
    ['trackname', 'songname', 'tracktitle', 'title', 'song', 'track', 'name'],
    ['url', 'uri', 'id']
  )
  const artistIndex = findColumn(headers, ['artistnames', 'artistname', 'artist', 'artists'])
  const albumIndex = findColumn(headers, ['albumname', 'albumtitle', 'album'], ['image'])
  const coverIndex = findColumn(headers, [
    'albumimageurl',
    'imageurl',
    'coverarturl',
    'coverurl',
    'image'
  ])
  const durationIndex = findColumn(headers, ['trackdurationms', 'durationms', 'duration', 'length'])

  if (titleIndex < 0) return []

  return rows
    .slice(1)
    .map((row) => {
      const title = row[titleIndex]?.replace(/\\,/g, ',').trim() || ''
      const artist =
        artistIndex >= 0 && row[artistIndex]?.trim()
          ? row[artistIndex].replace(/\\,/g, ',').trim()
          : 'Unknown Artist'
      const rawDuration = durationIndex >= 0 ? Number(row[durationIndex]) : 0
      return {
        title,
        artist,
        album: albumIndex >= 0 ? row[albumIndex]?.trim() : '',
        coverArt: coverIndex >= 0 ? row[coverIndex]?.trim() : '',
        duration: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined
      }
    })
    .filter((track) => track.title)
}

function parseM3U(text: string): ImportedTrack[] {
  const tracks: ImportedTrack[] = []
  let pending: ImportedTrack | null = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#EXTINF:')) {
      const [, rest = ''] = trimmed.split(':')
      const comma = rest.indexOf(',')
      const label = comma >= 0 ? rest.slice(comma + 1).trim() : rest.trim()
      const [artist, title] = label.includes(' - ')
        ? label.split(' - ', 2)
        : ['Unknown Artist', label]
      pending = { title: title || label, artist: artist || 'Unknown Artist' }
    } else if (!trimmed.startsWith('#')) {
      if (pending?.title) {
        tracks.push(pending)
      } else {
        const filename =
          trimmed
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.[^.]+$/, '') || trimmed
        const [artist, title] = filename.includes(' - ')
          ? filename.split(' - ', 2)
          : ['Unknown Artist', filename]
        tracks.push({ title: title || filename, artist: artist || 'Unknown Artist' })
      }
      pending = null
    }
  }
  return tracks
}

function parseJSPF(text: string): ImportedTrack[] {
  try {
    const json = JSON.parse(text)
    const rawTracks = json?.playlist?.track || json?.tracks || []
    return rawTracks
      .map((track: any) => ({
        title: track.title || track.name || '',
        artist: track.creator || track.artist || 'Unknown Artist',
        album: track.album || '',
        coverArt: track.image || '',
        duration: typeof track.duration === 'number' ? track.duration : undefined
      }))
      .filter((track: ImportedTrack) => track.title)
  } catch {
    return []
  }
}

function parseXMLTracks(text: string): ImportedTrack[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'text/xml')
  const tracks: ImportedTrack[] = []

  doc.querySelectorAll('track').forEach((track) => {
    const title = track.querySelector('title')?.textContent?.trim() || ''
    const artist = track.querySelector('creator')?.textContent?.trim() || 'Unknown Artist'
    if (title) {
      tracks.push({
        title,
        artist,
        album: track.querySelector('album')?.textContent?.trim() || '',
        coverArt: track.querySelector('image')?.textContent?.trim() || ''
      })
    }
  })

  if (tracks.length) return tracks

  doc.querySelectorAll('dict > dict > dict').forEach((dict) => {
    let title = ''
    let artist = 'Unknown Artist'
    let album = ''
    dict.querySelectorAll('key').forEach((key) => {
      const value = key.nextElementSibling?.textContent?.trim() || ''
      if (key.textContent === 'Name') title = value
      if (key.textContent === 'Artist') artist = value
      if (key.textContent === 'Album') album = value
    })
    if (title) tracks.push({ title, artist, album })
  })

  return tracks
}

function parseImportFile(text: string, fileName: string): ImportedTrack[] {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'jspf' || extension === 'json') return parseJSPF(text)
  if (extension === 'xspf' || extension === 'xml') return parseXMLTracks(text)
  if (extension === 'm3u' || extension === 'm3u8') return parseM3U(text)
  return parseImportCSV(text)
}

function matchImportedTracks(
  importedTracks: ImportedTrack[],
  librarySongs: any[]
): ImportedTrack[] {
  return importedTracks.map((track) => {
    const title = normalizeImportValue(track.title)
    const artist = normalizeImportValue(track.artist)
    const match = librarySongs.find((song) => {
      const songTitle = normalizeImportValue(song.title || '')
      const songArtist = normalizeImportValue(song.artist || '')
      return (
        songTitle === title &&
        (songArtist === artist || songArtist.includes(artist) || artist.includes(songArtist))
      )
    })
    return { ...track, matchedSongId: match?.id }
  })
}

function formatImportDuration(duration?: number) {
  if (!duration) return ''
  const seconds = duration > 10000 ? Math.floor(duration / 1000) : Math.floor(duration)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function CreatePlaylistModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (playlist: Playlist) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [activeTab, setActiveTab] = useState<ImportTab>('CSV')
  const [selectedService, setSelectedService] = useState<ImportService>('spotify')
  const [urlInput, setUrlInput] = useState('')
  const [librarySongs, setLibrarySongs] = useState<any[]>([])
  const [importedTracks, setImportedTracks] = useState<ImportedTrack[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isFetchingUrl, setIsFetchingUrl] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api
      .getSongs()
      .then((songs) => setLibrarySongs(songs || []))
      .catch((err) => console.error('Failed to load songs for playlist import:', err))
  }, [])

  const matchedCount = importedTracks.filter((track) => track.matchedSongId).length

  const processFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseImportFile(String(reader.result || ''), file.name)
      if (!parsed.length) {
        setError('No valid tracks were found in that file.')
        return
      }
      setImportedTracks(matchImportedTracks(parsed, librarySongs))
      setError('')
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
    }
    reader.readAsText(file)
  }

  const fetchUrl = async () => {
    if (!urlInput.trim()) return
    try {
      setIsFetchingUrl(true)
      setError('')
      const metadata = await window.api.fetchPlaylistImportMetadata(urlInput.trim())
      if (metadata?.name && !name.trim()) setName(metadata.name)
      if (metadata?.description && !description.trim()) setDescription(metadata.description)
      if (Array.isArray(metadata?.tracks) && metadata.tracks.length) {
        setImportedTracks(matchImportedTracks(metadata.tracks as ImportedTrack[], librarySongs))
      } else {
        setError('Fetched playlist info. Upload an exported playlist file to import tracks.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch playlist URL.')
    } finally {
      setIsFetchingUrl(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    try {
      setIsSaving(true)
      setError('')
      const playlist = await window.api.createPlaylist({
        name,
        description,
        tracks: importedTracks.length ? importedTracks : undefined,
        songIds: importedTracks.length ? undefined : []
      })
      onCreated(playlist)
    } catch (err) {
      console.error('Failed to create playlist:', err)
      setError('Could not create the playlist.')
    } finally {
      setIsSaving(false)
    }
  }

  const acceptedExtensions =
    activeTab === 'CSV'
      ? '.csv,.txt'
      : activeTab === 'JSPF'
        ? '.jspf,.json'
        : activeTab === 'XSPF'
          ? '.xspf'
          : activeTab === 'XML'
            ? '.xml'
            : '.m3u,.m3u8'

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
      onMouseDown={onClose}
    >
      <form
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-[600px] overflow-y-auto rounded-[18px] border border-white/10 bg-[#121212] p-8 text-white shadow-2xl"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedExtensions}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) processFile(file)
            event.currentTarget.value = ''
          }}
        />

        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black">Create Playlist</h2>
          <button type="button" onClick={onClose} className="p-1 text-[#b3b3b3] hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-6 h-14 w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 text-[16px] text-white outline-none focus:border-[#1ed760] focus:ring-1 focus:ring-[#1ed760]"
          placeholder="Playlist name"
        />

        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="mt-5 w-full resize-none rounded-lg border border-white/15 bg-white/[0.04] p-4 text-[15px] text-white outline-none focus:border-white/30"
          placeholder="Description (optional)"
        />

        <section className="mt-7 rounded-xl border border-white/10 bg-[#181818] p-5">
          <div className="grid grid-cols-5 border-b border-white/10">
            {(['CSV', 'JSPF', 'XSPF', 'XML', 'M3U'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-black ${
                  activeTab === tab
                    ? 'border-b-2 border-[#1ed760] text-white'
                    : 'text-[#9ca3af] hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <h3 className="mt-5 text-sm font-black">Import from {activeTab}</h3>

          {activeTab === 'CSV' && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['spotify', 'Spotify'],
                  ['apple', 'Apple Music'],
                  ['youtube', 'YouTube Music']
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedService(id as ImportService)}
                    className={`rounded-lg border px-3 py-3 text-sm font-black ${
                      selectedService === id
                        ? 'border-[#1ed760] bg-[#1ed760]/15 text-[#1ed760]'
                        : 'border-white/10 bg-white/[0.04] text-white hover:bg-white/10'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[#d1d5db]">
                <ExternalLink className="h-4 w-4 shrink-0 text-[#1ed760]" />
                <span>
                  Spotify CSV works best from{' '}
                  <button
                    type="button"
                    onClick={() => void window.api.openExternal('https://exportify.app/')}
                    className="font-black text-[#1ed760] underline"
                  >
                    Exportify
                  </button>
                  . Apple Music and YouTube Music CSV exports are also accepted.
                </span>
              </div>

              <div className="mt-4 flex gap-3">
                <div className="relative flex-1">
                  <Link className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9ca3af]" />
                  <input
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    className="h-12 w-full rounded-lg border border-white/15 bg-white/[0.06] pl-11 pr-4 text-white outline-none focus:border-[#1ed760]"
                    placeholder="Paste Spotify playlist URL..."
                  />
                </div>
                <button
                  type="button"
                  onClick={fetchUrl}
                  disabled={!urlInput.trim() || isFetchingUrl}
                  className="rounded-lg bg-[#15883e] px-5 font-black text-black hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isFetchingUrl ? 'Fetching...' : 'Fetch'}
                </button>
              </div>
            </>
          )}

          {activeTab !== 'CSV' && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[#d1d5db]">
              <FileText className="h-4 w-4 shrink-0 text-[#1ed760]" />
              <span>
                Drop or browse a .{activeTab.toLowerCase()} file. Tracks are matched against your
                local library when the playlist is saved.
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragActive(true)
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragActive(false)
              const file = event.dataTransfer.files?.[0]
              if (file) processFile(file)
            }}
            className={`mt-5 flex h-36 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
              isDragActive
                ? 'border-[#1ed760] bg-[#1ed760]/10'
                : 'border-white/20 bg-white/[0.03] hover:border-[#1ed760]'
            }`}
          >
            <UploadCloud className="h-8 w-8 text-[#9ca3af]" />
            <span className="mt-3 font-black">Drop your {activeTab.toLowerCase()} file here</span>
            <span className="mt-1 text-sm text-[#9ca3af]">or click to browse files</span>
          </button>

          {importedTracks.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-[#141414]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-black">
                  <CheckCircle2 className="h-4 w-4 text-[#1ed760]" />
                  {importedTracks.length} tracks imported · {matchedCount} local matches
                </span>
                <button
                  type="button"
                  onClick={() => setImportedTracks([])}
                  className="text-xs font-black text-[#9ca3af] hover:text-red-400"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto">
                {importedTracks.map((track, index) => (
                  <div
                    key={`${track.title}-${index}`}
                    className="grid grid-cols-[28px_1fr_60px_28px] items-center gap-3 border-b border-white/[0.04] px-4 py-2 text-sm"
                  >
                    <span className="text-right text-[#9ca3af]">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate font-bold">{track.title}</div>
                      <div className="truncate text-xs text-[#9ca3af]">
                        {track.artist}
                        {track.album ? ` · ${track.album}` : ''}
                      </div>
                    </div>
                    <span className="text-xs text-[#9ca3af]">
                      {formatImportDuration(track.duration)}
                    </span>
                    <span
                      title={track.matchedSongId ? 'Matched local song' : 'No local match'}
                      className={`h-2.5 w-2.5 rounded-full ${
                        track.matchedSongId ? 'bg-[#1ed760]' : 'bg-[#6b7280]'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex gap-2 text-xs leading-5 text-[#aeb7c4]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1ed760]" />
              <p>
                {importedTracks.length > 0
                  ? `All ${importedTracks.length} tracks will be added to your playlist. ${
                      importedTracks.length - matchedCount > 0
                        ? `${importedTracks.length - matchedCount} tracks not yet in your local library can be downloaded directly from the playlist.`
                        : 'All tracks matched in your local library!'
                    }`
                  : 'Track matching uses your local library.'}
              </p>
            </div>
          </div>
        </section>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 px-7 py-3 font-black text-white hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isSaving}
            className="rounded-full bg-[#15883e] px-8 py-3 font-black text-black hover:bg-[#1ed760] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving
              ? 'Saving...'
              : importedTracks.length
                ? `Save (${importedTracks.length} Songs)`
                : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
