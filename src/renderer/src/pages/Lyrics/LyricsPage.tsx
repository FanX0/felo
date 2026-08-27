import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@uimaxbai/am-lyrics/am-lyrics.js'
import { Languages, ListMusic, Music2, Sparkles } from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'

interface ParsedLyric {
  time: number
  text: string
}

interface LyricsData {
  plainLyrics: string
  syncedLyrics: ParsedLyric[]
  rawSyncedLyrics: string
  instrumental?: boolean
}

type AmLyricsElement = HTMLElement & {
  query?: string
  ttml?: string
  songTitle?: string
  songArtist?: string
  songAlbum?: string
  songDurationMs?: number
  currentTime: number
  showRomanization: boolean
  showTranslation: boolean
  requestUpdate?: () => void
}

const AmLyricsTag = 'am-lyrics' as any

const TRANSLATION_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'th', label: 'Thai' }
]

function cleanMetadata(value: string) {
  let cleaned = value
    .normalize('NFKC')
    .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
    .replace(/^\s*\d{1,3}[.\-_)]+\s*/, '')
    .replace(
      /\s*[\[(]\s*(?:youtube|explicit|official(?:\s*(?:music|lyric|lyrics)?\s*(?:video|audio|mv)?)?|lyrics?(?:\s*video)?|remaster(?:ed)?(?:\s*[\d\w]+)?|hq|hd|visualizer|audio|video|mv|copyright[\s-]*free|feat\.?.*?|ft\.?.*?|single\s*version|bonus\s*track|deluxe(?:\s*edition)?|live(?:\s*at\s*.*)?|\d+)\s*[\])]\s*/gi,
      ' '
    )
    .replace(/\s+(?:official\s*)?(?:music\s*)?(?:lyric(?:s)?\s*)?(?:video|audio|mv)\s*$/gi, '')
    .replace(/\s+no\.\s*\d+\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  let previous = ''
  while (cleaned !== previous) {
    previous = cleaned
    cleaned = cleaned.replace(/\s*[\[(]\s*(?:youtube|\d+)\s*[\])]\s*$/gi, '').trim()
  }
  return cleaned
}

function isPlaceholderMetadata(value?: string) {
  return /^(?:unknown|untitled|n\/?a|none|null)(?:\s+(?:artist|album|track))?$/i.test(
    value?.trim() || ''
  )
}

function resolveSongMetadata(song?: { title: string; artist: string; album?: string }) {
  let title = cleanMetadata(song?.title || '')
  let artist = isPlaceholderMetadata(song?.artist) ? '' : cleanMetadata(song?.artist || '')
  const album = isPlaceholderMetadata(song?.album) ? '' : cleanMetadata(song?.album || '')

  const titleParts = title.match(/^(.+?)\s+[-\u2013\u2014|]\s+(.+)$/)
  if (titleParts) {
    const inferredArtist = cleanMetadata(titleParts[1])
    const inferredTitle = cleanMetadata(titleParts[2])
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
    const knownArtist = normalize(artist)
    const titleArtist = normalize(inferredArtist)
    const titleContainsKnownArtist =
      knownArtist &&
      (knownArtist === titleArtist ||
        knownArtist.includes(titleArtist) ||
        titleArtist.includes(knownArtist))

    if (!artist || titleContainsKnownArtist) {
      artist = artist || inferredArtist
      title = inferredTitle
    }
  }

  return { title, artist, album }
}

function parseSyncedLyrics(lrc: string): ParsedLyric[] {
  return lrc
    .split('\n')
    .flatMap((line) => {
      const timestamps = [...line.matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)]
      const text = line.replace(/\[[^\]]+\]/g, '').trim()
      if (timestamps.length === 0 || !text) return []

      return timestamps.map((match) => {
        const minutes = Number(match[1])
        const seconds = Number(match[2])
        const millis = Number((match[3] || '0').padEnd(3, '0'))
        return {
          time: minutes * 60 + seconds + millis / 1000,
          text
        }
      })
    })
    .sort((a, b) => a.time - b.time)
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatTtmlTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(3).padStart(6, '0')}`
}

function lyricsToTtml(
  lines: ParsedLyric[],
  plainLyrics: string,
  duration?: number,
  translations: string[] = [],
  romanizations: string[] = [],
  translationLanguage = 'en'
) {
  const parsedLines =
    lines.length > 0
      ? lines
      : plainLyrics
          .split('\n')
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text, index, allLines) => ({
            time:
              duration && duration > 0
                ? (index * duration) / Math.max(allLines.length, 1)
                : index * 4,
            text
          }))

  if (parsedLines.length === 0) return ''

  const translationMetadata = translations.length
    ? `
          <translations>
            <translation lang="${escapeXml(translationLanguage)}">
