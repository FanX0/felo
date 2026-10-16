import { registerSystemIpc } from './system.ipc'
import { registerLibraryIpc } from './library.ipc'
import { registerPlaylistsIpc } from './playlists.ipc'
import { registerPlaybackIpc } from './playback.ipc'
import { registerDownloadsIpc } from './downloads.ipc'
import { registerSearchIpc } from './search.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerStreamingIpc } from './streaming.ipc'
import { registerLyricsIpc } from './lyrics.ipc'

export function registerAllIpcHandlers(): void {
  registerSystemIpc()
  registerLibraryIpc()
  registerPlaylistsIpc()
  registerPlaybackIpc()
  registerDownloadsIpc()
  registerSearchIpc()
  registerSettingsIpc()
  registerStreamingIpc()
  registerLyricsIpc()
}

export * from './system.ipc'
export * from './library.ipc'
export * from './playlists.ipc'
export * from './playback.ipc'
export * from './downloads.ipc'
export * from './search.ipc'
export * from './settings.ipc'
export * from './streaming.ipc'
export * from './lyrics.ipc'
