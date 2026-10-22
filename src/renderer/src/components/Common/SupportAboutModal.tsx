import { useState, useEffect, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  Heart,
  X,
  Copy,
  Check,
  ExternalLink,
  Star,
  Coins,
  Coffee,
  Gift,
  ArrowUpRight,
  Download
} from 'lucide-react'
import DiscordIcon from './DiscordIcon'
import { isElectron } from '../../lib/appConfig'
import {
  DEFAULT_SUPPORT_CONFIG,
  buildSaweriaUrl,
  buildTrakteerUrl,
  buildGithubRepoUrl,
  buildSolscanUrl,
  buildDiscordInviteUrl
} from '../../lib/supportConfig'
import { copyToClipboard } from '../../lib/clipboard'

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
  const navigate = useNavigate()
  const [copiedSol, setCopiedSol] = useState(false)

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
    const success = await copyToClipboard(DEFAULT_SUPPORT_CONFIG.solanaAddress)
    if (success) {
      setCopiedSol(true)
      setTimeout(() => setCopiedSol(false), 2500)
    }
  }

  const saweriaUrl = buildSaweriaUrl(DEFAULT_SUPPORT_CONFIG.saweriaUsername)
  const trakteerUrl = buildTrakteerUrl(DEFAULT_SUPPORT_CONFIG.trakteerUsername)
  const githubUrl = buildGithubRepoUrl(DEFAULT_SUPPORT_CONFIG.githubRepo)
  const solscanUrl = buildSolscanUrl(DEFAULT_SUPPORT_CONFIG.solanaAddress)
  const discordUrl = buildDiscordInviteUrl(DEFAULT_SUPPORT_CONFIG.discordInvite)

  const openUrl = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 select-none overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative my-8 w-full max-w-lg rounded-2xl border border-border bg-surface-elevated p-6 shadow-2xl flex flex-col gap-5 text-text animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-start justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Heart className="h-6 w-6 fill-rose-500 text-rose-500 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text tracking-tight">Felo Music</h2>
                <span className="rounded-full bg-surface border border-border/60 px-2 py-0.5 text-[10px] font-bold text-text-muted">
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
                      className="inline-flex items-center gap-1 rounded bg-surface border border-border/60 px-1.5 py-0.5 text-[10px] font-bold text-text hover:bg-hover transition-colors cursor-pointer"
                      title="View release notes"
                    >
                      <span>Update v{latestVersion} available</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-primary font-semibold">
                      • Update v{latestVersion} available
                    </span>
                  )
                ) : (
                  <span className="text-text-muted/70">• Up to date</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenSettings()
                }}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-text cursor-pointer"
                title="Open Settings"
              >
                Settings
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-text-muted transition-colors hover:bg-hover hover:text-text cursor-pointer"
              title="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mission / Value Proposition */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-1.5">
          <span className="text-xs font-bold text-text block">
            Music Player & Listen Together with Friends
          </span>
          <p className="text-xs text-text-muted leading-relaxed">
            Felo is built for music lovers to enjoy local collections and listen together
            with friends in real-time sync. There are no ads and no subscriptions — your support
            helps keep room servers running and directly fuels ongoing development!
          </p>
        </div>

        {/* Web User Desktop & Mobile App Download Banner */}
        {!isElectron && (
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 p-3.5">
            <div className="flex items-center gap-2.5 min-w-0 pr-2">
              <Download className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-text">Get Felo Apps</div>
                <div className="text-[11px] text-text-muted truncate">
                  Android APK, iOS Web App, and Windows Desktop setup
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose()
                navigate('/download')
              }}
              className="shrink-0 flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground px-3 py-1.5 text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <span>Download</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Support Channels: Indonesian Gateways */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Indonesian Gateways
            </span>
            <span className="text-[10px] text-text-muted font-bold lowercase tracking-normal">
              qris & local e-wallets
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Saweria */}
            <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-border/80">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <Coffee className="h-4 w-4 text-text-muted" />
                  <span>Saweria</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1 leading-normal">
                  QRIS, GoPay, OVO, Dana, ShopeePay
                </p>
              </div>
              <button
                type="button"
                onClick={() => openUrl(saweriaUrl)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-elevated hover:bg-hover px-3 py-1.5 text-xs font-bold text-text transition-colors shadow-sm cursor-pointer"
              >
                <span>Support on Saweria</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
              </button>
            </div>

            {/* Trakteer */}
            <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-border/80">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-text">
                  <Gift className="h-4 w-4 text-text-muted" />
                  <span>Trakteer</span>
                </div>
                <p className="text-[11px] text-text-muted mt-1 leading-normal">
                  QRIS, e-Wallets & Bank Transfer
                </p>
              </div>
              <button
                type="button"
                onClick={() => openUrl(trakteerUrl)}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-elevated hover:bg-hover px-3 py-1.5 text-xs font-bold text-text transition-colors shadow-sm cursor-pointer"
              >
                <span>Support on Trakteer</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
              </button>
            </div>
          </div>
        </div>

        {/* Crypto Support: Solana (SOL) */}
        <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-text">
              <Coins className="h-4 w-4 text-text-muted" />
              <span>Solana (SOL)</span>
            </div>
            <span className="text-[10px] text-text-muted font-mono">SOL • USDC (SPL)</span>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Instant global transfers on Solana network.
          </p>

          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 truncate rounded-lg border border-border bg-surface-elevated px-3 py-1.5 font-mono text-[11px] text-text select-all">
              {DEFAULT_SUPPORT_CONFIG.solanaAddress}
            </div>
            <button
              type="button"
              onClick={handleCopySolana}
              title="Copy Solana Wallet Address"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated hover:bg-hover px-3 py-1.5 text-xs font-bold text-text transition-all active:scale-95 shadow-sm cursor-pointer"
            >
              {copiedSol ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-text-muted" />
                  <span>Copy</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => openUrl(solscanUrl)}
              title="View on Solscan explorer"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated hover:bg-hover text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Free Ways to Support: GitHub Star */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center gap-2.5">
            <Star className="h-4 w-4 text-text-muted shrink-0" />
            <div>
              <div className="text-xs font-bold text-text">Star Felo on GitHub</div>
              <div className="text-[11px] text-text-muted">100% Free • Helps others discover Felo</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openUrl(githubUrl)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors shadow-sm cursor-pointer"
          >
            <span>Star Project</span>
            <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
          </button>
        </div>

        {/* Social & Community: Discord */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center gap-2.5">
            <DiscordIcon className="h-4 w-4 text-text-muted shrink-0" />
            <div>
              <div className="text-xs font-bold text-text">Join Felo on Discord</div>
              <div className="text-[11px] text-text-muted">Community, listen together & updates</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => openUrl(discordUrl)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors shadow-sm cursor-pointer"
          >
            <DiscordIcon className="h-3.5 w-3.5 text-text-muted" />
            <span>Join Discord</span>
            <ExternalLink className="h-3.5 w-3.5 text-text-muted" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
