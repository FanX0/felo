import type { SpeakerRole } from '../../hooks/useDspStore'
import { useThemeStore, deriveForeground } from '../../hooks/useThemeStore'

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

  const activeColor = accentEnabled && accentColor ? accentColor : '#ffffff'
  const activeForeground = deriveForeground(activeColor)

  const isLeft = activeRole === 'left'
  const isRight = activeRole === 'right'
  const isSub = activeRole === 'subwoofer'
  const isCenter = activeRole === 'center'

  const sweetSpotNode = (
    <g className="listener-node pointer-events-none">
      {/* Stereo directional listening angle wedge */}
      <path
        d="M 183,160 L 190,148 L 197,160 Z"
        fill="none"
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth="0.8"
      />
      <circle
        cx="190"
        cy="165"
        r="9"
        fill="#121318"
        stroke="rgba(255, 255, 255, 0.28)"
        strokeWidth="1.2"
      />
      <circle
        cx="190"
        cy="165"
        r="4.5"
        fill="#121318"
        stroke="rgba(255, 255, 255, 0.35)"
        strokeWidth="0.8"
      />
      <circle cx="190" cy="165" r="2" fill={activeColor} />
      <text
        x="190"
        y="182"
        textAnchor="middle"
        fill="rgba(255, 255, 255, 0.55)"
        fontSize="8"
        fontFamily="monospace"
        fontWeight="bold"
        letterSpacing="0.8"
      >
        SWEET SPOT
      </text>
    </g>
  )

  const centerSpeakerNode = (
    <g
      key="center-speaker"
      className={`speaker-node cursor-pointer focus:outline-none ${isCenter ? 'active' : 'inactive'}`}
      onClick={() => onSelectRole('center')}
      role="button"
      tabIndex={-1}
      aria-label="Center Speaker Channel"
      style={{ outline: 'none', zIndex: isCenter ? 20 : 10 }}
    >
      {/* Active Center Acoustic Ray */}
      {isCenter && (
        <line
          x1="190"
          y1="165"
          x2="190"
          y2="50"
          stroke={activeColor}
          strokeWidth="1.8"
          className="pointer-events-none"
        />
      )}

      {/* Isolation Feet */}
      <rect
        x="152"
        y="64"
        width="8"
        height="2.5"
        rx="1"
        fill="#121318"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.8' : '1.2'}
        className="speaker-stroke"
      />
      <rect
        x="220"
        y="64"
        width="8"
        height="2.5"
        rx="1"
        fill="#121318"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.8' : '1.2'}
        className="speaker-stroke"
      />

      {/* Cabinet Body */}
      <rect
        x="142"
        y="26"
        width="96"
        height="38"
        rx="4"
        fill="#121318"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.8' : '1.2'}
        className="speaker-stroke"
      />

      {/* Left Mid-Woofer */}
      <circle
        cx="165"
        cy="45"
        r="10.5"
        fill="none"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.5' : '1.2'}
        className="speaker-stroke"
      />
      <circle
        cx="165"
        cy="45"
        r="3.5"
        fill="none"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth="1"
        className="speaker-stroke"
      />

      {/* Center Tweeter */}
      <circle
        cx="190"
        cy="45"
        r="7"
        fill="none"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.5' : '1.2'}
        className="speaker-stroke"
      />
      <circle
        cx="190"
        cy="45"
        r="2.5"
        fill={isCenter ? activeColor : 'none'}
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth="1"
        className="speaker-stroke"
      />

      {/* Right Mid-Woofer */}
      <circle
        cx="215"
        cy="45"
        r="10.5"
        fill="none"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isCenter ? '1.5' : '1.2'}
        className="speaker-stroke"
      />
      <circle
        cx="215"
        cy="45"
        r="3.5"
        fill="none"
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth="1"
        className="speaker-stroke"
      />

      {/* Indicator Dot */}
      <circle
        cx="190"
        cy="33"
        r="1.6"
        fill={isCenter ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        className="speaker-stroke"
      />

      {/* Center Downward Sound Waves */}
      {isCenter && (
        <g className="center-sound-waves pointer-events-none">
          <path
            d="M 166,72 Q 190,82 214,72"
            fill="none"
            stroke={activeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.95"
          />
          <path
            d="M 156,81 Q 190,95 224,81"
            fill="none"
            stroke={activeColor}
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.65"
          />
          <path
            d="M 146,90 Q 190,108 234,90"
            fill="none"
            stroke={activeColor}
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeDasharray="4 3"
            opacity="0.35"
          />
        </g>
      )}

      {/* Channel Label Badge */}
      <rect
        x="172"
        y="10"
        width="36"
        height="12"
        rx="2.5"
        fill={isCenter ? activeColor : '#121318'}
        stroke={isCenter ? activeColor : 'rgba(255, 255, 255, 0.18)'}
        strokeWidth="1"
        className={isCenter ? '' : 'speaker-badge-bg'}
      />
      <text
        x="190"
        y="18.5"
        textAnchor="middle"
        fill={isCenter ? activeForeground : 'rgba(255, 255, 255, 0.7)'}
        fontSize="7"
        fontFamily="monospace"
        fontWeight="bold"
        className={isCenter ? '' : 'speaker-badge-text'}
      >
        CENTER
      </text>
    </g>
  )

  const subwooferSpeakerNode = (
    <g
      key="subwoofer-speaker"
      className={`speaker-node cursor-pointer focus:outline-none ${isSub ? 'active' : 'inactive'}`}
      onClick={() => onSelectRole('subwoofer')}
      role="button"
      tabIndex={-1}
      aria-label="Subwoofer LFE Channel"
      style={{ outline: 'none', zIndex: isCenter ? 10 : 20 }}
    >
      {/* Isolation Feet */}
      <rect
        x="171"
        y="130"
        width="8"
        height="2.5"
        rx="1"
        fill="#121318"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isSub ? '1.8' : '1.2'}
        className="speaker-stroke"
      />
      <rect
        x="201"
        y="130"
        width="8"
        height="2.5"
        rx="1"
        fill="#121318"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isSub ? '1.8' : '1.2'}
        className="speaker-stroke"
      />

      {/* Cabinet Body */}
      <rect
        x="165"
        y="80"
        width="50"
        height="50"
        rx="5"
        fill="#121318"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isSub ? '1.8' : '1.2'}
        className="speaker-stroke"
      />

      {/* Subwoofer Cone */}
      <circle
        cx="190"
        cy="100"
        r="14"
        fill="none"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth={isSub ? '1.5' : '1.2'}
        className="speaker-stroke"
      />
      <circle
        cx="190"
        cy="100"
        r="5"
        fill="none"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth="1"
        className="speaker-stroke"
      />

      {/* Bass Reflex Port */}
      <circle
        cx="190"
        cy="120"
        r="3"
        fill="none"
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        strokeWidth="1"
        className="speaker-stroke"
      />

      {/* Indicator Dot */}
      <circle
        cx="173"
        cy="88"
        r="1.6"
        fill={isSub ? activeColor : 'rgba(255, 255, 255, 0.2)'}
        className="speaker-stroke"
      />

      {/* Deep Bass Pressure Waves */}
      {isSub && (
        <g className="sub-bass-waves pointer-events-none">
          <circle
            cx="190"
            cy="104"
            r="34"
            fill="none"
            stroke={activeColor}
            strokeWidth="1.5"
            strokeDasharray="4 3"
            opacity="0.85"
          />
          <circle
            cx="190"
            cy="104"
            r="46"
            fill="none"
            stroke={activeColor}
            strokeWidth="1.2"
            strokeDasharray="5 4"
            opacity="0.55"
          />
          <circle
            cx="190"
            cy="104"
            r="58"
            fill="none"
            stroke={activeColor}
            strokeWidth="1"
            strokeDasharray="6 4"
            opacity="0.28"
          />
        </g>
      )}

      {/* Channel Label Badge */}
      <rect
        x="172"
        y="137"
        width="36"
        height="12"
        rx="2.5"
        fill={isSub ? activeColor : '#121318'}
        stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.18)'}
        strokeWidth="1"
        className={isSub ? '' : 'speaker-badge-bg'}
      />
      <text
        x="190"
        y="145.5"
        textAnchor="middle"
        fill={isSub ? activeForeground : 'rgba(255, 255, 255, 0.7)'}
        fontSize="7"
        fontFamily="monospace"
        fontWeight="bold"
        className={isSub ? '' : 'speaker-badge-text'}
      >
        SUB LFE
      </text>
    </g>
  )

  return (
    <div className="relative w-full rounded-2xl bg-surface border border-border/60 flex flex-col p-3 select-none overflow-hidden group shadow-inner">
      {/* ── Soundstage HUD Header Readout ── */}
      <div className="flex items-center justify-between px-1 mb-1 text-[10px] font-mono pointer-events-none">
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full transition-colors"
            style={{ backgroundColor: activeColor }}
          />
          <span className="font-bold text-text uppercase tracking-wider">
            {isLeft
              ? 'Left Monitor Active'
              : isRight
              ? 'Right Monitor Active'
              : isCenter
              ? 'Center Channel Active'
              : 'Subwoofer LFE Active'}
          </span>
        </div>
        <span className="text-text-muted tracking-wide font-medium">
          {isLeft
            ? '-30° AZIMUTH • 2.4M'
            : isRight
            ? '+30° AZIMUTH • 2.4M'
            : isCenter
            ? '0° CENTER • 2.1M'
            : 'OMNI LFE • FLOOR'}
        </span>
      </div>

      <svg
        className="w-full h-auto aspect-[19/10] max-h-56 overflow-visible select-none focus:outline-none"
        viewBox="0 0 380 200"
        aria-hidden="true"
        style={{ outline: 'none' }}
      >
        <style>{`
          .speaker-node, .speaker-node:focus, .speaker-node:focus-visible, svg, svg:focus, svg:focus-visible {
            outline: none !important;
            -webkit-tap-highlight-color: transparent !important;
          }
          .speaker-node .speaker-stroke {
            transition: stroke 0.2s ease, opacity 0.2s ease;
          }
          .speaker-node .speaker-badge-bg {
            transition: stroke 0.2s ease, fill 0.2s ease;
          }
          .speaker-node .speaker-badge-text {
            transition: fill 0.2s ease;
          }
          .speaker-node.inactive:hover .speaker-stroke {
            stroke: rgba(255, 255, 255, 0.45);
          }
          .speaker-node.inactive:hover .speaker-badge-bg {
            stroke: rgba(255, 255, 255, 0.35);
          }
          .speaker-node.inactive:hover .speaker-badge-text {
            fill: rgba(255, 255, 255, 0.95);
          }
        `}</style>

        {/* ── Studio Acoustic Field Grid & Stereo Triangle ── */}
        <g className="soundstage-polar-grid pointer-events-none" opacity="0.7">
          {/* Concentric soundstage distance rings */}
          <path
            d="M 130,165 A 60,60 0 0,1 250,165"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <path
            d="M 85,165 A 105,105 0 0,1 295,165"
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <path
            d="M 40,165 A 150,150 0 0,1 340,165"
            fill="none"
            stroke="rgba(255, 255, 255, 0.05)"
            strokeWidth="1"
          />

          {/* ITU-R BS.775 60-degree Stereo Triangle Reference Lines */}
          <line
            x1="55"
            y1="85"
            x2="325"
            y2="85"
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />

          {/* Left Channel Acoustic Ray */}
          <line
            x1="190"
            y1="165"
            x2="55"
            y2="85"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.12)'}
            strokeWidth={isLeft ? '1.8' : '1'}
            strokeDasharray={isLeft ? 'none' : '3 3'}
          />

          {/* Center Channel Acoustic Ray */}
          {!isCenter && (
            <line
              x1="190"
              y1="165"
              x2="190"
              y2="50"
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* Subwoofer LFE Acoustic Ray */}
          <line
            x1="190"
            y1="165"
            x2="190"
            y2="105"
            stroke={isSub ? activeColor : 'rgba(255, 255, 255, 0.12)'}
            strokeWidth={isSub ? '1.8' : '1'}
            strokeDasharray={isSub ? 'none' : '3 3'}
          />

          {/* Right Channel Acoustic Ray */}
          <line
            x1="190"
            y1="165"
            x2="325"
            y2="85"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.12)'}
            strokeWidth={isRight ? '1.8' : '1'}
            strokeDasharray={isRight ? 'none' : '3 3'}
          />
        </g>

        {/* ── 1. Left Studio Monitor Tower ── */}
        <g
          className={`speaker-node cursor-pointer focus:outline-none ${isLeft ? 'active' : 'inactive'}`}
          onClick={() => onSelectRole('left')}
          role="button"
          tabIndex={-1}
          aria-label="Left Speaker Channel"
          style={{ outline: 'none' }}
        >
          {/* Plinth / Base Stand */}
          <rect
            x="32"
            y="132"
            width="46"
            height="3"
            rx="1.5"
            fill="#121318"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isLeft ? '1.8' : '1.2'}
            className="speaker-stroke"
          />

          {/* Cabinet Body */}
          <rect
            x="35"
            y="36"
            width="40"
            height="96"
            rx="4"
            fill="#121318"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isLeft ? '1.8' : '1.2'}
            className="speaker-stroke"
          />

          {/* Tweeter Driver */}
          <circle
            cx="55"
            cy="53"
            r="7"
            fill="none"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isLeft ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="55"
            cy="53"
            r="2.5"
            fill={isLeft ? activeColor : 'none'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Mid-Range Driver */}
          <circle
            cx="55"
            cy="77"
            r="9.5"
            fill="none"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isLeft ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="55"
            cy="77"
            r="3.5"
            fill="none"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Woofer Driver */}
          <circle
            cx="55"
            cy="104"
            r="12.5"
            fill="none"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isLeft ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="55"
            cy="104"
            r="4.5"
            fill="none"
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Indicator Dot */}
          <circle
            cx="55"
            cy="123"
            r="1.6"
            fill={isLeft ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            className="speaker-stroke"
          />

          {/* Active Sound Dispersion Wavefronts */}
          {isLeft && (
            <g className="left-sound-waves pointer-events-none">
              <path
                d="M 82,65 A 28,28 0 0,1 89,97"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.95"
              />
              <path
                d="M 93,55 A 42,42 0 0,1 104,107"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.65"
              />
              <path
                d="M 104,45 A 58,58 0 0,1 119,117"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.1"
                strokeLinecap="round"
                strokeDasharray="4 3"
                opacity="0.35"
              />
            </g>
          )}

          {/* Channel Label Badge */}
          <rect
            x="40"
            y="141"
            width="30"
            height="13"
            rx="3"
            fill={isLeft ? activeColor : '#121318'}
            stroke={isLeft ? activeColor : 'rgba(255, 255, 255, 0.18)'}
            strokeWidth="1"
            className={isLeft ? '' : 'speaker-badge-bg'}
          />
          <text
            x="55"
            y="150.5"
            textAnchor="middle"
            fill={isLeft ? activeForeground : 'rgba(255, 255, 255, 0.7)'}
            fontSize="8"
            fontFamily="monospace"
            fontWeight="bold"
            className={isLeft ? '' : 'speaker-badge-text'}
          >
            LEFT
          </text>
        </g>

        {/* ── 2 & 3. Center and Subwoofer Channels (stacking order prioritizes active channel) ── */}
        {isCenter ? (
          <>
            {subwooferSpeakerNode}
            {centerSpeakerNode}
          </>
        ) : (
          <>
            {centerSpeakerNode}
            {subwooferSpeakerNode}
          </>
        )}

        {/* ── 4. Right Studio Monitor Tower ── */}
        <g
          className={`speaker-node cursor-pointer focus:outline-none ${isRight ? 'active' : 'inactive'}`}
          onClick={() => onSelectRole('right')}
          role="button"
          tabIndex={-1}
          aria-label="Right Speaker Channel"
          style={{ outline: 'none' }}
        >
          {/* Plinth / Base Stand */}
          <rect
            x="302"
            y="132"
            width="46"
            height="3"
            rx="1.5"
            fill="#121318"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isRight ? '1.8' : '1.2'}
            className="speaker-stroke"
          />

          {/* Cabinet Body */}
          <rect
            x="305"
            y="36"
            width="40"
            height="96"
            rx="4"
            fill="#121318"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isRight ? '1.8' : '1.2'}
            className="speaker-stroke"
          />

          {/* Tweeter Driver */}
          <circle
            cx="325"
            cy="53"
            r="7"
            fill="none"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isRight ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="325"
            cy="53"
            r="2.5"
            fill={isRight ? activeColor : 'none'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Mid-Range Driver */}
          <circle
            cx="325"
            cy="77"
            r="9.5"
            fill="none"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isRight ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="325"
            cy="77"
            r="3.5"
            fill="none"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Woofer Driver */}
          <circle
            cx="325"
            cy="104"
            r="12.5"
            fill="none"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth={isRight ? '1.5' : '1.2'}
            className="speaker-stroke"
          />
          <circle
            cx="325"
            cy="104"
            r="4.5"
            fill="none"
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            strokeWidth="1"
            className="speaker-stroke"
          />

          {/* Indicator Dot */}
          <circle
            cx="325"
            cy="123"
            r="1.6"
            fill={isRight ? activeColor : 'rgba(255, 255, 255, 0.2)'}
            className="speaker-stroke"
          />

          {/* Active Sound Dispersion Wavefronts */}
          {isRight && (
            <g className="right-sound-waves pointer-events-none">
              <path
                d="M 298,65 A 28,28 0 0,0 291,97"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.95"
              />
              <path
                d="M 287,55 A 42,42 0 0,0 276,107"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.65"
              />
              <path
                d="M 276,45 A 58,58 0 0,0 261,117"
                fill="none"
                stroke={activeColor}
                strokeWidth="1.1"
                strokeLinecap="round"
                strokeDasharray="4 3"
                opacity="0.35"
              />
            </g>
          )}

          {/* Channel Label Badge */}
          <rect
            x="310"
            y="141"
            width="30"
            height="13"
            rx="3"
            fill={isRight ? activeColor : '#121318'}
            stroke={isRight ? activeColor : 'rgba(255, 255, 255, 0.18)'}
            strokeWidth="1"
            className={isRight ? '' : 'speaker-badge-bg'}
          />
          <text
            x="325"
            y="150.5"
            textAnchor="middle"
            fill={isRight ? activeForeground : 'rgba(255, 255, 255, 0.7)'}
            fontSize="8"
            fontFamily="monospace"
            fontWeight="bold"
            className={isRight ? '' : 'speaker-badge-text'}
          >
            RIGHT
          </text>
        </g>

        {/* ── Sweet Spot / Listening Position Node ── */}
        {sweetSpotNode}
      </svg>
    </div>
  )
}
