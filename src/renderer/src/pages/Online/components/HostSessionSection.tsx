import { type ReactElement, useState, useEffect } from 'react'
import {
  Radio,
  Check,
  Copy,
  UserPlus,
  MessageSquare,
  LogOut,
  Loader2,
  Volume2,
  VolumeX,
  Activity,
  MicOff,
  Users,
  Crown,
  ListMusic,
  Plus,
  SkipForward,
  Play,
  Star,
  Trash2,
  Music2,
  Maximize2,
  Minimize2
} from 'lucide-react'
import type { Song } from '../../../types'
import type { ListeningRoom } from '../../../online/types'
import type { RoomMemberInfo, QueueTab } from '../types'
import { formatBytes, formatTime } from '../utils'
import { cn } from '../../../lib/utils'
import { isYouTubeSong } from '../../../lib/youtubeService'
import YouTubeIcon from '../../../components/Common/YouTubeIcon'
import YouTubeQueueTab from '../../../components/Online/YouTubeQueueTab'
import SettingsSyncSection from '../../../components/Online/SettingsSyncSection'
import Avatar from '../../../components/Common/Avatar'

interface HostSessionSectionProps {
  hostRoom: ListeningRoom
  members: RoomMemberInfo[]
  setSelectedMember: (m: RoomMemberInfo) => void
  copied: boolean
  handleCopyCode: (code: string) => void
  setShowShareModal: (v: boolean) => void
  setInviteModalTab: (tab: 'friends' | 'share') => void
  showHostChat: boolean
  setShowHostChat: (fn: (prev: boolean) => boolean) => void
  handleEndHostSession: () => void
  busy: boolean
  queue: Song[]
  currentSongIndex: number
  jitStatus: Record<string, any>
  isDeviceAudioSharing: boolean
  isDeviceAudioMuted: boolean
  toggleDeviceAudioMute: () => void
  handleToggleDeviceAudio: () => void
  deviceAudioBitrate: number
  setDeviceAudioBitrate: (val: number) => void
  deviceAudioLevel: number
  deviceAudioPeerCount: number
  discordPriorityEnabled: boolean
  setDiscordPriorityEnabled: (val: boolean) => void
  setShowSelectMediaModal: (val: boolean) => void
  playNext: (force?: boolean) => void
  ensureHostRoom: (enabled: boolean, forceNew?: boolean, preferredCode?: string) => Promise<any>
  playTrackByIndex: (idx: number) => void
  removeSongFromQueueByIndex: (idx: number) => void
  bumpSongToPriority: (idx: number) => void
  showAllQueue: boolean
  setShowAllQueue: (fn: (prev: boolean) => boolean) => void
  hostQueueTab: QueueTab
  setHostQueueTab: (tab: QueueTab) => void
  currentPlayingTrack?: Song
  priorityTracksList: Array<{ song: Song; idx: number }>
  backgroundTracksList: Array<{ song: Song; idx: number }>
  youtubeTracksList?: Array<{ song: Song; idx: number }>
  setMessage: (msg: string) => void
}

