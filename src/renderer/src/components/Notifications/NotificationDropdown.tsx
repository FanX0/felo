import { type ReactElement, useEffect, useRef, useState } from 'react'
import {
  Bell,
  Check,
  Headphones,
  Music2,
  Radio,
  RefreshCw,
  X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useListeningStore } from '../../stores/listening'
import { getSupabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'

interface NotificationDropdownProps {
  isOpen: boolean
  onClose: () => void
  isMobile?: boolean
  className?: string
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'Just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  return `${days}d ago`
}

export default function NotificationDropdown({
  isOpen,
  onClose,
  isMobile = false,
  className
}: NotificationDropdownProps): ReactElement | null {
  const navigate = useNavigate()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const {
    invitations,
    incomingFriendRequests,
    profiles,
    isLoading,
    loadNotifications,
    acceptRoomInvitation,
    declineRoomInvitation
  } = useNotificationStore()

  const joinRoomByCode = useListeningStore((s) => s.joinRoomByCode)
  const [activeTab, setActiveTab] = useState<'all' | 'rooms' | 'friends'>('all')
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleJoinRoom = async (invitationId: string, roomCode: string) => {
    setProcessingId(invitationId)
    try {
      await acceptRoomInvitation(invitationId)
      onClose()
      // Navigate to online room with query param or trigger join
      navigate(`/online/listen?code=${encodeURIComponent(roomCode)}`)
      void joinRoomByCode(roomCode)
    } catch (err) {
      console.error('Failed to join invited room:', err)
    } finally {
      setProcessingId(null)
    }
  }

  const handleDeclineRoom = async (invitationId: string) => {
    setProcessingId(invitationId)
    try {
      await declineRoomInvitation(invitationId)
    } finally {
      setProcessingId(null)
    }
  }

  const handleAcceptFriend = async (requestId: string) => {
    setProcessingId(requestId)
    try {
      const supabase = getSupabase()
      await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', requestId)
      await loadNotifications()
    } catch (err) {
      console.error('Failed to accept friend request:', err)
    } finally {
      setProcessingId(null)
    }
  }

  const handleDeclineFriend = async (requestId: string) => {
    setProcessingId(requestId)
    try {
      const supabase = getSupabase()
      await supabase.from('friend_requests').delete().eq('id', requestId)
      await loadNotifications()
    } catch (err) {
      console.error('Failed to decline friend request:', err)
    } finally {
      setProcessingId(null)
    }
  }

  const filteredInvitations =
    activeTab === 'friends' ? [] : invitations

  const filteredFriendRequests =
    activeTab === 'rooms' ? [] : incomingFriendRequests

  const totalCount = invitations.length + incomingFriendRequests.length

  const menuContent = (
    <div
      ref={dropdownRef}
      role="dialog"
      aria-label="Notifications"
      className={cn(
        'bg-surface-elevated/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl z-[100] animate-in fade-in flex flex-col overflow-hidden text-text select-none',
        isMobile
          ? 'fixed top-[calc(3.5rem+env(safe-area-inset-top,0px)+6px)] left-3 right-3 max-h-[80vh] shadow-black/60 slide-in-from-top-2 duration-150'
          : 'absolute right-0 top-full mt-2 w-96 max-h-[540px] shadow-2xl slide-in-from-top-1',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-surface/50">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-amber/15 text-primary-amber">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold leading-none text-text">Notifications</h3>
            <p className="text-[11px] text-text-muted mt-0.5">
              {totalCount > 0 ? `${totalCount} pending` : 'All caught up'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void loadNotifications()}
            title="Refresh notifications"
            className="h-7 w-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </button>
          {isMobile && (
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs if there are multiple types */}
      {totalCount > 0 && (
        <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-border/40 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={cn(
              'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer',
              activeTab === 'all'
                ? 'bg-hover text-text shadow-xs'
                : 'text-text-muted hover:text-text'
            )}
          >
            All ({totalCount})
          </button>
          {invitations.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('rooms')}
              className={cn(
                'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5',
                activeTab === 'rooms'
                  ? 'bg-hover text-text shadow-xs'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <span>Rooms</span>
              <span className="h-4 px-1 rounded-full bg-primary-amber/20 text-primary-amber text-[10px] font-black">
                {invitations.length}
              </span>
            </button>
          )}
          {incomingFriendRequests.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('friends')}
              className={cn(
                'px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5',
                activeTab === 'friends'
                  ? 'bg-hover text-text shadow-xs'
                  : 'text-text-muted hover:text-text'
              )}
            >
              <span>Friends</span>
              <span className="h-4 px-1 rounded-full bg-secondary-cyan/20 text-secondary-cyan text-[10px] font-black">
                {incomingFriendRequests.length}
              </span>
            </button>
          )}
        </div>
      )}

      {/* List content */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/30 p-2 space-y-2">
        {totalCount === 0 ? (
          <div className="py-12 px-6 text-center flex flex-col items-center justify-center">
            <div className="h-12 w-12 rounded-2xl bg-surface border border-border/80 flex items-center justify-center text-text-muted mb-3 shadow-inner">
              <Radio className="h-6 w-6 text-text-muted/60" />
            </div>
            <p className="text-sm font-bold text-text">No new notifications</p>
            <p className="text-xs text-text-muted mt-1 max-w-[240px]">
              When a host invites you to a listening room or friends send requests, they'll show up here.
            </p>
          </div>
        ) : (
          <>
            {/* Room Invitations */}
            {filteredInvitations.map((inv) => {
              const inviter = inv.inviter || profiles[inv.inviter_id]
              const room = inv.room
              const isBusy = processingId === inv.id

              return (
                <div
                  key={inv.id}
                  className="rounded-xl border border-primary-amber/20 bg-gradient-to-br from-primary-amber/10 via-surface/60 to-surface p-3 transition-all hover:border-primary-amber/40 shadow-xs"
                >
                  <div className="flex items-start gap-3">
                    {/* Inviter Avatar */}
                    <div className="relative h-10 w-10 shrink-0 rounded-full border border-border bg-surface-elevated overflow-hidden text-xs font-black flex items-center justify-center text-text">
                      {inviter?.avatar_url ? (
                        <img
                          src={inviter.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        inviter?.display_name?.slice(0, 1).toUpperCase() || 'H'
                      )}
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 border border-canvas" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-text truncate">
                          {inviter?.display_name || 'A friend'}
                        </p>
                        <span className="text-[10px] text-text-muted font-medium shrink-0">
                          {formatTimeAgo(inv.created_at)}
                        </span>
                      </div>

                      <p className="text-xs text-text-muted mt-0.5">
                        invited you to join{' '}
                        <span className="font-bold text-text">
                          "{room?.name || 'Listening Room'}"
                        </span>
                      </p>

                      {/* Room Details Card */}
                      <div className="mt-2 rounded-lg bg-surface/80 border border-border/60 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold tracking-wider text-primary-amber uppercase">
                            Room {room?.code || ''}
                          </span>
                          {room?.is_playing && (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Live
                            </span>
                          )}
                        </div>

                        {room?.song ? (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-text truncate">
                            <Music2 className="h-3.5 w-3.5 text-primary-amber shrink-0 animate-spin-slow" />
                            <span className="font-medium truncate">
                              {room.song.title} <span className="text-text-muted">· {room.song.artist}</span>
                            </span>
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted truncate">
                            <Headphones className="h-3 w-3 shrink-0" />
                            <span>Waiting for music...</span>
                          </div>
                        )}
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleJoinRoom(inv.id, room?.code || '')}
                          className="flex-1 h-8 rounded-lg bg-primary-amber text-canvas text-xs font-black flex items-center justify-center gap-1.5 hover:bg-primary-amber/90 active:scale-95 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          <Headphones className="h-3.5 w-3.5" />
                          <span>Join Room</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDeclineRoom(inv.id)}
                          className="h-8 px-3 rounded-lg border border-border/80 bg-surface text-text-muted hover:text-text hover:bg-hover text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Friend Requests */}
            {filteredFriendRequests.map((fr) => {
              const requester = profiles[fr.requester_id]
              const isBusy = processingId === fr.id

              return (
                <div
                  key={fr.id}
                  className="rounded-xl border border-secondary-cyan/20 bg-gradient-to-br from-secondary-cyan/10 via-surface/60 to-surface p-3 transition-all hover:border-secondary-cyan/40 shadow-xs"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative h-10 w-10 shrink-0 rounded-full border border-border bg-surface-elevated overflow-hidden text-xs font-black flex items-center justify-center text-text">
                      {requester?.avatar_url ? (
                        <img
                          src={requester.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        requester?.display_name?.slice(0, 1).toUpperCase() || 'U'
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-text truncate">
                          {requester?.display_name || 'Someone'}
                        </p>
                        <span className="text-[10px] text-text-muted font-medium shrink-0">
                          {formatTimeAgo(fr.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">
                        sent you a friend request
                      </p>

                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleAcceptFriend(fr.id)}
                          className="flex-1 h-8 rounded-lg bg-secondary-cyan text-canvas text-xs font-black flex items-center justify-center gap-1.5 hover:bg-secondary-cyan/90 active:scale-95 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Accept</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDeclineFriend(fr.id)}
                          className="h-8 px-3 rounded-lg border border-border/80 bg-surface text-text-muted hover:text-text hover:bg-hover text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-150"
          onClick={onClose}
          onTouchStart={onClose}
          aria-hidden="true"
        />
        {menuContent}
      </>
    )
  }

  return menuContent
}
