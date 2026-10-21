import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  searchYouTubeVideos,
  clearYouTubeSearchCache,
  extractYouTubeVideoId,
  decodeHtmlEntities
} from '../../../src/renderer/src/lib/youtubeService'

describe('YouTube Search & Metadata Service', () => {
  beforeEach(() => {
    clearYouTubeSearchCache()
    vi.restoreAllMocks()
    ;(window as any).api = {
      searchDownloadSource: vi.fn(),
      getYouTubeMetadata: vi.fn()
    }
  })

  afterEach(() => {
    clearYouTubeSearchCache()
  })

  it('resolves direct 11-character video ID without calling searchDownloadSource', async () => {
    ;(window as any).api.getYouTubeMetadata.mockResolvedValueOnce({
      success: true,
      title: 'Never Gonna Give You Up',
      channel: 'Rick Astley',
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    })

    const results = await searchYouTubeVideos('dQw4w9WgXcQ')

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('dQw4w9WgXcQ')
    expect(results[0].title).toBe('Never Gonna Give You Up')
    expect(results[0].channel).toBe('Rick Astley')
    expect((window as any).api.searchDownloadSource).not.toHaveBeenCalled()
  })

  it('resolves full YouTube URL scheme without calling searchDownloadSource', async () => {
    ;(window as any).api.getYouTubeMetadata.mockResolvedValueOnce({
      success: true,
      title: 'Bohemian Rhapsody &amp; Friends',
      channel: 'Queen',
      thumbnailUrl: 'https://img.youtube.com/vi/fJ9rUzIMcZQ/hqdefault.jpg'
    })

    const results = await searchYouTubeVideos('https://www.youtube.com/watch?v=fJ9rUzIMcZQ')

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('fJ9rUzIMcZQ')
    expect(results[0].title).toBe('Bohemian Rhapsody & Friends')
    expect((window as any).api.searchDownloadSource).not.toHaveBeenCalled()
  })

  it('delegates keyword search to window.api.searchDownloadSource and parses results', async () => {
    ;(window as any).api.searchDownloadSource.mockResolvedValueOnce([
      {
        id: 'vid12345678',
        title: 'Lofi Hip Hop Radio &middot; Beats to Relax/Study to',
        artist: 'Lofi Girl',
        meta: '3:45 · YouTube Audio',
        artworkUrl: 'https://img.youtube.com/vi/vid12345678/hqdefault.jpg'
      },
      {
        id: 'vid87654321',
        title: 'Synthwave Radio',
        artist: 'ChillSynth',
        meta: '12:30 · YouTube Audio',
        artworkUrl: 'https://img.youtube.com/vi/vid87654321/hqdefault.jpg'
      }
    ])

    const results = await searchYouTubeVideos('lofi chill')

    expect((window as any).api.searchDownloadSource).toHaveBeenCalledWith('youtube', 'lofi chill', {})
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('vid12345678')
    expect(results[0].title).toBe('Lofi Hip Hop Radio · Beats to Relax/Study to')
    expect(results[0].channel).toBe('Lofi Girl')
    expect(results[0].duration).toBe('3:45')
    expect(results[1].duration).toBe('12:30')
  })

  it('leverages in-memory cache on duplicate search queries', async () => {
    ;(window as any).api.searchDownloadSource.mockResolvedValueOnce([
      {
        id: 'cached-id-1',
        title: 'Cached Song',
        artist: 'Cached Artist',
        meta: '4:20',
        artworkUrl: 'https://img.youtube.com/vi/cached-id-1/hqdefault.jpg'
      }
    ])

    const firstRun = await searchYouTubeVideos('test query')
    expect(firstRun).toHaveLength(1)
    expect((window as any).api.searchDownloadSource).toHaveBeenCalledTimes(1)

    // Second call with same query (different case/whitespace)
    const secondRun = await searchYouTubeVideos('  TEST QUERY  ')
    expect(secondRun).toHaveLength(1)
    expect(secondRun[0].id).toBe('cached-id-1')
    // Should NOT call searchDownloadSource again
    expect((window as any).api.searchDownloadSource).toHaveBeenCalledTimes(1)
  })

  it('handles empty query gracefully returning empty array', async () => {
    const results = await searchYouTubeVideos('   ')
    expect(results).toEqual([])
    expect((window as any).api.searchDownloadSource).not.toHaveBeenCalled()
  })

  it('handles web environment safely when searchDownloadSource is unavailable', async () => {
    ;(window as any).api = {} // No searchDownloadSource

    const results = await searchYouTubeVideos('random search without desktop api')
    expect(results).toEqual([])
  })

  it('decodes complex HTML entities correctly', () => {
    expect(decodeHtmlEntities('Rock &amp; Roll')).toBe('Rock & Roll')
    expect(decodeHtmlEntities('Don&#39;t Stop Believin&#39;')).toBe("Don't Stop Believin'")
    expect(decodeHtmlEntities('&quot;Hello World&quot;')).toBe('"Hello World"')
    expect(decodeHtmlEntities('Tom &#x26; Jerry')).toBe('Tom & Jerry')
  })

  it('correctly extracts video IDs across various YouTube URL formats', () => {
    expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('https://youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(extractYouTubeVideoId('plain random text')).toBeNull()
  })
})
