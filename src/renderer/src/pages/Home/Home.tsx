import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen } from 'lucide-react'
import type { Song } from '../Library/Library'
import type { HomeProps, HomeTabType, HomeSongItem, HomeAlbumItem } from './types'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { findMatchingLibrarySong } from '../../lib/songMatching'
import type { PersonalizedMix } from '../../services/PersonalizationService'
import { AppCapabilities } from '../../lib/appConfig'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'
import { useConnectedDeviceStore } from '../../hooks/useConnectedDeviceStore'

// Custom Hooks
import { useHomeData } from './hooks/useHomeData'
import { useInfiniteRadio } from './hooks/useInfiniteRadio'

// Modular Components
import { HomeTabs } from './components/HomeTabs'
import { HomeGreeting } from './components/HomeGreeting'
import { QuickAccessGrid } from './components/QuickAccessGrid'
import { HeroSpotlight } from './components/HeroSpotlight'
import { PersonalizedMixesSection } from './components/PersonalizedMixesSection'
import { HomeSongSection } from './components/HomeSongSection'
import { AlbumsGridSection } from './components/AlbumsGridSection'
import { AppleChartsTab } from './components/AppleChartsTab'
import { SpotifyPlaylistsTab } from './components/SpotifyPlaylistsTab'
import { AotyTab } from './components/AotyTab'
import { LastFmTab } from './components/LastFmTab'

// Re-export types for backward compatibility across the codebase
export type { HomeSongItem, HomeAlbumItem }

