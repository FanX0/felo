import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { usePrivateSessionStore } from '../../../hooks/usePrivateSessionStore'
import { Toggle } from '../components/Toggle'
import { SettingRow } from '../components/SettingRow'
import { SettingsSection } from '../components/SettingsSection'

export function PrivacySection() {
  const isPrivateSession = usePrivateSessionStore((s) => s.isPrivateSession)
  const setPrivateSession = usePrivateSessionStore((s) => s.setPrivateSession)
  const maskMediaSession = usePrivateSessionStore((s) => s.maskMediaSession)
  const setMaskMediaSession = usePrivateSessionStore((s) => s.setMaskMediaSession)
  const autoDisableHours = usePrivateSessionStore((s) => s.autoDisableHours)
  const setAutoDisableHours = usePrivateSessionStore((s) => s.setAutoDisableHours)
  const listenHistoryEnabled = usePrivateSessionStore((s) => s.listenHistoryEnabled)
  const setListenHistoryEnabled = usePrivateSessionStore((s) => s.setListenHistoryEnabled)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)

  return (
    <SettingsSection
      icon={<ShieldCheck className="w-5 h-5" />}
      title="Privacy & Security"
      description="End-to-end listening privacy, local-first data controls, and presence masking."
    >
      <SettingRow
        label="Private Session"
        hint="Listen completely off-the-record. Playback won't be saved to history, scrobbled, shared with friends, or announced to Discord."
      >
        <Toggle enabled={isPrivateSession} onChange={(val) => setPrivateSession(val, true)} />
      </SettingRow>

      <SettingRow
        label="Auto-disable Private Session"
        hint="Automatically turn off Private Session after a period of time, matching Spotify's privacy standard."
      >
        <select
          value={autoDisableHours}
          onChange={(e) => setAutoDisableHours(Number(e.target.value))}
          className="bg-surface-elevated border border-border text-text text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value={1}>After 1 hour</option>
          <option value={6}>After 6 hours (Recommended)</option>
          <option value={12}>After 12 hours</option>
          <option value={0}>Until turned off manually</option>
        </select>
      </SettingRow>

      <SettingRow
        label="Mask System Media Controls (Discord & SMTC)"
        hint="Display 'Private Session' to Windows lock screen and Discord Music Presence instead of the real track title."
      >
        <Toggle enabled={maskMediaSession} onChange={setMaskMediaSession} />
      </SettingRow>

      <SettingRow
        label="Listening History & Play Counts"
        hint="Record play events locally for insights, most played stats, and recommendations."
      >
        <Toggle enabled={listenHistoryEnabled} onChange={setListenHistoryEnabled} />
      </SettingRow>

      <SettingRow
        label="Analytics & Telemetry"
        hint="Send anonymous usage data to help improve Felo."
      >
        <Toggle enabled={analyticsEnabled} onChange={setAnalyticsEnabled} />
      </SettingRow>

      <div className="mt-4 space-y-2 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
          <span>100% Local-first: No songs or library metadata leave your device.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
          <span>Telemetry & Analytics disabled by default.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 shrink-0" />
          <span>Private Session automatically suppresses SQLite ledger, Supabase cloud sync, and Discord broadcasts.</span>
        </div>
      </div>
    </SettingsSection>
  )
}