export default function HostSessionSection({
  hostRoom,
  members,
  setSelectedMember,
  copied,
  handleCopyCode,
  setShowShareModal,
  setInviteModalTab,
  showHostChat,
  setShowHostChat,
  handleEndHostSession,
  busy,
  queue,
  currentSongIndex,
  jitStatus,
  isDeviceAudioSharing,
  isDeviceAudioMuted,
  toggleDeviceAudioMute,
  handleToggleDeviceAudio,
  deviceAudioBitrate,
  setDeviceAudioBitrate,
  deviceAudioLevel,
  deviceAudioPeerCount,
  discordPriorityEnabled,
  setDiscordPriorityEnabled,
  setShowSelectMediaModal,
  playNext,
  ensureHostRoom,
  playTrackByIndex,
  removeSongFromQueueByIndex,
  bumpSongToPriority,
  showAllQueue,
  setShowAllQueue,
  hostQueueTab,
  setHostQueueTab,
  currentPlayingTrack,
  priorityTracksList,
  backgroundTracksList,
  youtubeTracksList = [],
  setMessage
}: HostSessionSectionProps): ReactElement {
  const [isYouTubeFullscreen, setIsYouTubeFullscreen] = useState(false)

  useEffect(() => {
    const handleStatus = (e: Event) => {
      const custom = e as CustomEvent<{ isFullscreen: boolean }>
      if (custom.detail) {
        setIsYouTubeFullscreen(Boolean(custom.detail.isFullscreen))
      }
    }
    window.addEventListener('felo:youtube-fullscreen-status', handleStatus)
    return () => window.removeEventListener('felo:youtube-fullscreen-status', handleStatus)
  }, [])

  return (
    <>
      {/* Active Host Session Details & Live Member Roster */}
      <section className="mt-6 rounded-3xl border border-white/10 bg-[#121316]/90 p-5 sm:p-6 shadow-xl backdrop-blur-md animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-primary tracking-wide">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <Radio className="h-3.5 w-3.5 animate-pulse text-primary" />
              <span className="uppercase text-[11px] font-mono tracking-wider">Live Session</span>
            </div>
            <h2 className="mt-1 text-xl font-extrabold text-white tracking-tight">
              {hostRoom.name}
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Share room code or invite link so friends can listen together in real-time.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Click-to-Copy Room Code Pill */}
            <button
              type="button"
              onClick={() => handleCopyCode(hostRoom.code)}
              className="group flex items-center gap-2 rounded-xl bg-surface border border-white/10 hover:border-white/25 px-3 py-1.5 transition-all cursor-pointer shadow-sm active:scale-95"
              title="Click to copy Room Code"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Code</span>
              <span className="font-mono text-sm font-black tracking-widest text-white group-hover:text-primary transition-colors">
                {hostRoom.code}
              </span>
              <div className="pl-1 border-l border-white/10 text-text-muted group-hover:text-white">
                {copied ? (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-primary">
                    <Check className="h-3.5 w-3.5" />
                    <span>Copied</span>
                  </span>
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </div>
            </button>

            {/* Invite Modal Button */}
            <button
              type="button"
              onClick={() => {
                setInviteModalTab('friends')
                setShowShareModal(true)
              }}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-elevated hover:bg-hover text-text px-3 py-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
              title="Invite friends or share room code"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Invite</span>
            </button>

            {/* Host Chat Toggle */}
            <button
              type="button"
              onClick={() => setShowHostChat((prev) => !prev)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer active:scale-95 ${
                showHostChat
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface hover:bg-hover text-text'
              }`}
              title="Toggle in-room chat"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat</span>
            </button>

            {/* End Session Button */}
            <button
              type="button"
              onClick={handleEndHostSession}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-danger hover:bg-danger/90 text-white px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-sm disabled:opacity-50"
              title="End this group session"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>End Session</span>
            </button>
          </div>
        </div>

        {/* Active Lossless Broadcast Upload Progress Card */}
        {(() => {
          const currentTrack = queue[currentSongIndex]
          const hostTrackKey = currentTrack ? (currentTrack.id || `${currentTrack.artist} - ${currentTrack.title}`.trim().toLowerCase()) : ''
          const hostJit = (hostTrackKey ? jitStatus[hostTrackKey] : null) ||
            Object.values(jitStatus).find((j) => j.percent < 100)
          if (!hostJit || hostJit.percent >= 100) return null
          return (
            <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-primary">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-text">
                        Broadcasting Lossless Master To Listeners
                      </span>
                      <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-mono font-bold text-text-muted">
                        {hostJit.percent}%
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      {hostJit.totalBytes
                        ? `Sending bit-perfect audio stream (${formatBytes(hostJit.receivedBytes)} / ${formatBytes(hostJit.totalBytes)}) directly to peers.`
                        : (hostJit.statusText || 'Broadcasting audio chunks to listeners...')}
                    </p>
                  </div>
                </div>
                {hostJit.totalBytes ? (
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono font-bold text-text-muted">
                      {formatBytes(hostJit.receivedBytes)} / {formatBytes(hostJit.totalBytes)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface border border-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
                  style={{ width: `${Math.max(2, hostJit.percent)}%` }}
                />
              </div>
            </div>
          )
        })()}

        {/* Live System Audio Broadcast Dashboard Card */}
        {isDeviceAudioSharing && (
          <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface transition-colors ${
                  isDeviceAudioMuted ? 'text-danger' : 'text-primary'
                }`}>
                  {isDeviceAudioMuted ? <VolumeX className="h-5 w-5" /> : <Activity className="h-5 w-5 animate-pulse" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-text">
                      Broadcasting Device Sound Live
                    </span>
                    {isDeviceAudioMuted ? (
                      <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-mono font-bold text-white shadow-xs">
                        BROADCAST MUTED
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-mono font-bold text-text-muted">
                        {deviceAudioBitrate >= 510000
                          ? '510 kbps Studio Ultra'
                          : deviceAudioBitrate === 320000
                            ? '320 kbps Studio Stereo'
                            : deviceAudioBitrate === 192000
                              ? '192 kbps Balanced'
                              : '96 kbps Saver'} (48kHz)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    All audio from your computer is streaming in real-time to {deviceAudioPeerCount} listener{deviceAudioPeerCount === 1 ? '' : 's'}.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Mute Broadcast Button */}
                <button
                  type="button"
                  onClick={toggleDeviceAudioMute}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border cursor-pointer ${
                    isDeviceAudioMuted
                      ? 'border-amber-500/60 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                      : 'border-border/80 bg-surface hover:bg-hover text-text'
                  }`}
                  title={isDeviceAudioMuted ? 'Unmute outgoing stream' : 'Temporarily mute outgoing audio without disconnecting'}
                >
                  {isDeviceAudioMuted ? <VolumeX className="h-3.5 w-3.5 text-amber-400" /> : <Volume2 className="h-3.5 w-3.5" />}
                  <span>{isDeviceAudioMuted ? 'Unmute Stream' : 'Mute Stream'}</span>
                </button>

                {/* Stop Sharing Button */}
                <button
                  type="button"
                  onClick={handleToggleDeviceAudio}
                  className="flex items-center gap-1.5 rounded-full bg-red-500 hover:bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white transition-all shadow-sm cursor-pointer"
                >
                  <MicOff className="h-3.5 w-3.5" />
                  <span>Stop Sharing</span>
                </button>
              </div>
            </div>

            {/* Bitrate Selector & VU Level Meter */}
            <div className="mt-4 pt-3 border-t border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              {/* Quality Presets */}
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="font-bold text-text-muted text-[10px] uppercase tracking-wider mr-1">Quality:</span>
                {[
                  { label: 'Studio Ultra 510k', value: 510000, desc: 'Lossless transparent studio master' },
                  { label: 'Studio 320k', value: 320000, desc: 'High-fidelity stereo' },
                  { label: 'Balanced 192k', value: 192000, desc: 'Optimal for normal Wi-Fi' },
                  { label: 'Saver 96k', value: 96000, desc: 'Low bandwidth / mobile' }
                ].map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setDeviceAudioBitrate(preset.value)}
                    title={preset.desc}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                      deviceAudioBitrate === preset.value
                        ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                        : 'bg-surface hover:bg-hover text-text-muted hover:text-text border border-border'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Real-time VU Level Meter Bar */}
              <div className="flex items-center gap-2 flex-1 max-w-xs">
                <span className="text-[10px] font-mono font-bold text-text-muted uppercase">VU</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface border border-border">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ease-out ${
                      isDeviceAudioMuted
                        ? 'bg-text-muted/30'
                        : 'bg-primary'
                    }`}
                    style={{ width: `${isDeviceAudioMuted ? 0 : Math.min(100, Math.max(2, deviceAudioLevel))}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-text-muted min-w-[24px]">
                  {isDeviceAudioMuted ? 'OFF' : `${Math.round(deviceAudioLevel)}%`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Active Participants in Host Room */}
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
              <Users className="h-3.5 w-3.5 text-text-muted" />
              <span>Participants ({members.length || 1})</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setInviteModalTab('friends')
                setShowShareModal(true)
              }}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface-elevated hover:bg-hover text-text px-2.5 py-0.5 text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95"
              title="Invite friends to this room"
            >
              <UserPlus className="h-3 w-3" />
              <span>Invite Friends</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {members.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => setSelectedMember(m)}
                className="flex items-center gap-2 rounded-full border border-border bg-surface pl-1.5 pr-3 py-1 text-xs font-medium text-text hover:border-border/80 hover:bg-surface-elevated transition-all cursor-pointer shadow-xs group"
                title={`Click to view profile of ${m.displayName}`}
              >
                <Avatar
                  src={m.avatarUrl}
                  fallbackText={m.displayName}
                  size="2xs"
                  className="border-border bg-surface-elevated text-text font-bold"
                  showInitials={true}
                  maxInitials={1}
                />
                {m.isOnline && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Online" />
                )}
                {m.role === 'host' || m.isHost ? (
                  <span title="Host"><Crown className="h-3 w-3 text-text-muted shrink-0" /></span>
                ) : m.role === 'co_host' ? (
                  <span className="text-[10px] text-text-muted font-bold shrink-0" title="Co-host">Co-host</span>
                ) : null}
                <span className="group-hover:text-primary transition-colors">{m.displayName}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Settings Sync (Compact Mode) */}
        <div className="mt-4 pt-3.5 border-t border-white/[0.08]">
          <SettingsSyncSection variant="compact" />
        </div>
      </section>

      {/* Host Empty Session State: Prompt to select media */}
      {hostRoom?.id && queue.length === 0 && !isDeviceAudioSharing && (
        <section className="mt-8 rounded-2xl border border-dashed border-border/80 bg-surface-elevated/40 p-8 text-center backdrop-blur-sm animate-fade-in">
          <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-white/10 text-white border border-white/15 mb-3 shadow-inner">
            <Music2 className="h-7 w-7 text-secondary-cyan" />
          </div>
          <h3 className="text-base font-black text-text">No Media Playing in Room</h3>
          <p className="text-xs text-text-muted mt-1 max-w-md mx-auto">
            Select a YouTube video, local audio file, or stream your computer's system sound to start playing simultaneously with all connected listeners.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowSelectMediaModal(true)}
              className="flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold px-5 py-2.5 text-xs transition-all cursor-pointer shadow-lg active:scale-95"
            >
              <Music2 className="h-4 w-4" />
              <span>Select Media to Play</span>
            </button>
          </div>
        </section>
      )}

      {/* Host Active Session Queue: 3 Crystal-Clear Tiers */}
      {hostRoom?.id && queue.length > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-surface-elevated/70 p-5 shadow-lg backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/60 pb-3 mb-4 gap-3">
            <div className="flex items-center gap-2">
              <ListMusic className="h-4 w-4 text-text-muted" />
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-text">
                  Live Session Queue
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Synchronized live across all listeners and connected Discord channels.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Host Discord Priority Toggle */}
              <button
                type="button"
                onClick={() => {
                  const next = !discordPriorityEnabled
                  setDiscordPriorityEnabled(next)
                  setMessage(
                    next
                      ? 'Discord Priority enabled: Discord requests will play next up'
                      : 'Discord Priority disabled: Discord requests added to end of playlist'
                  )
                  setTimeout(() => setMessage(''), 3500)
                }}
                className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold transition-all border cursor-pointer ${
                  discordPriorityEnabled
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-surface border-border text-text-muted hover:text-text hover:bg-hover'
                }`}
                title={
                  discordPriorityEnabled
                    ? 'Discord Priority is ON: Requests from Discord automatically play next up before local songs.'
                    : 'Discord Priority is OFF: Requests from Discord are added to the end of your queue without interrupting order.'
                }
              >
                <Radio className="h-3.5 w-3.5" />
                <span>Discord Priority: {discordPriorityEnabled ? 'ON' : 'OFF'}</span>
                <span className={`inline-block h-2 w-2 rounded-full ${discordPriorityEnabled ? 'bg-primary-foreground' : 'bg-zinc-600'}`} />
              </button>

              <button
                type="button"
                onClick={() => setShowSelectMediaModal(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold bg-primary hover:bg-primary-hover text-primary-foreground transition-all cursor-pointer shadow-xs active:scale-95"
                title="Select media to play: Local files, YouTube, or System audio"
              >
                <Plus className="h-3.5 w-3.5 stroke-[3]" />
                <span>Add Media</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  playNext(true)
                  void ensureHostRoom(true)
                }}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold bg-surface-elevated hover:bg-hover text-text border border-border transition-all cursor-pointer shadow-xs active:scale-95"
                title="Skip to next track in queue"
              >
                <SkipForward className="h-3.5 w-3.5 fill-current" />
                <span>Skip Track</span>
              </button>

              <span className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-[10px] font-medium text-text-muted border border-border/60">
                {queue.length} Tracks Total
              </span>
            </div>
          </div>

          {/* Tier 1: NOW PLAYING LIVE SHOWCASE (Box 1) */}
          {currentPlayingTrack && (
            <div className="mb-2">
              {isYouTubeSong(currentPlayingTrack) && (
                <div
                  id="youtube-stage-dock"
                  className={cn(
                    "w-full aspect-video rounded-2xl bg-black/90 border border-white/15 mb-3 relative shadow-2xl flex items-center justify-center transition-all",
                    isYouTubeFullscreen ? "overflow-visible" : "overflow-hidden"
                  )}
                >
                  {isYouTubeFullscreen ? (
                    <div className="flex flex-col items-center gap-2.5 text-text-muted text-xs p-6 text-center animate-fade-in">
                      <div className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
                        <Maximize2 className="h-5 w-5 animate-pulse" />
                      </div>
                      <span className="font-bold text-sm text-white">Playing in Full-Screen Modal</span>
                      <span className="text-[11px] text-text-muted max-w-sm">
                        The live YouTube stream is currently open in full-screen modal mode.
                      </span>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new CustomEvent('felo:exit-fullscreen-youtube'))}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95"
                          title="Exit full-screen modal (Esc)"
                        >
                          <Minimize2 className="h-3.5 w-3.5" />
                          <span>Exit Fullscreen</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 text-text-muted text-xs p-6 text-center">
                      <Radio className="h-6 w-6 text-primary animate-pulse" />
                      <span className="font-bold text-sm text-white/95">Synchronizing Live YouTube Stream...</span>
                      <span className="text-[11px] text-text-muted">Audio and video stream in unison across all room listeners.</span>
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-xl border border-border bg-surface-elevated/70 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface border border-border text-primary">
                      <Radio className="h-5 w-5 animate-pulse" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-md bg-primary text-primary-foreground px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                          TRACK #{currentSongIndex + 1}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                          PLAYING NOW
                        </span>
                        {currentPlayingTrack.isPriority ? (
                          <span className="rounded-full bg-surface-elevated border border-border px-2 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                            Priority Request
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm font-bold text-text truncate mt-0.5">
                        {currentPlayingTrack.title}
                      </p>
                      <p className="text-xs text-text-muted truncate">
                        {currentPlayingTrack.artist}
                        {currentPlayingTrack.album ? ` • ${currentPlayingTrack.album}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono font-bold text-text-muted">
                      {formatTime(currentPlayingTrack.duration)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Queue Filter Tabs: All, Priority Requests, Local Tracks, YouTube */}
          <div className="flex items-center gap-2 mt-4 mb-3 border-b border-border pb-2 text-xs flex-wrap">
            <button
              type="button"
              onClick={() => setHostQueueTab('all')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                hostQueueTab === 'all'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              All Upcoming ({priorityTracksList.length + backgroundTracksList.length + youtubeTracksList.length})
            </button>
            <button
              type="button"
              onClick={() => setHostQueueTab('priority')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                hostQueueTab === 'priority'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <span>Priority ({priorityTracksList.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setHostQueueTab('local')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                hostQueueTab === 'local'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Local Tracks ({backgroundTracksList.length})
            </button>
            <button
              type="button"
              onClick={() => setHostQueueTab('youtube')}
              className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                hostQueueTab === 'youtube'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <YouTubeIcon className="h-3.5 w-3.5 text-danger" />
              <span>YouTube ({youtubeTracksList.length})</span>
            </button>
          </div>

          {/* Tier 2: PRIORITY REQUESTS (Up Next) */}
          {(hostQueueTab === 'all' || hostQueueTab === 'priority') && priorityTracksList.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
                  <span>Priority Requests — Plays Next Up</span>
                  <span className="rounded-full bg-surface-elevated border border-border px-1.5 py-0.2 text-[9px] font-mono text-text-muted">
                    {priorityTracksList.length}
                  </span>
                </span>
                <span className="text-[10px] text-text-muted">
                  From Discord & Listeners
                </span>
              </div>
              <div className="space-y-1.5">
                {priorityTracksList.map(({ song, idx }) => (
                  <div
                    key={`${song.id}-${idx}`}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-surface hover:bg-hover transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-[10px] font-mono font-bold text-text-muted w-5 text-center shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-text truncate">{song.title}</p>
                        <p className="text-[11px] text-text-muted truncate">
                          {song.artist} {song.album ? `• ${song.album}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-text-muted">
                        {formatTime(song.duration)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          playTrackByIndex(idx)
                          void ensureHostRoom(true)
                        }}
                        className="p-1 rounded text-text-muted hover:text-text cursor-pointer"
                        title="Play Now"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeSongFromQueueByIndex(idx)
                          void ensureHostRoom(true)
                        }}
                        className="p-1 rounded text-text-muted hover:text-danger cursor-pointer"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hostQueueTab === 'priority' && priorityTracksList.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 bg-surface/30 p-6 text-center">
              <Radio className="h-6 w-6 text-text-muted mx-auto mb-2" />
              <p className="text-xs font-bold text-text">No Priority Requests in Queue</p>
              <p className="text-[11px] text-text-muted mt-1">Tracks requested from Discord or promoted by you will appear here.</p>
            </div>
          )}

          {/* Tier 3: LOCAL BACKGROUND QUEUE */}
          {(hostQueueTab === 'all' || hostQueueTab === 'local') && backgroundTracksList.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1">
                  <span>Local Queue (Playlist Continuity)</span>
                  <span className="rounded-full bg-surface-elevated border border-border px-1.5 py-0.2 text-[9px] font-mono text-text-muted">
                    {backgroundTracksList.length}
                  </span>
                </span>
                {backgroundTracksList.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllQueue((prev) => !prev)}
                    className="text-[10px] text-text-muted hover:text-text cursor-pointer font-bold"
                  >
                    {showAllQueue ? 'Show Less' : `Show All (${backgroundTracksList.length})`}
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {(showAllQueue ? backgroundTracksList : backgroundTracksList.slice(0, 4)).map(
                  ({ song, idx }) => (
                    <div
                      key={`${song.id}-${idx}`}
                      className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-hover transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="text-[10px] font-mono text-text-muted w-5 text-center shrink-0">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-text truncate">{song.title}</p>
                          <p className="text-[11px] text-text-muted truncate">{song.artist}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-text-muted">
                          {formatTime(song.duration)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              playTrackByIndex(idx)
                              void ensureHostRoom(true)
                            }}
                            className="p-1 rounded text-text-muted hover:text-text cursor-pointer"
                            title="Play Now"
                          >
                            <Play className="h-3 w-3 fill-current" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              bumpSongToPriority(idx)
                              void ensureHostRoom(true)
                            }}
                            className="p-1 rounded text-text-muted hover:text-primary cursor-pointer"
                            title="Make Important / Play Next"
                          >
                            <Star className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              removeSongFromQueueByIndex(idx)
                              void ensureHostRoom(true)
                            }}
                            className="p-1 rounded text-text-muted hover:text-danger cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                )}
                {!showAllQueue && backgroundTracksList.length > 4 && (
                  <div className="pt-2 text-center text-[10px] text-text-muted font-medium">
                    ... (Remaining {backgroundTracksList.length - 4} Local Tracks)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* YouTube Inline Search & Fast Queue */}
          {hostQueueTab === 'youtube' && (
            <YouTubeQueueTab
              onSongAdded={(title) => {
                setMessage(`Added "${title}" to YouTube queue!`)
                setTimeout(() => setMessage(''), 3000)
              }}
            />
          )}

          {/* Tier 3: YOUTUBE TRACKS */}
          {(hostQueueTab === 'all' || hostQueueTab === 'youtube') && youtubeTracksList.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                  <YouTubeIcon className="h-3.5 w-3.5 text-danger" />
                  <span>YouTube Stream Queue</span>
                  <span className="rounded-full bg-surface-elevated border border-border px-1.5 py-0.2 text-[9px] font-mono text-text-muted">
                    {youtubeTracksList.length}
                  </span>
                </span>
                <span className="text-[10px] text-text-muted">Direct YouTube Stream</span>
              </div>
              <div className="space-y-1">
                {youtubeTracksList.map(({ song, idx }) => (
                  <div
                    key={`${song.id}-${idx}`}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-hover transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-text-muted w-5 text-center shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-text truncate">{song.title}</p>
                          {song.isPriority && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/20 text-primary shrink-0">
                              Priority
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-text-muted truncate">{song.artist}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-text-muted">
                        {formatTime(song.duration)}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            playTrackByIndex(idx)
                            void ensureHostRoom(true)
                          }}
                          className="p-1 rounded text-text-muted hover:text-text cursor-pointer"
                          title="Play Now"
                        >
                          <Play className="h-3 w-3 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            bumpSongToPriority(idx)
                            void ensureHostRoom(true)
                          }}
                          className="p-1 rounded text-text-muted hover:text-primary cursor-pointer"
                          title="Make Important / Play Next"
                        >
                          <Star className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            removeSongFromQueueByIndex(idx)
                            void ensureHostRoom(true)
                          }}
                          className="p-1 rounded text-text-muted hover:text-danger cursor-pointer"
                          title="Remove"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hostQueueTab === 'local' && backgroundTracksList.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 bg-surface/30 p-6 text-center">
              <Music2 className="h-6 w-6 text-text-muted/50 mx-auto mb-2" />
              <p className="text-xs font-bold text-text">No Upcoming Local Playlist Tracks</p>
              <p className="text-[11px] text-text-muted mt-1">Add tracks from your Library to continue background playback.</p>
            </div>
          )}

          {hostQueueTab === 'youtube' && youtubeTracksList.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 bg-surface/30 p-6 text-center">
              <YouTubeIcon className="h-6 w-6 text-danger/60 mx-auto mb-2" />
              <p className="text-xs font-bold text-text">No Upcoming YouTube Tracks</p>
              <p className="text-[11px] text-text-muted mt-1">Add tracks from YouTube using the + Add Media button above.</p>
              <button
                type="button"
                onClick={() => setShowSelectMediaModal(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs font-bold text-text hover:bg-hover transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add YouTube Track</span>
              </button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
