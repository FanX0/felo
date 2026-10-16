import { useDspStore } from '../../hooks/useDspStore'
import AudioSettingsPanel from './AudioSettingsPanel'

export default function AudioFxModal() {
  const isOpen = useDspStore((s) => s.isAudioModalOpen)
  const setIsOpen = useDspStore((s) => s.setIsAudioModalOpen)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] h-[720px] rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col bg-[#121316] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <AudioSettingsPanel onClose={() => setIsOpen(false)} isModal={true} />
      </div>
    </div>
  )
}
