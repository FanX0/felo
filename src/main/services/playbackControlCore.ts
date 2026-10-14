export type LibraryTrack = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  filePath: string
}

export function safeSong(song: Omit<LibraryTrack, 'filePath'>) {
  return {
    id: String(song.id),
    title: String(song.title || 'Unknown title'),
    artist: String(song.artist || 'Unknown artist'),
    album: String(song.album || ''),
    duration: Number(song.duration || 0)
  }
}

export function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokenMatches(token: string, word: string): boolean {
  if (word.includes(token)) return true
  // Transliteration collapse (e.g. double consonants "hussein" -> "husein", "connor" -> "conor")
  const cToken = token.replace(/(.)\1+/g, '$1')
  const cWord = word.replace(/(.)\1+/g, '$1')
  if (cWord.includes(cToken)) return true
  return false
}

export function searchLibrary(
  songs: LibraryTrack[],
  query: string,
  artist: string,
  limit: number,
  available: (path: string) => boolean
) {
  const q = normalizeSearch(query)
  const a = normalizeSearch(artist)
  const tokens = q.split(' ').filter(Boolean)
  const matches = songs
    .flatMap((song) => {
      const title = normalizeSearch(song.title || '')
      const performer = normalizeSearch(song.artist || '')
      const combined = `${title} ${performer}`
      const text = `${combined} ${normalizeSearch(song.album || '')}`
      const textWords = text.split(' ').filter(Boolean)

      if (a && !tokenMatches(a, performer)) return []
      const allTokensMatch = tokens.every((token) =>
        textWords.some((word) => tokenMatches(token, word))
      )
      if (!allTokensMatch) return []

      const exact = Boolean(q) && (q === title || q === combined || q === `${performer} ${title}`)
      const score = exact ? 100 : q && title.includes(q) ? 80 : 50
      return [
        {
          ...safeSong(song),
          available: available(song.filePath),
          match: exact ? 'exact' : 'partial',
          score
        }
      ]
    })
    .sort(
      (left, right) =>
        Number(right.available) - Number(left.available) ||
        right.score - left.score ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
    )
  const playable = matches.filter((song) => song.available)
  const exact = playable.filter((song) => song.match === 'exact' || song.score >= 80)
  const suggestion = q
    ? exact.length === 1
      ? exact[0]
      : null
    : null
  return {
    results: matches.slice(0, limit).map(({ score: _score, ...song }) => song),
    total: matches.length,
    hasMore: matches.length > limit,
    suggestedSongId: suggestion?.id ?? null,
    selection: suggestion
      ? 'unique_match'
      : playable.length
        ? 'choose_from_results'
        : 'no_playable_matches'
  }
}

