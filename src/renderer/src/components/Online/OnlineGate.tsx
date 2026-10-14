import type { ReactNode } from 'react'
import { Cloud, Loader2, LogIn } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'

export default function OnlineGate({ children }: { children: ReactNode }): ReactNode {
  const { configured, initialized, user } = useOnlineStore()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const roomCode = searchParams.get('code')

  if (!configured) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-full max-w-md text-center">
          <Cloud className="mx-auto h-10 w-10 text-text-muted" />
          <h1 className="mt-5 text-2xl font-bold text-text">Connect Supabase</h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            Add your project URL and anon key to <span className="font-mono text-text">.env</span>,
            then apply the included migration.
          </p>
        </div>
      </div>
    )
  }

  if (!initialized) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
        <Loader2 className="h-7 w-7 animate-spin text-text-muted" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] w-full flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-full max-w-sm text-center">
          <LogIn className="mx-auto h-9 w-9 text-text-muted" />
          <h1 className="mt-4 text-xl font-bold text-text">
            {roomCode ? `Sign in to join session ${roomCode}` : 'Sign in for online features'}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {roomCode
              ? 'An account is required to participate in live synchronized listening rooms.'
              : 'Your local library stays available without an account.'}
          </p>
          <Link
            to="/account"
            state={{ returnTo: location.pathname + location.search }}
            className="mt-5 inline-flex rounded-full bg-text px-5 py-2.5 text-sm font-bold text-canvas hover:opacity-90"
          >
            Sign in or register
          </Link>
        </div>
      </div>
    )
  }

  return children
}
