import { useState, useEffect, useCallback } from 'react'
import {
  Laptop2,
  Smartphone,
  X,
  Wifi,
  ShieldCheck,
  Check,
  Radio,
  User,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { remoteClient, type RemotePlayerState, type PlaybackTarget } from './remoteClient'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  useConnectedDeviceStore,
  sendDeviceCommand
} from '../../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase'
import { detectDeviceInfo, getDeviceDisplayName } from '../../lib/deviceInfo'
import type { UserConnectedDevice } from '../../online/types'

interface MobileDeviceSheetProps {
  state: RemotePlayerState
  isConnected: boolean
  isOpen: boolean
  onClose: () => void
}

export default function MobileDeviceSheet({
  state,
  isConnected: _isConnected,
  isOpen,
  onClose
}: MobileDeviceSheetProps) {
  const navigate = useNavigate()
  const user = useOnlineStore((s) => s.user)

  const [switching, setSwitching] = useState(false)
  const deviceInfo = detectDeviceInfo()
  const thisDeviceName = getDeviceDisplayName()

  const activeRemote = useConnectedDeviceStore((s) => s.activePlayback)
  const myDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null

  // Discovered desktop devices from Supabase
  const [discoveredDevices, setDiscoveredDevices] = useState<UserConnectedDevice[]>([])
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)

  const currentTarget: PlaybackTarget = state.targetDevice || remoteClient.getTargetDevice()

  // Fetch discovered active devices when logged in
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
        // Filter out devices with heartbeat older than 3 minutes
        const now = Date.now()
        const activeList = data.filter((d: any) => {
          const age = now - new Date(d.last_seen_at).getTime()
          return age < 180_000 && d.device_type === 'desktop'
        })
        setDiscoveredDevices(activeList)
      }
    } catch (err) {
      console.warn('[MobileDeviceSheet] Failed to load devices:', err)
    } finally {
      setIsLoadingDevices(false)
    }
  }, [user?.id])

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

  if (!isOpen) return null

  const handleSelectDevice = async (target: PlaybackTarget) => {
    if (currentTarget === target && target !== 'mobile') return
    setSwitching(true)
    try {
      if (
        target === 'mobile' &&
        activeRemote &&
        activeRemote.activeDeviceId !== myDeviceId &&
        user?.id
      ) {
        // Pause active remote desktop
        await sendDeviceCommand(user.id, activeRemote.activeDeviceId, 'pause')

        // Hand over song to local mobile player
        if (activeRemote.song) {
          usePlayerStore.getState().setQueue([activeRemote.song], 0, {
            type: 'library',
            title: 'Transferred Playback'
          })
          if (typeof activeRemote.position === 'number' && activeRemote.position > 0) {
            setTimeout(() => {
              usePlayerStore.getState().seek(activeRemote.position)
            }, 80)
          }
        }
      }
      await remoteClient.setTargetDevice(target)
    } finally {
      setSwitching(false)
    }
  }

  const handleConnectToDiscoveredDevice = async (device: UserConnectedDevice) => {
    if (!device.local_ip) return
    const targetUrl = `http://${device.local_ip}:${device.port || 4788}`
    remoteClient.configure(targetUrl, device.token || '')
    await handleSelectDevice('desktop')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] bg-[#121212] flex flex-col text-white animate-in slide-in-from-bottom duration-200 select-none pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {/* Top Drag Handle Indicator */}
      <div className="w-10 h-1.5 rounded-full bg-white/20 mx-auto mt-2 mb-1 shrink-0" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#181818]/60 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <Radio className="w-6 h-6 text-emerald-400" />
          <div>
            <h2 className="text-lg font-bold">Connect to a Device</h2>
            <p className="text-xs text-zinc-400">Choose where to output audio</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* LOGGED OUT STATE: Spotify Connect Call to Action */}
        {!user ? (
          <div className="bg-gradient-to-br from-emerald-950/40 via-zinc-900 to-zinc-900 border border-emerald-500/20 rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <Radio className="w-6 h-6 animate-pulse" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-bold text-white">Spotify Connect with Felo</h3>
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                </div>
                <p className="text-[11px] text-emerald-400/90 font-medium">
                  Log in to see all your connected devices
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Log in to your Felo account to see and seamlessly control all your desktop players in real time without entering IP addresses or pairing tokens.
            </p>

            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/account')
              }}
              className="w-full py-3 rounded-full bg-white text-black font-bold text-xs hover:bg-zinc-200 transition active:scale-95 shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <User className="w-4 h-4" />
              <span>Log In or Sign Up to Connect Devices</span>
            </button>
          </div>
        ) : (
          /* LOGGED IN STATE: Discovered Devices Section */
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                <span>Connected Devices ({discoveredDevices.length})</span>
              </h3>
              <button
                type="button"
                onClick={() => void fetchDevices()}
                className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 transition"
                title="Refresh discovered devices"
              >
                <RefreshCw className={`w-3 h-3 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {discoveredDevices.length > 0 ? (
              <div className="space-y-2.5">
                {discoveredDevices.map((device) => {
                  const isDevicePlaying =
                    activeRemote?.activeDeviceId === device.id && activeRemote.isPlaying
                  const isDeviceActive =
                    isDevicePlaying ||
                    (currentTarget === 'desktop' &&
                      Boolean(device.local_ip && remoteClient.getBaseUrl().includes(device.local_ip)))

                  return (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => void handleConnectToDiscoveredDevice(device)}
                      disabled={switching}
                      className={`w-full p-4 rounded-2xl text-left transition flex items-center justify-between border cursor-pointer ${
                        isDeviceActive
                          ? 'bg-white/[0.08] border-emerald-500/50 shadow-lg shadow-emerald-500/5'
                          : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                            isDeviceActive
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          <Laptop2
                            className={`w-6 h-6 ${isDeviceActive && (state.isPlaying || isDevicePlaying) ? 'animate-pulse' : ''}`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-white truncate">
                              {device.device_name || 'Felo Desktop'}
                            </h4>
                            {isDeviceActive && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                                {isDevicePlaying ? 'Currently Playing' : 'Active Output'}
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-xs mt-0.5 truncate ${
                              isDeviceActive ? 'text-emerald-400 font-medium' : 'text-zinc-400'
                            }`}
                          >
                            {isDevicePlaying && activeRemote?.song
                              ? `${activeRemote.song.title} • ${activeRemote.song.artist}`
                              : isDeviceActive
                                ? state.isPlaying || isDevicePlaying
                                  ? 'Playing on PC speakers'
                                  : 'Desktop speakers ready'
                                : `Wi-Fi IP: ${device.local_ip || 'Local Network'}`}
                          </p>
                        </div>
                      </div>

                      {isDeviceActive ? (
                        <div className="w-7 h-7 rounded-full bg-emerald-400 flex items-center justify-center text-black shrink-0">
                          <Check className="w-4 h-4 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-zinc-600 shrink-0" />
                      )}
                    </button>
                  )
                })}
                {typeof window !== 'undefined' && window.location.protocol === 'https:' && (
                  <p className="text-[10px] text-zinc-500 px-1 pt-1 leading-normal">
                    Tip: If your browser blocks local IP connections over HTTPS, open{' '}
                    <span className="text-zinc-400 font-mono">http://&lt;desktop-ip&gt;:4788</span> directly on your phone.
                  </p>
                )}
              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-zinc-900/60 border border-white/5 text-center flex flex-col items-center">
                <Laptop2 className="w-8 h-8 text-zinc-600 mb-2" />
                <p className="text-xs font-semibold text-zinc-300">
                  No active Felo Desktop players found
                </p>
                <p className="text-[11px] text-zinc-500 max-w-xs mt-1 leading-relaxed">
                  Open Felo on your computer and make sure you are logged into this account ({user.email}). It will connect automatically.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SECTION: PLAYBACK OUTPUT TARGETS */}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 px-1">
            Playback Target
          </h3>

          <div className="space-y-3">
            {/* 1. Mobile Device (This Phone / Browser) Card */}
            <button
              type="button"
              onClick={() => handleSelectDevice('mobile')}
              disabled={switching}
              className={`w-full p-4 rounded-2xl text-left transition flex items-center justify-between border cursor-pointer ${
                currentTarget === 'mobile'
                  ? 'bg-white/[0.08] border-white/40 shadow-lg shadow-white/5'
                  : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    currentTarget === 'mobile'
                      ? 'bg-white/10 text-white'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <Smartphone
                    className={`w-6 h-6 ${currentTarget === 'mobile' && state.isPlaying ? 'animate-pulse' : ''}`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white truncate">{thisDeviceName}</h4>
                    {currentTarget === 'mobile' && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-white/20 text-white">
                        This Device
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'mobile' ? 'text-white font-medium' : 'text-zinc-400'
                    }`}
                  >
                    {currentTarget === 'mobile'
                      ? state.isPlaying
                        ? `Playing on ${thisDeviceName} speakers`
                        : `${thisDeviceName} output active`
                      : `Stream audio directly to ${thisDeviceName}`}
                  </p>
                </div>
              </div>

              {currentTarget === 'mobile' ? (
                <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full border border-zinc-600 shrink-0" />
              )}
            </button>

            {/* 2. Play on Both Devices (Dual Audio Sync) Card */}
            <button
              type="button"
              onClick={() => handleSelectDevice('both')}
              disabled={switching}
              className={`w-full p-4 rounded-2xl text-left transition flex items-center justify-between border cursor-pointer ${
                currentTarget === 'both'
                  ? 'bg-white/[0.08] border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                  : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    currentTarget === 'both'
                      ? 'bg-gradient-to-br from-amber-500/20 to-emerald-500/20 text-white border border-white/20'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    <Laptop2
                      className={`w-5 h-5 -mr-1.5 ${currentTarget === 'both' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                    <Smartphone
                      className={`w-4 h-4 text-emerald-400 ${currentTarget === 'both' && state.isPlaying ? 'animate-pulse' : ''}`}
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white truncate">Play on Both Devices</h4>
                    {currentTarget === 'both' && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        {state.isPlaying && (
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-full bg-emerald-400 animate-pulse" />
                            <span
                              className="w-0.5 h-2/3 bg-emerald-400 animate-pulse"
                              style={{ animationDelay: '150ms' }}
                            />
                            <span
                              className="w-0.5 h-4/5 bg-emerald-400 animate-pulse"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'both' ? 'text-emerald-400 font-medium' : 'text-zinc-400'
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
                <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full border border-zinc-600 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Feature Highlights Card */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 text-xs space-y-2.5 text-zinc-300">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Instant playback handover between PC and {deviceInfo.model || 'Phone'}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Wifi className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>Local High-Quality Wi-Fi Audio Streaming</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>Automatic discovery via same Felo account</span>
          </div>
          {user?.email && (
            <div className="pt-1 text-[11px] text-zinc-500 font-mono truncate">
              Connected Account: {user.email}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
