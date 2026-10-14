import { type ReactElement, useEffect, useState } from 'react'
import {
  Clock3,
  ExternalLink,
  Loader2,
  MessageCircle,
  UserCheck,
  UserPlus,
  UserX,
  X
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { getSupabase } from '../../lib/supabase'
import type { FriendRequest, OnlineProfile } from '../../online/types'

interface RoomMemberProfileModalProps {
  userId: string
  initialProfile?: {
    id: string
    displayName: string
    avatarUrl: string | null
    username?: string
  }
  isHost?: boolean
  onClose: () => void
}

export default function RoomMemberProfileModal({
  userId,
  initialProfile,
  isHost = false,
  onClose
}: RoomMemberProfileModalProps): ReactElement {
  const { user } = useOnlineStore()
  const [profile, setProfile] = useState<OnlineProfile | null>(null)
  const [relationship, setRelationship] = useState<FriendRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  const isSelf = user?.id === userId

  useEffect(() => {
    let cancelled = false
    const loadProfileAndRelationship = async () => {
      setLoading(true)
      setError('')
      const supabase = getSupabase()

      try {
        const [profileRes, requestRes] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
          user
            ? supabase
                .from('friend_requests')
                .select('*')
                .or(
                  `and(requester_id.eq.${user.id},addressee_id.eq.${userId}),and(requester_id.eq.${userId},addressee_id.eq.${user.id})`
                )
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null })
        ])

        if (cancelled) return

        if (profileRes.error) throw profileRes.error
        if (profileRes.data) {
          setProfile(profileRes.data as OnlineProfile)
        } else if (initialProfile) {
          setProfile({
            id: initialProfile.id,
            username: initialProfile.username || 'user',
            display_name: initialProfile.displayName,
            avatar_url: initialProfile.avatarUrl,
            bio: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
        }

        if (requestRes.data) {
          setRelationship(requestRes.data as FriendRequest)
        } else {
          setRelationship(null)
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn('Error fetching member profile:', err)
          setError(err?.message || 'Could not load profile information.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProfileAndRelationship()

    return () => {
      cancelled = true
    }
  }, [userId, user?.id, initialProfile])

  const handleSendFriendRequest = async () => {
    if (!user || isSelf) return
    setBusy(true)
    setError('')
    try {
      const supabase = getSupabase()
      const { data, error: insertError } = await supabase
        .from('friend_requests')
        .insert({
          requester_id: user.id,
          addressee_id: userId,
          status: 'pending'
        })
        .select('*')
        .single()

      if (insertError) throw insertError
      setRelationship(data as FriendRequest)
      setFeedback('Friend request sent!')
      setTimeout(() => setFeedback(''), 3000)
    } catch (err: any) {
      setError(err?.message || 'Failed to send friend request.')
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptFriendRequest = async () => {
    if (!relationship || !user) return
    setBusy(true)
    setError('')
    try {
      const supabase = getSupabase()
      const { data, error: updateError } = await supabase
        .from('friend_requests')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', relationship.id)
        .select('*')
        .single()

      if (updateError) throw updateError
      setRelationship(data as FriendRequest)
      setFeedback('You are now friends!')
      setTimeout(() => setFeedback(''), 3000)
    } catch (err: any) {
      setError(err?.message || 'Failed to accept friend request.')
    } finally {
      setBusy(false)
    }
  }

  const handleCancelFriendRequest = async () => {
    if (!relationship) return
    setBusy(true)
    setError('')
    try {
      const supabase = getSupabase()
      const { error: deleteError } = await supabase
        .from('friend_requests')
        .delete()
        .eq('id', relationship.id)

      if (deleteError) throw deleteError
      setRelationship(null)
      setFeedback('Friend request cancelled.')
      setTimeout(() => setFeedback(''), 3000)
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel friend request.')
    } finally {
      setBusy(false)
    }
  }

  const displayName = profile?.display_name || initialProfile?.displayName || 'User'
  const username = profile?.username || initialProfile?.username || ''
  const avatarUrl = profile?.avatar_url || initialProfile?.avatarUrl

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        {/* Header / Close */}
        <div className="flex items-center justify-between pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Member Profile
            </span>
            {isHost && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400">
                Host
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-text-muted hover:bg-hover hover:text-text transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Profile Card Body */}
        <div className="mt-5 flex flex-col items-center text-center">
          {/* Avatar */}
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-border bg-surface-elevated text-2xl font-black text-text shadow-lg">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              displayName.slice(0, 1).toUpperCase()
            )}
            {relationship?.status === 'accepted' && (
              <span
                className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-white text-black"
                title="Friends"
              >
                <UserCheck className="h-3.5 w-3.5" />
              </span>
            )}
          </div>

          {/* Name & Username */}
          <h3 className="mt-3 text-lg font-black text-text">{displayName}</h3>
          {username && (
            <p className="text-xs font-semibold text-text-muted">@{username}</p>
          )}

          {profile?.bio && (
            <p className="mt-2.5 text-xs text-text-muted max-w-xs line-clamp-3 italic">
              "{profile.bio}"
            </p>
          )}

          {/* Feedback & Error messages */}
          {feedback && (
            <div className="mt-3 rounded-lg border border-border/60 bg-surface-elevated px-3 py-1.5 text-xs font-medium text-text">
              {feedback}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-bold text-danger">
              {error}
            </div>
          )}

          {/* Relationship Actions */}
          <div className="mt-6 w-full space-y-2">
            {loading ? (
              <div className="flex h-10 w-full items-center justify-center text-text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : isSelf ? (
              <div className="rounded-xl border border-border bg-surface-elevated py-2.5 text-xs font-bold text-text-muted">
                This is you
              </div>
            ) : relationship?.status === 'accepted' ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-surface-elevated py-2.5 text-xs font-medium text-text">
                  <UserCheck className="h-4 w-4" />
                  <span>Friends</span>
                </div>
                <NavLink
                  to={`/chat`}
                  onClick={onClose}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-elevated px-4 py-2.5 text-xs font-bold text-text hover:bg-hover transition-colors"
                  title="Direct Message"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>Chat</span>
                </NavLink>
              </div>
            ) : relationship?.status === 'pending' ? (
              relationship.requester_id === user?.id ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2.5 text-xs font-bold text-amber-400">
                    <Clock3 className="h-4 w-4" />
                    <span>Friend Request Pending</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelFriendRequest}
                    disabled={busy}
                    className="flex items-center justify-center rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs font-bold text-danger hover:bg-danger hover:text-white transition-colors disabled:opacity-50"
                    title="Cancel request"
                  >
                    <UserX className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAcceptFriendRequest}
                  disabled={busy}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-xs font-black text-black transition-all hover:bg-white/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                  <span>Accept Friend Request</span>
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={handleSendFriendRequest}
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-xs font-black text-black transition-all hover:bg-white/90 disabled:opacity-50 cursor-pointer"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                <span>Add Friend</span>
              </button>
            )}

            {/* View Full Profile Link */}
            {username && (
              <NavLink
                to={`/profile/${encodeURIComponent(username)}`}
                onClick={onClose}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-elevated text-xs font-bold text-text hover:bg-hover transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
                <span>View Full Profile</span>
              </NavLink>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
