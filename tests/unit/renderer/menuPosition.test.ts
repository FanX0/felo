import { describe, it, expect, beforeEach } from 'vitest'
import { calculateMenuPosition } from '../../../src/renderer/src/lib/menuPosition'

describe('calculateMenuPosition', () => {
  beforeEach(() => {
    // Standard mock viewport 1280x800
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 })
  })

  it('positions menu downwards when plenty of space below trigger', () => {
    const triggerRect = {
      top: 100,
      bottom: 130,
      left: 1000,
      right: 1030,
      width: 30,
      height: 30
    }

    const pos = calculateMenuPosition({
      triggerRect,
      menuWidth: 250,
      estimatedHeight: 400
    })

    // spaceBelow = 800 - 130 - 12 = 658px >= 400px
    expect(pos.openUpwards).toBe(false)
    expect(pos.y).toBe(136) // 130 + 6
    expect(pos.x).toBe(1030 - 250) // right - menuWidth = 780
  })

  it('automatically flips menu upwards when row is near the bottom of the screen', () => {
    const triggerRect = {
      top: 720,
      bottom: 750,
      left: 1000,
      right: 1030,
      width: 30,
      height: 30
    }

    const pos = calculateMenuPosition({
      triggerRect,
      menuWidth: 250,
      estimatedHeight: 440
    })

    // spaceBelow = 800 - 750 - 12 = 38px (< 440px)
    // spaceAbove = 720 - 12 = 708px (> spaceBelow)
    expect(pos.openUpwards).toBe(true)
    // Should open above triggerRect.top
    expect(pos.y).toBe(720 - 440 - 6) // 274
    expect(pos.y).toBeGreaterThanOrEqual(12)
    // Bottom of the menu should not exceed triggerRect.top
    expect(pos.y + 440).toBeLessThanOrEqual(triggerRect.top)
  })

  it('clamps horizontal position when trigger is near screen edges', () => {
    // Near right screen edge
    const triggerRight = {
      top: 300,
      bottom: 330,
      left: 1260,
      right: 1275,
      width: 15,
      height: 30
    }

    const posRight = calculateMenuPosition({
      triggerRect: triggerRight,
      menuWidth: 250,
      estimatedHeight: 300,
      padding: 12
    })

    // menuWidth 250 + padding 12 = 262. Max x is 1280 - 250 - 12 = 1018
    expect(posRight.x).toBeLessThanOrEqual(1280 - 250 - 12)
    expect(posRight.x).toBeGreaterThanOrEqual(12)

    // Near left screen edge
    const triggerLeft = {
      top: 300,
      bottom: 330,
      left: 5,
      right: 25,
      width: 20,
      height: 30
    }

    const posLeft = calculateMenuPosition({
      triggerRect: triggerLeft,
      menuWidth: 250,
      estimatedHeight: 300,
      padding: 12
    })

    expect(posLeft.x).toBeGreaterThanOrEqual(12)
  })

  it('handles right-click cursor coordinates and flips upward if near bottom', () => {
    const pos = calculateMenuPosition({
      cursorX: 500,
      cursorY: 760,
      menuWidth: 220,
      estimatedHeight: 380
    })

    expect(pos.openUpwards).toBe(true)
    expect(pos.y).toBeLessThan(760)
    expect(pos.y).toBeGreaterThanOrEqual(12)
  })
})
