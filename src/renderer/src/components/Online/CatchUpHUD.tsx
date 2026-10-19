import { useCallback, useMemo, type ReactElement } from 'react'
import { useListeningStore } from '../../hooks/useListeningStore'
import { RefreshCw } from 'lucide-react'

/** Drift thresholds (seconds) for CatchUp HUD visibility */
const DRIFT_SHOW_THRESHOLD = 1.5
const DRIFT_PROMINENT_THRESHOLD = 5.0

/**
 * CatchUpHUD — Floating banner shown to guest/join users when their playback
 * position drifts beyond a threshold from the host.
 *
 * Instead of auto-seeking (which causes audible jumps), this component offers
 * a manual "Catch Up" button. Inspired by Mindory's LiveBroadcastHUD pattern.
 */
export default function CatchUpHUD(): ReactElement | null {
  const driftSeconds = useListeningStore((state) => state.driftSeconds)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const syncStatus = useListeningStore((state) => state.syncStatus)
  const isSyncLocked = useListeningStore((state) => state.isSyncLocked)

  const absDrift = Math.abs(driftSeconds)
  const isVisible = Boolean(
    joinedRoom &&
    syncStatus === 'synced' &&
    !isSyncLocked &&
    absDrift >= DRIFT_SHOW_THRESHOLD
  )

  const isProminent = absDrift >= DRIFT_PROMINENT_THRESHOLD

  const driftLabel = useMemo(() => {
    if (!isVisible) return ''
    const sign = driftSeconds > 0 ? '+' : '-'
    return `${sign}${absDrift.toFixed(1)}s`
  }, [isVisible, driftSeconds, absDrift])

  const handleCatchUp = useCallback(() => {
    useListeningStore.getState().performOneTimeSyncWithHost({
      forceSeek: true,
      logReason: 'CatchUp HUD'
    })
    useListeningStore.setState({ driftSeconds: 0 })
  }, [])

  if (!isVisible) return null

  return (
    <div
      className={`
        fixed bottom-24 left-1/2 -translate-x-1/2 z-50
        flex items-center gap-2.5 px-4 py-2 rounded-full
        shadow-lg backdrop-blur-lg border
        transition-all duration-300 ease-out
        ${isProminent
          ? 'bg-red-500/20 border-red-500/40 text-red-200 animate-pulse'
          : 'bg-yellow-500/15 border-yellow-500/30 text-yellow-200'
        }
      `}
    >
      <RefreshCw className={`w-4 h-4 ${isProminent ? 'animate-spin' : ''}`} />
      <span className="text-sm font-medium whitespace-nowrap">
        {isProminent ? 'Out of sync' : 'Slight drift'} ({driftLabel})
      </span>
      <button
        onClick={handleCatchUp}
        className={`
          px-3 py-1 rounded-full text-xs font-semibold
          transition-colors duration-200
          ${isProminent
            ? 'bg-red-500/80 hover:bg-red-500 text-white'
            : 'bg-yellow-500/60 hover:bg-yellow-500/80 text-white'
          }
        `}
      >
        Catch Up
      </button>
    </div>
  )
}
