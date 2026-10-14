import type { ReactNode } from 'react'
import { Cloud, Loader2, LogIn, Radio } from 'lucide-react'
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
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-elevated/70 p-6 sm:p-8 shadow-2xl backdrop-blur-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            {roomCode ? <Radio className="h-7 w-7 animate-pulse" /> : <LogIn className="h-7 w-7" />}
          </div>
          <h1 className="mt-4 text-xl sm:text-2xl font-black text-text tracking-tight">
            {roomCode ? `You're Invited to Session ${roomCode}!` : 'Sign In for Online Features'}
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-text-muted leading-relaxed">
            {roomCode
              ? 'Join your friend in synchronized lossless audio with real-time queue & chat.'
              : 'Sign in to access Listen Together, cloud profile, and social playback.'}
          </p>

          <Link
            to="/account"
            state={{ returnTo: location.pathname + location.search }}
            className="mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-2.5 text-xs font-black text-black hover:bg-white/90 transition-all shadow-md cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <LogIn className="h-4 w-4" />
            <span>Sign In or Register (Takes 10s)</span>
          </Link>

          <div className="mt-4 text-[11px] text-text-muted/80">
            💡 Supports Google & Discord 1-click social sign-in.
          </div>
        </div>
      </div>
    )
  }

  return children
}
