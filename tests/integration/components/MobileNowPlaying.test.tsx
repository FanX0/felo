import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileNowPlaying from '../../../src/renderer/src/pages/Remote/MobileNowPlaying'
import { usePlayerStore } from '../../../src/renderer/src/hooks/usePlayerStore'
import { useOnlineStore } from '../../../src/renderer/src/hooks/useOnlineStore'
import { useListeningStore } from '../../../src/renderer/src/hooks/useListeningStore'
import * as ConnectedDeviceModule from '../../../src/renderer/src/hooks/useConnectedDeviceStore'
import { useConnectedDeviceStore, sendDeviceCommand } from '../../../src/renderer/src/hooks/useConnectedDeviceStore'
import { remoteClient } from '../../../src/renderer/src/pages/Remote/remoteClient'
import * as SupabaseLib from '../../../src/renderer/src/lib/supabase'
import type { Song } from '../../../src/renderer/src/types/song'

const mockSong: Song = {
  id: 'song-mob-1',
  title: 'Starry Sky',
  artist: 'Lofi Dreamer',
  album: 'Midnight Chill',
  duration: 180, // 3:00
  filePath: '/music/starry-sky.mp3'
}

describe('MobileNowPlaying Component - Industry Standard Time Touch & Seek Suite', () => {
  const mockInsert = vi.fn().mockReturnValue(Promise.resolve({ error: null }))
  const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()

    // Mock navigator.vibrate for haptic testing
    if (typeof navigator !== 'undefined') {
      navigator.vibrate = vi.fn()
    }

    vi.spyOn(remoteClient, 'getIsConnected').mockReturnValue(false)
    vi.spyOn(remoteClient, 'seek').mockReturnValue(undefined as any)
    vi.spyOn(SupabaseLib, 'getSupabase').mockReturnValue({ from: mockFrom } as any)
    vi.spyOn(ConnectedDeviceModule, 'sendDeviceCommand').mockResolvedValue(undefined as any)

    useOnlineStore.setState({
      user: null
    })

    useConnectedDeviceStore.setState({
      activePlayback: null,
      devicePlaybackMode: 'standalone'
    })

    useListeningStore.setState({
      joinedRoom: null,
      hostRoom: null,
      myRole: 'listener'
    })

    usePlayerStore.setState({
      queue: [mockSong],
      originalQueue: [mockSong],
      currentSongIndex: 0,
      isPlaying: false,
      currentTime: 30,
      duration: 180,
      volume: 0.8
    })
  })

  // =========================================================================
  // 1. INDUSTRY STANDARD TIME DISPLAY SWITCH (REMAINING <-> DURATION)
  // =========================================================================
  describe('1. Time Display Touch Switch', () => {
    it('renders elapsed time and remaining time by default on mobile', () => {
      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 180,
            position: 30,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      // Elapsed time 30s -> "0:30"
      expect(screen.getByText('0:30')).toBeInTheDocument()

      // Default remaining time 180 - 30 = 150s -> "-2:30"
      expect(screen.getByText('-2:30')).toBeInTheDocument()
    })

    it('switches time display between remaining time and total duration on touch / tap', () => {
      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 180,
            position: 45,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      // Initial state: remaining time "-2:15" (180 - 45 = 135s)
      const timeBtn = screen.getByRole('button', { name: /remaining time/i })
      expect(timeBtn).toBeInTheDocument()
      expect(screen.getByText('-2:15')).toBeInTheDocument()

      // Tap the time button -> switches to total duration "3:00"
      fireEvent.click(timeBtn)

      expect(screen.getByText('3:00')).toBeInTheDocument()
      expect(screen.queryByText('-2:15')).not.toBeInTheDocument()
      expect(localStorage.getItem('felo_mobile_time_mode')).toBe('duration')

      // Tap again -> switches back to remaining time "-2:15"
      fireEvent.click(timeBtn)

      expect(screen.getByText('-2:15')).toBeInTheDocument()
      expect(screen.queryByText('3:00')).not.toBeInTheDocument()
      expect(localStorage.getItem('felo_mobile_time_mode')).toBe('remaining')
    })

    it('triggers tactile haptic vibration (8ms) when tapping the time display button', () => {
      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 180,
            position: 45,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const timeBtn = screen.getByRole('button', { name: /remaining time/i })
      fireEvent.click(timeBtn)

      expect(navigator.vibrate).toHaveBeenCalledWith(8)
    })

    it('restores persisted time display preference from localStorage on mount', () => {
      localStorage.setItem('felo_mobile_time_mode', 'duration')

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 180,
            position: 10,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      // Should load duration mode immediately: "3:00"
      expect(screen.getByText('3:00')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // 2. TOUCH-OPTIMIZED TIMELINE SCRUBBER & FLOATING TIME PREVIEW
  // =========================================================================
  describe('2. Touch-Optimized Scrubber & Seeking', () => {
    it('handles touch pointer scrub, shows floating tooltip, and seeks to target time on pointer release', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      const { container } = render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 200,
            position: 20,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      expect(slider).toBeInTheDocument()

      // Mock dimensions: 200px wide
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 200,
        bottom: 20,
        width: 200,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()
      slider.hasPointerCapture = vi.fn().mockReturnValue(true)

      // Touch down at clientX = 100 (50% of 200px -> 100s)
      fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })
      expect(slider.setPointerCapture).toHaveBeenCalledWith(1)
      expect(navigator.vibrate).toHaveBeenCalledWith(8)

      // Floating seek tooltip appears above finger showing preview timestamp "1:40"
      expect(screen.getByTestId('seek-tooltip')).toBeInTheDocument()
      expect(screen.getAllByText('1:40').length).toBeGreaterThanOrEqual(2)

      // Touch drag to clientX = 150 (75% of 200px -> 150s)
      fireEvent.pointerMove(slider, { clientX: 150, pointerId: 1 })
      expect(screen.getAllByText('2:30').length).toBeGreaterThanOrEqual(2)

      // Touch release at clientX = 150
      fireEvent.pointerUp(slider, { clientX: 150, pointerId: 1 })
      expect(slider.releasePointerCapture).toHaveBeenCalledWith(1)
      expect(navigator.vibrate).toHaveBeenCalledWith(14)

      expect(seekSpy).toHaveBeenCalledWith(150)
    })

    it('clamps boundary coordinates when scrubbing before track start (0) or past track end (duration)', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 100,
            position: 50,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 200,
        bottom: 20,
        width: 200,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()

      // 1. Scrub far left (negative clientX) -> clamped to 0
      fireEvent.pointerDown(slider, { clientX: -50, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: -50, pointerId: 1 })
      expect(seekSpy).toHaveBeenCalledWith(0)

      // 2. Scrub far right (clientX > 200) -> clamped to 100 (duration)
      fireEvent.pointerDown(slider, { clientX: 350, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 350, pointerId: 1 })
      expect(seekSpy).toHaveBeenCalledWith(100)
    })

    it('aborts scrub on pointer cancel without committing seek', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      const { container } = render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 100,
            position: 25,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 200,
        bottom: 20,
        width: 200,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()
      slider.hasPointerCapture = vi.fn().mockReturnValue(true)

      // Start touch
      fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })
      expect(screen.getByTestId('seek-tooltip')).toBeInTheDocument()

      // Gesture cancelled (e.g., incoming call, palm touch cancellation)
      fireEvent.pointerCancel(slider, { pointerId: 1 })

      // Floating tooltip is removed and seek was NOT committed
      expect(screen.queryByTestId('seek-tooltip')).not.toBeInTheDocument()
      expect(seekSpy).not.toHaveBeenCalled()
    })

    it('supports keyboard seeking with left and right arrow keys (+5s / -5s)', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: false,
            duration: 100,
            position: 50,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })

      // ArrowRight (+5s) -> 55
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(seekSpy).toHaveBeenNthCalledWith(1, 55)

      // ArrowLeft (-5s from 55) -> 50
      fireEvent.keyDown(slider, { key: 'ArrowLeft' })
      expect(seekSpy).toHaveBeenNthCalledWith(2, 50)
    })
  })

  // =========================================================================
  // 3. REMOTE, CLOUD, AND LISTEN TOGETHER INTEGRATION
  // =========================================================================
  describe('3. Remote Control & Room Playback Seeking', () => {
    it('dispatches seek to remoteClient when connected via LAN/SSE remote stream', () => {
      vi.spyOn(remoteClient, 'getIsConnected').mockReturnValue(true)

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: true,
            duration: 120,
            position: 10,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={true}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()

      // Seek to 50% of 120s = 60s
      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 50, pointerId: 1 })

      expect(remoteClient.seek).toHaveBeenCalledWith(60)
    })

    it('dispatches seek command via sendDeviceCommand when controlling an active cloud device', () => {
      useOnlineStore.setState({
        user: { id: 'usr-123', email: 'test@felo.com' } as any
      })
      useConnectedDeviceStore.setState({
        activePlayback: {
          activeDeviceId: 'dev-desktop-456',
          activeDeviceName: 'MacBook Pro',
          isPlaying: true,
          position: 15,
          duration: 180,
          song: mockSong
        } as any
      })

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: true,
            duration: 180,
            position: 15,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()

      // Seek to 50% of 180s = 90s
      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 50, pointerId: 1 })

      expect(sendDeviceCommand).toHaveBeenCalledWith('usr-123', 'dev-desktop-456', 'seek', { seconds: 90 })
    })

    it('inserts seek command into listening_room_commands when joined in room as co_host', () => {
      useOnlineStore.setState({
        user: { id: 'usr-cohost', user_metadata: { full_name: 'Co-Host Alex' } } as any
      })
      useListeningStore.setState({
        joinedRoom: { code: 'SYNC99', id: 'rm-99', name: 'Chill Room' } as any,
        myRole: 'co_host'
      })

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: true,
            duration: 200,
            position: 10,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 100,
        bottom: 20,
        width: 100,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => {}
      })
      slider.setPointerCapture = vi.fn()
      slider.releasePointerCapture = vi.fn()

      // Seek to 75% of 200s = 150s
      fireEvent.pointerDown(slider, { clientX: 75, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 75, pointerId: 1 })

      expect(mockFrom).toHaveBeenCalledWith('listening_room_commands')
      expect(mockInsert).toHaveBeenCalledWith({
        room_code: 'SYNC99',
        command: 'seek',
        sender_name: 'Co-Host Alex',
        source: 'mobile',
        payload: { seconds: 150 }
      })
    })
  })

  // =========================================================================
  // 4. GUARD RAILS & EDGE CASES
  // =========================================================================
  describe('4. Guard Rails & Edge Cases', () => {
    it('locks and disables scrubber when isPlayerLocked is true (listener in Listen Together room)', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      useListeningStore.setState({
        joinedRoom: { code: 'ROOM88' } as any,
        myRole: 'listener' // causes useIsPlayerLocked() -> true
      })

      render(
        <MobileNowPlaying
          state={{
            song: mockSong,
            isPlaying: true,
            duration: 180,
            position: 20,
            volumePercent: 80,
            queueLength: 1
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      expect(slider).toHaveClass('opacity-40')
      expect(slider).toHaveClass('cursor-not-allowed')
      expect(slider).toHaveAttribute('tabIndex', '-1')

      // Pointer events should not trigger seeking
      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 50, pointerId: 1 })
      expect(seekSpy).not.toHaveBeenCalled()
    })

    it('gracefully handles 0 duration or missing song without crashing', () => {
      const seekSpy = vi.spyOn(usePlayerStore.getState(), 'seek')

      render(
        <MobileNowPlaying
          state={{
            song: null,
            isPlaying: false,
            duration: 0,
            position: 0,
            volumePercent: 80,
            queueLength: 0
          }}
          isConnected={false}
          onOpenQueue={vi.fn()}
          onOpenSearch={vi.fn()}
          onOpenDevices={vi.fn()}
          onOpenLyrics={vi.fn()}
          onOpenSleepTimer={vi.fn()}
        />
      )

      const slider = screen.getByRole('slider', { name: /seek track/i })
      expect(slider).toHaveClass('opacity-40')
      expect(slider).toHaveClass('cursor-not-allowed')

      // Time labels show fallback unavailable text (-:--)
      expect(screen.getAllByText('-:--').length).toBeGreaterThanOrEqual(1)

      fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 })
      fireEvent.pointerUp(slider, { clientX: 50, pointerId: 1 })
      expect(seekSpy).not.toHaveBeenCalled()
    })
  })
})
