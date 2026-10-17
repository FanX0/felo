import { useState, type ReactElement } from 'react'
import {
  X,
  UserPlus,
  Users,
  Link2,
  Check,
  Search,
  Radio,
  Copy,
  MessageSquare
} from 'lucide-react'
import type { RoomMemberInfo } from '../types'
import Avatar from '../../../components/Common/Avatar'

interface FriendItem {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
}

interface InviteFriendsModalProps {
  isOpen: boolean
  onClose: () => void
  roomCode: string
  shareUrl: string
  qrDataUrl: string
  allFriends: FriendItem[]
  members: RoomMemberInfo[]
  sentInvitations: string[]
  onInviteFriend: (friendId: string, friendDisplayName: string) => void
  isInvitingId: string | null
  inviteSuccessMsg: string
}

export default function InviteFriendsModal({
  isOpen,
  onClose,
  roomCode,
  shareUrl,
  qrDataUrl,
  allFriends,
  members,
  sentInvitations,
  onInviteFriend,
  isInvitingId,
  inviteSuccessMsg
}: InviteFriendsModalProps): ReactElement | null {
  const [inviteModalTab, setInviteModalTab] = useState<'friends' | 'share'>('friends')
  const [friendSearchQuery, setFriendSearchQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedDiscord, setCopiedDiscord] = useState(false)

  if (!isOpen || !roomCode) return null

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-elevated border border-border text-text-muted">
              <UserPlus className="h-4 w-4" />
            </div>
            <h3 className="text-base font-bold text-text">Invite to Listening Room</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="flex items-center gap-2 mt-4 p-1 rounded-xl bg-surface-elevated border border-border/80">
          <button
            type="button"
            onClick={() => setInviteModalTab('friends')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              inviteModalTab === 'friends'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Invite Friends</span>
            {allFriends.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  inviteModalTab === 'friends' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-surface text-text-muted'
                }`}
              >
                {allFriends.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setInviteModalTab('share')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              inviteModalTab === 'share'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Room Code & QR</span>
          </button>
        </div>

        {/* Success toast if any */}
        {inviteSuccessMsg && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-surface-elevated border border-border text-text text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1">{inviteSuccessMsg}</span>
          </div>
        )}

        {/* Tab 1: Invite Friends */}
        {inviteModalTab === 'friends' && (
          <div className="mt-4 flex-1 flex flex-col min-h-0">
            {allFriends.length > 0 ? (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search friends by name or username..."
                    value={friendSearchQuery}
                    onChange={(e) => setFriendSearchQuery(e.target.value)}
                    className="w-full h-9 rounded-xl bg-surface-elevated border border-border pl-9 pr-3 text-xs text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px]">
                  {allFriends
                    .filter((f) => {
                      if (!friendSearchQuery.trim()) return true
                      const q = friendSearchQuery.toLowerCase()
                      return (
                        f.display_name.toLowerCase().includes(q) ||
                        f.username.toLowerCase().includes(q)
                      )
                    })
                    .map((friend) => {
                      const isInRoom = members.some((m) => m.userId === friend.id)
                      const alreadyInvited = Boolean(sentInvitations.includes(friend.id))
                      const isBusy = isInvitingId === friend.id

                      return (
                        <div
                          key={friend.id}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border/60 bg-surface-elevated hover:bg-hover/60 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar
                              src={friend.avatar_url}
                              fallbackText={friend.display_name || friend.username}
                              size="sm"
                              className="shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-text truncate">
                                {friend.display_name}
                              </p>
                              <p className="text-[11px] text-text-muted truncate">
                                @{friend.username}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0">
                            {isInRoom ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface-elevated border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                                <Radio className="h-2.5 w-2.5 animate-pulse text-text-muted" />
                                In Room
                              </span>
                            ) : alreadyInvited ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-surface border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                                <Check className="h-3 w-3 text-text-muted" />
                                Invited
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onInviteFriend(friend.id, friend.display_name)}
                                className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground px-3 py-1 text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                              >
                                <UserPlus className="h-3 w-3" />
                                <span>{isBusy ? 'Inviting...' : 'Invite'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </>
            ) : (
              <div className="py-8 text-center flex flex-col items-center justify-center">
                <div className="h-10 w-10 rounded-xl bg-surface-elevated border border-border flex items-center justify-center text-text-muted mb-2">
                  <Users className="h-5 w-5 text-text-muted/60" />
                </div>
                <p className="text-xs font-bold text-text">No friends added yet</p>
                <p className="text-[11px] text-text-muted mt-1 max-w-[220px]">
                  Share your room code or link so anyone can join your live party.
                </p>
                <button
                  type="button"
                  onClick={() => setInviteModalTab('share')}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-xs font-bold text-text hover:bg-hover transition-colors cursor-pointer"
                >
                  View Room Code & QR
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Room Code & QR */}
        {inviteModalTab === 'share' && (
          <div className="mt-4 flex-1 overflow-y-auto">
            <div className="rounded-xl border border-border bg-surface-elevated p-3 text-center">
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Room Code
              </span>
              <p className="text-3xl font-black font-mono tracking-widest text-text mt-0.5">
                {roomCode}
              </p>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopyCode(roomCode)}
                className="flex h-10 min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover text-xs font-bold text-primary-foreground transition-all cursor-pointer shadow-sm"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copied Code!' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl)
                  setCopiedLink(true)
                  setTimeout(() => setCopiedLink(false), 2500)
                }}
                className="flex h-10 min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-elevated text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer"
              >
                {copiedLink ? <Check className="h-3.5 w-3.5 text-success" /> : <Link2 className="h-3.5 w-3.5" />}
                <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const discordMsg = `**Listen together with me on Felo!**\n**Room Code:** \`${roomCode}\`\n**Web Join:** ${shareUrl}`
                void navigator.clipboard.writeText(discordMsg)
                setCopiedDiscord(true)
                setTimeout(() => setCopiedDiscord(false), 2500)
              }}
              className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border/80 bg-surface-elevated/70 text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer"
            >
              {copiedDiscord ? <Check className="h-3.5 w-3.5 text-success" /> : <MessageSquare className="h-3.5 w-3.5 text-text-muted" />}
              <span>{copiedDiscord ? 'Copied Discord Invite!' : 'Copy Formatted Discord Invite'}</span>
            </button>

            {/* QR Code Section */}
            {qrDataUrl && (
              <div className="mt-3 pt-3 border-t border-border/40 flex flex-col items-center">
                <div className="rounded-2xl bg-white p-2 shadow-md">
                  <img src={qrDataUrl} alt="Scan QR code to join" className="h-24 w-24" />
                </div>
                <span className="mt-1.5 text-[10px] text-text-muted">
                  Scan with phone camera to join
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
