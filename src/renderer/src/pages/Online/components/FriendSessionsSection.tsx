import { type ReactElement } from 'react'
import { RefreshCw, Headphones, Radio } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { LiveFriendSession } from '../types'
import { formatTime } from '../utils'
import Avatar from '../../../components/Common/Avatar'

interface FriendSessionsSectionProps {
  liveFriends: LiveFriendSession[]
  loadingFriends: boolean
  loadLiveFriends: () => void | Promise<void>
  handleListenAlong: (friendId: string, roomId?: string) => void | Promise<void>
  busy: boolean
  currentRoomId?: string | null
  isHost?: boolean
}

export default function FriendSessionsSection({
  liveFriends,
  loadingFriends,
  loadLiveFriends,
  handleListenAlong,
  busy,
  currentRoomId,
  isHost
}: FriendSessionsSectionProps): ReactElement {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-text flex items-center gap-2">
          <span>Friends Listening Right Now</span>
          {liveFriends.length > 0 && (
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border/60">
              {liveFriends.length} Active
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => void loadLiveFriends()}
          disabled={loadingFriends}
          className="flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingFriends ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {liveFriends.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {liveFriends.map(({ profile, room }) => {
            const isCurrentRoom = Boolean(currentRoomId && currentRoomId === room.id)

            return (
              <div
                key={`${room.id}-${profile.id}`}
                className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm transition-all hover:border-border/80"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <NavLink
                      to={`/profile/${encodeURIComponent(profile.username)}`}
                      className="flex items-center gap-3 min-w-0"
                    >
                      <div className="relative shrink-0">
                        <Avatar
                          src={profile.avatar_url}
                          fallbackText={profile.display_name || profile.username}
                          size="md"
                        />
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-text group-hover:text-primary transition-colors">
                          {profile.display_name}
                        </p>
                        <p className="truncate text-[11px] text-text-muted">@{profile.username}</p>
                      </div>
                    </NavLink>

                    <div className="flex items-center gap-1 text-primary">
                      <span className="h-2 w-0.5 animate-pulse bg-primary rounded-full" />
                      <span className="h-3.5 w-0.5 animate-pulse bg-primary rounded-full delay-75" />
                      <span className="h-2.5 w-0.5 animate-pulse bg-primary rounded-full delay-150" />
                    </div>
                  </div>

                  {/* Song Info */}
                  <div className="mt-4 rounded-xl border border-border bg-surface p-3">
                    <p className="truncate text-xs font-bold text-text">
                      {room.song?.title || (room.is_active ? 'Party Room Live' : 'Music Track')}
                    </p>
                    <p className="truncate text-[11px] text-text-muted mt-0.5">
                      {room.song?.artist || (room.is_active ? 'Ready for playback • Click to join' : 'Unknown Artist')}
                    </p>
                  </div>
                </div>

                {/* 1-Click Join Party Button or Current Room Badge */}
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <span className="text-[11px] font-bold text-text-muted">
                    {room.song
                      ? `${formatTime(room.position_seconds)} / ${formatTime(room.song?.duration || 0)}`
                      : 'Party open'}
                  </span>

                  {isCurrentRoom ? (
                    <span
                      title={isHost ? 'You are hosting this party room' : 'You are currently listening in this party room'}
                      className="flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary shadow-xs"
                    >
                      <Radio className="h-3.5 w-3.5 animate-pulse" />
                      <span>{isHost ? 'Hosting' : 'Listening'}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleListenAlong(profile.id, room.id)}
                      disabled={busy}
                      title={`Join ${profile.display_name}'s party room directly`}
                      className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover px-4 py-1.5 text-xs font-bold text-primary-foreground transition-all active:scale-95 disabled:opacity-50 cursor-pointer shadow-sm"
                    >
                      <Radio className="h-3.5 w-3.5" />
                      Join Party
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-surface-elevated/30 py-8 sm:py-10 px-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-elevated border border-border text-text-muted">
            <Headphones className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-bold text-text">No friends are broadcasting right now</h3>
          <p className="mt-1 max-w-sm text-xs text-text-muted leading-relaxed">
            When an online friend starts playing music or hosts a room, their live session will automatically appear here so you can tune in with 1 click.
          </p>
        </div>
      )}
    </section>
  )
}
