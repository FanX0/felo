import { Moon, X, Check } from 'lucide-react'

interface MobileSleepTimerModalProps {
  isOpen: boolean
  onClose: () => void
  onTimerSet: (minutes: number | null, endOfTrack?: boolean) => void
  activeTimer: { endTimestamp: number; endOfTrack?: boolean } | null
}

const TIMER_OPTIONS = [
  { label: '5 minutes', minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '45 minutes', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: 'End of track', minutes: 0, endOfTrack: true }
]

export default function MobileSleepTimerModal({
  isOpen,
  onClose,
  onTimerSet,
  activeTimer
}: MobileSleepTimerModalProps) {
  if (!isOpen) return null

  const handleSelect = (minutes: number, endOfTrack = false) => {
    onTimerSet(minutes, endOfTrack)
    onClose()
  }

  const handleTurnOff = () => {
    onTimerSet(null)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-[#181818] border border-white/10 rounded-t-3xl sm:rounded-2xl p-6 text-white shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <Moon className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold">Sleep Timer</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-2 space-y-1">
          {TIMER_OPTIONS.map((opt) => {
            const isSelected =
              activeTimer &&
              (opt.endOfTrack
                ? activeTimer.endOfTrack
                : !activeTimer.endOfTrack &&
                  Math.abs(Math.round((activeTimer.endTimestamp - Date.now()) / 60000) - opt.minutes) <= 1)

            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleSelect(opt.minutes, opt.endOfTrack)}
                className={`w-full flex items-center justify-between p-3.5 rounded-xl text-sm font-medium transition active:scale-[0.99] ${
                  isSelected
                    ? 'bg-white/10 text-white font-bold'
                    : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span>{opt.label}</span>
                {isSelected && <Check className="w-4 h-4 text-white" />}
              </button>
            )
          })}

          {activeTimer && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleTurnOff}
                className="w-full py-3 text-sm font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition"
              >
                Turn off timer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
