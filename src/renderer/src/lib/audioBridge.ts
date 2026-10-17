import { audioDspEngine } from './audioDspEngine'

let activeAudioElement: HTMLAudioElement | null = null
let activeTrackChangeListener: (() => void) | null = null

export function registerActiveAudioElement(el: HTMLAudioElement | null): void {
  activeAudioElement = el
  activeTrackChangeListener?.()
}

export function registerAudioTrackChangeListener(listener: (() => void) | null): void {
  activeTrackChangeListener = listener
}

export function notifyAudioTrackChanged(): void {
  activeTrackChangeListener?.()
}

export function getActiveAudioMediaStream(): MediaStream | null {
  if (!activeAudioElement) return null
  try {
    const el = activeAudioElement as unknown as {
      captureStream?: () => MediaStream
      mozCaptureStream?: () => MediaStream
    }
    const stream: MediaStream | null =
      typeof el.captureStream === 'function'
        ? el.captureStream()
        : typeof el.mozCaptureStream === 'function'
          ? el.mozCaptureStream()
          : null
    return stream
  } catch (err) {
    console.warn('[audioBridge] Failed to capture audio element stream:', err)
    return null
  }
}

let customTimeProvider: (() => number | null) | null = null

export function registerAudioTimeProvider(provider: (() => number | null) | null): void {
  customTimeProvider = provider
}

export function getActiveAudioTime(): number {
  if (customTimeProvider) {
    try {
      const time = customTimeProvider()
      if (typeof time === 'number' && Number.isFinite(time)) {
        return time
      }
    } catch {
      // Fall through to activeAudioElement
    }
  }
  if (!activeAudioElement) return 0
  return activeAudioElement.currentTime || 0
}

export function getActiveAudioElement(): HTMLAudioElement | null {
  return activeAudioElement
}

export function setAudioPlaybackRate(rate: number): void {
  if (activeAudioElement) {
    try {
      if ('preservesPitch' in activeAudioElement && !activeAudioElement.preservesPitch) {
        activeAudioElement.preservesPitch = true
      }
      const clamped = Math.max(0.5, Math.min(2.0, Number(rate.toFixed(4))))
      if (Math.abs((activeAudioElement.playbackRate || 1.0) - clamped) > 0.002) {
        activeAudioElement.playbackRate = clamped
      }
    } catch {
      // ignore
    }
  }
}

export function getAudioPlaybackRate(): number {
  return activeAudioElement?.playbackRate ?? 1.0
}

// 1-millisecond silent WAV used to permanently unlock the persistent <audio> element
// on iOS Safari, Android Chrome, and desktop browsers within a user gesture.
export const SILENT_UNLOCK_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

let _isAudioUnlocked = false

export function isAudioUnlocked(): boolean {
  return _isAudioUnlocked
}

export async function unlockAudioElement(): Promise<boolean> {
  const el = activeAudioElement
  try {
    void audioDspEngine.resume()
  } catch {
    // Ignore audio context resumption errors
  }
  if (!el) return false
  try {
    el.muted = false
    if (el.volume === 0) {
      el.volume = 1.0
    }

    if (el.srcObject) {
      await el.play()
      _isAudioUnlocked = true
      return true
    }

    // Only load SILENT_UNLOCK_WAV if no real song is loaded yet!
    // If a real song is already set on the element, play it directly.
    const hasRealSong =
      Boolean(el.src) &&
      !el.src.startsWith('data:audio/') &&
      el.src !== window.location.href

    if (!hasRealSong) {
      el.src = SILENT_UNLOCK_WAV
      await el.play()
      el.pause()
    } else {
      await el.play()
    }

    _isAudioUnlocked = true
    return true
  } catch (err) {
    console.warn('[audioBridge] unlockAudioElement failed:', err)
    return false
  }
}

