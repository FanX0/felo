import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { findOAuthCallback, isValidOAuthCallback, OAUTH_CALLBACK_PREFIX } from './oauth'

export { findOAuthCallback, isValidOAuthCallback, OAUTH_CALLBACK_PREFIX }

let mainWindowInstance: BrowserWindow | null = null
let pendingOAuthCallback: string | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindowInstance && !mainWindowInstance.isDestroyed() ? mainWindowInstance : null
}

export function setPendingOAuthCallback(url: string | null): void {
  pendingOAuthCallback = url
}

export function deliverOAuthCallback(callbackUrl: string): void {
  if (typeof callbackUrl !== 'string') return
  const cleanUrl = callbackUrl.trim().replace(/^["']|["']$/g, '')
  if (!isValidOAuthCallback(cleanUrl)) {
    console.warn('[OAuth] Ignored invalid callback URL:', cleanUrl)
    return
  }

  const win = getMainWindow() || BrowserWindow.getAllWindows()[0]
  if (!win || win.webContents.isLoading()) {
    pendingOAuthCallback = cleanUrl
    if (!win) return
  }

  win.webContents.send('auth:callback', cleanUrl)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    title: 'Felo',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false, // Frameless for custom title bar
    titleBarStyle: 'hidden', // macOS: hidden title bar
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, // Required for better-sqlite3 native module access
      contextIsolation: true,
      // Keep authenticated playback commands and status responsive while minimized.
      backgroundThrottling: false,
      nodeIntegration: false
      // webSecurity is now TRUE (default) — we use the media:// protocol instead
    }
  })

  mainWindowInstance = mainWindow

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    if (mainWindowInstance === mainWindow) {
      mainWindowInstance = null
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingOAuthCallback) return
    mainWindow.webContents.send('auth:callback', pendingOAuthCallback)
    pendingOAuthCallback = null
  })

  // Only allow opening safe external URLs (http/https/mailto) in the system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
        shell.openExternal(details.url)
      } else {
        console.warn('[Security] Blocked window.open with unsafe protocol:', details.url)
      }
    } catch {
      console.warn('[Security] Blocked invalid window.open URL:', details.url)
    }
    return { action: 'deny' }
  })

  // Prevent renderer window from navigating away from the bundled app origin
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      if (navigationUrl.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
    }
    event.preventDefault()
    console.warn('[Security] Intercepted and blocked unexpected navigation to:', navigationUrl)
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
