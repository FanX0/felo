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
  ArrowUpRight,
  Settings2
} from 'lucide-react'
import { SettingsSection } from '../components/SettingsSection'
import {
  useSupportConfig,
  buildSaweriaUrl,
  buildTrakteerUrl,
  buildGithubRepoUrl,
  buildSolscanUrl
} from '../../../lib/supportConfig'
import SupportAboutModal from '../../../components/Common/SupportAboutModal'

interface AboutSectionProps {
  version: string
}

export function AboutSection({ version }: AboutSectionProps) {
  const { config, updateConfig } = useSupportConfig()
  const [copiedSol, setCopiedSol] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saweriaInput, setSaweriaInput] = useState(config.saweriaUsername)
  const [trakteerInput, setTrakteerInput] = useState(config.trakteerUsername)
  const [solanaInput, setSolanaInput] = useState(config.solanaAddress)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    setSaweriaInput(config.saweriaUsername)
    setTrakteerInput(config.trakteerUsername)
    setSolanaInput(config.solanaAddress)
  }, [config])

  const openUrl = (url: string) => {
    if (window.api?.openExternal) {
      void window.api.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

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

  const handleSaveHandles = async () => {
    await updateConfig({
      saweriaUsername: saweriaInput.trim() || 'fanx0',
      trakteerUsername: trakteerInput.trim() || 'fanx0',
      solanaAddress: solanaInput.trim()
    })
    setSaveSuccess(true)
    setIsEditing(false)
    setTimeout(() => setSaveSuccess(false), 2500)
  }

  const saweriaUrl = buildSaweriaUrl(config.saweriaUsername)
  const trakteerUrl = buildTrakteerUrl(config.trakteerUsername)
  const githubUrl = buildGithubRepoUrl(config.githubRepo)

  return (
    <>
      <SettingsSection
        icon={<Info className="w-5 h-5 text-text" />}
        title="About & Support"
        description={`Version ${version} — Desktop Music Workspace`}
      >
        <div className="space-y-6">
          {/* Identity & Mission */}
          <div className="rounded-xl border border-white/5 bg-surface/40 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Felo Music</span>
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                  100% Free & Open Source
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
              >
                <Heart className="h-3.5 w-3.5 fill-rose-500/20 text-rose-400" />
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
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-emerald-400 font-medium">
                Local-First
              </span>
              <span className="px-3 py-1 rounded-lg bg-surface-elevated border border-border text-xs text-text-muted">
                MIT License
              </span>
            </div>
          </div>

          {/* Support Channels */}
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Heart className="h-4 w-4 text-rose-400 fill-rose-500/20" />
                  <span>Support Project Development</span>
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Felo is free to use forever. Supporting the creator directly funds ongoing maintenance & new features.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-white transition-colors cursor-pointer"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>{isEditing ? 'Close Editor' : 'Edit Handles'}</span>
              </button>
            </div>

            {/* Quick Support Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Saweria */}
              <div className="rounded-xl border border-white/5 bg-surface/50 p-3.5 flex flex-col justify-between hover:border-amber-500/30 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                    <Coffee className="h-4 w-4" />
                    <span>Saweria (🇮🇩 ID)</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    QRIS, GoPay, OVO, Dana. Lowest fees (~5%).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openUrl(saweriaUrl)}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
                >
                  <span>Saweria</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Trakteer */}
              <div className="rounded-xl border border-white/5 bg-surface/50 p-3.5 flex flex-col justify-between hover:border-rose-500/30 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                    <Gift className="h-4 w-4" />
                    <span>Trakteer (🇮🇩 ID)</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    QRIS, e-Wallets, Bank Transfer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openUrl(trakteerUrl)}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
                >
                  <span>Trakteer</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Solana */}
              <div className="rounded-xl border border-purple-500/20 bg-purple-950/10 p-3.5 flex flex-col justify-between hover:border-purple-500/40 transition-colors">
                <div>
                  <div className="flex items-center gap-2 text-purple-300 font-bold text-xs">
                    <Coins className="h-4 w-4" />
                    <span>Solana (SOL)</span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1 leading-normal">
                    Near-zero fees (&lt;$0.001) & instant speed.
                  </p>
                </div>
                {config.solanaAddress ? (
                  <div className="mt-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopySolana}
                      title="Copy SOL Address"
                      className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-purple-500/40 bg-purple-500/20 px-2 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/30 transition-colors cursor-pointer"
                    >
                      {copiedSol ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
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
                      title="View on Solscan"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-purple-500/30 bg-surface hover:bg-hover text-purple-200 transition-colors cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors cursor-pointer"
                  >
                    <span>Set Wallet</span>
                  </button>
                )}
              </div>
            </div>

            {/* Inline Config Editor */}
            {isEditing && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3 mt-3 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Customize Creator Handles & Wallet</span>
                  {saveSuccess && (
                    <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" />
                      <span>Saved!</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-text-muted block mb-1">Saweria Handle / URL</label>
                    <input
                      type="text"
                      value={saweriaInput}
                      onChange={(e) => setSaweriaInput(e.target.value)}
                      placeholder="fanx0"
                      className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-text-muted block mb-1">Trakteer Handle / URL</label>
                    <input
                      type="text"
                      value={trakteerInput}
                      onChange={(e) => setTrakteerInput(e.target.value)}
                      placeholder="fanx0"
                      className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-rose-400"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-text-muted block mb-1">Solana (SOL) Address</label>
                    <input
                      type="text"
                      value={solanaInput}
                      onChange={(e) => setSolanaInput(e.target.value)}
                      placeholder="Paste SOL address..."
                      className="w-full rounded-md border border-white/10 bg-surface px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-purple-400"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1 rounded-md text-xs text-text-muted hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveHandles}
                    className="px-4 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            )}

            {/* GitHub Links */}
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-surface/30 p-3 mt-2">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-yellow-400 fill-yellow-400/20" />
                <span className="text-xs text-text">GitHub Open Source Repository</span>
              </div>
              <button
                type="button"
                onClick={() => openUrl(githubUrl)}
                className="flex items-center gap-1.5 text-xs font-semibold text-text hover:text-white transition-colors"
              >
                <span>View on GitHub</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </SettingsSection>

      {isModalOpen && (
        <SupportAboutModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          currentVersion={version}
        />
      )}
    </>
  )
}
