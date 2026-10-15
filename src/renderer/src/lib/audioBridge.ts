let activeAudioElement: HTMLAudioElement | null = null

export function registerActiveAudioElement(el: HTMLAudioElement | null): void {
  activeAudioElement = el
}

export function getActiveAudioTime(): number {
  if (!activeAudioElement) return 0
  return activeAudioElement.currentTime || 0
}

export function getActiveAudioElement(): HTMLAudioElement | null {
  return activeAudioElement
}

export function setAudioPlaybackRate(rate: number): void {
  if (activeAudioElement) {
    try {
      activeAudioElement.playbackRate = Math.max(0.5, Math.min(2.0, rate))
    } catch {
      // ignore
    }
  }
}

export function getAudioPlaybackRate(): number {
  return activeAudioElement?.playbackRate ?? 1.0
}

