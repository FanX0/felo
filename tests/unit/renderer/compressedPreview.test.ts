import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSongPreviewStorageKey,
  getSongPreviewBucketUrl,
  getSongPublicBucketUrl,
  markSongUploadedToBucket,
  isSongUploadedToBucket
} from '../../../src/renderer/src/lib/audioBucketService'
import { toSharedSong } from '../../../src/renderer/src/stores/listening/helpers'
import type { Song } from '../../../src/renderer/src/types/song'

describe('Compressed Preview & Dual Upload Pipeline', () => {
  const sampleSong: Song = {
    id: 'track-abc-123',
    title: 'Instant Fast-Start Track',
    artist: 'Antigravity Sound',
    album: 'Dual Pipeline',
    duration: 215,
    audioUrl: 'http://127.0.0.1:4788/v1/audio/track-abc-123',
    filePath: 'C:\\Music\\InstantTrack.flac',
    bitrate: 1411
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates sanitized preview storage keys ending with _preview.mp3', () => {
    const key = getSongPreviewStorageKey('track-abc-123')
    expect(key).toBe('track-abc-123_preview.mp3')

    // Strips path separators and hazardous characters
    const complexKey = getSongPreviewStorageKey('folder/sub../track:999')
    expect(complexKey).not.toContain('/')
    expect(complexKey).not.toContain(':')
    expect(complexKey.endsWith('_preview.mp3')).toBe(true)
  })

  it('generates distinct CDN URLs for preview vs full quality', () => {
    const previewUrl = getSongPreviewBucketUrl('track-abc-123')
    const fullUrl = getSongPublicBucketUrl('track-abc-123')

    expect(previewUrl).toContain('track-abc-123_preview.mp3')
    expect(fullUrl).toContain('track-abc-123.mp3')
    expect(previewUrl).not.toEqual(fullUrl)
  })

  it('correctly tracks upload status in bucket cache', () => {
    expect(isSongUploadedToBucket('new-track-999')).toBe(false)
    markSongUploadedToBucket('new-track-999')
    expect(isSongUploadedToBucket('new-track-999')).toBe(true)
  })

  it('toSharedSong detects lossy vs lossless and identifies compression requirements', () => {
    const flacSong: Song = {
      ...sampleSong,
      filePath: 'C:\\Music\\test.flac',
      size: 45 * 1024 * 1024,
      bitrate: 1411
    }
    const sharedFlac = toSharedSong(flacSong)
    expect(sharedFlac.isAlreadyCompressed).toBe(false)
    expect(sharedFlac.needsCompression).toBe(true)

    const mp3Song: Song = {
      ...sampleSong,
      filePath: 'C:\\Music\\test.mp3',
      size: 5 * 1024 * 1024,
      bitrate: 320
    }
    const sharedMp3 = toSharedSong(mp3Song)
    expect(sharedMp3.isAlreadyCompressed).toBe(true)
    expect(sharedMp3.needsCompression).toBe(false)
  })

  it('toSharedSong preserves YouTube stream attributes for inline playback', () => {
    const ytSong: Song = {
      id: 'yt-dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
      audioUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }
    const sharedYt = toSharedSong(ytSong)
    expect(sharedYt.isYouTube).toBe(true)
    expect(sharedYt.streamType).toBe('youtube')
    expect(sharedYt.videoId).toBe('dQw4w9WgXcQ')
    expect(sharedYt.uploadStatus).toBe('UPLOADED')
  })
})
