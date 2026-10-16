import React, { useEffect, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useListeningStore } from '../../hooks/useListeningStore'

interface ManualSyncModalProps {
  isOpen?: boolean
  onClose?: () => void
}

export const ManualSyncModal: React.FC<ManualSyncModalProps> = ({
  isOpen: propsIsOpen,
  onClose: propsOnClose
}) => {
  const storeIsOpen = useListeningStore((state) => state.isManualSyncModalOpen)
  const setIsOpen = useListeningStore((state) => state.setIsManualSyncModalOpen)
  const manualSyncOffsetMs = useListeningStore((state) => state.manualSyncOffsetMs)
  const setManualSyncOffsetMs = useListeningStore((state) => state.setManualSyncOffsetMs)
  const adjustManualSyncOffsetMs = useListeningStore((state) => state.adjustManualSyncOffsetMs)
  const myRole = useListeningStore((state) => state.myRole)
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const joinedRoom = useListeningStore((state) => state.joinedRoom)

  const isHost = myRole === 'host' || Boolean(hostRoom && !joinedRoom)
  const isVisible = propsIsOpen !== undefined ? propsIsOpen : storeIsOpen
  const [activeStep, setActiveStep] = useState<number | null>(null)

  const handleClose = useCallback(() => {
    if (propsOnClose) {
      propsOnClose()
    } else {
      setIsOpen(false)
    }
    setActiveStep(null)
  }, [propsOnClose, setIsOpen])

  const handleStep = (deltaMs: number) => {
    if (isHost) return
    setActiveStep(deltaMs)
    adjustManualSyncOffsetMs(deltaMs)
  }

  const handleReset = () => {
    setActiveStep(null)
    setManualSyncOffsetMs(0)
  }

  // Keyboard shortcut listener: Escape to close, Arrow keys to nudge (guests only)
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
      } else if (!isHost && e.key === 'ArrowLeft') {
        e.preventDefault()
        const delta = e.shiftKey ? -10 : -1
        handleStep(delta)
      } else if (!isHost && e.key === 'ArrowRight') {
        e.preventDefault()
        const delta = e.shiftKey ? 10 : 1
        handleStep(delta)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, isHost, handleClose])

  if (!isVisible) return null

  const stepOptions = [-10, -1, 1, 10]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manual sync adjustment"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in select-none"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-[280px] bg-[#16171b] border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col items-center text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="text-xs text-zinc-400 font-medium tracking-wide">
          Manual sync (ms)
        </div>

        {/* Big Number & Close X */}
        <div className="relative w-full flex items-center justify-center pt-2 pb-1">
          <span className="text-4xl font-extrabold font-mono tracking-tight text-white">
            {manualSyncOffsetMs}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-0 text-zinc-400 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Horizontal Divider */}
        <div className="w-full h-px bg-white/10 my-3.5" />

        {/* Host Reference Note */}
        {isHost && (
          <div className="w-full mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px] text-center leading-relaxed">
            Host is the audio reference source. Manual sync is only for joined users.
          </div>
        )}

        {/* 4 Step Buttons: -10, -1, +1, +10 */}
        <div className="w-full flex items-center justify-between gap-2">
          {stepOptions.map((step) => {
            const isSelected = activeStep === step
            const label = step > 0 ? `+${step}` : `${step}`
            return (
              <button
                key={step}
                type="button"
                disabled={isHost}
                onClick={() => handleStep(step)}
                className={`flex-1 h-11 rounded-full text-xs font-mono font-semibold transition-all flex items-center justify-center ${
                  isHost
                    ? 'bg-[#1a1b20] text-zinc-600 opacity-40 cursor-not-allowed border border-white/5'
                    : isSelected
                    ? 'ring-2 ring-emerald-500 bg-emerald-500/15 text-emerald-300 cursor-pointer active:scale-95'
                    : 'bg-[#22242a] hover:bg-[#2b2e36] text-white hover:text-white cursor-pointer active:scale-95'
                }`}
                title={isHost ? 'Manual sync is disabled for host' : `Adjust by ${label} ms`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Action Row: Reset and Done */}
        <div className="w-full flex items-center justify-between gap-3 mt-4">
          <button
            type="button"
            onClick={handleReset}
            className="flex-1 h-11 rounded-full bg-[#22242a] hover:bg-[#2b2e36] text-zinc-200 text-xs font-semibold transition-all active:scale-95 cursor-pointer flex items-center justify-center"
            title="Reset sync offset to 0 ms"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="flex-1 h-11 rounded-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold transition-all shadow-md shadow-emerald-950/40 active:scale-95 cursor-pointer flex items-center justify-center"
            title="Confirm offset"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default ManualSyncModal
