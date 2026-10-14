import { useState, useEffect } from 'react'
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
  Laptop2
} from 'lucide-react'
import { remoteClient, type PlaybackTarget } from '../../pages/Remote/remoteClient'

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
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [qrMode, setQrMode] = useState<'cloudflare' | 'local'>('cloudflare')

  // Web mode state
  const [webHostInput, setWebHostInput] = useState(() => remoteClient.getBaseUrl())
  const [webTokenInput, setWebTokenInput] = useState(() => remoteClient.getToken())
  const [currentTarget, setCurrentTarget] = useState<PlaybackTarget>(() => remoteClient.getTargetDevice())
  const [isWebConnected, setIsWebConnected] = useState(() => remoteClient.getIsConnected())

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

  const handleSaveWebConnection = (e: React.FormEvent) => {
    e.preventDefault()
    if (webHostInput) remoteClient.setBaseUrl(webHostInput)
    if (webTokenInput) remoteClient.setToken(webTokenInput)
  }

  const handleSelectWebTarget = async (target: PlaybackTarget) => {
    setCurrentTarget(target)
    await remoteClient.setTargetDevice(target)
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
            /* --- WEB BROWSER MODE --- */
            <div className="w-full space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 px-0.5">
                  Playback Output
                </h3>
                <div className="space-y-2.5">
                  {/* 1. This Web Browser */}
                  <button
                    type="button"
                    onClick={() => handleSelectWebTarget('mobile')}
                    className={`w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border cursor-pointer ${
                      currentTarget === 'mobile'
                        ? 'bg-white/[0.08] border-white/40 shadow-md'
                        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-white shrink-0">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white truncate">This Web Browser</h4>
                        <p className="text-[11px] text-zinc-400 truncate">Play audio directly in this browser</p>
                      </div>
                    </div>
                    {currentTarget === 'mobile' ? (
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-zinc-600 shrink-0" />
                    )}
                  </button>

                  {/* 2. Felo Desktop */}
                  <button
                    type="button"
                    onClick={() => handleSelectWebTarget('desktop')}
                    className={`w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border cursor-pointer ${
                      currentTarget === 'desktop'
                        ? 'bg-white/[0.08] border-white/40 shadow-md'
                        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-white shrink-0">
                        <Laptop2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white truncate">Felo Desktop</h4>
                        <p className="text-[11px] text-zinc-400 truncate">
                          {isWebConnected ? 'Play through PC speakers' : 'Requires desktop connection'}
                        </p>
                      </div>
                    </div>
                    {currentTarget === 'desktop' ? (
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-zinc-600 shrink-0" />
                    )}
                  </button>

                  {/* 3. Play on Both (Dual Audio Sync) */}
                  <button
                    type="button"
                    onClick={() => handleSelectWebTarget('both')}
                    className={`w-full p-3.5 rounded-xl text-left transition flex items-center justify-between border cursor-pointer ${
                      currentTarget === 'both'
                        ? 'bg-white/[0.08] border-white/40 shadow-md'
                        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-emerald-500/20 border border-white/10 flex items-center justify-center text-white shrink-0">
                        <Radio className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold text-white truncate">Play on Both</h4>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                            Dual Sync
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-400/90 truncate">
                          Synchronized audio on Browser + PC simultaneously
                        </p>
                      </div>
                    </div>
                    {currentTarget === 'both' ? (
                      <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-zinc-600 shrink-0" />
                    )}
                  </button>
                </div>
              </div>

              {/* Desktop Connection Form */}
              <div className="pt-2 border-t border-white/5">
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Desktop Connection</h4>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className={`w-2 h-2 rounded-full ${isWebConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                    <span className={isWebConnected ? 'text-emerald-400 font-medium' : 'text-zinc-500'}>
                      {isWebConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleSaveWebConnection} className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-2.5 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1 text-[11px]">Desktop Server URL</label>
                    <input
                      type="text"
                      value={webHostInput}
                      onChange={(e) => setWebHostInput(e.target.value)}
                      placeholder="http://192.168.1.X:4788"
                      className="w-full bg-zinc-800 text-white p-2 rounded-lg border border-white/10 focus:border-white/40 outline-none font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1 text-[11px]">Pairing Token</label>
                    <input
                      type="text"
                      value={webTokenInput}
                      onChange={(e) => setWebTokenInput(e.target.value)}
                      placeholder="32-character pairing token"
                      className="w-full bg-zinc-800 text-white p-2 rounded-lg border border-white/10 focus:border-white/40 outline-none font-mono text-[11px]"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-white text-black font-bold rounded-lg hover:bg-white/90 transition text-xs cursor-pointer active:scale-95"
                  >
                    Save & Connect to Desktop
                  </button>
                </form>
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
