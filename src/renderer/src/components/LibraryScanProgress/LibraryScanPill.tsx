import { useLibraryScanStore } from '../../hooks/useLibraryScanStore'
import {
  Folder,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronUp,
  ChevronDown,
  Music,
  Zap,
  Clock,
  Check
} from 'lucide-react'

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '0s'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export default function LibraryScanPill() {
  const {
    isScanning,
    progress,
    isPillExpanded,
    isDismissed,
    togglePillExpanded,
    dismiss,
    cancelScan
  } = useLibraryScanStore()

  if (!progress || isDismissed) return null

  const isCompleted = progress.status === 'completed'
  const isCancelled = progress.status === 'cancelled'
  const isError = progress.status === 'error'

  return (
    <div className="fixed bottom-24 right-6 z-50 select-none animate-in fade-in slide-in-from-bottom-3 duration-300">
      {!isPillExpanded ? (
        /* Collapsed Floating Pill */
        <div className="flex items-center gap-2.5 rounded-full bg-[#181818]/95 border border-border/80 px-3.5 py-2 shadow-2xl backdrop-blur-md transition-all hover:border-primary-amber/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
          {isScanning ? (
            <>
              <div className="flex items-center justify-center relative">
                <RefreshCw className="h-4 w-4 animate-spin text-primary-amber" />
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-amber opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-amber" />
                </span>
              </div>
              <button
                type="button"
                onClick={togglePillExpanded}
                className="flex items-center gap-2 text-left"
                title="Click for scan details"
              >
                <span className="text-xs font-bold text-white tabular-nums">
                  {progress.percent}%
                </span>
                <span className="text-[11px] text-text-muted tabular-nums">
                  ({progress.processedFiles}/{progress.totalFiles})
                </span>
                <span className="max-w-[120px] md:max-w-[180px] truncate text-[11px] font-medium text-text-muted">
                  {progress.currentTrack
                    ? `${progress.currentTrack.artist} - ${progress.currentTrack.title}`
                    : progress.currentFile || 'Indexing...'}
                </span>
              </button>
              <button
                type="button"
                onClick={togglePillExpanded}
                className="p-1 rounded-full text-text-muted hover:text-white transition-colors"
                title="Expand details"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => cancelScan()}
                className="p-1 rounded-full text-text-muted hover:text-red-400 transition-colors"
                title="Cancel scan"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : isCompleted ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary-amber shrink-0" />
              <button
                type="button"
                onClick={togglePillExpanded}
                className="text-xs font-medium text-white hover:underline"
              >
                Indexed {progress.addedCount + progress.updatedCount + progress.skippedCount} songs
                {progress.skippedCount > 0 ? ` (${progress.skippedCount} cached)` : ''}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="p-1 rounded-full text-text-muted hover:text-white transition-colors"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : isCancelled ? (
            <>
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="text-xs font-medium text-text">Scan stopped</span>
              <button
                type="button"
                onClick={dismiss}
                className="p-1 rounded-full text-text-muted hover:text-white transition-colors"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span className="text-xs font-medium text-red-400">Scan failed</span>
              <button
                type="button"
                onClick={dismiss}
                className="p-1 rounded-full text-text-muted hover:text-white transition-colors"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      ) : (
        /* Expanded Floating Card Modal */
        <div className="w-[340px] md:w-[380px] rounded-2xl bg-[#161616]/98 border border-border p-4 shadow-2xl backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-border/20">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-primary-amber/10 border border-primary-amber/20 text-primary-amber">
                {isScanning ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Folder className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    {isScanning
                      ? progress.status === 'discovering'
                        ? 'Discovering Files'
                        : progress.status === 'committing'
                          ? 'Saving to Database'
                          : 'Indexing Library'
                      : isCompleted
                        ? 'Scan Complete'
                        : isCancelled
                          ? 'Scan Cancelled'
                          : 'Scan Error'}
                  </h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-elevated font-mono font-semibold text-text-muted">
                    {progress.percent}%
                  </span>
                </div>
                <p className="text-[11px] text-text-muted truncate mt-0.5" title={progress.folderPath}>
                  {progress.folderName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={togglePillExpanded}
                className="p-1 rounded-md text-text-muted hover:text-white hover:bg-hover transition-colors"
                title="Collapse"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="p-1 rounded-md text-text-muted hover:text-white hover:bg-hover transition-colors"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-3.5 space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#242424]">
              <div
                className={`h-full transition-all duration-300 ${
                  isCompleted
                    ? 'bg-primary-amber'
                    : isCancelled
                      ? 'bg-amber-400'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-primary-amber'
                }`}
                style={{ width: `${Math.max(4, progress.percent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-muted font-medium tabular-nums">
              <span>
                {progress.processedFiles} of {progress.totalFiles} audio files
              </span>
              <span className="font-bold text-white">{progress.percent}%</span>
            </div>
          </div>

          {/* Current track ticker */}
          {isScanning && (progress.currentTrack || progress.currentFile) && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 border border-border/30">
              <Music className="h-3.5 w-3.5 text-primary-amber shrink-0 animate-pulse" />
              <div className="min-w-0 flex-1 text-[11px]">
                <p className="truncate text-text font-medium">
                  {progress.currentTrack?.title || progress.currentFile}
                </p>
                {progress.currentTrack?.artist && (
                  <p className="truncate text-text-muted text-[10px]">{progress.currentTrack.artist}</p>
                )}
              </div>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-surface/50 p-2 border border-border/20 text-center">
            <div className="flex flex-col items-center justify-center p-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider flex items-center gap-1">
                <Zap className="h-3 w-3 text-primary-amber" /> Speed
              </span>
              <span className="text-xs font-bold text-white tabular-nums mt-0.5">
                {progress.speed ? `${progress.speed}/s` : '—'}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-1 border-x border-border/20">
              <span className="text-[10px] text-text-muted uppercase tracking-wider flex items-center gap-1">
                <Clock className="h-3 w-3 text-secondary-cyan" /> Remaining
              </span>
              <span className="text-xs font-bold text-white tabular-nums mt-0.5">
                {isScanning && progress.estimatedRemainingMs
                  ? formatDuration(progress.estimatedRemainingMs)
                  : isScanning
                    ? 'Estimating...'
                    : 'Done'}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center p-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">Elapsed</span>
              <span className="text-xs font-bold text-white tabular-nums mt-0.5">
                {formatDuration(progress.elapsedMs)}
              </span>
            </div>
          </div>

          {/* Stats breakdown */}
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-muted px-1">
            <span>
              Added: <strong className="text-white">{progress.addedCount}</strong>
            </span>
            <span>
              Updated: <strong className="text-white">{progress.updatedCount}</strong>
            </span>
            <span>
              Cached: <strong className="text-white">{progress.skippedCount}</strong>
            </span>
          </div>

          {/* Action button */}
          {isScanning && (
            <div className="mt-3 pt-2 border-t border-border/20 flex justify-end">
              <button
                type="button"
                onClick={() => cancelScan()}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors"
              >
                <X className="h-3 w-3" /> Stop Scan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
