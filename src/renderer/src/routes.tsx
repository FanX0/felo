import { Routes, Route, Navigate } from 'react-router-dom'
import type { DownloadTarget } from './types'

import Home from './pages/Home/Home'
import Library from './pages/Library/Library'
import Search from './pages/Search/Search'
import Playlists from './pages/Playlists/Playlists'
import PlaylistDetail from './pages/Playlists/PlaylistDetail'
import AlbumPage from './pages/Album/AlbumPage'
import ArtistPage from './pages/Artist/ArtistPage'
import LyricsPage from './pages/Lyrics/LyricsPage'
import Settings from './pages/Settings/Settings'
import AccountPage from './pages/Online/AccountPage'
import ProfilePage from './pages/Online/ProfilePage'
import ChatPage from './pages/Online/ChatPage'
import ListenTogetherPage from './pages/Online/ListenTogetherPage'
import DownloadPage from './pages/Download/DownloadPage'

export interface AppRoutesProps {
  onOpenDownloadPanel: (target: DownloadTarget) => void
}

export function AppRoutes({ onOpenDownloadPanel }: AppRoutesProps) {
  return (
    <Routes>
      <Route path="/" element={<Home onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/library" element={<Library onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/search" element={<Search onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/playlists" element={<Playlists />} />
      <Route path="/playlists/:id" element={<PlaylistDetail onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/artist/:name" element={<ArtistPage onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/album/:artist/:title" element={<AlbumPage onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/lyrics" element={<LyricsPage />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/downloads" element={<DownloadPage />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/profile/:username" element={<ProfilePage />} />
      <Route path="/chat" element={<ChatPage onOpenDownloadPanel={onOpenDownloadPanel} />} />

      {/* Listen Together Routes & Aliases */}
      <Route path="/listen-together" element={<ListenTogetherPage onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/online/listen" element={<ListenTogetherPage onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/listen" element={<ListenTogetherPage onOpenDownloadPanel={onOpenDownloadPanel} />} />
      <Route path="/together" element={<ListenTogetherPage onOpenDownloadPanel={onOpenDownloadPanel} />} />

      {/* Fallback Catch-All Route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
