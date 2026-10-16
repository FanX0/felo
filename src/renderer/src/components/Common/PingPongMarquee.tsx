import React, { useEffect, useRef, useState } from 'react'

interface PingPongMarqueeProps {
  text: string
  className?: string
  active?: boolean
  speed?: number // pixels per second
  title?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export default function PingPongMarquee({
  text,
  className = '',
  active = false,
  speed = 36,
  title,
  onClick
}: PingPongMarqueeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const content = textRef.current
    if (!container || !content) return

    const measure = () => {
      const containerWidth = container.clientWidth
      const contentWidth = content.offsetWidth || content.scrollWidth
      const diff = Math.ceil(contentWidth - containerWidth)
      setOverflow(diff > 2 ? diff : 0)
    }

    measure()

    const observer = new ResizeObserver(() => {
      measure()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [text])

  const shouldAnimate = overflow > 0 && (active || isHovered)
  const travelSeconds = overflow / speed
  const totalDuration = Math.max(4, travelSeconds * 2 + 2.5)

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      title={title || text}
      className={`overflow-hidden max-w-full select-none ${className}`}
      style={
        shouldAnimate
          ? ({
              '--marquee-offset': `-${overflow}px`,
              '--marquee-duration': `${totalDuration}s`
            } as React.CSSProperties)
          : undefined
      }
    >
      <span
        ref={textRef}
        className={`marquee-content ${
          shouldAnimate ? 'marquee-overflowing' : 'truncate block'
        }`}
      >
        {text}
      </span>
    </div>
  )
}
