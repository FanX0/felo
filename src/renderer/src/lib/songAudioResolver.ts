import type { Song } from '../pages/Library/Library'
import { toMediaUrl } from './media'
import { isElectron } from './appConfig'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { remoteClient } from '../pages/Remote/remoteClient'

/**
 * Resolves a playable media/audio stream URL for any song across all environments:
 * - PC Electron: native file path via media://local/...
 * - PC Web / Mobile Web / Mobile Native:
 *   1. Direct HTTP/HTTPS audio URL (if already resolved or blob)
 *   2. Song's audioUrl property
 *   3. Active Desktop's LAN stream endpoint: http://<local_ip>:<port>/v1/audio/<id>?token=...
 *   4. remoteClient configured base URL
 *   5. Fallback: null if only virtual/offline and unreachable
 */
export function resolveSongAudioUrl(song?: Song | null): string | null {
  if (!song) return null

  // 1. If song already has an active web playable URL (http, https, blob, data)
  if (song.filePath && /^(blob:|data:|https?:)/i.test(song.filePath)) {
    return song.filePath
  }

  // 2. If song has an explicit audioUrl attached
  if (song.audioUrl && /^(https?:|blob:)/i.test(song.audioUrl)) {
    return song.audioUrl
  }

  // 3. If running in Electron desktop app and song has a real local path
  if (isElectron && song.filePath && !song.filePath.startsWith('virtual:') && !song.isOnline) {
    return toMediaUrl(song.filePath)
  }

  // 4. Resolve via discovered active desktop device with local LAN IP
  const store = useConnectedDeviceStore.getState()
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
  const desktop =
    store.discoveredDevices.find(
      (d) =>
        d.id !== myDeviceId &&
        (d.device_type === 'app_pc' || d.device_type === 'desktop') &&
        d.local_ip &&
        d.is_active
    ) ||
    store.discoveredDevices.find(
      (d) =>
        d.id !== myDeviceId &&
        (d.device_type === 'app_pc' || d.device_type === 'desktop') &&
        d.local_ip
    )

  if (desktop && desktop.local_ip && song.id) {
    const port = desktop.port || 4788
    const token = desktop.token ? `?token=${encodeURIComponent(desktop.token)}` : ''
    return `http://${desktop.local_ip}:${port}/v1/audio/${encodeURIComponent(song.id)}${token}`
  }

  // 5. Resolve via remoteClient base URL if configured
  const remoteBase = remoteClient.getBaseUrl()
  if (remoteBase && song.id) {
    return remoteClient.getAudioStreamUrl(song.id)
  }

  return null
}

/**
 * Resolves a direct download URL for saving track to device
 */
export function resolveSongDownloadUrl(song?: Song | null): string | null {
  if (!song || !song.id) return null

  if (song.downloadUrl && /^(https?:)/i.test(song.downloadUrl)) {
    return song.downloadUrl
  }

  const store = useConnectedDeviceStore.getState()
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
  const desktop =
    store.discoveredDevices.find(
      (d) =>
        d.id !== myDeviceId &&
        (d.device_type === 'app_pc' || d.device_type === 'desktop') &&
        d.local_ip &&
        d.is_active
    ) ||
    store.discoveredDevices.find(
      (d) =>
        d.id !== myDeviceId &&
        (d.device_type === 'app_pc' || d.device_type === 'desktop') &&
        d.local_ip
    )

  if (desktop && desktop.local_ip) {
    const port = desktop.port || 4788
    const token = desktop.token ? `?token=${encodeURIComponent(desktop.token)}` : ''
    return `http://${desktop.local_ip}:${port}/v1/download/${encodeURIComponent(song.id)}${token}`
  }

  const remoteBase = remoteClient.getBaseUrl()
  if (remoteBase && song.id) {
    return remoteClient.getDownloadUrl(song.id)
  }

  return null
}

/**
 * Batch-resolves audio and artwork URLs for an array of remote/online songs.
 * Use this when loading songs from cache or Realtime broadcast to ensure
 * all URLs point to the current active desktop LAN address — not stale
 * hardcoded IPs from a previous session.
 */
export function resolveRemoteSongUrls(
  songs: Song[],
  fallbackDevices?: import('../online/types').UserConnectedDevice[]
): Song[] {
  // Determine current stream base from remoteClient or discovered desktop
  let streamBase = ''
  let artworkBase = ''
  let downloadBase = ''
  let tokenParam = ''

  const remoteBase = remoteClient.getBaseUrl()
  if (remoteBase && remoteBase !== window.location.origin) {
    streamBase = `${remoteBase}/v1/audio/`
    artworkBase = `${remoteBase}/v1/artwork/`
    downloadBase = `${remoteBase}/v1/download/`
    const token = remoteClient.getToken()
    tokenParam = token ? `?token=${encodeURIComponent(token)}` : ''
  } else {
    // Fallback: try discovered desktop
    const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
    const devices =
      fallbackDevices ||
      (typeof useConnectedDeviceStore !== 'undefined'
        ? useConnectedDeviceStore.getState()?.discoveredDevices || []
        : [])
    const desktop = devices.find(
      (d) =>
        d.id !== myDeviceId &&
        (d.device_type === 'app_pc' || d.device_type === 'desktop') &&
        d.local_ip &&
        d.is_active
    )
    if (desktop?.local_ip) {
      const port = desktop.port || 4788
      const base = `http://${desktop.local_ip}:${port}`
      streamBase = `${base}/v1/audio/`
      artworkBase = `${base}/v1/artwork/`
      downloadBase = `${base}/v1/download/`
      tokenParam = desktop.token ? `?token=${encodeURIComponent(desktop.token)}` : ''
    }
  }

  if (!streamBase) return songs

  return songs.map((s) => {
    if (!s.id || !s.isOnline) return s

    const audioUrl = `${streamBase}${encodeURIComponent(s.id)}${tokenParam}`
    const artUrl = s.artworkUrl && /^https?:\/\//i.test(s.artworkUrl)
      ? s.artworkUrl
      : `${artworkBase}${encodeURIComponent(s.id)}${tokenParam}`
    const dlUrl = `${downloadBase}${encodeURIComponent(s.id)}${tokenParam}`

    return {
      ...s,
      filePath: audioUrl,
      audioUrl,
      artworkUrl: artUrl,
      artworkPath: artUrl,
      downloadUrl: dlUrl
    }
  })
}
