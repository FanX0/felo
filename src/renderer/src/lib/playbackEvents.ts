import { getSupabase } from './supabase'
import { toMediaUrl } from './media'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePrivateSessionStore } from '../hooks/usePrivateSessionStore'
import type { Song } from '../pages/Library/Library'
import {
  PLAYED_SONGS_STORAGE_KEY,
  PLAY_STATS_STORAGE_KEY,
  RECENTLY_PLAYED_STORAGE_KEY
} from './playbackConstants'

interface StoredPlayStats {
  playCount: number
  lastPlayedAt: number
}

/**
 * Checks whether listening events and history recording are permitted.
 * Returns false if Private Session is active or if Listening History is disabled in settings.
 */
export function isListeningHistoryAllowed(): boolean {
  const { isPrivateSession, listenHistoryEnabled } = usePrivateSessionStore.getState()
  return !isPrivateSession && listenHistoryEnabled
}

/**
 * Marks a song as recently played in the recent list (fires when playback starts).
 * Does NOT increment play count yet (play count requires 30s or 50% completion).
 */
export function markSongAsStarted(song: Song): void {
  if (!song?.id || !isListeningHistoryAllowed()) return
  try {
    const stored = JSON.parse(localStorage.getItem(RECENTLY_PLAYED_STORAGE_KEY) || '[]') as Song[]
    const next = [song, ...stored.filter((item) => item.id !== song.id)].slice(0, 500)
    localStorage.setItem(RECENTLY_PLAYED_STORAGE_KEY, JSON.stringify(next))

    const playedSongs = JSON.parse(
      localStorage.getItem(PLAYED_SONGS_STORAGE_KEY) || '{}'
    ) as Record<string, Song>
    playedSongs[song.id] = song
    localStorage.setItem(PLAYED_SONGS_STORAGE_KEY, JSON.stringify(playedSongs))

    window.dispatchEvent(new CustomEvent('felo:recently-played-updated'))
  } catch (error) {
    console.warn('Failed to update recently started song:', error)
  }
}

/**
 * Industry-standard scrobble record (fires when track played >= 30 seconds OR >= 50% of duration).
 * 1. Increments local play count in localStorage
 * 2. Persists to SQLite play_events & songs.playCount via window.api.recordPlay
 * 3. Syncs to Supabase user_play_events if user is authenticated
 */
export async function recordCertifiedScrobble(
  song: Song,
  durationSeconds: number,
  completedPercent = 1.0,
  contextType = 'library'
): Promise<void> {
  if (!song?.id || !isListeningHistoryAllowed()) return

  const now = Date.now()

  // 1. Update localStorage play stats (for instant UI reactivity)
  try {
    const stats = JSON.parse(localStorage.getItem(PLAY_STATS_STORAGE_KEY) || '{}') as Record<
      string,
      StoredPlayStats
    >
    const prev = stats[song.id] || { playCount: 0, lastPlayedAt: 0 }
    stats[song.id] = {
      playCount: prev.playCount + 1,
      lastPlayedAt: now
    }
    localStorage.setItem(PLAY_STATS_STORAGE_KEY, JSON.stringify(stats))
    window.dispatchEvent(new CustomEvent('felo:recently-played-updated'))
  } catch (err) {
    console.warn('Failed to update local play stats:', err)
  }

  // 2. Persist to local SQLite ledger
  try {
    if ((window.api as any)?.recordPlay) {
      await (window.api as any).recordPlay({
        songId: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: Math.round(durationSeconds),
        completedPercent: Math.min(1.0, Math.max(0, completedPercent)),
        startedAt: Math.floor((now - durationSeconds * 1000) / 1000),
        endedAt: Math.floor(now / 1000)
      })
    }
  } catch (err) {
    console.warn('SQLite play record error:', err)
  }

  // 3. Sync to Supabase user_play_events (Cloud Ledger)
  try {
    const user = useOnlineStore.getState().user
    if (user?.id) {
      const artwork = toMediaUrl(song.artworkPath) || (typeof song.artworkPath === 'string' && song.artworkPath.startsWith('http') ? song.artworkPath : null)
      await getSupabase().from('user_play_events').insert({
        user_id: user.id,
        track_title: song.title || 'Unknown Track',
        artist_name: song.artist || 'Unknown Artist',
        album_name: song.album || null,
        artwork_url: artwork,
        duration: Math.round(durationSeconds),
        completed_percent: Math.min(1.0, Math.max(0, completedPercent)),
        context_type: contextType,
        source: song.filePath?.startsWith('virtual:') ? 'online' : 'local'
      })
    }
  } catch (err) {
    // Silent fail if offline or network hiccup; local ledger is already safe
    console.warn('Supabase cloud scrobble error:', err)
  }
}
