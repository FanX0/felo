import type { Song } from '../pages/Library/Library'
import { toMediaUrl } from './media'
import { isElectron } from './appConfig'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { remoteClient } from '../pages/Remote/remoteClient'
import { getSongPublicBucketUrl, isSongUploadedToBucket } from './audioBucketService'
import { getLocalSlotBlobUrl, getCachedAudioBlobUrl } from './jitAudioPipeline'

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

  // 1. If running in Electron desktop app and song has a real local path on disk
  if (isElectron && song.filePath && !song.filePath.startsWith('virtual:') && !/^https?:/i.test(song.filePath)) {
    return toMediaUrl(song.filePath)
  }

  // 2. If song filePath or audioUrl is already a local memory blob: or data: URL
  if (song.filePath && /^(blob:|data:)/i.test(song.filePath)) {
    return song.filePath
  }
  if (song.audioUrl && /^(blob:|data:)/i.test(song.audioUrl)) {
    return song.audioUrl
  }

  // 2b. High Priority: RAM cache (MUSIXQUARE auto-downloaded / preloaded bytes)
  const lookupId = song.id || (song as any).localId
  if (lookupId) {
    const cachedBlobUrl = getCachedAudioBlobUrl(lookupId)
    if (cachedBlobUrl) return cachedBlobUrl

    const strippedId = lookupId.replace(/^session-\d+-/, '')
    if (strippedId !== lookupId) {
      const strippedBlobUrl = getCachedAudioBlobUrl(strippedId)
      if (strippedBlobUrl) return strippedBlobUrl
    }
  }

  // 2c. High Priority: Host local RAM slot pool
  if (lookupId) {
    const slotBlobUrl = getLocalSlotBlobUrl(lookupId) || getLocalSlotBlobUrl(lookupId.replace(/^session-\d+-/, ''))
    if (slotBlobUrl) {
      if (!song.audioUrl || !song.audioUrl.startsWith('blob:')) {
        song.audioUrl = slotBlobUrl
      }
      return slotBlobUrl
    }
  }

  // 3. YouTube tracks without local bytes are handled exclusively by YouTubePlayerBridge via the YouTube IFrame API
  if (
    (song as any).isYouTube ||
    (typeof song.id === 'string' && song.id.startsWith('yt-')) ||
    (song.audioUrl && /youtube\.com|youtu\.be/i.test(song.audioUrl)) ||
    (song.filePath && /youtube\.com|youtu\.be/i.test(song.filePath))
  ) {
    return null
  }

  // 3. If song has an explicit HTTP/HTTPS playable URL or preview URL
  if (song.filePath && /^https?:/i.test(song.filePath)) {
    return song.filePath
  }
  if (song.audioUrl && /^https?:/i.test(song.audioUrl)) {
    return song.audioUrl
  }
  if ((song as any).previewUrl && /^https?:/i.test((song as any).previewUrl)) {
    return (song as any).previewUrl
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

  // 6. Loopback / Local network fallback for web browsers running in dev mode or mobile on Wi-Fi.
  // Uses direct URL to the Electron RemoteControlService on port 4788.
  // The localhost auth bypass allows tokenless access for read-only media endpoints.
  // NOTE: HTTP audio URLs are silently blocked on HTTPS pages (mixed content policy),
  // so this fallback is only used when the page itself is served over HTTP.
  if (typeof window !== 'undefined' && !isElectron && song.id && window.location.protocol !== 'https:') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      return `http://127.0.0.1:4788/v1/audio/${encodeURIComponent(song.id)}`
    }
    if (
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.endsWith('.local')
    ) {
      return `http://${host}:4788/v1/audio/${encodeURIComponent(song.id)}`
    }
  }

  // 7. Cloud Audio Bucket (Supabase Storage) fallback for web / mobile clients.
  // Only return the bucket URL if we have evidence the song was actually uploaded,
  // to avoid returning a URL that will guaranteed 404 and trigger error → retry loops.
  if (song.id && !isElectron) {
    if (isSongUploadedToBucket(song.id)) {
      return getSongPublicBucketUrl(song.id)
    }
    return null
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
