import { useState, useEffect } from 'react'
import {
  Smartphone,
  Copy,
  Check,
  RefreshCw,
  X,
  Wifi,
  ShieldCheck,
  Radio,
  Download
} from 'lucide-react'

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
  connectedClients: number
}

export default function RemoteControlModal({ isOpen, onClose }: RemoteControlModalProps) {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

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
    void loadInfo()
    // Poll every 3 seconds while modal is open to update connected clients count
    const interval = setInterval(() => {
      void loadInfo()
    }, 3000)
    return () => clearInterval(interval)
  }, [isOpen])

  if (!isOpen) return null

  const handleCopy = async () => {
    if (!info?.url) return
    try {
      await navigator.clipboard.writeText(info.url)
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
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Connect Your Phone</h2>
              <p className="text-xs text-zinc-400">Remote control for Felo</p>
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
          ) : !info?.enabled ? (
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
                className="px-6 py-2.5 rounded-full bg-white text-black font-bold text-xs hover:bg-white/90 transition shadow-lg active:scale-95"
              >
                Enable Phone Remote
              </button>
            </div>
          ) : (
            <>
              {/* QR Code Container */}
              <div className="relative p-3 bg-white rounded-2xl shadow-xl flex items-center justify-center mb-4">
                {info.qrDataUrl ? (
                  <img
                    src={info.qrDataUrl}
                    alt="Scan with phone"
                    className="w-48 h-48 block rounded-lg select-none"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-black text-xs">
                    Generating QR...
                  </div>
                )}
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs mb-5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    info.connectedClients > 0
                      ? 'bg-white animate-pulse'
                      : 'bg-zinc-500'
                  }`}
                />
                <span className="font-medium text-zinc-300">
                  {info.connectedClients > 0
                    ? `${info.connectedClients} phone${info.connectedClients > 1 ? 's' : ''} connected`
                    : 'Point phone camera at QR code'}
                </span>
              </div>

              {/* Instructions */}
              <div className="w-full bg-white/[0.03] border border-white/5 rounded-xl p-3 text-xs space-y-2 mb-4">
                <div className="flex items-center gap-2 text-zinc-300 font-medium">
                  <Wifi className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  <span>Must be on the same Wi-Fi network</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span>Instant in Safari/Chrome (Add to Home Screen)</span>
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
                  {info.url}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium flex items-center gap-1.5 transition active:scale-95 shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-text" />
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
