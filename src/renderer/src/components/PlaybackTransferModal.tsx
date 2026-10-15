import { type ReactElement } from 'react'
import { Laptop2, Smartphone, Globe, Radio, X, Music } from 'lucide-react'
import { usePlaybackArbitration } from '../hooks/usePlaybackArbitration'
import { toMediaUrl } from '../lib/media'
import { isLocalSong } from '../lib/songUtils'
import { getDeviceCategory, getDeviceCategoryLabel } from '../lib/deviceInfo'

export default function PlaybackTransferModal(): ReactElement | null {
  const { playbackConflict, resolveConflict } = usePlaybackArbitration()

  if (!playbackConflict) return null

  const activeSong = playbackConflict.activeSong
  const pendingSong = playbackConflict.pendingSong
  const activeDeviceName = playbackConflict.activeDeviceName || 'Felo Desktop'
  const isPendingLocal = isLocalSong(pendingSong, playbackConflict.pendingContext)
  const activeCategory =
    playbackConflict.activeDeviceCategory ||
    getDeviceCategory({
      device_name: activeDeviceName
    })
  const activeCategoryLabel = getDeviceCategoryLabel(activeCategory)

  const activeArtwork = activeSong ? activeSong.artworkUrl || toMediaUrl(activeSong.artworkPath) : null

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md bg-[#161618] sm:rounded-2xl rounded-t-2xl border border-white/10 shadow-2xl p-5 overflow-hidden flex flex-col gap-4 text-text animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              {activeCategory === 'app_pc' ? (
                <Laptop2 className="w-4 h-4" />
              ) : activeCategory === 'web_pc' ? (
                <Globe className="w-4 h-4" />
              ) : (
                <Smartphone className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-semibold text-white">Playback Active</h3>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-white/10 text-zinc-300">
                  {activeCategoryLabel}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Playing on <span className="text-emerald-400 font-medium">{activeDeviceName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resolveConflict('cancel')}
            className="p-1 rounded-md text-text-muted hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Active PC Track Card */}
        {activeSong && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5">
            <div className="w-11 h-11 rounded-lg bg-surface-elevated overflow-hidden shrink-0 flex items-center justify-center border border-white/10 relative">
              {activeArtwork ? (
                <img src={activeArtwork} alt={activeSong.title} className="w-full h-full object-cover" />
              ) : (
                <Music className="w-5 h-5 text-text-muted" />
              )}
              <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                Now Playing on {activeDeviceName}
              </div>
              <div className="text-xs font-semibold text-white truncate">{activeSong.title}</div>
              <div className="text-[11px] text-text-muted truncate">{activeSong.artist || 'Unknown Artist'}</div>
            </div>
          </div>
        )}

        {/* Selected Track Notice (if user clicked a song) */}
        {pendingSong && pendingSong.id !== activeSong?.id && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
            <span className="text-amber-400 font-bold shrink-0">Selected:</span>
            <span className="text-amber-200 truncate font-medium">
              "{pendingSong.title}" {pendingSong.artist ? `– ${pendingSong.artist}` : ''}
            </span>
          </div>
        )}

        {/* Choices */}
        <div className="flex flex-col gap-2">
          {/* Choice: Move Playback to This Device (Primary if pending song is local) */}
          <button
            type="button"
            onClick={() => resolveConflict('transfer')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all group cursor-pointer ${
              isPendingLocal
                ? 'bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25'
                : 'bg-white/[0.04] border border-white/10 hover:bg-white/[0.08]'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform ${
                isPendingLocal
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-white/10 text-white'
              }`}
            >
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-semibold ${
                  isPendingLocal ? 'text-emerald-300' : 'text-white'
                }`}
              >
                Move Playback to this Device
              </div>
              <div className="text-xs text-text-muted">
                Play locally here and pause {activeDeviceName}
              </div>
            </div>
          </button>

          {/* Choice: Play on Remote (Primary if online stream, disabled/muted if local only) */}
          <button
            type="button"
            disabled={isPendingLocal}
            onClick={() => !isPendingLocal && resolveConflict('remote')}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all group ${
              isPendingLocal
                ? 'bg-white/[0.02] border border-white/5 opacity-50 cursor-not-allowed'
                : 'bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 cursor-pointer'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform ${
                isPendingLocal
                  ? 'bg-white/5 text-text-muted'
                  : 'bg-emerald-500/20 text-emerald-400 group-hover:scale-105'
              }`}
            >
              <Laptop2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-sm font-semibold ${
                  isPendingLocal ? 'text-text-muted' : 'text-emerald-300'
                }`}
              >
                Play on {activeDeviceName}
              </div>
              <div className="text-xs text-text-muted">
                {isPendingLocal
                  ? 'Local file • Only playable on this device'
                  : `Keep music on your ${activeDeviceName} speakers and control it from this device`}
              </div>
            </div>
          </button>


          {/* Choice 3: Take Over Current Track from PC */}
          {activeSong && (
            <button
              type="button"
              onClick={() => resolveConflict('resume_remote_here')}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.06] text-left transition-all group cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-amber-300">
                  Resume "{activeSong.title}" here
                </div>
                <div className="text-[11px] text-text-muted truncate">
                  Transfer current track and resume from{' '}
                  {Math.floor(playbackConflict.activePosition / 60)}:
                  {String(Math.floor(playbackConflict.activePosition % 60)).padStart(2, '0')}
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Cancel Button */}
        <button
          type="button"
          onClick={() => resolveConflict('cancel')}
          className="w-full py-2 text-xs font-semibold text-text-muted hover:text-white rounded-xl hover:bg-white/5 transition-colors text-center cursor-pointer"
        >
          Cancel (Leave {activeDeviceName} playing)
        </button>
      </div>
    </div>
  )
}