${translations
  .map((text, index) => `              <text for="line-${index}">${escapeXml(text)}</text>`)
  .join('\n')}
            </translation>
          </translations>`
    : ''
  const romanizationMetadata = romanizations.length
    ? `
          <transliterations>
            <transliteration lang="Latn">
${romanizations
  .map((text, index) => `              <text for="line-${index}">${escapeXml(text)}</text>`)
  .join('\n')}
            </transliteration>
          </transliterations>`
    : ''
  const metadata =
    translationMetadata || romanizationMetadata
      ? `
  <head>
    <metadata>
      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">${translationMetadata}${romanizationMetadata}
      </iTunesMetadata>
    </metadata>
  </head>`
      : ''

  const body = parsedLines
    .map((line, index) => {
      const nextTime = parsedLines[index + 1]?.time
      const finalEnd = duration && duration > line.time ? duration : line.time + 5
      const endTime = nextTime && nextTime > line.time ? nextTime : finalEnd
      return `        <p itunes:key="line-${index}" begin="${formatTtmlTime(line.time)}" end="${formatTtmlTime(endTime)}">${escapeXml(line.text)}</p>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
${metadata}
  <body>
    <div>
${body}
    </div>
  </body>
</tt>`
}

function getStoredMode() {
  const stored =
    localStorage.getItem('felo_lyrics_engine') || localStorage.getItem('fanx_lyrics_engine')
  if (stored) localStorage.setItem('felo_lyrics_engine', stored)
  return stored === 'am' || stored === 'classic' ? stored : 'classic'
}

function containsNonLatinLetters(lines: string[]) {
  return lines.some((line) =>
    [...line].some(
      (character) => /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)
    )
  )
}

function ClassicLyricsDisplay({
  lyrics,
  plainLyrics,
  currentTime,
  onSeek,
  translations,
  romanizations
}: {
  lyrics: ParsedLyric[]
  plainLyrics: string
  currentTime: number
  onSeek: (time: number) => void
  translations: string[]
  romanizations: string[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  const currentIndex = useMemo(() => {
    if (lyrics.length === 0) return -1
    let index = -1
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= currentTime) index = i
      else break
    }
    return index
  }, [lyrics, currentTime])

  useEffect(() => {
    if (!containerRef.current || !activeRef.current) return
    const container = containerRef.current
    const active = activeRef.current
    const top = active.offsetTop - container.clientHeight * 0.38 + active.clientHeight / 2
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [currentIndex])

  const plainLines = useMemo(
    () => plainLyrics.split('\n').filter((line) => line.trim().length > 0),
    [plainLyrics]
  )

  if (lyrics.length === 0 && plainLines.length === 0) {
    return (
      <div className="relative z-10 flex h-full items-center justify-center text-center text-white/65">
        <div className="flex flex-col items-center gap-4">
          <Music2 className="h-16 w-16 opacity-50" />
          <p className="text-xl font-bold">No lyrics available for this song.</p>
          <p className="text-sm">Try another track or switch to AM Style.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative z-10 h-full overflow-y-auto px-10 [scrollbar-width:none]"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col gap-7 py-[36vh] text-left">
        {lyrics.length > 0
          ? lyrics.map((line, index) => {
              const isActive = index === currentIndex
              const isPast = index < currentIndex
              const translation = translations[index]
              const romanization = romanizations[index]
              const showTranslation =
                translation && translation.trim().toLowerCase() !== line.text.trim().toLowerCase()
              const showRomanization =
                romanization && romanization.trim().toLowerCase() !== line.text.trim().toLowerCase()

              return (
                <button
                  key={`${line.time}-${index}`}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onSeek(line.time)}
                  className={`block w-full origin-left text-left font-black leading-[1.25] tracking-normal transition-all duration-700 ${
                    isActive
                      ? 'scale-[1.03] text-white blur-0 drop-shadow-[0_5px_28px_rgba(255,255,255,0.28)]'
                      : isPast
                        ? 'scale-[0.97] text-white/28 blur-[1.2px] hover:text-white/80 hover:blur-0'
                        : 'scale-[0.98] text-white/38 blur-[0.8px] hover:text-white/80 hover:blur-0'
                  }`}
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)' }}
                >
                  <span>{line.text}</span>
                  {showRomanization && (
                    <span className="mt-2 block text-[0.55em] font-semibold text-white/70">
                      {romanization}
                    </span>
                  )}
                  {showTranslation && (
                    <span className="mt-2 block text-[0.55em] font-semibold text-white/55">
                      {translation}
                    </span>
                  )}
                </button>
              )
            })
          : plainLines.map((line, index) => (
              <div
                key={`${line}-${index}`}
                className="text-left font-black leading-[1.35] tracking-normal text-white/70 transition-colors hover:text-white"
                style={{ fontSize: 'clamp(2rem, 3.7vw, 3.1rem)' }}
              >
                <div>{line}</div>
                {romanizations[index] && romanizations[index] !== line && (
                  <div className="mt-2 text-[0.55em] font-semibold text-white/65">
                    {romanizations[index]}
                  </div>
                )}
                {translations[index] && translations[index] !== line && (
                  <div className="mt-2 text-[0.55em] font-semibold text-white/50">
                    {translations[index]}
                  </div>
                )}
              </div>
            ))}
      </div>
    </div>
  )
}

export default function LyricsPage() {
  const { queue, currentSongIndex, currentTime, duration, seek } = usePlayerStore()
  const currentSong = queue[currentSongIndex]
  const [lyricsEngine, setLyricsEngine] = useState<'am' | 'classic'>(getStoredMode)
  const [lyricsData, setLyricsData] = useState<LyricsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [translationLang, setTranslationLang] = useState('en')
  const [isTranslationOpen, setIsTranslationOpen] = useState(false)
  const [translations, setTranslations] = useState<string[]>([])
  const [isTranslating, setIsTranslating] = useState(false)
  const [romanizations, setRomanizations] = useState<string[]>([])
  const [isRomanized, setIsRomanized] = useState(false)
  const [isRomanizing, setIsRomanizing] = useState(false)
  const amLyricsRef = useRef<AmLyricsElement | null>(null)
  const translationMenuRef = useRef<HTMLDivElement>(null)
  const activeSongIdRef = useRef(currentSong?.id)
  activeSongIdRef.current = currentSong?.id

  const resolvedMetadata = useMemo(
    () => resolveSongMetadata(currentSong),
    [currentSong?.title, currentSong?.artist, currentSong?.album]
  )
  const lookupDuration = currentSong?.duration || (duration > 0 ? Math.round(duration) : undefined)
  const backgroundColor = '#683014'
  const searchQuery = resolvedMetadata.artist
    ? `${resolvedMetadata.artist} ${resolvedMetadata.title}`
    : resolvedMetadata.title

  const sourceLines = useMemo(() => {
    if (lyricsData?.syncedLyrics.length) return lyricsData.syncedLyrics.map((line) => line.text)
    return lyricsData?.plainLyrics.split('\n').filter((line) => line.trim()) || []
  }, [lyricsData])
  const canRomanize = useMemo(() => containsNonLatinLetters(sourceLines), [sourceLines])
  const amLyricsTtml = useMemo(
    () =>
      lyricsToTtml(
        lyricsData?.syncedLyrics || [],
        lyricsData?.plainLyrics || '',
        lookupDuration,
        translations,
        romanizations,
        translationLang
      ),
    [
      lyricsData?.rawSyncedLyrics,
      lyricsData?.plainLyrics,
      lookupDuration,
      translations,
      romanizations,
      translationLang
    ]
  )

  useEffect(() => {
    localStorage.setItem('felo_lyrics_engine', lyricsEngine)
  }, [lyricsEngine])

  useEffect(() => {
    if (!isTranslationOpen) return
    const handleClick = (event: MouseEvent) => {
      if (!translationMenuRef.current?.contains(event.target as Node)) {
        setIsTranslationOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isTranslationOpen])

  useEffect(() => {
    if (!currentSong) {
      setLyricsData(null)
      return
    }

    const controller = new AbortController()
    const loadLyrics = async () => {
      setIsLoading(true)
      setLyricsData(null)
      setTranslations([])
      setRomanizations([])
      setIsRomanized(false)

      try {
        const result = await window.api?.fetchLyrics?.({
          title: resolvedMetadata.title || currentSong.title,
          artist: resolvedMetadata.artist,
          album: resolvedMetadata.album,
          duration: lookupDuration
        })
        if (controller.signal.aborted) return
        if (!result) throw new Error('No lyrics found')

        setLyricsData({
          plainLyrics: result.plainLyrics || '',
          rawSyncedLyrics: result.syncedLyrics || '',
          syncedLyrics: parseSyncedLyrics(result.syncedLyrics || ''),
          instrumental: Boolean(result.instrumental)
        })
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn('Failed to load lyrics:', err)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadLyrics()
    return () => controller.abort()
  }, [
    currentSong?.id,
    resolvedMetadata.title,
    resolvedMetadata.artist,
    resolvedMetadata.album,
    lookupDuration
  ])

  useEffect(() => {
    const element = amLyricsRef.current
    if (!element || lyricsEngine !== 'am') return

    element.songTitle = resolvedMetadata.title || currentSong?.title
    element.songArtist = resolvedMetadata.artist || undefined
    element.songAlbum = resolvedMetadata.album || undefined
    element.songDurationMs = lookupDuration ? lookupDuration * 1000 : undefined
    element.query = amLyricsTtml ? undefined : searchQuery || undefined
    element.showTranslation = translations.length > 0
    element.showRomanization = isRomanized && romanizations.length > 0
    element.ttml = amLyricsTtml || undefined
    element.currentTime = currentTime * 1000
    element.requestUpdate?.()
  }, [
    lyricsEngine,
    currentSong?.id,
    currentSong?.title,
    resolvedMetadata.title,
    resolvedMetadata.artist,
    resolvedMetadata.album,
    lookupDuration,
    searchQuery,
    amLyricsTtml,
    translations.length,
    romanizations.length,
    isRomanized
  ])

  useEffect(() => {
    if (amLyricsRef.current) amLyricsRef.current.currentTime = currentTime * 1000
  }, [currentTime])

  const handleTranslate = useCallback(
    async (language: string) => {
      setIsTranslationOpen(false)
      if (sourceLines.length === 0) return

      const songId = currentSong?.id
      setIsTranslating(true)
      try {
        const translated = await window.api.translateLyrics(sourceLines, language)
        if (activeSongIdRef.current !== songId) return
        setTranslationLang(language)
        setTranslations(translated)
      } catch (err) {
        console.error('Translation failed:', err)
      } finally {
        setIsTranslating(false)
      }
    },
    [currentSong?.id, sourceLines]
  )

  const handleRomanize = useCallback(async () => {
    if (isRomanized) {
      setIsRomanized(false)
      return
    }
    if (!canRomanize || sourceLines.length === 0) return
    if (romanizations.length === sourceLines.length) {
      setIsRomanized(true)
      return
    }

    const songId = currentSong?.id
    setIsRomanizing(true)
    try {
      const romanized = await window.api.romanizeLyrics(sourceLines)
      if (activeSongIdRef.current !== songId) return
      setRomanizations(romanized)
      setIsRomanized(true)
    } catch (err) {
      console.error('Romanization failed:', err)
    } finally {
      setIsRomanizing(false)
    }
  }, [canRomanize, currentSong?.id, isRomanized, romanizations.length, sourceLines])

  if (!currentSong) {
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-canvas text-center text-text">
        <div className="flex flex-col items-center gap-4">
          <Music2 className="h-20 w-20 text-text-muted" />
          <h2 className="text-3xl font-black">No song playing</h2>
          <p className="text-text-muted">Select a track to view synced lyrics.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden" style={{ backgroundColor }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(255,255,255,0.08),transparent_30%),linear-gradient(to_bottom,rgba(0,0,0,0.08),rgba(0,0,0,0.2))]" />

      <div className="absolute right-7 top-5 z-20 flex items-center gap-3">
        <div className="flex rounded-[10px] border border-white/15 bg-white/10 p-0.5 shadow-lg backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setLyricsEngine('am')}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              lyricsEngine === 'am' ? 'bg-white/20 text-white' : 'text-white/65 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            AM Style
          </button>
          <button
            type="button"
            onClick={() => setLyricsEngine('classic')}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              lyricsEngine === 'classic'
                ? 'bg-white/20 text-white'
                : 'text-white/65 hover:text-white'
            }`}
          >
            <ListMusic className="h-3.5 w-3.5" />
            Classic
          </button>
        </div>

        <div ref={translationMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsTranslationOpen((value) => !value)}
            disabled={sourceLines.length === 0 || isTranslating}
            className="inline-flex items-center gap-2 rounded-[10px] border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white/80 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/16 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Languages className="h-4 w-4" />
            {isTranslating
              ? '...'
              : TRANSLATION_LANGUAGES.find(
                  (item) => item.code === translationLang
                )?.code.toUpperCase()}
          </button>
          {isTranslationOpen && (
            <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-white/15 bg-[#1c1c1e]/95 py-1 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
                Translate to
              </div>
              <button
                type="button"
                onClick={() => {
                  setTranslations([])
                  setIsTranslationOpen(false)
                }}
                className={`flex w-full items-center justify-between border-b border-white/10 px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${
                  translations.length === 0 ? 'font-bold text-white' : 'text-white/75'
                }`}
              >
                Original
                {translations.length === 0 && <span className="text-primary-amber">OK</span>}
              </button>
              {TRANSLATION_LANGUAGES.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => handleTranslate(language.code)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${
                    translationLang === language.code ? 'font-bold text-white' : 'text-white/75'
                  }`}
                >
                  {language.label}
                  {translations.length > 0 && translationLang === language.code && (
                    <span className="text-primary-amber">OK</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          title={canRomanize ? 'Romanize to Latin' : 'Lyrics already use Latin characters'}
          onClick={handleRomanize}
          disabled={!canRomanize || isRomanizing}
          className={`rounded-[10px] border border-white/15 px-3 py-2 text-sm font-black shadow-lg backdrop-blur-xl transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            isRomanized ? 'bg-white/25 text-white' : 'bg-white/10 text-white/75 hover:bg-white/16'
          }`}
        >
          {isRomanizing ? '...' : 'A/あ'}
        </button>
      </div>

      {isLoading ? (
        <div className="relative z-10 flex h-full items-center justify-center text-white">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-white" />
        </div>
      ) : (
        <>
          <div
            className={`relative z-10 mx-auto h-full max-w-[960px] items-center px-10 ${
              lyricsEngine === 'am' ? 'flex' : 'hidden'
            }`}
          >
            <AmLyricsTag
              key={`${currentSong.id}-${amLyricsTtml ? 'local' : 'remote'}`}
              ref={amLyricsRef}
              className="h-full w-full text-white"
              style={
                {
                  '--lyplus-font-size-base': '42px',
                  '--wipe-gradient-width': '0.75em'
                } as any
              }
            />
          </div>
          <div className={lyricsEngine === 'classic' ? 'h-full' : 'hidden'}>
            <ClassicLyricsDisplay
              lyrics={lyricsData?.syncedLyrics || []}
              plainLyrics={lyricsData?.plainLyrics || ''}
              currentTime={currentTime}
              onSeek={seek}
              translations={translations}
              romanizations={isRomanized ? romanizations : []}
            />
          </div>
        </>
      )}
    </div>
  )
}
