import { useEffect, useMemo, useState, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Loader2 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate } from 'react-router-dom'
import { useLibraryScanStore } from '../../hooks/useLibraryScanStore'
import SongCreditsModal from '../../components/Common/SongCreditsModal'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PersonalizationService } from '../../services/PersonalizationService'
import { remoteClient } from '../Remote/remoteClient'
import { remoteLibraryService } from '../../services/RemoteLibraryService'
import { useConnectedDeviceStore, normalizeDeviceId } from '../../hooks/useConnectedDeviceStore'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { audioDspEngine } from '../../lib/audioDspEngine'
import { usePlayerStore } from '../../hooks/usePlayerStore'

import type {
  Song,
  SongArtist,
  LibraryProps,
  LibrarySortKey,
  SortDirection,
  LibraryViewMode,
  ActiveMenuState,
  RemoteLibraryDevice
} from './types'
import { LibraryToolbar } from './components/LibraryToolbar'
import { LibraryTableHeader } from './components/LibraryTableHeader'
import { LibrarySongRow } from './components/LibrarySongRow'
import { LibraryContextMenu } from './components/LibraryContextMenu'
import { LibraryBatchToolbar } from './components/LibraryBatchToolbar'
import { LibraryEmptyState } from './components/LibraryEmptyState'
import { getCleanDeviceName } from './utils'

export type { Song, SongArtist }

