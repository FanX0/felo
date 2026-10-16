import { memo } from 'react'
import {
  Volume2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Music,
  Crown,
  Laptop
} from 'lucide-react'
import { useListeningStore } from '../../hooks/useListeningStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { useThemeStore } from '../../hooks/useThemeStore'
import type { SpeakerRole, RoomMember } from '../../online/types'

interface RoomSpeakerMapProps {
  className?: string
  members?: RoomMember[]
  isHost?: boolean
  onAssignRole?: (userId: string, role: SpeakerRole) => void
}

const ROLES: { id: SpeakerRole; label: string; icon: any }[] = [
  { id: 'left', label: 'Left', icon: ChevronLeft },
  { id: 'center', label: 'Center', icon: Music },
  { id: 'right', label: 'Right', icon: ChevronRight },
  { id: 'subwoofer', label: 'Subwoofer', icon: CircleDot }
]

export const RoomSpeakerMap = memo(function RoomSpeakerMap({
  className = '',
  members: propMembers,
  isHost: propIsHost,
  onAssignRole
}: RoomSpeakerMapProps) {
  const storeMembers = useListeningStore((s) => s.members)
  const hostRoom = useListeningStore((s) => s.hostRoom)
  const joinedRoom = useListeningStore((s) => s.joinedRoom)
  const setMemberSpeakerRole = useListeningStore((s) => s.setMemberSpeakerRole)
  const currentUser = useOnlineStore((s) => s.user)
  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)

  const activeColor = accentEnabled && accentColor ? accentColor : '#10b981'
  const members = propMembers || storeMembers
  const activeRoom = hostRoom || joinedRoom
  const isHost = propIsHost ?? (activeRoom?.host_id === currentUser?.id)

  const handleRoleChange = async (userId: string, newRole: SpeakerRole) => {
    if (onAssignRole) {
      onAssignRole(userId, newRole)
    } else {
      await setMemberSpeakerRole(userId, newRole)
    }
  }

  // Group members by their assigned speaker role
  const grouped: Record<SpeakerRole, RoomMember[]> = {
    left: [],
    center: [],
    right: [],
    subwoofer: []
  }

  members.forEach((m) => {
    const role: SpeakerRole = m.speaker_role && (['left', 'right', 'center', 'subwoofer'] as const).includes(m.speaker_role as any)
      ? (m.speaker_role as SpeakerRole)
      : 'center'
    grouped[role].push(m)
  })

  return (
    <div className={`p-4 rounded-2xl bg-black/40 border border-white/[0.08] space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-primary" style={{ color: activeColor }} />
          <h4 className="text-sm font-bold text-white">Spatial Speaker Layout</h4>
        </div>
        <span className="text-[11px] font-mono text-zinc-400">
          {members.length} {members.length === 1 ? 'Speaker' : 'Speakers'} Active
        </span>
      </div>

      {/* Acoustic Perspective Layout Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Left Channel Node */}
        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <ChevronLeft className="w-4 h-4 text-primary" style={{ color: activeColor }} />
              Left Speaker
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
              {grouped.left.length}
            </span>
          </div>
          <div className="space-y-1.5 min-h-[48px]">
            {grouped.left.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic py-2">No devices assigned</p>
            ) : (
              grouped.left.map((m) => renderMemberPill(m, isHost, handleRoleChange, currentUser?.id))
            )}
          </div>
        </div>

        {/* Center Channel & Subwoofer Column */}
        <div className="space-y-3">
          {/* Center / Screen Channel Node */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <Music className="w-4 h-4 text-primary" style={{ color: activeColor }} />
                Center / Stereo
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
                {grouped.center.length}
              </span>
            </div>
            <div className="space-y-1.5 min-h-[48px]">
              {grouped.center.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic py-2">No devices assigned</p>
              ) : (
                grouped.center.map((m) => renderMemberPill(m, isHost, handleRoleChange, currentUser?.id))
              )}
            </div>
          </div>

          {/* Subwoofer Channel Node */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                <CircleDot className="w-4 h-4 text-primary" style={{ color: activeColor }} />
                Subwoofer (LFE)
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
                {grouped.subwoofer.length}
              </span>
            </div>
            <div className="space-y-1.5 min-h-[48px]">
              {grouped.subwoofer.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic py-2">No devices assigned</p>
              ) : (
                grouped.subwoofer.map((m) => renderMemberPill(m, isHost, handleRoleChange, currentUser?.id))
              )}
            </div>
          </div>
        </div>

        {/* Right Channel Node */}
        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              Right Speaker
              <ChevronRight className="w-4 h-4 text-primary" style={{ color: activeColor }} />
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">
              {grouped.right.length}
            </span>
          </div>
          <div className="space-y-1.5 min-h-[48px]">
            {grouped.right.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic py-2">No devices assigned</p>
            ) : (
              grouped.right.map((m) => renderMemberPill(m, isHost, handleRoleChange, currentUser?.id))
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

function renderMemberPill(
  member: RoomMember,
  isHost: boolean,
  onRoleChange: (userId: string, role: SpeakerRole) => void,
  currentUserId?: string
) {
  const isSelf = member.user_id === currentUserId
  const isMemberHost = member.role === 'host'

  return (
    <div
      key={member.user_id}
      className={`p-2 rounded-lg flex items-center justify-between gap-2 text-xs transition-all ${
        isSelf
          ? 'bg-primary/15 border border-primary/30 text-white'
          : 'bg-black/30 border border-white/5 text-zinc-300'
      }`}
    >
      <div className="flex items-center gap-2 truncate min-w-0">
        {member.avatar_url ? (
          <img
            src={member.avatar_url}
            alt=""
            className="w-5 h-5 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            {isMemberHost ? (
              <Crown className="w-3 h-3 text-amber-400" />
            ) : (
              <Laptop className="w-3 h-3 text-zinc-400" />
            )}
          </div>
        )}
        <span className="truncate font-medium text-[11px]">
          {member.display_name || member.user_id.slice(0, 6)}
          {isSelf && <span className="ml-1 text-[10px] text-primary">(You)</span>}
        </span>
      </div>

      {/* Host Role Switcher or Static Badge */}
      {isHost ? (
        <select
          value={member.speaker_role || 'center'}
          onChange={(e) => onRoleChange(member.user_id, e.target.value as SpeakerRole)}
          className="text-[10px] font-mono font-semibold bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-zinc-200 cursor-pointer hover:bg-white/15 focus:outline-none"
        >
          {ROLES.map((r) => (
            <option key={r.id} value={r.id} className="bg-zinc-900 text-white">
              {r.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-zinc-400">
          {(member.speaker_role || 'center').toUpperCase()}
        </span>
      )}
    </div>
  )
}
