import type { SpeakerRole } from '../../hooks/useDspStore'
import { useThemeStore } from '../../hooks/useThemeStore'

interface SpatialRoomVisualizerProps {
  activeRole: SpeakerRole
  onSelectRole: (role: SpeakerRole) => void
}

export default function SpatialRoomVisualizer({
  activeRole,
  onSelectRole
}: SpatialRoomVisualizerProps) {
  const accentEnabled = useThemeStore((s) => s.accentEnabled)
  const accentColor = useThemeStore((s) => s.accentColor)

  const activeColor = accentEnabled ? accentColor : '#ffffff'
  const activeBgColor = accentEnabled ? `${accentColor}33` : 'rgba(255, 255, 255, 0.15)'
  const activeDriverColor = accentEnabled ? accentColor : '#ffffff'
  const pulseFill = accentEnabled ? `${accentColor}40` : 'rgba(255, 255, 255, 0.25)'

  const isLeft = activeRole === 'left'
  const isRight = activeRole === 'right'
  const isSub = activeRole === 'subwoofer'
  const isCenter = activeRole === 'center'

  return (
    <div className="relative w-full aspect-[2/1] max-h-48 rounded-2xl bg-[#0f1013] border border-white/[0.08] flex items-center justify-center p-3 select-none overflow-hidden group">
      <svg
        className="w-full h-full max-w-[340px] svg-overflow-visible"
        viewBox="0 0 340 170"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="settings-grad-tl" x1="1" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#71717a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="settings-grad-tr" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#71717a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="settings-grad-br" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#71717a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="settings-grad-bl" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#71717a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#71717a" stopOpacity="0" />
          </linearGradient>
          {/* Emerald glow filter */}
          <filter id="driver-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* ── Room Perspective Frame ── */}
        <g className="graphic-room">
          <rect
            x="40"
            y="30"
            width="260"
            height="90"
            fill="none"
            stroke="rgba(255, 255, 255, 0.12)"
            strokeWidth="1.2"
          />
          <line x1="40" y1="30" x2="0" y2="0" stroke="url(#settings-grad-tl)" strokeWidth="1.2" />
          <line x1="300" y1="30" x2="340" y2="0" stroke="url(#settings-grad-tr)" strokeWidth="1.2" />
          <line x1="300" y1="120" x2="340" y2="170" stroke="url(#settings-grad-br)" strokeWidth="1.2" />
          <line x1="40" y1="120" x2="0" y2="170" stroke="url(#settings-grad-bl)" strokeWidth="1.2" />
        </g>

        {/* ── Center Display / TV ── */}
        <rect
          x="115"
          y="38"
          width="110"
          height="62"
          rx="3"
          fill="#17181c"
          stroke="rgba(255, 255, 255, 0.18)"
          strokeWidth="1.5"
        />
        <rect
          x="120"
          y="42"
          width="100"
          height="52"
          rx="2"
          fill="#0c0d10"
          stroke="rgba(255, 255, 255, 0.05)"
        />

        {/* ── Left Speaker Tower (Role -1) ── */}
        <g
          className="cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
          onClick={() => onSelectRole('left')}
        >
          <rect
            x="50"
            y="60"
            width="20"
            height="68"
            rx="2.5"
            fill={isLeft ? activeBgColor : '#1e2025'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.22)'}
            strokeWidth={isLeft ? 2 : 1}
          />
          <circle
            cx="60"
            cy="75"
            r="3.5"
            fill={isLeft ? activeDriverColor : '#3f3f46'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isLeft ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="60"
            cy="92"
            r="4.5"
            fill={isLeft ? activeDriverColor : '#3f3f46'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isLeft ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="60"
            cy="112"
            r="4.5"
            fill={isLeft ? activeDriverColor : '#3f3f46'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isLeft ? 'url(#driver-glow)' : undefined}
          />
          <rect
            x="49"
            y="128"
            width="22"
            height="3"
            rx="1"
            fill={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
          />
          {isLeft && (
            <circle
              cx="60"
              cy="95"
              r="22"
              fill={pulseFill}
              className="animate-pulse"
            />
          )}
        </g>

        {/* ── Right Speaker Tower (Role 1) ── */}
        <g
          className="cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
          onClick={() => onSelectRole('right')}
        >
          <rect
            x="272"
            y="60"
            width="20"
            height="68"
            rx="2.5"
            fill={isRight ? activeBgColor : '#1e2025'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.22)'}
            strokeWidth={isRight ? 2 : 1}
          />
          <circle
            cx="282"
            cy="75"
            r="3.5"
            fill={isRight ? activeDriverColor : '#3f3f46'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isRight ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="282"
            cy="92"
            r="4.5"
            fill={isRight ? activeDriverColor : '#3f3f46'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isRight ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="282"
            cy="112"
            r="4.5"
            fill={isRight ? activeDriverColor : '#3f3f46'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            filter={isRight ? 'url(#driver-glow)' : undefined}
          />
          <rect
            x="271"
            y="128"
            width="22"
            height="3"
            rx="1"
            fill={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
          />
          {isRight && (
            <circle
              cx="282"
              cy="95"
              r="22"
              fill={pulseFill}
              className="animate-pulse"
            />
          )}
        </g>

        {/* ── Subwoofer Unit (Role 2) ── */}
        <g
          className="cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
          onClick={() => onSelectRole('subwoofer')}
        >
          <rect
            x="111"
            y="140"
            width="4"
            height="3"
            fill={isSub ? activeColor : 'rgba(255, 255, 255, 0.3)'}
          />
          <rect
            x="133"
            y="140"
            width="4"
            height="3"
            fill={isSub ? activeColor : 'rgba(255, 255, 255, 0.3)'}
          />
          <rect
            x="108"
            y="108"
            width="32"
            height="32"
            rx="3"
            fill={isSub ? activeBgColor : '#1e2025'}
            stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.22)'}
            strokeWidth={isSub ? 2 : 1}
          />
          <circle
            cx="124"
            cy="124"
            r="9"
            fill={isSub ? activeDriverColor : '#27272a'}
            stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.3)'}
            strokeWidth="1.5"
            filter={isSub ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="124"
            cy="124"
            r="3.5"
            fill={isSub ? activeBgColor : '#3f3f46'}
          />
          {isSub && (
            <circle
              cx="124"
              cy="124"
              r="20"
              fill={pulseFill}
              className="animate-pulse"
            />
          )}
        </g>

        {/* ── Center Soundbar (Role 0) ── */}
        <g
          className="cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
          onClick={() => onSelectRole('center')}
        >
          <rect
            x="155"
            y="140"
            width="4"
            height="3"
            fill={isCenter ? activeColor : 'rgba(255, 255, 255, 0.3)'}
          />
          <rect
            x="181"
            y="140"
            width="4"
            height="3"
            fill={isCenter ? activeColor : 'rgba(255, 255, 255, 0.3)'}
          />
          <rect
            x="145"
            y="125"
            width="50"
            height="15"
            rx="2.5"
            fill={isCenter ? activeBgColor : '#1e2025'}
            stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.22)'}
            strokeWidth={isCenter ? 2 : 1}
          />
          <circle
            cx="155"
            cy="132.5"
            r="3.5"
            fill={isCenter ? activeDriverColor : '#3f3f46'}
            filter={isCenter ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="170"
            cy="132.5"
            r="3"
            fill={isCenter ? activeDriverColor : '#3f3f46'}
            filter={isCenter ? 'url(#driver-glow)' : undefined}
          />
          <circle
            cx="185"
            cy="132.5"
            r="3.5"
            fill={isCenter ? activeDriverColor : '#3f3f46'}
            filter={isCenter ? 'url(#driver-glow)' : undefined}
          />
          {isCenter && (
            <rect
              x="142"
              y="122"
              width="56"
              height="21"
              rx="4"
              fill={pulseFill}
              className="animate-pulse"
            />
          )}
        </g>
      </svg>
    </div>
  )
}