export default function Home({ onOpenDownloadPanel }: HomeProps) {
  const navigate = useNavigate()
  const setQueue = usePlayerStore((s) => s.setQueue)
  const { requestPlaySong, requestPlayQueue } = usePlaybackArbitration()

  const [activeTab, setActiveTab] = useState<HomeTabType>('overview')
  const [selectedMix, setSelectedMix] = useState<PersonalizedMix | null>(null)

  const {
    recommendedSongs,
    recommendedAlbums,
    isRefreshing,
    fetchFeed,
    librarySongs,
    setLibrarySongs,
    libraryIndex,
    personalizedMixes,
    isLoadingMixes,
    loadPersonalizedMixes,
    tasteMetrics,
    likedSongIds,
    toggleLike
  } = useHomeData()

  const { isInfiniteRadio, startInfiniteRadio } = useInfiniteRadio(
    librarySongs,
    setLibrarySongs
  )
  // Add local folder from mobile/web/desktop
  const handleAddFolder = useCallback(async () => {
    try {
      if (!window.api?.selectFolder) return
      let folderPath: string | null = null
      try {
        folderPath = await window.api.selectFolder()
      } catch (selectErr) {
        console.warn('Folder selection error in Home:', selectErr)
      }
      const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
      if (!folderPath && !isElectron) {
        if (window.api?.selectFiles) {
          folderPath = await window.api.selectFiles()
        } else if (window.api?.selectFolder) {
          folderPath = await window.api.selectFolder({ forceFiles: true })
        }
      }
      if (folderPath) {
        await window.api.scanLibrary(folderPath)
        const latest = (await window.api?.getSongs?.()) as Song[] | undefined
        if (latest) setLibrarySongs(latest)
      }
    } catch (err) {
      console.error('Failed to scan library folder from Home:', err)
    }
  }, [setLibrarySongs])

  // Select individual audio files from mobile/web storage
  const handleAddFiles = useCallback(async () => {
    try {
      if (window.api?.selectFiles) {
        const folderToken = await window.api.selectFiles()
        if (folderToken) {
          await window.api.scanLibrary(folderToken)
          const latest = (await window.api?.getSongs?.()) as Song[] | undefined
          if (latest) setLibrarySongs(latest)
        }
      } else if (window.api?.selectFolder) {
        const folderToken = await window.api.selectFolder({ forceFiles: true })
        if (folderToken) {
          await window.api.scanLibrary(folderToken)
          const latest = (await window.api?.getSongs?.()) as Song[] | undefined
          if (latest) setLibrarySongs(latest)
        }
      }
    } catch (err) {
      console.error('Failed to select files from Home:', err)
    }
  }, [setLibrarySongs])

  // Play a song from home/charts: plays local file if available, or queues online download
  const handlePlaySong = useCallback(
    async (song: HomeSongItem) => {
      let localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)

      if (!localSong?.filePath) {
        try {
          const latestSongs = window.api?.getSongs
            ? ((await window.api.getSongs()) as Song[] | undefined)
            : useConnectedDeviceStore.getState().pcLibrarySongs
          if (latestSongs && latestSongs.length > 0) {
            setLibrarySongs(latestSongs)
            localSong = findMatchingLibrarySong(song.title, song.artist, latestSongs)
          }
        } catch (error) {
          console.warn('Unable to refresh library before playback:', error)
        }
      }

      if (localSong?.filePath) {
        requestPlaySong(localSong)
        return
      }

      onOpenDownloadPanel?.({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        duration: song.duration,
        artworkPath: song.artworkUrl,
        isOnline: true,
        autoDownload: false,
        autoPlay: false
      })
    },
    [librarySongs, setLibrarySongs, setQueue, onOpenDownloadPanel]
  )

  // Direct download track
  const handleDownloadSong = useCallback(
    (song: HomeSongItem) => {
      onOpenDownloadPanel?.({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        duration: song.duration,
        artworkPath: song.artworkUrl,
        isOnline: true,
        autoDownload: false,
        autoPlay: false
      })
    },
    [onOpenDownloadPanel]
  )

  // Choose source or replace existing
  const handleChooseSourceOrReplace = useCallback(
    (song: HomeSongItem) => {
      const localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)
      onOpenDownloadPanel?.({
        id: localSong?.id || song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || localSong?.album || '',
        duration: localSong?.duration || song.duration || 0,
        filePath: localSong?.filePath,
        artworkPath: localSong?.artworkPath || song.artworkUrl,
        artworkUrl: song.artworkUrl,
        size: localSong?.size,
        sampleRate: localSong?.sampleRate,
        isOnline: !localSong,
        autoDownload: false,
        autoPlay: false
      })
    },
    [librarySongs, onOpenDownloadPanel]
  )

  // Play personalized mix
  const handlePlayMix = useCallback(
    (mix: PersonalizedMix, startIndex = 0) => {
      const queueSongs: Song[] = mix.tracks.map((track) => {
        const match = findMatchingLibrarySong(track.title, track.artist, librarySongs)
        if (match?.filePath) return match
        return {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album || '',
          duration: track.duration,
          artworkPath: track.artworkUrl,
          filePath: `virtual:${track.id}`,
          size: 0,
          bitrate: 0,
          sampleRate: 0,
          dateAdded: Date.now()
        } as Song
      })

      if (queueSongs.length > 0) {
        requestPlayQueue(queueSongs, startIndex, {
          type: 'playlist',
          id: mix.id,
          title: mix.title,
          subtitle: mix.subtitle
        })
      }
    },
    [librarySongs, setQueue]
  )

  // Navigate to album
  const handleSelectAlbum = useCallback(
    (album: HomeAlbumItem) => {
      navigate(
        `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
      )
    },
    [navigate]
  )

  return (
    <div className="relative min-h-full flex-1 w-full bg-canvas text-white select-none pb-28">
      {/* Top Segmented Navigation Tabs */}
      <HomeTabs activeTab={activeTab} onTabChange={(tab) => {
        setActiveTab(tab)
        if (tab !== 'overview') setSelectedMix(null)
      }} />

      <div className="space-y-10 px-4 pt-4 sm:px-8 sm:pt-6 max-w-[1800px] mx-auto">
        {/* ─── For You / Overview Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {selectedMix ? (
              <PersonalizedMixesSection
                mixes={personalizedMixes}
                selectedMix={selectedMix}
                onSelectMix={setSelectedMix}
                onPlayMix={handlePlayMix}
                onPlaySong={handlePlaySong}
                onDownloadSong={handleDownloadSong}
                libraryIndex={libraryIndex}
                isLoadingMixes={isLoadingMixes}
                onRefreshMixes={() => void loadPersonalizedMixes(true)}
              />
            ) : (
              <>
                {/* Time-of-day greeting & taste badges */}
                <HomeGreeting
                  tasteMetrics={tasteMetrics}
                  isRefreshing={isRefreshing}
                  onRefresh={() => void fetchFeed()}
                />

                {/* Prompt to Add Local Songs if library is empty */}
                {librarySongs.length === 0 && (
                  <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/40 via-surface-elevated to-surface p-5 sm:p-6 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-5 w-5 text-emerald-400" />
                          <h3 className="font-bold text-white text-base tracking-tight">
                            Add Local Music to Your Library
                          </h3>
                        </div>
                        <p className="text-xs sm:text-sm text-zinc-400 max-w-xl">
                          No songs loaded on this device yet. Select your music folder or audio files from local storage to play offline anytime with lossless audio.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleAddFolder}
                          className="flex h-10 items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 px-5 text-xs font-bold text-black transition-all hover:scale-[1.02] shadow-md cursor-pointer"
                        >
                          <Plus className="h-4 w-4 stroke-[3]" />
                          <span>Add Music Folder</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleAddFiles}
                          className="flex h-10 items-center gap-2 rounded-full border border-white/20 bg-surface-elevated px-4 text-xs font-semibold text-white hover:bg-hover transition-all cursor-pointer"
                        >
                          <FolderOpen className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Select Audio Files</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/library')}
                          className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 text-xs font-medium text-zinc-300 transition-all cursor-pointer"
                        >
                          <span>Open Library</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 6-card "Jump Back In" quick-access grid */}
                <QuickAccessGrid
                  mixes={personalizedMixes}
                  albums={recommendedAlbums}
                  onSelectMix={setSelectedMix}
                  onPlayMix={handlePlayMix}
                  onSelectAlbum={handleSelectAlbum}
                  onStartRadio={() => startInfiniteRadio(recommendedSongs)}
                />

                {/* Featured spotlight hero banner */}
                {personalizedMixes[0]?.tracks?.length > 0 && (
                  <HeroSpotlight
                    topMix={personalizedMixes[0]}
                    onPlayMix={handlePlayMix}
                    onSelectMix={setSelectedMix}
                    onStartRadio={() => startInfiniteRadio(recommendedSongs)}
                    isInfiniteRadioActive={isInfiniteRadio}
                  />
                )}

                {/* Made For You personalized mixes carousel / grid */}
                <PersonalizedMixesSection
                  mixes={personalizedMixes}
                  selectedMix={null}
                  onSelectMix={setSelectedMix}
                  onPlayMix={handlePlayMix}
                  onPlaySong={handlePlaySong}
                  onDownloadSong={handleDownloadSong}
                  libraryIndex={libraryIndex}
                  isLoadingMixes={isLoadingMixes}
                  onRefreshMixes={() => void loadPersonalizedMixes(true)}
                />

                {/* Recommended tracks with live equalizer on playing song */}
                {recommendedSongs.length > 0 ? (
                  <HomeSongSection
                    songs={recommendedSongs}
                    title={AppCapabilities.onlineDiscovery ? 'Recommended Tracks' : 'Your Library Tracks'}
                    subtitle={
                      AppCapabilities.onlineDiscovery
                        ? 'Curated audio tailored to your library and listening flow'
                        : 'Offline tracks available in your music library'
                    }
                    likedSongIds={likedSongIds}
                    onToggleLike={toggleLike}
                    onPlaySong={handlePlaySong}
                    onDownloadSong={handleDownloadSong}
                    onChooseSourceOrReplace={handleChooseSourceOrReplace}
                    libraryIndex={libraryIndex}
                    onStartRadio={() => startInfiniteRadio(recommendedSongs)}
                    isRadioActive={isInfiniteRadio}
                  />
                ) : (
                  !AppCapabilities.onlineDiscovery && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-zinc-400">
                      <FolderOpen className="mx-auto h-8 w-8 text-emerald-400 mb-2 opacity-80" />
                      <p className="font-bold text-white text-base">No local songs in your library yet</p>
                      <p className="mt-1 text-xs text-zinc-400 max-w-md mx-auto mb-4">
                        Add a music folder or audio files from your device storage to start listening.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={handleAddFolder}
                          className="flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 px-4 text-xs font-bold text-black transition-all shadow-md cursor-pointer"
                        >
                          <Plus className="h-4 w-4 stroke-[3]" />
                          <span>Add Music Folder</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleAddFiles}
                          className="flex h-9 items-center gap-1.5 rounded-full border border-white/20 bg-surface-elevated px-4 text-xs font-medium text-white hover:bg-hover transition-all cursor-pointer"
                        >
                          <FolderOpen className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Select Audio Files</span>
                        </button>
                      </div>
                    </div>
                  )
                )}

                {/* Recommended Albums */}
                {recommendedAlbums.length > 0 && (
                  <AlbumsGridSection
                    albums={recommendedAlbums}
                    title={AppCapabilities.onlineDiscovery ? 'Recommended Albums & EPs' : 'Your Library Albums'}
                    subtitle={
                      AppCapabilities.onlineDiscovery
                        ? 'Trending full-length releases and essential records'
                        : 'Albums discovered across your offline files'
                    }
                  />
                )}
              </>
            )}
          </>
        )}

        {/* ─── Apple Music Charts Tab ───────────────────────────────────────────────── */}
        {AppCapabilities.onlineDiscovery && activeTab === 'apple' && (
          <AppleChartsTab
            onPlaySong={handlePlaySong}
            onDownloadSong={handleDownloadSong}
            onChooseSourceOrReplace={handleChooseSourceOrReplace}
            libraryIndex={libraryIndex}
          />
        )}

        {/* ─── Spotify Playlists Tab ────────────────────────────────────────────────── */}
        {AppCapabilities.onlineDiscovery && activeTab === 'spotify' && (
          <SpotifyPlaylistsTab
            onPlaySong={handlePlaySong}
            onDownloadSong={handleDownloadSong}
            onChooseSourceOrReplace={handleChooseSourceOrReplace}
            libraryIndex={libraryIndex}
          />
        )}

        {/* ─── Album of the Year Critic Reviews Tab ─────────────────────────────────── */}
        {AppCapabilities.onlineDiscovery && activeTab === 'aoty' && <AotyTab />}

        {/* ─── Last.fm Community Scrobbles Tab ──────────────────────────────────────── */}
        {AppCapabilities.lastFm && activeTab === 'lastfm' && <LastFmTab onPlaySong={handlePlaySong} />}
      </div>
    </div>
  )
}
