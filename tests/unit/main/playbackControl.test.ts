import { describe, it, expect } from 'vitest'
import assert from 'node:assert/strict'
import {
  CommandScheduler,
  searchLibrary,
  searchPlaylists,
  searchArtists,
  type LibraryTrack
} from '../../../src/main/services/playbackControlCore'

describe('Main Process: playbackControlCore', () => {
  const songs: LibraryTrack[] = [
    { id: 'a', title: 'Stay', artist: 'The Kid LAROI', album: 'One', duration: 140, filePath: 'a' },
    { id: 'b', title: 'Stay (Live)', artist: 'The Kid LAROI', album: 'Live', duration: 140, filePath: 'b' },
    { id: 'c', title: 'Stay', artist: 'Other Artist', album: 'Two', duration: 140, filePath: 'c' },
    { id: 'd', title: 'Déjà Vu', artist: 'Beyoncé', album: 'Three', duration: 140, filePath: 'd' }
  ]

  describe('searchLibrary', () => {
    it('ranks exact playable song and strips filePath from output for safety', () => {
      const result = searchLibrary(songs, 'stay the kid laroi', '', 10, () => true)
      expect(result.suggestedSongId).toBe('a')
      expect(result.results[0].id).toBe('a')
      expect(result.results.every((song) => !('filePath' in song))).toBe(true)
    })

    it('retains ambiguity when multiple exact titles exist', () => {
      const result = searchLibrary(songs, 'stay', '', 1, () => true)
      expect(result.suggestedSongId).toBeNull()
      expect(result.total).toBe(3)
      expect(result.hasMore).toBe(true)
    })

    it('handles artist filter, accents, punctuation, and unplayable files', () => {
      expect(searchLibrary(songs, 'DEJA-vu', 'beyonce', 10, () => true).suggestedSongId).toBe('d')
      const stayRes = searchLibrary(songs, 'stay', 'kid laroi', 10, () => true)
      expect(stayRes.results[0].id).toBe('a')
      expect(searchLibrary(songs, 'deja vu', '', 10, () => false).selection).toBe('no_playable_matches')
      expect(searchLibrary(songs, '', '', 10, () => true).suggestedSongId).toBeNull()
    })
  })

  describe('CommandScheduler', () => {
    it('shares single execution for concurrent retry and rejects conflicting action reuse', async () => {
      const scheduler = new CommandScheduler()
      let finish: (val: any) => void = () => {}
      let calls = 0
      const execute = () => {
        calls++
        return new Promise((resolve) => {
          finish = resolve
        })
      }

      const first = scheduler.run('req-1', 'next', execute)
      const duplicate = scheduler.run('req-1', 'next', execute)
      expect(first).toBe(duplicate)

      await expect(scheduler.run('req-1', 'pause', execute)).rejects.toThrow(/REQUEST_ID_CONFLICT/)

      finish({ ok: true })
      expect(await first).toEqual({ ok: true })
      expect(calls).toBe(1)
    })

    it('executes in order and cancelling clears pending queue', async () => {
      const scheduler = new CommandScheduler()
      const order: string[] = []
      let finishFirst: (val: any) => void = () => {}

      const first = scheduler.run('first', 'play', () => {
        return new Promise((resolve) => {
          order.push('play')
          finishFirst = resolve
        })
      })

      const second = scheduler.run('second', 'next', async () => {
        order.push('next')
      })

      const rejected = assert.rejects(second, /CONTROL_DISABLED/)
      await new Promise((r) => setImmediate(r))
      expect(order).toEqual(['play'])

      scheduler.reset()
      finishFirst({ ok: true })

      await first
      await rejected
      expect(order).toEqual(['play'])
    })
  })

  describe('searchPlaylists and searchArtists', () => {
    it('resolves unique matching playlists accurately', () => {
      const playlists = [
        { id: 'p1', name: 'Chill Vibes', songCount: 20 },
        { id: 'p2', name: 'Workout Energy', songCount: 15 },
        { id: 'p3', name: 'Chill Evening', songCount: 8 }
      ]
      const pResult = searchPlaylists(playlists, 'workout energy')
      expect(pResult.suggestedPlaylistId).toBe('p2')
      expect(pResult.selection).toBe('unique_match')

      const ambiguous = searchPlaylists(playlists, 'chill')
      expect(ambiguous.selection).toBe('choose_from_results')
      expect(ambiguous.total).toBe(2)
    })

    it('resolves unique matching artists', () => {
      const artists = [
        { id: 'ar1', name: 'The Weeknd', songCount: 10 },
        { id: 'ar2', name: 'Daft Punk', songCount: 5 }
      ]
      const arResult = searchArtists(artists, 'daft punk')
      expect(arResult.suggestedArtistId).toBe('ar2')
      expect(arResult.selection).toBe('unique_match')
    })
  })

  describe('MCP Room & Listen Together tools', () => {
    it('defines all room management tools in felo-control tool registry', async () => {
      const { TOOLS } = await import('../../../resources/hermes/felo-control.mjs')
      const toolNames = TOOLS.map((t: any) => t.name)

      expect(toolNames).toContain('felo_create_room')
      expect(toolNames).toContain('felo_join_room')
      expect(toolNames).toContain('felo_join_friend')
      expect(toolNames).toContain('felo_leave_room')
      expect(toolNames).toContain('felo_room_status')

      const createTool = TOOLS.find((t: any) => t.name === 'felo_create_room')
      expect(createTool?.inputSchema?.properties?.name).toBeDefined()
      expect(createTool?.inputSchema?.properties?.is_private).toBeDefined()
      expect(createTool?.inputSchema?.properties?.force_new).toBeDefined()

      const joinRoomTool = TOOLS.find((t: any) => t.name === 'felo_join_room')
      expect(joinRoomTool?.inputSchema?.required).toContain('code')

      const joinFriendTool = TOOLS.find((t: any) => t.name === 'felo_join_friend')
      expect(joinFriendTool?.inputSchema?.properties?.friend_name).toBeDefined()
    })
  })
})

