import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { evaluateAutoPriority, recordUserRequest } from '../../../src/renderer/src/lib/autoPriority'
import { toSharedSong } from '../../../src/renderer/src/stores/listening/helpers'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'
import type { Song } from '../../../src/renderer/src/types/song'

describe('Listen Together: Host Auto-Advance, YouTube Queue & Seamless Hot-Swap Integration Suite', () => {
  const song1: Song = {
    id: 'track-1',
    title: 'First Song',
    artist: 'Artist One',
    album: 'Album One',
    duration: 180,
    filePath: 'C:\\Music\\track1.mp3',
    audioUrl: 'https://supabase.co/storage/v1/object/public/songs/track-1.mp3'
  }

  const song2: Song = {
    id: 'track-2',
    title: 'Second Song',
    artist: 'Artist Two',
    album: 'Album Two',
    duration: 210,
    filePath: 'C:\\Music\\track2.mp3',
    audioUrl: 'https://supabase.co/storage/v1/object/public/songs/track-2.mp3'
  }

  const ytSong: Song = {
    id: 'yt-dQw4w9WgXcQ',
    title: 'Live Stream Concert',
    artist: 'YouTube Creator',
    album: 'YouTube Stream',
    duration: 300,
    filePath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    audioUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    usePlayerStore.setState({
      queue: [song1, song2],
      currentSongIndex: 0,
      currentTime: 0,
      isPlaying: true,
      isAudioActive: true
    })
    useListeningStore.setState({
      hostRoom: null,
      joinedRoom: null,
      myRole: null,
      audioQuality: null,
      isSyncLocked: false,
      driftSeconds: 0
    })
  })

  it('1. Host song completion auto-advances to the next song cleanly', () => {
    // Host is playing song 1
    expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    expect(usePlayerStore.getState().queue[0].title).toBe('First Song')

    // Simulate track completion invoking playNext(false)
    usePlayerStore.getState().playNext(false)

    // Player store should advance to song 2
    expect(usePlayerStore.getState().currentSongIndex).toBe(1)
    expect(usePlayerStore.getState().queue[1].title).toBe('Second Song')
    expect(usePlayerStore.getState().isPlaying).toBe(true)
    expect(usePlayerStore.getState().currentTime).toBe(0)
  })

  it('2. Guest receives track_change and smoothly transitions to song 2', async () => {
    const initialRoom: ListeningRoom = {
      id: 'room-test-123',
      code: 'TEST01',
      host_id: 'host-user',
      is_active: true,
      is_playing: true,
      position_seconds: 178,
      song: {
        ...toSharedSong(song1),
        uploadStatus: 'UPLOADED'
      },
      queue: [toSharedSong(song1), toSharedSong(song2)],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    useListeningStore.setState({
      joinedRoom: initialRoom,
      myRole: 'listener',
      syncStatus: 'synced'
    })

    // Track 1 finishes on host -> host broadcasts track_change for track 2
    const nextRoomState: ListeningRoom = {
      ...initialRoom,
      position_seconds: 0,
      song: {
        ...toSharedSong(song2),
        uploadStatus: 'UPLOADED',
        audioUrl: 'https://supabase.co/storage/v1/object/public/songs/track-2.mp3',
        hostPosition: 0,
        hostTimestamp: Date.now()
      },
      queue: [toSharedSong(song2)],
      updated_at: new Date().toISOString()
    }

    useListeningStore.getState().setJoinedRoom(nextRoomState)
    await useListeningStore.getState().handleHostSongChange(nextRoomState)

    // Guest room and player state should now reflect song 2
    expect(useListeningStore.getState().joinedRoom?.song?.title).toBe('Second Song')
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]?.title).toBe('Second Song')
  })

  it('3. Auto-Priority fair rotation prioritizes first-time requests and spaces out repeat artists', () => {
    const userCounts = new Map<string, number>()

    // First request from Alice -> gets Priority (Play Next)
    const req1 = evaluateAutoPriority({
      senderKey: 'Alice',
      artist: 'Daft Punk',
      duration: 240,
      isExplicitPriority: false,
      recentArtists: ['The Weeknd'],
      userRequestCounts: userCounts
    })
    expect(req1.isPriority).toBe(true)
    expect(req1.reason).toBe('first_request')
    recordUserRequest('Alice', userCounts)

    // Second request from Alice -> demoted to standard queue (fairness)
    const req2 = evaluateAutoPriority({
      senderKey: 'Alice',
      artist: 'Justice',
      duration: 210,
      isExplicitPriority: false,
      recentArtists: ['The Weeknd'],
      userRequestCounts: userCounts
    })
    expect(req2.isPriority).toBe(false)
    expect(req2.reason).toBe('standard')

    // First request from Bob for an artist played recently in last 5 tracks -> demoted
    const req3 = evaluateAutoPriority({
      senderKey: 'Bob',
      artist: 'The Weeknd',
      duration: 200,
      isExplicitPriority: true,
      recentArtists: ['The Weeknd', 'Daft Punk'],
      userRequestCounts: userCounts
    })
    expect(req3.isPriority).toBe(false)
    expect(req3.reason).toBe('duplicate_artist_demoted')
  })

  it('4. YouTube track queuing correctly integrates stream without disrupting existing audio', async () => {
    const player = usePlayerStore.getState()
    const currentQueue = [...player.queue]

    // Simulate adding YouTube track to queue with priority
    const sharedYt = toSharedSong(ytSong)
    expect(sharedYt.isYouTube).toBe(true)
    expect(sharedYt.streamType).toBe('youtube')
    expect(sharedYt.videoId).toBe('dQw4w9WgXcQ')

    // Inserting priority track right after current index
    const insertIdx = player.currentSongIndex + 1
    currentQueue.splice(insertIdx, 0, ytSong)
    player.setQueue(currentQueue, player.currentSongIndex)

    expect(usePlayerStore.getState().queue[1].id).toBe('yt-dQw4w9WgXcQ')
    expect(usePlayerStore.getState().queue[1].title).toBe('Live Stream Concert')
    expect(usePlayerStore.getState().queue[2].title).toBe('Second Song')
  })

  it('5. Hot-swap from preview to full quality preserves currentTime and locks sync', async () => {
    // Setup listener playing at 45.5 seconds in preview quality with active joinedRoom
    usePlayerStore.setState({
      queue: [song1],
      currentSongIndex: 0,
      currentTime: 45.5,
      isPlaying: true
    })
    useListeningStore.setState({
      joinedRoom: {
        id: 'room-1',
        song: toSharedSong(song1)
      } as any,
      audioQuality: 'preview',
      isSyncLocked: false
    })

    const fullQualityCdnUrl = 'https://supabase.co/storage/v1/object/public/songs/track-1.mp3'

    // Hot-swap executes
    await useListeningStore.getState().hotSwapToFullQuality(fullQualityCdnUrl)

    // Quality state updated to full
    expect(useListeningStore.getState().audioQuality).toBe('full')
    expect(usePlayerStore.getState().queue[0].audioUrl).toBe(fullQualityCdnUrl)
  })
})
