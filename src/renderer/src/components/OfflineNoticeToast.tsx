import { useEffect, useState } from 'react'
import { WifiOff, Wifi, RefreshCw } from 'lucide-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { skipWaitingAndReload } from '../lib/registerServiceWorker'

export default function OfflineNoticeToast() {
  const { isOnline, wasOffline } = useNetworkStatus()
  const [hasUpdate, setHasUpdate] = useState(false)

  useEffect(() => {
    const handleUpdate = () => setHasUpdate(true)
    window.addEventListener('felo:sw-updated', handleUpdate)
    return () => window.removeEventListener('felo:sw-updated', handleUpdate)
  }, [])

  // If online, no update, and not recently reconnected: nothing to show
  if (isOnline && !wasOffline && !hasUpdate) {
    return null
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto select-none transition-all duration-300">
      {hasUpdate && (
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-zinc-900/95 border border-white/20 text-white shadow-2xl backdrop-blur-md text-xs font-semibold animate-in fade-in slide-in-from-top-2">
          <span>A new version of Felo is ready</span>
          <button
            type="button"
            onClick={skipWaitingAndReload}
            className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-black hover:bg-zinc-200 transition text-[11px] font-bold"
          >
            <RefreshCw className="w-3 h-3 animate-spin" />
            Reload
          </button>
        </div>
      )}

      {!isOnline && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-700/80 text-zinc-300 shadow-2xl backdrop-blur-md text-xs font-medium animate-in fade-in slide-in-from-top-2">
          <WifiOff className="w-3.5 h-3.5 text-zinc-400" />
          <span>Offline mode • Playing from local library</span>
        </div>
      )}

      {isOnline && wasOffline && !hasUpdate && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 shadow-2xl backdrop-blur-md text-xs font-medium animate-in fade-in slide-in-from-top-2">
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span>Back online</span>
        </div>
      )}
    </div>
  )
}
