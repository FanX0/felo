import { useState, useEffect, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  Heart,
  X,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Star,
  Coins,
  Settings,
  Coffee,
  Gift,
  ArrowUpRight
} from 'lucide-react'
import {
  useSupportConfig,
  buildSaweriaUrl,
  buildTrakteerUrl,
  buildGithubRepoUrl,
  buildSolscanUrl
} from '../../lib/supportConfig'

interface SupportAboutModalProps {
  isOpen: boolean
  onClose: () => void
  currentVersion?: string
  latestVersion?: string | null
  updateAvailable?: boolean
  releaseUrl?: string | null
  onOpenSettings?: () => void
}

export default function SupportAboutModal({
  isOpen,
  onClose,
  currentVersion = '1.1.0-beta.1',
  latestVersion,
  updateAvailable = false,
  releaseUrl,
  onOpenSettings
}: SupportAboutModalProps): ReactElement | null {
  const { config, updateConfig } = useSupportConfig()
  const [copiedSol, setCopiedSol] = useState(false)
  const [isEditingConfig, setIsEditingConfig] = useState(false)
  const [tempSaweria, setTempSaweria] = useState(config.saweriaUsername)
  const [tempTrakteer, setTempTrakteer] = useState(config.trakteerUsername)
  const [tempSolana, setTempSolana] = useState(config.solanaAddress)

  useEffect(() => {
    setTempSaweria(config.saweriaUsername)
    setTempTrakteer(config.trakteerUsername)
    setTempSolana(config.solanaAddress)
  }, [config])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCopySolana = async () => {
    if (!config.solanaAddress) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(config.solanaAddress)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = config.solanaAddress
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopiedSol(true)
      setTimeout(() => setCopiedSol(false), 2500)
    } catch (err) {
      console.error('Failed to copy Solana address:', err)
    }
  }

  const handleSaveConfig = async () => {
    await updateConfig({
      saweriaUsername: tempSaweria.trim() || 'fanx0',
      trakteerUsername: tempTrakteer.trim() || 'fanx0',
      solanaAddress: tempSolana.trim()
    })
    setIsEditingConfig(false)
  }

  const saweriaUrl = buildSaweriaUrl(config.saweriaUsername)
  const trakteerUrl = buildTrakteerUrl(config.trakteerUsername)
  const githubUrl = buildGithubRepoUrl(config.githubRepo)

  const openUrl = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative my-8 w-full max-w-lg rounded-2xl border border-white/10 bg-[#141416] p-6 shadow-2xl flex flex-col gap-5 text-text animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-start justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-rose-500/20 via-primary-amber/20 to-emerald-500/20 border border-white/15 flex items-center justify-center shadow-inner">
              <Heart className="h-5 w-5 text-rose-400 fill-rose-500/20 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">Felo Music</h2>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  Free & Open Source
                </span>
              </div>
              <div className="flex items-center flex-wrap gap-x-2 text-xs text-text-muted mt-0.5">
                <span>Version {currentVersion}</span>
                {updateAvailable && latestVersion ? (
                  releaseUrl ? (
                    <button
                      type="button"
                      onClick={() => openUrl(releaseUrl)}
                      className="inline-flex items-center gap-1 rounded bg-primary-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-primary-amber hover:bg-primary-amber/30 transition-colors cursor-pointer"
                      title="View release notes"
                    >
                      <span>Update v{latestVersion} available</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-primary-amber font-semibold">
                      • Update v{latestVersion} available
                    </span>
                  )
                ) : (
                  <span className="text-text-muted/70">• Up to date</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-white"
            title="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mission / Value Proposition */}
        <div className="rounded-xl border border-white/5 bg-surface/60 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-text">
            <Sparkles className="h-4 w-4 text-primary-amber" />
            <span>Forever Free, Zero Ads, Privacy-First</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            Felo is built with passion for music lovers with local collections. There are no paywalls,
            no tracking, and no subscriptions. If Felo adds joy to your daily listening, your support
            directly fuels development, maintenance, and future updates!
          </p>
        </div>

        {/* Support Channels: Indonesian Gateways (Lowest Fees) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <span>🇮🇩</span> Indonesian Gateways (Low Fee)
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">QRIS & Local e-Wallets</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Saweria */}
            <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-surface/50 p-3.5 transition-colors hover:border-amber-500/30 hover:bg-surface-elevated/70">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                  <Coffee className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">Saweria</span>
                    <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-semibold text-amber-300">
                      ~5% fee
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    QRIS, GoPay, OVO, Dana, ShopeePay
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openUrl(saweriaUrl)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 active:scale-95"
              >
                <span>Support on Saweria</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Trakteer */}
            <div className="flex flex-col justify-between rounded-xl border border-white/5 bg-surface/50 p-3.5 transition-colors hover:border-rose-500/30 hover:bg-surface-elevated/70">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <Gift className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-white">Trakteer</span>
                    <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] font-semibold text-rose-300">
                      ID Local
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    QRIS, e-Wallets & Bank Transfer
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openUrl(trakteerUrl)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 active:scale-95"
              >
                <span>Support on Trakteer</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Crypto Support: Solana (SOL) */}
        <div className="space-y-2 rounded-xl border border-purple-500/20 bg-purple-950/10 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                <Coins className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="text-xs font-bold text-white">Solana (SOL)</span>
                <span className="ml-2 rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-purple-300">
                  Near-Zero Fee (&lt;$0.001)
                </span>
              </div>
            </div>
            <span className="text-[10px] text-purple-300/80 font-mono">SOL • USDC (SPL)</span>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Solana enables instant global support with near-zero gas fees.
          </p>

          {config.solanaAddress ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[11px] text-purple-200">
                {config.solanaAddress}
              </div>
              <button
                type="button"
                onClick={handleCopySolana}
                title="Copy Solana Wallet Address"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-3 py-1.5 text-xs font-semibold text-purple-200 transition-colors hover:bg-purple-500/30 active:scale-95"
              >
                {copiedSol ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => openUrl(buildSolscanUrl(config.solanaAddress))}
                title="View on Solscan explorer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-surface hover:bg-hover text-text-muted hover:text-white transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-dashed border-purple-500/30 bg-purple-900/10 px-3 py-2">
              <span className="text-xs text-text-muted">No Solana address configured yet</span>
              <button
                type="button"
                onClick={() => setIsEditingConfig(true)}
                className="text-xs font-semibold text-purple-300 hover:text-purple-200 underline"
              >
                Set Address
              </button>
            </div>
          )}
        </div>

        {/* Free Ways to Support: GitHub Star */}
        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-surface/40 p-3">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-yellow-500/15 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
              <Star className="h-3.5 w-3.5 fill-yellow-400/20" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Star Felo on GitHub</div>
              <div className="text-[11px] text-text-muted">100% Free • Helps others discover Felo</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openUrl(githubUrl)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-text hover:bg-hover transition-colors"
          >
            <span>Star Project</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Inline Config Editor */}
        {isEditingConfig ? (
          <div className="rounded-xl border border-white/10 bg-black/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">Customize Donation Handles</span>
              <button
                type="button"
                onClick={() => setIsEditingConfig(false)}
                className="text-xs text-text-muted hover:text-white"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <label className="text-[11px] text-text-muted block mb-1">Saweria Username / URL</label>
                <input
                  type="text"
                  value={tempSaweria}
                  onChange={(e) => setTempSaweria(e.target.value)}
                  placeholder="fanx0"
                  className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary-amber"
                />
              </div>

              <div>
                <label className="text-[11px] text-text-muted block mb-1">Trakteer Username / URL</label>
                <input
                  type="text"
                  value={tempTrakteer}
                  onChange={(e) => setTempTrakteer(e.target.value)}
                  placeholder="fanx0"
                  className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary-amber"
                />
              </div>

              <div>
                <label className="text-[11px] text-text-muted block mb-1">Solana (SOL) Wallet Address</label>
                <input
                  type="text"
                  value={tempSolana}
                  onChange={(e) => setTempSolana(e.target.value)}
                  placeholder="Paste your SOL wallet address..."
                  className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveConfig}
                className="rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
              >
                Save Handles
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setIsEditingConfig(true)}
              className="text-[11px] text-text-muted hover:text-text flex items-center gap-1.5 transition-colors"
            >
              <Settings className="h-3 w-3" />
              <span>Edit your donation handles / wallet</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSettings()
                }}
                className="text-[11px] text-text-muted hover:text-text transition-colors"
              >
                App Settings →
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
