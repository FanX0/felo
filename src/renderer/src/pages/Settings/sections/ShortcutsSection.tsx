import { Keyboard } from 'lucide-react'
import { SettingsSection } from '../components/SettingsSection'

const SHORTCUTS = [
  ['Play / Pause', 'Space'],
  ['Next Track', 'Ctrl + →'],
  ['Previous Track', 'Ctrl + ←'],
  ['Volume Up', 'Ctrl + ↑'],
  ['Volume Down', 'Ctrl + ↓'],
  ['Search', 'Ctrl + K'],
  ['Toggle Shuffle', 'Ctrl + S'],
  ['Toggle Repeat', 'Ctrl + R']
] as const

export function ShortcutsSection() {
  return (
    <SettingsSection
      icon={<Keyboard className="w-5 h-5" />}
      title="Keyboard Shortcuts"
      description="Global hotkeys and in-app shortcuts."
    >
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {SHORTCUTS.map(([action, key]) => (
          <div
            key={action}
            className="flex items-center justify-between py-2 border-b border-border/10"
          >
            <span className="text-text-muted">{action}</span>
            <kbd className="px-2 py-0.5 rounded bg-surface-elevated border border-border text-text font-mono text-[10px]">
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
