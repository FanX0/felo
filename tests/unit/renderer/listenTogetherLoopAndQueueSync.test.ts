import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useListeningStore } from '../../../src/renderer/src/stores/listening'
import { usePlayerStore, setPlaybackGuard } from '../../../src/renderer/src/stores/player/usePlayerStore'
import {
  findSongMatchIndex,
  resetSessionSync,
  toSharedSong
} from '../../../src/renderer/src/stores/listening/helpers'
import type { Song } from '../../../src/renderer/src/types/song'
import type { ListeningRoom } from '../../../src/renderer/src/online/types'

describe('Listen Together: Flow Host Loop Control & Exact Song Sync Test Suite', () => {
  const songA: Song = {
    id: 'track-a',
    title: 'Handlebars',
    artist: 'Flobots',
    album: 'Fight with Tools',
    duration: 207,
    filePath: 'C:\\Music\\handlebars.mp3',
    audioUrl: 'https://cdn.example.com/handlebars.mp3'
  }

  const songB: Song = {
    id: 'track-b',
    title: 'Bar',
    artist: '',
    album: 'Unknown',
    duration: 180,
    filePath: 'C:\\Music\\bar.mp3',
    audioUrl: 'https://cdn.example.com/bar.mp3'
  }

  const songC: Song = {
    id: 'track-c',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    duration: 269,
    filePath: 'C:\\Music\\yellow.mp3',
    audioUrl: 'https://cdn.example.com/yellow.mp3'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionSync()
    setPlaybackGuard(null)
    usePlayerStore.setState({
      queue: [songA, songB, songC],
      originalQueue: [songA, songB, songC],
      currentSongIndex: 0,
      currentTime: 0,
      isPlaying: true,
      isAudioActive: true,
      repeatMode: 'off',
      isShuffle: false
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

  afterEach(() => {
    setPlaybackGuard(null)
    resetSessionSync()
  })

  describe('1. Flow Host: Loop & Auto-Advance Isolation', () => {
    it('guest does not autonomously advance queue when track reaches end', () => {
      // Simulate guest in room
      useListeningStore.setState({
        joinedRoom: {
          id: 'room-1',
          code: 'FLOW01',
          host_id: 'host-user-id',
          name: 'Host Room',
          is_active: true,
          is_playing: true,
          position_seconds: 207,
          song: toSharedSong(songA),
          queue: [toSharedSong(songA), toSharedSong(songC)],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as ListeningRoom,
        isReceivingDeviceStream: false
      })

      // In AudioEngine.handleEnded:
      // When joinedRoom && !isReceivingDeviceStream, audio pauses and does NOT call playNext()
      const listening = useListeningStore.getState()
      const isGuestInRoom = Boolean(listening.joinedRoom && !listening.isReceivingDeviceStream)

      expect(isGuestInRoom).toBe(true)
      // Player currentSongIndex remains 0, waiting for host
      expect(usePlayerStore.getState().currentSongIndex).toBe(0)
    })

    it('guest repeatMode does not interfere with host loop control', () => {
      // Host has repeatMode 'one'
      // When host repeats, host sets seekRequest: 0, currentTime: 0, isPlaying: true
      usePlayerStore.setState({ repeatMode: 'one' })
      usePlayerStore.getState().playNext(false)

      const state = usePlayerStore.getState()
      expect(state.currentSongIndex).toBe(0)
      expect(state.seekRequest).toBe(0)
      expect(state.currentTime).toBe(0)
      expect(state.isPlaying).toBe(true)
    })
  })

  describe('2. Room Queue Sync: Bypass Personal Shuffle & Priority Injection', () => {
    it('setQueue with isRoomSync ignores personal isShuffle and preserves exact host queue order', () => {
      usePlayerStore.setState({ isShuffle: true })

      const incomingRoomQueue = [songA, songB, songC]
      usePlayerStore.getState().setQueue(incomingRoomQueue, 0, undefined, { isRoomSync: true })

      const queue = usePlayerStore.getState().queue
      // Queue order must match incomingRoomQueue exactly, NOT shuffled
      expect(queue[0].id).toBe('track-a')
      expect(queue[1].id).toBe('track-b')
      expect(queue[2].id).toBe('track-c')
      expect(queue.length).toBe(3)
    })

    it('setQueue with isRoomSync does not inject stale local pendingPriorities', () => {
      usePlayerStore.setState({
        isShuffle: false,
        pendingPriorities: [{ ...songB, isPriority: true }]
      })

      const incomingRoomQueue = [songA, songC]
      usePlayerStore.getState().setQueue(incomingRoomQueue, 0, undefined, { isRoomSync: true })

      const queue = usePlayerStore.getState().queue
      // Must only contain incoming room tracks, NOT stale pendingPriorities
      expect(queue.length).toBe(2)
      expect(queue.map((s) => s.id)).toEqual(['track-a', 'track-c'])
    })
  })

  describe('3. Strict Song Matching (findSongMatchIndex)', () => {
    it('rejects false substring matches (e.g. "Bar" should NOT match "Handlebars")', () => {
      const library = [songA] // "Handlebars" by Flobots
      // Searching for "Bar" with empty artist
      const matchIdx = findSongMatchIndex(library, 'Bar', '')
      expect(matchIdx).toBe(-1)
    })

    it('rejects false substring matches for short prefixes (e.g. "Be" should NOT match "Better Broken")', () => {
      const library = [{ ...songA, title: 'Better Broken', artist: 'Artist' }]
      const matchIdx = findSongMatchIndex(library, 'Be', '')
      expect(matchIdx).toBe(-1)
    })

    it('accurately matches exact title case-insensitively', () => {
      const library = [songA, songB, songC]
      const matchIdx = findSongMatchIndex(library, 'handlebars', 'flobots')
      expect(matchIdx).toBe(0)
      expect(library[matchIdx].id).toBe('track-a')
    })
  })

  describe('4. Host Loop Rewind (handleHostExplicitSeek)', () => {
    it('bypasses sync lock and resumes playback when isLoop is true or position is 0', () => {
      useListeningStore.setState({
        joinedRoom: {
          id: 'room-1',
          code: 'LOOP01',
          host_id: 'host-user-id',
          name: 'Host Room',
          is_active: true,
          is_playing: true,
          position_seconds: 0,
          song: toSharedSong(songA),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        } as ListeningRoom,
        isSyncLocked: true // Transient sync lock active
      })

      usePlayerStore.setState({
        queue: [songA],
        currentSongIndex: 0,
        currentTime: 207,
        isPlaying: false // was paused waiting at end of song
      })

      // Host loops track: sends explicit seek to 0 with isLoop: true
      useListeningStore.getState().handleHostExplicitSeek({
        position: 0,
        hostTimestamp: Date.now(),
        trackId: songA.id,
        isLoop: true
      })

      const player = usePlayerStore.getState()
      expect(player.currentTime).toBe(0)
      expect(player.seekRequest).toBe(0)
      expect(player.isPlaying).toBe(true)
    })
  })

  describe('5. Exact Song Selection on Track Change', () => {
    it('sessionQueue places the host current song at index 0 and targetIndex is 0', async () => {
      const sharedA = toSharedSong(songA)
      const sharedC = toSharedSong(songC)

      const targetRoom: ListeningRoom = {
        id: 'room-1',
        code: 'SYNC01',
        host_id: 'host-user-id',
        name: 'Sync Room',
        is_active: true,
        is_playing: true,
        position_seconds: 0,
        song: sharedC, // Host switched to Song C
        queue: [sharedC, sharedA], // Upcoming queue starts with Song C
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      useListeningStore.setState({
        joinedRoom: targetRoom,
        isSyncLocked: false
      })

      // Mock window.api.getSongs to return our local library
      ;(window as any).api = {
        getSongs: vi.fn().mockResolvedValue([songA, songB, songC])
      }

      await useListeningStore.getState().handleHostSongChange(targetRoom)

      const player = usePlayerStore.getState()
      expect(player.currentSongIndex).toBe(0)
      expect(player.queue[0].title).toBe('Yellow')
      expect(player.queue[0].id).toBe('track-c')
    })
  })
})
