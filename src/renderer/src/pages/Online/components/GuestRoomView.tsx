import { type ReactElement } from 'react'
import {
  Radio,
  SlidersHorizontal,
  LogOut,
  Loader2,
  Volume2,
  VolumeX,
  Wifi,
  AlertTriangle,
  Download,
  Music2,
  Headphones,
  Crown,
  ListMusic,
  SkipForward,
  X,
  Search,
  Maximize2
} from 'lucide-react'
import type { Song } from '../../../types'
import type { ListeningRoom } from '../../../online/types'
import type { RoomMemberInfo } from '../types'
import { formatBytes, formatTime, getSongKey } from '../utils'
import { isYouTubeSong } from '../../../lib/youtubeService'
import { AppCapabilities } from '../../../lib/appConfig'
import { getSupabase } from '../../../lib/supabase'
import { usePlayerStore } from '../../../hooks/usePlayerStore'
import RoomChat from '../../../components/RoomChat/RoomChat'
import SettingsSyncSection from '../../../components/Online/SettingsSyncSection'
import Slider from '../../../components/Common/Slider'
import Avatar from '../../../components/Common/Avatar'

interface GuestRoomViewProps {
  joinedRoom: ListeningRoom
  hostName: string
  activeSubstitute?: any
  autoDownloadMissing: boolean
  setAutoDownloadMissing: (v: boolean) => void
  setIsManualSyncModalOpen: (v: boolean) => void
  manualSyncOffsetMs: number
  handleLeaveSession: () => void
  busy: boolean
  isReceivingDeviceStream: boolean
  isAutoplayBlocked: boolean
  unmuteDeviceStream: () => Promise<boolean | void>
  isLosslessMasterActive: boolean
  deviceAudioClientState: string
  deviceAudioStats: any
  disconnectFromDeviceStream: () => void
  connectToDeviceStream: (room: any) => Promise<void>
  deviceAudioVolume: number
  setDeviceAudioVolume: (val: number) => void
  deviceAudioClientLevel: number
  jitStatus: Record<string, any>
  syncStatus: string
  missingSong: any
  openReplaceModal: () => void
  handleDownloadMissingSong: () => void
  leaveJoinedRoom: () => Promise<void>
  handleResetSubstitute: () => void
  isPlaying: boolean
  currentTime: number
  syncedGuestTime: number
  members: RoomMemberInfo[]
  setSelectedMember: (m: RoomMemberInfo) => void
  user: any
  setMessage: (msg: string) => void
  listenerQueueTab: 'all' | 'priority' | 'local'
  setListenerQueueTab: (tab: 'all' | 'priority' | 'local') => void
  transfers: any[]
  onOpenDownloadPanel?: (target: any) => void
  showReplaceModal: boolean
  setShowReplaceModal: (v: boolean) => void
  replaceSearchQuery: string
  setReplaceSearchQuery: (q: string) => void
  filteredLibrary: Song[]
  handleSelectSubstitute: (song: Song) => void
}

