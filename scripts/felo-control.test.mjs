import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandScheduler, searchLibrary, searchPlaylists, searchArtists, searchAlbums } from '../src/main/services/playbackControlCore.ts'

const songs = [
  { id: 'a', title: 'Stay', artist: 'The Kid LAROI', album: 'One', duration: 140, filePath: 'a' },
  { id: 'b', title: 'Stay (Live)', artist: 'The Kid LAROI', album: 'Live', duration: 140, filePath: 'b' },
  { id: 'c', title: 'Stay', artist: 'Other Artist', album: 'Two', duration: 140, filePath: 'c' },
  { id: 'd', title: 'Déjà Vu', artist: 'Beyoncé', album: 'Three', duration: 140, filePath: 'd' },
]

test('combined title and artist search ranks exact playable song and hides paths', () => {
  const result = searchLibrary(songs, 'stay the kid laroi', '', 10, () => true)
  assert.equal(result.suggestedSongId, 'a')
  assert.equal(result.results[0].id, 'a')
  assert.ok(result.results.every((song) => !('filePath' in song)))
})
test('ambiguous exact titles stay ambiguous even with result limit one', () => {
  const result = searchLibrary(songs, 'stay', '', 1, () => true)
  assert.equal(result.suggestedSongId, null)
  assert.equal(result.total, 3)
  assert.equal(result.hasMore, true)
})
test('artist, punctuation, accents and missing files are handled', () => {
  assert.equal(searchLibrary(songs, 'DEJA-vu', 'beyonce', 10, () => true).suggestedSongId, 'd')
  assert.equal(searchLibrary(songs, 'stay', 'kid laroi', 10, () => true).suggestedSongId, 'a')
  assert.equal(searchLibrary(songs, 'deja vu', '', 10, () => false).selection, 'no_playable_matches')
  assert.equal(searchLibrary(songs, '', '', 10, () => true).suggestedSongId, null)
})
test('concurrent retry shares one execution and conflicting reuse fails', async () => {
  const scheduler = new CommandScheduler()
  let finish
  let calls = 0
  const execute = () => { calls++; return new Promise((resolve) => { finish = resolve }) }
  const first = scheduler.run('same', 'next', execute)
  const duplicate = scheduler.run('same', 'next', execute)
  assert.equal(first, duplicate)
  await assert.rejects(scheduler.run('same', 'pause', execute), /REQUEST_ID_CONFLICT/)
  await new Promise(setImmediate)
  finish({ ok: true })
  assert.deepEqual(await first, { ok: true })
  assert.equal(calls, 1)
  assert.deepEqual(await scheduler.run('same', 'next', execute), { ok: true })
  assert.equal(calls, 1)
})
test('commands execute in order and disabling cancels queued mutations', async () => {
  const scheduler = new CommandScheduler()
  const order = []
  let finish
  const first = scheduler.run('first', 'play', () => new Promise((resolve) => { order.push('play'); finish = resolve }))
  const second = scheduler.run('second', 'next', async () => { order.push('next') })
  const rejected = assert.rejects(second, /CONTROL_DISABLED/)
  await new Promise(setImmediate)
  assert.deepEqual(order, ['play'])
  scheduler.reset()
  finish({ ok: true })
  await first
  await rejected
  assert.deepEqual(order, ['play'])
  await scheduler.run('third', 'pause', async () => { order.push('pause') })
  assert.deepEqual(order, ['play', 'pause'])
})

test('playlist and artist search resolves unique matches accurately', () => {
  const playlists = [
    { id: 'p1', name: 'Chill Vibes', songCount: 20 },
    { id: 'p2', name: 'Workout Energy', songCount: 15 },
    { id: 'p3', name: 'Chill Evening', songCount: 8 }
  ]
  const pResult = searchPlaylists(playlists, 'workout energy')
  assert.equal(pResult.suggestedPlaylistId, 'p2')
  assert.equal(pResult.selection, 'unique_match')

  const ambiguous = searchPlaylists(playlists, 'chill')
  assert.equal(ambiguous.selection, 'choose_from_results')
  assert.equal(ambiguous.total, 2)

  const artists = [
    { id: 'ar1', name: 'The Weeknd', songCount: 10 },
    { id: 'ar2', name: 'Daft Punk', songCount: 5 }
  ]
  const arResult = searchArtists(artists, 'daft punk')
  assert.equal(arResult.suggestedArtistId, 'ar2')
  assert.equal(arResult.selection, 'unique_match')
})

test('node stdio mcp handler responds to initialize and tools/list', async () => {
  const { handleMessage, TOOLS } = await import('../resources/hermes/felo-control.mjs')
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
  assert.equal(init.result.protocolVersion, '2025-11-25')
  assert.equal(init.result.serverInfo.name, 'felo-control')

  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  assert.equal(list.result.tools.length, TOOLS.length)
  const toolNames = list.result.tools.map((t) => t.name)
  assert.ok(toolNames.includes('felo_play_playlist'))
  assert.ok(toolNames.includes('felo_play_collection'))
  assert.ok(toolNames.includes('felo_play_artist'))
  assert.ok(toolNames.includes('felo_play_album'))
})


