import { useEffect, useState } from 'react'
import {
  FolderPlus,
  Trash2,
  RefreshCw,
  HardDrive,
  Volume2,
  ShieldCheck,
  Info,
  Palette,
  Keyboard,
  Bell,
  MessageSquare,
  Layers,
  Radio,
  Download,
  Headphones,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  X,
  Plug,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Wrench,
  Cpu
} from 'lucide-react'
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

interface LibraryRoot {
  id: string
  path: string
  label?: string
  dateAdded: number
}

interface StreamingAccounts {
  qobuzAuthMethod: 'token' | 'password'
  qobuzUser: string
  qobuzSecret: string
  qobuzAppId: string
  qobuzAppSecret: string
  qobuzQuality: string
  deezerArl: string
  deezerQuality: string
  soulseekUser?: string
  soulseekPassword?: string
}

interface ProviderTestStatus {
  loading: boolean
  success?: boolean
  message?: string
  rawError?: string
}

// Reusable toggle switch
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${enabled ? 'bg-primary-amber' : 'bg-border'}`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5.5' : 'translate-x-1'}`}
      />
    </button>
  )
}

// Reusable setting row
function SettingRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/10 last:border-b-0">
      <div className="flex-1 pr-4">
        <span className="text-sm font-semibold text-text">{label}</span>
        {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Section card wrapper
function SettingsSection({
  icon,
  iconColor,
  title,
  description,
  children
}: {
  icon: React.ReactNode
  iconColor: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-canvas/40 border border-border/10 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconColor}`}>{icon}</div>
        <div>
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
      </div>
      <div className="pt-2">{children}</div>
    </section>
  )
}

export default function Settings() {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [version, setVersion] = useState('1.0.0')

  // Playback settings
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false)
  const [crossfadeDuration, setCrossfadeDuration] = useState(5)
  const [gaplessEnabled, setGaplessEnabled] = useState(true)
  const [automixEnabled, setAutomixEnabled] = useState(false)
  const [normalizeVolume, setNormalizeVolume] = useState(false)

  // Discord & Media
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false)
  const [mediaSessionEnabled, setMediaSessionEnabled] = useState(true)
  const [showSongInDiscord, setShowSongInDiscord] = useState(true)

  // Appearance
  const [reducedMotion, setReducedMotion] = useState(false)
  const [compactMode, setCompactMode] = useState(false)

  // Privacy
  const [listenHistoryEnabled, setListenHistoryEnabled] = useState(true)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)

  // Notifications
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [nowPlayingNotif, setNowPlayingNotif] = useState(true)

  // Download & streaming source settings
  const [downloadPriority, setDownloadPriority] =
    useState<DownloadSourceId[]>(DEFAULT_DOWNLOAD_PRIORITY)
  const [priorityMessage, setPriorityMessage] = useState('')
  const [playbackStorageMode, setPlaybackStorageMode] = useState<PlaybackStorageMode>('stream')
  const [streamCacheLimit, setStreamCacheLimit] = useState(3)
  const [modeMessage, setModeMessage] = useState('')
  const [downloadLocation, setDownloadLocation] = useState('')
  const [locationMessage, setLocationMessage] = useState('')
  const [lastFmApiKey, setLastFmApiKey] = useState('')
  const [showLastFmApiKey, setShowLastFmApiKey] = useState(false)
  const [lastFmMessage, setLastFmMessage] = useState('')
  const [showQobuzSecret, setShowQobuzSecret] = useState(false)
  const [showDeezerArl, setShowDeezerArl] = useState(false)
  const [accountMessage, setAccountMessage] = useState('')
  const [qobuzTestStatus, setQobuzTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })
  const [deezerTestStatus, setDeezerTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })
  const [showSoulseekPassword, setShowSoulseekPassword] = useState(false)
  const [soulseekTestStatus, setSoulseekTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })
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

  // Dependencies management state
  const [depStatus, setDepStatus] = useState<{
    ytDlp: { available: boolean; command?: string }
    ffmpeg: { available: boolean; path?: string }
  } | null>(null)
  const [checkingDeps, setCheckingDeps] = useState(false)
  const [installingDeps, setInstallingDeps] = useState(false)
  const [installLog, setInstallLog] = useState('')
  const [installMessage, setInstallMessage] = useState('')
  const [showLogDrawer, setShowLogDrawer] = useState(false)

  const checkDeps = async () => {
    setCheckingDeps(true)
    try {
      if (window.api?.checkDownloaderDependencies) {
        const res = await window.api.checkDownloaderDependencies()
        setDepStatus(res)
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err)
    } finally {
      setCheckingDeps(false)
    }
  }

  const handleInstallDeps = async () => {
    setInstallingDeps(true)
    setInstallLog('')
    setInstallMessage('Starting installation of yt-dlp and FFmpeg...')
    setShowLogDrawer(true)

    const unsubscribe = window.api?.onDownloaderInstallLog?.((chunk) => {
      setInstallLog((prev) => prev + chunk)
    })

    try {
      const res = await window.api?.installDownloaderDependencies?.()
      if (res?.success) {
        setInstallMessage('Dependencies installed successfully!')
      } else {
        setInstallMessage(res?.message || 'Installation completed with warnings.')
      }
      await checkDeps()
    } catch (err: any) {
      setInstallMessage(`Installation failed: ${err?.message || err}`)
    } finally {
      unsubscribe?.()
      setInstallingDeps(false)
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
      const savedPriority = await window.api?.getSetting?.(DOWNLOAD_PRIORITY_SETTING)
      const savedMode = await window.api?.getSetting?.(PLAYBACK_STORAGE_SETTING)
      const savedCacheLimit = await window.api?.getSetting?.(STREAM_CACHE_SETTING)
      const savedAccounts = await window.api?.getSetting?.(STREAMING_ACCOUNTS_SETTING)
      const savedLocation = await window.api?.getSetting?.(DOWNLOAD_LOCATION_SETTING)
      const savedLastFmApiKey = await window.api?.getSetting?.(LASTFM_API_KEY_SETTING)

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
      if (typeof savedLastFmApiKey === 'string') {
        setLastFmApiKey(savedLastFmApiKey)
      }
    } catch (err) {
      console.error('Failed to load download settings:', err)
    }
  }

  useEffect(() => {
    loadRoots()
    loadAppInfo()
    loadDownloadSettings()
    checkDeps()
  }, [])

  const handleAddFolder = async () => {
    try {
      if (!window.api) return
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        setIsScanning(true)
        setScanMessage(`Scanning ${folderPath}...`)
        const count = await window.api.scanLibrary(folderPath)
        setScanMessage(`Done! Indexed ${count} songs.`)
        setIsScanning(false)
        await loadRoots()
        setTimeout(() => setScanMessage(''), 4000)
      }
    } catch (err) {
      console.error('Error adding folder:', err)
      setIsScanning(false)
    }
  }

  const handleRemoveRoot = async (rootId: string) => {
    if (confirm('Remove this folder from your library? (Your music files will NOT be deleted).')) {
      try {
        await window.api.removeLibraryRoot(rootId)
        await loadRoots()
      } catch (err) {
        console.error('Failed to remove root:', err)
      }
    }
  }

  const handleRescanRoot = async (rootPath: string) => {
    try {
      setIsScanning(true)
      setScanMessage(`Rescanning ${rootPath}...`)
      const count = await window.api.scanLibrary(rootPath)
      setScanMessage(`Rescan complete. Found ${count} songs.`)
      setIsScanning(false)
      setTimeout(() => setScanMessage(''), 4000)
    } catch (err) {
      console.error('Rescan failed:', err)
      setIsScanning(false)
    }
  }

  const movePriority = (index: number, direction: 'up' | 'down') => {
    setDownloadPriority((current) => {
      const next = [...current]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const savePriorityOrder = async () => {
    await window.api?.setSetting?.(DOWNLOAD_PRIORITY_SETTING, downloadPriority)
    setPriorityMessage('Priority order saved.')
    setTimeout(() => setPriorityMessage(''), 2500)
  }

  const savePlaybackStorageMode = async () => {
    await window.api?.setSetting?.(PLAYBACK_STORAGE_SETTING, playbackStorageMode)
    await window.api?.setSetting?.(STREAM_CACHE_SETTING, streamCacheLimit)
    setModeMessage('Playback and storage mode saved.')
    setTimeout(() => setModeMessage(''), 2500)
  }

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

  const updateAccount = <K extends keyof StreamingAccounts>(
    key: K,
    value: StreamingAccounts[K]
  ) => {
    setAccounts((current) => ({ ...current, [key]: value }))
  }

  const saveStreamingAccounts = async () => {
    await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
    setAccountMessage('Streaming account settings saved locally.')
    setTimeout(() => setAccountMessage(''), 3000)
  }

  const handleTestQobuz = async () => {
    setQobuzTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testQobuzAccount?.(accounts)
      setQobuzTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected successfully!' : 'Connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setQobuzTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Qobuz test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  const handleTestDeezer = async () => {
    setDeezerTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testDeezerAccount?.(accounts)
      setDeezerTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected successfully!' : 'Connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setDeezerTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Deezer test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  const handleTestSoulseek = async () => {
    setSoulseekTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testSoulseekAccount?.(accounts)
      setSoulseekTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected to Soulseek!' : 'Soulseek connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setSoulseekTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Soulseek test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  return (
    <div className="h-full overflow-y-auto select-none">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-8 pt-6 pb-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text tracking-tight mb-2">Settings</h1>
          <p className="text-sm text-text-muted">
            Configure your library sources, audio playback, appearance, and integrations.
          </p>
        </div>

        <div className="space-y-6 pb-12">
          {/* Library Sources */}
          <SettingsSection
            icon={<HardDrive className="w-5 h-5" />}
            iconColor="bg-indigo-500/10 text-indigo-400"
            title="Library Sources"
            description="Felo only indexes and plays files from folders you explicitly authorize."
          >
            <div className="flex items-center justify-end mb-4">
              <button
                onClick={handleAddFolder}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 bg-text text-canvas rounded-full text-xs font-bold hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
              >
                <FolderPlus className="w-4 h-4" />
                Add Music Folder
              </button>
            </div>

            {scanMessage && (
              <div className="p-3 bg-primary-amber/10 border border-primary-amber/20 rounded-lg text-xs font-medium text-primary-amber flex items-center gap-2 mb-4">
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                {scanMessage}
              </div>
            )}

            <div className="divide-y divide-border/10">
              {roots.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">
                  No library folders added yet. Click "Add Music Folder" above to get started.
                </div>
              ) : (
                roots.map((root) => (
                  <div key={root.id} className="py-3 flex items-center justify-between gap-4 group">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-text truncate">{root.path}</span>
                      <span className="text-[11px] text-text-muted">
                        Added {new Date(root.dateAdded * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRescanRoot(root.path)}
                        title="Rescan this folder"
                        className="p-2 hover:bg-hover rounded-lg text-text-muted hover:text-text transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveRoot(root.id)}
                        title="Remove folder"
                        className="p-2 hover:bg-red-500/20 rounded-lg text-text-muted hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SettingsSection>

          {/* Playback & Audio */}
          <SettingsSection
            icon={<Volume2 className="w-5 h-5" />}
            iconColor="bg-emerald-500/10 text-emerald-400"
            title="Playback & Audio"
            description="Audio engine configuration and playback behavior."
          >
            <SettingRow
              label="Gapless Playback"
              hint="Seamlessly transitions between tracks without silence gaps."
            >
              <Toggle enabled={gaplessEnabled} onChange={setGaplessEnabled} />
            </SettingRow>
            <SettingRow label="Crossfade" hint="Smoothly fade between tracks during playback.">
              <div className="flex items-center gap-3">
                {crossfadeEnabled && (
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={crossfadeDuration}
                      onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                      className="w-20 accent-primary-amber"
                    />
                    <span className="text-xs text-text-muted w-6">{crossfadeDuration}s</span>
                  </div>
                )}
                <Toggle enabled={crossfadeEnabled} onChange={setCrossfadeEnabled} />
              </div>
            </SettingRow>
            <SettingRow
              label="Automix"
              hint="Automatically queue similar tracks when your queue ends."
            >
              <Toggle enabled={automixEnabled} onChange={setAutomixEnabled} />
            </SettingRow>
            <SettingRow
              label="Normalize Volume"
              hint="Keep consistent volume levels across tracks (ReplayGain)."
            >
              <Toggle enabled={normalizeVolume} onChange={setNormalizeVolume} />
            </SettingRow>

            <div className="mt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between py-2 border-t border-border/10">
                <div>
                  <span className="font-semibold text-text">Local Media Protocol</span>
                  <p className="text-text-muted">
                    Streams local audio securely through custom sandboxed media pipeline.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-primary-amber/10 text-primary-amber font-mono text-[11px]">
                  Active (media://)
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <span className="font-semibold text-text">Supported Formats</span>
                  <p className="text-text-muted">MP3, FLAC, M4A, AAC, WAV, OGG, OPUS, WMA</p>
                </div>
                <span className="text-text-muted font-mono text-[11px]">8 Codecs</span>
              </div>
            </div>
          </SettingsSection>

          {/* Download Priority */}
          <SettingsSection
            icon={<Layers className="w-5 h-5" />}
            iconColor="bg-success/10 text-success"
            title="Bulk Download Priority & Fallback"
            description="Choose the order Felo should try authorized sources when resolving queued downloads."
          >
            <div className="flex items-center justify-end mb-4">
              <button
                type="button"
                onClick={savePriorityOrder}
                className="rounded-md bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90"
              >
                Save Priority Order
              </button>
            </div>

            {priorityMessage && (
              <div className="mb-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success">
                {priorityMessage}
              </div>
            )}

            <div className="space-y-3">
              {downloadPriority.map((sourceId, index) => {
                const source = DOWNLOAD_SOURCES.find((item) => item.id === sourceId)
                if (!source) return null
                return (
                  <div
                    key={source.id}
                    className="flex items-center gap-4 rounded-lg border border-border/50 bg-surface-elevated/70 p-4"
                  >
                    <div className="w-[90px] rounded-md border border-border bg-canvas px-3 py-2 text-center">
                      <div className="text-sm font-extrabold text-text">Tier {index + 1}</div>
                      {index === 0 && (
                        <div className="mt-1 text-[9px] font-bold uppercase text-success">
                          Top Priority
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-text">{source.name}</span>
                        <span className="rounded bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                          {source.quality}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">{source.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => movePriority(index, 'up')}
                        disabled={index === 0}
                        className="h-8 w-8 rounded-md border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePriority(index, 'down')}
                        disabled={index === downloadPriority.length - 1}
                        className="h-8 w-8 rounded-md border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDownloadPriority((current) =>
                            current.length > 1 ? current.filter((id) => id !== source.id) : current
                          )
                        }
                        className="h-8 w-8 rounded-md border border-danger/40 bg-danger/10 flex items-center justify-center text-danger hover:bg-danger/20"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {DOWNLOAD_SOURCES.some((source) => !downloadPriority.includes(source.id)) && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted">Add source:</span>
                {DOWNLOAD_SOURCES.filter((source) => !downloadPriority.includes(source.id)).map(
                  (source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => setDownloadPriority((current) => [...current, source.id])}
                      className="rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text-muted hover:text-text"
                    >
                      + {source.name}
                    </button>
                  )
                )}
              </div>
            )}
          </SettingsSection>

          {/* Playback & Storage Mode */}
          <SettingsSection
            icon={<Radio className="w-5 h-5" />}
            iconColor="bg-success/10 text-success"
            title="Playback & Storage Mode"
            description="Choose whether resolved tracks should be cached temporarily for playback or saved permanently to your library."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setPlaybackStorageMode('stream')}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  playbackStorageMode === 'stream'
                    ? 'border-success bg-success/10'
                    : 'border-border/60 bg-surface-elevated/50 hover:bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-bold text-text">
                    <Radio className="h-4 w-4 text-success" />
                    Stream Mode
                  </div>
                  {playbackStorageMode === 'stream' && (
                    <span className="rounded-full bg-success px-2 py-0.5 text-[10px] font-bold text-canvas">
                      Default
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
                    ? 'border-secondary-cyan bg-secondary-cyan/10'
                    : 'border-border/60 bg-surface-elevated/50 hover:bg-hover'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-text">
                  <Download className="h-4 w-4 text-secondary-cyan" />
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
                      className="w-36 accent-success"
                    />
                    <span className="w-16 text-sm font-bold text-success">
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
                    className="rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 font-bold text-danger"
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
                className="rounded-md bg-text px-4 py-2 text-xs font-bold text-canvas"
              >
                Save Mode
              </button>
              {modeMessage && <span className="text-xs font-bold text-success">{modeMessage}</span>}
            </div>
          </SettingsSection>

          {/* Download Location */}
          <SettingsSection
            icon={<FolderPlus className="w-5 h-5" />}
            iconColor="bg-primary-amber/10 text-primary-amber"
            title="Download Location"
            description="Choose where downloaded tracks, albums, and playlist files are saved on your device."
          >
            <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-text">Target Folder</span>
                    <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text font-mono">
                      <HardDrive className="h-4 w-4 shrink-0 text-primary-amber" />
                      <span className="truncate">
                        {downloadLocation || 'Default (~/Music/Felo)'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-0 md:pt-5">
                    <button
                      type="button"
                      onClick={handleSelectDownloadLocation}
                      className="rounded-md bg-hover border border-border px-3.5 py-2 text-xs font-bold text-text hover:border-primary-amber/50 transition-colors"
                    >
                      Change Folder
                    </button>
                    {downloadLocation && (
                      <>
                        <button
                          type="button"
                          onClick={handleOpenDownloadLocation}
                          className="rounded-md bg-surface-elevated border border-border px-3 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                          title="Open folder in File Explorer"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={handleResetDownloadLocation}
                          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-bold text-danger hover:bg-danger/20 transition-colors"
                          title="Reset to default directory"
                        >
                          Reset
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-text-muted">
                  Downloaded audio from Qobuz, Deezer, and other connectors will be stored in this directory.
                </p>
                {locationMessage && (
                  <div className="mt-1 text-xs font-bold text-success">
                    {locationMessage}
                  </div>
                )}
              </div>
            </div>
          </SettingsSection>

          {/* Last.fm Search */}
          <SettingsSection
            icon={<Radio className="w-5 h-5" />}
            iconColor="bg-pink-500/10 text-pink-400"
            title="Last.fm Search"
            description="Use Last.fm metadata to search artists, albums, and songs globally. A free API key is required for API search."
          >
            <div className="space-y-2">
              <p className="text-xs text-text-muted">
                Create a free key at{' '}
                <a
                  href="https://www.last.fm/api/account/create"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-amber hover:underline"
                >
                  last.fm/api/account/create
                </a>{' '}
                and paste it below. This enables global Last.fm search; it does not provide audio downloads.
              </p>
              <label className="space-y-1.5 block">
                <span className="text-xs font-bold text-text">API Key</span>
                <div className="relative">
                  <input
                    type={showLastFmApiKey ? 'text' : 'password'}
                    value={lastFmApiKey}
                    onChange={(event) => setLastFmApiKey(event.target.value.trim())}
                    placeholder="Paste your Last.fm API key"
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 pr-10 text-sm text-text outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLastFmApiKey((visible) => !visible)}
                    title={showLastFmApiKey ? 'Hide Last.fm API key' : 'Show Last.fm API key'}
                    aria-label={showLastFmApiKey ? 'Hide Last.fm API key' : 'Show Last.fm API key'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-hover hover:text-text"
                  >
                    {showLastFmApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    await window.api?.setSetting?.(LASTFM_API_KEY_SETTING, lastFmApiKey)
                    setLastFmMessage('Last.fm API key saved locally.')
                    setTimeout(() => setLastFmMessage(''), 3000)
                  }}
                  className="rounded-md bg-text px-3 py-2 text-xs font-bold text-canvas hover:opacity-90"
                >
                  Save Last.fm Key
                </button>
                <span className="text-[11px] text-text-muted">Get a free key at last.fm/api</span>
              </div>
              {lastFmMessage && (
                <p className="text-xs font-bold text-success">{lastFmMessage}</p>
              )}
            </div>
          </SettingsSection>

          {/* Streaming Accounts */}
          <SettingsSection
            icon={<Headphones className="w-5 h-5" />}
            iconColor="bg-secondary-cyan/10 text-secondary-cyan"
            title="Streaming Accounts & Downloader Engine"
            description="Manage background audio download engines (yt-dlp, ffmpeg) and account connectors."
          >
            <div className="space-y-5">
              {/* Downloader Engine Status Card */}
              <div className="rounded-lg border border-border/40 bg-surface-elevated/30 p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-base font-bold text-text">
                      <Cpu className="h-4 w-4 text-secondary-cyan" />
                      Optional YouTube Engine (yt-dlp & FFmpeg)
                    </h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      Qobuz, Deezer, and Soulseek are handled natively in pure TypeScript. yt-dlp & FFmpeg are optional for YouTube audio ripping.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={checkDeps}
                      disabled={checkingDeps || installingDeps}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-hover px-3 py-1.5 text-xs font-semibold text-text hover:border-text-muted transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${checkingDeps ? 'animate-spin' : ''}`} />
                      Check
                    </button>
                    <button
                      type="button"
                      onClick={handleInstallDeps}
                      disabled={installingDeps}
                      className="flex items-center gap-1.5 rounded-md bg-secondary-cyan/20 border border-secondary-cyan/40 px-3.5 py-1.5 text-xs font-bold text-secondary-cyan hover:bg-secondary-cyan/30 transition-colors disabled:opacity-50"
                    >
                      <Wrench className={`h-3.5 w-3.5 ${installingDeps ? 'animate-spin' : ''}`} />
                      {installingDeps ? 'Installing...' : 'Install / Repair yt-dlp & FFmpeg'}
                    </button>
                  </div>
                </div>

                {/* Status Pills */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-md border border-border/30 bg-canvas/60 p-2.5">
                    <div className="text-[11px] text-text-muted font-medium">yt-dlp</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {depStatus?.ytDlp?.available ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-xs font-semibold text-success">Ready</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                          <span className="text-xs font-semibold text-warning">Optional</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-border/30 bg-canvas/60 p-2.5">
                    <div className="text-[11px] text-text-muted font-medium">FFmpeg</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {depStatus?.ffmpeg?.available ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-xs font-semibold text-success">Ready</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                          <span className="text-xs font-semibold text-warning">Optional</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Installation status / logs */}
                {installMessage && (
                  <div className="mt-3 text-xs font-semibold text-text flex items-center justify-between">
                    <span>{installMessage}</span>
                    {installLog && (
                      <button
                        type="button"
                        onClick={() => setShowLogDrawer((s) => !s)}
                        className="text-[11px] text-secondary-cyan hover:underline"
                      >
                        {showLogDrawer ? 'Hide Logs' : 'View Logs'}
                      </button>
                    )}
                  </div>
                )}

                {showLogDrawer && installLog && (
                  <pre className="mt-2.5 max-h-44 overflow-auto rounded bg-black/60 p-3 font-mono text-[10px] text-text-muted whitespace-pre-wrap select-text border border-border/20">
                    {installLog}
                  </pre>
                )}
              </div>

              <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-text">
                    <span className="h-2.5 w-2.5 rounded-full bg-secondary-cyan" />
                    Qobuz Hi-Res Configuration
                  </h3>
                  <span className="text-[11px] text-text-muted">Hi-Res FLAC up to 24-bit/192kHz</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Authentication Method</span>
                    <select
                      value={accounts.qobuzAuthMethod}
                      onChange={(event) =>
                        updateAccount('qobuzAuthMethod', event.target.value as 'token' | 'password')
                      }
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                    >
                      <option value="token">User Auth Token (Recommended)</option>
                      <option value="password">Email & Password</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">
                      {accounts.qobuzAuthMethod === 'token' ? 'User ID (or Email)' : 'Email'}
                    </span>
                    <input
                      placeholder={accounts.qobuzAuthMethod === 'token' ? 'e.g. 2759740' : 'user@example.com'}
                      value={accounts.qobuzUser}
                      onChange={(event) => updateAccount('qobuzUser', event.target.value.trim())}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="flex items-center justify-between text-xs font-bold text-text">
                      {accounts.qobuzAuthMethod === 'token' ? 'User Auth Token' : 'Password'}
                      <button
                        type="button"
                        onClick={() => setShowQobuzSecret((show) => !show)}
                        className="text-[11px] text-secondary-cyan"
                      >
                        {showQobuzSecret ? 'Hide' : 'Show'}
                      </button>
                    </span>
                    <input
                      type={showQobuzSecret ? 'text' : 'password'}
                      placeholder={
                        accounts.qobuzAuthMethod === 'token'
                          ? 'Paste user_auth_token'
                          : 'Enter Qobuz password'
                      }
                      value={accounts.qobuzSecret}
                      onChange={(event) =>
                        updateAccount(
                          'qobuzSecret',
                          accounts.qobuzAuthMethod === 'token'
                            ? event.target.value.replace(/\s+/g, '')
                            : event.target.value
                        )
                      }
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Download Quality</span>
                    <select
                      value={accounts.qobuzQuality}
                      onChange={(event) => updateAccount('qobuzQuality', event.target.value)}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                    >
                      <option value="mp3-320">320 kbps MP3</option>
                      <option value="cd">CD Quality (16-bit / 44.1 kHz FLAC)</option>
                      <option value="hires">Hi-Res (24-bit / up to 96 kHz FLAC)</option>
                      <option value="hires-max">Hi-Res Max (24-bit / up to 192 kHz FLAC)</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">
                      App ID <span className="font-normal text-text-muted">(Optional - auto-detected)</span>
                    </span>
                    <input
                      placeholder="Leave blank to auto-detect"
                      value={accounts.qobuzAppId}
                      onChange={(event) => updateAccount('qobuzAppId', event.target.value.trim())}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">
                      App Secret <span className="font-normal text-text-muted">(Optional - auto-detected)</span>
                    </span>
                    <input
                      placeholder="Leave blank to auto-detect"
                      value={accounts.qobuzAppSecret}
                      onChange={(event) => updateAccount('qobuzAppSecret', event.target.value.trim())}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                </div>

                <div className="mt-3 rounded-md bg-surface-elevated/40 border border-border/30 p-2.5 text-[11px] text-text-muted">
                  <strong>How to get Qobuz Auth Token:</strong> Log in to <span className="text-secondary-cyan font-mono">play.qobuz.com</span> in your browser. Open DevTools (F12) → Application → Local Storage (or Cookies) and copy your <span className="text-text font-mono">user_auth_token</span> and <span className="text-text font-mono">user_id</span>. An active Qobuz subscription or trial is required.
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleTestQobuz}
                    disabled={qobuzTestStatus.loading}
                    className="flex items-center gap-2 rounded-md border border-border bg-hover px-4 py-2 text-xs font-bold text-text disabled:opacity-60 hover:border-secondary-cyan/50 transition-colors"
                  >
                    <Plug className={`h-4 w-4 ${qobuzTestStatus.loading ? 'animate-pulse' : ''}`} />
                    {qobuzTestStatus.loading ? 'Testing Qobuz...' : 'Test Qobuz Account'}
                  </button>
                </div>
                {qobuzTestStatus.message && (
                  <div
                    className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                      qobuzTestStatus.success
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger'
                    }`}
                  >
                    <div>{qobuzTestStatus.message}</div>
                    {qobuzTestStatus.rawError && !qobuzTestStatus.success && (
                      <details className="mt-2 text-[11px] text-text-muted">
                        <summary className="cursor-pointer hover:underline text-text-muted">
                          View details
                        </summary>
                        <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                          {qobuzTestStatus.rawError}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-lg font-bold text-text">
                    <Headphones className="h-5 w-5 text-purple-400" />
                    Deezer Lossless Configuration
                  </h3>
                  <span className="text-[11px] text-text-muted">FLAC 16-bit / 44.1kHz & MP3</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="flex items-center justify-between text-xs font-bold text-text">
                      Deezer ARL Cookie Token
                      <button
                        type="button"
                        onClick={() => setShowDeezerArl((show) => !show)}
                        className="text-[11px] text-purple-400"
                      >
                        {showDeezerArl ? 'Hide' : 'Show'}
                      </button>
                    </span>
                    <input
                      type={showDeezerArl ? 'text' : 'password'}
                      placeholder="Paste your 192-character ARL cookie value"
                      value={accounts.deezerArl}
                      onChange={(event) => updateAccount('deezerArl', event.target.value.replace(/\s+/g, ''))}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                    <span className="text-[11px] text-text-muted">
                      Paste the token for an authorized Deezer connector.
                    </span>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Deezer Quality</span>
                    <select
                      value={accounts.deezerQuality}
                      onChange={(event) => updateAccount('deezerQuality', event.target.value)}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                    >
                      <option value="mp3-128">128 kbps MP3</option>
                      <option value="mp3-320">320 kbps MP3</option>
                      <option value="lossless">Lossless (16-bit / 44.1 kHz FLAC)</option>
                    </select>
                  </label>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={handleTestDeezer}
                      disabled={deezerTestStatus.loading}
                      className="flex items-center gap-2 rounded-md border border-border bg-hover px-4 py-2 text-xs font-bold text-text disabled:opacity-60 hover:border-purple-400/50 transition-colors"
                    >
                      <Plug
                        className={`h-4 w-4 ${deezerTestStatus.loading ? 'animate-pulse' : ''}`}
                      />
                      {deezerTestStatus.loading ? 'Testing Deezer...' : 'Test Deezer ARL'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-surface-elevated/40 border border-border/30 p-2.5 text-[11px] text-text-muted">
                  <strong>How to get Deezer ARL:</strong> Open <span className="text-purple-400 font-mono">deezer.com</span> in your browser and log in. Open DevTools (F12) → Application / Storage → Cookies → <span className="text-text font-mono">https://www.deezer.com</span> → find and copy the <span className="text-text font-mono">arl</span> cookie value. (ARL tokens expire after ~3 months).
                </div>

                {deezerTestStatus.message && (
                  <div
                    className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                      deezerTestStatus.success
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger'
                    }`}
                  >
                    <div>{deezerTestStatus.message}</div>
                    {deezerTestStatus.rawError && !deezerTestStatus.success && (
                      <details className="mt-2 text-[11px] text-text-muted">
                        <summary className="cursor-pointer hover:underline text-text-muted">
                          View details
                        </summary>
                        <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                          {deezerTestStatus.rawError}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {/* Soulseek P2P Card */}
              <div className="rounded-lg border border-sky-500/30 bg-surface-elevated/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-text">Soulseek P2P Network</h4>
                    <p className="text-xs text-text-muted">
                      Peer-to-peer lossless and MP3 music exchange network.
                    </p>
                  </div>
                  <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-400">
                    FLAC / MP3
                  </span>
                </div>

                <div className="mb-4 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text">Need a Soulseek account?</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                        Create an account or download the official SoulseekQt client from Soulseek.net.
                        Then enter the same username and password above.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void window.api?.openExternal?.('https://www.slsknet.org/news/user')}
                          className="inline-flex items-center gap-1.5 rounded border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-[11px] font-bold text-sky-300 hover:bg-sky-400/20"
                        >
                          Create Soulseek account
                          <ExternalLink className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void window.api?.openExternal?.('https://www.slsknet.org/news/node/1')}
                          className="inline-flex items-center gap-1.5 rounded border border-border bg-hover px-2.5 py-1.5 text-[11px] font-bold text-text-muted hover:text-text"
                        >
                          Download SoulseekQt
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Soulseek Username</span>
                    <input
                      placeholder="Optional: use your own account"
                      value={accounts.soulseekUser || ''}
                      onChange={(event) => updateAccount('soulseekUser', event.target.value.trim())}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="flex items-center justify-between text-xs font-bold text-text">
                      <span>Password</span>
                      <button
                        type="button"
                        onClick={() => setShowSoulseekPassword((show) => !show)}
                        className="text-[11px] text-secondary-cyan"
                      >
                        {showSoulseekPassword ? 'Hide' : 'Show'}
                      </button>
                    </span>
                    <input
                      type={showSoulseekPassword ? 'text' : 'password'}
                      placeholder="Optional: use your own account password"
                      value={accounts.soulseekPassword || ''}
                      onChange={(event) => updateAccount('soulseekPassword', event.target.value)}
                      className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                    />
                  </label>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-text-muted">
                    Leave both fields blank to use a persistent automatic Soulseek account, or enter your own account.
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSoulseek}
                    disabled={soulseekTestStatus.loading}
                    className="flex items-center gap-2 rounded-md border border-border bg-hover px-4 py-2 text-xs font-bold text-text disabled:opacity-60 hover:border-sky-400/50 transition-colors shrink-0"
                  >
                    <Plug
                      className={`h-4 w-4 ${soulseekTestStatus.loading ? 'animate-pulse' : ''}`}
                    />
                    {soulseekTestStatus.loading ? 'Connecting P2P...' : 'Test Soulseek P2P'}
                  </button>
                </div>

                {soulseekTestStatus.message && (
                  <div
                    className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                      soulseekTestStatus.success
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-danger/30 bg-danger/10 text-danger'
                    }`}
                  >
                    <div>{soulseekTestStatus.message}</div>
                    {soulseekTestStatus.rawError && !soulseekTestStatus.success && (
                      <details className="mt-2 text-[11px] text-text-muted">
                        <summary className="cursor-pointer hover:underline text-text-muted">
                          View details
                        </summary>
                        <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                          {soulseekTestStatus.rawError}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>

              {/* YouTube Music Card */}
              <div className="rounded-lg border border-red-500/30 bg-surface-elevated/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-text">YouTube Music</h4>
                    <p className="text-xs text-text-muted">
                      Downloads and audio conversion powered by yt-dlp & ffmpeg. No login required.
                    </p>
                  </div>
                  <span className="rounded bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-400">
                    256k MP3 / Opus
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveStreamingAccounts}
                  className="rounded-md bg-success px-4 py-2 text-xs font-bold text-white hover:bg-success/90 transition-colors"
                >
                  Save Streaming Settings
                </button>
                {accountMessage && (
                  <span className="text-xs font-bold text-secondary-cyan">{accountMessage}</span>
                )}
              </div>
            </div>
          </SettingsSection>

          {/* Discord & Media Presence */}
          <SettingsSection
            icon={<MessageSquare className="w-5 h-5" />}
            iconColor="bg-[#5865F2]/10 text-[#5865F2]"
            title="Discord & Media Presence"
            description="Share what you're listening to with Discord Rich Presence and system media controls."
          >
            <SettingRow
              label="Discord Rich Presence"
              hint="Show currently playing track in your Discord status."
            >
              <Toggle enabled={discordRpcEnabled} onChange={setDiscordRpcEnabled} />
            </SettingRow>
            {discordRpcEnabled && (
              <SettingRow
                label="Show Song Details"
                hint="Display title, artist, album, and elapsed time."
              >
                <Toggle enabled={showSongInDiscord} onChange={setShowSongInDiscord} />
              </SettingRow>
            )}
            <SettingRow
              label="System Media Controls"
              hint="Enable media keys and OS media transport controls."
            >
              <Toggle enabled={mediaSessionEnabled} onChange={setMediaSessionEnabled} />
            </SettingRow>
          </SettingsSection>

          {/* Appearance */}
          <SettingsSection
            icon={<Palette className="w-5 h-5" />}
            iconColor="bg-pink-500/10 text-pink-400"
            title="Appearance"
            description="Customize visual presentation and accessibility."
          >
            <SettingRow
              label="Reduced Motion"
              hint="Minimizes animations for accessibility or preference."
            >
              <Toggle enabled={reducedMotion} onChange={setReducedMotion} />
            </SettingRow>
            <SettingRow label="Compact Mode" hint="Reduce spacing and show more content on screen.">
              <Toggle enabled={compactMode} onChange={setCompactMode} />
            </SettingRow>
            <SettingRow label="Theme" hint="Visual theme for the application.">
              <span className="px-2.5 py-1 rounded bg-surface-elevated border border-border text-text text-xs font-medium">
                Ink & Amber (Dark)
              </span>
            </SettingRow>
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection
            icon={<Bell className="w-5 h-5" />}
            iconColor="bg-primary-amber/10 text-primary-amber"
            title="Notifications"
            description="Control desktop notifications and alerts."
          >
            <SettingRow
              label="Desktop Notifications"
              hint="Show system notifications for events and updates."
            >
              <Toggle enabled={notificationsEnabled} onChange={setNotificationsEnabled} />
            </SettingRow>
            <SettingRow
              label="Now Playing Notification"
              hint="Show a notification when a new track starts playing."
            >
              <Toggle enabled={nowPlayingNotif} onChange={setNowPlayingNotif} />
            </SettingRow>
          </SettingsSection>

          {/* Privacy & Security */}
          <SettingsSection
            icon={<ShieldCheck className="w-5 h-5" />}
            iconColor="bg-primary-amber/10 text-primary-amber"
            title="Privacy & Security"
            description="Local-first privacy baseline and data controls."
          >
            <SettingRow
              label="Listening History"
              hint="Record play events locally for insights and recommendations."
            >
              <Toggle enabled={listenHistoryEnabled} onChange={setListenHistoryEnabled} />
            </SettingRow>
            <SettingRow
              label="Analytics & Telemetry"
              hint="Send anonymous usage data to help improve Felo."
            >
              <Toggle enabled={analyticsEnabled} onChange={setAnalyticsEnabled} />
            </SettingRow>

            <div className="mt-4 space-y-2 text-xs text-text-muted">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>100% Local-first: No songs or library metadata leave your device.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>Telemetry & Analytics disabled by default.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>P2P networks and background seeding disabled in v1.</span>
              </div>
            </div>
          </SettingsSection>

          {/* Keyboard Shortcuts */}
          <SettingsSection
            icon={<Keyboard className="w-5 h-5" />}
            iconColor="bg-cyan-500/10 text-cyan-400"
            title="Keyboard Shortcuts"
            description="Global hotkeys and in-app shortcuts."
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {[
                ['Play / Pause', 'Space'],
                ['Next Track', 'Ctrl + →'],
                ['Previous Track', 'Ctrl + ←'],
                ['Volume Up', 'Ctrl + ↑'],
                ['Volume Down', 'Ctrl + ↓'],
                ['Search', 'Ctrl + K'],
                ['Toggle Shuffle', 'Ctrl + S'],
                ['Toggle Repeat', 'Ctrl + R']
              ].map(([action, key]) => (
                <div
                  key={action}
                  className="flex items-center justify-between py-2 border-b border-border/10"
                >
                  <span className="text-text-muted">{action}</span>
                  <kbd className="px-2 py-0.5 rounded bg-surface-elevated border border-border text-text font-mono text-[10px]">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </SettingsSection>

          {/* About */}
          <SettingsSection
            icon={<Info className="w-5 h-5" />}
            iconColor="bg-blue-500/10 text-blue-400"
            title="About Felo"
            description={`Version ${version} — Desktop Music Workspace`}
          >
            <p className="text-xs text-text-muted leading-relaxed">
              Felo is an independent desktop music player and library workspace designed for
              audiophiles and music lovers with local collections.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <span className="px-3 py-1.5 rounded-full bg-surface-elevated border border-border text-xs text-text-muted">
                Electron
              </span>
              <span className="px-3 py-1.5 rounded-full bg-surface-elevated border border-border text-xs text-text-muted">
                React
              </span>
              <span className="px-3 py-1.5 rounded-full bg-surface-elevated border border-border text-xs text-text-muted">
                SQLite
              </span>
              <span className="px-3 py-1.5 rounded-full bg-surface-elevated border border-border text-xs text-text-muted">
                TypeScript
              </span>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
