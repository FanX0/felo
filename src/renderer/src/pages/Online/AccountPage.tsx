import { FormEvent, type ReactElement, useState } from 'react'
import { Loader2, LockKeyhole, UserPlus } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'

export default function AccountPage(): ReactElement {
  const { configured, user, signIn, signUp } = useOnlineStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  if (user) return <Navigate to="/profile" replace />

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate('/profile')
      } else {
        const signedIn = await signUp(email, password, username.trim(), displayName.trim())
        if (signedIn) navigate('/profile')
        else setMessage('Check your email to confirm the account, then sign in.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to authenticate.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated text-text">
            {mode === 'login' ? (
              <LockKeyhole className="h-5 w-5" />
            ) : (
              <UserPlus className="h-5 w-5" />
            )}
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
          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <>
                <label className="block text-sm font-semibold text-text">
                  Display name
                  <input
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
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
                    className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
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
                className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
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
                className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
              />
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            {message && <p className="text-sm text-success">{message}</p>}
            <button
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-text py-3 text-sm font-bold text-canvas hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'Sign in' : 'Register'}
            </button>
          </form>
        )}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
            setMessage('')
          }}
          className="mt-5 w-full text-center text-sm font-semibold text-text-muted hover:text-text"
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
