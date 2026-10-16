import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ErrorBoundary from '../../../src/renderer/src/components/ErrorBoundary'

// Component that throws error conditionally
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Simulated test rendering crash')
  }
  return <div>Normal Content Loaded</div>
}

describe('Renderer Integration: ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress console.error in test output for intentional errors
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Normal Content Loaded')).toBeInTheDocument()
  })

  it('catches render error and displays error recovery view', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Simulated test rendering crash/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('renders custom fallback prop when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error Fallback</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Custom Error Fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})
