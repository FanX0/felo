import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Laptop2,
  Smartphone,
  Globe,
  X,
  Wifi,
  ShieldCheck,
  Check,
  MonitorSpeaker,
  User,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Link2,
  SlidersHorizontal
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { remoteClient, type RemotePlayerState, type PlaybackTarget } from './remoteClient'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { useListeningStore } from '../../hooks/useListeningStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from '../../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase'
import {
  detectDeviceInfo,
  getDeviceDisplayName,
  getDeviceCategory,
  getDeviceCategoryLabel,
  isPcDevice
} from '../../lib/deviceInfo'
import { resolveSongAudioUrl } from '../../lib/songAudioResolver'
import type { UserConnectedDevice } from '../../online/types'

interface MobileDeviceSheetProps {
  state: RemotePlayerState
  isConnected: boolean
  isOpen: boolean
  onClose: () => void
}

export default function MobileDeviceSheet({
  state,
  isConnected,
  isOpen,
  onClose
}: MobileDeviceSheetProps) {
  const navigate = useNavigate()
  const user = useOnlineStore((s) => s.user)

  const [switching, setSwitching] = useState(false)
  const [showManualConnect, setShowManualConnect] = useState(false)
  const [manualIp, setManualIp] = useState(() => remoteClient.getBaseUrl() || '')
  const [manualToken, setManualToken] = useState(() => remoteClient.getToken() || '')

  const deviceInfo = detectDeviceInfo()
  const thisDeviceName = getDeviceDisplayName()

  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const storeDiscovered = useConnectedDeviceStore((s) => s.discoveredDevices)
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null

  // Discovered desktop and mobile devices from Supabase DB
  const [dbDevices, setDbDevices] = useState<UserConnectedDevice[]>([])
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)

  const currentTarget: PlaybackTarget = state.targetDevice || remoteClient.getTargetDevice()

  // Fetch discovered active devices from Supabase when logged in
  const fetchDevices = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured) return
    setIsLoadingDevices(true)
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
        // Accept any active device heartbeat under 5 minutes
        const activeList = data.filter((d: any) => {
          const age = now - new Date(d.last_seen_at).getTime()
          return age < 300_000 && d.id !== myDeviceId
        })
        setDbDevices(activeList)
      }
    } catch (err) {
      console.warn('[MobileDeviceSheet] Failed to load devices:', err)
    } finally {
      setIsLoadingDevices(false)
    }
  }, [user?.id, myDeviceId])

  useEffect(() => {
    if (!isOpen || !user?.id || !isSupabaseConfigured) return undefined

    void fetchDevices()
    const pollTimer = setInterval(fetchDevices, 15_000)

    const supabase = getSupabase()
    const channel = supabase
      .channel(`user_devices_presence_${user.id}`)
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
      clearInterval(pollTimer)
      void supabase.removeChannel(channel)
    }
  }, [isOpen, user?.id, fetchDevices])

  // Unified list of all discovered devices across Supabase, Cloud Broadcast, and Local LAN
  const allDevices = useMemo(() => {
    const map = new Map<string, UserConnectedDevice>()

    // 1. Devices from Supabase database
    for (const d of dbDevices) {
      if (d.id !== myDeviceId) {
        map.set(d.id, d)
      }
    }

    // 2. Devices from store (populated by realtime broadcast)
    for (const d of storeDiscovered) {
      if (d.id !== myDeviceId) {
        if (!map.has(d.id)) {
          map.set(d.id, d)
        } else {
          // Merge metadata
          const existing = map.get(d.id)!
          map.set(d.id, { ...existing, ...d })
        }
      }
    }

    // 3. Active Remote device currently playing via Cloud Broadcast
    if (activeRemote && activeRemote.activeDeviceId !== myDeviceId) {
      const existing = map.get(activeRemote.activeDeviceId)
      map.set(activeRemote.activeDeviceId, {
        id: activeRemote.activeDeviceId,
        user_id: user?.id || '',
        device_name: activeRemote.activeDeviceName || existing?.device_name || 'Felo Desktop',
        device_type: activeRemote.activeDeviceType || existing?.device_type || 'desktop',
        local_ip: existing?.local_ip,
        port: existing?.port,
        token: existing?.token,
        last_seen_at: new Date(activeRemote.timestamp || Date.now()).toISOString(),
        is_active: true
      })
    }

    // 4. Local LAN-connected Desktop (via remoteClient HTTP/SSE)
    const lanBaseUrl = remoteClient.getBaseUrl()
    const isLanActive = isConnected || (lanBaseUrl && !lanBaseUrl.includes(window.location.host))
    if (isLanActive) {
      let lanIp = ''
      let lanPort = 4788
      try {
        const parsed = new URL(lanBaseUrl)
        lanIp = parsed.hostname
        lanPort = parsed.port ? Number(parsed.port) : 4788
      } catch {
        // ignore
      }

      // Check if this LAN device already exists in the map
      let foundExistingKey: string | null = null
      for (const [key, dev] of map.entries()) {
        if (dev.local_ip && dev.local_ip === lanIp) {
          foundExistingKey = key
          break
        }
      }

      if (foundExistingKey) {
        const existing = map.get(foundExistingKey)!
        map.set(foundExistingKey, {
          ...existing,
          local_ip: lanIp,
          port: lanPort,
          token: remoteClient.getToken() || existing.token,
          is_active: true
        })
      } else {
        map.set('lan-desktop', {
          id: 'lan-desktop',
          user_id: user?.id || '',
          device_name: state.deviceName || (lanIp ? `Felo Desktop (${lanIp})` : 'Felo Desktop'),
          device_type: 'desktop',
          local_ip: lanIp || undefined,
          port: lanPort,
          token: remoteClient.getToken() || undefined,
          last_seen_at: new Date().toISOString(),
          is_active: true
        })
      }
    }

    return Array.from(map.values())
  }, [dbDevices, storeDiscovered, activeRemote, myDeviceId, isConnected, state.deviceName, user?.id])

  if (!isOpen) return null

  const handleSelectDevice = async (target: PlaybackTarget) => {
    if (currentTarget === target && target !== 'mobile') return
    setSwitching(true)
    try {
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

        // Hand over song to local mobile player with resolved stream URL
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
          const targetDeviceId = activeRemote?.activeDeviceId || 'desktop'
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
    } finally {
      setSwitching(false)
    }
  }

  const handleConnectToDevice = async (device: UserConnectedDevice) => {
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
      usePlayerStore.getState().setIsPlaying(false)
      if (user?.id) {
        void sendDeviceCommand(user.id, device.id, 'play')
      }
      await handleSelectDevice('desktop')
    } else {
      await handleSelectDevice('mobile')
    }
  }

  const handleManualConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let url = manualIp.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`
    }
    remoteClient.configure(url, manualToken.trim())
    await handleSelectDevice('desktop')
    setShowManualConnect(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] bg-surface flex flex-col text-text animate-in slide-in-from-bottom duration-200 select-none pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Top Drag Handle Indicator */}
      <div className="w-10 h-1.5 rounded-full bg-border mx-auto mt-2 mb-1 shrink-0" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-elevated/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <MonitorSpeaker className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-bold text-text">Connect to a Device</h2>
            <p className="text-xs text-text-muted">Choose where to output audio</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text hover:bg-hover transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* SECTION 1: CONNECTED & DISCOVERED DEVICES */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <MonitorSpeaker className="w-3.5 h-3.5 text-primary" />
              <span>Available Devices ({allDevices.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => void fetchDevices()}
              className="text-[11px] text-text-muted hover:text-text flex items-center gap-1 transition cursor-pointer"
              title="Refresh discovered devices"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingDevices ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {allDevices.length > 0 ? (
            <div className="space-y-2.5">
              {allDevices.map((device) => {
                const devCategory = getDeviceCategory(device)
                const devLabel = getDeviceCategoryLabel(devCategory)
                const isDevPc = isPcDevice(devCategory)
                const isDevicePlaying =
                  activeRemote?.activeDeviceId === device.id && activeRemote.isPlaying
                const isLanMatch =
                  Boolean(device.local_ip && remoteClient.getBaseUrl().includes(device.local_ip)) ||
                  (isConnected && device.id === 'lan-desktop')
                const isDeviceActive =
                  isDevicePlaying ||
                  (currentTarget === 'desktop' &&
                    (isLanMatch ||
                      activeRemote?.activeDeviceId === device.id ||
                      (Boolean(device.device_name) && Boolean(state.deviceName) && device.device_name === state.deviceName)))

                return (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => void handleConnectToDevice(device)}
                    disabled={switching}
                    className={`w-full p-4 rounded-2xl text-left transition-colors flex items-center justify-between border cursor-pointer ${
                      isDeviceActive
                        ? 'bg-surface-elevated border-primary/40 shadow-sm'
                        : 'bg-surface border-border hover:bg-surface-elevated'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                          isDeviceActive
                            ? 'bg-surface border border-primary/30 text-primary'
                            : 'bg-surface-elevated border border-border text-text-muted'
                        }`}
                      >
                        {devCategory === 'app_pc' ? (
                          <Laptop2
                            className={`w-6 h-6 ${isDeviceActive && (state.isPlaying || isDevicePlaying) ? 'animate-pulse' : ''}`}
                          />
                        ) : devCategory === 'web_pc' ? (
                          <Globe
                            className={`w-6 h-6 ${isDeviceActive && (state.isPlaying || isDevicePlaying) ? 'animate-pulse' : ''}`}
                          />
                        ) : (
                          <Smartphone
                            className={`w-6 h-6 ${isDeviceActive && (state.isPlaying || isDevicePlaying) ? 'animate-pulse' : ''}`}
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-text truncate">
                            {device.device_name || (isDevPc ? 'Felo Desktop' : 'Mobile Device')}
                          </h4>
                          <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                            {devLabel}
                          </span>
                          {isDeviceActive && (
                            <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary">
                              {isDevicePlaying ? 'Currently Playing' : 'Active Output'}
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-xs mt-0.5 truncate ${
                            isDeviceActive ? 'text-primary font-medium' : 'text-text-muted'
                          }`}
                        >
                          {isDevicePlaying && activeRemote?.song
                            ? `${activeRemote.song.title} • ${activeRemote.song.artist}`
                            : isDeviceActive
                              ? state.isPlaying || isDevicePlaying
                                ? isDevPc
                                  ? 'Playing on PC speakers'
                                  : 'Playing on device'
                                : 'Ready for playback'
                              : device.local_ip
                                ? `Wi-Fi IP: ${device.local_ip}`
                                : 'Connected via Felo Account'}
                        </p>
                      </div>
                    </div>

                    {isDeviceActive ? (
                      <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                        <Check className="w-4 h-4 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-border shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-surface border border-border text-center flex flex-col items-center">
              <Laptop2 className="w-8 h-8 text-text-muted opacity-40 mb-2" />
              <p className="text-xs font-bold text-text">
                No active Felo players found
              </p>
              <p className="text-[11px] text-text-muted max-w-xs mt-1 leading-relaxed">
                Open Felo on your computer or phone. Make sure both devices are on the same Wi-Fi or signed in to the same account.
              </p>
            </div>
          )}
        </div>

        {/* SECTION 2: PLAYBACK OUTPUT TARGETS */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3 px-1">
            Playback Target
          </h3>

          <div className="space-y-3">
            {/* 1. Mobile / Current Device Card */}
            <button
              type="button"
              onClick={() => handleSelectDevice('mobile')}
              disabled={switching}
              className={`w-full p-4 rounded-2xl text-left transition-colors flex items-center justify-between border cursor-pointer ${
                currentTarget === 'mobile'
                  ? 'bg-surface-elevated border-primary/40 shadow-sm'
                  : 'bg-surface border-border hover:bg-surface-elevated'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    currentTarget === 'mobile'
                      ? 'bg-surface border border-primary/30 text-primary'
                      : 'bg-surface-elevated border border-border text-text-muted'
                  }`}
                >
                  {deviceInfo.category === 'app_pc' ? (
                    <Laptop2
                      className={`w-6 h-6 ${currentTarget === 'mobile' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                  ) : deviceInfo.category === 'web_pc' ? (
                    <Globe
                      className={`w-6 h-6 ${currentTarget === 'mobile' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                  ) : (
                    <Smartphone
                      className={`w-6 h-6 ${currentTarget === 'mobile' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-text truncate">{thisDeviceName}</h4>
                    {currentTarget === 'mobile' && (
                      <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono font-bold text-primary">
                        This Device
                      </span>
                    )}
                    <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-mono font-bold text-text-muted">
                      {deviceInfo.categoryLabel}
                    </span>
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'mobile' ? 'text-primary font-medium' : 'text-text-muted'
                    }`}
                  >
                    {currentTarget === 'mobile'
                      ? state.isPlaying
                        ? `Playing on ${thisDeviceName}`
                        : `${thisDeviceName} output active`
                      : `Stream audio directly to ${thisDeviceName}`}
                  </p>
                </div>
              </div>

              {currentTarget === 'mobile' ? (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full border border-border shrink-0" />
              )}
            </button>

            {/* 2. Play on Both Devices (Dual Audio Sync) Card */}
            <button
              type="button"
              onClick={() => handleSelectDevice('both')}
              disabled={switching}
              className={`w-full p-4 rounded-2xl text-left transition-colors flex items-center justify-between border cursor-pointer ${
                currentTarget === 'both'
                  ? 'bg-surface-elevated border-primary/40 shadow-sm'
                  : 'bg-surface border-border hover:bg-surface-elevated'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    currentTarget === 'both'
                      ? 'bg-surface border border-primary/30 text-primary'
                      : 'bg-surface-elevated border border-border text-text-muted'
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    <Laptop2
                      className={`w-5 h-5 -mr-1.5 ${currentTarget === 'both' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                    <Smartphone
                      className={`w-4 h-4 text-primary ${currentTarget === 'both' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-text truncate">Play on Both Devices</h4>
                    {currentTarget === 'both' && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        {state.isPlaying && (
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-full bg-primary animate-pulse" />
                            <span
                              className="w-0.5 h-2/3 bg-primary animate-pulse"
                              style={{ animationDelay: '150ms' }}
                            />
                            <span
                              className="w-0.5 h-4/5 bg-primary animate-pulse"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'both' ? 'text-primary font-medium' : 'text-text-muted'
                    }`}
                  >
                    {currentTarget === 'both'
                      ? state.isPlaying
                        ? 'Synchronized audio on PC and Phone'
                        : 'Dual playback ready'
                      : 'Play simultaneously on Desktop and Phone in sync'}
                  </p>
                </div>
              </div>

              {currentTarget === 'both' ? (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full border border-border shrink-0" />
              )}
            </button>

            {currentTarget === 'both' && (
              <div className="flex items-center justify-between px-3 py-2 bg-surface border border-border rounded-xl text-xs mt-1">
                <span className="text-text-muted font-medium">Fine-tune dual device sync</span>
                <button
                  type="button"
                  disabled={useListeningStore.getState().myRole === 'host'}
                  onClick={() => {
                    if (useListeningStore.getState().myRole !== 'host') {
                      useListeningStore.getState().setIsManualSyncModalOpen(true)
                    }
                  }}
                  title={useListeningStore.getState().myRole === 'host' ? 'Manual sync is disabled for host' : 'Fine-tune dual device sync'}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition flex items-center gap-1 ${
                    useListeningStore.getState().myRole === 'host'
                      ? 'bg-surface text-text-muted opacity-40 cursor-not-allowed border-border'
                      : 'bg-surface-elevated hover:bg-hover text-text border-border cursor-pointer'
                  }`}
                >
                  <SlidersHorizontal className={`w-3 h-3 ${useListeningStore.getState().myRole === 'host' ? 'text-text-muted' : 'text-primary'}`} />
                  <span>Manual Sync (ms)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* LOGGED OUT CALL TO ACTION BANNER (NON-BLOCKING) */}
        {!user && (
          <div className="border border-border bg-surface-elevated rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-surface border border-border flex items-center justify-center text-primary shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-text">Enable Cloud Remote Control</h4>
                <p className="text-[11px] text-text-muted">
                  Log in on PC and Phone for instant automatic discovery
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/account')
              }}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <User className="w-4 h-4" />
              <span>Log In to Felo Account</span>
            </button>
          </div>
        )}

        {/* MANUAL WI-FI IP CONNECTION ACCORDION */}
        <div className="border border-border rounded-2xl p-4 bg-surface">
          <button
            type="button"
            onClick={() => setShowManualConnect(!showManualConnect)}
            className="w-full flex items-center justify-between text-xs font-bold text-text hover:text-primary transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              <span>Manual Wi-Fi Connection (IP & Token)</span>
            </div>
            {showManualConnect ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showManualConnect && (
            <form onSubmit={handleManualConnectSubmit} className="mt-3.5 space-y-3 pt-3 border-t border-border">
              <p className="text-[11px] text-text-muted leading-relaxed">
                If automatic discovery is blocked by your Wi-Fi router, enter your PC&apos;s local IP address and pairing token found in Felo Desktop &gt; Connect Your Phone.
              </p>
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                  Desktop IP / Address
                </label>
                <input
                  type="text"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  placeholder="http://192.168.1.5:4788"
                  className="w-full bg-surface-elevated text-text px-3 py-2 rounded-xl border border-border focus:border-primary outline-none text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                  Pairing Token (Optional)
                </label>
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Token from desktop QR code"
                  className="w-full bg-surface-elevated text-text px-3 py-2 rounded-xl border border-border focus:border-primary outline-none text-xs font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs transition cursor-pointer active:scale-95 shadow-sm"
              >
                Connect to PC
              </button>
            </form>
          )}
        </div>

        {/* Feature Highlights Card */}
        <div className="bg-surface border border-border rounded-2xl p-4 text-xs space-y-2.5 text-text-muted">
          <div className="flex items-center gap-2.5">
            <MonitorSpeaker className="w-4 h-4 text-primary shrink-0" />
            <span>Instant playback handover between PC and {deviceInfo.model || 'Phone'}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Wifi className="w-4 h-4 text-text-muted shrink-0" />
            <span>Local High-Quality Wi-Fi Audio Streaming</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
            <span>Seamless Spotify Connect across all your devices</span>
          </div>
          {user?.email && (
            <div className="pt-1 text-[11px] text-text-muted/70 font-mono truncate">
              Connected Account: {user.email}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
