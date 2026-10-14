import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // External Player & Remote Control
      getExternalPlayerSettings?: () => Promise<{ enabled: boolean; port: number; apiKey: string }>
      getExternalPlayerClientConfigs: () => Promise<{
        apiKey: string
        port: number
        running: boolean
        hermes: string
        claudeDesktop: string
        cursor: string
        windsurf: string
      }>
      setExternalPlayerEnabled: (enabled: boolean) => Promise<any>
      regenerateExternalPlayerApiKey: () => Promise<any>
      copyHermesConfig: () => Promise<string>
      getRemoteControlInfo: () => Promise<{
        enabled: boolean
        running: boolean
        port: number
        ip: string
        token: string
        url: string
        qrDataUrl: string
        cloudflareUrl: string
        cloudflareQrDataUrl: string
        connectedClients: number
      }>
      setRemoteControlEnabled: (enabled: boolean) => Promise<any>
      regenerateRemoteControlToken: () => Promise<any>
      onExternalPlayerCommand: (listener: (payload: unknown) => void) => () => void
      publishExternalPlayerStatus: (status: unknown) => void
      respondToExternalPlayerCommand: (requestId: string, result: unknown) => void

      // Discord Bot & Webhooks
      getDiscordBotStatus: () => Promise<any>
      updateDiscordSettings: (settings: {
        token?: string
        enabled?: boolean
        prefix?: string
        channelId?: string
        webhookUrl?: string
        webhookEnabled?: boolean
      }) => Promise<any>
      testDiscordWebhook: (url: string) => Promise<{ success: boolean; message: string }>
      updateDiscordRoomInfo: (info: { code: string; name?: string; members?: number }) => void

      // Music Presence
      setupMusicPresence: () => Promise<{ success: boolean; status?: any; error?: string }>
      getMusicPresenceStatus: () => Promise<{
        installed: boolean
        running: boolean
        configured: boolean
        executablePath: string | null
      }>
      launchMusicPresence: () => Promise<{ success: boolean; error?: string }>

      // Charts & Recommendations
      fetchDeezerChart: (genreId?: number, limit?: number) => Promise<any>
      fetchDeezerRecommendations: (artistName: string) => Promise<any[]>

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
      searchAlbums: (query: string) => Promise<any[]>
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
      fetchLastFmCharts: (category?: string, tag?: string) => Promise<any[]>

      // Playback Ledger & History
      recordPlay: (payload: {
        songId: string
        title?: string
        artist?: string
        album?: string
        duration?: number
        completedPercent?: number
        startedAt?: number
        endedAt?: number
      }) => Promise<{ success: boolean; playCount: number }>
      getListeningHistory: (limit?: number) => Promise<{
        recent: any[]
        topTracks: any[]
        topArtists: Array<{ artist: string; playCount: number }>
        totalPlays: number
        totalTracks: number
      }>

      // Deezer Charts & Personalization
      fetchDeezerChart: (genreId?: number, limit?: number) => Promise<any>
      fetchDeezerRecommendations: (artistName: string) => Promise<any[]>

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
      fetchSpotifyPlaylistTracks: (
        playlistId: string
      ) => Promise<{ title: string; tracks: Array<{ title: string; artist: string; duration?: number }> }>
      fetchAotyAlbums: (category?: 'must-hear' | 'highest-rated' | 'new-releases' | 'anticipated') => Promise<{
        id: string
        title: string
        artist: string
        coverUrl: string
        criticScore: number | null
        userScore: number | null
        year: string
        url: string
        mustHear: boolean
      }[]>
      fetchExploreFeed: () => Promise<{
        trendingSongs: Array<{
          id: string
          title: string
          artist: string
          album?: string
          duration: number
          artworkUrl?: string
          quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
          isExplicit?: boolean
          year?: string | number
        }>
        hotNewSongs: Array<{
          id: string
          title: string
          artist: string
          album?: string
          duration: number
          artworkUrl?: string
          quality?: 'FLAC' | 'HD FLAC' | 'Hi-Res'
          isExplicit?: boolean
          year?: string | number
        }>
        recommendedAlbums: Array<{
          id: string
          title: string
          artist: string
          artworkUrl?: string
          year?: string | number
          songCount?: number
        }>
        hotNewAlbums: Array<{
          id: string
          title: string
          artist: string
          artworkUrl?: string
          year?: string | number
          songCount?: number
        }>
      }>
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
        filePath?: string
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
      acquireAndDownload: (
        query: string,
        artist?: string,
        options?: {
          timeoutMs?: number
          preferredSource?: 'qobuz' | 'deezer' | 'soulseek' | 'youtube'
        }
      ) => Promise<any>
      startDownload: (request: any) => Promise<{
              started: boolean
              transferId: string
              alreadyExists?: boolean
              duplicateRequest?: boolean
            }>
      cancelDownload: (transferId: string) => Promise<boolean>
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

      // External Player & Remote Control
      setExternalPlayerEnabled: (enabled: boolean) => Promise<{ enabled: boolean; running: boolean }>
      getExternalPlayerSettings: () => Promise<{ enabled: boolean; running: boolean; port: number; apiKey: string }>
      getExternalPlayerApiKey: () => Promise<{ apiKey: string }>
      regenerateExternalPlayerApiKey: () => Promise<{ apiKey: string }>
      getExternalPlayerClientConfigs: () => Promise<{
        apiKey: string
        port: number
        running: boolean
        hermes: string
        claudeDesktop: string
        cursor: string
        windsurf: string
      }>
      copyHermesConfig: () => Promise<string>
      getRemoteControlInfo: () => Promise<{
        enabled: boolean
        running: boolean
        port: number
        ip: string
        token: string
        url: string
        qrDataUrl: string
        cloudflareUrl: string
        cloudflareQrDataUrl: string
        connectedClients: number
      }>
      setRemoteControlEnabled: (enabled: boolean) => Promise<any>
      regenerateRemoteControlToken: () => Promise<any>
      onExternalPlayerCommand: (listener: (payload: unknown) => void) => () => void
      publishExternalPlayerStatus: (status: unknown) => void
      respondToExternalPlayerCommand: (requestId: string, result: unknown) => void

      // Discord Bot & Webhooks
      getDiscordBotStatus: () => Promise<any>
      updateDiscordSettings: (settings: {
        token?: string
        enabled?: boolean
        prefix?: string
        channelId?: string
        webhookUrl?: string
        webhookEnabled?: boolean
      }) => Promise<any>
      testDiscordWebhook: (url: string) => Promise<{ success: boolean; message: string }>
      updateDiscordRoomInfo: (info: { code: string; name?: string; members?: number }) => void

      // Music Presence
      setupMusicPresence: () => Promise<{ success: boolean; status?: any; error?: string }>
      getMusicPresenceStatus: () => Promise<{
        installed: boolean
        running: boolean
        configured: boolean
        executablePath: string | null
      }>
      launchMusicPresence: () => Promise<{ success: boolean; error?: string }>

      // Library Scanning
      cancelLibraryScan: () => Promise<boolean>
      onLibraryScanProgress: (listener: (progress: any) => void) => () => void

      // Window
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
    }
  }
}
