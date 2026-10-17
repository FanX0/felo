import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { ProgressBar } from '../../../src/renderer/src/components/Footer/Footer'

describe('ProgressBar Component', () => {
  it('renders progress bar with correct width and thumb position', () => {
    const { container } = render(
      <ProgressBar duration={100} currentTime={50} seek={vi.fn()} />
    )

    // The filled bar should be at 50%
    const filledBar = container.querySelector('.bg-text')
    expect(filledBar).toBeInTheDocument()
    expect(filledBar).toHaveStyle({ width: '50%' })

    // The thumb dot should be at 50% and vertically centered
    const thumb = container.querySelector('.bg-white.rounded-full')
    expect(thumb).toBeInTheDocument()
    expect(thumb).toHaveStyle({ left: '50%' })
    // Crucial check: thumb MUST NOT have transition-all to prevent animation desync on seek
    expect(thumb?.className).not.toContain('transition-all')
    expect(thumb?.className).toContain('pointer-events-none')
  })

  it('updates position synchronously during pointer scrub and calls seek on release', () => {
    const seekMock = vi.fn()
    const { container } = render(
      <ProgressBar duration={200} currentTime={20} seek={seekMock} />
    )

    const track = container.querySelector('.bg-border') as HTMLElement
    expect(track).toBeInTheDocument()

    // Mock getBoundingClientRect
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 10,
      width: 200,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => {}
    })

    // Mock setPointerCapture & releasePointerCapture on HTMLDivElement
    track.setPointerCapture = vi.fn()
    track.releasePointerCapture = vi.fn()

    // Pointer down at x = 100 (50% of 200px width -> time = 100s)
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 })

    const filledBar = container.querySelector('.bg-primary')
    expect(filledBar).toBeInTheDocument()
    expect(filledBar).toHaveStyle({ width: '50%' })

    const thumb = container.querySelector('.bg-white.rounded-full')
    expect(thumb).toHaveStyle({ left: '50%' })

    // Pointer move to x = 150 (75% of 200px -> time = 150s)
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 })
    expect(filledBar).toHaveStyle({ width: '75%' })
    expect(thumb).toHaveStyle({ left: '75%' })

    // Pointer up to release
    fireEvent.pointerUp(track, { clientX: 150, pointerId: 1 })
    expect(seekMock).toHaveBeenCalledTimes(1)
    expect(seekMock).toHaveBeenCalledWith(150)
  })

  it('respects disabled state and prevents seeking', () => {
    const seekMock = vi.fn()
    const { container } = render(
      <ProgressBar
        duration={100}
        currentTime={20}
        seek={seekMock}
        disabled={true}
        disabledTitle="Playback position is locked"
      />
    )

    const track = container.querySelector('.bg-border') as HTMLElement
    expect(track).toHaveClass('cursor-not-allowed')
    expect(track).toHaveAttribute('title', 'Playback position is locked')

    // Thumb dot should not even be rendered when disabled
    const thumb = container.querySelector('.bg-white.rounded-full')
    expect(thumb).toBeNull()

    // Pointer down should not trigger seek
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 50, pointerId: 1 })
    expect(seekMock).not.toHaveBeenCalled()
  })
})
