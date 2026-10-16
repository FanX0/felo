import { FormEvent, type ReactElement, useState } from 'react'
import { Loader2, LockKeyhole, MessageCircle, UserPlus } from 'lucide-react'
import { Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'

export default function AccountPage(): ReactElement {
  const {
    configured,
    user,
    authError,
    isAuthenticating,
    signIn,
    signUp,
    signInWithProvider,
    clearAuthError
  } = useOnlineStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as any)?.returnTo || '/profile'

  const isBusy = busy || isAuthenticating

  if (user) return <Navigate to={returnTo} replace />

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate(returnTo)
      } else {
        const signedIn = await signUp(email, password, username.trim(), displayName.trim())
        if (signedIn) navigate(returnTo)
        else setMessage('Check your email to confirm the account, then sign in.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to authenticate.')
    } finally {
      setBusy(false)
    }
  }

  const startSocialSignIn = async (provider: 'google' | 'discord'): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await signInWithProvider(provider)
      setMessage(
        `Complete sign-in with ${provider === 'google' ? 'Google' : 'Discord'} in your browser.`
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start social sign-in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 min-h-full w-full items-center justify-center px-4 sm:px-6 py-6 pb-36 md:py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated text-text">
            {mode === 'login' ? <LockKeyhole className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text">
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="text-sm text-text-muted">Felo online</p>
          </div>
        </div>

        {!configured ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            Supabase is not configured. Add the values from{' '}
            <span className="font-mono">.env.example</span> to{' '}
            <span className="font-mono">.env</span>.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void startSocialSignIn('google')}
                className="flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm font-semibold text-text hover:bg-surface-elevated disabled:opacity-50 cursor-pointer"
              >
                <span className="text-base font-bold" aria-hidden="true">
                  G
                </span>
                Google
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void startSocialSignIn('discord')}
                className="flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface text-sm font-semibold text-text hover:bg-surface-elevated disabled:opacity-50 cursor-pointer"
              >
                <MessageCircle className="h-4 w-4" />
                Discord
              </button>
            </div>
            <div className="my-5 flex items-center gap-3 text-xs font-semibold text-text-muted">
              <span className="h-px flex-1 bg-border" />
              OR
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <label className="block text-sm font-semibold text-text">
                    Display name
                    <input
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-white/40"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-text">
                    Username
                    <input
                      required
                      minLength={3}
                      maxLength={24}
                      pattern="[a-zA-Z0-9_]+"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-white/40"
                    />
                  </label>
                </>
              )}
              <label className="block text-sm font-semibold text-text">
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-white/40"
                />
              </label>
              <label className="block text-sm font-semibold text-text">
                Password
                <input
                  required
                  minLength={6}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-white/40"
                />
              </label>
              {(error || authError) && <p className="text-sm text-danger">{error || authError}</p>}
              {isAuthenticating && (
                <div className="flex items-center gap-2 text-sm text-accent">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Completing sign-in...</span>
                </div>
              )}
              {message && !isAuthenticating && <p className="text-sm text-text-muted">{message}</p>}
              <button
                disabled={isBusy}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-text py-3 text-sm font-bold text-canvas hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'login' ? 'Sign in' : 'Register'}
              </button>
            </form>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
            setMessage('')
            clearAuthError()
          }}
          className="mt-5 w-full text-center text-sm font-semibold text-text-muted hover:text-text cursor-pointer"
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
