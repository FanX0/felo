import { useState, useEffect } from 'react'
import {
  Info,
  Heart,
  Coffee,
  Gift,
  Coins,
  Star,
  Copy,
  Check,
  ExternalLink,
  ArrowUpRight
} from 'lucide-react'
import { SettingsSection } from '../components/SettingsSection'
import {
  DEFAULT_SUPPORT_CONFIG,
  buildSaweriaUrl,
  buildTrakteerUrl,
  buildGithubRepoUrl,
  buildSolscanUrl,
  buildDiscordInviteUrl
} from '../../../lib/supportConfig'
import DiscordIcon from '../../../components/Common/DiscordIcon'
import SupportAboutModal from '../../../components/Common/SupportAboutModal'
import { copyToClipboard } from '../../../lib/clipboard'

interface AboutSectionProps {
  version: string
}

export function AboutSection({ version }: AboutSectionProps) {
  const [copiedSol, setCopiedSol] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<any>(null)

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        if (window.api?.checkForUpdates) {
          const res = await window.api.checkForUpdates()
          if (active) setUpdateStatus(res)
        }
      } catch (err) {
        console.warn('Failed to check for updates in Settings:', err)
      }
    }
    void check()
    return () => {
      active = false
    }
  }, [])

  const openUrl = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

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

  return (
    <>
      <SettingsSection
        icon={<Info className="w-5 h-5 text-text" />}
        title="About & Support"
        description={`Version ${version} — Desktop Music Workspace`}
      >
        <div className="space-y-6">
          {/* Identity & Mission */}
          <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text">Felo Music</span>
                <span className="rounded-full bg-surface-elevated border border-border/60 px-2 py-0.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  100% Free & Open Source
                </span>
                {updateStatus?.status === 'available' && updateStatus.latestVersion && (
                  <span className="rounded bg-primary-amber/25 px-2 py-0.5 text-[10px] font-bold text-primary-amber animate-pulse border border-primary-amber/40">
                    Update v{updateStatus.latestVersion} available
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-3 py-1 text-xs font-bold text-text hover:bg-hover transition-colors cursor-pointer"
              >
                <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />
                <span>Support Felo</span>
              </button>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Felo is an independent desktop music workspace engineered for audiophiles and music lovers
              with local collections. Built with zero tracking, zero telemetry, and zero ads.
            </p>
          </div>

          {/* Technology Badges */}
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted block mb-2.5">
              Architecture & Stack
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                Electron
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                React 18
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                SQLite
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                TypeScript
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                Local-First
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                MIT License
              </span>
            </div>
          </div>

          {/* Support Channels */}
          <div className="space-y-3 pt-2 border-t border-border">
            <div>
              <h3 className="text-sm font-bold text-text flex items-center gap-2">
                <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />
                <span>Support Project Development</span>
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Enjoy your music collection and Listen Together sessions with friends. Supporting directly helps cover room servers & new features.
              </p>
            </div>

            {/* Quick Support Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Saweria */}
              <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between hover:border-border/80 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-text font-bold text-xs">
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
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors cursor-pointer"
                >
                  <span>Support on Saweria</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
                </button>
              </div>

              {/* Trakteer */}
              <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between hover:border-border/80 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-text font-bold text-xs">
                    <Gift className="h-4 w-4 text-text-muted" />
                    <span>Trakteer</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    QRIS, e-Wallets, Bank Transfer
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openUrl(trakteerUrl)}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-xs font-bold text-text hover:bg-hover transition-colors cursor-pointer"
                >
                  <span>Support on Trakteer</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-text-muted" />
                </button>
              </div>

              {/* Solana */}
              <div className="rounded-xl border border-border bg-surface p-3.5 flex flex-col justify-between hover:border-border/80 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-text font-bold text-xs">
                    <Coins className="h-4 w-4 text-text-muted" />
                    <span>Solana (SOL)</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    Instant global transfers on Solana network.
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopySolana}
                    title="Copy SOL Address"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-elevated hover:bg-hover px-2.5 py-1.5 text-xs font-bold text-text transition-colors cursor-pointer"
                  >
                    {copiedSol ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Copied</span>
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
                    title="View on Solscan"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-elevated hover:bg-hover text-text-muted hover:text-text transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* GitHub Links */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 mt-2">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-text-muted" />
                <span className="text-xs text-text">GitHub Open Source Repository</span>
              </div>
              <button
                type="button"
                onClick={() => openUrl(githubUrl)}
                className="flex items-center gap-1.5 text-xs font-bold text-text hover:text-white transition-colors"
              >
                <span>View on GitHub</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Discord Social & Community */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 mt-2">
              <div className="flex items-center gap-2.5">
                <DiscordIcon className="h-4 w-4 text-text-muted shrink-0" />
                <div>
                  <span className="text-xs font-bold text-text block">Discord Community</span>
                  <span className="text-[11px] text-text-muted block">Connect with listeners, request songs & hang out</span>
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
        </div>
      </SettingsSection>

      {isModalOpen && (
        <SupportAboutModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          currentVersion={updateStatus?.currentVersion || version}
          latestVersion={updateStatus?.latestVersion}
          updateAvailable={updateStatus?.status === 'available'}
          releaseUrl={updateStatus?.releaseUrl}
        />
      )}
    </>
  )
}
