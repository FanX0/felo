import React, { useLayoutEffect } from 'react'

export interface MenuPositionOptions {
  triggerRect?: {
    top: number
    bottom: number
    left: number
    right: number
  } | DOMRect | null
  cursorX?: number
  cursorY?: number
  menuWidth?: number
  estimatedHeight?: number
  padding?: number
  gap?: number
}

export interface CalculatedMenuPosition {
  x: number
  y: number
  openUpwards: boolean
  maxHeight: number
}

/**
 * Calculates optimal menu placement ensuring it does not clip against the bottom,
 * top, or horizontal edges of the viewport. If vertical space below the trigger is
 * insufficient, it automatically flips upward.
 */
export function calculateMenuPosition({
  triggerRect,
  cursorX,
  cursorY,
  menuWidth = 250,
  estimatedHeight = 420,
  padding = 12,
  gap = 6
}: MenuPositionOptions): CalculatedMenuPosition {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800

  let x = padding
  let y = padding
  let openUpwards = false
  let maxHeight = Math.max(160, viewportHeight - padding * 2)

  if (triggerRect) {
    const spaceBelow = viewportHeight - triggerRect.bottom - padding
    const spaceAbove = triggerRect.top - padding

    // Flip upward if not enough space below AND there is more space above
    openUpwards = (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) || (spaceBelow < 200 && spaceAbove >= 200)

    if (openUpwards) {
      y = Math.max(padding, triggerRect.top - estimatedHeight - gap)
      maxHeight = Math.max(160, triggerRect.top - padding - gap)
    } else {
      y = triggerRect.bottom + gap
      maxHeight = Math.max(160, viewportHeight - triggerRect.bottom - padding - gap)
    }

    // Align horizontally with the right edge of trigger, clamped to viewport
    x = Math.min(triggerRect.right - menuWidth, viewportWidth - menuWidth - padding)
    if (x < padding) x = padding
  } else if (typeof cursorX === 'number' && typeof cursorY === 'number') {
    const spaceBelow = viewportHeight - cursorY - padding
    const spaceAbove = cursorY - padding

    openUpwards = (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) || (spaceBelow < 200 && spaceAbove >= 200)

    if (openUpwards) {
      y = Math.max(padding, cursorY - estimatedHeight - gap)
      maxHeight = Math.max(160, cursorY - padding - gap)
    } else {
      y = cursorY + gap
      maxHeight = Math.max(160, viewportHeight - cursorY - padding - gap)
    }

    x = Math.min(cursorX, viewportWidth - menuWidth - padding)
    if (x < padding) x = padding
  }

  // Safety clamp y if opening downwards but still exceeding viewport
  if (!openUpwards && y + estimatedHeight > viewportHeight - padding) {
    y = Math.max(padding, viewportHeight - estimatedHeight - padding)
  }

  return { x, y, openUpwards, maxHeight }
}

export interface UseMenuAutoPositionOptions {
  menuRef: React.RefObject<HTMLElement | null>
  triggerRect?: {
    top: number
    bottom: number
    left: number
    right: number
  } | DOMRect | null
  initialX?: number
  initialY?: number
  openUpwards?: boolean
  padding?: number
  gap?: number
}

/**
 * React hook that measures the actual DOM menu height synchronously in useLayoutEffect
 * and repositions the menu and sets maxHeight so it is never clipped or overflows offscreen.
 */
export function useMenuAutoPosition({
  menuRef,
  triggerRect,
  initialX,
  initialY,
  openUpwards,
  padding = 12,
  gap = 6
}: UseMenuAutoPositionOptions): void {
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    const actualHeight = rect.height
    const actualWidth = rect.width

    if (triggerRect) {
      const spaceBelow = viewportHeight - triggerRect.bottom - padding
      const spaceAbove = triggerRect.top - padding

      const shouldOpenUpwards =
        openUpwards !== undefined
          ? openUpwards
          : spaceBelow < actualHeight && spaceAbove > spaceBelow

      let targetY: number
      let maxHeight: number

      if (shouldOpenUpwards) {
        targetY = triggerRect.top - actualHeight - gap
        maxHeight = Math.max(160, triggerRect.top - padding - gap)
        if (targetY < padding) {
          targetY = padding
        }
      } else {
        targetY = triggerRect.bottom + gap
        maxHeight = Math.max(160, viewportHeight - triggerRect.bottom - padding - gap)
        if (targetY + actualHeight > viewportHeight - padding) {
          targetY = Math.max(padding, viewportHeight - actualHeight - padding)
        }
      }

      let targetX = Math.min(triggerRect.right - actualWidth, viewportWidth - actualWidth - padding)
      if (targetX < padding) targetX = padding

      el.style.top = `${Math.round(targetY)}px`
      el.style.left = `${Math.round(targetX)}px`
      el.style.maxHeight = `${Math.round(maxHeight)}px`
    } else {
      let targetY = initialY ?? rect.top
      let targetX = initialX ?? rect.left

      if (targetY + actualHeight > viewportHeight - padding) {
        targetY = Math.max(padding, viewportHeight - actualHeight - padding)
      }
      if (targetY < padding) targetY = padding

      if (targetX + actualWidth > viewportWidth - padding) {
        targetX = Math.max(padding, viewportWidth - actualWidth - padding)
      }
      if (targetX < padding) targetX = padding

      const maxHeight = Math.max(160, viewportHeight - targetY - padding)

      el.style.top = `${Math.round(targetY)}px`
      el.style.left = `${Math.round(targetX)}px`
      el.style.maxHeight = `${Math.round(maxHeight)}px`
    }
  }, [triggerRect, initialX, initialY, openUpwards, padding, gap])
}
