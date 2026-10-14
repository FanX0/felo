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

  Headphones,
  ChevronUp,
  ChevronDown,
  X,
  Plug,
  Eye,
  EyeOff,
  Copy,
  Key,
  Bot,
  Loader2,
  Music,
  Check,
  ExternalLink,
  ListMusic
} from 'lucide-react'
import { useLibraryScanStore } from '../../hooks/useLibraryScanStore'
import { useListeningStore } from '../../hooks/useListeningStore'
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
  songCount?: number
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
  title,
  description,
  children
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-canvas/40 border border-border/10 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-text shrink-0 flex items-center justify-center">{icon}</div>
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
  const { isScanning, progress: scanProgress, cancelScan } = useLibraryScanStore()
  const [version, setVersion] = useState('1.0.0')

  // Playback settings
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false)
  const [crossfadeDuration, setCrossfadeDuration] = useState(5)
  const [gaplessEnabled, setGaplessEnabled] = useState(true)
  const [automixEnabled, setAutomixEnabled] = useState(false)
  const [normalizeVolume, setNormalizeVolume] = useState(false)
  const [externalPlayerEnabled, setExternalPlayerEnabled] = useState(false)
  const [externalPlayerMessage, setExternalPlayerMessage] = useState('')
  const [externalPlayerApiKey, setExternalPlayerApiKey] = useState('')
  const [externalPlayerClientConfigs, setExternalPlayerClientConfigs] = useState<{
    apiKey: string
    port: number
    running: boolean
    hermes: string
    claudeDesktop: string
    cursor: string
    windsurf: string
  } | null>(null)
  const [selectedMcpTab, setSelectedMcpTab] = useState<'claude' | 'hermes' | 'cursor'>('claude')
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // Discord & Media
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false)
  const [mediaSessionEnabled, setMediaSessionEnabled] = useState(true)
  const [showSongInDiscord, setShowSongInDiscord] = useState(true)
  const [presenceStatus, setPresenceStatus] = useState<{
    installed: boolean
    running: boolean
    configured: boolean
    executablePath: string | null
  } | null>(null)
  const [presenceSettingUp, setPresenceSettingUp] = useState(false)
  const [presenceSetupMsg, setPresenceSetupMsg] = useState<string | null>(null)

  // Discord Bot & Webhook Controller
  const [discordBotEnabled, setDiscordBotEnabled] = useState(false)
  const [discordBotConnected, setDiscordBotConnected] = useState(false)
  const [discordBotToken, setDiscordBotToken] = useState('')
  const [showDiscordBotToken, setShowDiscordBotToken] = useState(false)
  const [discordBotPrefix, setDiscordBotPrefix] = useState('!')
  const [discordBotChannel, setDiscordBotChannel] = useState('')
  const [discordBotUser, setDiscordBotUser] = useState<{ id?: string; username: string; tag?: string } | null>(null)
  const [discordBotError, setDiscordBotError] = useState<string | null>(null)
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('')
  const [discordWebhookEnabled, setDiscordWebhookEnabled] = useState(false)
  const [discordTestStatus, setDiscordTestStatus] = useState<{ loading: boolean; message?: string; success?: boolean }>({ loading: false })
  const [discordMessage, setDiscordMessage] = useState('')
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const [copiedRoomCode, setCopiedRoomCode] = useState(false)

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

    const handleLibraryUpdate = () => loadRoots()
    window.addEventListener('felo:library-updated', handleLibraryUpdate)
    window.addEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    return () => {
      window.removeEventListener('felo:library-updated', handleLibraryUpdate)
      window.removeEventListener('fanxmusic:library-updated', handleLibraryUpdate)
    }
  }, [])

  useEffect(() => {
    if (!window.api?.getExternalPlayerSettings) return
    void window.api.getExternalPlayerSettings().then((settings) => {
      setExternalPlayerEnabled(settings.enabled)
      if (settings.apiKey) setExternalPlayerApiKey(settings.apiKey)
    })
    void window.api.getExternalPlayerClientConfigs?.().then((configs) => {
      setExternalPlayerClientConfigs(configs)
    })
  }, [])

  const refreshPresenceStatus = async () => {
    try {
      const status = await window.api?.getMusicPresenceStatus?.()
      if (status) {
        setPresenceStatus(status)
        if (status.configured) {
          setDiscordRpcEnabled(true)
        }
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshPresenceStatus()
  }, [])

  const handleSetupMusicPresence = async () => {
    setPresenceSettingUp(true)
    setPresenceSetupMsg(null)
    try {
      const res = await window.api?.setupMusicPresence?.()
      if (res?.success) {
        setDiscordRpcEnabled(true)
        setPresenceSetupMsg('Discord Rich Presence linked successfully!')
        await refreshPresenceStatus()
      } else {
        setPresenceSetupMsg(res?.error || 'Failed to configure Discord integration.')
      }
    } catch (err: any) {
      setPresenceSetupMsg(err?.message || 'Error configuring Discord integration.')
    } finally {
      setPresenceSettingUp(false)
    }
  }

  const handleLaunchMusicPresence = async () => {
    try {
      const res = await window.api?.launchMusicPresence?.()
      if (res?.success) {
        setPresenceSetupMsg('Launching Music Presence...')
        setTimeout(() => refreshPresenceStatus(), 2000)
      } else if (res?.error) {
        setPresenceSetupMsg(res.error)
      }
    } catch {
      // ignore
    }
  }

  const refreshDiscordStatus = async () => {
    try {
      const status = await window.api?.getDiscordBotStatus?.()
      if (status) {
        setDiscordBotEnabled(status.enabled)
        setDiscordBotConnected(status.connected)
        setDiscordBotPrefix(status.prefix || '!')
        setDiscordBotChannel(status.channelId || '')
        setDiscordBotUser(status.botUser)
        setDiscordBotError(status.error)
        setDiscordWebhookUrl(status.webhookUrl || '')
        setDiscordWebhookEnabled(status.webhookEnabled)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshDiscordStatus()
    const timer = setInterval(() => {
      refreshDiscordStatus()
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  const handleSaveDiscordBotSettings = async (overrides?: any) => {
    try {
      setDiscordMessage('')
      const res = await window.api?.updateDiscordSettings?.({
        token: discordBotToken,
        enabled: overrides?.enabled !== undefined ? overrides.enabled : discordBotEnabled,
        prefix: overrides?.prefix !== undefined ? overrides.prefix : discordBotPrefix,
        channelId: overrides?.channelId !== undefined ? overrides.channelId : discordBotChannel,
        webhookUrl: overrides?.webhookUrl !== undefined ? overrides.webhookUrl : discordWebhookUrl,
        webhookEnabled:
          overrides?.webhookEnabled !== undefined ? overrides.webhookEnabled : discordWebhookEnabled,
        ...overrides
      })
      if (res) {
        setDiscordBotEnabled(res.enabled)
        setDiscordBotConnected(res.connected)
        setDiscordBotUser(res.botUser)
        setDiscordBotError(res.error)
      }
      setDiscordMessage('Discord settings saved.')
      setTimeout(() => setDiscordMessage(''), 3000)
    } catch (err: any) {
      setDiscordBotError(err?.message || 'Failed to update Discord settings')
    }
  }

  const handleTestDiscordWebhook = async () => {
    if (!discordWebhookUrl.trim()) return
    setDiscordTestStatus({ loading: true })
    try {
      const res = await window.api?.testDiscordWebhook?.(discordWebhookUrl.trim())
      setDiscordTestStatus({
        loading: false,
        success: res?.success,
        message: res?.message
      })
    } catch (err: any) {
      setDiscordTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Failed to send test webhook.'
      })
    }
  }

  const setExternalControl = async (enabled: boolean) => {
    try {
      const result = await window.api.setExternalPlayerEnabled(enabled)
      setExternalPlayerEnabled(result.enabled)
      setExternalPlayerMessage(
        result.enabled
          ? 'MCP playback control is active and ready for AI agents.'
          : 'MCP playback control is stopped.'
      )
      if (result.enabled && window.api.getExternalPlayerClientConfigs) {
        const configs = await window.api.getExternalPlayerClientConfigs()
        setExternalPlayerClientConfigs(configs)
        if (configs.apiKey) setExternalPlayerApiKey(configs.apiKey)
      }
    } catch (error) {
      setExternalPlayerMessage(error instanceof Error ? error.message : 'Could not change playback control.')
    }
  }

  const handleRegenerateApiKey = async () => {
    try {
      if (!window.api?.regenerateExternalPlayerApiKey) return
      const res = await window.api.regenerateExternalPlayerApiKey()
      setExternalPlayerApiKey(res.apiKey)
      const configs = await window.api.getExternalPlayerClientConfigs()
      setExternalPlayerClientConfigs(configs)
      setExternalPlayerMessage('New Personal API Key generated and saved.')
    } catch {
      setExternalPlayerMessage('Failed to regenerate API key.')
    }
  }

  const handleCopyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(externalPlayerApiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleCopyClientConfig = async (format: 'claude' | 'hermes' | 'cursor') => {
    try {
      let text = ''
      if (format === 'claude') text = externalPlayerClientConfigs?.claudeDesktop || ''
      else if (format === 'hermes') text = externalPlayerClientConfigs?.hermes || ''
      else text = externalPlayerClientConfigs?.cursor || ''

      if (!text && window.api?.copyHermesConfig) {
        text = await window.api.copyHermesConfig()
      }
      if (text) {
        await navigator.clipboard.writeText(text)
        setCopiedConfig(true)
        setTimeout(() => setCopiedConfig(false), 2000)
        const name = format === 'claude' ? 'Claude Desktop' : format === 'hermes' ? 'Hermes' : 'Cursor'
        setExternalPlayerMessage(`Configuration for ${name} copied to clipboard!`)
      }
    } catch {
      setExternalPlayerMessage('Failed to copy configuration.')
    }
  }

  const handleAddFolder = async () => {
    try {
      if (!window.api?.selectFolder) return
      const folderPath = await window.api.selectFolder()
      if (folderPath) {
        await window.api.scanLibrary(folderPath)
        await loadRoots()
      }
    } catch (err) {
      console.error('Error adding folder:', err)
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
      await window.api.scanLibrary(rootPath)
      await loadRoots()
    } catch (err) {
      console.error('Rescan failed:', err)
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

  const [activeCategory, setActiveCategory] = useState<
    'all' | 'library' | 'providers' | 'audio' | 'integrations' | 'appearance'
  >('all')

  return (
    <div className="h-full overflow-y-auto select-none">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-8 pt-6 pb-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-text tracking-tight mb-2">Settings</h1>
          <p className="text-sm text-text-muted">
            Configure your music library, download paths, provider priority, audio playback, and integrations.
          </p>
        </div>

        {/* Category Navigation Pills */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'All Settings' },
            { id: 'library', label: 'Library & Downloads' },
            { id: 'providers', label: 'Download Providers' },
            { id: 'audio', label: 'Playback & Audio' },
            { id: 'integrations', label: 'Integrations' },
            { id: 'appearance', label: 'Appearance & System' }
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as any)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                activeCategory === cat.id
                  ? 'bg-text text-canvas shadow-md'
                  : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-text'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 pb-12">
          {/* SECTION GROUP 1: LIBRARY & DOWNLOAD DIRECTORIES (Colocated for easy access) */}
          {(activeCategory === 'all' || activeCategory === 'library') && (
            <>
              {/* Library Sources */}
              <SettingsSection
                icon={<HardDrive className="w-5 h-5" />}
                title="Library Sources"
                description="Manage the music folders on your device that Felo indexes and plays."
              >
                <div className="flex items-center justify-end mb-4">
                  <button
                    onClick={handleAddFolder}
                    disabled={isScanning}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-border rounded-full text-xs font-bold hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-primary-amber" />
                        <span>Scanning {scanProgress?.percent !== undefined ? `${scanProgress.percent}%` : ''}</span>
                      </>
                    ) : (
                      <>
                        <FolderPlus className="w-4 h-4" />
                        Add Music Folder
                      </>
                    )}
                  </button>
                </div>

                {isScanning && scanProgress && (
                  <div className="mb-4 rounded-xl bg-surface border border-primary-amber/30 p-4 shadow-lg backdrop-blur-md">
                    <div className="flex items-center justify-between pb-2 border-b border-border/20">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-2 rounded-lg bg-primary-amber/15 text-primary-amber border border-primary-amber/25">
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                              {scanProgress.status === 'discovering'
                                ? 'Discovering Files...'
                                : scanProgress.status === 'committing'
                                  ? 'Saving to Database...'
                                  : 'Indexing Music Folder'}
                            </h4>
                            <span className="text-xs font-mono font-bold text-primary-amber px-2 py-0.5 rounded-full bg-primary-amber/10 border border-primary-amber/20 tabular-nums">
                              {scanProgress.percent}%
                            </span>
                          </div>
                          <p className="text-xs text-text-muted truncate mt-0.5" title={scanProgress.folderPath}>
                            {scanProgress.folderName} •{' '}
                            <span className="text-white font-medium tabular-nums">
                              {scanProgress.processedFiles} / {scanProgress.totalFiles} songs
                            </span>
                            {scanProgress.speed ? ` • ~${scanProgress.speed} songs/s` : ''}
                            {scanProgress.estimatedRemainingMs ? ` • ~${Math.round(scanProgress.estimatedRemainingMs / 1000)}s left` : ''}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => cancelScan()}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors"
                      >
                        <X className="h-3 w-3" /> Stop
                      </button>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#242424]">
                        <div
                          className="h-full bg-primary-amber transition-all duration-200"
                          style={{ width: `${Math.max(2, scanProgress.percent)}%` }}
                        />
                      </div>
                      {(scanProgress.currentTrack || scanProgress.currentFile) && (
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted truncate">
                          <Music className="w-3 h-3 text-primary-amber shrink-0 animate-pulse" />
                          <span className="truncate">
                            {scanProgress.currentTrack
                              ? `${scanProgress.currentTrack.artist} - ${scanProgress.currentTrack.title}`
                              : scanProgress.currentFile}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-muted border-t border-border/15 pt-2">
                      <span>Added: <strong className="text-white">{scanProgress.addedCount}</strong></span>
                      <span>Updated: <strong className="text-white">{scanProgress.updatedCount}</strong></span>
                      <span>Cached: <strong className="text-white">{scanProgress.skippedCount}</strong></span>
                    </div>
                  </div>
                )}

                <div className="divide-y divide-border/10">
                  {roots.length === 0 ? (
                    <div className="py-6 text-center text-xs text-text-muted">
                      No library folders added yet. Click "Add Music Folder" above to get started.
                    </div>
                  ) : (
                    roots.map((root) => {
                      const isThisRootScanning = isScanning && scanProgress?.folderPath === root.path
                      return (
                        <div key={root.id} className="py-3 flex items-center justify-between gap-4 group">
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm font-medium text-text truncate">{root.path}</span>
                            <span className="text-[11px] text-text-muted">
                              {root.songCount !== undefined ? `${root.songCount} songs • ` : ''}
                              Added {new Date(root.dateAdded * 1000).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isThisRootScanning ? (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary-amber/30 bg-primary-amber/10 text-primary-amber text-xs font-semibold tabular-nums">
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>{scanProgress?.percent}%</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleRescanRoot(root.path)}
                                disabled={isScanning}
                                title="Rescan this folder"
                                className="p-2 hover:bg-hover rounded-full border border-border text-text-muted hover:text-text transition-colors disabled:opacity-40"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveRoot(root.id)}
                              disabled={isScanning}
                              title="Remove folder"
                              className="p-2 hover:bg-red-500/20 rounded-full border border-border text-text-muted hover:text-red-400 transition-colors disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </SettingsSection>

              {/* Download Location (Colocated with Library) */}
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
                          className="rounded-full bg-surface-elevated border border-border px-3.5 py-2 text-xs font-bold text-text hover:border-primary-amber/50 transition-colors"
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
          )}

          {/* SECTION GROUP 2: DOWNLOAD PROVIDERS & PRIORITY */}
          {(activeCategory === 'all' || activeCategory === 'providers') && (
            <>
              {/* Bulk Download Priority */}
              <SettingsSection
                icon={<Layers className="w-5 h-5" />}
                title="Bulk Download Priority & Fallback"
                description="Choose the order Felo should try authorized sources when resolving queued downloads."
              >
                <div className="flex items-center justify-end mb-4">
                  <button
                    type="button"
                    onClick={savePriorityOrder}
                    className="rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                  >
                    Save Priority Order
                  </button>
                </div>

                {priorityMessage && (
                  <div className="mb-4 rounded-md border border-white/20 bg-surface-elevated px-3 py-2 text-xs font-bold text-text">
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
                            <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                              Top Priority
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-text">{source.name}</span>
                            <span className="text-xs font-mono text-text-muted">
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
                            className="h-8 w-8 rounded-full border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => movePriority(index, 'down')}
                            disabled={index === downloadPriority.length - 1}
                            className="h-8 w-8 rounded-full border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
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
                            className="h-8 w-8 rounded-full border border-danger/40 bg-danger/10 flex items-center justify-center text-danger hover:bg-danger/20"
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
                          className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text-muted hover:text-text"
                        >
                          + {source.name}
                        </button>
                      )
                    )}
                  </div>
                )}
              </SettingsSection>
            </>
          )}

          {/* SECTION GROUP 3: PLAYBACK & AUDIO */}
          {(activeCategory === 'all' || activeCategory === 'audio') && (
            <SettingsSection
              icon={<Volume2 className="w-5 h-5" />}
              
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

              {typeof window.electron !== 'undefined' && (
                <div className="mt-4 rounded-xl border border-border/30 bg-surface-elevated/40 p-5 backdrop-blur-sm">
                  {/* Header & Toggle */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary-amber" />
                        <span className="text-sm font-bold text-text">AI & External Playback Control (MCP)</span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                            externalPlayerEnabled
                              ? 'bg-white/10 text-white border border-white/20'
                              : 'bg-zinc-500/10 text-zinc-400 border border-border/40'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              externalPlayerEnabled ? 'bg-white animate-pulse' : 'bg-zinc-500'
                            }`}
                          />
                          {externalPlayerEnabled
                            ? `Port ${externalPlayerClientConfigs?.port || 47820}`
                            : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">
                        Allows AI assistants (Claude Desktop, Hermes, Cursor, Antigravity) to search, queue, and control music playback via Model Context Protocol.
                      </p>
                    </div>
                    <Toggle enabled={externalPlayerEnabled} onChange={(value) => void setExternalControl(value)} />
                  </div>

                  {externalPlayerEnabled && (
                    <div className="mt-5 space-y-4 pt-4 border-t border-border/20">
                      {/* Personal API Key row */}
                      <div className="rounded-lg border border-border/30 bg-canvas/60 p-3.5">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                            <Key className="w-3.5 h-3.5 text-primary-amber" />
                            <span>Personal API Key</span>
                          </div>
                          <span className="text-[10px] text-text-muted font-mono">
                            Auto-authenticated locally • Pass via FELO_API_KEY for remote/WSL
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0 font-mono text-xs bg-surface-elevated px-3 py-2 rounded-md border border-border/50 text-text truncate select-all">
                            {showApiKey
                              ? externalPlayerApiKey || 'Generating...'
                              : externalPlayerApiKey
                                ? `${externalPlayerApiKey.slice(0, 10)}••••••••••••••••••••••••••••••••`
                                : '••••••••••••••••••••••••••••••••'}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors"
                            title={showApiKey ? 'Hide Key' : 'Show Key'}
                          >
                            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyApiKey()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs font-medium text-text hover:bg-hover transition-colors"
                            title="Copy API Key"
                          >
                            {copiedKey ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRegenerateApiKey()}
                            className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors"
                            title="Regenerate API Key"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Client Config tabs */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-text">AI Client Setup</span>
                          <div className="flex rounded-md bg-canvas/80 p-0.5 border border-border/30">
                            {(['claude', 'hermes', 'cursor'] as const).map((tab) => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setSelectedMcpTab(tab)}
                                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                                  selectedMcpTab === tab
                                    ? 'bg-surface-elevated text-text shadow-sm'
                                    : 'text-text-muted hover:text-text'
                                }`}
                              >
                                {tab === 'claude'
                                  ? 'Claude Desktop'
                                  : tab === 'hermes'
                                    ? 'Hermes'
                                    : 'Cursor / Antigravity'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="relative">
                          <pre className="font-mono text-[11px] bg-black/60 p-3 rounded-lg overflow-x-auto max-h-36 border border-border/30 text-text-muted leading-relaxed select-all">
                            <code>
                              {selectedMcpTab === 'claude'
                                ? externalPlayerClientConfigs?.claudeDesktop || '// Generating Claude config...'
                                : selectedMcpTab === 'hermes'
                                  ? externalPlayerClientConfigs?.hermes || '// Generating Hermes config...'
                                  : externalPlayerClientConfigs?.cursor || '// Generating Cursor config...'}
                            </code>
                          </pre>
                          <button
                            type="button"
                            onClick={() => void handleCopyClientConfig(selectedMcpTab)}
                            className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-elevated/90 backdrop-blur-sm border border-border/50 text-[11px] font-medium text-text hover:border-primary-amber/50 transition-colors shadow-sm"
                          >
                            {copiedConfig ? (
                              <>
                                <Check className="w-3 h-3 text-text" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {externalPlayerMessage && (
                    <p className="mt-3 text-xs text-primary-amber flex items-center gap-1.5">
                      <span>•</span> {externalPlayerMessage}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-text-muted">
                    Zero-touch local authentication is automatic for local agents. Commands are processed securely on loopback only.
                  </p>
                </div>
              )}

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
          )}

          {/* SECTION GROUP 4: INTEGRATIONS */}
          {(activeCategory === 'all' || activeCategory === 'integrations') && (
            <SettingsSection
              icon={<Radio className="w-5 h-5" />}
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
                    className="rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                  >
                    Save Last.fm Key
                  </button>
                  <span className="text-[11px] text-text-muted">Get a free key at last.fm/api</span>
                </div>
                {lastFmMessage && (
                  <p className="text-xs font-medium text-text-muted">{lastFmMessage}</p>
                )}
              </div>
            </SettingsSection>
          )}

          {/* Streaming Accounts & Engine */}
          {(activeCategory === 'all' || activeCategory === 'providers') && (
            <SettingsSection
              icon={<Headphones className="w-5 h-5" />}
              title="Streaming Accounts & Downloader Engine"
              description="Manage background audio download engines (yt-dlp, ffmpeg) and account connectors."
            >
              <div className="space-y-5">
                <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-bold text-text">Qobuz Hi-Res Configuration</span>
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
                        className="text-[11px] text-text-muted hover:text-text"
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
                  <strong>How to get Qobuz Auth Token:</strong> Log in to <span className="text-text font-mono">play.qobuz.com</span> in your browser. Open DevTools (F12) → Application → Local Storage (or Cookies) and copy your <span className="text-text font-mono">user_auth_token</span> and <span className="text-text font-mono">user_id</span>. An active Qobuz subscription or trial is required.
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleTestQobuz}
                    disabled={qobuzTestStatus.loading}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-60"
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
                <div className="mb-4 font-bold text-text">Deezer Lossless Configuration</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="flex items-center justify-between text-xs font-bold text-text">
                      Deezer ARL Cookie Token
                      <button
                        type="button"
                        onClick={() => setShowDeezerArl((show) => !show)}
                        className="text-[11px] text-text-muted hover:text-text"
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
                      className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-60"
                    >
                      <Plug
                        className={`h-4 w-4 ${deezerTestStatus.loading ? 'animate-pulse' : ''}`}
                      />
                      {deezerTestStatus.loading ? 'Testing Deezer...' : 'Test Deezer ARL'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-surface-elevated/40 border border-border/30 p-2.5 text-[11px] text-text-muted">
                  <strong>How to get Deezer ARL:</strong> Open <span className="text-text font-mono">deezer.com</span> in your browser and log in. Open DevTools (F12) → Application / Storage → Cookies → <span className="text-text font-mono">https://www.deezer.com</span> → find and copy the <span className="text-text font-mono">arl</span> cookie value. (ARL tokens expire after ~3 months).
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
              <div className="rounded-lg border border-border/40 bg-canvas/40 p-4">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-text">Soulseek P2P Network</h4>
                    <p className="text-xs text-text-muted">
                      Peer-to-peer lossless and MP3 music exchange network.
                    </p>
                  </div>
                  <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-text-muted border border-border/40">
                    FLAC / MP3
                  </span>
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
                        className="text-[11px] text-text-muted hover:text-text"
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
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text disabled:opacity-60 hover:bg-hover transition-colors shrink-0"
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
              <div className="rounded-lg border border-border/40 bg-canvas/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-text">YouTube Music</h4>
                    <p className="text-xs text-text-muted">
                      Downloads and audio conversion powered by yt-dlp & ffmpeg. No login required.
                    </p>
                  </div>
                  <span className="rounded-full border border-border/40 bg-surface px-3 py-1 text-[11px] font-bold text-text-muted">
                    256k MP3 / Opus
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveStreamingAccounts}
                  className="rounded-full border border-border bg-surface-elevated px-6 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
                >
                  Save Streaming Settings
                </button>
                {accountMessage && (
                  <span className="text-xs font-bold text-text">{accountMessage}</span>
                )}
              </div>
            </div>
          </SettingsSection>
        )}

          {/* SECTION GROUP 4: INTEGRATIONS */}
          {(activeCategory === 'all' || activeCategory === 'integrations') && (
            <>
            <SettingsSection
              icon={<MessageSquare className="w-5 h-5" />}
              title="Discord & Media Presence"
              description="Share what you're listening to with Discord Rich Presence and system media controls."
            >
              {/* Detection & Connection Status */}
              <div className="p-3 rounded-lg bg-surface-elevated/60 border border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      presenceStatus?.running
                        ? 'bg-white animate-pulse'
                        : presenceStatus?.configured
                          ? 'bg-amber-400'
                          : 'bg-zinc-500'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-text flex items-center gap-1.5 flex-wrap">
                      <span>Music Presence (Discord Integration)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border/60 text-text-muted">
                        {presenceStatus?.running
                          ? 'Active & Running'
                          : presenceStatus?.configured
                            ? 'Configured (Idle)'
                            : presenceStatus?.installed
                              ? 'Detected (Needs Link)'
                              : 'Not Detected'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {presenceStatus?.running
                        ? 'Felo is connected and syncing what you are listening to on Discord.'
                        : presenceStatus?.configured
                          ? 'Felo is registered in Music Presence. Start Music Presence to broadcast to Discord.'
                          : 'Music Presence integrates desktop playback directly with your Discord profile.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {presenceStatus?.installed && !presenceStatus?.running && (
                    <button
                      type="button"
                      onClick={handleLaunchMusicPresence}
                      className="px-2.5 py-1 text-xs font-medium rounded bg-surface border border-border hover:bg-surface-elevated text-text transition-colors"
                    >
                      Start Presence App
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSetupMusicPresence}
                    disabled={presenceSettingUp}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                  >
                    {presenceSettingUp ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>{presenceStatus?.configured ? 'Re-link Discord' : 'Setup Discord'}</span>
                  </button>
                </div>
              </div>

              {presenceSetupMsg && (
                <div className="text-xs px-3 py-2 rounded bg-surface/80 border border-primary/20 text-primary flex items-center justify-between">
                  <span>{presenceSetupMsg}</span>
                  <button
                    type="button"
                    onClick={() => setPresenceSetupMsg(null)}
                    className="text-text-muted hover:text-text text-[10px] ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}

              <SettingRow
                label="Discord Rich Presence"
                hint="Show currently playing track in your Discord status."
              >
                <Toggle
                  enabled={discordRpcEnabled}
                  onChange={(val) => {
                    setDiscordRpcEnabled(val)
                    if (val && !presenceStatus?.configured) {
                      void handleSetupMusicPresence()
                    }
                  }}
                />
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

            {/* Discord Music Bot & Webhook Remote Control */}
            <SettingsSection
              icon={<Bot className="w-5 h-5" />}
                            title="Discord Music Bot & Webhook Remote Control"
              description="Control your local Felo player and synchronize group Listen Together sessions using standard Discord music bot commands and webhooks—without spawning a bot into a voice channel."
            >
              {/* Connection Status Banner */}
              <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-3 h-3 rounded-full shrink-0 ${
                      discordBotConnected
                        ? 'bg-white animate-pulse'
                        : discordBotEnabled
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-zinc-500'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-bold text-text flex items-center gap-2">
                      <span>Discord Music Bot Gateway</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border/60 text-text-muted font-mono">
                        {discordBotConnected
                          ? `Online as @${discordBotUser?.username || 'Bot'}`
                          : discordBotEnabled
                            ? 'Connecting...'
                            : 'Offline'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Commands play locally on the host player and auto-sync to all group listeners.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveDiscordBotSettings({ enabled: !discordBotEnabled })}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-all border ${
                      discordBotEnabled
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                        : 'border-border bg-surface-elevated text-text hover:bg-hover'
                    }`}
                  >
                    {discordBotEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>

              {discordBotError && (
                <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger flex items-center justify-between">
                  <span>{discordBotError}</span>
                  <button
                    type="button"
                    onClick={() => setDiscordBotError(null)}
                    className="text-text-muted hover:text-text text-[10px] ml-2"
                  >
                    ✕
                  </button>
                </div>
              )}

              {discordMessage && (
                <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-success">
                  {discordMessage}
                </div>
              )}

              {/* Universal Cloudflare Bot Section (1-Click) */}
              <div className="mt-4 p-4 rounded-xl bg-surface-elevated/40 border border-primary-amber/30 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 rounded-lg bg-primary-amber/15 text-primary-amber">
                      <Bot className="w-5 h-5" />
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-text flex items-center gap-2">
                        <span>Universal Discord Bot (1-Click)</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-medium">
                          felo.feloapp.workers.dev
                        </span>
                      </h4>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        Zero setup. Invite our bot to your Discord server and control this desktop player from any channel.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Room Code Display */}
                <div className="p-3 rounded-lg bg-surface border border-border/60 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">
                      Your Discord Connect Code
                    </span>
                    <span className="text-base font-mono font-bold tracking-widest text-primary-amber">
                      {hostRoom?.code || 'NO ACTIVE CODE'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hostRoom?.code ? (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(hostRoom.code)
                          setCopiedRoomCode(true)
                          setTimeout(() => setCopiedRoomCode(false), 2000)
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-text text-xs font-medium flex items-center gap-1.5 transition-colors"
                      >
                        {copiedRoomCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedRoomCode ? 'Copied!' : 'Copy Code'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void ensureHostRoom(true)}
                        className="px-3 py-1.5 rounded-lg bg-primary-amber text-black text-xs font-bold transition-all hover:bg-primary-amber/90"
                      >
                        Generate Code
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-[11px] text-text-muted space-y-1 pt-1">
                  <p className="font-semibold text-text">How to connect in Discord:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-text-muted">
                    <li>In your Discord server, type <code className="text-text font-mono font-bold">/connect {hostRoom?.code || '<code>'}</code></li>
                    <li>Type <code className="text-text font-mono font-bold">/play &lt;song&gt;</code> — Felo plays it and auto-downloads missing songs online!</li>
                  </ol>
                </div>
              </div>

              {/* Bot Configuration Fields */}
              <div className="mt-4 space-y-4 pt-4 border-t border-border/30">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text">Discord Bot Token</span>
                    <a
                      href="https://discord.com/developers/applications"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary-amber hover:underline flex items-center gap-1"
                    >
                      <span>Create Token in Discord Portal</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      type={showDiscordBotToken ? 'text' : 'password'}
                      value={discordBotToken}
                      onChange={(e) => setDiscordBotToken(e.target.value.trim())}
                      placeholder="Paste your Discord Bot Token here..."
                      className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 pr-20 text-xs font-mono text-text outline-none focus:border-white/40 transition-colors"
                    />
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowDiscordBotToken(!showDiscordBotToken)}
                        className="rounded p-1 text-text-muted hover:bg-hover hover:text-text transition-colors"
                        title={showDiscordBotToken ? 'Hide token' : 'Show token'}
                      >
                        {showDiscordBotToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveDiscordBotSettings({ token: discordBotToken, enabled: true })}
                        className="rounded-md bg-white text-black px-2.5 py-1 text-[11px] font-bold transition-all hover:bg-white/90 shadow-sm"
                      >
                        Connect
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    💡 <strong>Tip:</strong> Native Slash Commands (like <code className="text-text font-mono font-bold">/play</code>, <code className="text-text font-mono font-bold">/search</code>, <code className="text-text font-mono font-bold">/invite</code>) work out-of-the-box! When creating your bot invite URL in Discord Developer Portal, check both <strong>bot</strong> and <strong>applications.commands</strong> under <em>OAuth2 → URL Generator</em>.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Command Prefix</span>
                    <input
                      type="text"
                      maxLength={3}
                      value={discordBotPrefix}
                      onChange={(e) => setDiscordBotPrefix(e.target.value.trim() || '!')}
                      placeholder="!"
                      className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-text outline-none focus:border-white/40 transition-colors"
                    />
                    <p className="text-[10px] text-text-muted">
                      Default prefix is <code className="text-text font-bold">!</code> (e.g. <code className="text-text font-bold">!play song name</code>)
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-text">Channel Lock (Optional)</span>
                    <input
                      type="text"
                      value={discordBotChannel}
                      onChange={(e) => setDiscordBotChannel(e.target.value.trim())}
                      placeholder="e.g. 123456789012345678"
                      className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-text outline-none focus:border-white/40 transition-colors"
                    />
                    <p className="text-[10px] text-text-muted">
                      Leave blank to listen in any channel, or enter a specific channel ID.
                    </p>
                  </div>
                </div>

                {/* Save Bot Settings Button */}
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => void handleSaveDiscordBotSettings()}
                    className="rounded-full border border-border bg-surface-elevated px-4 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors"
                  >
                    Save Bot Settings
                  </button>
                </div>

                {/* Outgoing Webhook Section */}
                <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
                  <SettingRow
                    label="Discord Webhook Announcer"
                    hint="Automatically post Now Playing embeds with Room Code to a Discord channel."
                  >
                    <Toggle
                      enabled={discordWebhookEnabled}
                      onChange={(val) => {
                        setDiscordWebhookEnabled(val)
                        void handleSaveDiscordBotSettings({ webhookEnabled: val })
                      }}
                    />
                  </SettingRow>

                  {discordWebhookEnabled && (
                    <div className="space-y-2 mt-2">
                      <span className="text-xs font-bold text-text">Discord Webhook URL</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={discordWebhookUrl}
                          onChange={(e) => setDiscordWebhookUrl(e.target.value.trim())}
                          placeholder="https://discord.com/api/webhooks/..."
                          className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-text outline-none focus:border-white/40 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={handleTestDiscordWebhook}
                          disabled={discordTestStatus.loading || !discordWebhookUrl.trim()}
                          className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-50 shrink-0"
                        >
                          {discordTestStatus.loading ? 'Testing...' : 'Test Webhook'}
                        </button>
                      </div>

                      {discordTestStatus.message && (
                        <p
                          className={`text-xs font-bold ${
                            discordTestStatus.success ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {discordTestStatus.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Command Quick Reference Sheet */}
                <div className="mt-5 rounded-xl border border-border/40 bg-surface/80 p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-text uppercase tracking-wider">
                      <ListMusic className="w-3.5 h-3.5 text-text-muted" />
                      <span>Discord Slash (/) & Prefix Commands</span>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                      Zero Port Forwarding
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      ['/play <song>', 'Autocomplete; plays song & syncs to room'],
                      ['/search <song>', 'Interactive dropdown + [Play Now / Next / Queue]'],
                      ['/invite', 'Posts Room Code + 1-Click Join Link for friends'],
                      ['/nowplaying', 'Current song, cover art, progress & room code'],
                      ['/queue', 'Upcoming tracks in the room queue'],
                      ['/skip', 'Skips to next track in queue'],
                      ['/pause & /resume', 'Pauses or resumes session across group'],
                      ['/download', 'Direct link to download Felo Desktop app'],
                      ['/volume <0-100>', 'Adjusts host playback volume']
                    ].map(([cmd, desc]) => (
                      <div key={cmd} className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/40 border border-border/20">
                        <code className="text-text font-mono font-bold text-[11px]">{cmd}</code>
                        <span className="text-[10px] text-text-muted text-right max-w-[55%]">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SettingsSection>
            </>
          )}

          {/* SECTION GROUP 5: APPEARANCE, NOTIFICATIONS & PRIVACY */}
          {(activeCategory === 'all' || activeCategory === 'appearance') && (
            <>
              {/* Appearance */}
              <SettingsSection
                icon={<Palette className="w-5 h-5" />}
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
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
                    <span>100% Local-first: No songs or library metadata leave your device.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
                    <span>Telemetry & Analytics disabled by default.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
                    <span>P2P networks and background seeding disabled in v1.</span>
                  </div>
                </div>
              </SettingsSection>

              {/* Keyboard Shortcuts */}
              <SettingsSection
                icon={<Keyboard className="w-5 h-5" />}
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
