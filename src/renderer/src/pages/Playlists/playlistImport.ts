export interface ImportedTrack {
  title: string
  artist: string
  album?: string
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field.trim())
      field = ''
    } else if (character === '\n' && !quoted) {
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

function findColumn(headers: string[], candidates: string[], excluded: string[] = []): number {
  for (const candidate of candidates) {
    const exact = headers.findIndex((header) => header === candidate)
    if (exact >= 0) return exact
  }
  return headers.findIndex(
    (header) =>
      candidates.some((candidate) => header.includes(candidate)) &&
      !excluded.some((value) => header.includes(value))
  )
}

function parseCsv(text: string): ImportedTrack[] {
  const rows = parseCsvRows(text)
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const titleIndex = findColumn(
    headers,
    ['trackname', 'songname', 'tracktitle', 'title', 'song', 'track', 'name'],
    ['uri', 'url', 'id', 'preview']
  )
  const artistIndex = findColumn(
    headers,
    ['artistnames', 'artistname', 'artist', 'artists', 'author'],
    ['uri', 'url', 'id']
  )
  const albumIndex = findColumn(
    headers,
    ['albumname', 'albumtitle', 'album'],
    ['uri', 'url', 'id', 'image', 'artist']
  )
  if (titleIndex < 0) return []

  return rows
    .slice(1)
    .map((row) => ({
      title: row[titleIndex]?.trim() || '',
      artist: artistIndex >= 0 ? row[artistIndex]?.trim() || '' : '',
      album: albumIndex >= 0 ? row[albumIndex]?.trim() || '' : ''
    }))
    .filter((track) => track.title)
}

function parseJspf(text: string): ImportedTrack[] {
  try {
    const data = JSON.parse(text)
    const tracks = data?.playlist?.track || data?.tracks || []
    if (!Array.isArray(tracks)) return []
    return tracks
      .map((track: any) => ({
        title: String(track?.title || track?.name || '').trim(),
        artist: String(track?.creator || track?.artist || '').trim(),
        album: String(track?.album || '').trim()
      }))
      .filter((track: ImportedTrack) => track.title)
  } catch {
    return []
  }
}

function parseXml(text: string): ImportedTrack[] {
  const document = new DOMParser().parseFromString(text, 'text/xml')
  if (document.querySelector('parsererror')) return []
  const tracks = Array.from(document.querySelectorAll('track'))
    .map((track) => ({
      title: track.querySelector('title')?.textContent?.trim() || '',
      artist: track.querySelector('creator')?.textContent?.trim() || '',
      album: track.querySelector('album')?.textContent?.trim() || ''
    }))
    .filter((track) => track.title)
  if (tracks.length) return tracks

  return Array.from(document.querySelectorAll('dict > dict > dict'))
    .map((dictionary) => {
      const values = new Map<string, string>()
      dictionary.querySelectorAll(':scope > key').forEach((key) => {
        values.set(key.textContent || '', key.nextElementSibling?.textContent || '')
      })
      return {
        title: values.get('Name')?.trim() || '',
        artist: values.get('Artist')?.trim() || '',
        album: values.get('Album')?.trim() || ''
      }
    })
    .filter((track) => track.title)
}

function parseM3u(text: string): ImportedTrack[] {
  const tracks: ImportedTrack[] = []
  let pending = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF:')) {
      pending = line.slice(line.indexOf(',') + 1).trim()
      continue
    }
    if (line.startsWith('#')) continue

    const fallback = (line.split(/[\\/]/).pop() || line).replace(/\.[^/.]+$/, '')
    const label = pending || fallback
    const separator = label.indexOf(' - ')
    tracks.push({
      title: separator >= 0 ? label.slice(separator + 3).trim() : label,
      artist: separator >= 0 ? label.slice(0, separator).trim() : ''
    })
    pending = ''
  }
  return tracks.filter((track) => track.title)
}

export type PlaylistImportFormat = 'CSV' | 'JSPF' | 'XSPF' | 'XML' | 'M3U'

export function acceptedExtensions(format: PlaylistImportFormat): string {
  if (format === 'CSV') return '.csv,.txt'
  if (format === 'JSPF') return '.jspf,.json'
  if (format === 'XSPF') return '.xspf'
  if (format === 'XML') return '.xml'
  return '.m3u,.m3u8'
}

export function parsePlaylistFile(fileName: string, text: string): ImportedTrack[] {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension === 'jspf' || extension === 'json') return parseJspf(text)
  if (extension === 'xspf' || extension === 'xml') return parseXml(text)
  if (extension === 'm3u' || extension === 'm3u8') return parseM3u(text)
  return parseCsv(text)
}