export default function GuestRoomView({
  joinedRoom,
  hostName,
  activeSubstitute,
  autoDownloadMissing,
  setAutoDownloadMissing,
  setIsManualSyncModalOpen,
  manualSyncOffsetMs,
  handleLeaveSession,
  busy,
  isReceivingDeviceStream,
  isAutoplayBlocked,
  unmuteDeviceStream,
  isLosslessMasterActive,
  deviceAudioClientState,
  deviceAudioStats,
  disconnectFromDeviceStream,
  connectToDeviceStream,
  deviceAudioVolume,
  setDeviceAudioVolume,
  deviceAudioClientLevel,
  jitStatus,
  syncStatus,
  missingSong,
  openReplaceModal,
  handleDownloadMissingSong,
  leaveJoinedRoom,
  handleResetSubstitute,
  isPlaying,
  currentTime,
  syncedGuestTime,
  members,
  setSelectedMember,
  user,
  setMessage,
  listenerQueueTab,
  setListenerQueueTab,
  transfers,
  onOpenDownloadPanel,
  showReplaceModal,
  setShowReplaceModal,
  replaceSearchQuery,
  setReplaceSearchQuery,
  filteredLibrary,
  handleSelectSubstitute
}: GuestRoomViewProps): ReactElement {
  const displaySong = activeSubstitute || joinedRoom.song
  const songDuration = displaySong?.duration || 0
  const effectiveTime =
    isReceivingDeviceStream || isPlaying === false || activeSubstitute == null
      ? syncedGuestTime
      : (currentTime || syncedGuestTime)
  const songProgress = songDuration > 0 ? Math.min(100, (effectiveTime / songDuration) * 100) : 0
  const activeTrackKey = displaySong ? ((displaySong as any).id || (displaySong as any).localId || getSongKey(displaySong)) : ''
  const activeJit = (activeTrackKey ? jitStatus[activeTrackKey] : null) ||
    Object.values(jitStatus).find((j) => j.percent < 100) ||
    (activeTrackKey ? jitStatus[activeTrackKey] : null)
  const playerQueue = usePlayerStore((state) => state.queue)

  return (
    <div className="mx-auto flex min-h-full flex-1 w-full max-w-4xl flex-col px-4 sm:px-6 md:px-8 py-5 sm:py-7 pb-36 sm:pb-32 md:pb-24 select-none">
      {/* Active Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-text">
            <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
            <Radio className="h-4 w-4 animate-pulse text-primary" />
            <span>Listening Along Live</span>
          </div>
          <h1 className="mt-1.5 text-2xl sm:text-3xl font-extrabold text-text tracking-tight">
            {joinedRoom.name}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            Synchronized in real-time with <strong className="text-text">{hostName}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Ephemeral Stream vs Save toggle */}
          <button
            type="button"
            onClick={() => setAutoDownloadMissing(!autoDownloadMissing)}
            title={
              autoDownloadMissing
                ? 'Auto-Download: ON (Saving full tracks to local library)'
                : 'Stream Mode (Default): Pure in-memory streaming like public app (No files saved)'
            }
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border cursor-pointer ${
              autoDownloadMissing
                ? 'border-primary/50 bg-primary/20 text-primary hover:bg-primary/30 shadow-xs'
                : 'border-border bg-surface text-text hover:bg-surface-elevated'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>{autoDownloadMissing ? 'Auto-Download: ON' : 'Stream Mode (No Save)'}</span>
          </button>

          {/* Manual Sync (ms) Latency Calibration - Active for Join User */}
          <button
            type="button"
            onClick={() => setIsManualSyncModalOpen(true)}
            title="Calibrate audio sync latency offset (ms) with other listeners"
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border border-border bg-surface hover:bg-surface-elevated text-text cursor-pointer active:scale-95 shadow-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            <span>Manual sync{manualSyncOffsetMs !== 0 ? ` (${manualSyncOffsetMs > 0 ? `+${manualSyncOffsetMs}` : manualSyncOffsetMs}ms)` : ' (ms)'}</span>
          </button>

          {/* Leave / Stop Syncing button */}
          <button
            type="button"
            onClick={handleLeaveSession}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-danger hover:bg-danger/90 text-white px-4 py-2 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            <span>Stop Listening</span>
          </button>
        </div>
      </header>

      {/* Compliance & Fidelity Notice */}
      <div className="mt-4 p-3 rounded-xl border border-border bg-surface-elevated flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="p-1.5 rounded-lg bg-surface border border-border text-primary shrink-0">
            <Radio className="w-4 h-4" />
          </span>
          <div>
            <span className="font-bold text-text flex items-center gap-2 flex-wrap">
              <span>Lossless Ephemeral Audio Sync</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-text-muted font-mono">
                100% Studio Lossless • In-RAM
              </span>
            </span>
            <p className="text-[11px] text-text-muted mt-0.5">
              Audio streams in synchronized lossless quality for this session only. No permanent files are saved to your drive.
            </p>
          </div>
        </div>
      </div>

      {/* Settings Sync */}
      <div className="mt-4 p-4 sm:p-5 rounded-2xl border border-border bg-surface-elevated shadow-xs">
        <SettingsSyncSection />
      </div>

      {/* Autoplay Blocked Alert Banner */}
      {Boolean(isReceivingDeviceStream || joinedRoom.song?.isDeviceStream || joinedRoom.is_device_stream) && isAutoplayBlocked && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-primary border border-border">
              <VolumeX className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-text">
                Audio playback paused by your browser
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Mobile and web browsers require a single tap to enable live WebRTC audio output.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void unmuteDeviceStream()}
            className="flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2.5 text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
          >
            <Volume2 className="h-4 w-4" />
            <span>Tap to Listen Now</span>
          </button>
        </div>
      )}

      {/* Live Audio Stream Status Banner (Reserved strictly for explicit system/device audio sharing) */}
      {Boolean(isReceivingDeviceStream || joinedRoom.song?.isDeviceStream || joinedRoom.is_device_stream) && (
        <div className="mt-4 rounded-xl border border-border bg-surface-elevated p-4 shadow-sm flex flex-col gap-3 animate-fade-in">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface text-primary border border-border">
                <Volume2 className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-text">
                    {joinedRoom.song?.isDeviceStream ? 'Live System Audio Stream' : 'Live Host Audio Stream'}
                  </span>
                  <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-mono font-bold text-text-muted flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                    {isLosslessMasterActive
                      ? 'Bit-Perfect Lossless Master (FLAC in RAM)'
                      : isReceivingDeviceStream && deviceAudioClientState === 'connected'
                        ? '510 kbps Studio Ultra Opus'
                        : isReceivingDeviceStream
                          ? deviceAudioClientState
                          : 'Available'}
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  {isReceivingDeviceStream
                    ? `Listening live to ${hostName}'s audio stream via ultra-low latency WebRTC.`
                    : `${hostName} is broadcasting audio. Tune in to stream directly.`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {isReceivingDeviceStream ? (
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-surface border border-border px-2.5 py-1 text-[11px] font-mono text-text-muted">
                    <Wifi className="h-3 w-3 text-primary" />
                    <span>{deviceAudioStats?.rttMs != null ? `${deviceAudioStats.rttMs}ms RTT` : 'Direct P2P'}</span>
                    {deviceAudioStats?.bitrateKbps ? (
                      <span className="text-text font-bold">• {Math.round(deviceAudioStats.bitrateKbps)} kbps</span>
                    ) : null}
                  </div>
                  <span className="text-[11px] font-bold text-primary px-3 py-1 rounded-full bg-surface border border-border">
                    {isLosslessMasterActive ? 'Bit-Perfect RAM Stream' : 'Live Opus Stream'}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnectFromDeviceStream()}
                    className="rounded-full bg-surface hover:bg-hover px-3 py-1 text-[11px] font-semibold text-text-muted hover:text-text transition-all cursor-pointer border border-border"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void connectToDeviceStream(joinedRoom)}
                  className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold px-3.5 py-1.5 text-xs transition-all shadow-xs active:scale-95 cursor-pointer"
                >
                  <Radio className="h-3.5 w-3.5" />
                  <span>Tune In Live</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-border">
            <div className="flex items-center gap-2.5 min-w-[200px]">
              <button
                type="button"
                onClick={() => setDeviceAudioVolume(deviceAudioVolume > 0 ? 0 : 1)}
                className="text-text-muted hover:text-text transition-colors cursor-pointer"
                title={deviceAudioVolume === 0 ? 'Unmute' : 'Mute'}
              >
                {deviceAudioVolume === 0 ? <VolumeX className="h-4 w-4 text-danger" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={deviceAudioVolume}
                onChange={setDeviceAudioVolume}
                className="w-28 sm:w-36"
                ariaLabel="Stream Volume"
              />
              <span className="text-[11px] font-mono text-text-muted min-w-[32px]">
                {Math.round(deviceAudioVolume * 100)}%
              </span>
            </div>

            <div className="flex items-center gap-2 flex-1 max-w-xs">
              <span className="text-[10px] font-mono font-bold text-text-muted uppercase">VU</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface border border-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-75 ease-out"
                  style={{ width: `${Math.min(100, Math.max(2, deviceAudioClientLevel))}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-text-muted min-w-[24px]">
                {Math.round(deviceAudioClientLevel)}%
              </span>
            </div>
          </div>

          {activeJit && activeJit.percent < 100 && (
            <div className="pt-2 border-t border-border flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-primary font-bold flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span>Buffering Lossless Master in RAM ({activeJit.percent}%)</span>
                </span>
                <span className="text-text-muted">
                  {formatBytes(activeJit.receivedBytes)}{activeJit.totalBytes ? ` / ${formatBytes(activeJit.totalBytes)}` : ''}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface border border-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
                  style={{ width: `${Math.max(2, activeJit.percent)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Buffering Lossless Master Alert Banner */}
      {syncStatus === 'buffering' && (
        <div className="mt-6 rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary border border-border">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-text">
                    Buffering Audio: "{displaySong?.title || joinedRoom.song?.title || 'Current Track'}"
                  </p>
                  <span className="rounded-full bg-surface border border-border px-2 py-0.5 text-[10px] font-mono font-bold text-text-muted">
                    {activeJit?.percent ?? 0}%
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  {activeJit?.totalBytes
                    ? `Receiving bit-perfect audio stream (${formatBytes(activeJit.receivedBytes)} / ${formatBytes(activeJit.totalBytes)}) in ephemeral RAM buffer.`
                    : (activeJit?.statusText || 'Receiving audio chunks from host directly into RAM...')}
                </p>
              </div>
            </div>

            {activeJit?.totalBytes ? (
              <div className="text-right shrink-0">
                <span className="text-xs font-mono font-bold text-primary">
                  {formatBytes(activeJit.receivedBytes)} / {formatBytes(activeJit.totalBytes)}
                </span>
              </div>
            ) : null}
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface border border-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150 ease-out"
              style={{ width: `${Math.max(2, activeJit?.percent ?? 0)}%` }}
            />
          </div>
        </div>
      )}

      {/* Missing Song Alert Banner */}
      {syncStatus === 'missing_song' && missingSong && !activeSubstitute && !isReceivingDeviceStream && !joinedRoom.song?.isDeviceStream && (() => {
        const isStreamAvailable = Boolean(
          joinedRoom.is_device_stream ||
          joinedRoom.song?.isDeviceStream ||
          joinedRoom.song?.streamType === 'device_audio'
        )

        if (!AppCapabilities.downloads) {
          if (isStreamAvailable) {
            return (
              <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary border border-border">
                    <Radio className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-text">
                      "{missingSong.title}" • Live Stream Available
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Streamed live from host in studio quality (Bit-Perfect Lossless / 510 kbps Opus • Ephemeral in RAM).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void connectToDeviceStream(joinedRoom)}
                    className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold px-3.5 py-2 text-xs transition-all shadow-xs active:scale-95 cursor-pointer"
                  >
                    <Radio className="h-3.5 w-3.5" />
                    <span>Tune In Live</span>
                  </button>
                  <button
                    type="button"
                    onClick={openReplaceModal}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-surface-elevated px-3.5 py-2 text-xs font-bold text-text transition-all cursor-pointer"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>Use Local File</span>
                  </button>
                </div>
              </div>
            )
          }

          return (
            <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-text-muted border border-border">
                  <Radio className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-text">
                    "{missingSong.title}" is on the host's device
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Waiting for host audio stream. You can also pick a local file to match playback.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openReplaceModal}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-surface-elevated px-3.5 py-2 text-xs font-bold text-text transition-all cursor-pointer"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Use Local File</span>
                </button>
              </div>
            </div>
          )
        }

        const activeMissingDownload = transfers.find((t) => {
          const matchTitle = t.title.toLowerCase() === missingSong.title.toLowerCase()
          return matchTitle && (t.status === 'downloading' || t.status === 'queued')
        })

        return (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-text border border-border">
                {activeMissingDownload ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-text-muted" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-text">
                  "{missingSong.title}" is missing locally
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {activeMissingDownload
                    ? `Downloading from ${activeMissingDownload.sourceName || activeMissingDownload.source} (${activeMissingDownload.progress}%)... Will play automatically.`
                    : autoDownloadMissing
                      ? 'Acquiring track in the background... It will start playing automatically once ready.'
                      : 'Stream live from host, download for offline access, or choose a local substitute.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isStreamAvailable && (
                <button
                  type="button"
                  onClick={() => void connectToDeviceStream(joinedRoom)}
                  className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold px-3.5 py-2 text-xs transition-all shadow-xs active:scale-95 cursor-pointer"
                >
                  <Radio className="h-3.5 w-3.5" />
                  <span>Stream Live</span>
                </button>
              )}

              <button
                type="button"
                onClick={openReplaceModal}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-surface-elevated px-3.5 py-2 text-xs font-bold text-text transition-all cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Replace</span>
              </button>

              {activeMissingDownload ? (
                <div className="flex items-center gap-1.5 rounded-full bg-surface border border-border px-4 py-2 text-xs font-bold text-text">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>{activeMissingDownload.progress}%</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDownloadMissingSong}
                  className="flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover px-4 py-2 text-xs font-bold text-primary-foreground transition-all cursor-pointer shadow-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download</span>
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Host Reconnecting Alert Banner */}
      {syncStatus === 'host_reconnecting' && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-text-muted border border-border">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-text">
                Host connection interrupted
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Audio playback continues smoothly while waiting for host heartbeat (grace period active). If the host does not return, failover will elect a new host.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void leaveJoinedRoom()}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-surface-elevated px-3.5 py-2 text-xs font-bold text-text transition-all shrink-0 ml-4 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Leave</span>
          </button>
        </div>
      )}

      {/* Active Substitute Song Banner */}
      {activeSubstitute && (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-border bg-surface-elevated p-4 animate-fade-in shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary border border-border">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-text">
                Playing local substitute: <strong className="text-primary">"{activeSubstitute.title}"</strong>
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Host is playing: "{joinedRoom.song?.title}" by {joinedRoom.song?.artist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openReplaceModal}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleResetSubstitute}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-hover transition-all cursor-pointer"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Main Synced Player Card */}
      <div className="py-8 flex flex-col items-center">
        <div className="w-full max-w-lg text-center">
          {/* Animated Headphones Avatar */}
          <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-surface-elevated border border-border shadow-md">
            <Headphones className={`h-12 w-12 text-text ${isPlaying ? 'animate-bounce' : ''}`} />
            {isPlaying && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-primary"></span>
              </span>
            )}
          </div>

          {/* Song Details */}
          <div className="mt-6">
            <h2 className="text-2xl font-black text-text truncate max-w-md mx-auto">
              {displaySong?.title || 'Waiting for song...'}
            </h2>
            <p className="mt-1 text-sm font-semibold text-text-muted truncate max-w-md mx-auto">
              {displaySong?.artist || hostName}
            </p>

            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={openReplaceModal}
                title="Fix wrong track or choose a substitute"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface hover:bg-surface-elevated px-3.5 py-1 text-[11px] font-bold text-text-muted hover:text-text transition-all shadow-xs cursor-pointer"
              >
                <SlidersHorizontal className="h-3 w-3 text-primary" />
                <span>Wrong track? Fix / Replace</span>
              </button>
            </div>
          </div>

          {/* Synced Progress Bar */}
          <div className="mt-6 w-full">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface border border-border">
              {activeJit?.percent != null && activeJit.percent > 0 && (
                <div
                  className="absolute top-0 left-0 h-full rounded-full bg-primary/30 transition-all duration-200"
                  style={{ width: `${activeJit.percent}%` }}
                  title={`Buffered in RAM: ${activeJit.percent}%${activeJit.totalBytes ? ` (${formatBytes(activeJit.receivedBytes)} / ${formatBytes(activeJit.totalBytes)})` : ''}`}
                />
              )}
              <div
                className="relative h-full rounded-full bg-primary transition-all duration-300 ease-linear"
                style={{ width: `${songProgress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-bold text-text-muted">
              <span>{formatTime(effectiveTime)}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-text">
                <Radio className="h-3 w-3 text-primary" />
                {activeJit && activeJit.percent < 100 ? (
                  <span className="text-primary font-mono">
                    Buffering {activeJit.percent}%{activeJit.totalBytes ? ` (${formatBytes(activeJit.receivedBytes)} / ${formatBytes(activeJit.totalBytes)})` : ''}
                  </span>
                ) : (
                  <span>Live Sync</span>
                )}
              </span>
              <span>{formatTime(songDuration)}</span>
            </div>
          </div>

          {/* Members in session */}
          <div className="mt-8 flex flex-col items-center justify-center gap-3">
            <p className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Listening with ({members.length || 1}) • Click profile to add friend
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {members.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => setSelectedMember(m)}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated pl-1.5 pr-3 py-1 text-xs font-bold text-text hover:bg-hover transition-all cursor-pointer shadow-xs group"
                  title={`Click to view profile of ${m.displayName}`}
                >
                  <Avatar
                    src={m.avatarUrl}
                    fallbackText={m.displayName}
                    size="2xs"
                    className="border-border bg-surface text-text font-black"
                    showInitials={true}
                    maxInitials={1}
                  />
                  {m.isOnline && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Online" />
                  )}
                  {m.role === 'host' || m.isHost ? (
                    <span title="Host"><Crown className="h-3 w-3 text-primary shrink-0" /></span>
                  ) : m.role === 'co_host' ? (
                    <span className="text-[10px] text-text-muted font-bold shrink-0" title="Co-host">Co-host</span>
                  ) : null}
                  <span className="group-hover:text-white transition-colors">{m.displayName}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Live Session Queue from Host */}
          {(() => {
            const effectiveQueue: any[] =
              Array.isArray(joinedRoom.queue) && joinedRoom.queue.length > 0
                ? joinedRoom.queue
                : (playerQueue.length > 0
                    ? playerQueue.map((s) => ({
                        title: s.title,
                        artist: s.artist,
                        album: s.album || '',
                        duration: s.duration || 0,
                        artworkUrl: s.artworkUrl || s.artworkPath || '',
                        audioUrl: s.audioUrl || s.filePath || '',
                        isPriority: Boolean((s as any).isPriority)
                      }))
                    : [])

            if (!joinedRoom.song && effectiveQueue.length === 0) return null

            const currentSong = joinedRoom.song || effectiveQueue[0]
            const currentIdx = effectiveQueue.findIndex(
              (s) => s.title === currentSong?.title && s.artist === currentSong?.artist
            )
            const baseTrackNum = currentIdx >= 0 ? currentIdx + 1 : 1
            const priorityTracks = effectiveQueue.filter(
              (s) => Boolean(s?.isPriority && !(s.title === currentSong?.title && s.artist === currentSong?.artist))
            )
            const backgroundTracks = effectiveQueue.filter(
              (s) => Boolean(s && !s.isPriority && !(s.title === currentSong?.title && s.artist === currentSong?.artist))
            )

            return (
              <div className="mt-8 w-full text-left rounded-2xl border border-border bg-surface-elevated p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border pb-3 mb-3 gap-2">
                  <div className="flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-text-muted" />
                    <h3 className="text-xs font-black uppercase tracking-wider text-text">
                      Live Session Queue
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const supabase = getSupabase()
                          const sender = user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'Listener'
                          await supabase.from('listening_room_commands').insert({
                            room_code: joinedRoom.code,
                            command: 'skip',
                            payload: {},
                            sender_name: sender
                          })
                          setMessage('Requested to skip current track!')
                          setTimeout(() => setMessage(''), 3000)
                        } catch {}
                      }}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold bg-surface hover:bg-hover text-text border border-border transition-all cursor-pointer shadow-xs active:scale-95"
                      title="Vote / request to skip to next track"
                    >
                      <SkipForward className="h-3 w-3 fill-current" />
                      <span>Skip Track</span>
                    </button>
                    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold border border-border bg-surface text-text-muted">
                      Discord Priority: {joinedRoom.song?.discordPriorityEnabled !== false ? 'ON' : 'OFF'}
                    </span>
                    <span className="rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-bold text-text-muted border border-border">
                      {effectiveQueue.length} Tracks Total
                    </span>
                  </div>
                </div>

                {/* Now Playing Live Showcase */}
                {currentSong && (
                  <div className="mb-2">
                    {isYouTubeSong(currentSong) && (
                      <div
                        id="youtube-stage-dock"
                        className="w-full aspect-video rounded-2xl bg-black/90 border border-border overflow-hidden mb-3 relative shadow-md flex items-center justify-center transition-all"
                      >
                        <div className="flex flex-col items-center gap-2.5 text-text-muted text-xs p-6 text-center">
                          <Radio className="h-6 w-6 text-primary animate-pulse" />
                          <span className="font-bold text-sm text-text">Synchronizing Live YouTube Stream...</span>
                          <span className="text-[11px] text-text-muted">Audio and video stream in unison across all room listeners.</span>
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('felo:dock-youtube-stage'))}
                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer border border-white/10 shadow-sm active:scale-95"
                          >
                            <Maximize2 className="h-3.5 w-3.5 text-primary" />
                            <span>Dock Video into Stage</span>
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-elevated border border-border text-primary">
                            <Radio className="h-5 w-5 animate-pulse" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="rounded-md bg-primary text-primary-foreground px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                                TRACK #{baseTrackNum}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                                PLAYING NOW
                              </span>
                              {currentSong.isPriority ? (
                                <span className="rounded-full bg-surface-elevated border border-border px-2 py-0.5 text-[9px] font-bold text-text-muted">
                                  Priority Request
                                </span>
                              ) : null}
                            </div>
                            <p className="text-sm font-bold text-text truncate mt-0.5">
                              {currentSong.title}
                            </p>
                            <p className="text-xs text-text-muted truncate">
                              {currentSong.artist}
                              {currentSong.album ? ` • ${currentSong.album}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono font-bold text-text-muted">
                            {formatTime(currentSong.duration || 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Queue Filter Tabs */}
                <div className="flex items-center gap-2 mt-4 mb-3 border-b border-border pb-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setListenerQueueTab('all')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      listenerQueueTab === 'all'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    All Upcoming ({priorityTracks.length + backgroundTracks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setListenerQueueTab('priority')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      listenerQueueTab === 'priority'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <span>Priority ({priorityTracks.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setListenerQueueTab('local')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      listenerQueueTab === 'local'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    Background Queue ({backgroundTracks.length})
                  </button>
                </div>

                {/* Priority Requests */}
                {(listenerQueueTab === 'all' || listenerQueueTab === 'priority') && priorityTracks.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-black uppercase tracking-wider text-text flex items-center gap-1">
                        <span>Priority Requests — Plays Next Up</span>
                        <span className="rounded-full bg-surface border border-border px-1.5 py-0.2 text-[9px] font-mono text-text-muted">
                          {priorityTracks.length}
                        </span>
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {priorityTracks.map((song, idx) => (
                        <div
                          key={`${(song as any).id || song.title}-${idx}`}
                          className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-surface hover:bg-surface-elevated transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <span className="text-[10px] font-mono font-bold text-primary w-5 text-center shrink-0">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-text truncate">{song.title}</p>
                              <p className="text-[11px] text-text-muted truncate">
                                {song.artist} {song.album ? `• ${song.album}` : ''}
                              </p>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono text-text-muted">
                            {formatTime(song.duration || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Background Queue */}
                {(listenerQueueTab === 'all' || listenerQueueTab === 'local') && backgroundTracks.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-black uppercase tracking-wider text-text-muted flex items-center gap-1">
                        <span>Host Background Queue</span>
                        <span className="rounded-full bg-surface border border-border px-1.5 py-0.2 text-[9px] font-mono text-text-muted">
                          {backgroundTracks.length}
                        </span>
                      </span>
                    </div>
                    <div className="space-y-1">
                      {backgroundTracks.slice(0, 10).map((song, idx) => (
                        <div
                          key={`${(song as any).id || song.title}-${idx}`}
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
                          <span className="text-[10px] font-mono text-text-muted">
                            {formatTime(song.duration || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {priorityTracks.length === 0 && backgroundTracks.length === 0 && (
                  <div className="py-6 text-center text-xs text-text-muted">
                    No upcoming tracks in the host's queue
                  </div>
                )}
              </div>
            )
          })()}

          {/* Real-time Room Chat */}
          <div className="mt-8 w-full text-left">
            <RoomChat
              roomId={joinedRoom.id}
              roomName={joinedRoom.name}
              onSelectUser={(userId, initialProfile) => {
                setSelectedMember({
                  userId,
                  displayName: initialProfile?.displayName || 'User',
                  avatarUrl: initialProfile?.avatarUrl || null,
                  isHost: userId === joinedRoom.host_id
                })
              }}
            />
          </div>
        </div>
      </div>

      {/* Replace Modal */}
      {showReplaceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <h3 className="text-base font-bold text-text">Choose Replacement Track</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  For "{joinedRoom.song?.title || 'Song'}" by {joinedRoom.song?.artist || 'Host'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReplaceModal(false)}
                className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search your library..."
                value={replaceSearchQuery}
                onChange={(e) => setReplaceSearchQuery(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-surface-elevated py-2 pl-9 pr-4 text-xs font-medium text-text placeholder-text-muted focus:border-primary focus:outline-none"
              />
            </div>

            <div className="mt-3 max-h-56 overflow-y-auto space-y-1">
              {filteredLibrary.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  No matching songs found in your library.
                </div>
              ) : (
                filteredLibrary.slice(0, 30).map((song) => (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => handleSelectSubstitute(song)}
                    className="w-full flex items-center justify-between rounded-lg p-2.5 text-left hover:bg-hover transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="truncate text-xs font-bold text-text">{song.title}</p>
                      <p className="truncate text-[11px] text-text-muted">{song.artist}</p>
                    </div>
                    <span className="text-[10px] font-bold text-text-muted">
                      {formatTime(song.duration)}
                    </span>
                  </button>
                ))
              )}
            </div>

            {/* Provider alternative search */}
            <div className="pt-3 border-t border-border mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] text-text-muted">Need a different version?</span>
              <button
                type="button"
                onClick={() => {
                  setShowReplaceModal(false)
                  if (joinedRoom.song) {
                    onOpenDownloadPanel?.({
                      id: '',
                      title: joinedRoom.song.title,
                      artist: joinedRoom.song.artist,
                      album: joinedRoom.song.album || '',
                      duration: joinedRoom.song.duration || 0,
                      artworkPath: joinedRoom.song.artworkUrl,
                      isOnline: true
                    })
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground px-3.5 py-1.5 text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Search All Providers</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
