import React from 'react'
import {
  Laptop2,
  Smartphone,
  RefreshCw,
  Search,
  X,
  List,
  ArrowUp,
  Check,
  Plus,
  Loader2
} from 'lucide-react'
import { cn } from '../../../lib/utils'
import { normalizeDeviceId } from '../../../hooks/useConnectedDeviceStore'
import { sortLabels } from '../utils'
import type {
  LibrarySortKey,
  SortDirection,
  LibraryViewMode,
  RemoteLibraryDevice
} from '../types'

interface LibraryToolbarProps {
  librarySource: string
  selectedRemoteDevice: RemoteLibraryDevice | null
  songCount: number
  totalSongCount: number
  hasRemoteDevice: boolean
  remoteLibraryDevices: RemoteLibraryDevice[]
  isElectronApp: boolean
  isMobile: boolean
  searchQuery: string
  isSearchOpen: boolean
  isViewMenuOpen: boolean
  sortKey: LibrarySortKey
  sortDirection: SortDirection
  viewMode: LibraryViewMode
  isLoadingSongs: boolean
  isScanning: boolean
  isSelectingFolder: boolean
  scanProgress: any
  isLoadingPcLibrary: boolean
  isLoadingDeviceLibrary: Record<string, boolean>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  viewMenuRef: React.RefObject<HTMLDivElement | null>
  onSetLibrarySource: (source: string) => void
  onRefreshRemote: (device: RemoteLibraryDevice) => void
  onSetSearchQuery: (query: string) => void
  onSetIsSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  onSetIsViewMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  onSort: (key: LibrarySortKey) => void
  onSetViewMode: (mode: LibraryViewMode) => void
  onRefreshLibrary: () => void
  onAddFolder: () => void
  onCancelScan: () => void
}