export function searchPlaylists(
  playlists: Array<{ id: string; name: string; songCount?: number }>,
  query: string,
  limit = 10
) {
  const q = normalizeSearch(query)
  const tokens = q.split(' ').filter(Boolean)
  const matches = playlists
    .flatMap((item) => {
      const name = normalizeSearch(item.name || '')
      if (tokens.length && !tokens.every((token) => name.includes(token))) return []
      const exact = Boolean(q) && q === name
      const score = exact ? 100 : q && name.includes(q) ? 80 : 50
      return [
        {
          id: String(item.id),
          name: String(item.name || 'Untitled Playlist'),
          songCount: Number(item.songCount || 0),
          match: exact ? 'exact' : 'partial',
          score
        }
      ]
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
    )
  const exact = matches.filter((item) => item.match === 'exact')
  const suggestion = q
    ? exact.length === 1
      ? exact[0]
      : matches.length === 1
        ? matches[0]
        : null
    : null
  return {
    results: matches.slice(0, limit).map(({ score: _score, ...item }) => item),
    total: matches.length,
    hasMore: matches.length > limit,
    suggestedPlaylistId: suggestion?.id ?? null,
    selection: suggestion
      ? 'unique_match'
      : matches.length
        ? 'choose_from_results'
        : 'no_matches'
  }
}

export function searchArtists(
  artists: Array<{ id: string; name: string; songCount?: number }>,
  query: string,
  limit = 10
) {
  const q = normalizeSearch(query)
  const tokens = q.split(' ').filter(Boolean)
  const matches = artists
    .flatMap((item) => {
      const name = normalizeSearch(item.name || '')
      if (tokens.length && !tokens.every((token) => name.includes(token))) return []
      const exact = Boolean(q) && q === name
      const score = exact ? 100 : q && name.includes(q) ? 80 : 50
      return [
        {
          id: String(item.id),
          name: String(item.name || 'Unknown Artist'),
          songCount: Number(item.songCount || 0),
          match: exact ? 'exact' : 'partial',
          score
        }
      ]
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
    )
  const exact = matches.filter((item) => item.match === 'exact')
  const suggestion = q
    ? exact.length === 1
      ? exact[0]
      : matches.length === 1
        ? matches[0]
        : null
    : null
  return {
    results: matches.slice(0, limit).map(({ score: _score, ...item }) => item),
    total: matches.length,
    hasMore: matches.length > limit,
    suggestedArtistId: suggestion?.id ?? null,
    selection: suggestion
      ? 'unique_match'
      : matches.length
        ? 'choose_from_results'
        : 'no_matches'
  }
}

export function searchAlbums(
  albums: Array<{ id: string; title: string; artist?: string; songCount?: number }>,
  query: string,
  limit = 10
) {
  const q = normalizeSearch(query)
  const tokens = q.split(' ').filter(Boolean)
  const matches = albums
    .flatMap((item) => {
      const title = normalizeSearch(item.title || '')
      const artist = normalizeSearch(item.artist || '')
      const combined = `${title} ${artist}`
      if (tokens.length && !tokens.every((token) => combined.includes(token))) return []
      const exact = Boolean(q) && (q === title || q === combined)
      const score = exact ? 100 : q && title.includes(q) ? 80 : 50
      return [
        {
          id: String(item.id),
          title: String(item.title || 'Untitled Album'),
          artist: String(item.artist || ''),
          songCount: Number(item.songCount || 0),
          match: exact ? 'exact' : 'partial',
          score
        }
      ]
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id)
    )
  const exact = matches.filter((item) => item.match === 'exact')
  const suggestion = q
    ? exact.length === 1
      ? exact[0]
      : matches.length === 1
        ? matches[0]
        : null
    : null
  return {
    results: matches.slice(0, limit).map(({ score: _score, ...item }) => item),
    total: matches.length,
    hasMore: matches.length > limit,
    suggestedAlbumId: suggestion?.id ?? null,
    selection: suggestion
      ? 'unique_match'
      : matches.length
        ? 'choose_from_results'
        : 'no_matches'
  }
}

// Cache the promise before dispatch so concurrent retries cannot skip two tracks.
export class CommandScheduler {
  private entries = new Map<
    string,
    { fingerprint: string; expires: number; result: Promise<unknown> }
  >()
  private tail: Promise<unknown> = Promise.resolve()
  private generation = 0
  private waiting = 0

  reset(): void {
    this.generation++
    this.entries.clear()
  }

  run(
    id: string,
    fingerprint: string,
    execute: (deadline: number) => Promise<unknown>,
    timeoutMs = 20_000
  ): Promise<any> {
    const now = Date.now()
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key)
    const previous = this.entries.get(id)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return Promise.reject(new Error('REQUEST_ID_CONFLICT'))
      return previous.result
    }
    if (this.waiting >= 8 || this.entries.size >= 256)
      return Promise.reject(new Error('PLAYER_BUSY'))
    const generation = this.generation
    const deadline = now + timeoutMs
    this.waiting++
    const result = this.tail
      .catch(() => undefined)
      .then(() => {
        if (generation !== this.generation) throw new Error('CONTROL_DISABLED')
        if (Date.now() >= deadline) throw new Error('COMMAND_EXPIRED')
        return execute(deadline)
      })
      .finally(() => {
        this.waiting--
      })
    this.entries.set(id, { fingerprint, expires: now + 60_000, result })
    this.tail = result.catch(() => undefined)
    return result
  }
}
