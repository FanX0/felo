import { FormEvent, type ReactElement, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  UserPlus
} from 'lucide-react'
import { Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import DiscordIcon from '../../components/Common/DiscordIcon'
import GoogleIcon from '../../components/Common/GoogleIcon'

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
  const [showPassword, setShowPassword] = useState(false)
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
    <div className="flex-1 w-full min-h-full flex flex-col items-center justify-center px-4 sm:px-6 py-6 pb-20 sm:py-10">
      <div className="w-full max-w-md sm:border sm:border-white/10 sm:bg-surface/50 sm:backdrop-blur-xl sm:p-8 sm:rounded-2xl sm:shadow-2xl my-auto transition-all">
        {/* Header - Centered & Branded */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-elevated/80 border border-white/10 shadow-lg text-white ring-1 ring-white/5 transition-transform hover:scale-105">
            {mode === 'login' ? (
              <LockKeyhole className="h-6 w-6 text-white" />
            ) : (
              <UserPlus className="h-6 w-6 text-white" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text">
            {mode === 'login' ? 'Welcome back' : 'Create an account'}
          </h1>
          <p className="mt-2 text-sm text-text-muted max-w-xs">
            {mode === 'login'
              ? 'Sign in to access your library, playlists, and friends'
              : 'Sign up to discover music and listen together'}
          </p>
        </div>

        {!configured ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            Supabase is not configured. Add the values from{' '}
            <span className="font-mono">.env.example</span> to{' '}
            <span className="font-mono">.env</span>.
          </div>
        ) : (
          <>
            {/* Social Auth Providers */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void startSocialSignIn('google')}
                className="flex h-11 items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-surface/80 text-sm font-semibold text-text hover:bg-surface-elevated hover:border-white/20 active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>Google</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void startSocialSignIn('discord')}
                className="flex h-11 items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-surface/80 text-sm font-semibold text-text hover:bg-surface-elevated hover:border-white/20 active:scale-[0.98] disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <DiscordIcon className="h-4 w-4 text-[#5865F2]" />
                <span>Discord</span>
              </button>
            </div>

            {/* Divider */}
            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider font-semibold text-text-muted/60">
              <span className="h-px flex-1 bg-white/10" />
              <span>or continue with email</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* Form */}
            <form onSubmit={submit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label
                      htmlFor="displayName"
                      className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                    >
                      Display name
                    </label>
                    <input
                      id="displayName"
                      required
                      placeholder="Your name"
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-surface/60 px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="username"
                      className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                    >
                      Username
                    </label>
                    <input
                      id="username"
                      required
                      minLength={3}
                      maxLength={24}
                      pattern="[a-zA-Z0-9_]+"
                      placeholder="username"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-surface/60 px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                    />
                  </div>
                </>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                >
                  Email
                </label>
                <input
                  id="email"
                  required
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-surface/60 px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wider text-text-muted mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    required
                    minLength={6}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={mode === 'login' ? '••••••••' : 'At least 6 characters'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-surface/60 pl-3.5 pr-10 py-2.5 text-sm text-text placeholder:text-text-muted/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white transition-colors cursor-pointer p-0.5"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {(error || authError) && (
                <div className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs sm:text-sm text-danger animate-in fade-in duration-150">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error || authError}</span>
                </div>
              )}

              {isAuthenticating && (
                <div className="flex items-center justify-center gap-2 text-sm text-accent py-1">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Completing sign-in...</span>
                </div>
              )}

              {message && !isAuthenticating && (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs sm:text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{message}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isBusy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-black hover:bg-white/90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all shadow-md mt-2"
              >
                {isBusy && <Loader2 className="h-4 w-4 animate-spin text-black" />}
                <span>{mode === 'login' ? 'Sign in' : 'Create account'}</span>
              </button>
            </form>
          </>
        )}

        {/* Footer Toggle */}
        <div className="mt-6 text-center text-sm text-text-muted">
          {mode === 'login' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register')
                  setError('')
                  setMessage('')
                  clearAuthError()
                }}
                className="font-semibold text-white hover:underline cursor-pointer ml-1"
              >
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setError('')
                  setMessage('')
                  clearAuthError()
                }}
                className="font-semibold text-white hover:underline cursor-pointer ml-1"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
