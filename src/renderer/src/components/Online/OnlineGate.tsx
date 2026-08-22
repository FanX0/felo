import type { ReactNode } from 'react'
import { Cloud, Loader2, LogIn } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'

export default function OnlineGate({ children }: { children: ReactNode }): ReactNode {
  const { configured, initialized, user } = useOnlineStore()

  if (!configured) {
    return (
      <div className="flex h-full items-center justify-center p-8">
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
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-success" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <LogIn className="mx-auto h-9 w-9 text-text-muted" />
          <h1 className="mt-4 text-xl font-bold text-text">Sign in for online features</h1>
          <p className="mt-2 text-sm text-text-muted">
            Your local library stays available without an account.
          </p>
          <Link
            to="/account"
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
