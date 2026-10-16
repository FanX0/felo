import { type ReactElement, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Clock3,
  LoaderCircle,
  MessageCircle,
  Radio,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
  Music2,
  RefreshCw
} from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { getSupabase } from '../../lib/supabase'
import type { FriendRequest, ListeningRoom, OnlineProfile } from '../../online/types'


interface FriendActivityPanelProps {
  onClose: () => void
}

type FriendProfile = Pick<OnlineProfile, 'id' | 'username' | 'display_name' | 'avatar_url'>

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`
}

function Avatar({
  profile,
  online = false
}: {
  profile: FriendProfile
  online?: boolean
}): ReactElement {
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-visible rounded-full border border-border bg-surface-elevated text-sm font-black text-text-muted">
      {profile.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      ) : (
        profile.display_name.slice(0, 1).toUpperCase()
      )}
      <span
        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-canvas ${
          online ? 'bg-primary' : 'bg-zinc-600'
        }`}
        title={online ? 'Online' : 'Offline'}
      />
    </div>
  )
}

export default function FriendActivityPanel({ onClose }: FriendActivityPanelProps): ReactElement {
  const { configured, user } = useOnlineStore()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FriendProfile[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [profiles, setProfiles] = useState<Record<string, FriendProfile>>({})
  const [activities, setActivities] = useState<Record<string, ListeningRoom>>({})
  const [activityClock, setActivityClock] = useState(() => Date.now())
  const [isSearching, setIsSearching] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const hostRoom = useListeningStore((s) => s.hostRoom)
  const roomMembers = useListeningStore((s) => s.members)
  const sentInvitationsByRoom = useNotificationStore((s) => s.sentInvitationsByRoom)
  const sendRoomInvitation = useNotificationStore((s) => s.sendRoomInvitation)
  const loadSentInvitations = useNotificationStore((s) => s.loadSentInvitations)

  useEffect(() => {
    if (hostRoom?.id) {
      void loadSentInvitations(hostRoom.id)
    }
  }, [hostRoom?.id, loadSentInvitations])


  const loadRelationships = async (): Promise<void> => {
    if (!user) {
      setRequests([])
      setProfiles({})
      return
    }

    setIsLoading(true)
    const supabase = getSupabase()

    // 1. Ensure auth session is loaded so auth.uid() in RLS is non-null
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData?.session?.user) {
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    } catch {
      // ignore
    }

    // 2. Query friend relationships
    let { data, error: requestError } = await supabase
      .from('friend_requests')
      .select('*')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order('updated_at', { ascending: false })

    // If initial query returned empty without error, retry once after a short delay
    // to handle token renewal / reconnect race condition
    if (!requestError && (!data || data.length === 0)) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const retryResult = await supabase
        .from('friend_requests')
        .select('*')
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .order('updated_at', { ascending: false })
      if (!retryResult.error && retryResult.data && retryResult.data.length > 0) {
        data = retryResult.data
      }
    }

    if (requestError) {
      setIsLoading(false)
      throw requestError
    }

    const rows = (data || []) as FriendRequest[]
    const profileIds = [
      ...new Set(
        rows.map((row) => (row.requester_id === user.id ? row.addressee_id : row.requester_id))
      )
    ]
    const profileMap: Record<string, FriendProfile> = {}
    if (profileIds.length > 0) {
      try {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', profileIds)
        if (profileData) {
          ;(profileData as FriendProfile[]).forEach((p) => {
            profileMap[p.id] = p
          })
        }
      } catch (err) {
        console.warn('Failed to load friend profile details:', err)
      }

      // Guarantee fallback profile for any missing profile row so the friend is NEVER omitted
      profileIds.forEach((id) => {
        if (!profileMap[id]) {
          profileMap[id] = {
            id,
            username: `user_${id.slice(0, 8)}`,
            display_name: 'Friend',
            avatar_url: null
          }
        }
      })
    }

    setRequests(rows)
    setProfiles(profileMap)
    setIsLoading(false)
  }

  useEffect(() => {
    if (!configured || !user) return
    const timer = window.setTimeout(() => {
      void loadRelationships().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load friends.')
      })
    }, 0)

    // Polling interval to ensure state updates even if Realtime WebSocket drops
    const pollTimer = window.setInterval(() => {
      void loadRelationships().catch(() => undefined)
    }, 20000)

    const supabase = getSupabase()
    const channel = supabase
      .channel(`friend-activity:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        () => void loadRelationships().catch(() => undefined)
      )
      .subscribe()

    return () => {
      window.clearTimeout(timer)
      window.clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [configured, user?.id])

  useEffect(() => {
    const cleanQuery = query.trim().replace(/[%_]/g, '')
    if (!user || cleanQuery.length < 2) {
      const resetTimer = window.setTimeout(() => {
        setSearchResults([])
        setIsSearching(false)
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setIsSearching(true)
      setError('')
      const supabase = getSupabase()
      const pattern = `%${cleanQuery}%`
      const [usernameResult, displayNameResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', user.id)
          .ilike('username', pattern)
          .limit(8),
        supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', user.id)
          .ilike('display_name', pattern)
          .limit(8)
      ])

      if (cancelled) return
      const searchError = usernameResult.error || displayNameResult.error
      if (searchError) {
        setError(searchError.message)
        setSearchResults([])
      } else {
        const matches = [...(usernameResult.data || []), ...(displayNameResult.data || [])]
        setSearchResults(
          [...new Map(matches.map((profile) => [profile.id, profile])).values()].slice(
            0,
            8
          ) as FriendProfile[]
        )
      }
      setIsSearching(false)
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, user?.id])

  const incoming = useMemo(
    () =>
      requests.filter(
        (request) => request.status === 'pending' && request.addressee_id === user?.id
      ),
    [requests, user?.id]
  )
  const outgoing = useMemo(
    () =>
      requests.filter(
        (request) => request.status === 'pending' && request.requester_id === user?.id
      ),
    [requests, user?.id]
  )
  const friends = useMemo(
    () => requests.filter((request) => request.status === 'accepted'),
    [requests]
  )
  const friendIds = useMemo(
    () =>
      friends.map((request) =>
        request.requester_id === user?.id ? request.addressee_id : request.requester_id
      ),
    [friends, user?.id]
  )
  const requestByProfile = useMemo(() => {
    const map = new Map<string, FriendRequest>()
    requests.forEach((request) => {
      const profileId =
        request.requester_id === user?.id ? request.addressee_id : request.requester_id
      map.set(profileId, request)
    })
    return map
  }, [requests, user?.id])

  useEffect(() => {
    if (!user || friendIds.length === 0) {
      const resetTimer = window.setTimeout(() => setActivities({}), 0)
      return () => window.clearTimeout(resetTimer)
    }

    let cancelled = false
    const loadActivities = async (): Promise<void> => {
      const supabase = getSupabase()
      try {
        const [{ data: hostData, error: hostError }, { data: memberRows }] =
          await Promise.all([
            supabase
              .from('listening_rooms')
              .select('*')
              .in('host_id', friendIds)
              .eq('is_active', true)
              .order('updated_at', { ascending: false }),
            supabase
              .from('listening_room_members')
              .select('user_id, room_id')
              .in('user_id', friendIds)
          ])

        if (hostError) throw hostError
        if (cancelled) return

        const latestByFriend: Record<string, ListeningRoom> = {}
        ;((hostData || []) as ListeningRoom[]).forEach((room) => {
          if (!latestByFriend[room.host_id]) latestByFriend[room.host_id] = room
        })

        // If friends are members in an active room, also load their rooms
        const memberRoomIds = [
          ...new Set(
            (memberRows || [])
              .filter((m: any) => !latestByFriend[m.user_id])
              .map((m: any) => m.room_id)
              .filter(Boolean)
          )
        ]

        if (memberRoomIds.length > 0) {
          const { data: attendedRooms } = await supabase
            .from('listening_rooms')
            .select('*')
            .in('id', memberRoomIds)
            .eq('is_active', true)

          if (attendedRooms && !cancelled) {
            const roomMap = new Map((attendedRooms as ListeningRoom[]).map((r) => [r.id, r]))
            ;(memberRows || []).forEach((m: any) => {
              if (!latestByFriend[m.user_id]) {
                const r = roomMap.get(m.room_id)
                if (r) latestByFriend[m.user_id] = r
              }
            })
          }
        }

        if (!cancelled) {
          setActivities(latestByFriend)
          setActivityClock(Date.now())
        }
      } catch (cause) {
        console.warn('Could not load friend activity:', cause)
      }
    }

    void loadActivities()
    const pollInterval = window.setInterval(() => {
      void loadActivities()
    }, 10000)

    const supabase = getSupabase()
    const channel = supabase
      .channel(`friend-listening:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_rooms' },
        () => void loadActivities().catch(() => undefined)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_room_members' },
        () => void loadActivities().catch(() => undefined)
      )
      .subscribe()
    const clock = window.setInterval(() => setActivityClock(Date.now()), 1000)

    return () => {
      cancelled = true
      window.clearInterval(clock)
      window.clearInterval(pollInterval)
      void supabase.removeChannel(channel)
    }
  }, [friendIds.join(','), user?.id])

  const runAction = async (id: string, action: () => PromiseLike<unknown>): Promise<void> => {
    setBusyId(id)
    setError('')
    try {
      await action()
      await loadRelationships()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Friend action failed.')
    } finally {
      setBusyId('')
    }
  }

  const sendRequest = (profile: FriendProfile): void => {
    if (!user) return
    void runAction(profile.id, async () => {
      const { error: insertError } = await getSupabase().from('friend_requests').insert({
        requester_id: user.id,
        addressee_id: profile.id,
        status: 'pending'
      })
      if (insertError) throw insertError
    })
  }

  const acceptRequest = (request: FriendRequest): void => {
    void runAction(request.id, async () => {
      const { error: updateError } = await getSupabase()
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', request.id)
      if (updateError) throw updateError
    })
  }

  const removeRequest = (request: FriendRequest): void => {
    void runAction(request.id, async () => {
      const { error: deleteError } = await getSupabase()
        .from('friend_requests')
        .delete()
        .eq('id', request.id)
      if (deleteError) throw deleteError
    })
  }

  const profileFor = (request: FriendRequest): FriendProfile | undefined => {
    const profileId =
      request.requester_id === user?.id ? request.addressee_id : request.requester_id
    return profiles[profileId]
  }

  return (
    <aside className="h-full w-[380px] shrink-0 overflow-hidden rounded-xl border border-border/70 bg-canvas shadow-2xl no-drag">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-5 py-5">
          <h2 className="text-lg font-black text-text">Listening activity</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close friend activity"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-text"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 pb-5">
          <div className="mb-2 px-1 text-[11px] font-black uppercase text-text-muted">Online</div>
          <div className="space-y-1">
            {[
              { to: '/chat', label: 'Chat', icon: MessageCircle },

              { to: '/listen-together', label: 'Listen together', icon: Radio }
            ].map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex w-full items-center gap-4 rounded-md px-3 py-3 text-left transition-colors ${
                    isActive
                      ? 'bg-surface-elevated text-text'
                      : 'text-text-muted hover:bg-hover hover:text-text'
                  }`
                }
              >
                <Icon className="h-6 w-6 shrink-0" />
                <span className="truncate text-base font-black">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border-t border-border/60 px-4 pb-5 pt-4">
          {!configured || !user ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
              <Users className="h-8 w-8 text-text-muted" />
              <p className="text-sm font-bold text-text">Sign in to manage friends</p>
              <NavLink
                to="/account"
                className="rounded-full bg-primary hover:bg-primary-hover px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition-all"
              >
                Sign in
              </NavLink>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find friends"
                  aria-label="Find friends"
                  className="h-10 w-full rounded-full border border-border bg-surface pl-9 pr-10 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary"
                />
                {isSearching && (
                  <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-muted" />
                )}
              </div>

              {query.trim().length >= 2 && !isSearching && (
                <div className="mt-3 space-y-1">
                  {searchResults.map((person) => {
                    const relationship = requestByProfile.get(person.id)
                    const isBusy = busyId === person.id
                    return (
                      <div
                        key={person.id}
                        className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover/70"
                      >
                        <NavLink
                          to={`/profile/${encodeURIComponent(person.username)}`}
                          onClick={onClose}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                        >
                          <Avatar profile={person} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-text">
                              {person.display_name}
                            </p>
                            <p className="truncate text-xs text-text-muted">@{person.username}</p>
                          </div>
                        </NavLink>
                        {!relationship ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => sendRequest(person)}
                            title={`Add ${person.display_name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-primary-foreground disabled:opacity-50 shadow-sm"
                          >
                            {isBusy ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserPlus className="h-4 w-4" />
                            )}
                          </button>
                        ) : relationship.status === 'accepted' ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-text-muted">
                            <Check className="h-4 w-4" /> Friend
                          </span>
                        ) : relationship.addressee_id === user.id ? (
                          <button
                            type="button"
                            onClick={() => acceptRequest(relationship)}
                            className="rounded-full bg-primary hover:bg-primary-hover px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm transition-all"
                          >
                            Accept
                          </button>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-bold text-text-muted">
                            <Clock3 className="h-4 w-4" /> Sent
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {searchResults.length === 0 && (
                    <p className="py-5 text-center text-sm text-text-muted">No profiles found</p>
                  )}
                </div>
              )}

              {(incoming.length > 0 || outgoing.length > 0) && (
                <section className="mt-6">
                  <div className="mb-2 px-1 text-[11px] font-black uppercase text-text-muted">
                    Requests
                  </div>
                  <div className="space-y-1">
                    {incoming.map((request) => {
                      const person = profileFor(request)
                      if (!person) return null
                      return (
                        <div
                          key={request.id}
                          className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover/70"
                        >
                          <NavLink
                            to={`/profile/${encodeURIComponent(person.username)}`}
                            onClick={onClose}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          >
                            <Avatar profile={person} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-text">
                                {person.display_name}
                              </p>
                              <p className="truncate text-xs text-text-muted">@{person.username}</p>
                            </div>
                          </NavLink>
                          <button
                            type="button"
                            disabled={busyId === request.id}
                            onClick={() => acceptRequest(request)}
                            title="Accept request"
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary hover:bg-primary-hover text-primary-foreground disabled:opacity-50 shadow-sm"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busyId === request.id}
                            onClick={() => removeRequest(request)}
                            title="Decline request"
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-elevated text-text-muted hover:text-text disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                    {outgoing.map((request) => {
                      const person = profileFor(request)
                      if (!person) return null
                      return (
                        <div
                          key={request.id}
                          className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover/70"
                        >
                          <NavLink
                            to={`/profile/${encodeURIComponent(person.username)}`}
                            onClick={onClose}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          >
                            <Avatar profile={person} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-text">
                                {person.display_name}
                              </p>
                              <p className="truncate text-xs text-text-muted">Request sent</p>
                            </div>
                          </NavLink>
                          <button
                            type="button"
                            disabled={busyId === request.id}
                            onClick={() => removeRequest(request)}
                            title="Cancel request"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted hover:bg-surface-elevated hover:text-text disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="mt-6">
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-black uppercase text-text-muted">
                  <div className="flex items-center gap-2">
                    <span>Friends</span>
                    <span className="rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] font-bold text-text-muted border border-border/40">
                      {friends.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRelationships()}
                    disabled={isLoading}
                    title="Refresh friends and activity"
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
                {isLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <LoaderCircle className="h-5 w-5 animate-spin text-text-muted" />
                  </div>
                ) : friends.length > 0 ? (
                  <div className="space-y-1">
                    {friends.map((request) => {
                      const person = profileFor(request)
                      if (!person) return null
                      const activity = activities[person.id]
                      const updatedAt = activity ? new Date(activity.updated_at).getTime() : 0
                      // Active room liveness: room is active as long as is_active is true (and updated within 2 hours)
                      const isStale = updatedAt > 0 && activityClock - updatedAt > 2 * 60 * 60 * 1000
                      const isRoomReady = Boolean(activity && activity.is_active && !isStale)
                      const isHost = activity?.host_id === person.id
                      const song = isRoomReady && activity.song ? activity.song : null
                      const duration = song?.duration || 0
                      const elapsedSinceUpdate = Math.max(0, (activityClock - updatedAt) / 1000)
                      const position = song
                        ? Math.min(
                            duration || Number.POSITIVE_INFINITY,
                            (activity.position_seconds || 0) + (activity.is_playing ? elapsedSinceUpdate : 0)
                          )
                        : 0
                      const progress = duration > 0 ? Math.min(100, (position / duration) * 100) : 0
                      return (
                        <div
                          key={request.id}
                          className="group flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-hover/70"
                        >
                          <NavLink
                            to={`/profile/${encodeURIComponent(person.username)}`}
                            onClick={onClose}
                            className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          >
                            <Avatar profile={person} online={Boolean(isRoomReady)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="truncate text-sm font-bold text-text">
                                  {person.display_name}
                                </p>
                                {isRoomReady && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-elevated px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-text-muted"
                                    title={isHost ? 'Friend is hosting an active party room' : 'Friend is in an active party room'}
                                  >
                                    <Radio className="h-2.5 w-2.5 animate-pulse text-primary" />
                                    {isHost ? 'Party Host' : 'In Party'}
                                  </span>
                                )}
                              </div>
                              {song ? (
                                <div className="mt-0.5 min-w-0">
                                  <p className="truncate text-xs font-semibold text-text-muted">
                                    {song.title} · {song.artist}
                                  </p>
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <Music2 className="h-3 w-3 shrink-0 text-text-muted" />
                                    <span className="w-9 shrink-0 text-[10px] font-bold tabular-nums text-text-muted">
                                      {formatTime(position)}
                                    </span>
                                    <div className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-surface-elevated border border-border">
                                      <div
                                        className="h-full rounded-full bg-primary"
                                        style={{ width: `${progress}%` }}
                                      />
                                    </div>
                                    <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums text-text-muted">
                                      {formatTime(duration)}
                                    </span>
                                  </div>
                                </div>
                              ) : isRoomReady ? (
                                <p className="truncate text-xs font-medium text-text-muted mt-0.5">
                                  Party room open · Ready to listen
                                </p>
                              ) : (
                                <p className="truncate text-xs text-text-muted">@{person.username}</p>
                              )}
                            </div>
                          </NavLink>
                          {hostRoom?.is_active && hostRoom?.id && !roomMembers.some((m) => m.user_id === person.id) && (
                            sentInvitationsByRoom[hostRoom.id]?.includes(person.id) ? (
                              <span className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-xs font-bold text-text-muted">
                                <Check className="h-3 w-3 text-primary" />
                                Invited
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  void sendRoomInvitation(hostRoom.id, person.id)
                                }}
                                title={`Invite ${person.display_name} to your listening room`}
                                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-elevated hover:bg-hover border border-border px-2.5 text-xs font-bold text-text transition-all cursor-pointer"
                              >
                                <UserPlus className="h-3.5 w-3.5" />
                                Invite
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              navigate(`/chat?friend=${encodeURIComponent(person.id)}`)
                            }}
                            title={`Chat with ${person.display_name}`}
                            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-surface-elevated px-3 text-xs font-bold text-white transition-colors hover:bg-hover"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            Chat
                          </button>
                          {isRoomReady && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose()
                                void useListeningStore.getState().listenAlongWithFriend(person.id)
                                navigate('/listen-together')
                              }}
                              title={`Join ${person.display_name}'s party room directly without entering code`}
                              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover px-3 text-xs font-bold text-primary-foreground transition-all shadow-sm hover:scale-105 active:scale-95"
                            >
                              <Radio className="h-3.5 w-3.5" />
                              Join Party
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyId === request.id}
                            onClick={() => removeRequest(request)}
                            title="Remove friend"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted opacity-0 transition-opacity hover:bg-surface-elevated hover:text-danger group-hover:opacity-100 focus:opacity-100"
                          >
                            <UserMinus className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-center text-text-muted">
                    <Users className="h-6 w-6" />
                    <p className="text-sm font-bold">No friends yet</p>
                  </div>
                )}
              </section>

              {error && (
                <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
