import { WifiOff, Wifi } from 'lucide-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

export default function OfflineNoticeToast() {
  const { isOnline, wasOffline } = useNetworkStatus()

  // If online and not recently reconnected: nothing to show
  if (isOnline && !wasOffline) {
    return null
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto select-none transition-all duration-300">
      {!isOnline && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-700/80 text-zinc-300 shadow-2xl backdrop-blur-md text-xs font-medium animate-in fade-in slide-in-from-top-2">
          <WifiOff className="w-3.5 h-3.5 text-zinc-400" />
          <span>Offline mode • Playing from local library</span>
        </div>
      )}

      {isOnline && wasOffline && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/40 text-emerald-300 shadow-2xl backdrop-blur-md text-xs font-medium animate-in fade-in slide-in-from-top-2">
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span>Back online</span>
        </div>
      )}
    </div>
  )
}
