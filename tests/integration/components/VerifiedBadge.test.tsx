import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import VerifiedBadge from '../../../src/renderer/src/components/Common/VerifiedBadge'

describe('VerifiedBadge Component', () => {
  it('renders the Spotify-style rosette badge by default', () => {
    const { container } = render(<VerifiedBadge />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    const paths = svg?.querySelectorAll('path')
    expect(paths?.length).toBe(2)
  })

  it('renders the clean circle variant without white border when specified', () => {
    const { container } = render(<VerifiedBadge variant="circle" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    const circle = svg?.querySelector('circle')
    expect(circle).toBeInTheDocument()
    expect(circle).toHaveAttribute('fill', '#3d91f4')
  })

  it('applies custom className correctly', () => {
    const { container } = render(<VerifiedBadge className="custom-size-class" />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('custom-size-class')
  })
})
