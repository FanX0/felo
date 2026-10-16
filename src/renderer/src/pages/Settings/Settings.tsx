import { useEffect, useState } from 'react'
import { AppCapabilities } from '../../lib/appConfig'
import {
  DEFAULT_DOWNLOAD_PRIORITY,
  DOWNLOAD_LOCATION_SETTING,
  DOWNLOAD_PRIORITY_SETTING,
  DOWNLOAD_SOURCES,
  DownloadSourceId,
  LASTFM_API_KEY_SETTING,
  PLAYBACK_STORAGE_SETTING,
  PlaybackStorageMode,
  STREAM_CACHE_SETTING,
  STREAMING_ACCOUNTS_SETTING
} from '../../lib/downloadConfig'
import type { LibraryRoot, SettingsCategory, StreamingAccounts } from './types'
import { LibrarySection } from './sections/LibrarySection'
import { DownloadsSection } from './sections/DownloadsSection'
import { PrioritySection } from './sections/PrioritySection'
import { AudioSection } from './sections/AudioSection'
import { StreamingSection } from './sections/StreamingSection'
import { DiscordSection } from './sections/DiscordSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { NotificationsSection } from './sections/NotificationsSection'
import { PrivacySection } from './sections/PrivacySection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { AboutSection } from './sections/AboutSection'