export default function Library({ onOpenDownloadPanel }: LibraryProps) {
  const [songs, setSongs] = useState<Song[]>([])
  const [isLoadingSongs, setIsLoadingSongs] = useState(true)
  const [, setHasLoadedSongs] = useState(false)
  const { isScanning, progress: scanProgress, cancelScan } = useLibraryScanStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false)
  const [sortKey, setSortKey] = useState<LibrarySortKey>('dateAdded')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [viewMode, setViewMode] = useState<LibraryViewMode>('list')
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(new Set())
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null)
  const [creditsSong, setCreditsSong] = useState<Song | null>(null)
  const user = useOnlineStore((s) => s.user)
  const isElectronApp = typeof window !== 'undefined' && Boolean((window as any).electron)
  const isMobile = useIsMobile()
  const [librarySource, setLibrarySource] = useState<string>('local')
  const librarySourceRef = useRef(librarySource)
  librarySourceRef.current = librarySource
  const [isSelectingFolder, setIsSelectingFolder] = useState(false)
  const [isRemoteConnected, setIsRemoteConnected] = useState(() => remoteClient.getIsConnected())
  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const pcLibrarySongs = useConnectedDeviceStore((s) => s.pcLibrarySongs)
  const deviceLibraries = useConnectedDeviceStore((s) => s.deviceLibraries)
  const isLoadingPcLibrary = useConnectedDeviceStore((s) => s.isLoadingPcLibrary)
  const isLoadingDeviceLibrary = useConnectedDeviceStore((s) => s.isLoadingDeviceLibrary)
  const discoveredDevices = useConnectedDeviceStore((s) => s.discoveredDevices)
  const requestPcLibrary = useConnectedDeviceStore((s) => s.requestPcLibrary)
  const loadCachedPcSongs = useConnectedDeviceStore((s) => s.loadCachedPcSongs)
  const { requestPlayQueue } = usePlaybackArbitration()

  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null

  // Dynamic multi-device discovery
  const remoteLibraryDevices: RemoteLibraryDevice[] = useMemo(() => {
    const list: RemoteLibraryDevice[] = []
    const seen = new Set<string>()
    const seenIps = new Set<string>()

    for (const d of discoveredDevices) {
      if (d.id !== myDeviceId && d.is_active && !seen.has(d.id)) {
        seen.add(d.id)
        if (d.local_ip) seenIps.add(d.local_ip)
        list.push({
          id: d.id,
          device_name:
            d.device_name || (d.device_type === 'mobile' ? 'Mobile Device' : 'Felo Desktop'),
          device_type: d.device_type,
          local_ip: d.local_ip,
          port: (d as any).port,
          token: (d as any).token
        })
      }
    }

    if (
      activeRemote?.activeDeviceId &&
      activeRemote.activeDeviceId !== myDeviceId &&
      !seen.has(activeRemote.activeDeviceId)
    ) {
      seen.add(activeRemote.activeDeviceId)
      list.push({
        id: activeRemote.activeDeviceId,
        device_name:
          activeRemote.activeDeviceName ||
          (activeRemote.activeDeviceType === 'mobile' ? 'Mobile Device' : 'Felo Desktop'),
        device_type: activeRemote.activeDeviceType || 'desktop'
      })
    }

    const lanBase = remoteClient.getBaseUrl()
    if (lanBase && !lanBase.includes('localhost')) {
      try {
        const parsed = new URL(lanBase)
        const host = parsed.hostname
        if (
          host &&
          !seenIps.has(host) &&
          !seen.has('lan-desktop') &&
          !list.some((d) => d.local_ip === host || d.device_name.includes(host))
        ) {
          seen.add('lan-desktop')
          seenIps.add(host)
          list.push({
            id: 'lan-desktop',
            device_name: 'Felo Desktop',
            device_type: 'desktop',
            local_ip: host
          })
        }
      } catch {
        // ignore invalid URL
      }
    }

    if (list.length === 0 && !isElectronApp) {
      list.push({
        id: 'default-pc',
        device_name: 'Felo Desktop',
        device_type: 'desktop'
      })
    }

    return list
  }, [discoveredDevices, myDeviceId, activeRemote, isElectronApp])

  const selectedRemoteDevice = useMemo(() => {
    if (librarySource === 'local') return null
    if (librarySource === 'pc') return remoteLibraryDevices[0] || null
    return (
      remoteLibraryDevices.find((d) => d.id === librarySource) ||
      remoteLibraryDevices[0] ||
      null
    )
  }, [librarySource, remoteLibraryDevices])

  const hasRemoteDevice = remoteLibraryDevices.length > 0

  const isDeviceSyncing =
    isLoadingSongs ||
    isLoadingPcLibrary ||
    Boolean(
      selectedRemoteDevice?.id &&
        isLoadingDeviceLibrary[normalizeDeviceId(selectedRemoteDevice.id)]
    )

  useEffect(() => {
    const unsub = remoteClient.subscribeConnection(setIsRemoteConnected)
    return () => unsub()
  }, [])

  const { togglePlay, currentSongIndex, queue, isPlaying, enqueueSong } = usePlayerStore(
    useShallow((s) => ({
      togglePlay: s.togglePlay,
      currentSongIndex: s.currentSongIndex,
      queue: s.queue,
      isPlaying: s.isPlaying,
      enqueueSong: s.enqueueSong
    }))
  )
  const navigate = useNavigate()

  const parentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const viewMenuRef = useRef<HTMLDivElement>(null)
  const loadGenerationRef = useRef(0)

  const handleSort = (key: LibrarySortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(key === 'dateAdded' || key === 'duration' ? 'desc' : 'asc')
    }
  }

  const filteredSongs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    let searchedSongs: Song[] = songs

    if (query) {
      const tokens = query.split(/\s+/).filter(Boolean)
      searchedSongs = songs.filter((song) => {
        const combined = [song.title, song.artist, song.album, song.genre]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return tokens.every((token) => combined.includes(token))
      })
    }

    if (sortKey === 'default') {
      return sortDirection === 'asc' ? searchedSongs : [...searchedSongs].reverse()
    }

    return [...searchedSongs].sort((left, right) => {
      let comparison = 0
      if (sortKey === 'dateAdded') {
        comparison = (left.dateAdded || 0) - (right.dateAdded || 0)
      } else if (sortKey === 'duration') {
        comparison = (left.duration || 0) - (right.duration || 0)
      } else {
        const leftValue = String(left[sortKey] || '').toLowerCase()
        const rightValue = String(right[sortKey] || '').toLowerCase()
        comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [songs, searchQuery, sortKey, sortDirection])

  const loadSongs = async (source = librarySource) => {
    const generation = ++loadGenerationRef.current
    setIsLoadingSongs(true)
    try {
      if (source === 'local') {
        if (window.api?.getSongs) {
          const data = await window.api.getSongs()
          setSongs(data || [])
        } else {
          const pcSongs = useConnectedDeviceStore.getState().pcLibrarySongs
          if (pcSongs && pcSongs.length > 0) {
            setSongs(pcSongs)
          } else {
            const cached = loadCachedPcSongs(user?.id)
            setSongs(cached || [])
          }
        }
        return
      }

      const targetDev =
        remoteLibraryDevices.find((d) => d.id === source) || remoteLibraryDevices[0]
      const canonicalDevId = normalizeDeviceId(targetDev?.id || source)

      const configuredBase = remoteClient.getBaseUrl()
      const hasLanConfigured = Boolean(
        configuredBase && !configuredBase.includes('localhost')
      )
      const isLanTarget = Boolean(
        targetDev?.local_ip ||
          targetDev?.id === 'lan-desktop' ||
          targetDev?.id === 'default-pc' ||
          (targetDev?.device_type === 'desktop' && (remoteClient.getIsConnected() || hasLanConfigured))
      )

      if (isLanTarget) {
        try {
          const directIp =
            targetDev?.local_ip || (configuredBase ? new URL(configuredBase).hostname : null)
          if (directIp) {
            const port = targetDev?.port || 4788
            const token = targetDev?.token || remoteClient.getToken() || ''
            if (!remoteClient.getBaseUrl() || !remoteClient.getBaseUrl().includes(directIp)) {
              remoteClient.configure(`http://${directIp}:${port}`, token)
            }
            const res = await remoteLibraryService.getSongs({ limit: 1000 })
            if (res.songs && res.songs.length > 0) {
              const mapped: Song[] = res.songs.map((s) => ({
                id: s.id,
                title: s.title,
                artist: s.artist,
                album: s.album,
                duration: s.duration,
                filePath: s.audioUrl || remoteClient.getAudioStreamUrl(s.id),
                audioUrl: s.audioUrl || remoteClient.getAudioStreamUrl(s.id),
                artworkPath: s.artworkUrl || remoteClient.getFullArtworkUrl(s.artworkUrl || s.id),
                artworkUrl: s.artworkUrl || remoteClient.getFullArtworkUrl(s.artworkUrl || s.id),
                bitrate: s.bitrate,
                sampleRate: s.sampleRate,
                trackNumber: s.trackNumber,
                genre: s.genre,
                dateAdded: s.dateAdded,
                isOnline: true
              }))
              useConnectedDeviceStore.getState().setDeviceLibrarySongs(canonicalDevId, mapped)
              setSongs(mapped)
              return
            }
          }
        } catch (err) {
          console.warn('[Library] Failed to query LAN remote library, falling back to Realtime/cache:', err)
        }
      }

      const store = useConnectedDeviceStore.getState()
      const existing = store.getDeviceSongs(canonicalDevId)
      if (existing && existing.length > 0) {
        setSongs(existing)
      } else {
        const cached = loadCachedPcSongs(user?.id, canonicalDevId)
        if (cached.length > 0) {
          setSongs(cached)
        } else {
          setSongs([])
        }
      }

      if (user?.id) {
        void requestPcLibrary(user.id, canonicalDevId)
      }
    } catch (err) {
      console.error('Failed to load songs:', err)
      if (source !== 'local') {
        const canonicalDevId = normalizeDeviceId(selectedRemoteDevice?.id || source)
        const cached = loadCachedPcSongs(user?.id, canonicalDevId)
        setSongs(cached)
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoadingSongs(false)
        setHasLoadedSongs(true)
      }
    }
  }

  useEffect(() => {
    if (librarySource !== 'local') {
      const devId = normalizeDeviceId(selectedRemoteDevice?.id || librarySource)
      const freshSongs =
        deviceLibraries[devId] ||
        (selectedRemoteDevice?.device_type === 'desktop' ? pcLibrarySongs : undefined) ||
        deviceLibraries['default-pc']
      if (freshSongs && freshSongs.length > 0) {
        setSongs(freshSongs)
        setIsLoadingSongs(false)
        setHasLoadedSongs(true)
      }
    }
  }, [librarySource, deviceLibraries, pcLibrarySongs, selectedRemoteDevice?.id, selectedRemoteDevice?.device_type])

  useEffect(() => {
    void loadSongs(librarySource)
  }, [librarySource])

  useEffect(() => {
    if (isRemoteConnected && librarySource !== 'local') {
      void loadSongs(librarySource)
    }
  }, [isRemoteConnected])

  const handleStartSongRadio = async (song: Song) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          artworkUrl: song.artworkPath,
          filePath: song.filePath
        },
        songs
      )
      if (station.length > 0) {
        requestPlayQueue(station, 0, {
          type: 'radio' as const,
          title: `${song.title} Radio`,
          route: `/artist/${encodeURIComponent(song.artist)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start song radio:', err)
    }
  }

  const handleStartArtistRadio = async (artistName: string) => {
    try {
      const station = await PersonalizationService.generateRadioStation(
        {
          artist: artistName
        },
        songs
      )
      if (station.length > 0) {
        requestPlayQueue(station, 0, {
          type: 'radio' as const,
          title: `${artistName} Radio`,
          route: `/artist/${encodeURIComponent(artistName)}`
        })
      }
    } catch (err) {
      console.warn('Failed to start artist radio:', err)
    }
  }

  useEffect(() => {
    void loadSongs(librarySourceRef.current)
    const handleLibraryUpdate = () => {
      void loadSongs(librarySourceRef.current)
    }
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    return () => window.removeEventListener('felo:library-updated', handleLibraryUpdate)
  }, [])

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus()
  }, [isSearchOpen])

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      setActiveMenu(null)
      if (!viewMenuRef.current?.contains(event.target as Node)) {
        setIsViewMenuOpen(false)
      }
    }
    const closeAllMenus = () => {
      setActiveMenu(null)
      setIsViewMenuOpen(false)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeAllMenus)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeAllMenus)
    }
  }, [])

  const handleAddFolder = async () => {
    if (isScanning || isSelectingFolder) return
    setIsSelectingFolder(true)
    try {
      if (!window.api?.selectFolder) {
        console.warn('selectFolder is not available')
        return
      }
      let folderPath: string | null = null
      try {
        folderPath = await window.api.selectFolder()
      } catch (selectErr) {
        console.warn('Folder selection error, trying audio files fallback:', selectErr)
      }

      if (!folderPath && !isElectronApp) {
        if (window.api?.selectFiles) {
          folderPath = await window.api.selectFiles()
        } else if (window.api?.selectFolder) {
          folderPath = await window.api.selectFolder({ forceFiles: true })
        }
      }

      if (folderPath) {
        setLibrarySource('local')
        await window.api.scanLibrary(folderPath)
        await loadSongs('local')
      }
    } catch (err) {
      console.error('Failed to scan library:', err)
    } finally {
      setIsSelectingFolder(false)
    }
  }

  const handleAddFiles = async () => {
    try {
      if (window.api?.selectFiles) {
        const folderToken = await window.api.selectFiles()
        if (folderToken) {
          await window.api.scanLibrary(folderToken)
          setLibrarySource('local')
          await loadSongs('local')
        }
      } else if (window.api?.selectFolder) {
        const folderToken = await window.api.selectFolder({ forceFiles: true })
        if (folderToken) {
          await window.api.scanLibrary(folderToken)
          setLibrarySource('local')
          await loadSongs('local')
        }
      }
    } catch (err) {
      console.error('Failed to select files:', err)
    }
  }

  const handleRowClick = (event: React.MouseEvent, index: number, song: Song) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedSongIds((prev) => {
        const next = new Set(prev)
        if (next.has(song.id)) {
          next.delete(song.id)
        } else {
          next.add(song.id)
        }
        return next
      })
      setLastSelectedIndex(index)
      return
    }

    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index)
      const end = Math.max(lastSelectedIndex, index)
      const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
      setSelectedSongIds(new Set(range))
      return
    }

    if (selectedSongIds.size > 0) {
      setSelectedSongIds((prev) => {
        const next = new Set(prev)
        if (next.has(song.id)) {
          next.delete(song.id)
        } else {
          next.add(song.id)
        }
        return next
      })
      setLastSelectedIndex(index)
      return
    }

    handlePlaySong(index)
  }

  const handlePlaySong = (index: number) => {
    void audioDspEngine.resume()
    const targetSong = filteredSongs[index]
    if (!targetSong) return

    if (queue[currentSongIndex]?.id === targetSong.id) {
      togglePlay()
      return
    }

    const contextTitle =
      librarySource === 'local'
        ? 'Your Library'
        : selectedRemoteDevice
          ? `${getCleanDeviceName(selectedRemoteDevice.device_name)} Library`
          : 'Remote Library'
    const playbackContext = usePlayerStore.getState().playbackContext
    const isSameLibraryContext =
      playbackContext?.type === 'library' &&
      playbackContext.title === contextTitle &&
      !searchQuery.trim()

    if (isSameLibraryContext) {
      const existingIdx = queue.findIndex((s) => s.id === targetSong.id)
      if (existingIdx >= 0) {
        requestPlayQueue(queue, existingIdx, {
          type: 'library',
          title: contextTitle,
          route: '/library'
        })
        return
      }
    }

    const resolvedSongs = filteredSongs.map((s) => ({
      ...s,
      filePath: resolveSongAudioUrl(s) || s.filePath,
      isOnline: librarySource === 'local' ? false : s.isOnline,
      isLocalToDevice: librarySource === 'local' ? true : (s as any).isLocalToDevice
    }))

    requestPlayQueue(resolvedSongs, index, {
      type: 'library',
      title: contextTitle,
      route: '/library'
    })
  }

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLButtonElement>,
    song: Song,
    index: number
  ) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 250
    const menuHeight = 242
    setActiveMenu({
      song,
      index,
      x: Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
      y: Math.min(rect.bottom + 8, window.innerHeight - menuHeight - 12)
    })
  }

  const handleShareSong = (song: Song) => {
    sessionStorage.setItem(
      'felo:pending-chat-song',
      JSON.stringify({
        localId: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        artworkUrl: song.artworkPath || song.artworkUrl
      })
    )
    navigate('/chat')
    setActiveMenu(null)
  }

  const handleShowInExplorer = async (song: Song) => {
    const filePath = song.filePath
    if (!filePath) return
    try {
      await window.api?.revealInExplorer(filePath)
    } catch (err) {
      console.error('Failed to reveal song:', err)
    }
  }

  const handleRemoveSong = async (song: Song) => {
    setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id))
    setSelectedSongIds((prev) => {
      const next = new Set(prev)
      next.delete(song.id)
      return next
    })
    try {
      await window.api?.removeSong(song.id)
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
      window.dispatchEvent(new CustomEvent('fanxmusic:library-updated'))
    } catch (err) {
      console.error('Failed to remove song:', err)
      void loadSongs()
    }
  }

  const handleAlbumClick = (e: React.MouseEvent, artistName?: string, albumName?: string) => {
    e.stopPropagation()
    if (!albumName) return
    navigate(
      `/album/${encodeURIComponent(artistName || 'Unknown Artist')}/${encodeURIComponent(albumName)}`
    )
  }

  const rowHeight = viewMode === 'compact' ? 46 : 56

  const virtualizer = useVirtualizer({
    count: filteredSongs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 6
  })

  useEffect(() => {
    virtualizer.measure()
  }, [viewMode, virtualizer])

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true'

      if (isInput) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (filteredSongs.length > 0) {
          setSelectedSongIds(new Set(filteredSongs.map((s) => s.id)))
        }
        return
      }

      if (e.key === 'Escape' && selectedSongIds.size > 0) {
        e.preventDefault()
        setSelectedSongIds(new Set())
        setLastSelectedIndex(null)
        return
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        togglePlay()
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (lastSelectedIndex !== null && filteredSongs[lastSelectedIndex]) {
          handlePlaySong(lastSelectedIndex)
        } else if (selectedSongIds.size > 0) {
          const firstIndex = filteredSongs.findIndex((s) => selectedSongIds.has(s.id))
          if (firstIndex >= 0) handlePlaySong(firstIndex)
        }
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (filteredSongs.length === 0) return
        const nextIndex =
          lastSelectedIndex === null
            ? 0
            : Math.min(filteredSongs.length - 1, lastSelectedIndex + 1)

        if (e.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, nextIndex)
          const end = Math.max(lastSelectedIndex, nextIndex)
          const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
          setSelectedSongIds(new Set(range))
        } else {
          setSelectedSongIds(new Set([filteredSongs[nextIndex].id]))
          setLastSelectedIndex(nextIndex)
        }
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (filteredSongs.length === 0) return
        const prevIndex =
          lastSelectedIndex === null
            ? filteredSongs.length - 1
            : Math.max(0, lastSelectedIndex - 1)

        if (e.shiftKey && lastSelectedIndex !== null) {
          const start = Math.min(lastSelectedIndex, prevIndex)
          const end = Math.max(lastSelectedIndex, prevIndex)
          const range = filteredSongs.slice(start, end + 1).map((s) => s.id)
          setSelectedSongIds(new Set(range))
        } else {
          setSelectedSongIds(new Set([filteredSongs[prevIndex].id]))
          setLastSelectedIndex(prevIndex)
        }
        virtualizer.scrollToIndex(prevIndex, { align: 'auto' })
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredSongs, lastSelectedIndex, selectedSongIds, virtualizer, togglePlay])

  return (
    <div className="h-full flex-1 flex flex-col pt-4 sm:pt-8 px-3 sm:px-6 pb-2 select-none relative overflow-x-hidden min-w-0">
      <LibraryToolbar
        librarySource={librarySource}
        selectedRemoteDevice={selectedRemoteDevice}
        songCount={filteredSongs.length}
        totalSongCount={songs.length}
        hasRemoteDevice={hasRemoteDevice}
        remoteLibraryDevices={remoteLibraryDevices}
        isElectronApp={isElectronApp}
        isMobile={isMobile}
        searchQuery={searchQuery}
        isSearchOpen={isSearchOpen}
        isViewMenuOpen={isViewMenuOpen}
        sortKey={sortKey}
        sortDirection={sortDirection}
        viewMode={viewMode}
        isLoadingSongs={isLoadingSongs}
        isScanning={isScanning}
        isSelectingFolder={isSelectingFolder}
        scanProgress={scanProgress}
        isLoadingPcLibrary={isLoadingPcLibrary}
        isLoadingDeviceLibrary={isLoadingDeviceLibrary}
        searchInputRef={searchInputRef}
        viewMenuRef={viewMenuRef}
        onSetLibrarySource={setLibrarySource}
        onRefreshRemote={(dev) => {
          void loadSongs(dev.id)
          if (user?.id) void requestPcLibrary(user.id, dev.id)
        }}
        onSetSearchQuery={setSearchQuery}
        onSetIsSearchOpen={setIsSearchOpen}
        onSetIsViewMenuOpen={setIsViewMenuOpen}
        onSort={handleSort}
        onSetViewMode={setViewMode}
        onRefreshLibrary={() => void loadSongs()}
        onAddFolder={handleAddFolder}
        onCancelScan={cancelScan}
      />

      {/* Main View Area */}
      {isLoadingSongs ? (
        <div className="flex-1 flex flex-col items-center justify-center text-text-muted gap-3 min-h-[300px]">
          <Loader2 className="h-7 w-7 animate-spin text-primary-amber" />
          <div className="text-center">
            <p className="text-base font-semibold text-text">Loading your music library...</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Restoring saved tracks and artwork metadata
            </p>
          </div>
        </div>
      ) : songs.length === 0 ? (
        <LibraryEmptyState
          librarySource={librarySource}
          selectedRemoteDevice={selectedRemoteDevice}
          isDeviceSyncing={isDeviceSyncing}
          isElectronApp={isElectronApp}
          isMobile={isMobile}
          isScanning={isScanning}
          isSelectingFolder={isSelectingFolder}
          hasRemoteDevice={hasRemoteDevice}
          remoteLibraryDevices={remoteLibraryDevices}
          onSyncDevice={() => {
            void loadSongs(librarySource)
            if (user?.id) void requestPcLibrary(user.id, selectedRemoteDevice?.id)
          }}
          onSwitchToLocal={() => setLibrarySource('local')}
          onAddFolder={handleAddFolder}
          onAddFiles={handleAddFiles}
          onBrowseRemote={(devId) => setLibrarySource(devId)}
        />
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <LibraryTableHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={handleSort}
          />

          {/* Virtual Table Body */}
          <div ref={parentRef} key={viewMode} className="flex-1 overflow-y-auto mt-1 pb-36 md:pb-16">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const index = virtualRow.index
                const song = filteredSongs[index]
                const isActive = queue[currentSongIndex]?.id === song.id
                const isSelected = selectedSongIds.has(song.id)

                return (
                  <LibrarySongRow
                    key={song.id}
                    song={song}
                    index={index}
                    isActive={isActive}
                    isPlaying={isPlaying}
                    isSelected={isSelected}
                    hasMultiSelection={selectedSongIds.size > 0}
                    viewMode={viewMode}
                    rowHeight={rowHeight}
                    searchQuery={searchQuery}
                    top={virtualRow.start}
                    size={virtualRow.size}
                    isMenuActive={activeMenu?.song.id === song.id}
                    onClick={(e) => handleRowClick(e, index, song)}
                    onMenuOpen={(e) => handleMenuOpen(e, song, index)}
                    onAlbumClick={(e) => handleAlbumClick(e, song.artist, song.album)}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Floating Multi-Select Batch Actions Toolbar */}
      <LibraryBatchToolbar
        selectedCount={selectedSongIds.size}
        totalCount={filteredSongs.length}
        onPlaySelected={() => {
          const selectedSongs = filteredSongs.filter((s) => selectedSongIds.has(s.id))
          if (selectedSongs.length > 0) {
            requestPlayQueue(selectedSongs, 0, {
              type: 'library',
              title: `Selected (${selectedSongs.length} tracks)`,
              route: '/library'
            })
          }
        }}
        onQueueSelected={() => {
          const selectedSongs = filteredSongs.filter((s) => selectedSongIds.has(s.id))
          selectedSongs.forEach((song) => enqueueSong(song))
          setSelectedSongIds(new Set())
        }}
        onToggleSelectAll={() => {
          if (selectedSongIds.size === filteredSongs.length) {
            setSelectedSongIds(new Set())
          } else {
            setSelectedSongIds(new Set(filteredSongs.map((s) => s.id)))
          }
        }}
        onClearSelection={() => setSelectedSongIds(new Set())}
      />

      {/* Context Menu */}
      {activeMenu && (
        <LibraryContextMenu
          activeMenu={activeMenu}
          isRemoteConnected={isRemoteConnected}
          onClose={() => setActiveMenu(null)}
          onPlaySong={handlePlaySong}
          onEnqueueSong={enqueueSong}
          onStartSongRadio={(song) => void handleStartSongRadio(song)}
          onStartArtistRadio={(artist) => void handleStartArtistRadio(artist)}
          onGoToAlbum={(artist, album) => {
            navigate(`/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`)
          }}
          onGoToArtist={(artist) => {
            navigate(`/artist/${encodeURIComponent(artist)}`)
          }}
          onShowCredits={(song) => setCreditsSong(song)}
          onShareSong={handleShareSong}
          onShowInExplorer={handleShowInExplorer}
          onRemoveSong={handleRemoveSong}
          onOpenDownloadPanel={onOpenDownloadPanel}
        />
      )}

      <SongCreditsModal
        song={creditsSong}
        isOpen={Boolean(creditsSong)}
        onClose={() => setCreditsSong(null)}
      />
    </div>
  )
}
