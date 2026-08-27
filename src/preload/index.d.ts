import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // Library
      selectFolder: () => Promise<string | null>
      scanLibrary: (folderPath: string) => Promise<number>
      getSongs: () => Promise<any[]>

      // Library Roots
      getLibraryRoots: () => Promise<any[]>
      removeLibraryRoot: (rootId: string) => Promise<void>
      removeSong: (songId: string) => Promise<void>

      // Artists & Albums
      getArtists: () => Promise<any[]>
      getAlbums: () => Promise<any[]>
      searchSongs: (query: string) => Promise<any[]>
      searchArtists: (query: string) => Promise<any[]>
      searchAppleMusic: (query: string) => Promise<{
        'Top Results': any[]
        Artists: any[]
        Albums: any[]
        Songs: any[]
      }>
      searchAppleMusicArtistSongs: (artistName: string) => Promise<any[]>
      searchMusicBrainz: (query: string) => Promise<{
        'Top Results': any[]
        Artists: any[]
        Albums: any[]
        Songs: any[]
      }>
      searchLastFm: (query: string, apiKey?: string) => Promise<{
        'Top Results': any[]
        Artists: any[]
        Albums: any[]
        Songs: any[]
      }>

      // Playlists
      getPlaylists: () => Promise<any[]>
      getPlaylist: (playlistId: string) => Promise<any | null>
      createPlaylist: (input: {
        name: string
        description?: string
        songIds?: string[]
        tracks?: Array<{
          title: string
          artist?: string
          album?: string
          duration?: number
          matchedSongId?: string
          coverArt?: string
        }>
      }) => Promise<any>
      fetchPlaylistImportMetadata: (url: string) => Promise<any>
      importSpotifyPlaylist: (playlistId: string, name: string) => Promise<any>
      deletePlaylist: (playlistId: string) => Promise<void>
      renamePlaylist: (playlistId: string, name: string) => Promise<any>
      addSongToPlaylist: (playlistId: string, songId: string) => Promise<any>
      removeSongFromPlaylist: (playlistId: string, songId: string) => Promise<any>

      // Lyrics
      fetchLyrics: (songInfo: {
        title: string
        artist: string
        album?: string
        duration?: number
      }) => Promise<any | null>
      translateLyrics: (lines: string[], targetLanguage: string) => Promise<string[]>
      romanizeLyrics: (lines: string[]) => Promise<string[]>

      // Settings
      getSetting: (key: string) => Promise<any>
      setSetting: (key: string, value: any) => Promise<void>

      // Streaming account tests
      testQobuzAccount: (
        accounts: any
      ) => Promise<{ status: string; message: string; rawError?: string }>
      testDeezerAccount: (
        accounts: any
      ) => Promise<{ status: string; message: string; rawError?: string }>
      testSoulseekAccount: (
        accounts: any
      ) => Promise<{ status: string; message: string; rawError?: string }>

      // Provider downloads
      searchDownloadSource: (
        source: 'qobuz' | 'deezer' | 'soulseek' | 'youtube',
        query: string,
        accounts: any
      ) => Promise<any[]>
      startDownload: (request: any) => Promise<{
              started: boolean
              transferId: string
              alreadyExists?: boolean
              duplicateRequest?: boolean
            }>
      onDownloadProgress: (listener: (event: any) => void) => () => void
      checkDownloaderDependencies: () => Promise<{
        ytDlp: { available: boolean; command?: string }
        ffmpeg: { available: boolean; path?: string }
      }>
      installDownloaderDependencies: () => Promise<{ success: boolean; message: string }>
      onDownloaderInstallLog: (listener: (chunk: string) => void) => () => void

      // System
      getAppVersion: () => Promise<string>
      checkForUpdates: () => Promise<{
        status: 'up-to-date' | 'available' | 'unavailable' | 'error'
        currentVersion: string
        latestVersion?: string
        releaseUrl?: string
        message?: string
      }>
      openExternal: (url: string) => Promise<void>
      onAuthCallback: (listener: (url: string) => void) => () => void
      revealInExplorer: (filePath: string) => Promise<void>

      // Window
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
    }
  }
}
