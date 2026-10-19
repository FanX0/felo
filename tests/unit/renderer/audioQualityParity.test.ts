import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveSongAudioUrl } from '../../../src/renderer/src/lib/songAudioResolver'
import { usePlayerStore } from '../../../src/renderer/src/stores/player/usePlayerStore'
import { forceStereoSdp } from '../../../src/renderer/src/lib/webrtcAudioStream'
import type { Song } from '../../../src/renderer/src/types/song'

describe('Listen Together: Audio Quality Parity Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlayerStore.setState({
      queue: [],
      originalQueue: [],
      currentSongIndex: 0,
      isPlaying: false
    })
  })

  describe('1. songAudioResolver: Local Disk Quality Preservation', () => {
    it('resolves real local file path via toMediaUrl even if isOnline is true', () => {
      const downloadedRoomSong: Song = {
        id: 'room-song-1',
        title: 'Master Track',
        artist: 'Hi-Fi Artist',
        album: 'Hi-Fi Album',
        duration: 200,
        filePath: 'C:\\Users\\user\\Music\\MasterTrack.flac',
        audioUrl: 'https://example.supabase.co/storage/v1/object/public/listen-together/preview.mp3',
        isOnline: true
      }

      const resolved = resolveSongAudioUrl(downloadedRoomSong)
      expect(resolved).not.toBeNull()
      // In Electron environment, must resolve to media:// URL instead of remote preview
      expect(resolved).toContain('media://local')
      expect(resolved).toContain('MasterTrack.flac')
      expect(resolved).not.toContain('preview.mp3')
    })
  })

  describe('2. usePlayerStore.updateSong: Clearing Remote Preview URLs on Local Merge', () => {
    it('clears isOnline, previewUrl, and remote preview audioUrl when merging a downloaded local file', () => {
      const initialRoomSong: Song = {
        id: 'room-song-42',
        title: 'Lossless Diamond',
        artist: 'Audiophile',
        album: 'Acoustic Sessions',
        duration: 240,
        filePath: 'https://example.supabase.co/storage/v1/object/public/listen-together/diamond_preview.mp3',
        audioUrl: 'https://example.supabase.co/storage/v1/object/public/listen-together/diamond_preview.mp3',
        isOnline: true
      }

      usePlayerStore.setState({
        queue: [initialRoomSong],
        originalQueue: [initialRoomSong],
        currentSongIndex: 0
      })

      const completedDownloadedSong: Song = {
        id: 'room-song-42',
        title: 'Lossless Diamond',
        artist: 'Audiophile',
        album: 'Acoustic Sessions',
        duration: 240,
        filePath: 'C:\\Music\\LosslessDiamond.flac'
      }

      usePlayerStore.getState().updateSong(completedDownloadedSong, 'room-song-42')

      const updated = usePlayerStore.getState().queue[0]
      expect(updated.filePath).toBe('C:\\Music\\LosslessDiamond.flac')
      expect(updated.isOnline).toBe(false)
      expect((updated as any).previewUrl).toBeUndefined()
      expect(updated.audioUrl).toBeUndefined()
    })
  })

  describe('3. WebRTC: 320 kbps Opus Studio Streaming Constraints', () => {
    it('injects 320 kbps CBR and 48 kHz stereo constraints into Opus SDP', () => {
      const mockSdp = [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111 opus/48000/2',
        'a=fmtp:111 minptime=10;useinbandfec=1'
      ].join('\r\n')

      const enhancedSdp = forceStereoSdp(mockSdp, 320000)

      expect(enhancedSdp).toContain('maxaveragebitrate=320000')
      expect(enhancedSdp).toContain('stereo=1')
      expect(enhancedSdp).toContain('sprop-stereo=1')
      expect(enhancedSdp).toContain('maxplaybackrate=48000')
      expect(enhancedSdp).toContain('sprop-maxcapturerate=48000')
      expect(enhancedSdp).toContain('cbr=1')
    })
  })
})
