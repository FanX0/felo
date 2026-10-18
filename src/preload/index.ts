import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const authCallbackListeners = new Set<(url: string) => void>()
const pendingAuthCallbacks: string[] = []

ipcRenderer.on('auth:callback', (_event, url: unknown) => {
  if (typeof url !== 'string') return
  const clean = url.trim().replace(/^["']|["']$/g, '')
  const lower = clean.toLowerCase()
  if (!lower.startsWith('felo://auth/callback') && !lower.startsWith('felo:///auth/callback')) return
  if (authCallbackListeners.size === 0) {
    pendingAuthCallbacks.push(clean)
    return
  }
  authCallbackListeners.forEach((listener) => {
    try {
      listener(clean)
    } catch (err) {
      console.error('[Preload] Failed to dispatch auth callback:', err)
    }
  })
})

// Typed API exposed to renderer
const api = {
  setExternalPlayerEnabled: (enabled: boolean): Promise<{ enabled: boolean; running: boolean }> =>
    ipcRenderer.invoke('external-player:set-enabled', enabled),
  getExternalPlayerSettings: (): Promise<{ enabled: boolean; running: boolean; port: number; apiKey: string }> =>
    ipcRenderer.invoke('external-player:get-settings'),
  getExternalPlayerApiKey: (): Promise<{ apiKey: string }> =>
    ipcRenderer.invoke('external-player:get-api-key'),
  regenerateExternalPlayerApiKey: (): Promise<{ apiKey: string }> =>
    ipcRenderer.invoke('external-player:regenerate-api-key'),
  getExternalPlayerClientConfigs: (): Promise<{
    apiKey: string
    port: number
    running: boolean
    hermes: string
    claudeDesktop: string
    cursor: string
    windsurf: string
  }> => ipcRenderer.invoke('external-player:get-client-configs'),
  copyHermesConfig: (): Promise<string> => ipcRenderer.invoke('external-player:copy-hermes-config'),
  getRemoteControlInfo: (): Promise<{
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
    deviceName?: string
  }> => ipcRenderer.invoke('remote-control:get-info'),
  setRemoteControlEnabled: (enabled: boolean): Promise<any> =>
    ipcRenderer.invoke('remote-control:set-enabled', enabled),
  regenerateRemoteControlToken: (): Promise<any> =>
    ipcRenderer.invoke('remote-control:regenerate-token'),
  onExternalPlayerCommand: (listener: (payload: unknown) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('external-player:command', handler)
    return () => ipcRenderer.removeListener('external-player:command', handler)
  },
  publishExternalPlayerStatus: (status: unknown): void => ipcRenderer.send('external-player:status', status),
  respondToExternalPlayerCommand: (requestId: string, result: unknown): void =>
    ipcRenderer.send('external-player:result', requestId, result),
  // Discord Bot & Webhooks
  getDiscordBotStatus: (): Promise<any> => ipcRenderer.invoke('discord:get-status'),
  updateDiscordSettings: (settings: {
    token?: string
    enabled?: boolean
    prefix?: string
    channelId?: string
    webhookUrl?: string
    webhookEnabled?: boolean
  }): Promise<any> => ipcRenderer.invoke('discord:update-settings', settings),
  testDiscordWebhook: (url: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('discord:test-webhook', url),
  updateDiscordRoomInfo: (info: { code: string; name?: string; members?: number }): void =>
    ipcRenderer.send('discord:update-room-info', info),
  registerDiscordCommands: (): Promise<{ success: boolean; message: string; count?: number }> =>
    ipcRenderer.invoke('discord:register-commands'),
  // Library
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  scanLibrary: (folderPath: string): Promise<number> =>
    ipcRenderer.invoke('library:scan', folderPath),
  cancelLibraryScan: (): Promise<boolean> => ipcRenderer.invoke('library:cancel-scan'),
  onLibraryScanProgress: (listener: (progress: any) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, progress: any) => listener(progress)
    ipcRenderer.on('library:scan-progress', handler)
    return () => ipcRenderer.removeListener('library:scan-progress', handler)
  },
  getSongs: (): Promise<any[]> => ipcRenderer.invoke('library:getSongs'),
  toggleFavorite: (
    songId: string,
    isFavorite?: boolean,
    songData?: any
  ): Promise<{ id: string; isFavorite: boolean }> =>
    ipcRenderer.invoke('library:toggleFavorite', songId, isFavorite, songData),
  getLikedSongs: (): Promise<any[]> => ipcRenderer.invoke('library:getLikedSongs'),
  getLikedCount: (): Promise<number> => ipcRenderer.invoke('library:getLikedCount'),
  readAudioFile: (
    songIdOrPath: string,
    explicitPath?: string
  ): Promise<{ success: boolean; data?: ArrayBuffer; contentType?: string; size?: number; error?: string }> =>
    ipcRenderer.invoke('library:readAudioFile', songIdOrPath, explicitPath),
  compressAudio: (
    songIdOrPath: string,
    options?: { bitrate?: string; format?: string; explicitPath?: string }
  ): Promise<{ success: boolean; data?: Uint8Array | Buffer; contentType?: string; size?: number; error?: string }> =>
    ipcRenderer.invoke('library:compressAudio', songIdOrPath, options),

  // Library Roots
  getLibraryRoots: (): Promise<any[]> => ipcRenderer.invoke('library:getRoots'),
  removeLibraryRoot: (rootId: string): Promise<void> =>
    ipcRenderer.invoke('library:removeRoot', rootId),
  removeSong: (songId: string): Promise<void> => ipcRenderer.invoke('library:removeSong', songId),

  // Artists & Albums
  getArtists: (): Promise<any[]> => ipcRenderer.invoke('library:getArtists'),
  getAlbums: (): Promise<any[]> => ipcRenderer.invoke('library:getAlbums'),
  searchSongs: (query: string) => ipcRenderer.invoke('library:searchSongs', query),
  searchArtists: (query: string) => ipcRenderer.invoke('library:searchArtists', query),
  searchAlbums: (query: string) => ipcRenderer.invoke('library:searchAlbums', query),
  searchAppleMusic: (query: string): Promise<any> => ipcRenderer.invoke('search:appleMusic', query),
  searchMusicBrainz: (query: string): Promise<any> => ipcRenderer.invoke('search:musicBrainz', query),
  searchLastFm: (query: string, apiKey?: string): Promise<any> =>
    ipcRenderer.invoke('search:lastFm', query, apiKey),
  fetchLastFmCharts: (category?: string, tag?: string): Promise<any[]> =>
    ipcRenderer.invoke('lastfm:getCharts', category, tag),
  searchAppleMusicArtistSongs: (artistName: string): Promise<any[]> =>
    ipcRenderer.invoke('search:appleMusicArtistSongs', artistName),

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
  }): Promise<{ success: boolean; playCount: number }> =>
    ipcRenderer.invoke('playback:recordPlay', payload),
  getListeningHistory: (limit?: number): Promise<{
    recent: any[]
    topTracks: any[]
    topArtists: Array<{ artist: string; playCount: number }>
    totalPlays: number
    totalTracks: number
  }> => ipcRenderer.invoke('playback:getListeningHistory', limit),

  // Deezer Charts & Personalization Proxy
  fetchDeezerChart: (genreId?: number, limit?: number): Promise<any> =>
    ipcRenderer.invoke('charts:fetchDeezerChart', genreId, limit),
  fetchDeezerRecommendations: (artistName: string): Promise<any[]> =>
    ipcRenderer.invoke('charts:fetchDeezerRecommendations', artistName),

  // Playlists
  getPlaylists: (): Promise<any[]> => ipcRenderer.invoke('playlists:list'),
  getPlaylist: (playlistId: string): Promise<any | null> =>
    ipcRenderer.invoke('playlists:get', playlistId),
  createPlaylist: (input: {
    name: string
    description?: string
    songIds?: string[]
  }): Promise<any> => ipcRenderer.invoke('playlists:create', input),
  fetchPlaylistImportMetadata: (url: string): Promise<any> =>
    ipcRenderer.invoke('playlists:fetchImportMetadata', url),
  fetchSpotifyPlaylistTracks: (
    playlistId: string
  ): Promise<{ title: string; tracks: Array<{ title: string; artist: string; duration?: number }> }> =>
    ipcRenderer.invoke('playlists:fetchSpotifyTracks', playlistId),
  fetchAotyAlbums: (category?: string): Promise<any[]> =>
    ipcRenderer.invoke('home:fetchAotyAlbums', category || 'must-hear'),
  fetchExploreFeed: (): Promise<any> => ipcRenderer.invoke('home:fetchExploreFeed'),
  importSpotifyPlaylist: (playlistId: string, name: string): Promise<any> =>
    ipcRenderer.invoke('playlists:importSpotify', playlistId, name),
  deletePlaylist: (playlistId: string): Promise<void> =>
    ipcRenderer.invoke('playlists:delete', playlistId),
  renamePlaylist: (playlistId: string, name: string): Promise<any> =>
    ipcRenderer.invoke('playlists:rename', playlistId, name),
  addSongToPlaylist: (playlistId: string, songId: string): Promise<any> =>
    ipcRenderer.invoke('playlists:addSong', playlistId, songId),
  removeSongFromPlaylist: (playlistId: string, songId: string): Promise<any> =>
    ipcRenderer.invoke('playlists:removeSong', playlistId, songId),

  // Lyrics
  fetchLyrics: (songInfo: {
    title: string
    artist?: string
    album?: string
    duration?: number
    filePath?: string
  }): Promise<any | null> => ipcRenderer.invoke('lyrics:fetch', songInfo),
  translateLyrics: (lines: string[], targetLanguage: string): Promise<string[]> =>
    ipcRenderer.invoke('lyrics:translate', lines, targetLanguage),
  romanizeLyrics: (lines: string[]): Promise<string[]> =>
    ipcRenderer.invoke('lyrics:romanize', lines),

  // Settings
  getSetting: (key: string): Promise<any> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: any): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Streaming account tests
  testQobuzAccount: (accounts: any): Promise<{ status: string; message: string }> =>
    ipcRenderer.invoke('streaming:testQobuz', accounts),
  testDeezerAccount: (accounts: any): Promise<{ status: string; message: string }> =>
    ipcRenderer.invoke('streaming:testDeezer', accounts),
  testSoulseekAccount: (accounts: any): Promise<{ status: string; message: string }> =>
    ipcRenderer.invoke('streaming:testSoulseek', accounts),

  // Provider downloads
  searchDownloadSource: (
    source: 'qobuz' | 'deezer' | 'soulseek' | 'youtube',
    query: string,
    accounts: any
  ) => ipcRenderer.invoke('downloads:search', source, query, accounts),
  acquireAndDownload: (query: string, artist?: string, options?: any) =>
    ipcRenderer.invoke('downloads:acquireAndDownload', query, artist, options),
  startDownload: (request: any) => ipcRenderer.invoke('downloads:start', request),
  cancelDownload: (transferId: string) => ipcRenderer.invoke('downloads:cancel', transferId),
  onDownloadProgress: (listener: (event: any) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: any) => listener(payload)
    ipcRenderer.on('downloads:progress', handler)
    return () => ipcRenderer.removeListener('downloads:progress', handler)
  },
  checkDownloaderDependencies: () => ipcRenderer.invoke('downloads:checkDependencies'),
  installDownloaderDependencies: () => ipcRenderer.invoke('downloads:installDependencies'),
  onDownloaderInstallLog: (listener: (chunk: string) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, chunk: string) => listener(chunk)
    ipcRenderer.on('downloads:installLog', handler)
    return () => ipcRenderer.removeListener('downloads:installLog', handler)
  },

  // System
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
  getAppMode: (): Promise<{ mode: 'public' | 'private'; sources: string[] }> =>
    ipcRenderer.invoke('system:getAppMode'),
  checkForUpdates: (): Promise<any> => ipcRenderer.invoke('system:checkForUpdates'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url),
  setupMusicPresence: (): Promise<{ success: boolean; status?: any; error?: string }> =>
    ipcRenderer.invoke('system:setupMusicPresence'),
  getMusicPresenceStatus: (): Promise<{
    installed: boolean
    running: boolean
    configured: boolean
    executablePath: string | null
  }> => ipcRenderer.invoke('system:getMusicPresenceStatus'),
  launchMusicPresence: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('system:launchMusicPresence'),
  relaunchApp: (): Promise<void> =>
    ipcRenderer.invoke('system:relaunchApp'),
  onAuthCallback: (listener: (url: string) => void): (() => void) => {
    authCallbackListeners.add(listener)
    pendingAuthCallbacks.splice(0).forEach(listener)
    return () => authCallbackListeners.delete(listener)
  },
  revealInExplorer: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('system:revealFile', filePath),

  // Desktop Audio Loopback
  getDesktopSources: (): Promise<Array<{ id: string; name: string; thumbnail: string | null; appIcon: string | null }>> =>
    ipcRenderer.invoke('desktopAudio:getSources'),

  // YouTube Metadata Resolver
  getYouTubeMetadata: (urlOrId: string): Promise<{
    success: boolean
    videoId?: string
    title?: string
    channel?: string
    thumbnailUrl?: string
    error?: string
  }> => ipcRenderer.invoke('youtube:get-metadata', urlOrId),

  // Window
  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window:maximize'),
  closeWindow: (): void => ipcRenderer.send('window:close')
}

// Expose via contextBridge (always context-isolated)
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
