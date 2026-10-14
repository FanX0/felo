import { useState } from 'react'
import { Laptop2, Smartphone, X, Wifi, ShieldCheck, Check, Radio } from 'lucide-react'
import { remoteClient, type RemotePlayerState, type PlaybackTarget } from './remoteClient'

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
  const [showConfig, setShowConfig] = useState(false)
  const [tokenInput, setTokenInput] = useState(remoteClient.getToken())
  const [serverUrl, setServerUrl] = useState(remoteClient.getBaseUrl())
  const [switching, setSwitching] = useState(false)

  if (!isOpen) return null

  const currentTarget: PlaybackTarget = state.targetDevice || remoteClient.getTargetDevice()

  const handleSelectDevice = async (target: PlaybackTarget) => {
    if (currentTarget === target) return
    setSwitching(true)
    try {
      await remoteClient.setTargetDevice(target)
    } finally {
      setSwitching(false)
    }
  }

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault()
    if (serverUrl) remoteClient.setBaseUrl(serverUrl)
    if (tokenInput) remoteClient.setToken(tokenInput)
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
          <Radio className="w-6 h-6 text-white" />
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
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 px-1">
            Playback Devices
          </h3>

          <div className="space-y-3">
            {/* 1. Desktop Speakers Device Card */}
            <button
              type="button"
              onClick={() => handleSelectDevice('desktop')}
              disabled={switching}
              className={`w-full p-4 rounded-2xl text-left transition flex items-center justify-between border cursor-pointer ${
                currentTarget === 'desktop'
                  ? 'bg-white/[0.08] border-white/40 shadow-lg shadow-white/5'
                  : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.06] hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    currentTarget === 'desktop'
                      ? 'bg-white/10 text-white'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  <Laptop2 className={`w-6 h-6 ${currentTarget === 'desktop' && state.isPlaying ? 'animate-pulse' : ''}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-white truncate">
                      {state.deviceName || 'Felo Desktop'}
                    </h4>
                    {currentTarget === 'desktop' && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary-amber" />
                        {state.isPlaying && (
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-full bg-primary-amber animate-pulse" />
                            <span className="w-0.5 h-2/3 bg-primary-amber animate-pulse" style={{ animationDelay: '150ms' }} />
                            <span className="w-0.5 h-4/5 bg-primary-amber animate-pulse" style={{ animationDelay: '300ms' }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'desktop' ? 'text-primary-amber font-medium' : 'text-zinc-400'
                    }`}
                  >
                    {currentTarget === 'desktop'
                      ? isConnected
                        ? state.isPlaying
                          ? 'Playing on PC speakers'
                          : 'Desktop speakers ready'
                        : 'Reconnecting...'
                      : 'Play through PC speakers'}
                  </p>
                </div>
              </div>

              {currentTarget === 'desktop' ? (
                <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-black shrink-0">
                  <Check className="w-4 h-4 stroke-[3]" />
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full border border-zinc-600 shrink-0" />
              )}
            </button>

            {/* 2. Mobile Device (This Phone) Card */}
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
                  <Smartphone className={`w-6 h-6 ${currentTarget === 'mobile' && state.isPlaying ? 'animate-pulse' : ''}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-white truncate">
                      This Mobile Device
                    </h4>
                    {currentTarget === 'mobile' && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary-amber" />
                        {state.isPlaying && (
                          <div className="flex items-end gap-0.5 h-3">
                            <span className="w-0.5 h-full bg-primary-amber animate-pulse" />
                            <span className="w-0.5 h-2/3 bg-primary-amber animate-pulse" style={{ animationDelay: '150ms' }} />
                            <span className="w-0.5 h-4/5 bg-primary-amber animate-pulse" style={{ animationDelay: '300ms' }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      currentTarget === 'mobile' ? 'text-primary-amber font-medium' : 'text-zinc-400'
                    }`}
                  >
                    {currentTarget === 'mobile'
                      ? state.isPlaying
                        ? 'Streaming to phone speakers / headphones'
                        : 'Phone output ready'
                      : 'Stream audio directly to this phone'}
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
          </div>
        </div>

        {/* Seamless Handover Notice */}
        <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-4 text-xs space-y-3 text-zinc-300">
          <div className="flex items-center gap-2.5">
            <Radio className="w-4 h-4 text-white" />
            <span>Instant playback handover between PC and Phone</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Wifi className="w-4 h-4 text-zinc-400" />
            <span>Local High-Quality Wi-Fi Audio Streaming</span>
          </div>
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-zinc-400" />
            <span>Authenticated Local Network Session</span>
          </div>
          <div className="pt-1 text-[11px] text-zinc-500 font-mono">
            Host: {remoteClient.getBaseUrl()}
          </div>
        </div>

        {/* Manual Connection Config Accordion */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="text-xs text-zinc-400 hover:text-white underline"
          >
            {showConfig ? 'Hide Connection Settings' : 'Change IP or Token Manually'}
          </button>

          {showConfig && (
            <form onSubmit={handleSaveConfig} className="mt-4 p-4 rounded-xl bg-black/40 border border-white/10 space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Desktop Server URL</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.X:4788"
                  className="w-full bg-zinc-800 text-white p-2.5 rounded-lg border border-white/10 focus:border-white/40 outline-none font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1 font-medium">Pairing Token</label>
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
                className="w-full py-2.5 bg-white text-black font-bold rounded-lg hover:bg-white/90 transition text-xs font-semibold cursor-pointer"
              >
                Save & Reconnect
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
