
export function Toggle({
  enabled,
  disabled = false,
  onChange
}: {
  enabled: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!enabled)
      }}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
        disabled
          ? 'opacity-40 cursor-not-allowed bg-zinc-700'
          : enabled
            ? 'bg-primary shadow-sm cursor-pointer'
            : 'bg-[#2a2a2e] cursor-pointer'
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
