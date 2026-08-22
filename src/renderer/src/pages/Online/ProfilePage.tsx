import { FormEvent, type ReactElement, useState } from 'react'
import { Check, Loader2, LogOut, UserRound } from 'lucide-react'
import OnlineGate from '../../components/Online/OnlineGate'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import type { OnlineProfile } from '../../online/types'

function ProfileEditor({ initialProfile }: { initialProfile: OnlineProfile }): ReactElement {
  const { user, updateProfile, signOut } = useOnlineStore()
  const [username, setUsername] = useState(initialProfile.username)
  const [displayName, setDisplayName] = useState(initialProfile.display_name)
  const [bio, setBio] = useState(initialProfile.bio)
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatar_url || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await updateProfile({
        username,
        display_name: displayName,
        bio,
        avatar_url: avatarUrl || null
      })
      setMessage('Profile saved')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-7">
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-surface-elevated">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-8 w-8 text-text-muted" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text">{initialProfile.display_name}</h1>
            <p className="text-sm text-text-muted">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={() => void signOut()}
          className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-bold text-text-muted hover:bg-hover hover:text-text"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
      <form onSubmit={save} className="mt-7 grid grid-cols-2 gap-5">
        <label className="text-sm font-semibold text-text">
          Display name
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
          />
        </label>
        <label className="text-sm font-semibold text-text">
          Username
          <input
            required
            pattern="[a-zA-Z0-9_]+"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
          />
        </label>
        <label className="col-span-2 text-sm font-semibold text-text">
          Avatar URL
          <input
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
          />
        </label>
        <label className="col-span-2 text-sm font-semibold text-text">
          Bio
          <textarea
            rows={4}
            maxLength={240}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="mt-2 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
          />
        </label>
        <div className="col-span-2 flex items-center gap-3">
          <button
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-text px-5 py-2.5 text-sm font-bold text-canvas disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save profile
          </button>
          {message && <span className="text-sm text-text-muted">{message}</span>}
        </div>
      </form>
    </div>
  )
}

export default function ProfilePage(): ReactElement {
  const profile = useOnlineStore((state) => state.profile)
  return (
    <OnlineGate>
      {profile ? (
        <ProfileEditor key={profile.updated_at} initialProfile={profile} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-success" />
        </div>
      )}
    </OnlineGate>
  )
}