export default function Settings() {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [version, setVersion] = useState('1.0.0')

  // Download & streaming source settings
  const [downloadPriority, setDownloadPriority] =
    useState<DownloadSourceId[]>(DEFAULT_DOWNLOAD_PRIORITY)
  const [playbackStorageMode, setPlaybackStorageMode] = useState<PlaybackStorageMode>('stream')
  const [streamCacheLimit, setStreamCacheLimit] = useState(3)
  const [downloadLocation, setDownloadLocation] = useState('')
  const [lastFmApiKey, setLastFmApiKey] = useState('')
  const [accounts, setAccounts] = useState<StreamingAccounts>({
    qobuzAuthMethod: 'token',
    qobuzUser: '',
    qobuzSecret: '',
    qobuzAppId: '',
    qobuzAppSecret: '',
    qobuzQuality: 'hires-max',
    deezerArl: '',
    deezerQuality: 'lossless',
    soulseekUser: '',
    soulseekPassword: ''
  })

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('all')

  const checkDeps = async () => {
    try {
      if (window.api?.checkDownloaderDependencies) {
        await window.api.checkDownloaderDependencies()
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err)
    }
  }

  const loadRoots = async () => {
    try {
      if (window.api?.getLibraryRoots) {
        const data = await window.api.getLibraryRoots()
        setRoots(data || [])
      }
    } catch (err) {
      console.error('Failed to load library roots:', err)
    }
  }

  const loadAppInfo = async () => {
    try {
      if (window.api?.getAppVersion) {
        const v = await window.api.getAppVersion()
        setVersion(v)
      }
    } catch (err) {
      console.error('Failed to load app version:', err)
    }
  }

  const loadDownloadSettings = async () => {
    try {
      const savedLastFmApiKey = await window.api?.getSetting?.(LASTFM_API_KEY_SETTING)
      if (typeof savedLastFmApiKey === 'string') {
        setLastFmApiKey(savedLastFmApiKey)
      }

      if (!AppCapabilities.downloads) return

      const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
      const savedMode = await window.api?.getSetting?.(PLAYBACK_STORAGE_SETTING)
      const savedCacheLimit = await window.api?.getSetting?.(STREAM_CACHE_SETTING)
      const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
      const savedLocation = await window.api?.getSetting?.(DOWNLOAD_LOCATION_SETTING)

      if (Array.isArray(savedPriority) && savedPriority.length > 0) {
        setDownloadPriority(
          savedPriority.filter((id) =>
            DOWNLOAD_SOURCES.some((source) => source.id === id)
          ) as DownloadSourceId[]
        )
      }
      if (savedMode === 'stream' || savedMode === 'download') {
        setPlaybackStorageMode(savedMode)
      }
      if (typeof savedCacheLimit === 'number') {
        setStreamCacheLimit(Math.max(1, Math.min(10, savedCacheLimit)))
      }
      if (savedAccounts && typeof savedAccounts === 'object') {
        setAccounts((current) => ({ ...current, ...savedAccounts }))
      }
      if (typeof savedLocation === 'string' && savedLocation.trim()) {
        setDownloadLocation(savedLocation.trim())
      }
    } catch (err) {
      console.error('Failed to load download settings:', err)
    }
  }

  useEffect(() => {
    void loadRoots()
    void loadAppInfo()
    void loadDownloadSettings()
    if (AppCapabilities.downloads) {
      void checkDeps()
    }

    const handleLibraryUpdate = () => {
      void loadRoots()
    }
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    return () => {
      window.removeEventListener('felo:library-updated', handleLibraryUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    }
  }, [])

  useEffect(() => {
    if (!AppCapabilities.downloads && activeCategory === 'providers') {
      setActiveCategory('all')
    }
  }, [activeCategory])

  const categories = [
    { id: 'all', label: 'All Settings' },
    { id: 'library', label: AppCapabilities.downloads ? 'Library & Downloads' : 'Library' },
    ...(AppCapabilities.downloads ? [{ id: 'providers', label: 'Download Providers' }] : []),
    { id: 'audio', label: 'Playback & Audio' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'appearance', label: 'Appearance & System' }
  ]

  return (
    <div className="h-full flex-1 overflow-y-auto select-none">
      <div className="mx-auto flex min-h-full flex-1 w-full max-w-4xl flex-col px-4 sm:px-8 pt-4 sm:pt-6 pb-36 md:pb-12">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight mb-1 sm:mb-2">Settings</h1>
          <p className="text-xs sm:text-sm text-text-muted">
            {AppCapabilities.downloads
              ? 'Configure your music library, download paths, provider priority, audio playback, and integrations.'
              : 'Configure your music library, audio playback, theme appearance, and integrations.'}
          </p>
        </div>

        {/* Category Navigation Pills */}
        <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as SettingsCategory)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                activeCategory === cat.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-[#181a1f] border border-white/[0.06] text-zinc-400 hover:bg-[#22242a] hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 pb-12">
          {/* SECTION GROUP 1: LIBRARY & DOWNLOAD DIRECTORIES */}
          {(activeCategory === 'all' || activeCategory === 'library') && (
            <>
              <LibrarySection roots={roots} loadRoots={loadRoots} />

              {AppCapabilities.downloads && (
                <DownloadsSection
                  downloadLocation={downloadLocation}
                  setDownloadLocation={setDownloadLocation}
                  playbackStorageMode={playbackStorageMode}
                  setPlaybackStorageMode={setPlaybackStorageMode}
                  streamCacheLimit={streamCacheLimit}
                  setStreamCacheLimit={setStreamCacheLimit}
                />
              )}
            </>
          )}

          {/* SECTION GROUP 2: DOWNLOAD PROVIDERS & PRIORITY */}
          {AppCapabilities.downloads && (activeCategory === 'all' || activeCategory === 'providers') && (
            <PrioritySection
              downloadPriority={downloadPriority}
              setDownloadPriority={setDownloadPriority}
            />
          )}

          {/* SECTION GROUP 3: PLAYBACK & AUDIO */}
          {(activeCategory === 'all' || activeCategory === 'audio') && (
            <AudioSection />
          )}

          {/* SECTION GROUP 4: INTEGRATIONS & PROVIDERS */}
          {(activeCategory === 'all' || activeCategory === 'providers') && (
            <StreamingSection
              lastFmApiKey={lastFmApiKey}
              setLastFmApiKey={setLastFmApiKey}
              accounts={accounts}
              setAccounts={setAccounts}
            />
          )}

          {(activeCategory === 'all' || activeCategory === 'integrations') && (
            <DiscordSection />
          )}

          {/* SECTION GROUP 5: APPEARANCE, NOTIFICATIONS & PRIVACY */}
          {(activeCategory === 'all' || activeCategory === 'appearance') && (
            <>
              <AppearanceSection />
              <NotificationsSection />
              <PrivacySection />
              <ShortcutsSection />
              <AboutSection version={version} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
