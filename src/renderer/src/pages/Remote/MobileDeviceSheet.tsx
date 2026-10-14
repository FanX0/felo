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
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase'
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

  const [showConfig, setShowConfig] = useState(false)
  const [tokenInput, setTokenInput] = useState(remoteClient.getToken())
  const [serverUrl, setServerUrl] = useState(remoteClient.getBaseUrl())
  const [switching, setSwitching] = useState(false)

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
          return age < 180_000
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
    if (currentTarget === target) return
    setSwitching(true)
    try {
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

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault()
    remoteClient.configure(serverUrl, tokenInput)
    setShowConfig(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-[#121212] flex flex-col text-white animate-in slide-in-from-bottom duration-200 select-none pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
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
                  const isDeviceActive =
                    currentTarget === 'desktop' &&
                    Boolean(device.local_ip && remoteClient.getBaseUrl().includes(device.local_ip))

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
                            className={`w-6 h-6 ${isDeviceActive && state.isPlaying ? 'animate-pulse' : ''}`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-white truncate">
                              {device.device_name || 'Felo Desktop'}
                            </h4>
                            {isDeviceActive && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                                Active Output
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-xs mt-0.5 truncate ${
                              isDeviceActive ? 'text-emerald-400 font-medium' : 'text-zinc-400'
                            }`}
                          >
                            {isDeviceActive
                              ? state.isPlaying
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
                    <h4 className="text-sm font-bold text-white truncate">This Device</h4>
                    {currentTarget === 'mobile' && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-white" />
                        {state.isPlaying && (
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-full bg-white animate-pulse" />
                            <span
                              className="w-0.5 h-2/3 bg-white animate-pulse"
                              style={{ animationDelay: '150ms' }}
                            />
                            <span
                              className="w-0.5 h-4/5 bg-white animate-pulse"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'mobile' ? 'text-white font-medium' : 'text-zinc-400'
                    }`}
                  >
                    {currentTarget === 'mobile'
                      ? state.isPlaying
                        ? 'Streaming to phone / browser output'
                        : 'Device output active'
                      : 'Stream audio directly to this phone or browser'}
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
            <span>Instant playback handover between PC and Phone</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Wifi className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>Local High-Quality Wi-Fi Audio Streaming</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-zinc-400 shrink-0" />
            <span>Authenticated Local Session & Supabase Connect</span>
          </div>
          <div className="pt-1 text-[11px] text-zinc-500 font-mono truncate">
            Current Endpoint: {remoteClient.getBaseUrl() || 'Local Audio'}
          </div>
        </div>

        {/* Manual Connection Config Accordion (Secondary / Fallback) */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="text-xs text-zinc-400 hover:text-white underline cursor-pointer"
          >
            {showConfig ? 'Hide Manual Connection Settings' : 'Advanced: Manual IP / Token Entry'}
          </button>

          {showConfig && (
            <form
              onSubmit={handleSaveConfig}
              className="mt-4 p-4 rounded-xl bg-black/40 border border-white/10 space-y-3 text-xs"
            >
              <div>
                <label className="block text-zinc-400 mb-1 font-medium text-[11px]">
                  Desktop Server URL
                </label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.X:4788"
                  className="w-full bg-zinc-800 text-white p-2.5 rounded-lg border border-white/10 focus:border-white/40 outline-none font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1 font-medium text-[11px]">
                  Pairing Token
                </label>
                <input
                  type="text"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="32-character token"
                  className="w-full bg-zinc-800 text-white p-2.5 rounded-lg border border-white/10 focus:border-white/40 outline-none font-mono text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-white text-black font-bold rounded-lg hover:bg-white/90 transition text-xs cursor-pointer active:scale-95"
              >
                Save & Connect Manually
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
