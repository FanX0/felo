export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
  trackClassName?: string
  thumbClassName?: string
  ariaLabel?: string
  id?: string
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className = '',
  trackClassName = '',
  thumbClassName = '',
  ariaLabel,
  id
}: SliderProps) {
  const safeMin = Number.isFinite(min) ? min : 0
  const safeMax = Number.isFinite(max) && max > safeMin ? max : safeMin + 1
  const safeValue = Number.isFinite(value) ? value : safeMin
  const clampedValue = Math.min(Math.max(safeValue, safeMin), safeMax)
  const range = safeMax - safeMin
  const percent = Math.max(0, Math.min(100, ((clampedValue - safeMin) / range) * 100))

  return (
    <div
      className={`relative flex items-center group select-none h-4 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      {/* Background Track */}
      <div className={`w-full h-1.5 bg-border rounded-full overflow-hidden relative ${trackClassName}`}>
        {/* Solid filled bar (white by default, convention theme accent on hover) */}
        <div
          className="h-full bg-text group-hover:bg-primary transition-colors rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Solid White Circular Thumb Knob */}
      <div
        className={`absolute h-3.5 w-3.5 bg-white rounded-full shadow-md pointer-events-none transition-transform group-hover:scale-110 -translate-x-1/2 ${thumbClassName}`}
        style={{ left: `calc(${percent}% + ${(50 - percent) * 0.14}px)` }}
      />

      {/* Native Range Input for accessibility and pointer/keyboard control */}
      <input
        id={id}
        type="range"
        min={safeMin}
        max={safeMax}
        step={step}
        value={clampedValue}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed m-0 p-0"
        aria-label={ariaLabel}
      />
    </div>
  )
}

export default Slider
