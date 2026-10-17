import { describe, it, expect, beforeEach, vi } from 'vitest'
import { roomClockSync } from '../../../src/renderer/src/lib/roomClockSync'

describe('Renderer Core: roomClockSync', () => {
  beforeEach(() => {
    roomClockSync.reset()
    vi.useRealTimers()
  })

  it('initializes uncalibrated with a generated guest ID', () => {
    expect(roomClockSync.isCalibrated()).toBe(false)
    expect(roomClockSync.getGuestId()).toMatch(/^guest-/)
  })

  it('calibrates clock offset via Min-RTT NTP calculation', () => {
    const t0 = 1000 // guest sends ping
    const t1 = 1050 // host receives & pong
    // t2 (guest receives) = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(1100)

    roomClockSync.handlePong({ guestId: roomClockSync.getGuestId(), t0, t1 })

    expect(roomClockSync.isCalibrated()).toBe(true)
    // rtt = 1100 - 1000 = 100ms
    // offset = 1050 - (1000 + 50) = 0ms
    expect(roomClockSync.getClockOffsetMs()).toBe(0)
  })

  it('filters out network latency spikes > 1500ms', () => {
    const t0 = 1000
    const t1 = 2000
    vi.spyOn(Date, 'now').mockReturnValue(3000) // RTT = 2000ms (> 1500ms)

    roomClockSync.handlePong({ guestId: 'g1', t0, t1 })
    expect(roomClockSync.isCalibrated()).toBe(false)
  })

  it('evaluates drift as in_sync when within 50ms deadband', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)

    // evaluateDrift(currentGuestTime, targetTime, isPlaying)
    const result = roomClockSync.evaluateDrift(10.02, 10.0, true) // 20ms drift
    expect(result.action).toBe('in_sync')
    expect(result.drift).toBeCloseTo(0.02, 2)
  })

  it('triggers hard_seek when drift exceeds 15.0s catastrophic threshold', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)

    // drift = 26.0 - 10.0 = 16.0s (> 15.0s)
    const result = roomClockSync.evaluateDrift(26.0, 10.0, true)
    expect(result.action).toBe('hard_seek')
  })

  it('requires 3 consecutive samples in same direction for soft_align', () => {
    const now = 50000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    // Drift = 100ms (between 50ms and 2.0s)
    // Sample 1
    const r1 = roomClockSync.evaluateDrift(10.1, 10.0, true)
    expect(r1.action).toBe('in_sync')

    // Sample 2
    const r2 = roomClockSync.evaluateDrift(10.1, 10.0, true)
    expect(r2.action).toBe('in_sync')

    // Sample 3 -> should trigger soft_align
    const r3 = roomClockSync.evaluateDrift(10.1, 10.0, true)
    expect(r3.action).toBe('soft_align')
  })
})
