import { FormEvent, type ReactElement, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Clock3,
  ListMusic,
  Loader2,
  LogOut,
  Radio,
  Settings,
  UserMinus,
  UserPlus,
  UserRound,
  X
} from 'lucide-react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import OnlineGate from '../../components/Online/OnlineGate'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { getSupabase } from '../../lib/supabase'
import type {
  FriendRequest,
  ListeningRoom,
  OnlineProfile,
  SharedPlaylist
} from '../../online/types'

function ProfileAvatar({
  profile,
  large = false
}: {
  profile: OnlineProfile
  large?: boolean
}): ReactElement {
  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-surface-elevated font-black text-text-muted shadow-2xl ${large ? 'h-40 w-40 text-5xl sm:h-48 sm:w-48' : 'h-11 w-11 text-base'}`}
    >
      {profile.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{profile.display_name.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  )
}

function ProfileEditor({
  initialProfile,
  onClose
}: {
  initialProfile: OnlineProfile
  onClose: () => void
}): ReactElement {
  const { updateProfile, signOut } = useOnlineStore()
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
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 no-drag"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-profile-title"
    >
      <form
        onSubmit={save}
        className="w-full max-w-xl rounded-lg border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="edit-profile-title" className="text-xl font-black text-text">
            Edit profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-text">
            Display name
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-border bg-canvas px-3 font-normal outline-none focus:border-success"
            />
          </label>
          <label className="text-sm font-bold text-text">
            Username
            <input
              required
              pattern="[a-zA-Z0-9_]+"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-border bg-canvas px-3 font-normal outline-none focus:border-success"
            />
          </label>
          <label className="text-sm font-bold text-text sm:col-span-2">
            Avatar URL
            <input
              type="url"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-border bg-canvas px-3 font-normal outline-none focus:border-success"
            />
          </label>
          <label className="text-sm font-bold text-text sm:col-span-2">
            Bio
            <textarea
              rows={3}
              maxLength={240}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              className="mt-2 w-full resize-none rounded-md border border-border bg-canvas px-3 py-2.5 font-normal outline-none focus:border-success"
            />
          </label>
        </div>
        {message && <p className="mt-4 text-sm text-danger">{message}</p>}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center gap-2 text-sm font-bold text-text-muted hover:text-danger"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-black text-text hover:bg-hover"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              className="flex items-center gap-2 rounded-full bg-text px-5 py-2.5 text-sm font-black text-canvas disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{' '}
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function ProfileWorkspace(): ReactElement {
  const { username } = useParams<{ username?: string }>()
  const navigate = useNavigate()
  const { user, profile: ownProfile } = useOnlineStore()
  const [viewedProfile, setViewedProfile] = useState<OnlineProfile | null>(null)
  const [relationship, setRelationship] = useState<FriendRequest | null>(null)
  const [playlists, setPlaylists] = useState<SharedPlaylist[]>([])
  const [friendCount, setFriendCount] = useState(0)
  const [friendRoom, setFriendRoom] = useState<ListeningRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const isOwnProfile = Boolean(viewedProfile && user && viewedProfile.id === user.id)

  const loadFriendRoom = async (profileId: string): Promise<ListeningRoom | null> => {
    const activeSince = new Date(Date.now() - 20_000).toISOString()
    const { data, error: roomError } = await getSupabase()
      .from('listening_rooms')
      .select('*')
      .eq('host_id', profileId)
      .eq('is_active', true)
      .eq('is_playing', true)
      .gte('updated_at', activeSince)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (roomError) throw roomError
    const nextRoom = (data as ListeningRoom | null) || null
    setFriendRoom(nextRoom)
    return nextRoom
  }

  const loadProfile = async (): Promise<void> => {
    if (!user || !ownProfile) return
    setLoading(true)
    setError('')
    try {
      let nextProfile = ownProfile
      if (username && username.toLowerCase() !== ownProfile.username.toLowerCase()) {
        const { data, error: profileError } = await getSupabase()
          .from('profiles')
          .select('*')
          .eq('username', username.toLowerCase())
          .maybeSingle()
        if (profileError) throw profileError
        if (!data) {
          setViewedProfile(null)
          setRelationship(null)
          setPlaylists([])
          setFriendRoom(null)
          return
        }
        nextProfile = data as OnlineProfile
      }
      const [relationshipsResult, playlistsResult] = await Promise.all([
        getSupabase()
          .from('friend_requests')
          .select('*')
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
        getSupabase().from('shared_playlists').select('*').order('updated_at', { ascending: false })
      ])
      if (relationshipsResult.error) throw relationshipsResult.error
      if (playlistsResult.error) throw playlistsResult.error
      const relationships = (relationshipsResult.data || []) as FriendRequest[]
      const pair = relationships.find(
        (request) =>
          request.requester_id === nextProfile.id || request.addressee_id === nextProfile.id
      )
      setViewedProfile(nextProfile)
      setRelationship(nextProfile.id === user.id ? null : pair || null)
      setFriendCount(
        nextProfile.id === user.id
          ? relationships.filter((request) => request.status === 'accepted').length
          : 0
      )
      setPlaylists(
        ((playlistsResult.data || []) as SharedPlaylist[]).filter(
          (playlist) => playlist.owner_id === nextProfile.id
        )
      )
      if (nextProfile.id !== user.id) await loadFriendRoom(nextProfile.id)
      else setFriendRoom(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load profile.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfile(), 0)
    return () => window.clearTimeout(timer)
  }, [username, user?.id, ownProfile?.updated_at])

  useEffect(() => {
    if (!viewedProfile || isOwnProfile) return
    const supabase = getSupabase()
    const channel = supabase
      .channel(`profile-listening:${viewedProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_rooms',
          filter: `host_id=eq.${viewedProfile.id}`
        },
        () => void loadFriendRoom(viewedProfile.id).catch(() => setFriendRoom(null))
      )
      .subscribe()
    const timer = window.setInterval(
      () => void loadFriendRoom(viewedProfile.id).catch(() => setFriendRoom(null)),
      10_000
    )
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [isOwnProfile, viewedProfile?.id])

  const actionLabel = useMemo(() => {
    if (!relationship) return 'Add friend'
    if (relationship.status === 'accepted') return 'Remove friend'
    return relationship.addressee_id === user?.id ? 'Accept request' : 'Cancel request'
  }, [relationship, user?.id])

  const removeRelationship = async (): Promise<void> => {
    if (!relationship) return
    const { error: deleteError } = await getSupabase()
      .from('friend_requests')
      .delete()
      .eq('id', relationship.id)
    if (deleteError) throw deleteError
  }

  const runFriendAction = async (): Promise<void> => {
    if (!user || !viewedProfile || isOwnProfile) return
    setBusy(true)
    setError('')
    try {
      if (!relationship) {
        const { error: insertError } = await getSupabase()
          .from('friend_requests')
          .insert({ requester_id: user.id, addressee_id: viewedProfile.id, status: 'pending' })
        if (insertError) throw insertError
      } else if (relationship.status === 'pending' && relationship.addressee_id === user.id) {
        const { error: updateError } = await getSupabase()
          .from('friend_requests')
          .update({ status: 'accepted' })
          .eq('id', relationship.id)
        if (updateError) throw updateError
      } else {
        await removeRelationship()
      }
      await loadProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Friend action failed.')
    } finally {
      setBusy(false)
    }
  }

  const declineRequest = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await removeRelationship()
      await loadProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not decline request.')
    } finally {
      setBusy(false)
    }
  }

  const listenTogether = async (): Promise<void> => {
    if (!viewedProfile || relationship?.status !== 'accepted') return
    setJoining(true)
    setError('')
    try {
      const activeRoom = await loadFriendRoom(viewedProfile.id)
      if (!activeRoom) throw new Error(`${viewedProfile.display_name} is not playing right now.`)
      navigate(`/listen-together?room=${encodeURIComponent(activeRoom.id)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join this listening session.')
    } finally {
      setJoining(false)
    }
  }

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-success" />
      </div>
    )
  if (!viewedProfile) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <UserRound className="h-12 w-12 text-text-muted" />
        <h1 className="mt-4 text-2xl font-black text-text">Profile not found</h1>
        <NavLink
          to="/profile"
          className="mt-5 rounded-full bg-text px-5 py-2.5 text-sm font-black text-canvas"
        >
          Back to your profile
        </NavLink>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <header className="flex min-h-[300px] items-end bg-[#363839] px-6 pb-7 pt-12 sm:px-10">
        <div className="flex min-w-0 flex-col items-center gap-6 sm:flex-row sm:items-end">
          <ProfileAvatar profile={viewedProfile} large />
          <div className="min-w-0 pb-2 text-center sm:text-left">
            <p className="text-sm font-black text-white">Profile</p>
            <h1 className="mt-1 max-w-full break-words text-4xl font-black text-white sm:text-6xl lg:text-7xl">
              {viewedProfile.display_name}
            </h1>
            {viewedProfile.bio && (
              <p className="mt-3 max-w-2xl text-sm text-white/75">{viewedProfile.bio}</p>
            )}
            <p className="mt-4 text-sm font-bold text-white/80">
              @{viewedProfile.username} <span className="mx-1 text-white/40">•</span>{' '}
              {playlists.length} online {playlists.length === 1 ? 'playlist' : 'playlists'}
              {isOwnProfile && (
                <>
                  <span className="mx-1 text-white/40">•</span>
                  {friendCount} {friendCount === 1 ? 'friend' : 'friends'}
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <main className="min-h-[420px] px-6 py-6 sm:px-10">
        <div className="flex min-h-12 items-center gap-3">
          {isOwnProfile ? (
            <>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="Edit profile"
                className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-hover hover:text-text"
              >
                <Settings className="h-6 w-6" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runFriendAction()}
                className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-black disabled:opacity-50 ${relationship?.status === 'accepted' || (relationship?.status === 'pending' && relationship.requester_id === user?.id) ? 'border border-border text-text' : 'bg-success text-black'}`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : relationship?.status === 'accepted' ? (
                  <UserMinus className="h-4 w-4" />
                ) : relationship?.status === 'pending' && relationship.requester_id === user?.id ? (
                  <Clock3 className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {actionLabel}
              </button>
              {relationship?.status === 'pending' && relationship.addressee_id === user?.id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declineRequest()}
                  className="h-10 rounded-full border border-border px-5 text-sm font-black text-text-muted hover:text-text"
                >
                  Decline
                </button>
              )}
              {relationship?.status === 'accepted' && (
                <button
                  type="button"
                  disabled={joining || !friendRoom}
                  onClick={() => void listenTogether()}
                  title={
                    friendRoom
                      ? `Join ${viewedProfile.display_name}'s session`
                      : `${viewedProfile.display_name} is not listening now`
                  }
                  className="flex h-10 items-center gap-2 rounded-full bg-success px-5 text-sm font-black text-black disabled:cursor-not-allowed disabled:bg-surface-elevated disabled:text-text-muted"
                >
                  {joining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Radio className="h-4 w-4" />
                  )}
                  {friendRoom ? 'Listen together' : 'Not listening now'}
                </button>
              )}
            </>
          )}
        </div>
        {!isOwnProfile && relationship?.status === 'accepted' && friendRoom?.song && (
          <div className="mt-4 flex max-w-xl items-center gap-3 border-y border-border/60 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-text">{friendRoom.song.title}</p>
              <p className="truncate text-xs text-text-muted">
                {friendRoom.song.artist} · Playing now
              </p>
            </div>
          </div>
        )}
        {error && (
          <p className="mt-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
        )}
        <section className="mt-8">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-black text-text">Online playlists</h2>
              <p className="mt-1 text-sm text-text-muted">Playlists available to you</p>
            </div>
            {playlists.length > 0 && (
              <NavLink
                to="/shared-playlists"
                className="text-sm font-black text-text-muted hover:text-text"
              >
                Show all
              </NavLink>
            )}
          </div>
          {playlists.length > 0 ? (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {playlists.slice(0, 5).map((playlist) => (
                <NavLink
                  key={playlist.id}
                  to="/shared-playlists"
                  className="group min-w-0 rounded-md bg-surface p-3 transition-colors hover:bg-hover"
                >
                  <div className="flex aspect-square items-center justify-center rounded-md bg-surface-elevated">
                    <ListMusic className="h-12 w-12 text-text-muted transition-colors group-hover:text-success" />
                  </div>
                  <p className="mt-3 truncate text-sm font-black text-text">{playlist.name}</p>
                  <p className="mt-1 truncate text-xs text-text-muted">
                    {playlist.description || `By ${viewedProfile.display_name}`}
                  </p>
                </NavLink>
              ))}
            </div>
          ) : (
            <div className="mt-5 flex min-h-40 flex-col items-center justify-center border-y border-border/60 text-center">
              <ListMusic className="h-8 w-8 text-text-muted" />
              <p className="mt-3 text-sm font-bold text-text-muted">
                No online playlists are visible
              </p>
            </div>
          )}
        </section>
      </main>
      {isEditing && isOwnProfile && (
        <ProfileEditor
          key={viewedProfile.updated_at}
          initialProfile={viewedProfile}
          onClose={() => setIsEditing(false)}
        />
      )}
    </div>
  )
}

export default function ProfilePage(): ReactElement {
  return (
    <OnlineGate>
      <ProfileWorkspace />
    </OnlineGate>
  )
}
