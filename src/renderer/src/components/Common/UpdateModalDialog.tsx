// Felo — Update Modal Dialog Component
// High-visibility, non-disruptive update prompt matching Felo design system

import { useState, useEffect, type ReactElement } from 'react'
import { Sparkles, RefreshCw, X, AlertCircle } from 'lucide-react'
import {
  registerUpdateDialogHandler,
  isStandaloneDisplayMode,
  type UpdateDialogPayload
} from '../../lib/swUpdateCoordinator'

export default function UpdateModalDialog(): ReactElement | null {
  const [payload, setPayload] = useState<UpdateDialogPayload | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    return registerUpdateDialogHandler((next) => {
      setPayload(next)
      if (!next) setIsRefreshing(false)
    })
  }, [])

  if (!payload || !payload.isOpen) return null

  const isRecovery = payload.isRecovery === true
  const isStandalone = isStandaloneDisplayMode()

  const handleRefresh = () => {
    setIsRefreshing(true)
    payload.onRefresh()
  }

  const handleLater = () => {
    payload.onLater?.()
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="w-full max-w-sm bg-[#161618] rounded-2xl border border-white/10 shadow-2xl p-5 overflow-hidden flex flex-col gap-4 text-text animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm ${
                isRecovery
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  : 'bg-primary-amber/15 border-primary-amber/30 text-primary-amber'
              }`}
            >
              {isRecovery ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                {isRecovery ? 'Refresh Needed' : 'Update Available'}
              </h3>
              <p className="text-[11px] text-zinc-400">
                {isRecovery
                  ? 'App Assets Updated'
                  : payload.version
                    ? `Felo v${payload.version}`
                    : 'A new version is ready'}
              </p>
            </div>
          </div>

          {!isRecovery && (
            <button
              type="button"
              onClick={handleLater}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="text-xs text-zinc-300 leading-relaxed">
          {isRecovery ? (
            <p>
              Felo was updated on the server. Please refresh your session to load the latest application assets.
            </p>
          ) : (
            <p>
              A new version of Felo is ready.{' '}
              {isStandalone
                ? 'Reopen or refresh the app to apply the latest features and bug fixes.'
                : 'Refresh now to enjoy the latest features and improvements.'}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-1">
          {!isRecovery && (
            <button
              type="button"
              onClick={handleLater}
              disabled={isRefreshing}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Later
            </button>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-white text-black hover:bg-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-md active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Updating...' : 'Refresh Now'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
