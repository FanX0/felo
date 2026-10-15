import { remoteClient } from '../pages/Remote/remoteClient'

export interface RemoteLibrarySong {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  trackNumber?: number
  discNumber?: number
  genre?: string
  bitrate?: number
  sampleRate?: number
  codec?: string
  isFavorite?: boolean
  dateAdded?: number
  artworkUrl?: string
  audioUrl?: string
  downloadUrl?: string
}

export interface RemoteAlbum {
  title: string
  artist: string
  trackCount: number
  artworkUrl?: string
}

export interface RemoteArtist {
  name: string
  albumCount: number
  trackCount: number
  artworkUrl?: string
}

export interface RemotePlaylist {
  id: string
  name: string
  description?: string
  trackCount: number
  dateModified?: number
  artworkUrl?: string
}

function toAbsoluteUrl(url?: string): string | undefined {
  if (!url) return undefined
  if (/^https?:\/\//i.test(url)) return url
  const base = remoteClient.getBaseUrl().replace(/\/+$/, '')
  const cleanPath = url.startsWith('/') ? url : `/${url}`
  return `${base}${cleanPath}`
}

class RemoteLibraryService {
  public async getSongs(options: {
    offset?: number
    limit?: number
    sort?: string
    order?: 'asc' | 'desc'
    q?: string
  } = {}): Promise<{ songs: RemoteLibrarySong[]; total: number }> {
    const params = new URLSearchParams()
    if (options.offset) params.set('offset', String(options.offset))
    if (options.limit) params.set('limit', String(options.limit))
    if (options.sort) params.set('sort', options.sort)
    if (options.order) params.set('order', options.order)
    if (options.q) params.set('q', options.q)

    params.set('token', remoteClient.getToken())
    const res = await fetch(`${remoteClient.getBaseUrl()}/v1/library/songs?${params.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      songs: (data.songs || []).map((s: any) => ({
        ...s,
        artworkUrl: toAbsoluteUrl(s.artworkUrl),
        audioUrl: toAbsoluteUrl(s.audioUrl),
        downloadUrl: toAbsoluteUrl(s.downloadUrl)
      })),
      total: data.total || 0
    }
  }

  public async getAlbums(
    options: { offset?: number; limit?: number; q?: string } = {}
  ): Promise<{ albums: RemoteAlbum[]; total: number }> {
    const params = new URLSearchParams()
    if (options.offset) params.set('offset', String(options.offset))
    if (options.limit) params.set('limit', String(options.limit))
    if (options.q) params.set('q', options.q)

    params.set('token', remoteClient.getToken())
    const res = await fetch(`${remoteClient.getBaseUrl()}/v1/library/albums?${params.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      albums: (data.albums || []).map((a: any) => ({
        ...a,
        artworkUrl: toAbsoluteUrl(a.artworkUrl)
      })),
      total: data.total || 0
    }
  }

  public async getAlbumTracks(albumName: string): Promise<RemoteLibrarySong[]> {
    const token = encodeURIComponent(remoteClient.getToken())
    const res = await fetch(
      `${remoteClient.getBaseUrl()}/v1/library/albums/${encodeURIComponent(albumName)}?token=${token}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.tracks || []).map((s: any) => ({
      ...s,
      artworkUrl: toAbsoluteUrl(s.artworkUrl),
      audioUrl: toAbsoluteUrl(s.audioUrl),
      downloadUrl: toAbsoluteUrl(s.downloadUrl)
    }))
  }

  public async getArtists(
    options: { offset?: number; limit?: number; q?: string } = {}
  ): Promise<{ artists: RemoteArtist[]; total: number }> {
    const params = new URLSearchParams()
    if (options.offset) params.set('offset', String(options.offset))
    if (options.limit) params.set('limit', String(options.limit))
    if (options.q) params.set('q', options.q)

    params.set('token', remoteClient.getToken())
    const res = await fetch(`${remoteClient.getBaseUrl()}/v1/library/artists?${params.toString()}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      artists: (data.artists || []).map((a: any) => ({
        ...a,
        artworkUrl: toAbsoluteUrl(a.artworkUrl)
      })),
      total: data.total || 0
    }
  }

  public async getArtistTracks(artistName: string): Promise<RemoteLibrarySong[]> {
    const token = encodeURIComponent(remoteClient.getToken())
    const res = await fetch(
      `${remoteClient.getBaseUrl()}/v1/library/artists/${encodeURIComponent(artistName)}?token=${token}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.tracks || []).map((s: any) => ({
      ...s,
      artworkUrl: toAbsoluteUrl(s.artworkUrl),
      audioUrl: toAbsoluteUrl(s.audioUrl),
      downloadUrl: toAbsoluteUrl(s.downloadUrl)
    }))
  }

  public async getPlaylists(): Promise<RemotePlaylist[]> {
    const token = encodeURIComponent(remoteClient.getToken())
    const res = await fetch(`${remoteClient.getBaseUrl()}/v1/library/playlists?token=${token}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return (data.playlists || []).map((p: any) => ({
      ...p,
      artworkUrl: toAbsoluteUrl(p.artworkUrl)
    }))
  }

  public async getPlaylistTracks(
    playlistId: string
  ): Promise<{ playlist: { id: string; name: string; description?: string; dateModified?: number }; tracks: RemoteLibrarySong[] }> {
    const token = encodeURIComponent(remoteClient.getToken())
    const res = await fetch(
      `${remoteClient.getBaseUrl()}/v1/library/playlists/${encodeURIComponent(playlistId)}?token=${token}`
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      playlist: data.playlist,
      tracks: (data.tracks || []).map((s: any) => ({
        ...s,
        artworkUrl: toAbsoluteUrl(s.artworkUrl),
        audioUrl: toAbsoluteUrl(s.audioUrl),
        downloadUrl: toAbsoluteUrl(s.downloadUrl)
      }))
    }
  }
}

export const remoteLibraryService = new RemoteLibraryService()
