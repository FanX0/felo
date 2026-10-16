import {
  Loader2,
  Smartphone,
  Laptop2,
  RefreshCw,
  FolderOpen,
  Plus
} from 'lucide-react'
import { cn } from '../../../lib/utils'
import type { RemoteLibraryDevice } from '../types'

interface LibraryEmptyStateProps {
  librarySource: string
  selectedRemoteDevice: RemoteLibraryDevice | null
  isDeviceSyncing: boolean
  isElectronApp: boolean
  isMobile: boolean
  isScanning: boolean
  isSelectingFolder: boolean
  hasRemoteDevice: boolean
  remoteLibraryDevices: RemoteLibraryDevice[]
  onSyncDevice: () => void
  onSwitchToLocal: () => void
  onAddFolder: () => void
  onAddFiles: () => void
  onBrowseRemote: (deviceId: string) => void
}

export function LibraryEmptyState({
  librarySource,
  selectedRemoteDevice,
  isDeviceSyncing,
  isElectronApp,
  isMobile,
  isScanning,
  isSelectingFolder,
  hasRemoteDevice,
  remoteLibraryDevices,
  onSyncDevice,
  onSwitchToLocal,
  onAddFolder,
  onAddFiles,
  onBrowseRemote
}: LibraryEmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-4 p-6 text-center">
      {librarySource !== 'local' ? (
        <>
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
            {isDeviceSyncing ? (
              <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
            ) : selectedRemoteDevice?.device_type === 'mobile' ||
              /iphone|ipad|android|phone|mobile|ios/i.test(
                selectedRemoteDevice?.device_name || ''
              ) ? (
              <Smartphone className="w-7 h-7 text-emerald-400" />
            ) : (
              <Laptop2 className="w-7 h-7 text-emerald-400" />
            )}
          </div>
          <p className="text-base font-bold text-white">
            {isDeviceSyncing
              ? `Syncing ${selectedRemoteDevice?.device_name || 'Device'} Library...`
              : `No Songs Loaded from ${selectedRemoteDevice?.device_name || 'Device'}`}
          </p>
          <p className="text-xs text-text-muted max-w-sm">
            {isDeviceSyncing
              ? `Requesting track catalog from ${selectedRemoteDevice?.device_name || 'connected device'} over Realtime sync...`
              : `Ensure Felo is open on ${selectedRemoteDevice?.device_name || 'the device'} with songs in its library.`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
            <button
              type="button"
              disabled={isDeviceSyncing}
              onClick={onSyncDevice}
              className="flex h-10 items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 px-5 text-xs font-bold text-black transition-all hover:scale-[1.02] shadow-md cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isDeviceSyncing && 'animate-spin')} />
              <span>{isDeviceSyncing ? 'Syncing...' : `Sync from ${selectedRemoteDevice?.device_name || 'Device'}`}</span>
            </button>
            <button
              type="button"
              onClick={onSwitchToLocal}
              className="flex h-10 items-center gap-2 rounded-full border border-border/80 bg-surface-elevated px-4 text-xs font-medium text-text-muted hover:text-white transition cursor-pointer"
            >
              <span>This Device</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/70 shadow-inner">
            <FolderOpen className="w-7 h-7 text-emerald-400" />
          </div>
          <p className="text-base font-bold text-white">Your library is currently empty.</p>
          <p className="text-xs text-text-muted max-w-sm text-center">
            {isElectronApp
              ? 'Add a local music folder to scan and index all your high-resolution and lossless audio tracks.'
              : 'Add a music folder or audio files from your mobile device storage to listen offline anytime with lossless audio quality.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <button
              type="button"
              onClick={onAddFolder}
              disabled={isScanning || isSelectingFolder}
              className="flex h-11 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-md cursor-pointer disabled:opacity-60"
            >
              {isSelectingFolder ? (
                <Loader2 className="h-4 w-4 animate-spin text-black" />
              ) : (
                <Plus className="h-4 w-4 stroke-[3]" />
              )}
              <span>
                {isSelectingFolder
                  ? 'Selecting Folder...'
                  : isMobile
                    ? 'Add Music Folder'
                    : 'Add Local Music Folder'}
              </span>
            </button>
            {!isElectronApp && (
              <button
                type="button"
                onClick={onAddFiles}
                disabled={isScanning}
                className="flex h-11 items-center gap-2 rounded-full border border-white/20 bg-surface-elevated px-5 text-sm font-medium text-white transition-all hover:scale-[1.02] hover:bg-hover shadow-md cursor-pointer disabled:opacity-60"
              >
                <FolderOpen className="h-4 w-4 text-emerald-400" />
                <span>Select Audio Files</span>
              </button>
            )}
            {hasRemoteDevice && (
              <button
                type="button"
                onClick={() => onBrowseRemote(remoteLibraryDevices[0]?.id || 'pc')}
                className="flex h-11 items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 px-6 text-sm font-bold text-black transition-all hover:scale-[1.02] shadow-md cursor-pointer"
              >
                <Laptop2 className="h-4 w-4" />
                <span>Browse {remoteLibraryDevices[0]?.device_name || 'Device'}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
