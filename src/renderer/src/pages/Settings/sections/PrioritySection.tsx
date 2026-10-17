import { useState, type Dispatch, type SetStateAction } from 'react'
import { Layers, ChevronUp, ChevronDown, X } from 'lucide-react'
import {
  DOWNLOAD_PRIORITY_SETTING,
  DOWNLOAD_SOURCES,
  DownloadSourceId
} from '../../../lib/downloadConfig'
import { SettingsSection } from '../components/SettingsSection'

interface PrioritySectionProps {
  downloadPriority: DownloadSourceId[]
  setDownloadPriority: Dispatch<SetStateAction<DownloadSourceId[]>>
}

export function PrioritySection({ downloadPriority, setDownloadPriority }: PrioritySectionProps) {
  const [priorityMessage, setPriorityMessage] = useState('')

  const movePriority = (index: number, direction: 'up' | 'down') => {
    setDownloadPriority((current) => {
      const next = [...current]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const savePriorityOrder = async () => {
    await window.api?.setSetting?.(DOWNLOAD_PRIORITY_SETTING, downloadPriority)
    setPriorityMessage('Priority order saved.')
    setTimeout(() => setPriorityMessage(''), 2500)
  }

  return (
    <SettingsSection
      icon={<Layers className="w-5 h-5" />}
      title="Bulk Download Priority & Fallback"
      description="Choose the order Felo should try authorized sources when resolving queued downloads."
    >
      <div className="flex items-center justify-end mb-4">
        <button
          type="button"
          onClick={savePriorityOrder}
          className="rounded-full border border-border bg-surface-elevated px-4 py-2 text-xs font-bold text-text hover:bg-hover transition-colors"
        >
          Save Priority Order
        </button>
      </div>

      {priorityMessage && (
        <div className="mb-4 rounded-md border border-white/20 bg-surface-elevated px-3 py-2 text-xs font-bold text-text">
          {priorityMessage}
        </div>
      )}

      <div className="space-y-3">
        {downloadPriority.map((sourceId, index) => {
          const source = DOWNLOAD_SOURCES.find((item) => item.id === sourceId)
          if (!source) return null
          return (
            <div
              key={source.id}
              className="flex items-center gap-4 rounded-lg border border-border/50 bg-surface-elevated/70 p-4"
            >
              <div className="w-[90px] rounded-md border border-border bg-canvas px-3 py-2 text-center">
                <div className="text-sm font-extrabold text-text">Tier {index + 1}</div>
                {index === 0 && (
                  <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                    Top Priority
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-text">{source.name}</span>
                  <span className="text-xs font-mono text-text-muted">
                    {source.quality}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-muted">{source.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => movePriority(index, 'up')}
                  disabled={index === 0}
                  className="h-8 w-8 rounded-full border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => movePriority(index, 'down')}
                  disabled={index === downloadPriority.length - 1}
                  className="h-8 w-8 rounded-full border border-border bg-hover flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDownloadPriority((current) =>
                      current.length > 1 ? current.filter((id) => id !== source.id) : current
                    )
                  }
                  className="h-8 w-8 rounded-full bg-danger hover:bg-danger/90 flex items-center justify-center text-white transition-colors shadow-xs"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {DOWNLOAD_SOURCES.some((source) => !downloadPriority.includes(source.id)) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Add source:</span>
          {DOWNLOAD_SOURCES.filter((source) => !downloadPriority.includes(source.id)).map(
            (source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setDownloadPriority((current) => [...current, source.id])}
                className="rounded-full border border-border bg-surface-elevated px-3 py-1.5 text-xs font-bold text-text-muted hover:text-text"
              >
                + {source.name}
              </button>
            )
          )}
        </div>
      )}
    </SettingsSection>
  )
}
