import { useEffect, useState } from 'react'
import {
  Bot,
  Key,
  Eye,
  EyeOff,
  Check,
  Copy,
  RefreshCw
} from 'lucide-react'
import { Toggle } from '../components/Toggle'
import type { ExternalPlayerClientConfigs, McpTab } from '../types'

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

  if (typeof window.electron === 'undefined') return null

  return (
    <div className="mt-4 rounded-xl border border-border/30 bg-surface-elevated/40 p-5 backdrop-blur-sm">
      {/* Header & Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-white" />
            <span className="text-sm font-bold text-text">AI & External Playback Control (MCP)</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                externalPlayerEnabled
                  ? 'bg-white/10 text-white border border-white/20'
                  : 'bg-zinc-500/10 text-zinc-400 border border-border/40'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  externalPlayerEnabled ? 'bg-white animate-pulse' : 'bg-zinc-500'
                }`}
              />
              {externalPlayerEnabled
                ? `Port ${externalPlayerClientConfigs?.port || 47820}`
                : 'Inactive'}
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
                className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors"
                title={showApiKey ? 'Hide Key' : 'Show Key'}
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyApiKey()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs font-medium text-text hover:bg-hover transition-colors"
                title="Copy API Key"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleRegenerateApiKey()}
                className="p-2 rounded-md border border-border bg-surface-elevated text-text-muted hover:text-text hover:bg-hover transition-colors"
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
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
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
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-elevated/90 backdrop-blur-sm border border-border/50 text-[11px] font-medium text-text hover:border-white/40 transition-colors shadow-sm"
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
