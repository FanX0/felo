import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Footer from '../../../src/renderer/src/components/Footer/Footer'
import { usePlayerStore } from '../../../src/renderer/src/hooks/usePlayerStore'
import { useListeningStore } from '../../../src/renderer/src/hooks/useListeningStore'
import { useConnectedDeviceStore } from '../../../src/renderer/src/hooks/useConnectedDeviceStore'
import type { Song } from '../../../src/renderer/src/types/song'

const mockSong: Song = {
  id: 'song-test-1',
  title: 'Cyberpunk Nights',
  artist: 'Neon Waves',
  album: 'Future Horizon',
  duration: 167, // 2:47
  filePath: '/music/cyberpunk.mp3'
}

describe('Footer Component Integration Test', () => {
  beforeEach(() => {
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
      isBuffering: false,
      volume: 0.8,
      currentTime: 0,
      duration: 167,
      repeatMode: 'off',
      isShuffle: false,
      isAutoplay: false,
      playbackContext: null
    })
  })

  it('renders track info and duration correctly', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )

    expect(screen.getByText('Cyberpunk Nights')).toBeInTheDocument()
    expect(screen.getByText('Neon Waves')).toBeInTheDocument()
    expect(screen.getByText('2:47')).toBeInTheDocument()
    expect(screen.getByText('0:00')).toBeInTheDocument()
  })

  it('displays the Loader2 spinning icon when track is buffering', () => {
    usePlayerStore.setState({ isBuffering: true, isPlaying: true })

    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )

    // Button title indicates buffering
    const playBtn = screen.getByTitle('Buffering track...')
    expect(playBtn).toBeInTheDocument()

    // Contains Loader2 with animate-spin
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('toggles between Play and Pause icons according to isPlaying when not buffering', () => {
    // 1. Paused
    usePlayerStore.setState({ isBuffering: false, isPlaying: false })
    const { rerender } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )
    expect(screen.getByTitle('Play')).toBeInTheDocument()

    // 2. Playing
    act(() => {
      usePlayerStore.setState({ isBuffering: false, isPlaying: true })
    })
    rerender(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )
    expect(screen.getByTitle('Pause')).toBeInTheDocument()
  })

  it('renders the Repeat1 icon with active indicator dot when repeatMode is "one"', () => {
    usePlayerStore.setState({ repeatMode: 'one' })

    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )

    const repeatBtn = screen.getByTitle('Repeat: one')
    expect(repeatBtn).toBeInTheDocument()

    // Should contain active amber indicator dot
    const activeDot = container.querySelector('.bg-primary-amber')
    expect(activeDot).toBeInTheDocument()
  })

  it('renders the Autoplay icon with active indicator when isAutoplay is true', () => {
    usePlayerStore.setState({ isAutoplay: true })

    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )

    const autoplayBtn = container.querySelector('button[title*="Autoplay similar songs"]')
    expect(autoplayBtn).toBeInTheDocument()

    const activeDot = autoplayBtn?.querySelector('.bg-primary-amber')
    expect(activeDot).toBeInTheDocument()
  })

  it('disables controls when player is locked in Listen Together room', () => {
    useListeningStore.setState({
      joinedRoom: { id: 'room-1', name: 'Chill Room', hostId: 'host-1', isLocked: true } as any,
      myRole: 'listener'
    })

    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>
    )

    const buttons = screen.getAllByTitle('Host controls playback')
    expect(buttons.length).toBeGreaterThanOrEqual(3) // shuffle, prev, play, next, repeat
  })
})
