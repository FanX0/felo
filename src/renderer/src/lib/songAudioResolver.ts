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

  // 1. If running in Electron desktop app and song has a local path
  if (isElectron && song.filePath && !song.filePath.startsWith('virtual:')) {
    return toMediaUrl(song.filePath)
  }

  // 2. If song already has an active web playable URL (http, https, blob, data)
  if (song.filePath && /^(blob:|data:|https?:)/i.test(song.filePath)) {
    return song.filePath
  }

  // 3. If song has an explicit audioUrl attached
  if (song.audioUrl && /^(https?:|blob:)/i.test(song.audioUrl)) {
    return song.audioUrl
  }

  // 4. Resolve via discovered active desktop device with local LAN IP
  const store = useConnectedDeviceStore.getState()
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
  const desktop =
    store.discoveredDevices.find(
      (d) => d.id !== myDeviceId && d.device_type === 'desktop' && d.local_ip && d.is_active
    ) ||
    store.discoveredDevices.find((d) => d.id !== myDeviceId && d.device_type === 'desktop' && d.local_ip)

  if (desktop && desktop.local_ip && song.id) {
    const port = desktop.port || 4788
    const token = desktop.token ? `?token=${encodeURIComponent(desktop.token)}` : ''
    return `http://${desktop.local_ip}:${port}/v1/audio/${encodeURIComponent(song.id)}${token}`
  }

  // 5. Resolve via remoteClient base URL if configured
  const remoteBase = remoteClient.getBaseUrl()
  if (
    remoteBase &&
    !remoteBase.includes('localhost') &&
    !remoteBase.includes('workers.dev') &&
    song.id
  ) {
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
      (d) => d.id !== myDeviceId && d.device_type === 'desktop' && d.local_ip && d.is_active
    ) ||
    store.discoveredDevices.find((d) => d.id !== myDeviceId && d.device_type === 'desktop' && d.local_ip)

  if (desktop && desktop.local_ip) {
    const port = desktop.port || 4788
    const token = desktop.token ? `?token=${encodeURIComponent(desktop.token)}` : ''
    return `http://${desktop.local_ip}:${port}/v1/download/${encodeURIComponent(song.id)}${token}`
  }

  const remoteBase = remoteClient.getBaseUrl()
  if (remoteBase && !remoteBase.includes('localhost') && !remoteBase.includes('workers.dev')) {
    return remoteClient.getDownloadUrl(song.id)
  }

  return null
}
