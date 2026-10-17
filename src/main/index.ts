import { app, BrowserWindow, desktopCapturer, session } from 'electron'
import { resolve } from 'path'
import { electronApp } from '@electron-toolkit/utils'
import { getDb } from './database'
import { LibraryService } from './services/LibraryService'
import { DownloadService } from './services/DownloadService'
import { startMusicPresenceIntegrationWatcher } from './services/MusicPresenceService'
import { PlaybackControlService } from './services/PlaybackControlService'
import { RemoteControlService } from './services/RemoteControlService'
import { DiscordBotService } from './services/DiscordBotService'
import { registerMediaScheme, registerMediaProtocol, isPathAllowedForMedia } from './protocols'
import {
  createWindow,
  findOAuthCallback,
  deliverOAuthCallback,
  setPendingOAuthCallback
} from './window'
import { registerAllIpcHandlers } from './ipc'

// Ensure DB is initialized
getDb()

// Explicit process AppUserModelID early for Windows SMTC / Music Presence identification
if (process.platform === 'win32') {
  app.setAppUserModelId('com.felo.app')
}

// Register privileged schemes before app ready
registerMediaScheme()

const hasSingleInstanceLock =
  process.env.NODE_ENV === 'test' || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const callbackUrl = findOAuthCallback(commandLine)
    if (callbackUrl) {
      deliverOAuthCallback(callbackUrl)
    } else {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    }
  })
}

// Desktop playback can be initiated by Hermes IPC without a browser click gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.on('open-url', (event, callbackUrl) => {
  event.preventDefault()
  deliverOAuthCallback(callbackUrl)
})

const initialOAuthCallback = findOAuthCallback(process.argv)
if (initialOAuthCallback) setPendingOAuthCallback(initialOAuthCallback)

app.whenReady().then(() => {
  // Set proper app user model ID
  electronApp.setAppUserModelId('com.felo.app')
  startMusicPresenceIntegrationWatcher()
  DownloadService.getProviderInfo().then((info) => {
    console.log(`[Felo Engine] Mode: ${info.mode.toUpperCase()} · Sources: [${info.sources.join(' | ')}]`)
  })

  if ((process.defaultApp || !app.isPackaged) && process.argv[1]) {
    app.setAsDefaultProtocolClient('felo', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('felo')
  }

  // Register display media request handler for system audio loopback capture
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        if (sources.length > 0) {
          // On Windows, audio: 'loopback' enables full WASAPI desktop audio broadcast
          const isWindows = process.platform === 'win32'
          callback({ video: sources[0], audio: isWindows ? 'loopback' : undefined })
        } else {
          callback({})
        }
      })
      .catch((err) => {
        console.error('[DesktopAudio] Failed to get desktop sources for display media:', err)
        callback({})
      })
  })

  // Explicitly approve display-capture and audio media permissions
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if ((permission as string) === 'display-capture' || permission === 'media') {
      callback(true)
      return
    }
    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if ((permission as string) === 'display-capture' || permission === 'media') {
      return true
    }
    return false
  })

  // Ensure YouTube iframe embeds work seamlessly in Electron without origin/referer restrictions
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.youtube.com/'
      details.requestHeaders['Origin'] = 'https://www.youtube.com'
      callback({ cancel: false, requestHeaders: details.requestHeaders })
    }
  )

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders }
      delete responseHeaders['x-frame-options']
      delete responseHeaders['X-Frame-Options']
      callback({ cancel: false, responseHeaders })
    }
  )

  // Register media:// custom protocol
  registerMediaProtocol()

  // Register modular IPC routing
  registerAllIpcHandlers()

  // Initialize background services
  const playbackControl = new PlaybackControlService()
  playbackControl.initialize()
  app.on('before-quit', () => playbackControl.stop())

  const remoteControl = new RemoteControlService()
  remoteControl.initialize()
  app.on('before-quit', () => remoteControl.stop())

  const discordBot = new DiscordBotService()
  discordBot.initialize()
  app.on('before-quit', () => discordBot.disconnect())

  // Create main UI window
  createWindow()

  // Auto-scan library roots that haven't been scanned yet
  try {
    const db = getDb()
    const roots = db.prepare('SELECT id, path FROM library_roots WHERE isActive = 1').all() as any[]
    for (const root of roots) {
      const songCount = db
        .prepare('SELECT COUNT(*) as count FROM songs WHERE rootId = ?')
        .get(root.id) as any
      if (!songCount || songCount.count === 0) {
        console.log(`Auto-scanning unindexed library root: ${root.path}`)
        LibraryService.scanFolder(root.path, (progress) => {
          const win = BrowserWindow.getAllWindows()[0]
          if (win && !win.isDestroyed()) {
            win.webContents.send('library:scan-progress', progress)
          }
        })
          .then((count) => {
            console.log(`Auto-scan complete for ${root.path}: ${count} songs found.`)
          })
          .catch((err) => {
            console.error(`Auto-scan failed for ${root.path}:`, err)
          })
      }
    }
  } catch (err) {
    console.error('Auto-scan error:', err)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Re-export isPathAllowedForMedia for backward compatibility
export { isPathAllowedForMedia }
