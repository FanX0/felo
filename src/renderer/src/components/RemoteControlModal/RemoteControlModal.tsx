import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Check,
  RefreshCw,
  X,
  Wifi,
  ShieldCheck,
  Radio,
  MonitorSpeaker,
  Download,
  Globe,
  Laptop2,
  Smartphone,
  Tablet,
  Sparkles,
  User
} from 'lucide-react'
import { remoteClient, type PlaybackTarget } from '../../pages/Remote/remoteClient'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from '../../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase'
import {
  detectDeviceInfo,
  getDeviceCategory,
  getDeviceCategoryLabel,
  isPcDevice
} from '../../lib/deviceInfo'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import type { UserConnectedDevice } from '../../online/types'

interface RemoteControlModalProps {
  isOpen: boolean
  onClose: () => void
}

interface RemoteInfo {
  enabled: boolean
  running: boolean
  port: number
  ip: string
  token: string
  url: string
  qrDataUrl: string
  cloudflareUrl?: string
  cloudflareQrDataUrl?: string
  connectedClients: number
}

export default function RemoteControlModal({ isOpen, onClose }: RemoteControlModalProps) {
  const navigate = useNavigate()
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [qrMode, setQrMode] = useState<'cloudflare' | 'local'>('local')

  // Web mode state
  const [currentTarget, setCurrentTarget] = useState<PlaybackTarget>(() => remoteClient.getTargetDevice())
  const [isWebConnected, setIsWebConnected] = useState(() => remoteClient.getIsConnected())

  // Discovered devices in Web mode
  const [discoveredDevices, setDiscoveredDevices] = useState<UserConnectedDevice[]>([])
  const [isLoadingDiscovered, setIsLoadingDiscovered] = useState(false)
  const [transferredDeviceId, setTransferredDeviceId] = useState<string | null>(null)

  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
  const isRemotePlaying = Boolean(
    activeRemote &&
      activeRemote.activeDeviceId !== myDeviceId &&
      activeRemote.isPlaying
  )

  const deviceInfo = detectDeviceInfo()

  const activeDesktop = useMemo(() => {
    // 1. Match by active remote playback device ID
    if (activeRemote?.activeDeviceId) {
      const match = discoveredDevices.find((d) => d.id === activeRemote.activeDeviceId)
      if (match) return match
    }
    // 2. Match by local IP in remoteClient baseUrl
    const baseUrl = remoteClient.getBaseUrl()
    if (baseUrl) {
      const match = discoveredDevices.find((d) => d.local_ip && baseUrl.includes(d.local_ip))
      if (match) return match
    }
    // 3. Match by device name in remoteClient state
    const stateName = remoteClient.getState().deviceName
    if (stateName) {
      const match = discoveredDevices.find((d) => d.device_name === stateName)
      if (match) return match
    }
    // 4. If only one PC device is discovered, that's the active desktop
    const pcDevices = discoveredDevices.filter(
      (d) => d.id !== myDeviceId && isPcDevice(getDeviceCategory(d))
    )
    if (pcDevices.length === 1) {
      return pcDevices[0]
    }
    return pcDevices[0] || null
  }, [activeRemote?.activeDeviceId, discoveredDevices, myDeviceId])

  const desktopDisplayName =
    activeDesktop?.device_name || remoteClient.getState().deviceName || 'Felo Desktop'

  const isDevCurrent = (dev: UserConnectedDevice) => {
    if (currentTarget === 'mobile') return false
    if (activeDesktop && activeDesktop.id === dev.id) return true
    if (activeRemote?.activeDeviceId === dev.id) return true
    if (dev.device_name && desktopDisplayName && dev.device_name === desktopDisplayName) return true
    if (dev.local_ip && remoteClient.getBaseUrl() && remoteClient.getBaseUrl().includes(dev.local_ip)) return true
    return false
  }

  const dualSyncSubtitle = (() => {
    const localLabel = deviceInfo.isMobile ? deviceInfo.model : 'This Browser'
    const remoteLabel = activeDesktop?.device_name
      ? activeDesktop.device_name.replace(/\s*\(.*\)$/, '')
      : 'PC'
    return `Synchronized audio on ${localLabel} + ${remoteLabel}`
  })()

  const handlePlayOnThisComputer = async () => {
    if (!activeRemote || !user?.id) return

    // 1. Send pause command to the active remote device
    await sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'pause')

    // 2. Clear remote playback state in store
    useConnectedDeviceStore.getState().clearRemotePlayback()

    // 3. Queue and play locally on PC
    const player = usePlayerStore.getState()
    if (activeRemote.song) {
      let songToPlay = activeRemote.song
      if (window.api?.getSongs) {
        try {
          const localSongs = await window.api.getSongs()
          const matched = localSongs.find(
            (s: any) =>
              s.id === activeRemote.song?.id ||
              (s.title?.toLowerCase() === activeRemote.song?.title?.toLowerCase() &&
                s.artist?.toLowerCase() === activeRemote.song?.artist?.toLowerCase())
          )
          if (matched) {
            songToPlay = matched
          }
        } catch {
          // ignore
        }
      }

      player.setQueue([songToPlay], 0, {
        type: 'library',
        title: 'Transferred Playback'
      })
      if (typeof activeRemote.position === 'number' && activeRemote.position > 0) {
        setTimeout(() => {
          usePlayerStore.getState().seek(activeRemote.position)
        }, 80)
      }
    } else {
      player.setIsPlaying(true)
    }
  }

  const loadInfo = async () => {
    if (!window.api?.getRemoteControlInfo) return
    try {
      const data = await window.api.getRemoteControlInfo()
      setInfo(data)
    } catch (err) {
      console.error('Failed to get remote control info:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return undefined
    if (isElectron) {
      void loadInfo()
      const interval = setInterval(() => {
        void loadInfo()
      }, 3000)
      return () => clearInterval(interval)
    } else {
      setIsLoading(false)
      const unsubConn = remoteClient.subscribeConnection(setIsWebConnected)
      const unsubTarget = remoteClient.subscribeTarget(setCurrentTarget)
      return () => {
        unsubConn()
        unsubTarget()
      }
    }
  }, [isOpen, isElectron])

  // Fetch active discovered devices from Supabase in both Electron and Web mode
  useEffect(() => {
    if (!isOpen || !user?.id || !isSupabaseConfigured) return undefined

    const fetchDevices = async () => {
      setIsLoadingDiscovered(true)
      try {
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from('user_devices')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .order('last_seen_at', { ascending: false })

        if (!error && Array.isArray(data)) {
          const now = Date.now()
          const active = data.filter((d: any) => now - new Date(d.last_seen_at).getTime() < 300_000)
          const storeDevs = useConnectedDeviceStore.getState().discoveredDevices
          const merged = [...active]
          for (const sDev of storeDevs) {
            if (!merged.some((m) => m.id === sDev.id)) {
              merged.push(sDev)
            }
          }
          setDiscoveredDevices(merged)
        }
      } catch (err) {
        console.warn('[RemoteControlModal] Failed to fetch devices:', err)
      } finally {
        setIsLoadingDiscovered(false)
      }
    }

    void fetchDevices()
    const pollInterval = setInterval(fetchDevices, 15_000)

    const supabase = getSupabase()
    const channel = supabase
      .channel(`modal_devices_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_devices',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          void fetchDevices()
        }
      )
      .subscribe()

    return () => {
      clearInterval(pollInterval)
      void supabase.removeChannel(channel)
    }
  }, [isOpen, user?.id])

  const handleSendToMobile = async (device: UserConnectedDevice) => {
    if (!user?.id) return
    const supabase = getSupabase()
    const player = usePlayerStore.getState()
    const activeSong = player.queue[player.currentSongIndex]
    if (!activeSong) return

    let songForMobile = activeSong
    if (info?.ip && info?.token) {
      const port = info.port || 4788
      const streamUrl = `http://${info.ip}:${port}/v1/audio/${encodeURIComponent(activeSong.id)}?token=${encodeURIComponent(info.token)}`
      const artworkUrl = `http://${info.ip}:${port}/v1/artwork/${encodeURIComponent(activeSong.id)}?token=${encodeURIComponent(info.token)}`
      songForMobile = {
        ...activeSong,
        filePath: streamUrl,
        artworkUrl: artworkUrl,
        isOnline: true
      }
    }

    await supabase.channel(`user_playback_sync_${user.id}`).send({
      type: 'broadcast',
      event: 'command',
      payload: {
        targetDeviceId: device.id,
        action: 'play',
        song: songForMobile,
        position: player.currentTime
      }
    })

    // Pause PC playback so audio smoothly switches to the mobile phone
    player.setIsPlaying(false)
    setTransferredDeviceId(device.id)
    setTimeout(() => setTransferredDeviceId(null), 3000)
  }

  if (!isOpen) return null

  const activeUrl =
    qrMode === 'cloudflare' && info?.cloudflareUrl ? info.cloudflareUrl : info?.url || ''
  const activeQr =
    qrMode === 'cloudflare' && info?.cloudflareQrDataUrl
      ? info.cloudflareQrDataUrl
      : info?.qrDataUrl || ''

  const handleCopy = async (textToCopy?: string) => {
    const text = textToCopy || activeUrl
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleRegenerate = async () => {
    if (!window.api?.regenerateRemoteControlToken || isRefreshing) return
    setIsRefreshing(true)
    try {
      const updated = await window.api.regenerateRemoteControlToken()
      setInfo(updated)
    } catch (err) {
      console.error('Failed to regenerate token:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleToggle = async () => {
    if (!window.api?.setRemoteControlEnabled || !info) return
    try {
      const updated = await window.api.setRemoteControlEnabled(!info.enabled)
      setInfo(updated)
    } catch (err) {
      console.error('Failed to toggle remote control:', err)
    }
  }

  const handleSelectWebTarget = async (target: PlaybackTarget) => {
    if (currentTarget === target && target !== 'mobile') return
    setCurrentTarget(target)
    useConnectedDeviceStore.getState().setPlaybackTarget(target)

    if (
      target === 'mobile' &&
      activeRemote &&
      activeRemote.activeDeviceId !== myDeviceId &&
      user?.id
    ) {
      useConnectedDeviceStore.getState().claimPlayback()
      useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
      // Pause active remote desktop
      await sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'pause')

      // Hand over song to local mobile/web player with resolved stream URL
      if (activeRemote.song) {
        const songWithStream = {
          ...activeRemote.song,
          filePath: resolveSongAudioUrl(activeRemote.song) || activeRemote.song.filePath
        }
        usePlayerStore.getState().setQueue([songWithStream], 0, {
          type: 'library',
          title: 'Transferred Playback'
        })
        if (typeof activeRemote.position === 'number' && activeRemote.position > 0) {
          setTimeout(() => {
            usePlayerStore.getState().seek(activeRemote.position)
          }, 80)
        }
      }
      useConnectedDeviceStore.getState().clearRemotePlayback()
    } else if (target === 'desktop') {
      useConnectedDeviceStore.getState().setDevicePlaybackMode('remote_controller')
      const localPlayer = usePlayerStore.getState()
      const localSong = localPlayer.queue[localPlayer.currentSongIndex]
      if (localPlayer.isPlaying && localSong && user?.id) {
        localPlayer.setIsPlaying(false)
        const targetDeviceId = activeDesktop?.id || activeRemote?.activeDeviceId || 'desktop'
        void sendDeviceCommand(user.id, targetDeviceId, 'play', {
          songId: localSong.id,
          song: localSong,
          position: localPlayer.currentTime
        })
      } else {
        localPlayer.setIsPlaying(false)
      }
    }
    await remoteClient.setTargetDevice(target)
  }

  const handleConnectToDiscovered = async (device: UserConnectedDevice) => {
    const category = getDeviceCategory(device)
    const isPc = isPcDevice(category)
    const target: PlaybackTarget = isPc ? 'desktop' : 'mobile'

    if (device.local_ip && isPc) {
      const targetUrl = `http://${device.local_ip}:${device.port || 4788}`
      remoteClient.configure(targetUrl, device.token || '')
    }

    if (target === 'desktop') {
      useConnectedDeviceStore.getState().setPlaybackTarget('desktop')
      useConnectedDeviceStore.getState().setDevicePlaybackMode('remote_controller')
      const localPlayer = usePlayerStore.getState()
      const localSong = localPlayer.queue[localPlayer.currentSongIndex]
      if (localPlayer.isPlaying && localSong && user?.id) {
        localPlayer.setIsPlaying(false)
        void sendDeviceCommand(user.id, device.id, 'play', {
          songId: localSong.id,
          song: localSong,
          position: localPlayer.currentTime
        })
      } else {
        localPlayer.setIsPlaying(false)
        if (user?.id) {
          void sendDeviceCommand(user.id, device.id, 'play')
        }
      }
      await handleSelectWebTarget('desktop')
    } else {
      await handleSelectWebTarget('mobile')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden text-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-border flex items-center justify-center text-primary">
              <MonitorSpeaker className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-text">
                {isElectron ? 'Connect Your Phone' : 'Connect to a Device'}
              </h2>
              <p className="text-xs text-text-muted">
                {isElectron ? 'Remote control for Felo' : 'Choose where to output audio'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-text-muted">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">Preparing connection...</span>
            </div>
          ) : !isElectron ? (
            /* --- WEB / MOBILE DEVICE PICKER (SPOTIFY CONNECT STANDARD) --- */
            <div className="w-full space-y-5">
              {/* 1. CURRENT PLAYING DEVICE HERO */}
              <div>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Current Device
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-primary font-bold">Active Audio Output</span>
                  </div>
                </div>

                <div className="w-full p-4 rounded-2xl bg-surface-elevated border border-primary/40 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-primary shrink-0">
                      {currentTarget === 'mobile' ? (
                        deviceInfo.type === 'phone' ? (
                          <Smartphone className="w-6 h-6 animate-pulse" />
                        ) : deviceInfo.type === 'tablet' ? (
                          <Tablet className="w-6 h-6 animate-pulse" />
                        ) : (
                          <Globe className="w-6 h-6 animate-pulse" />
                        )
                      ) : currentTarget === 'both' ? (
                        <Radio className="w-6 h-6 animate-pulse" />
                      ) : (
                        <Laptop2 className="w-6 h-6 animate-pulse" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-text truncate">
                          {currentTarget === 'mobile'
                            ? `${deviceInfo.name} (This Device)`
                            : currentTarget === 'both'
                              ? 'Play on Both (Dual Sync)'
                              : desktopDisplayName}
                        </h4>
                        <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                          {currentTarget === 'mobile'
                            ? deviceInfo.categoryLabel
                            : currentTarget === 'both'
                              ? 'Dual Sync'
                              : activeDesktop
                                ? getDeviceCategoryLabel(getDeviceCategory(activeDesktop))
                                : 'Desktop App'}
                        </span>
                      </div>
                      <p className="text-xs text-primary font-medium truncate mt-0.5">
                        {currentTarget === 'mobile'
                          ? `Playing locally on ${deviceInfo.name}`
                          : currentTarget === 'both'
                            ? dualSyncSubtitle
                            : activeRemote?.isPlaying && activeRemote.song
                              ? `${activeRemote.song.title} • ${activeRemote.song.artist}`
                              : isWebConnected
                                ? 'Playing through PC speakers'
                                : 'Connected to desktop'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-end gap-1 h-4">
                      <span className="w-1 h-full bg-primary rounded-full animate-pulse" />
                      <span
                        className="w-1 h-3 bg-primary rounded-full animate-pulse"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="w-1 h-full bg-primary rounded-full animate-pulse"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. SELECT ANOTHER DEVICE */}
              <div className="space-y-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    Select a Device
                  </h4>
                  {isLoadingDiscovered && (
                    <div className="flex items-center gap-1 text-[11px] text-text-muted">
                      <RefreshCw className="w-3 h-3 animate-spin text-text-muted" />
                      <span>Scanning account...</span>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {/* Switch to Local Device (if not already active) */}
                  {currentTarget !== 'mobile' && (
                    <button
                      type="button"
                      onClick={() => handleSelectWebTarget('mobile')}
                      className="w-full p-3.5 rounded-xl text-left transition-colors flex items-center justify-between border border-border bg-surface hover:bg-surface-elevated cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-muted group-hover:text-text transition-colors shrink-0">
                          {deviceInfo.type === 'phone' ? (
                            <Smartphone className="w-5 h-5" />
                          ) : deviceInfo.type === 'tablet' ? (
                            <Tablet className="w-5 h-5" />
                          ) : (
                            <Globe className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h5 className="text-xs font-bold text-text group-hover:text-primary transition-colors truncate">
                              {deviceInfo.model} (This Device)
                            </h5>
                            <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                              {deviceInfo.categoryLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted truncate mt-0.5">
                            {deviceInfo.isMobile ? 'Listen on phone speakers' : 'Listen in this browser'}
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary-hover text-primary-foreground transition-all active:scale-95 shadow-sm">
                        Listen Here
                      </span>
                    </button>
                  )}

                  {/* Discovered Devices from same account */}
                  {user &&
                    discoveredDevices.length > 0 &&
                    discoveredDevices
                      .filter((dev) => dev.id !== myDeviceId)
                      .map((dev) => {
                        const devCategory = getDeviceCategory(dev)
                        const devLabel = getDeviceCategoryLabel(devCategory)
                        const isDevPc = isPcDevice(devCategory)

                        // If this device is ALREADY the current active device shown above, skip it!
                        if (isDevCurrent(dev)) return null

                        return (
                          <button
                            key={dev.id}
                            type="button"
                            onClick={() => handleConnectToDiscovered(dev)}
                            className="w-full p-3.5 rounded-xl text-left transition-colors flex items-center justify-between border border-border bg-surface hover:bg-surface-elevated cursor-pointer group"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-muted group-hover:text-text transition-colors shrink-0">
                                {devCategory === 'app_pc' ? (
                                  <Laptop2 className="w-5 h-5" />
                                ) : devCategory === 'web_pc' ? (
                                  <Globe className="w-5 h-5" />
                                ) : (
                                  <Smartphone className="w-5 h-5" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h5 className="text-xs font-bold text-text group-hover:text-primary transition-colors truncate">
                                    {dev.device_name || (isDevPc ? 'Felo Desktop' : 'Mobile Device')}
                                  </h5>
                                  <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                                    {devLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-text-muted truncate mt-0.5">
                                  {dev.local_ip
                                    ? `Ready on Wi-Fi • ${dev.local_ip}`
                                    : 'Connected via Felo Account'}
                                </p>
                              </div>
                            </div>
                            <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary-hover text-primary-foreground transition-all active:scale-95 shadow-sm">
                              {isDevPc ? 'Switch to PC' : 'Switch Device'}
                            </span>
                          </button>
                        )
                      })}

                  {/* Play on Both (Dual Sync) Option */}
                  {currentTarget !== 'both' && (
                    <button
                      type="button"
                      onClick={() => handleSelectWebTarget('both')}
                      className="w-full p-3.5 rounded-xl text-left transition-colors flex items-center justify-between border border-border bg-surface hover:bg-surface-elevated cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-muted group-hover:text-primary transition-colors shrink-0">
                          <Radio className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h5 className="text-xs font-bold text-text group-hover:text-primary transition-colors truncate">
                              Play on Both
                            </h5>
                            <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                              Dual Sync
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted truncate mt-0.5">
                            {dualSyncSubtitle}
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary hover:bg-primary-hover text-primary-foreground transition-all active:scale-95 shadow-sm">
                        Dual Play
                      </span>
                    </button>
                  )}
                </div>

                {/* LOGGED OUT STATE: Call to Action */}
                {!user && (
                  <div className="rounded-2xl border border-border bg-surface-elevated p-4 shadow-sm space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-primary shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <h4 className="text-xs font-bold text-text uppercase tracking-wider">
                        Connect to Your Computer
                      </h4>
                    </div>
                    <p className="text-xs text-text-muted leading-relaxed">
                      Sign in to your Felo account on your phone and computer to discover and control playback across devices with 1 tap.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        navigate('/account')
                      }}
                      className="w-full py-2.5 bg-primary hover:bg-primary-hover text-primary-foreground font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 shadow-sm"
                    >
                      <User className="w-4 h-4" />
                      <span>Log In to Connect Devices</span>
                    </button>
                  </div>
                )}

                {/* Logged in with no active desktop detected */}
                {user && discoveredDevices.length === 0 && currentTarget !== 'desktop' && (
                  <div className="p-5 rounded-2xl bg-surface border border-border text-center text-xs text-text-muted space-y-1">
                    <Laptop2 className="w-8 h-8 mx-auto mb-2 opacity-40 text-text-muted" />
                    <p className="font-bold text-text">No active desktop players found</p>
                    <p className="text-[11px] text-text-muted max-w-xs mx-auto">
                      Open Felo on your computer and make sure you are logged into <span className="text-text font-medium">{user.email}</span>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : !info?.enabled ? (
            /* --- ELECTRON: REMOTE DISABLED --- */
            <div className="py-12 flex flex-col items-center text-center px-4">
              <div className="w-14 h-14 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-muted mb-4">
                <MonitorSpeaker className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-base text-text mb-1">Phone Remote is Disabled</h3>
              <p className="text-xs text-text-muted max-w-xs mb-6">
                Turn on Phone Remote to let your phone control playback on this computer over Wi-Fi.
              </p>
              <button
                type="button"
                onClick={handleToggle}
                className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs transition shadow-sm active:scale-95 cursor-pointer"
              >
                Enable Phone Remote
              </button>
            </div>
          ) : (
            /* --- ELECTRON: REMOTE ENABLED (TABS FOR CLOUDFLARE WEB VS LOCAL WI-FI) --- */
            <>
              {/* Active Remote Hero Card (Spotify Connect) */}
              {isRemotePlaying && activeRemote && (
                <div className="w-full mb-4 p-3.5 rounded-2xl bg-surface-elevated border border-primary/30 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3 min-w-0 text-left">
                    <div className="w-10 h-10 rounded-xl bg-surface border border-border text-primary flex items-center justify-center shrink-0">
                      {activeRemote.activeDeviceType === 'mobile' ? (
                        <Smartphone className="w-5 h-5 animate-pulse" />
                      ) : (
                        <Laptop2 className="w-5 h-5 animate-pulse" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                          Playing on {activeRemote.activeDeviceName}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-text truncate mt-0.5">
                        {activeRemote.song ? activeRemote.song.title : 'Audio Playing'}
                      </p>
                      <p className="text-[11px] text-text-muted truncate">
                        {activeRemote.song?.artist || activeRemote.activeDeviceName}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handlePlayOnThisComputer()}
                    className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs transition active:scale-95 shadow-sm flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Laptop2 className="w-3.5 h-3.5" />
                    <span>Play on PC</span>
                  </button>
                </div>
              )}

              {/* Tab Selector: Cloudflare Web vs Local Wi-Fi */}
              <div className="w-full flex rounded-xl bg-surface p-1 mb-4 border border-border text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setQrMode('cloudflare')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    qrMode === 'cloudflare'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Cloudflare Web App</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQrMode('local')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    qrMode === 'local'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Local Wi-Fi IP</span>
                </button>
              </div>

              {/* QR Code Container */}
              <div className="relative p-3 bg-white rounded-2xl shadow-xl flex items-center justify-center mb-3 border border-border">
                {activeQr ? (
                  <img
                    src={activeQr}
                    alt="Scan with phone"
                    className="w-44 h-44 block rounded-lg select-none"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-black text-xs">
                    Generating QR...
                  </div>
                )}
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-xs mb-4">
                <span
                  className={`w-2 h-2 rounded-full ${
                    info.connectedClients > 0
                      ? 'bg-primary animate-pulse'
                      : 'bg-text-muted/40'
                  }`}
                />
                <span className="font-medium text-text-muted text-[11px]">
                  {info.connectedClients > 0
                    ? `${info.connectedClients} phone${info.connectedClients > 1 ? 's' : ''} connected`
                    : qrMode === 'cloudflare'
                      ? 'Scans open felo.feloapp.workers.dev'
                      : 'Point phone camera at QR code'}
                </span>
              </div>

              {/* Instructions */}
              <div className="w-full bg-surface border border-border rounded-xl p-3 text-xs space-y-2 mb-3">
                <div className="flex items-center gap-2 text-text-muted font-medium text-[11px]">
                  <Wifi className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span>Must be on the same Wi-Fi network</span>
                </div>
                <div className="flex items-center gap-2 text-text-muted text-[11px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span>Supports Play on PC, Play on Phone, or Play on Both!</span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-border text-[11px]">
                  <span className="text-text-muted">Or install native Android app:</span>
                  <a
                    href={`http://${info.ip}:${info.port}/felo-remote.apk`}
                    download="FeloRemote.apk"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-text hover:underline font-bold"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .APK</span>
                  </a>
                </div>
              </div>

              {/* Direct Link Input Box */}
              <div className="w-full flex items-center gap-2 bg-surface border border-border rounded-xl p-1.5 pl-3 text-xs">
                <span className="truncate text-text-muted font-mono select-all flex-1 text-[11px]">
                  {activeUrl}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy()}
                  className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-hover border border-border text-text font-medium flex items-center gap-1.5 transition active:scale-95 shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-primary" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Connected Devices across account for bidirectional playback control */}
              {discoveredDevices.filter((d) => d.id !== myDeviceId).length > 0 && (
                <div className="w-full mt-4 space-y-2 border-t border-border pt-3 text-left">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                      <MonitorSpeaker className="w-3.5 h-3.5 text-primary" />
                      <span>
                        Available Devices ({discoveredDevices.filter((d) => d.id !== myDeviceId).length})
                      </span>
                    </span>
                  </div>
                  {discoveredDevices
                    .filter((d) => d.id !== myDeviceId)
                    .map((dev) => {
                      const isThisDevPlaying =
                        Boolean(activeRemote?.activeDeviceId === dev.id && activeRemote?.isPlaying)
                      const devCategory = getDeviceCategory(dev)
                      const devLabel = getDeviceCategoryLabel(devCategory)
                      const isDevPc = isPcDevice(devCategory)

                      return (
                        <div
                          key={dev.id}
                          className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-colors ${
                            isThisDevPlaying
                              ? 'bg-surface-elevated border-primary/40 shadow-sm'
                              : 'bg-surface border-border hover:bg-surface-elevated'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isThisDevPlaying
                                  ? 'bg-surface border border-border text-primary'
                                  : 'bg-surface-elevated border border-border text-text-muted'
                              }`}
                            >
                              {devCategory === 'app_pc' ? (
                                <Laptop2 className="w-4 h-4" />
                              ) : devCategory === 'web_pc' ? (
                                <Globe className="w-4 h-4" />
                              ) : (
                                <Smartphone className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-bold text-text truncate">
                                  {dev.device_name || (isDevPc ? 'Felo Desktop' : 'Mobile Device')}
                                </p>
                                <span className="rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                                  {devLabel}
                                </span>
                                {isThisDevPlaying && (
                                  <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary">
                                    Currently Playing
                                  </span>
                                )}
                              </div>
                              <p
                                className={`text-[10px] truncate ${
                                  isThisDevPlaying ? 'text-primary font-medium' : 'text-text-muted'
                                }`}
                              >
                                {isThisDevPlaying
                                  ? 'Active audio output'
                                  : dev.local_ip
                                    ? `Wi-Fi IP: ${dev.local_ip}`
                                    : 'Ready for playback transfer'}
                              </p>
                            </div>
                          </div>
                          {isThisDevPlaying ? (
                            <button
                              type="button"
                              onClick={() => void handlePlayOnThisComputer()}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-elevated hover:bg-hover border border-border text-text transition cursor-pointer active:scale-95"
                            >
                              Pull to PC
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSendToMobile(dev)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer active:scale-95 shadow-sm ${
                                transferredDeviceId === dev.id
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-primary hover:bg-primary-hover text-primary-foreground'
                              }`}
                            >
                              {transferredDeviceId === dev.id
                                ? '✓ Transferred'
                                : isDevPc
                                  ? 'Transfer to PC'
                                  : 'Transfer to Phone'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {info?.enabled && (
          <div className="px-6 py-3 bg-surface border-t border-border flex items-center justify-between text-xs text-text-muted">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 hover:text-text transition disabled:opacity-50 cursor-pointer"
              title="Invalidates previous pairing and generates a new QR code"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Reset Pairing Token</span>
            </button>
            <button
              type="button"
              onClick={handleToggle}
              className="text-text-muted hover:text-danger transition cursor-pointer"
            >
              Disable
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
