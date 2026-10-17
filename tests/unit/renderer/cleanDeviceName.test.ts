import { describe, it, expect } from 'vitest'
import { getCleanDeviceName } from '../../../src/renderer/src/lib/deviceInfo'

describe('getCleanDeviceName', () => {
  it('strips bullet-separated IP address and OS tag from raw desktop name', () => {
    expect(getCleanDeviceName('Felo Desktop (Windows • 192.168.1.12)')).toBe('Felo Desktop')
  })

  it('strips parenthesized IP address', () => {
    expect(getCleanDeviceName('Felo Desktop (192.168.1.12)')).toBe('Felo Desktop')
  })

  it('strips IP address with port', () => {
    expect(getCleanDeviceName('Felo Desktop (192.168.1.12:4788)')).toBe('Felo Desktop')
  })

  it('strips redundant OS parenthetical from Felo Desktop (Windows)', () => {
    expect(getCleanDeviceName('Felo Desktop (Windows)')).toBe('Felo Desktop')
    expect(getCleanDeviceName('Felo Desktop (macOS)')).toBe('Felo Desktop')
  })

  it('cleans mobile device strings with bullet IP', () => {
    expect(getCleanDeviceName("Farid's iPhone (iOS • 192.168.1.25)")).toBe("Farid's iPhone")
  })

  it('preserves clean custom user device names', () => {
    expect(getCleanDeviceName('Living Room Hi-Fi PC')).toBe('Living Room Hi-Fi PC')
    expect(getCleanDeviceName('MacBook Pro')).toBe('MacBook Pro')
  })

  it('falls back to default fallback when string is empty or invalid', () => {
    expect(getCleanDeviceName(null)).toBe('Device')
    expect(getCleanDeviceName(undefined, 'Remote')).toBe('Remote')
    expect(getCleanDeviceName('', 'Fallback')).toBe('Fallback')
  })
})
