import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ManualSyncModal } from '../../../src/renderer/src/components/Online/ManualSyncModal'
import { useListeningStore } from '../../../src/renderer/src/hooks/useListeningStore'
import { usePlayerStore } from '../../../src/renderer/src/hooks/usePlayerStore'

describe('ManualSyncModal Component', () => {
  beforeEach(() => {
    useListeningStore.setState({
      isManualSyncModalOpen: true,
      manualSyncOffsetMs: 0,
      myRole: 'listener',
      hostRoom: null,
      joinedRoom: null
    })
    usePlayerStore.setState({
      queue: [
        {
          id: 'test-1',
          title: 'Synchronized Symphony',
          artist: 'Spatial Sound Collective',
          duration: 210,
          filePath: '/test/track.mp3'
        }
      ],
      currentSongIndex: 0,
      isPlaying: true,
      currentTime: 45,
      duration: 210
    })
  })

  it('renders the calibration modal with title, dynamic player, and drift gauge', () => {
    render(<ManualSyncModal isOpen={true} />)

    expect(screen.getByText('Audio Sync Calibration')).toBeInTheDocument()
    expect(screen.getByText('Synchronized Symphony')).toBeInTheDocument()
    expect(screen.getByText('Spatial Sound Collective')).toBeInTheDocument()
    expect(screen.getByText('Locked to Host Clock (0 ms Offset)')).toBeInTheDocument()
  })

  it('adjusts offset via step buttons', () => {
    render(<ManualSyncModal isOpen={true} />)

    const plus10Button = screen.getByRole('button', { name: '+10' })
    fireEvent.click(plus10Button)

    expect(useListeningStore.getState().manualSyncOffsetMs).toBe(10)
    expect(screen.getAllByText('+10').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Playback Advanced by +10 ms')).toBeInTheDocument()
  })

  it('applies common audio device presets', () => {
    render(<ManualSyncModal isOpen={true} />)

    const bluetoothPreset = screen.getByRole('button', { name: /Standard Bluetooth/i })
    fireEvent.click(bluetoothPreset)

    expect(useListeningStore.getState().manualSyncOffsetMs).toBe(40)
    expect(screen.getByText('+40')).toBeInTheDocument()
  })

  it('resets offset back to 0 ms when reset is clicked', () => {
    useListeningStore.setState({ manualSyncOffsetMs: 40 })
    render(<ManualSyncModal isOpen={true} />)

    const resetButton = screen.getByRole('button', { name: /Reset/i })
    fireEvent.click(resetButton)

    expect(useListeningStore.getState().manualSyncOffsetMs).toBe(0)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('displays host reference banner and disables adjustment when user is host', () => {
    useListeningStore.setState({ myRole: 'host' })
    render(<ManualSyncModal isOpen={true} />)

    expect(screen.getByText('Host Source Active')).toBeInTheDocument()
    const plus10Button = screen.getByRole('button', { name: '+10' })
    expect(plus10Button).toBeDisabled()
  })
})
