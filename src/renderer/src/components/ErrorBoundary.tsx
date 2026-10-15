import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  componentStack?: string | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary caught error]:', error?.message, errorInfo?.componentStack)
    this.setState({ componentStack: errorInfo?.componentStack })
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  private handleGoHome = (): void => {
    this.setState({ hasError: false, error: null })
    if (typeof window !== 'undefined') {
      window.location.hash = '#/'
    }
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-danger border border-danger/25">
              <AlertTriangle className="h-6 w-6" />
            </div>

            <h2 className="mt-4 text-lg font-bold text-text">Something went wrong</h2>
            <p className="mt-2 text-xs text-text-muted leading-relaxed font-mono bg-canvas/60 p-2.5 rounded-lg border border-border/50 text-left overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
              {this.state.error?.message || 'An unexpected error occurred while rendering this view.'}
              {this.state.componentStack ? `\n\nComponent Stack:\n${this.state.componentStack}` : ''}
            </p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-semibold text-text hover:bg-hover transition cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Try Again</span>
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 rounded-full bg-text px-4 py-2 text-xs font-bold text-canvas hover:opacity-90 transition cursor-pointer"
              >
                <Home className="h-3.5 w-3.5" />
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
