import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const authCallbackListeners = new Set<(url: string) => void>()
const pendingAuthCallbacks: string[] = []

ipcRenderer.on('auth:callback', (_event, url: unknown) => {
  if (typeof url !== 'string' || !url.startsWith('felo://auth/callback')) return
  if (authCallbackListeners.size === 0) {
    pendingAuthCallbacks.push(url)
    return
  }
  authCallbackListeners.forEach((listener) => listener(url))
})

// Typed API exposed to renderer
const api = {
  // Library
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  scanLibrary: (folderPath: string): Promise<number> =>
    ipcRenderer.invoke('library:scan', folderPath),
  getSongs: (): Promise<any[]> => ipcRenderer.invoke('library:getSongs'),

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
  searchAppleMusic: (query: string): Promise<any> => ipcRenderer.invoke('search:appleMusic', query),
  searchAppleMusicArtistSongs: (artistName: string): Promise<any[]> =>
    ipcRenderer.invoke('search:appleMusicArtistSongs', artistName),
  searchMusicBrainz: (query: string): Promise<any> =>
    ipcRenderer.invoke('search:musicBrainz', query),

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
  deletePlaylist: (playlistId: string): Promise<void> =>
    ipcRenderer.invoke('playlists:delete', playlistId),
  addSongToPlaylist: (playlistId: string, songId: string): Promise<any> =>
    ipcRenderer.invoke('playlists:addSong', playlistId, songId),
  removeSongFromPlaylist: (playlistId: string, songId: string): Promise<any> =>
    ipcRenderer.invoke('playlists:removeSong', playlistId, songId),

  // Lyrics
  fetchLyrics: (songInfo: {
    title: string
    artist: string
    album?: string
    duration?: number
  }): Promise<any | null> => ipcRenderer.invoke('lyrics:fetch', songInfo),

  // Settings
  getSetting: (key: string): Promise<any> => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: any): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Streaming account tests
  testQobuzAccount: (accounts: any): Promise<{ status: string; message: string }> =>
    ipcRenderer.invoke('streaming:testQobuz', accounts),
  testDeezerAccount: (accounts: any): Promise<{ status: string; message: string }> =>
    ipcRenderer.invoke('streaming:testDeezer', accounts),

  // Provider downloads
  searchDownloadSource: (source: 'qobuz' | 'deezer', query: string, accounts: any) =>
    ipcRenderer.invoke('downloads:search', source, query, accounts),
  startDownload: (request: any) => ipcRenderer.invoke('downloads:start', request),
  onDownloadProgress: (listener: (event: any) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: any) => listener(payload)
    ipcRenderer.on('downloads:progress', handler)
    return () => ipcRenderer.removeListener('downloads:progress', handler)
  },

  // System
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
  checkForUpdates: (): Promise<any> => ipcRenderer.invoke('system:checkForUpdates'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:openExternal', url),
  onAuthCallback: (listener: (url: string) => void): (() => void) => {
    authCallbackListeners.add(listener)
    pendingAuthCallbacks.splice(0).forEach(listener)
    return () => authCallbackListeners.delete(listener)
  },
  revealInExplorer: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('system:revealFile', filePath),

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
