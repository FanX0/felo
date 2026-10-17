import { useEffect, useState } from 'react'
import {
  MessageSquare,
  Bot,
  ExternalLink,
  Loader2,
  RefreshCw,
  Check,
  Copy,
  ListMusic,
  Download,
  Info
} from 'lucide-react'
import { useListeningStore } from '../../../hooks/useListeningStore'
import { isElectron } from '../../../lib/appConfig'
import { getSupabase, isSupabaseConfigured } from '../../../lib/supabase'
import { Toggle } from '../components/Toggle'
import { SettingRow } from '../components/SettingRow'
import { SettingsSection } from '../components/SettingsSection'
import DiscordIcon from '../../../components/Common/DiscordIcon'
import musicPresencePreview from '../../../assets/music-presence-preview.png'
import type { DiscordBinding, PresenceStatus } from '../types'

export function DiscordSection() {
  // Discord & Media Session
  const [discordRpcEnabled, setDiscordRpcEnabled] = useState(false)
  const [mediaSessionEnabled, setMediaSessionEnabled] = useState(true)
  const [showSongInDiscord, setShowSongInDiscord] = useState(true)
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus | null>(null)
  const [presenceSettingUp, setPresenceSettingUp] = useState(false)
  const [presenceSetupMsg, setPresenceSetupMsg] = useState<string | null>(null)

  // Official Discord Bot & Webhook Controller
  const [discordBinding, setDiscordBinding] = useState<DiscordBinding | null>(null)
  const [discordBotError, setDiscordBotError] = useState<string | null>(null)
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('')
  const [discordWebhookEnabled, setDiscordWebhookEnabled] = useState(false)
  const [discordTestStatus, setDiscordTestStatus] = useState<{ loading: boolean; message?: string; success?: boolean }>({ loading: false })
  const [discordMessage, setDiscordMessage] = useState('')
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const [copiedRoomCode, setCopiedRoomCode] = useState(false)
  const [copiedConnectCmd, setCopiedConnectCmd] = useState(false)

  const refreshPresenceStatus = async () => {
    if (!isElectron) return
    try {
      const status = await window.api?.getMusicPresenceStatus?.()
      if (status) {
        setPresenceStatus(status)
        if (status.configured) {
          setDiscordRpcEnabled(true)
        }
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isElectron) return
    refreshPresenceStatus()
    const handleFocus = () => {
      void refreshPresenceStatus()
    }
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const handleSetupMusicPresence = async () => {
    if (!isElectron) {
      setPresenceSetupMsg('Discord Rich Presence requires the desktop app.')
      return
    }
    setPresenceSettingUp(true)
    setPresenceSetupMsg(null)
    try {
      const res = await window.api?.setupMusicPresence?.()
      if (res?.success) {
        setDiscordRpcEnabled(true)
        setPresenceSetupMsg('Discord Rich Presence linked successfully!')
        await refreshPresenceStatus()
      } else {
        setPresenceSetupMsg(res?.error || 'Failed to configure Discord integration.')
      }
    } catch (err: any) {
      setPresenceSetupMsg(err?.message || 'Error configuring Discord integration.')
    } finally {
      setPresenceSettingUp(false)
    }
  }

  const handleLaunchMusicPresence = async () => {
    if (!isElectron) return
    try {
      const res = await window.api?.launchMusicPresence?.()
      if (res?.success) {
        setPresenceSetupMsg('Launching Music Presence...')
        setTimeout(() => refreshPresenceStatus(), 2000)
      } else if (res?.error) {
        setPresenceSetupMsg(res.error)
      }
    } catch {
      // ignore
    }
  }

  const refreshDiscordStatus = async () => {
    if (!isElectron) return
    try {
      const status = await window.api?.getDiscordBotStatus?.()
      if (status) {
        setDiscordWebhookUrl(status.webhookUrl || '')
        setDiscordWebhookEnabled(Boolean(status.webhookEnabled))
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isElectron) return
    refreshDiscordStatus()
  }, [])

  useEffect(() => {
    let mounted = true
    const checkBinding = async () => {
      if (!hostRoom?.code || !isSupabaseConfigured) {
        if (mounted) setDiscordBinding(null)
        return
      }
      try {
        const supabase = getSupabase()
        const { data } = await supabase
          .from('discord_channel_bindings')
          .select('channel_id, bound_by, updated_at')
          .eq('room_code', hostRoom.code)
          .maybeSingle()
        if (mounted) {
          setDiscordBinding(data || null)
        }
      } catch {
        // ignore network error
      }
    }

    void checkBinding()
    const timer = setInterval(() => {
      void checkBinding()
    }, 4000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [hostRoom?.code])

  const handleSaveDiscordWebhook = async (overrides?: { webhookUrl?: string; webhookEnabled?: boolean }) => {
    if (!isElectron) {
      setDiscordBotError('Discord Webhook Announcer requires the desktop app.')
      return
    }
    try {
      setDiscordMessage('')
      const nextWebhookUrl = overrides?.webhookUrl !== undefined ? overrides.webhookUrl : discordWebhookUrl
      const nextWebhookEnabled =
        overrides?.webhookEnabled !== undefined ? overrides.webhookEnabled : discordWebhookEnabled
      await window.api?.updateDiscordSettings?.({
        webhookUrl: nextWebhookUrl,
        webhookEnabled: nextWebhookEnabled
      })
      setDiscordMessage('Discord webhook settings saved.')
      setTimeout(() => setDiscordMessage(''), 3000)
    } catch (err: any) {
      setDiscordBotError(err?.message || 'Failed to update Discord webhook settings')
    }
  }

  const handleTestDiscordWebhook = async () => {
    if (!discordWebhookUrl.trim()) return
    setDiscordTestStatus({ loading: true })
    try {
      const res = await window.api?.testDiscordWebhook?.(discordWebhookUrl.trim())
      setDiscordTestStatus({
        loading: false,
        success: res?.success,
        message: res?.message
      })
    } catch (err: any) {
      setDiscordTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Failed to send test webhook.'
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Discord & Media Presence */}
      <SettingsSection
        icon={<MessageSquare className="w-5 h-5" />}
        title="Discord & Media Presence"
        description="Share what you're listening to with Discord Rich Presence and system media controls."
      >
        {!isElectron ? (
          <>
            <div className="p-4 rounded-xl bg-surface-elevated/60 border border-border/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-2.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-text">Discord Rich Presence & Music Presence</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 uppercase tracking-wide">
                  Desktop App Only
                </span>
              </div>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Web browsers operate in a sandboxed security environment and cannot access local OS IPC pipes to communicate directly with Discord and Music Presence desktop apps. To display your currently playing tracks on Discord, please use the desktop version of Felo.
              </p>
              <div className="flex items-center gap-2 shrink-0 flex-wrap pt-1">
                <a
                  href="https://musicpresence.app"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border hover:bg-surface-elevated text-xs font-medium text-text shrink-0 transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-text-muted" />
                  <span>Music Presence</span>
                  <ExternalLink className="w-3 h-3 text-text-muted" />
                </a>
                <a
                  href="https://github.com/FanX0/felo/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-xs font-medium text-primary-foreground shrink-0 transition-colors"
                >
                  <span>Download App</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="shrink-0 flex flex-col items-center sm:items-start md:items-center self-center md:self-start">
              <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold tracking-wider text-text-muted uppercase">
                <DiscordIcon className="w-3.5 h-3.5 fill-[#5865F2] text-[#5865F2]" />
                <span>Discord Status Preview</span>
              </div>
              <div className="rounded-xl overflow-hidden shadow-lg border border-white/10 bg-[#1e1f22] p-1 ring-1 ring-black/40">
                <img
                  src={musicPresencePreview}
                  alt="Discord Status Preview - Listening to Felo"
                  className="w-[275px] max-w-full h-auto rounded-lg select-none block"
                  loading="lazy"
                />
              </div>
            </div>
          </div>
          <SettingRow
            label="Discord Rich Presence"
            hint="Desktop App Only: Web browsers run in a secure sandbox and cannot communicate directly with local Discord or Music Presence processes."
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 uppercase tracking-wide">
                Disabled on Web
              </span>
              <Toggle enabled={false} disabled={true} onChange={() => {}} />
            </div>
          </SettingRow>
        </>
        ) : (
          <>
            {/* Detection & Connection Status */}
            <div className="p-3.5 rounded-xl bg-surface-elevated/60 border border-border/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    presenceStatus?.running
                      ? 'bg-emerald-400'
                      : presenceStatus?.configured
                        ? 'bg-amber-400'
                        : presenceStatus?.installed
                          ? 'bg-sky-400'
                          : 'bg-zinc-500'
                  }`}
                />
                <div>
                  <div className="text-xs font-semibold text-text flex items-center gap-1.5 flex-wrap">
                    <span>Music Presence (Discord Integration)</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 uppercase tracking-wide">
                      Desktop App Feature
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/60 bg-surface-elevated text-text-muted font-mono font-medium">
                      {presenceStatus?.running
                        ? 'Active & Running'
                        : presenceStatus?.configured
                          ? 'Configured (Idle)'
                          : presenceStatus?.installed
                            ? 'Detected (Needs Link)'
                            : 'Not Installed / Not Detected'}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {presenceStatus?.running
                      ? 'Felo is connected and syncing what you are listening to on Discord in real-time.'
                      : presenceStatus?.configured
                        ? 'Felo is registered in Music Presence. Start Music Presence to broadcast your music to Discord.'
                        : presenceStatus?.installed
                          ? 'Music Presence is detected on your computer. Click Setup Discord to link.'
                          : 'Music Presence integrates desktop playback directly with your Discord profile.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <a
                  href="https://musicpresence.app"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (window.api?.openExternal) {
                      e.preventDefault()
                      void window.api.openExternal('https://musicpresence.app')
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-surface border border-border hover:bg-surface-elevated text-text flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  title="Download Music Presence app from official website"
                >
                  <Download className="w-3.5 h-3.5 text-text-muted" />
                  <span>Download Presence</span>
                  <ExternalLink className="w-3 h-3 text-text-muted" />
                </a>

                {presenceStatus?.installed && !presenceStatus?.running && (
                  <button
                    type="button"
                    onClick={handleLaunchMusicPresence}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-surface border border-border hover:bg-surface-elevated text-text transition-colors cursor-pointer shadow-sm"
                  >
                    Start Presence App
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSetupMusicPresence}
                  disabled={presenceSettingUp}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  {presenceSettingUp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>{presenceStatus?.configured ? 'Re-link Discord' : 'Setup Discord'}</span>
                </button>
              </div>
            </div>

            {/* Informative Music Presence Instructions & Preview */}
            <div className="p-3.5 rounded-xl bg-surface-elevated/40 border border-border/60 text-xs">
              <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                <div className="space-y-2.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-text font-semibold">
                    <Info className="w-4 h-4 text-text-muted shrink-0" />
                    <span>How to Set Up Music Presence with Felo:</span>
                  </div>
                  <div className="space-y-2 text-[11px] text-text-muted leading-relaxed">
                    <div className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-surface-elevated border border-border/60 text-text font-mono font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">
                        1
                      </span>
                      <div>
                        <span className="font-semibold text-text">Download & install Music Presence first:</span>{' '}
                        If you haven't installed it yet, get the free desktop app from{' '}
                        <a
                          href="https://musicpresence.app"
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            if (window.api?.openExternal) {
                              e.preventDefault()
                              void window.api.openExternal('https://musicpresence.app')
                            }
                          }}
                          className="text-text hover:underline font-semibold inline-flex items-center gap-0.5"
                        >
                          musicpresence.app
                          <ExternalLink className="w-2.5 h-2.5 inline text-text-muted" />
                        </a>{' '}
                        and finish the installation.
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-surface-elevated border border-border/60 text-text font-mono font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">
                        2
                      </span>
                      <div>
                        <span className="font-semibold text-text">Link Felo to Music Presence:</span>{' '}
                        Click <span className="text-text font-semibold">{presenceStatus?.configured ? '"Re-link Discord"' : '"Setup Discord"'}</span> above. Felo will automatically inject its player profile and Discord icons instantly without needing to restart.
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-surface-elevated border border-border/60 text-text font-mono font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">
                        3
                      </span>
                      <div>
                        <span className="font-semibold text-text">Launch Music Presence & Discord:</span>{' '}
                        Start Music Presence, open Discord, and make sure{' '}
                        <span className="text-text font-semibold">"Display current activity as a status message"</span> is enabled in Discord Settings &gt; Activity Privacy. Your songs will show live on your Discord profile!
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status Preview Card */}
                <div className="shrink-0 flex flex-col items-center sm:items-start md:items-center self-center md:self-start pt-1 md:pt-0">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold tracking-wider text-text-muted uppercase">
                    <DiscordIcon className="w-3.5 h-3.5 fill-[#5865F2] text-[#5865F2]" />
                    <span>Discord Status Preview</span>
                  </div>
                  <div className="rounded-xl overflow-hidden shadow-lg border border-white/10 bg-[#1e1f22] p-1 ring-1 ring-black/40 transition-transform hover:scale-[1.02]">
                    <img
                      src={musicPresencePreview}
                      alt="Discord Status Preview - Listening to Felo"
                      className="w-[275px] max-w-full h-auto rounded-lg select-none block"
                      loading="lazy"
                    />
                  </div>
                </div>
              </div>
            </div>

            {presenceSetupMsg && (
              <div className="text-xs px-3 py-2 rounded bg-surface/80 border border-primary/20 text-primary flex items-center justify-between">
                <span>{presenceSetupMsg}</span>
                <button
                  type="button"
                  onClick={() => setPresenceSetupMsg(null)}
                  className="text-text-muted hover:text-text text-[10px] ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            <SettingRow
              label="Discord Rich Presence"
              hint={
                !presenceStatus?.installed && !presenceStatus?.configured
                  ? 'Desktop App Feature: Install Music Presence desktop app to enable Discord Rich Presence.'
                  : discordRpcEnabled
                    ? 'Show currently playing track in your Discord status.'
                    : 'Sync disabled: Felo will not broadcast your track to Discord.'
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase tracking-wide">
                  Desktop App Only
                </span>
                <Toggle
                  enabled={discordRpcEnabled}
                  disabled={!presenceStatus?.installed && !presenceStatus?.configured}
                  onChange={(val) => {
                    setDiscordRpcEnabled(val)
                    if (val && !presenceStatus?.configured) {
                      void handleSetupMusicPresence()
                    }
                  }}
                />
              </div>
            </SettingRow>
            {discordRpcEnabled && (
              <SettingRow
                label="Show Song Details"
                hint="Display title, artist, album, and elapsed time."
              >
                <Toggle enabled={showSongInDiscord} onChange={setShowSongInDiscord} />
              </SettingRow>
            )}
          </>
        )}

        <SettingRow
          label="System Media Controls"
          hint={
            isElectron
              ? "Enable media keys and OS media transport controls."
              : "Enable hardware media keys and OS media transport controls via Web Media Session API."
          }
        >
          <Toggle enabled={mediaSessionEnabled} onChange={setMediaSessionEnabled} />
        </SettingRow>
      </SettingsSection>

      {/* Official Discord Bot & Webhook Remote Control */}
      <SettingsSection
        icon={<Bot className="w-5 h-5" />}
        title="Official Discord Music Bot"
        description="Connect any Discord channel to your Felo session using the official bot. Server members can queue songs, vote to skip, and listen together in real-time."
      >
        {/* Connection Status Banner */}
        <div className="p-4 rounded-2xl bg-[#121316] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                discordBinding
                  ? 'bg-emerald-400'
                  : hostRoom?.code
                    ? 'bg-amber-400'
                    : 'bg-zinc-500'
              }`}
            />
            <div>
              <div className="text-xs font-bold text-text flex items-center gap-2">
                <span>
                  {discordBinding
                    ? 'Discord Server Connected'
                    : hostRoom?.code
                      ? 'Ready for Discord Connection'
                      : 'Official Bot Idle'}
                </span>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full border border-border/60 bg-surface-elevated text-text-muted font-mono font-medium">
                  {discordBinding
                    ? 'Linked via /connect'
                    : hostRoom?.code
                      ? 'Room Code Active'
                      : 'No Code'}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                {discordBinding
                  ? `Linked by @${discordBinding.bound_by}. Songs requested with /play in Discord play directly on this player.`
                  : hostRoom?.code
                    ? `In your Discord server, type /connect ${hostRoom.code} to link this channel.`
                    : 'Generate a room code below or start Listen Together to link your Discord server.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hostRoom?.code ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(`/connect ${hostRoom.code}`)
                  setCopiedConnectCmd(true)
                  setTimeout(() => setCopiedConnectCmd(false), 2000)
                }}
                className="px-3.5 py-1.5 rounded-full bg-[#18191d] border border-white/[0.1] hover:border-border text-text text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                {copiedConnectCmd ? <Check className="w-3.5 h-3.5 text-text" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedConnectCmd ? 'Copied /connect' : 'Copy /connect'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void ensureHostRoom(true)}
                className="px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold transition-all hover:bg-primary-hover cursor-pointer shadow-sm"
              >
                Generate Code
              </button>
            )}
          </div>
        </div>

        {discordBotError && (
          <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger flex items-center justify-between">
            <span>{discordBotError}</span>
            <button
              type="button"
              onClick={() => setDiscordBotError(null)}
              className="text-text-muted hover:text-text text-[10px] ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {discordMessage && (
          <div className="mt-2 text-xs px-3 py-2 rounded-lg bg-success/10 border border-success/30 text-success">
            {discordMessage}
          </div>
        )}

        {/* Official Discord Bot (1-Click) */}
        <div className="mt-4 p-4 rounded-xl bg-surface-elevated/40 border border-border/60 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-2.5">
              <Bot className="w-5 h-5 text-text shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-text flex items-center gap-2">
                  <span>Official Felo Discord Bot</span>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-surface-elevated border border-border/60 text-text-muted font-mono font-bold">
                    1 Official Bot Access
                  </span>
                </h4>
                <p className="text-[11px] text-text-muted mt-0.5">
                  Zero token setup. All users simply link to the official bot using <code className="text-text font-mono font-semibold">/connect</code> in Discord.
                </p>
                <div className="flex items-center gap-2 pt-1.5 flex-wrap">
                  <a
                    href="https://discord.gg/K4We3eBqQ"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (window.api?.openExternal) {
                        e.preventDefault()
                        void window.api.openExternal('https://discord.gg/K4We3eBqQ')
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-elevated border border-border/60 text-xs font-bold text-text hover:bg-hover transition-colors shadow-sm cursor-pointer"
                  >
                    <DiscordIcon className="w-3.5 h-3.5 text-text-muted" />
                    <span>Join Discord Community</span>
                    <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
                  </a>
                  <a
                    href="https://felo.feloapp.workers.dev"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (window.api?.openExternal) {
                        e.preventDefault()
                        void window.api.openExternal('https://felo.feloapp.workers.dev')
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-surface-elevated border border-border/60 text-xs font-medium text-text hover:bg-hover transition-colors cursor-pointer"
                  >
                    <span>Web Player: felo.feloapp.workers.dev</span>
                    <ExternalLink className="w-3 h-3 text-text-muted" />
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Room Code Display */}
          <div className="p-3 rounded-lg bg-surface border border-border/60 flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold block">
                Your Discord Connect Code
              </span>
              <span className="text-base font-mono font-bold tracking-widest text-text">
                {hostRoom?.code || 'NO ACTIVE CODE'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hostRoom?.code ? (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(hostRoom.code)
                    setCopiedRoomCode(true)
                    setTimeout(() => setCopiedRoomCode(false), 2000)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-text text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedRoomCode ? <Check className="w-3.5 h-3.5 text-text" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedRoomCode ? 'Copied!' : 'Copy Code'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void ensureHostRoom(true)}
                  className="px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold transition-all hover:bg-primary/90 cursor-pointer"
                >
                  Generate Code
                </button>
              )}
            </div>
          </div>

          <div className="text-[11px] text-text-muted space-y-1.5 pt-1">
            <p className="font-semibold text-text">How to connect in Discord:</p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-text-muted">
              <li>In your Discord server channel, type: <code className="text-text font-mono font-bold">/connect {hostRoom?.code || '<code>'}</code></li>
              <li>Type <code className="text-text font-mono font-bold">/play &lt;song name&gt;</code> — Felo automatically searches, queues, and plays the music in real-time!</li>
              <li>Everyone in the channel can request songs, vote to skip, or view the 3-tier queue with <code className="text-text font-mono font-bold">/queue</code>!</li>
            </ol>
          </div>
        </div>

        {/* Outgoing Webhook Section */}
        <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
          <SettingRow
            label="Discord Webhook Announcer"
            hint="Automatically post Now Playing embeds with Room Code to a Discord channel."
          >
            <Toggle
              enabled={discordWebhookEnabled}
              onChange={(val) => {
                setDiscordWebhookEnabled(val)
                void handleSaveDiscordWebhook({ webhookEnabled: val })
              }}
            />
          </SettingRow>

          {discordWebhookEnabled && (
            <div className="space-y-2 mt-2">
              <span className="text-xs font-bold text-text">Discord Webhook URL</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value.trim())}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="flex-1 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-text outline-none focus:border-white/40 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleTestDiscordWebhook}
                  disabled={discordTestStatus.loading || !discordWebhookUrl.trim()}
                  className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  {discordTestStatus.loading ? 'Testing...' : 'Test Webhook'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDiscordWebhook({ webhookUrl: discordWebhookUrl })}
                  className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-bold text-text hover:bg-hover transition-colors shrink-0 cursor-pointer"
                >
                  Save
                </button>
              </div>

              {discordTestStatus.message && (
                <p
                  className={`text-xs font-bold ${
                    discordTestStatus.success ? 'text-success' : 'text-danger'
                  }`}
                >
                  {discordTestStatus.message}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Command Quick Reference Sheet */}
        <div className="mt-5 rounded-xl border border-border/40 bg-surface/80 p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-text uppercase tracking-wider">
              <ListMusic className="w-3.5 h-3.5 text-text-muted" />
              <span>Official Bot Slash Commands</span>
            </div>
            <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium text-text-muted border border-border">
              Universal Slash Commands
            </span>
          </div>
          <p className="text-[11px] text-text-muted mb-3">
            Connect your session by typing <code className="font-mono text-text font-bold">/connect {hostRoom?.code || '<ROOM_CODE>'}</code> in any Discord channel.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {[
              ['/web', 'Direct link & button to open Felo Web Player'],
              ['/connect <code>', 'Links Discord channel to your active Felo room'],
              ['/play <song>', 'Searches and queues songs to play in your room'],
              ['/queue', 'Shows upcoming songs in the 3-tier room queue'],
              ['/skip', 'Skips to next track in queue'],
              ['/pause & /resume', 'Pauses or resumes playback in the session'],
              ['/nowplaying', 'Current song, cover art, progress & room code'],
              ['/volume <0-100>', 'Adjusts host playback volume (0-100%)'],
              ['/invite', 'Posts Room Code + 1-Click Web Join Link for friends'],
              ['/download', 'Web Player & Desktop App download links'],
              ['/disconnect', 'Unbinds this Discord channel from the room'],
              ['/help', 'Interactive beginner guide & quick-start buttons']
            ].map(([cmd, desc]) => (
              <div key={cmd} className="flex items-center justify-between p-2 rounded-lg bg-surface-elevated/40 border border-border/20">
                <code className="text-text font-mono font-bold text-[11px]">{cmd}</code>
                <span className="text-[10px] text-text-muted text-right max-w-[55%]">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>
    </div>
  )
}
