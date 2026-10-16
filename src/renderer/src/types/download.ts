export type DownloadTarget = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  filePath?: string
  artworkPath?: string
  artworkUrl?: string
  size?: number
  sampleRate?: number
  isOnline?: boolean
  autoDownload?: boolean
  autoPlay?: boolean
}
