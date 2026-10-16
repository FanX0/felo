
export function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer ${
        enabled ? 'bg-primary shadow-sm' : 'bg-[#2a2a2e]'
      }`}
    >
      <div
        className={`absolute top-1 w-4 h-4 rounded-full shadow transition-transform ${
          enabled ? 'translate-x-5.5 bg-primary-foreground' : 'translate-x-1 bg-white'
        }`}
      />
    </button>
  )
}
