import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Toggle } from '../components/Toggle'
import { SettingRow } from '../components/SettingRow'
import { SettingsSection } from '../components/SettingsSection'

export function NotificationsSection() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [nowPlayingNotif, setNowPlayingNotif] = useState(true)

  return (
    <SettingsSection
      icon={<Bell className="w-5 h-5" />}
      title="Notifications"
      description="Control desktop notifications and alerts."
    >
      <SettingRow
        label="Desktop Notifications"
        hint="Show system notifications for events and updates."
      >
        <Toggle enabled={notificationsEnabled} onChange={setNotificationsEnabled} />
      </SettingRow>
      <SettingRow
        label="Now Playing Notification"
        hint="Show a notification when a new track starts playing."
      >
        <Toggle enabled={nowPlayingNotif} onChange={setNowPlayingNotif} />
      </SettingRow>
    </SettingsSection>
  )
}
