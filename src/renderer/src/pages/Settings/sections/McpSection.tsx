import { useEffect, useState } from 'react'
import {
  Bot,
  Key,
  Eye,
  EyeOff,
  Check,
  Copy,
  RefreshCw,
  Shield,
  Globe,
  Users,
  Lock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle2
} from 'lucide-react'
import { Toggle } from '../components/Toggle'
import type { ExternalPlayerClientConfigs, McpTab } from '../types'

type CapabilityTab = 'environment' | 'privacy'

export function McpCapabilitiesGuide({ defaultExpanded = false }: { defaultExpanded?: boolean }) {
  const [activeTab, setActiveTab] = useState<CapabilityTab>('environment')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className="mt-4 rounded-xl border border-border/30 bg-canvas/40 backdrop-blur-sm overflow-hidden transition-all">
      {/* Header bar / Toggle */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => e.key === 'Enter' && setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-3.5 sm:p-4 cursor-pointer hover:bg-surface-elevated/40 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-text shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text">MCP Capabilities & Privacy Matrix</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide bg-surface-elevated border border-border/60 text-text-muted">
                Reference
              </span>
            </div>
            <p className="text-[11px] text-text-muted">
              What AI models can do in Private vs. Public modes and how Room Privacy works
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-muted hidden sm:inline">
            {isExpanded ? 'Collapse' : 'Expand Matrix'}
          </span>
          <div className="p-1 rounded-md bg-surface-elevated text-text-muted">
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 pt-1 border-t border-border/20 space-y-3.5 animate-in fade-in duration-200">
          {/* Sub-tabs switcher */}
          <div className="flex items-center justify-between gap-2 border-b border-border/20 pb-2.5">
            <div className="flex rounded-lg bg-surface-elevated/60 p-0.5 border border-border/40">
              <button
                type="button"
                onClick={() => setActiveTab('environment')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'environment'
                    ? 'bg-surface text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Private vs. Public Mode</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('privacy')}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'privacy'
                    ? 'bg-surface text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Room Privacy Guide</span>
              </button>
            </div>
          </div>

          {activeTab === 'environment' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Private Desktop Card */}
              <div className="rounded-xl border border-border/40 bg-surface/40 p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-text" />
                    <span className="text-xs font-bold text-text">Private Mode (Desktop App)</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-elevated text-text border border-border/60">
                    Full Access
                  </span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Full control of local hardware, indexed SQLite music library, and proprietary lossless scrapers.
                </p>
                <ul className="space-y-1.5 text-[11px] text-text-muted">
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Local Library Search:</strong> Full SQLite indexing across thousands of local files (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_search_songs</code>)</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Lossless Downloader:</strong> Auto-download missing tracks via Qobuz, Deezer, Soulseek, YouTube (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_download</code>)</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Hardware Player:</strong> Timeline seek, volume, shuffle, repeat, and full queue manipulation</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Room Master:</strong> Host bit-perfect WebRTC Listen Together rooms (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_create_room</code>)</span>
                  </li>
                </ul>
              </div>

              {/* Public Web Card */}
              <div className="rounded-xl border border-border/40 bg-surface/40 p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-text" />
                    <span className="text-xs font-bold text-text">Public Mode (Web / OSS)</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60">
                    Collaborative
                  </span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Browser-safe audio streaming, friend session discovery, and real-time Listen Together room synchronization.
                </p>
                <ul className="space-y-1.5 text-[11px] text-text-muted">
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Online Stream Playback:</strong> Instant streaming via preview & web URLs without filesystem storage</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Connect to Room:</strong> Join friends' rooms via 6-letter party codes (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_join_room</code>)</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" />
                    <span><strong className="text-text">Listen Along:</strong> Jump directly into an online friend's active session (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_join_friend</code>)</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="w-3.5 h-3.5 text-text-muted font-bold shrink-0 text-center leading-none mt-0.5">—</span>
                    <span><strong className="text-text">Downloads Disabled:</strong> File scrapers and disk write access are omitted for web safety</span>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Public Room Card */}
              <div className="rounded-xl border border-border/40 bg-surface/40 p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-text" />
                    <span className="text-xs font-bold text-text">Public Rooms</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-elevated text-text border border-border/60">
                    Open Feed
                  </span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Broadcasted across the Friend Activity feed and online friends list for open social listening.
                </p>
                <div className="rounded-lg bg-surface-elevated/70 p-2.5 font-mono text-[10px] text-text border border-border/40">
                  <div className="text-text-muted mb-1 font-sans text-[10px]">// AI tool command</div>
                  <code>felo_create_room(name=&quot;Friday Chill&quot;, is_private=false)</code>
                </div>
                <ul className="space-y-1.5 text-[11px] text-text-muted">
                  <li>• Visible to all friends in the Friend Activity panel</li>
                  <li>• Friends can join with one click or via AI (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_join_friend</code>)</li>
                  <li>• Generates a shareable web player link for non-desktop users</li>
                </ul>
              </div>

              {/* Private Room Card */}
              <div className="rounded-xl border border-border/40 bg-surface/40 p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-text" />
                    <span className="text-xs font-bold text-text">Private Rooms</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60">
                    Stealth Code
                  </span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Hidden from public discovery feeds. Accessible strictly via the unique 6-character room code.
                </p>
                <div className="rounded-lg bg-surface-elevated/70 p-2.5 font-mono text-[10px] text-text border border-border/40">
                  <div className="text-text-muted mb-1 font-sans text-[10px]">// AI tool command</div>
                  <code>felo_create_room(name=&quot;Focus Session&quot;, is_private=true)</code>
                </div>
                <ul className="space-y-1.5 text-[11px] text-text-muted">
                  <li>• Completely unlisted from friend activity feeds & public status</li>
                  <li>• Requires explicit room code (<code className="text-[10px] bg-surface-elevated border border-border/40 px-1 py-0.5 rounded text-text font-mono">felo_join_room(code=&quot;...&quot;)</code>)</li>
                  <li>• Ideal for private pair-listening, AI curation, and testing</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function McpSection() {
  const [externalPlayerEnabled, setExternalPlayerEnabled] = useState(false)
  const [externalPlayerMessage, setExternalPlayerMessage] = useState('')
  const [externalPlayerApiKey, setExternalPlayerApiKey] = useState('')
  const [externalPlayerClientConfigs, setExternalPlayerClientConfigs] = useState<ExternalPlayerClientConfigs | null>(null)
  const [selectedMcpTab, setSelectedMcpTab] = useState<McpTab>('claude')
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedConfig, setCopiedConfig] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    if (!window.api?.getExternalPlayerSettings) return
    void window.api.getExternalPlayerSettings().then((settings) => {
      setExternalPlayerEnabled(settings.enabled)
      if (settings.apiKey) setExternalPlayerApiKey(settings.apiKey)
    })
    void window.api.getExternalPlayerClientConfigs?.().then((configs) => {
      setExternalPlayerClientConfigs(configs)
    })
  }, [])

  const setExternalControl = async (enabled: boolean) => {
    try {
      const result = await window.api.setExternalPlayerEnabled(enabled)
      setExternalPlayerEnabled(result.enabled)
      setExternalPlayerMessage(
        result.enabled
          ? 'MCP playback control is active and ready for AI agents.'
          : 'MCP playback control is stopped.'
      )
      if (result.enabled && window.api.getExternalPlayerClientConfigs) {
        const configs = await window.api.getExternalPlayerClientConfigs()
        setExternalPlayerClientConfigs(configs)
        if (configs.apiKey) setExternalPlayerApiKey(configs.apiKey)
      }
    } catch (error) {
      setExternalPlayerMessage(error instanceof Error ? error.message : 'Could not change playback control.')
    }
  }

  const handleRegenerateApiKey = async () => {
    try {
      if (!window.api?.regenerateExternalPlayerApiKey) return
      const res = await window.api.regenerateExternalPlayerApiKey()
      setExternalPlayerApiKey(res.apiKey)
      const configs = await window.api.getExternalPlayerClientConfigs()
      setExternalPlayerClientConfigs(configs)
      setExternalPlayerMessage('New Personal API Key generated and saved.')
    } catch {
      setExternalPlayerMessage('Failed to regenerate API key.')
    }
  }

  const handleCopyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(externalPlayerApiKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleCopyClientConfig = async (format: McpTab) => {
    try {
      let text = ''
      if (format === 'claude') text = externalPlayerClientConfigs?.claudeDesktop || ''
      else if (format === 'hermes') text = externalPlayerClientConfigs?.hermes || ''
      else text = externalPlayerClientConfigs?.cursor || ''

      if (!text && window.api?.copyHermesConfig) {
        text = await window.api.copyHermesConfig()
      }
      if (text) {
        await navigator.clipboard.writeText(text)
        setCopiedConfig(true)
        setTimeout(() => setCopiedConfig(false), 2000)
        const name = format === 'claude' ? 'Claude Desktop' : format === 'hermes' ? 'Hermes' : 'Cursor'
        setExternalPlayerMessage(`Configuration for ${name} copied to clipboard!`)
      }
    } catch {
      setExternalPlayerMessage('Failed to copy configuration.')
    }
  }

  if (typeof window.electron === 'undefined') {
    return (
      <div className="mt-4 space-y-4">
        <div className="rounded-xl border border-border/30 bg-surface-elevated/40 p-5 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-white" />
                <span className="text-sm font-bold text-text">AI & External Playback Control (MCP)</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider bg-surface-elevated text-text-muted border border-border/60 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                  Web Mode
                </span>
              </div>
              <p className="text-xs text-text-muted">
                The local Model Context Protocol (MCP) daemon runs in the Felo Desktop app. In Web Player, AI agents and users interact through online streaming and real-time Listen Together rooms.
              </p>
            </div>
          </div>
        </div>

        {/* Informative Capabilities & Privacy Matrix for Web Users */}
        <McpCapabilitiesGuide defaultExpanded={true} />
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-border/30 bg-surface-elevated/40 p-5 backdrop-blur-sm">
      {/* Header & Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-white" />
            <span className="text-sm font-bold text-text">AI & External Playback Control (MCP)</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider ${
                externalPlayerEnabled
                  ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                  : 'bg-surface-elevated text-text-muted border border-border/60 font-semibold'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  externalPlayerEnabled ? 'bg-primary-foreground animate-pulse' : 'bg-text-muted'
                }`}
              />
              {externalPlayerEnabled
                ? `PORT ${externalPlayerClientConfigs?.port || 47820}`
                : 'INACTIVE'}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Allows AI assistants (Claude Desktop, Hermes, Cursor, Antigravity) to search, queue, and control music playback via Model Context Protocol.
          </p>
        </div>
        <Toggle enabled={externalPlayerEnabled} onChange={(value) => void setExternalControl(value)} />
      </div>

      {externalPlayerEnabled && (
        <div className="mt-5 space-y-4 pt-4 border-t border-border/20">
          {/* Personal API Key row */}
          <div className="rounded-lg border border-border/30 bg-canvas/60 p-3.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                <Key className="w-3.5 h-3.5 text-white" />
                <span>Personal API Key</span>
              </div>
              <span className="text-[10px] text-text-muted font-mono">
                Auto-authenticated locally • Pass via FELO_API_KEY for remote/WSL
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 font-mono text-xs bg-surface-elevated px-3 py-2 rounded-md border border-border/50 text-text truncate select-all">
                {showApiKey
                  ? externalPlayerApiKey || 'Generating...'
                  : externalPlayerApiKey
                    ? `${externalPlayerApiKey.slice(0, 10)}••••••••••••••••••••••••••••••••`
                    : '••••••••••••••••••••••••••••••••'}
              </div>
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
                title={showApiKey ? 'Hide Key' : 'Show Key'}
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyApiKey()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs font-medium text-text hover:bg-hover transition-colors cursor-pointer"
                title="Copy API Key"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerateApiKey()}
                className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
                title="Regenerate API Key"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Client Config tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">AI Client Setup</span>
              <div className="flex rounded-md bg-canvas/80 p-0.5 border border-border/30">
                {(['claude', 'hermes', 'cursor'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelectedMcpTab(tab)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                      selectedMcpTab === tab
                        ? 'bg-surface-elevated text-text shadow-sm'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    {tab === 'claude'
                      ? 'Claude Desktop'
                      : tab === 'hermes'
                        ? 'Hermes'
                        : 'Cursor / Antigravity'}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <pre className="font-mono text-[11px] bg-black/60 p-3 rounded-lg overflow-x-auto max-h-36 border border-border/30 text-text-muted leading-relaxed select-all">
                <code>
                  {selectedMcpTab === 'claude'
                    ? externalPlayerClientConfigs?.claudeDesktop || '// Generating Claude config...'
                    : selectedMcpTab === 'hermes'
                      ? externalPlayerClientConfigs?.hermes || '// Generating Hermes config...'
                      : externalPlayerClientConfigs?.cursor || '// Generating Cursor config...'}
                </code>
              </pre>
              <button
                type="button"
                onClick={() => void handleCopyClientConfig(selectedMcpTab)}
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-elevated/90 backdrop-blur-sm border border-border/50 text-[11px] font-medium text-text hover:border-white/40 transition-colors shadow-sm cursor-pointer"
              >
                {copiedConfig ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-text" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Capabilities & Privacy Guide */}
      <McpCapabilitiesGuide defaultExpanded={false} />

      {externalPlayerMessage && (
        <p className="mt-3 text-xs text-text-muted flex items-center gap-1.5">
          <span>•</span> {externalPlayerMessage}
        </p>
      )}
      <p className="mt-2 text-[11px] text-text-muted">
        Zero-touch local authentication is automatic for local agents. Commands are processed securely on loopback only.
      </p>
    </div>
  )
}

