import { useState, type Dispatch, type SetStateAction } from 'react'
import { Radio, Headphones, Eye, EyeOff, Plug } from 'lucide-react'
import { AppCapabilities } from '../../../lib/appConfig'
import {
  LASTFM_API_KEY_SETTING,
  STREAMING_ACCOUNTS_SETTING
} from '../../../lib/downloadConfig'
import { SettingsSection } from '../components/SettingsSection'
import type { ProviderTestStatus, StreamingAccounts } from '../types'

interface StreamingSectionProps {
  lastFmApiKey: string
  setLastFmApiKey: Dispatch<SetStateAction<string>>
  accounts: StreamingAccounts
  setAccounts: Dispatch<SetStateAction<StreamingAccounts>>
}

export function StreamingSection({
  lastFmApiKey,
  setLastFmApiKey,
  accounts,
  setAccounts
}: StreamingSectionProps) {
  const [showLastFmApiKey, setShowLastFmApiKey] = useState(false)
  const [lastFmMessage, setLastFmMessage] = useState('')
  const [showQobuzSecret, setShowQobuzSecret] = useState(false)
  const [showDeezerArl, setShowDeezerArl] = useState(false)
  const [showSoulseekPassword, setShowSoulseekPassword] = useState(false)
  const [accountMessage, setAccountMessage] = useState('')

  const [qobuzTestStatus, setQobuzTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })
  const [deezerTestStatus, setDeezerTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })
  const [soulseekTestStatus, setSoulseekTestStatus] = useState<ProviderTestStatus>({
    loading: false
  })

  const updateAccount = <K extends keyof StreamingAccounts>(
    key: K,
    value: StreamingAccounts[K]
  ) => {
    setAccounts((current) => ({ ...current, [key]: value }))
  }

  const saveStreamingAccounts = async () => {
    await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
    setAccountMessage('Streaming account settings saved locally.')
    setTimeout(() => setAccountMessage(''), 3000)
  }

  const handleTestQobuz = async () => {
    setQobuzTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testQobuzAccount?.(accounts)
      setQobuzTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected successfully!' : 'Connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setQobuzTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Qobuz test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  const handleTestDeezer = async () => {
    setDeezerTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testDeezerAccount?.(accounts)
      setDeezerTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected successfully!' : 'Connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setDeezerTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Deezer test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  const handleTestSoulseek = async () => {
    setSoulseekTestStatus({ loading: true })
    try {
      await window.api?.setSetting?.(STREAMING_ACCOUNTS_SETTING, accounts)
      const result = await window.api?.testSoulseekAccount?.(accounts)
      setSoulseekTestStatus({
        loading: false,
        success: result?.status === 'success',
        message:
          result?.message ||
          (result?.status === 'success' ? 'Connected to Soulseek!' : 'Soulseek connection failed'),
        rawError: result?.rawError
      })
    } catch (err: any) {
      setSoulseekTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Soulseek test failed',
        rawError: err?.stack || err?.message
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Last.fm Search */}
      {AppCapabilities.lastFm && (
        <SettingsSection
          icon={<Radio className="w-5 h-5" />}
          title="Last.fm Search"
          description="Use Last.fm metadata to search artists, albums, and songs globally. A free API key is required for API search."
        >
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              Create a free key at{' '}
              <a
                href="https://www.last.fm/api/account/create"
                target="_blank"
                rel="noreferrer"
                className="text-text-muted hover:text-white hover:underline"
              >
                last.fm/api/account/create
              </a>{' '}
              and paste it below. This enables global Last.fm search; it does not provide audio downloads.
            </p>
            <label className="space-y-1.5 block">
              <span className="text-xs font-bold text-text">API Key</span>
              <div className="relative">
                <input
                  type={showLastFmApiKey ? 'text' : 'password'}
                  value={lastFmApiKey}
                  onChange={(event) => setLastFmApiKey(event.target.value.trim())}
                  placeholder="Paste your Last.fm API key"
                  className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 pr-10 text-sm text-text outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowLastFmApiKey((visible) => !visible)}
                  title={showLastFmApiKey ? 'Hide Last.fm API key' : 'Show Last.fm API key'}
                  aria-label={showLastFmApiKey ? 'Hide Last.fm API key' : 'Show Last.fm API key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-hover hover:text-text"
                >
                  {showLastFmApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  await window.api?.setSetting?.(LASTFM_API_KEY_SETTING, lastFmApiKey)
                  setLastFmMessage('Last.fm API key saved locally.')
                  setTimeout(() => setLastFmMessage(''), 3000)
                }}
                className="rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
              >
                Save Last.fm Key
              </button>
              <span className="text-[11px] text-text-muted">Get a free key at last.fm/api</span>
            </div>
            {lastFmMessage && (
              <p className="text-xs font-medium text-text-muted">{lastFmMessage}</p>
            )}
          </div>
        </SettingsSection>
      )}

      {/* Streaming Accounts & Downloader Engine */}
      {AppCapabilities.downloads && (
        <SettingsSection
          icon={<Headphones className="w-5 h-5" />}
          title="Streaming Accounts & Downloader Engine"
          description="Manage background audio download engines (yt-dlp, ffmpeg) and account connectors."
        >
          <div className="space-y-5">
            {/* Qobuz Card */}
            <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-bold text-text">Qobuz Hi-Res Configuration</span>
                <span className="text-[11px] text-text-muted">Hi-Res FLAC up to 24-bit/192kHz</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">Authentication Method</span>
                  <select
                    value={accounts.qobuzAuthMethod}
                    onChange={(event) =>
                      updateAccount('qobuzAuthMethod', event.target.value as 'token' | 'password')
                    }
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                  >
                    <option value="token">User Auth Token (Recommended)</option>
                    <option value="password">Email & Password</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">
                    {accounts.qobuzAuthMethod === 'token' ? 'User ID (or Email)' : 'Email'}
                  </span>
                  <input
                    placeholder={accounts.qobuzAuthMethod === 'token' ? 'e.g. 2759740' : 'user@example.com'}
                    value={accounts.qobuzUser}
                    onChange={(event) => updateAccount('qobuzUser', event.target.value.trim())}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="flex items-center justify-between text-xs font-bold text-text">
                    {accounts.qobuzAuthMethod === 'token' ? 'User Auth Token' : 'Password'}
                    <button
                      type="button"
                      onClick={() => setShowQobuzSecret((show) => !show)}
                      className="text-[11px] text-text-muted hover:text-text"
                    >
                      {showQobuzSecret ? 'Hide' : 'Show'}
                    </button>
                  </span>
                  <input
                    type={showQobuzSecret ? 'text' : 'password'}
                    placeholder={
                      accounts.qobuzAuthMethod === 'token'
                        ? 'Paste user_auth_token'
                        : 'Enter Qobuz password'
                    }
                    value={accounts.qobuzSecret}
                    onChange={(event) =>
                      updateAccount(
                        'qobuzSecret',
                        accounts.qobuzAuthMethod === 'token'
                          ? event.target.value.replace(/\s+/g, '')
                          : event.target.value
                      )
                    }
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">Download Quality</span>
                  <select
                    value={accounts.qobuzQuality}
                    onChange={(event) => updateAccount('qobuzQuality', event.target.value)}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                  >
                    <option value="mp3-320">320 kbps MP3</option>
                    <option value="cd">CD Quality (16-bit / 44.1 kHz FLAC)</option>
                    <option value="hires">Hi-Res (24-bit / up to 96 kHz FLAC)</option>
                    <option value="hires-max">Hi-Res Max (24-bit / up to 192 kHz FLAC)</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">
                    App ID <span className="font-normal text-text-muted">(Optional - auto-detected)</span>
                  </span>
                  <input
                    placeholder="Leave blank to auto-detect"
                    value={accounts.qobuzAppId}
                    onChange={(event) => updateAccount('qobuzAppId', event.target.value.trim())}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">
                    App Secret <span className="font-normal text-text-muted">(Optional - auto-detected)</span>
                  </span>
                  <input
                    placeholder="Leave blank to auto-detect"
                    value={accounts.qobuzAppSecret}
                    onChange={(event) => updateAccount('qobuzAppSecret', event.target.value.trim())}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
              </div>

              <div className="mt-3 rounded-md bg-surface-elevated/40 border border-border/30 p-2.5 text-[11px] text-text-muted">
                <strong>How to get Qobuz Auth Token:</strong> Log in to <span className="text-text font-mono">play.qobuz.com</span> in your browser. Open DevTools (F12) → Application → Local Storage (or Cookies) and copy your <span className="text-text font-mono">user_auth_token</span> and <span className="text-text font-mono">user_id</span>. An active Qobuz subscription or trial is required.
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleTestQobuz}
                  disabled={qobuzTestStatus.loading}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-60"
                >
                  <Plug className={`h-4 w-4 ${qobuzTestStatus.loading ? 'animate-pulse' : ''}`} />
                  {qobuzTestStatus.loading ? 'Testing Qobuz...' : 'Test Qobuz Account'}
                </button>
              </div>
              {qobuzTestStatus.message && (
                <div
                  className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                    qobuzTestStatus.success
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <div>{qobuzTestStatus.message}</div>
                  {qobuzTestStatus.rawError && !qobuzTestStatus.success && (
                    <details className="mt-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer hover:underline text-text-muted">
                        View details
                      </summary>
                      <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                        {qobuzTestStatus.rawError}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Deezer Card */}
            <div className="rounded-lg border border-border/40 bg-canvas/40 p-5">
              <div className="mb-4 font-bold text-text">Deezer Lossless Configuration</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1.5 md:col-span-2">
                  <span className="flex items-center justify-between text-xs font-bold text-text">
                    Deezer ARL Cookie Token
                    <button
                      type="button"
                      onClick={() => setShowDeezerArl((show) => !show)}
                      className="text-[11px] text-text-muted hover:text-text"
                    >
                      {showDeezerArl ? 'Hide' : 'Show'}
                    </button>
                  </span>
                  <input
                    type={showDeezerArl ? 'text' : 'password'}
                    placeholder="Paste your 192-character ARL cookie value"
                    value={accounts.deezerArl}
                    onChange={(event) => updateAccount('deezerArl', event.target.value.replace(/\s+/g, ''))}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                  <span className="text-[11px] text-text-muted">
                    Paste the token for an authorized Deezer connector.
                  </span>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">Deezer Quality</span>
                  <select
                    value={accounts.deezerQuality}
                    onChange={(event) => updateAccount('deezerQuality', event.target.value)}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text"
                  >
                    <option value="mp3-128">128 kbps MP3</option>
                    <option value="mp3-320">320 kbps MP3</option>
                    <option value="lossless">Lossless (16-bit / 44.1 kHz FLAC)</option>
                  </select>
                </label>
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={handleTestDeezer}
                    disabled={deezerTestStatus.loading}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors disabled:opacity-60"
                  >
                    <Plug
                      className={`h-4 w-4 ${deezerTestStatus.loading ? 'animate-pulse' : ''}`}
                    />
                    {deezerTestStatus.loading ? 'Testing Deezer...' : 'Test Deezer ARL'}
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-md bg-surface-elevated/40 border border-border/30 p-2.5 text-[11px] text-text-muted">
                <strong>How to get Deezer ARL:</strong> Open <span className="text-text font-mono">deezer.com</span> in your browser and log in. Open DevTools (F12) → Application / Storage → Cookies → <span className="text-text font-mono">https://www.deezer.com</span> → find and copy the <span className="text-text font-mono">arl</span> cookie value. (ARL tokens expire after ~3 months).
              </div>

              {deezerTestStatus.message && (
                <div
                  className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                    deezerTestStatus.success
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <div>{deezerTestStatus.message}</div>
                  {deezerTestStatus.rawError && !deezerTestStatus.success && (
                    <details className="mt-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer hover:underline text-text-muted">
                        View details
                      </summary>
                      <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                        {deezerTestStatus.rawError}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* Soulseek P2P Card */}
            <div className="rounded-lg border border-border/40 bg-canvas/40 p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h4 className="text-sm font-bold text-text">Soulseek P2P Network</h4>
                  <p className="text-xs text-text-muted">
                    Peer-to-peer lossless and MP3 music exchange network.
                  </p>
                </div>
                <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-text-muted border border-border/40">
                  FLAC / MP3
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-text">Soulseek Username</span>
                  <input
                    placeholder="Optional: use your own account"
                    value={accounts.soulseekUser || ''}
                    onChange={(event) => updateAccount('soulseekUser', event.target.value.trim())}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="flex items-center justify-between text-xs font-bold text-text">
                    <span>Password</span>
                    <button
                      type="button"
                      onClick={() => setShowSoulseekPassword((show) => !show)}
                      className="text-[11px] text-text-muted hover:text-text"
                    >
                      {showSoulseekPassword ? 'Hide' : 'Show'}
                    </button>
                  </span>
                  <input
                    type={showSoulseekPassword ? 'text' : 'password'}
                    placeholder="Optional: use your own account password"
                    value={accounts.soulseekPassword || ''}
                    onChange={(event) => updateAccount('soulseekPassword', event.target.value)}
                    className="w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-text outline-none"
                  />
                </label>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-[11px] text-text-muted">
                  Leave both fields blank to use a persistent automatic Soulseek account, or enter your own account.
                </div>
                <button
                  type="button"
                  onClick={handleTestSoulseek}
                  disabled={soulseekTestStatus.loading}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text disabled:opacity-60 hover:bg-hover transition-colors shrink-0"
                >
                  <Plug
                    className={`h-4 w-4 ${soulseekTestStatus.loading ? 'animate-pulse' : ''}`}
                  />
                  {soulseekTestStatus.loading ? 'Connecting P2P...' : 'Test Soulseek P2P'}
                </button>
              </div>

              {soulseekTestStatus.message && (
                <div
                  className={`mt-4 rounded-md border p-3 text-xs font-medium ${
                    soulseekTestStatus.success
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-danger/30 bg-danger/10 text-danger'
                  }`}
                >
                  <div>{soulseekTestStatus.message}</div>
                  {soulseekTestStatus.rawError && !soulseekTestStatus.success && (
                    <details className="mt-2 text-[11px] text-text-muted">
                      <summary className="cursor-pointer hover:underline text-text-muted">
                        View details
                      </summary>
                      <pre className="mt-1.5 max-h-36 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-danger/90 whitespace-pre-wrap select-text">
                        {soulseekTestStatus.rawError}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* YouTube Music Card */}
            <div className="rounded-lg border border-border/40 bg-canvas/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-text">YouTube Music</h4>
                  <p className="text-xs text-text-muted">
                    Downloads and audio conversion powered by yt-dlp & ffmpeg. No login required.
                  </p>
                </div>
                <span className="rounded-full border border-border/40 bg-surface px-3 py-1 text-[11px] font-bold text-text-muted">
                  256k MP3 / Opus
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={saveStreamingAccounts}
                className="rounded-full border border-border bg-surface-elevated px-6 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
              >
                Save Streaming Settings
              </button>
              {accountMessage && (
                <span className="text-xs font-bold text-text">{accountMessage}</span>
              )}
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  )
}
