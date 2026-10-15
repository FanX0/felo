import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Song } from '../Library/Library'
import type { HomeProps, HomeTabType, HomeSongItem, HomeAlbumItem } from './types'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import { findMatchingLibrarySong } from '../../lib/songMatching'
import type { PersonalizedMix } from '../../services/PersonalizationService'
import { AppCapabilities } from '../../lib/appConfig'
import { usePlaybackArbitration } from '../../hooks/usePlaybackArbitration'

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

  // Play a song from home/charts: plays local file if available, or queues online download
  const handlePlaySong = useCallback(
    async (song: HomeSongItem) => {
      let localSong = findMatchingLibrarySong(song.title, song.artist, librarySongs)

      if (!localSong?.filePath) {
        try {
          const latestSongs = (await window.api?.getSongs?.()) as Song[] | undefined
          if (latestSongs) {
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
        autoDownload: true,
        autoPlay: true
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
        autoDownload: true,
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
    <div className="relative min-h-full w-full bg-canvas text-white select-none pb-28">
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
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-zinc-400">
                      <p className="font-semibold text-white">No local songs in your library yet</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Scan local folders or import audio in the Library tab to listen offline.
                      </p>
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
        {AppCapabilities.onlineDiscovery && activeTab === 'lastfm' && <LastFmTab onPlaySong={handlePlaySong} />}
      </div>
    </div>
  )
}
