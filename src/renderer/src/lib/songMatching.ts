/**
 * Normalizes text for reliable matching across streaming feeds and local library files.
 * Strips noise like '(Official Video)', '[HD]', '(Qobuz)', 'Unknown Artist', special punctuation, etc.
 */
export function normalizeForMatching(value?: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/\b(?:unknown\s+artist|various\s+artists|unknown)\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s*\(\d+\)\s*$/g, '')
    .replace(
      /\s+(?:official\s+(?:music\s+)?video|official\s+mv|official\s+audio|lyrics?\s+video|music\s+video|audio|lyrics|hd|4k|remastered|remaster)\s*$/gi,
      ''
    )
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Finds a matching downloaded song from the user's library.
 * Handles "Artist - Title" embedded titles, differing punctuation, subtitle variations,
 * and tracks downloaded from YouTube/Qobuz/Deezer/Soulseek.
 */
export function findMatchingLibrarySong<T extends { title?: string; artist?: string; filePath?: string }>(
  targetTitle: string,
  targetArtist: string,
  librarySongs: T[]
): T | undefined {
  if (!librarySongs || librarySongs.length === 0) return undefined

  const normTargetTitle = normalizeForMatching(targetTitle)
  const normTargetArtist = normalizeForMatching(targetArtist)
  if (!normTargetTitle) return undefined

  const targetFull = normalizeForMatching(`${targetArtist} ${targetTitle}`)
  const targetFullRev = normalizeForMatching(`${targetTitle} ${targetArtist}`)

  return librarySongs.find((song) => {
    if (!song?.filePath || String(song.filePath).startsWith('virtual:')) return false

    const normLocalTitle = normalizeForMatching(song.title || '')
    const normLocalArtist = normalizeForMatching(song.artist || '')
    if (!normLocalTitle) return false

    // 1. Exact match on normalized title & artist
    if (normLocalTitle === normTargetTitle) {
      if (!normTargetArtist || !normLocalArtist || normLocalArtist === normTargetArtist) {
        return true
      }
      if (normTargetArtist.includes(normLocalArtist) || normLocalArtist.includes(normTargetArtist)) {
        return true
      }
    }

    // 2. Full combined string match (handles "Artist - Title" stored in title field)
    const localFull = normalizeForMatching(`${song.artist || ''} ${song.title || ''}`)
    const localFullRev = normalizeForMatching(`${song.title || ''} ${song.artist || ''}`)

    if (
      localFull === targetFull ||
      localFull === targetFullRev ||
      localFullRev === targetFull ||
      localFullRev === targetFullRev
    ) {
      return true
    }

    // 3. Substring match when local title has the target title embedded (e.g. "Chase Atlantic - Swim")
    if (normTargetTitle.length >= 3 && normLocalTitle.includes(normTargetTitle)) {
      if (
        !normTargetArtist ||
        !normLocalArtist ||
        normLocalTitle.includes(normTargetArtist) ||
        normTargetArtist.includes(normLocalArtist) ||
        normLocalArtist.includes(normTargetArtist)
      ) {
        return true
      }
    }

    // 4. Reverse substring: target title contains local title
    if (normLocalTitle.length >= 3 && normTargetTitle.includes(normLocalTitle)) {
      if (
        !normTargetArtist ||
        !normLocalArtist ||
        normTargetTitle.includes(normLocalArtist) ||
        normTargetArtist === normLocalArtist
      ) {
        return true
      }
    }

    return false
  })
}

/**
 * Returns true if the song is already present in the user's library.
 */
export function isSongInLibrary(
  targetTitle: string,
  targetArtist: string,
  librarySongs: Array<{ title?: string; artist?: string; filePath?: string }>
): boolean {
  return Boolean(findMatchingLibrarySong(targetTitle, targetArtist, librarySongs))
}
