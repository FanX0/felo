import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SpatialRoomVisualizer from '../../../src/renderer/src/components/Audio/SpatialRoomVisualizer'
import type { SpeakerRole } from '../../../src/renderer/src/hooks/useDspStore'

describe('SpatialRoomVisualizer Stacking Order & Layering', () => {
  it('renders Center above Subwoofer with active waves and acoustic ray when center is active', () => {
    const handleSelectRole = vi.fn()
    const { container } = render(
      <SpatialRoomVisualizer activeRole="center" onSelectRole={handleSelectRole} />
    )

    expect(screen.getByText(/Center Channel Active/i)).toBeInTheDocument()

    const centerSpeaker = screen.getByLabelText('Center Speaker Channel')
    const subSpeaker = screen.getByLabelText('Subwoofer LFE Channel')

    // Verify z-index styles
    expect(centerSpeaker.style.zIndex).toBe('20')
    expect(subSpeaker.style.zIndex).toBe('10')

    // Verify DOM order: Subwoofer must precede Center when center is active
    const speakerNodes = container.querySelectorAll('.speaker-node')
    const speakerLabels = Array.from(speakerNodes).map((node) => node.getAttribute('aria-label'))

    const centerIndex = speakerLabels.indexOf('Center Speaker Channel')
    const subIndex = speakerLabels.indexOf('Subwoofer LFE Channel')

    expect(centerIndex).toBeGreaterThan(subIndex)

    // Verify Center sound waves and active ray are rendered
    expect(container.querySelector('.center-sound-waves')).toBeInTheDocument()
    expect(centerSpeaker.querySelector('line[stroke-width="1.8"]')).toBeInTheDocument()
  })

  it('renders Subwoofer above Center when subwoofer is active', () => {
    const handleSelectRole = vi.fn()
    const { container } = render(
      <SpatialRoomVisualizer activeRole="subwoofer" onSelectRole={handleSelectRole} />
    )

    expect(screen.getByText(/Subwoofer LFE Active/i)).toBeInTheDocument()

    const centerSpeaker = screen.getByLabelText('Center Speaker Channel')
    const subSpeaker = screen.getByLabelText('Subwoofer LFE Channel')

    // Verify z-index styles
    expect(centerSpeaker.style.zIndex).toBe('10')
    expect(subSpeaker.style.zIndex).toBe('20')

    // Verify DOM order: Center precedes Subwoofer when subwoofer is active
    const speakerNodes = container.querySelectorAll('.speaker-node')
    const speakerLabels = Array.from(speakerNodes).map((node) => node.getAttribute('aria-label'))

    const centerIndex = speakerLabels.indexOf('Center Speaker Channel')
    const subIndex = speakerLabels.indexOf('Subwoofer LFE Channel')

    expect(subIndex).toBeGreaterThan(centerIndex)

    // Verify sub-bass waves are rendered and center waves are absent
    expect(container.querySelector('.sub-bass-waves')).toBeInTheDocument()
    expect(container.querySelector('.center-sound-waves')).not.toBeInTheDocument()
  })

  it('triggers onSelectRole when speaker channels are clicked', () => {
    const handleSelectRole = vi.fn()
    render(<SpatialRoomVisualizer activeRole="center" onSelectRole={handleSelectRole} />)

    fireEvent.click(screen.getByLabelText('Left Speaker Channel'))
    expect(handleSelectRole).toHaveBeenCalledWith('left')

    fireEvent.click(screen.getByLabelText('Subwoofer LFE Channel'))
    expect(handleSelectRole).toHaveBeenCalledWith('subwoofer')

    fireEvent.click(screen.getByLabelText('Right Speaker Channel'))
    expect(handleSelectRole).toHaveBeenCalledWith('right')
  })
})
