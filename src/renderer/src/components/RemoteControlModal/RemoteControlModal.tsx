import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Check,
  RefreshCw,
  X,
  Wifi,
  ShieldCheck,
  Radio,
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
  const activeDesktop = discoveredDevices.find(
    (dev) => dev.local_ip && remoteClient.getBaseUrl().includes(dev.local_ip)
  )
  const desktopDisplayName =
    activeDesktop?.device_name || remoteClient.getState().deviceName || 'Felo Desktop'

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
    setCurrentTarget(target)
    await remoteClient.setTargetDevice(target)
  }

  const handleConnectToDiscovered = async (device: UserConnectedDevice) => {
    if (!device.local_ip) return
    const targetUrl = `http://${device.local_ip}:${device.port || 4788}`
    remoteClient.configure(targetUrl, device.token || '')
    await handleSelectWebTarget('desktop')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-[#181818] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-border/60 flex items-center justify-center text-text-muted">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                {isElectron ? 'Connect Your Phone' : 'Connect to a Device'}
              </h2>
              <p className="text-xs text-zinc-400">
                {isElectron ? 'Remote control for Felo' : 'Choose where to output audio'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center">
          {isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
              <span className="text-xs">Preparing connection...</span>
            </div>
          ) : !isElectron ? (
            /* --- WEB / MOBILE DEVICE PICKER (SPOTIFY CONNECT STANDARD) --- */
            <div className="w-full space-y-5">
              {/* 1. CURRENT PLAYING DEVICE HERO */}
              <div>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Current Device
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 font-semibold">Active Audio Output</span>
                  </div>
                </div>

                <div className="w-full p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between shadow-lg shadow-emerald-500/5">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      {currentTarget === 'mobile' ? (
                        deviceInfo.type === 'phone' ? (
                          <Smartphone className="w-6 h-6 text-emerald-400 animate-pulse" />
                        ) : deviceInfo.type === 'tablet' ? (
                          <Tablet className="w-6 h-6 text-emerald-400 animate-pulse" />
                        ) : (
                          <Globe className="w-6 h-6 text-emerald-400 animate-pulse" />
                        )
                      ) : currentTarget === 'both' ? (
                        <Radio className="w-6 h-6 text-emerald-400 animate-pulse" />
                      ) : (
                        <Laptop2 className="w-6 h-6 text-emerald-400 animate-pulse" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-white truncate">
                          {currentTarget === 'mobile'
                            ? `${deviceInfo.name} (This Device)`
                            : currentTarget === 'both'
                              ? 'Play on Both (Dual Sync)'
                              : desktopDisplayName}
                        </h4>
                        {currentTarget === 'mobile' && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                            {deviceInfo.categoryLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-400/90 font-medium truncate mt-0.5">
                        {currentTarget === 'mobile'
                          ? `Playing locally on ${deviceInfo.name}`
                          : currentTarget === 'both'
                            ? `Synchronized audio on ${deviceInfo.model} + PC`
                            : isWebConnected
                              ? 'Playing through PC speakers'
                              : 'Connected to desktop'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-end gap-1 h-4">
                      <span className="w-1 h-full bg-emerald-400 rounded-full animate-pulse" />
                      <span className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-full bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. SELECT ANOTHER DEVICE */}
              <div className="space-y-3 pt-1 border-t border-white/5">
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Select a Device
                  </h4>
                  {isLoadingDiscovered && (
                    <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                      <RefreshCw className="w-3 h-3 animate-spin text-zinc-500" />
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
                      className="w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-white shrink-0">
                          {deviceInfo.type === 'phone' ? (
                            <Smartphone className="w-5 h-5 text-zinc-300" />
                          ) : deviceInfo.type === 'tablet' ? (
                            <Tablet className="w-5 h-5 text-zinc-300" />
                          ) : (
                            <Globe className="w-5 h-5 text-zinc-300" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-white truncate">
                            {deviceInfo.model} (This Device)
                          </h5>
                          <p className="text-[11px] text-zinc-400 truncate">
                            {deviceInfo.isMobile ? 'Listen on phone speakers' : 'Listen in this browser'}
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition">
                        Listen Here
                      </span>
                    </button>
                  )}

                  {/* Discovered Devices from same account */}
                  {user && discoveredDevices.length > 0 &&
                    discoveredDevices
                      .filter((dev) => dev.id !== myDeviceId)
                      .map((dev) => {
                        const devCategory = getDeviceCategory(dev)
                        const devLabel = getDeviceCategoryLabel(devCategory)
                        const isDevPc = isPcDevice(devCategory)
                        const isCurrent =
                          currentTarget === 'desktop' &&
                          isWebConnected &&
                          dev.local_ip &&
                          remoteClient.getBaseUrl().includes(dev.local_ip)
                        if (isCurrent) return null

                        return (
                          <button
                            key={dev.id}
                            type="button"
                            onClick={() => handleConnectToDiscovered(dev)}
                            className="w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20 cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-white shrink-0">
                                {devCategory === 'app_pc' ? (
                                  <Laptop2 className="w-5 h-5 text-indigo-400" />
                                ) : devCategory === 'web_pc' ? (
                                  <Globe className="w-5 h-5 text-sky-400" />
                                ) : devCategory === 'app_mobile' ? (
                                  <Smartphone className="w-5 h-5 text-emerald-400" />
                                ) : (
                                  <Smartphone className="w-5 h-5 text-amber-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h5 className="text-xs font-bold text-white truncate">
                                    {dev.device_name || (isDevPc ? 'Felo Desktop' : 'Mobile Device')}
                                  </h5>
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-white/10 text-zinc-300 border border-white/10">
                                    {devLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                                  {dev.local_ip
                                    ? `Ready on Wi-Fi • ${dev.local_ip}`
                                    : 'Connected via Felo Account'}
                                </p>
                              </div>
                            </div>
                            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition">
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
                      className="w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center text-white shrink-0">
                          <Radio className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h5 className="text-xs font-bold text-white truncate">Play on Both</h5>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                              Dual Sync
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 truncate">
                            Synchronized audio on {deviceInfo.model} + PC
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition">
                        Dual Play
                      </span>
                    </button>
                  )}
                </div>

                {/* LOGGED OUT STATE: Call to Action */}
                {!user && (
                  <div className="bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-zinc-900 border border-emerald-500/20 rounded-2xl p-4 shadow-xl space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Connect to Your Computer
                      </h4>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      Sign in to your Felo account on your phone and computer to discover and control playback across devices with 1 tap.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        navigate('/account')
                      }}
                      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 shadow"
                    >
                      <User className="w-4 h-4" />
                      <span>Log In to Connect Devices</span>
                    </button>
                  </div>
                )}

                {/* Logged in with no active desktop detected */}
                {user && discoveredDevices.length === 0 && currentTarget !== 'desktop' && (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center text-xs text-zinc-400">
                    <Laptop2 className="w-7 h-7 mx-auto mb-1.5 opacity-40 text-zinc-400" />
                    <p className="font-semibold text-white mb-0.5">No active desktop players found</p>
                    <p className="text-[11px] text-zinc-500">
                      Open Felo on your computer and make sure you are logged into <span className="text-zinc-300">{user.email}</span>.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : !info?.enabled ? (
            /* --- ELECTRON: REMOTE DISABLED --- */
            <div className="py-12 flex flex-col items-center text-center px-4">
              <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-400 mb-4">
                <Radio className="w-7 h-7" />
              </div>
              <h3 className="font-semibold text-base mb-1">Phone Remote is Disabled</h3>
              <p className="text-xs text-zinc-400 max-w-xs mb-6">
                Turn on Phone Remote to let your phone control playback on this computer over Wi-Fi.
              </p>
              <button
                type="button"
                onClick={handleToggle}
                className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition shadow-lg active:scale-95 cursor-pointer"
              >
                Enable Phone Remote
              </button>
            </div>
          ) : (
            /* --- ELECTRON: REMOTE ENABLED (TABS FOR CLOUDFLARE WEB VS LOCAL WI-FI) --- */
            <>
              {/* Active Remote Hero Card (Spotify Connect) */}
              {isRemotePlaying && activeRemote && (
                <div className="w-full mb-4 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between shadow-lg shadow-emerald-500/5">
                  <div className="flex items-center gap-3 min-w-0 text-left">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      {activeRemote.activeDeviceType === 'mobile' ? (
                        <Smartphone className="w-5 h-5 text-emerald-400 animate-pulse" />
                      ) : (
                        <Laptop2 className="w-5 h-5 text-emerald-400 animate-pulse" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                          Playing on {activeRemote.activeDeviceName}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-white truncate mt-0.5">
                        {activeRemote.song ? activeRemote.song.title : 'Audio Playing'}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {activeRemote.song?.artist || activeRemote.activeDeviceName}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handlePlayOnThisComputer()}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition active:scale-95 shadow-md flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Laptop2 className="w-3.5 h-3.5" />
                    <span>Play on PC</span>
                  </button>
                </div>
              )}

              {/* Tab Selector: Cloudflare Web vs Local Wi-Fi */}
              <div className="w-full flex rounded-xl bg-white/5 p-1 mb-4 border border-white/5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setQrMode('cloudflare')}
                  className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    qrMode === 'cloudflare'
                      ? 'bg-white text-black shadow-md'
                      : 'text-zinc-400 hover:text-white'
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
                      ? 'bg-white text-black shadow-md'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Local Wi-Fi IP</span>
                </button>
              </div>

              {/* QR Code Container */}
              <div className="relative p-3 bg-white rounded-2xl shadow-xl flex items-center justify-center mb-3">
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
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs mb-4">
                <span
                  className={`w-2 h-2 rounded-full ${
                    info.connectedClients > 0
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-zinc-500'
                  }`}
                />
                <span className="font-medium text-zinc-300 text-[11px]">
                  {info.connectedClients > 0
                    ? `${info.connectedClients} phone${info.connectedClients > 1 ? 's' : ''} connected`
                    : qrMode === 'cloudflare'
                      ? 'Scans open felo.feloapp.workers.dev'
                      : 'Point phone camera at QR code'}
                </span>
              </div>

              {/* Instructions */}
              <div className="w-full bg-white/[0.03] border border-white/5 rounded-xl p-3 text-xs space-y-2 mb-3">
                <div className="flex items-center gap-2 text-zinc-300 font-medium text-[11px]">
                  <Wifi className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span>Must be on the same Wi-Fi network</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span>Supports Play on PC, Play on Phone, or Play on Both!</span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t border-white/5 text-[11px]">
                  <span className="text-zinc-400">Or install native Android app:</span>
                  <a
                    href={`http://${info.ip}:${info.port}/felo-remote.apk`}
                    download="FeloRemote.apk"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-white hover:underline font-medium"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .APK</span>
                  </a>
                </div>
              </div>

              {/* Direct Link Input Box */}
              <div className="w-full flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-1.5 pl-3 text-xs">
                <span className="truncate text-zinc-400 font-mono select-all flex-1 text-[11px]">
                  {activeUrl}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy()}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1.5 transition active:scale-95 shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
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
                <div className="w-full mt-4 space-y-2 border-t border-white/10 pt-3 text-left">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-400" />
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
                          className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition ${
                            isThisDevPlaying
                              ? 'bg-emerald-500/10 border-emerald-500/40 shadow-sm shadow-emerald-500/5'
                              : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isThisDevPlaying
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-white/5 text-zinc-300'
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
                                <p className="text-xs font-bold text-white truncate">
                                  {dev.device_name || (isDevPc ? 'Felo Desktop' : 'Mobile Device')}
                                </p>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-white/10 text-zinc-300 border border-white/10">
                                  {devLabel}
                                </span>
                                {isThisDevPlaying && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                                    Currently Playing
                                  </span>
                                )}
                              </div>
                              <p
                                className={`text-[10px] truncate ${
                                  isThisDevPlaying ? 'text-emerald-400 font-medium' : 'text-zinc-400'
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
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition cursor-pointer active:scale-95"
                            >
                              Pull to PC
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSendToMobile(dev)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer active:scale-95 shadow-sm ${
                                transferredDeviceId === dev.id
                                  ? 'bg-emerald-400 text-black'
                                  : 'bg-emerald-500 hover:bg-emerald-400 text-black'
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
          <div className="px-6 py-3 bg-black/20 border-t border-white/5 flex items-center justify-between text-xs text-zinc-400">
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 hover:text-white transition disabled:opacity-50"
              title="Invalidates previous pairing and generates a new QR code"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Reset Pairing Token</span>
            </button>
            <button
              type="button"
              onClick={handleToggle}
              className="text-zinc-500 hover:text-red-400 transition"
            >
              Disable
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
