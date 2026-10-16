import type { ReactNode } from 'react'

export function SettingsSection({
  icon,
  title,
  description,
  children
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="bg-canvas/40 border border-border/10 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-text shrink-0 flex items-center justify-center">{icon}</div>
        <div>
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
      </div>
      <div className="pt-2">{children}</div>
    </section>
  )
}
