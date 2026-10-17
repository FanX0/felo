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
import { sortLabels, getCleanDeviceName } from '../utils'
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
  const renderScanningBanner = () => {
    if (!isScanning || !scanProgress) return null
    return (
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-danger hover:bg-danger/90 text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
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
    )
  }

  // Dedicated Mobile Layout (< md screen or mobile user agent)
  if (isMobile) {
    const cleanMobileRemoteName = selectedRemoteDevice
      ? getCleanDeviceName(selectedRemoteDevice.device_name)
      : ''
    const mobileTitle =
      librarySource === 'local'
        ? 'My Library'
        : selectedRemoteDevice
          ? `${cleanMobileRemoteName} Library`
          : 'Remote Library'
    const fullMobileTitle =
      librarySource === 'local'
        ? 'My Library'
        : selectedRemoteDevice
          ? `${selectedRemoteDevice.device_name} Library`
          : 'Remote Library'

    return (
      <>
        <div className="mb-4 shrink-0 space-y-2.5">
          {/* Row 1: Title + Count (left) & Primary Add Music Button (right) */}
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <h1
                className="text-xl sm:text-2xl font-black text-text tracking-tight truncate"
                title={fullMobileTitle}
              >
                {mobileTitle}
              </h1>
              <span className="text-xs font-semibold text-text-muted/80 tabular-nums shrink-0">
                {songCount} {songCount === 1 ? 'song' : 'songs'}
                {searchQuery && totalSongCount !== songCount && (
                  <span className="opacity-75"> ({totalSongCount})</span>
                )}
              </span>
            </div>

            {/* Add Music Button (Top-Right on Mobile) */}
            <button
              type="button"
              onClick={onAddFolder}
              disabled={isScanning || isSelectingFolder}
              className="flex h-8.5 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-black transition-all active:scale-95 hover:bg-white/90 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 shrink-0 whitespace-nowrap cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-amber" />
                  <span className="tabular-nums">
                    {scanProgress?.percent !== undefined
                      ? `${scanProgress.percent}%`
                      : 'Scanning...'}
                  </span>
                </>
              ) : isSelectingFolder ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-black" />
                  <span>Selecting...</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  <span>Add Music</span>
                </>
              )}
            </button>
          </div>

          {/* Row 2: Device Switcher (hugs buttons when few, scrollable/draggable when wide) */}
          {hasRemoteDevice && (
            <div className="flex items-center gap-1 p-0.5 rounded-full bg-surface-elevated/90 border border-border/60 text-xs shadow-sm overflow-x-auto scrollbar-none w-fit max-w-full">
              <button
                type="button"
                onClick={() => onSetLibrarySource('local')}
                className={cn(
                  'h-7.5 px-3 rounded-full font-semibold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 text-xs',
                  librarySource === 'local'
                    ? 'bg-white/15 text-white shadow-xs'
                    : 'text-text-muted hover:text-white'
                )}
              >
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span>This Device</span>
              </button>

              {remoteLibraryDevices.map((dev) => {
                const isSelected =
                  librarySource === dev.id ||
                  (librarySource === 'pc' && remoteLibraryDevices[0]?.id === dev.id)
                const isDevMobile =
                  dev.device_type === 'mobile' ||
                  /iphone|ipad|android|phone|mobile|ios/i.test(dev.device_name)
                const cleanName = getCleanDeviceName(dev.device_name)
                const tooltip = `${dev.device_name}${dev.local_ip && !dev.device_name.includes(dev.local_ip) ? ` (${dev.local_ip})` : ''}`

                return (
                  <button
                    key={dev.id}
                    type="button"
                    onClick={() => onSetLibrarySource(dev.id)}
                    title={tooltip}
                    className={cn(
                      'h-7.5 px-3 rounded-full font-semibold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 text-xs',
                      isSelected
                        ? 'bg-white/15 text-white shadow-xs'
                        : 'text-text-muted hover:text-white'
                    )}
                  >
                    {isDevMobile ? (
                      <Smartphone className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Laptop2 className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="truncate max-w-[120px]">{cleanName}</span>
                    {isSelected && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          onRefreshRemote(dev)
                        }}
                        title={`Refresh library from ${cleanName}`}
                        className="ml-0.5 p-0.5 rounded-full hover:text-white transition"
                      >
                        <RefreshCw
                          className={cn(
                            'w-3 h-3',
                            (isLoadingPcLibrary ||
                              Boolean(isLoadingDeviceLibrary[normalizeDeviceId(dev.id)])) &&
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

          {/* Row 3 (or Row 2 when no remote device): Sort & View pill (left) + Search & Refresh actions (right) */}
          <div className="flex items-center justify-between gap-2 w-full">
            {/* Sort & View Dropdown Trigger Pill */}
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
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold shadow-sm transition-colors cursor-pointer',
                  isViewMenuOpen
                    ? 'border-white/30 bg-white/20 text-white'
                    : 'border-border/60 bg-surface-elevated text-text-muted hover:text-white'
                )}
              >
                <List className="h-3.5 w-3.5 text-text-muted" />
                <span>{sortLabels[sortKey]}</span>
                <ArrowUp
                  className={cn(
                    'h-3 w-3 text-text-muted transition-transform',
                    sortDirection === 'desc' && 'rotate-180'
                  )}
                />
              </button>

              {isViewMenuOpen && (
                <div
                  className="absolute left-0 top-full z-[1000] mt-1.5 w-48 rounded-xl border border-border/80 bg-surface-elevated py-2.5 text-xs shadow-2xl backdrop-blur-md"
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
                        onClick={() => {
                          onSort(key)
                          onSetIsViewMenuOpen(false)
                        }}
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
                      onClick={() => {
                        onSetViewMode(mode)
                        onSetIsViewMenuOpen(false)
                      }}
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

            {/* Quick Actions (Search, Refresh) */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Search Toggle Button */}
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
                  'flex h-8 w-8 items-center justify-center rounded-full border transition-colors cursor-pointer',
                  isSearchOpen
                    ? 'border-white/40 bg-white/20 text-white'
                    : 'border-border/60 bg-surface-elevated text-text-muted hover:text-white'
                )}
              >
                <Search className="h-3.5 w-3.5" />
              </button>

              {/* Refresh Library Button */}
              <button
                type="button"
                title="Refresh library"
                onClick={onRefreshLibrary}
                disabled={isLoadingSongs}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-surface-elevated text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoadingSongs && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* Row 4: Mobile Full-Width In-Library Search Filter Row */}
          {isSearchOpen && (
            <div className="flex items-center gap-2 bg-surface-elevated border border-border/60 rounded-full px-3.5 py-1.5 animate-in fade-in slide-in-from-top-1">
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
        {renderScanningBanner()}
      </>
    )
  }

  // Desktop Layout
  const cleanDesktopRemoteName = selectedRemoteDevice
    ? getCleanDeviceName(selectedRemoteDevice.device_name)
    : ''
  const desktopTitle =
    librarySource === 'local'
      ? 'My Library'
      : selectedRemoteDevice
        ? `${cleanDesktopRemoteName} Library`
        : 'Remote Library'
  const fullDesktopTitle =
    librarySource === 'local'
      ? 'My Library'
      : selectedRemoteDevice
        ? `${selectedRemoteDevice.device_name} Library`
        : 'Remote Library'

  return (
    <>
      <div className="mb-4 sm:mb-6 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          {/* Left: Heading, Song Count, and Multi-Device Source Switcher */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-wrap">
            <div className="flex items-baseline gap-2.5 sm:gap-3 min-w-0 shrink-0">
              <h1
                className="text-xl sm:text-2xl md:text-3xl font-black text-text tracking-tight truncate max-w-[240px] sm:max-w-xs md:max-w-md"
                title={fullDesktopTitle}
              >
                {desktopTitle}
              </h1>
              <span className="text-xs sm:text-[13px] font-semibold text-text-muted/80 tabular-nums shrink-0">
                {songCount} {songCount === 1 ? 'song' : 'songs'}
                {searchQuery && totalSongCount !== songCount && (
                  <span className="opacity-75 hidden sm:inline"> (of {totalSongCount})</span>
                )}
              </span>
            </div>

            {/* Dynamic Multi-Device Library Source Switcher */}
            {hasRemoteDevice && (
              <div className="flex items-center p-0.5 rounded-full bg-surface-elevated/90 border border-border/60 text-xs shadow-sm shrink-0 max-w-full overflow-x-auto scrollbar-none">
                <button
                  type="button"
                  onClick={() => onSetLibrarySource('local')}
                  className={cn(
                    'h-8 px-3 rounded-full font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 text-xs',
                    librarySource === 'local'
                      ? 'bg-white/15 text-white shadow-xs'
                      : 'text-text-muted hover:text-white hover:bg-white/5'
                  )}
                >
                  {isElectronApp ? (
                    <Laptop2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
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
                  const cleanName = getCleanDeviceName(dev.device_name)
                  const tooltip = `${dev.device_name}${dev.local_ip && !dev.device_name.includes(dev.local_ip) ? ` (${dev.local_ip})` : ''}`

                  return (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => onSetLibrarySource(dev.id)}
                      title={tooltip}
                      className={cn(
                        'h-8 px-3 rounded-full font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 text-xs',
                        isSelected
                          ? 'bg-white/15 text-white shadow-xs'
                          : 'text-text-muted hover:text-white hover:bg-white/5'
                      )}
                    >
                      {isDevMobile ? (
                        <Smartphone className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Laptop2 className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span className="truncate max-w-[130px] sm:max-w-[160px]">{cleanName}</span>
                      {isSelected && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onRefreshRemote(dev)
                          }}
                          title={`Refresh library from ${cleanName}`}
                          className="ml-0.5 p-0.5 rounded-full hover:text-white hover:bg-white/10 transition"
                        >
                          <RefreshCw
                            className={cn(
                              'w-3 h-3',
                              (isLoadingPcLibrary ||
                                Boolean(isLoadingDeviceLibrary[normalizeDeviceId(dev.id)])) &&
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
          </div>

          {/* Right: Actions (Search, Sort & View, Refresh, Add Folder) - Always pinned and accessible */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
            {/* Desktop Expanding In-Library Search Filter */}
            <div
              className={cn(
                'flex h-9 origin-right items-center overflow-hidden rounded-full border border-border/60 bg-surface-elevated transition-all duration-300 shadow-sm',
                isSearchOpen ? 'w-56 sm:w-64 px-2.5' : 'w-9'
              )}
            >
              <button
                type="button"
                title="Search library"
                onClick={() => onSetIsSearchOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center text-text-muted hover:text-white cursor-pointer"
              >
                <Search className="h-3.5 w-3.5" />
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
                  'h-full min-w-0 flex-1 bg-transparent pr-1 text-xs text-white outline-none placeholder:text-text-muted',
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
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

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
                  'flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-colors border cursor-pointer',
                  isViewMenuOpen
                    ? 'border-white/30 bg-white/20 text-white'
                    : 'border-border/60 bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
                )}
              >
                <List className="h-3.5 w-3.5" />
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
                        onClick={() => {
                          onSort(key)
                          onSetIsViewMenuOpen(false)
                        }}
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
                      onClick={() => {
                        onSetViewMode(mode)
                        onSetIsViewMenuOpen(false)
                      }}
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
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-surface-elevated text-text-muted transition-colors hover:bg-hover hover:text-white cursor-pointer shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoadingSongs && 'animate-spin')} />
            </button>

            {/* Add Folder Button */}
            <button
              type="button"
              onClick={onAddFolder}
              disabled={isScanning || isSelectingFolder}
              className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-black transition-all active:scale-95 hover:bg-white/90 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 shrink-0 whitespace-nowrap cursor-pointer"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-amber" />
                  <span className="tabular-nums">
                    {scanProgress?.percent !== undefined
                      ? `${scanProgress.percent}%`
                      : 'Scanning...'}
                  </span>
                </>
              ) : isSelectingFolder ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-black" />
                  <span>Selecting...</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  <span>Add Folder</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {renderScanningBanner()}
    </>
  )
}
