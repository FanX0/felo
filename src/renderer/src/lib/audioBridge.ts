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
