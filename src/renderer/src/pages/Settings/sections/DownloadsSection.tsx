import { useState, type Dispatch, type SetStateAction } from 'react'
import { FolderPlus, HardDrive, Radio } from 'lucide-react'
import {
  DOWNLOAD_LOCATION_SETTING,
  PLAYBACK_STORAGE_SETTING,
  PlaybackStorageMode,
  STREAM_CACHE_SETTING
} from '../../../lib/downloadConfig'
import { SettingsSection } from '../components/SettingsSection'

interface DownloadsSectionProps {
  downloadLocation: string
  setDownloadLocation: Dispatch<SetStateAction<string>>
  playbackStorageMode: PlaybackStorageMode
  setPlaybackStorageMode: Dispatch<SetStateAction<PlaybackStorageMode>>
  streamCacheLimit: number
  setStreamCacheLimit: Dispatch<SetStateAction<number>>
}

export function DownloadsSection({
  downloadLocation,
  setDownloadLocation,
  playbackStorageMode,
  setPlaybackStorageMode,
  streamCacheLimit,
  setStreamCacheLimit
}: DownloadsSectionProps) {
  const [locationMessage, setLocationMessage] = useState('')
  const [modeMessage, setModeMessage] = useState('')

  const handleSelectDownloadLocation = async () => {
    try {
      if (!window.api?.selectFolder) return
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        setDownloadLocation(folderPath)
        await window.api?.setSetting?.(DOWNLOAD_LOCATION_SETTING, folderPath)
        setLocationMessage('Download destination updated.')
        setTimeout(() => setLocationMessage(''), 3000)
      }
    } catch (err) {
      console.error('Failed to select download folder:', err)
    }
  }

  const handleResetDownloadLocation = async () => {
    try {
      setDownloadLocation('')
      await window.api?.setSetting?.(DOWNLOAD_LOCATION_SETTING, '')
      setLocationMessage('Reset to default Music/Felo directory.')
      setTimeout(() => setLocationMessage(''), 3000)
    } catch (err) {
      console.error('Failed to reset download location:', err)
    }
  }

  const handleOpenDownloadLocation = async () => {
    if (downloadLocation) {
      await window.api?.revealInExplorer?.(downloadLocation)
    }
  }

  const savePlaybackStorageMode = async () => {
    await window.api?.setSetting?.(PLAYBACK_STORAGE_SETTING, playbackStorageMode)
    await window.api?.setSetting?.(STREAM_CACHE_SETTING, streamCacheLimit)
    setModeMessage('Playback and storage mode saved.')
    setTimeout(() => setModeMessage(''), 2500)
  }

  return (
    <>
      {/* Download Location */}
      <SettingsSection
        icon={<FolderPlus className="w-5 h-5" />}
        title="Download Location"
        description="Choose where downloaded tracks, albums, and playlist files are saved on your device."
      >
        <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-text">Target Folder</span>
                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text font-mono">
                  <HardDrive className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="truncate">
                    {downloadLocation || 'Default (~/Music/Felo)'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-0 md:pt-5">
                <button
                  type="button"
                  onClick={handleSelectDownloadLocation}
                  className="rounded-full bg-surface-elevated border border-border px-3.5 py-2 text-xs font-bold text-text hover:border-white/40 transition-colors"
                >
                  Change Folder
                </button>
                {downloadLocation && (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenDownloadLocation}
                      className="rounded-full bg-surface-elevated border border-border px-3 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                      title="Open folder in File Explorer"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDownloadLocation}
                      className="rounded-full border border-danger/30 bg-surface-elevated px-3 py-2 text-xs font-bold text-danger hover:bg-danger/20 transition-colors"
                      title="Reset to default directory"
                    >
                      Reset
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="text-[11px] text-text-muted">
              Downloaded audio from Qobuz, Deezer, Soulseek, and YouTube will be saved into this directory and indexed into your local library.
            </p>
            {locationMessage && (
              <div className="mt-1 text-xs font-medium text-text-muted">
                {locationMessage}
              </div>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Playback & Storage Mode */}
      <SettingsSection
        icon={<Radio className="w-5 h-5" />}
        title="Playback & Storage Mode"
        description="Choose whether resolved tracks should be cached temporarily for playback or saved permanently to your library."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setPlaybackStorageMode('stream')}
            className={`rounded-lg border p-4 text-left transition-colors ${
              playbackStorageMode === 'stream'
                ? 'border-white/30 bg-white/10'
                : 'border-border/60 bg-surface-elevated/50 hover:bg-hover'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-bold text-text">
                Stream Mode
              </div>
              {playbackStorageMode === 'stream' && (
                <span className="text-xs font-medium text-text-muted">
                  (Default)
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Download resolved tracks to a temporary cache using the top-priority source, play them
              automatically, and remove older cached files to preserve disk space.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setPlaybackStorageMode('download')}
            className={`rounded-lg border p-4 text-left transition-colors ${
              playbackStorageMode === 'download'
                ? 'border-white/30 bg-white/10'
                : 'border-border/60 bg-surface-elevated/50 hover:bg-hover'
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-text">
              Download Mode
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              Save resolved tracks permanently into your authorized local library folder. Files
              are not auto-deleted.
            </p>
          </button>
        </div>

        {playbackStorageMode === 'stream' && (
          <div className="mt-5 rounded-lg border border-border/40 bg-canvas/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-bold text-text">Stream Cache Retention</div>
                <p className="mt-1 text-xs text-text-muted">
                  Number of recent cached playback tracks to keep before older files are removed.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={streamCacheLimit}
                  onChange={(event) => setStreamCacheLimit(Number(event.target.value))}
                  className="w-36 accent-white"
                />
                <span className="w-16 text-sm font-bold text-text">
                  {streamCacheLimit} songs
                </span>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-3 text-xs text-text-muted">
              <span>
                Currently cached: <strong className="text-text">0</strong> temporary tracks
              </span>
              <button
                type="button"
                className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors"
              >
                Clear Stream Cache
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={savePlaybackStorageMode}
            className="rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
          >
            Save Mode
          </button>
          {modeMessage && <span className="text-xs font-medium text-text-muted">{modeMessage}</span>}
        </div>
      </SettingsSection>
    </>
  )
}