export function LibraryToolbar({
  librarySource,
  selectedRemoteDevice,
  songCount,
  totalSongCount,
  hasRemoteDevice,
  remoteLibraryDevices,
  isElectronApp,
  isMobile,
  searchQuery,
  isSearchOpen,
  isViewMenuOpen,
  sortKey,
  sortDirection,
  viewMode,
  isLoadingSongs,
  isScanning,
  isSelectingFolder,
  scanProgress,
  isLoadingPcLibrary,
  isLoadingDeviceLibrary,
  searchInputRef,
  viewMenuRef,
  onSetLibrarySource,
  onRefreshRemote,
  onSetSearchQuery,
  onSetIsSearchOpen,
  onSetIsViewMenuOpen,
  onSort,
  onSetViewMode,
  onRefreshLibrary,
  onAddFolder,
  onCancelScan
}: LibraryToolbarProps) {
  return (
    <>
      <div className="mb-4 sm:mb-6 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5 sm:gap-4 min-w-0">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-text tracking-tight truncate">
              {librarySource === 'local'
                ? 'My Library'
                : selectedRemoteDevice
                  ? `${selectedRemoteDevice.device_name} Library`
                  : 'Remote Library'}
            </h1>
            <span className="text-xs sm:text-[13px] font-medium text-text-muted tabular-nums shrink-0">
              {songCount} {songCount === 1 ? 'song' : 'songs'}
              {searchQuery && totalSongCount !== songCount && (
                <span className="opacity-75 hidden sm:inline"> (of {totalSongCount})</span>
              )}
            </span>
          </div>

          {/* Dynamic Multi-Device Library Source Switcher */}
          {hasRemoteDevice && (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-elevated border border-border/60 text-xs shrink-0 shadow-sm max-w-[50vw] sm:max-w-none overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => onSetLibrarySource('local')}
                className={cn(
                  'px-3 py-1 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0',
                  librarySource === 'local'
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-text-muted hover:text-white'
                )}
              >
                {isElectronApp || !isMobile ? (
                  <Laptop2 className="w-3.5 h-3.5" />
                ) : (
                  <Smartphone className="w-3.5 h-3.5" />
                )}
                <span>This Device</span>
              </button>

              {remoteLibraryDevices.map((dev) => {
                const isSelected =
                  librarySource === dev.id ||
                  (librarySource === 'pc' && remoteLibraryDevices[0]?.id === dev.id)
                const isDevMobile =
                  dev.device_type === 'mobile' ||
                  /iphone|ipad|android|phone|mobile|ios/i.test(dev.device_name)
                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => onSetLibrarySource(dev.id)}
                    className={cn(
                      'px-3 py-1 rounded-lg font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0',
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'text-text-muted hover:text-white'
                    )}
                  >
                    {isDevMobile ? (
                      <Smartphone className="w-3.5 h-3.5" />
                    ) : (
                      <Laptop2 className="w-3.5 h-3.5" />
                    )}
                    <span>{dev.device_name}</span>
                    {isSelected && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onRefreshRemote(dev)
                        }}
                        title={`Refresh library from ${dev.device_name}`}
                        className="ml-0.5 p-0.5 hover:text-white transition"
                      >
                        <RefreshCw
                          className={cn(
                            'w-3 h-3',
                            (isLoadingPcLibrary || Boolean(isLoadingDeviceLibrary[normalizeDeviceId(dev.id)])) &&
                              'animate-spin'
                          )}
                        />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Desktop Expanding In-Library Search Filter */}
            <div
              className={cn(
                'hidden md:flex h-11 origin-right items-center overflow-hidden rounded-full border border-border/60 bg-surface-elevated transition-all duration-300',
                isSearchOpen ? 'w-64 px-3' : 'w-11'
              )}
            >
              <button
                type="button"
                title="Search library"
                onClick={() => onSetIsSearchOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-text-muted hover:text-white cursor-pointer"
              >
                <Search className="h-4 w-4" />
              </button>
              <input
                ref={searchInputRef as React.RefObject<HTMLInputElement>}
                value={searchQuery}
                onChange={(event) => onSetSearchQuery(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchQuery) {
                      onSetSearchQuery('')
                    } else {
                      onSetIsSearchOpen(false)
                    }
                  }
                }}
                onBlur={() => !searchQuery && onSetIsSearchOpen(false)}
                placeholder="Filter library..."
                aria-label="Filter library"
                className={cn(
                  'h-full min-w-0 flex-1 bg-transparent pr-1 text-sm text-white outline-none placeholder:text-text-muted',
                  isSearchOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
                )}
              />
              {searchQuery && isSearchOpen && (
                <button
                  type="button"
                  onClick={() => {
                    onSetSearchQuery('')
                    searchInputRef.current?.focus()
                  }}
                  className="p-1 text-text-muted hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Mobile Search Toggle Button */}
            <button
              type="button"
              title="Search library"
              onClick={() => {
                onSetIsSearchOpen((open: boolean) => !open)
                if (!isSearchOpen) {
                  setTimeout(() => searchInputRef.current?.focus(), 50)
                }
              }}
              className={cn(
                'md:hidden flex h-9 w-9 items-center justify-center rounded-full border transition-colors cursor-pointer',
                isSearchOpen
                  ? 'border-white/40 bg-white/20 text-white'
                  : 'border-border/60 bg-surface-elevated text-text-muted hover:text-white'
              )}
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Sort & View Dropdown Menu */}
            <div ref={viewMenuRef as React.RefObject<HTMLDivElement>} className="relative">
              <button
                type="button"
                title="Sort and view options"
                aria-expanded={isViewMenuOpen}
                onClick={(event) => {
                  event.stopPropagation()
                  onSetIsViewMenuOpen((isOpen: boolean) => !isOpen)
                }}
                className={cn(
                  'flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full shadow-sm transition-colors border cursor-pointer',
                  isViewMenuOpen
                    ? 'border-white/30 bg-white/20 text-white'
                    : 'border-border/60 bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
                )}
              >
                <List className="h-4 w-4" />
              </button>
              {isViewMenuOpen && (
                <div
                  className="absolute right-0 top-full z-[1000] mt-2 w-48 rounded-xl border border-border/80 bg-surface-elevated py-2.5 text-xs shadow-2xl backdrop-blur-md"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="px-3 pb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    Sort by
                  </div>
                  {(['dateAdded', 'title', 'artist', 'album', 'duration', 'default'] as const).map(
                    (key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onSort(key)}
                        className={cn(
                          'flex w-full items-center justify-between px-3 py-1.5 text-left font-medium transition-colors hover:bg-white/10 cursor-pointer',
                          sortKey === key ? 'text-white font-bold' : 'text-text-muted'
                        )}
                      >
                        <span>{sortLabels[key]}</span>
                        {sortKey === key && (
                          <ArrowUp
                            className={cn(
                              'h-3.5 w-3.5 transition-transform text-white',
                              sortDirection === 'desc' && 'rotate-180'
                            )}
                          />
                        )}
                      </button>
                    )
                  )}

                  <div className="my-1.5 border-t border-border/40" />

                  <div className="px-3 pb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    View mode
                  </div>
                  {(['compact', 'list'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onSetViewMode(mode)}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left font-medium transition-colors hover:bg-white/10 cursor-pointer',
                        viewMode === mode ? 'text-white font-bold' : 'text-text-muted'
                      )}
                    >
                      <span className="capitalize">{mode}</span>
                      {viewMode === mode && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Refresh Library Button */}
            <button
              type="button"
              title="Refresh library"
              onClick={onRefreshLibrary}
              disabled={isLoadingSongs}
              className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full border border-border/60 bg-surface-elevated text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingSongs && 'animate-spin')} />
            </button>

            {/* Add Folder Button */}
            <button
              type="button"
              onClick={onAddFolder}
              disabled={isScanning || isSelectingFolder}
              className="flex h-9 sm:h-11 items-center gap-1.5 sm:gap-2.5 rounded-full bg-white px-3 sm:px-5 text-xs sm:text-sm font-bold text-black transition-all hover:scale-[1.02] hover:bg-white/90 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 shrink-0 whitespace-nowrap cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary-amber" />
                  <span className="tabular-nums">
                    {scanProgress?.percent !== undefined
                      ? `${scanProgress.percent}%`
                      : 'Scanning...'}
                  </span>
                </>
              ) : isSelectingFolder ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                  <span>Selecting...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 stroke-[3]" />
                  <span>{isMobile ? 'Add Music' : 'Add Folder'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Full-Width In-Library Search Filter Row */}
        {isSearchOpen && (
          <div className="md:hidden mt-2.5 flex items-center gap-2 bg-surface-elevated border border-border/60 rounded-full px-3.5 py-1.5 animate-in fade-in slide-in-from-top-1">
            <Search className="h-4 w-4 text-text-muted shrink-0" />
            <input
              ref={searchInputRef as React.RefObject<HTMLInputElement>}
              value={searchQuery}
              onChange={(e) => onSetSearchQuery(e.target.value)}
              placeholder="Filter library..."
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-text-muted"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSetSearchQuery('')}
                className="p-1 text-text-muted hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onSetSearchQuery('')
                onSetIsSearchOpen(false)
              }}
              className="text-xs font-semibold text-text-muted hover:text-white ml-1 shrink-0"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Scanning Banner */}
      {isScanning && scanProgress && (
        <div className="mb-5 rounded-2xl bg-[#1b1b1b] border border-border/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-amber/15 text-primary-amber border border-primary-amber/25">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white tracking-wide">
                    {scanProgress.status === 'discovering'
                      ? 'Discovering Audio Files...'
                      : scanProgress.status === 'committing'
                        ? 'Saving To Database...'
                        : 'Indexing Music Folder'}
                  </h3>
                  <span className="rounded-full bg-primary-amber/15 px-2 py-0.5 text-xs font-mono font-bold text-primary-amber border border-primary-amber/25 tabular-nums">
                    {scanProgress.percent}%
                  </span>
                </div>
                <p
                  className="text-xs text-text-muted truncate mt-0.5"
                  title={scanProgress.folderPath}
                >
                  {scanProgress.folderName} •{' '}
                  <span className="text-white font-medium tabular-nums">
                    {scanProgress.processedFiles} of {scanProgress.totalFiles} songs
                  </span>
                  {scanProgress.speed ? ` • ~${scanProgress.speed} songs/sec` : ''}
                  {scanProgress.estimatedRemainingMs
                    ? ` • ~${Math.round(scanProgress.estimatedRemainingMs / 1000)}s left`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <button
                type="button"
                onClick={onCancelScan}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" /> Stop Scan
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#272727]">
              <div
                className="h-full bg-primary-amber transition-all duration-200"
                style={{ width: `${Math.max(2, scanProgress.percent)}%` }}
              />
            </div>
            {(scanProgress.currentTrack || scanProgress.currentFile) && (
              <p className="text-[11px] text-text-muted truncate">
                <span className="text-white/60">Reading:</span>{' '}
                <span className="text-white font-medium">
                  {scanProgress.currentTrack
                    ? `${scanProgress.currentTrack.artist} - ${scanProgress.currentTrack.title}`
                    : scanProgress.currentFile}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
