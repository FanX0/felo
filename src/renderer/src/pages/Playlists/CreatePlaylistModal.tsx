import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Apple,
  CheckCircle2,
  Disc3,
  Music2,
  Trash2,
  TvMinimalPlay,
  UploadCloud
} from 'lucide-react'
import { Song } from '../Library/Library'
import { Playlist } from './types'
import {
  acceptedExtensions,
  ImportedTrack,
  parsePlaylistFile,
  PlaylistImportFormat
} from './playlistImport'

type ImportSource = 'spotify' | 'apple' | 'youtube'

const formats: PlaylistImportFormat[] = ['CSV', 'JSPF', 'XSPF', 'XML', 'M3U']

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function CreatePlaylistModal({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (playlist: Playlist) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [activeFormat, setActiveFormat] = useState<PlaylistImportFormat>('CSV')
  const [source, setSource] = useState<ImportSource>('spotify')
  const [url, setUrl] = useState('')
  const [librarySongs, setLibrarySongs] = useState<Song[]>([])
  const [importedTracks, setImportedTracks] = useState<ImportedTrack[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api
      .getSongs()
      .then((songs) => setLibrarySongs(songs || []))
      .catch(console.error)
  }, [])

  const matchedSongs = useMemo(() => {
    const matched = new Map<string, Song>()
    for (const imported of importedTracks) {
      const title = normalize(imported.title)
      const artist = normalize(imported.artist)
      const song = librarySongs.find((candidate) => {
        if (normalize(candidate.title) !== title) return false
        const candidateArtist = normalize(candidate.artist || '')
        return (
          !artist ||
          !candidateArtist ||
          artist.includes(candidateArtist) ||
          candidateArtist.includes(artist)
        )
      })
      if (song) matched.set(song.id, song)
    }
    return [...matched.values()]
  }, [importedTracks, librarySongs])

  const processFile = async (file: File) => {
    const parsed = parsePlaylistFile(file.name, await file.text())
    if (!parsed.length) {
      setError('No valid tracks were found in this file.')
      return
    }
    setImportedTracks(parsed)
    setError('')
    if (!name.trim()) setName(file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' '))
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void processFile(file)
  }

  const fetchUrl = () => {
    if (!url.trim()) return
    setError(
      'Direct provider URL import requires an authenticated provider connection. Use an exported playlist file below.'
    )
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
        songIds: matchedSongs.map((song) => song.id)
      })
      onCreated(playlist)
    } catch (err) {
      console.error('Failed to create playlist:', err)
      setError('Could not create the playlist.')
    } finally {
      setIsSaving(false)
    }
  }

  const guidance = (() => {
    if (activeFormat !== 'CSV') {
      const descriptions: Record<Exclude<PlaylistImportFormat, 'CSV'>, string> = {
        JSPF: 'Import JSON Shareable Playlist Format files with title, artist, and album metadata.',
        XSPF: 'Import XML Shareable Playlist Format files exported by VLC and other media players.',
        XML: 'Import generic XML and iTunes XML playlist files.',
        M3U: 'Import M3U or M3U8 files. Extended track labels are used for local matching.'
      }
      return descriptions[activeFormat]
    }
    if (source === 'spotify')
      return 'Use Exportify to export your Spotify playlist into a .csv file.'
    if (source === 'apple')
      return 'Use TuneMyMusic to export your Apple Music playlist into a .csv file.'
    return 'Upload an exported YouTube Music CSV file.'
  })()

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
      onMouseDown={onClose}
    >
      <form
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[94vh] w-full max-w-[600px] overflow-y-auto rounded-lg border border-white/15 bg-[#111] p-7 text-white shadow-[0_24px_70px_rgba(0,0,0,0.85)]"
      >
        <h2 className="text-2xl font-black">Create Playlist</h2>

        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          placeholder="Playlist name"
          className="mt-6 h-14 w-full rounded-lg border border-white/20 bg-white/5 px-4 text-[16px] outline-none transition-shadow placeholder:text-[#8c95a3] focus:border-[#1ed760] focus:ring-1 focus:ring-[#1ed760]"
        />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Description (optional)"
          className="mt-5 min-h-[76px] w-full resize-y rounded-lg border border-white/15 bg-white/5 px-4 py-4 text-sm outline-none placeholder:text-[#8c95a3] focus:border-white/30"
        />

        <section className="mt-6 rounded-lg border border-white/10 bg-[#181818] p-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            {formats.map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => setActiveFormat(format)}
                className={`relative px-2 py-1 text-sm font-black ${activeFormat === format ? 'text-white after:absolute after:-bottom-4 after:left-1 after:right-1 after:h-0.5 after:bg-[#1ed760]' : 'text-[#8f99a9] hover:text-white'}`}
              >
                {format}
              </button>
            ))}
          </div>

          <h3 className="mt-5 text-sm font-bold">Import from {activeFormat}</h3>

          {activeFormat === 'CSV' && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <SourceButton
                active={source === 'spotify'}
                onClick={() => setSource('spotify')}
                icon={<Disc3 className="h-4 w-4" />}
                label="Spotify"
              />
              <SourceButton
                active={source === 'apple'}
                onClick={() => setSource('apple')}
                icon={<Apple className="h-4 w-4" />}
                label="Apple Music"
              />
              <SourceButton
                active={source === 'youtube'}
                onClick={() => setSource('youtube')}
                icon={<TvMinimalPlay className="h-4 w-4" />}
                label="YouTube Music"
              />
            </div>
          )}

          <div className="mt-4 flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-5 text-[#c2c7d0]">
            <Music2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1ed760]" />
            <span>
              {guidance}{' '}
              {activeFormat === 'CSV' && source !== 'youtube' && (
                <button
                  type="button"
                  onClick={() =>
                    void window.api.openExternal(
                      source === 'spotify'
                        ? 'https://exportify.app/'
                        : 'https://www.tunemymusic.com/transfer/spotify-to-apple-music'
                    )
                  }
                  className="font-bold text-[#1ed760] underline"
                >
                  Open exporter
                </button>
              )}
            </span>
          </div>

          {activeFormat === 'CSV' && (
            <div className="mt-4 flex gap-3">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={`Paste ${source === 'apple' ? 'Apple Music' : source === 'youtube' ? 'YouTube Music' : 'Spotify'} playlist URL...`}
                className="h-12 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-4 text-sm outline-none focus:border-[#1ed760]"
              />
              <button
                type="button"
                onClick={fetchUrl}
                disabled={!url.trim()}
                className="rounded-lg bg-[#18883f] px-6 font-black text-black transition-colors hover:bg-[#1ed760] disabled:opacity-40"
              >
                Fetch
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedExtensions(activeFormat)}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void processFile(file)
              event.target.value = ''
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`mt-5 flex h-36 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${isDragging ? 'border-[#1ed760] bg-[#1ed760]/10' : 'border-white/20 bg-white/[0.02] hover:border-[#1ed760]'}`}
          >
            <UploadCloud className="h-9 w-9 text-[#8f99a9]" />
            <span className="mt-3 text-sm font-bold">
              Drop your .{activeFormat.toLowerCase()} file here
            </span>
            <span className="mt-1 text-xs text-[#8f99a9]">or click to browse files</span>
          </button>

          {importedTracks.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-[#141414]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-sm">
                <span className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="h-4 w-4 text-[#1ed760]" />
                  {importedTracks.length} tracks imported, {matchedSongs.length} found locally
                </span>
                <button
                  type="button"
                  onClick={() => setImportedTracks([])}
                  className="text-xs font-bold text-[#8f99a9] hover:text-red-400"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {importedTracks.map((track, index) => (
                  <div
                    key={`${track.title}-${index}`}
                    className="flex h-12 items-center gap-3 border-b border-white/5 px-3 last:border-0"
                  >
                    <span className="w-6 text-right text-xs text-[#777]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{track.title}</div>
                      <div className="truncate text-xs text-[#8f99a9]">
                        {track.artist || 'Unknown Artist'}
                        {track.album ? ` • ${track.album}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Remove imported track"
                      onClick={() =>
                        setImportedTracks((tracks) =>
                          tracks.filter((_, trackIndex) => trackIndex !== index)
                        )
                      }
                      className="p-1 text-[#777] hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-white/10 pt-5 text-xs leading-5 text-[#8f99a9]">
            <strong className="text-[#b8c0cc]">Warning:</strong> Imported tracks are matched against
            your local library by title and artist. Unmatched tracks are not added automatically.
          </div>
        </section>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 px-6 py-2.5 font-bold hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isSaving}
            className="rounded-full bg-[#18883f] px-7 py-2.5 font-black text-black transition-colors hover:bg-[#1ed760] disabled:opacity-40"
          >
            {isSaving
              ? 'Saving...'
              : matchedSongs.length
                ? `Save (${matchedSongs.length} Songs)`
                : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function SourceButton({
  active,
  onClick,
  icon,
  label
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-12 items-center justify-center gap-2 rounded-lg border text-xs font-black transition-colors ${active ? 'border-[#1ed760] bg-[#1ed760]/10 text-[#1ed760]' : 'border-white/10 bg-[#242424] text-white hover:bg-[#303030]'}`}
    >
      {icon}
      {label}
    </button>
  )
}
