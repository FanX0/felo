import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Avatar from '../../../src/renderer/src/components/Common/Avatar'

describe('Avatar Component', () => {
  it('renders an image when src is a valid URL', () => {
    render(
      <Avatar src="https://images.example.com/avatar.jpg" fallbackText="Jane Doe" alt="Jane Doe" />
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://images.example.com/avatar.jpg')
    expect(img).toHaveAttribute('alt', 'Jane Doe')
  })

  it('renders fallback initials when src is null', () => {
    render(<Avatar src={null} fallbackText="Jane Doe" />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('gracefully switches to initials fallback when image load fails', () => {
    render(
      <Avatar src="https://broken-link.example.com/404.jpg" fallbackText="Broken Image User" />
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()

    // Simulate image loading failure
    fireEvent.error(img)

    // Should no longer show broken image, should show initials fallback
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('BU')).toBeInTheDocument()
  })

  it('renders metadataFallback when primary src is missing', () => {
    render(
      <Avatar
        src={null}
        metadataFallback="https://lh3.googleusercontent.com/google-photo.png"
        fallbackText="Google User"
      />
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://lh3.googleusercontent.com/google-photo.png')
  })

  it('renders single initial when maxInitials=1 is set', () => {
    render(<Avatar src={null} fallbackText="Tejo sunandar" maxInitials={1} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('handles invalid stringified null as src and displays initials fallback', () => {
    render(<Avatar src="null" fallbackText="Tejo sunandar" maxInitials={1} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('resets failed state and renders new image when src is updated', () => {
    const { rerender } = render(
      <Avatar src="https://broken-link.example.com/404.jpg" fallbackText="User" />
    )

    const img = screen.getByRole('img')
    fireEvent.error(img)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    // Update with new valid avatar URL
    rerender(<Avatar src="https://valid-link.example.com/new.png" fallbackText="User" />)
    const newImg = screen.getByRole('img')
    expect(newImg).toBeInTheDocument()
    expect(newImg).toHaveAttribute('src', 'https://valid-link.example.com/new.png')
  })
})
