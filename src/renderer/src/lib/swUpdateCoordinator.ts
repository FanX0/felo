// Felo — Context-Aware Service Worker Update Coordinator
// Modelled after MUSIXQUARE's zero-disruption update architecture

import { useListeningStore } from '../hooks/useListeningStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useRoomChatStore } from '../hooks/useRoomChatStore'

const UPDATE_DISMISSAL_KEY = 'felo-sw-update-dismissal-v1'
const UPDATE_PROMPT_LEASE_KEY = 'felo-sw-update-prompt-lease-v1'
const KNOWN_GENERATION_DISMISSAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const PROMPT_LEASE_MS = 5 * 60 * 1000 // 5 minutes
const DEFERRED_PROMPT_SETTLE_MS = 1000 // 1 second settle delay
const WORKER_GENERATION_TIMEOUT_MS = 800

const FELO_SW_GENERATION_REQUEST = 'FELO_SW_GENERATION_REQUEST'
const FELO_SW_GENERATION_RESPONSE = 'FELO_SW_GENERATION_RESPONSE'

export interface ServiceWorkerGeneration {
  version: string | null
  promptIdentity: string
}

export interface UpdateDialogPayload {
  isOpen: boolean
  isRecovery?: boolean
  version?: string | null
  onRefresh: () => void
  onLater?: () => void
}

let _dialogCallback: ((payload: UpdateDialogPayload | null) => void) | null = null
let _deferredWorker: ServiceWorker | null = null
let _deferredSettleTimer: ReturnType<typeof setTimeout> | null = null
let _activePromptLease: string | null = null
const _announcedIdentities = new Set<string>()

export function registerUpdateDialogHandler(
  handler: (payload: UpdateDialogPayload | null) => void
): () => void {
  _dialogCallback = handler
  return () => {
    if (_dialogCallback === handler) _dialogCallback = null
  }
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if ((navigator as any).standalone) return true
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    // Media query parsing fallback
  }
  return false
}

/**
 * Returns true if the user is in an active Listen Together session.
 */
export function isRoomSessionActive(): boolean {
  try {
    const listening = useListeningStore.getState()
    return Boolean(listening.hostRoom || listening.joinedRoom || listening.isJoiningRoom)
  } catch {
    return false
  }
}

/**
 * Returns true if audio is actively playing on this device.
 */
export function isPlaybackActive(): boolean {
  try {
    return Boolean(usePlayerStore.getState().isPlaying)
  } catch {
    return false
  }
}

/**
 * Owner policy: In an active room or during active audio playback,
 * NEVER show a blocking modal and NEVER auto-reload this tab.
 */
export function isUpdatePromptDeferred(): boolean {
  return isRoomSessionActive() || isPlaybackActive()
}

export function getUpdateNoticeCopy(): string {
  if (isStandaloneDisplayMode()) {
    return 'A new version of Felo is available. Reopen the app to apply it.'
  }
  return 'A new version of Felo is available. Refresh the page to apply it.'
}

/**
 * Post an un-intrusive local notification.
 * Prioritizes a local system message in RoomChat if in a room;
 * otherwise dispatches a non-intrusive toast event.
 */
export function postLocalUpdateNotice(message?: string): void {
  const text = message || getUpdateNoticeCopy()

  if (isRoomSessionActive()) {
    try {
      const listening = useListeningStore.getState()
      const roomId = listening.hostRoom?.id || listening.joinedRoom?.id
      useRoomChatStore.getState().addLocalSystemMessage(text, roomId)
      return
    } catch (e) {
      console.warn('[SW Update] Failed to announce in room chat:', e)
    }
  }

  // Fallback: Dispatch non-blocking toast
  window.dispatchEvent(
    new CustomEvent('felo:track-unavailable', {
      detail: {
        title: 'Update Available',
        message: text
      }
    })
  )
}

function readStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function isGenerationDismissed(identity: string): boolean {
  const storage = readStorage()
  if (!storage) return false
  try {
    const raw = storage.getItem(UPDATE_DISMISSAL_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    if (parsed && parsed.identity === identity && Number(parsed.expiresAt) > Date.now()) {
      return true
    }
  } catch {
    // Ignore JSON parse errors
  }
  return false
}

export function rememberGenerationDismissal(identity: string): void {
  const storage = readStorage()
  if (!storage) return
  try {
    storage.setItem(
      UPDATE_DISMISSAL_KEY,
      JSON.stringify({
        identity,
        expiresAt: Date.now() + KNOWN_GENERATION_DISMISSAL_MS
      })
    )
  } catch {
    // Ignore storage write errors
  }
}

export function acquirePromptLease(identity: string): boolean {
  const storage = readStorage()
  if (!storage) return true
  try {
    const now = Date.now()
    const raw = storage.getItem(UPDATE_PROMPT_LEASE_KEY)
    if (raw) {
      const lease = JSON.parse(raw)
      if (lease && lease.expiresAt > now && lease.identity === identity) {
        return false // Owned by another tab
      }
    }
    storage.setItem(
      UPDATE_PROMPT_LEASE_KEY,
      JSON.stringify({
        identity,
        expiresAt: now + PROMPT_LEASE_MS
      })
    )
    _activePromptLease = identity
    return true
  } catch {
    return true
  }
}

export function releasePromptLease(identity: string): void {
  const storage = readStorage()
  if (!storage) return
  try {
    const raw = storage.getItem(UPDATE_PROMPT_LEASE_KEY)
    if (raw) {
      const lease = JSON.parse(raw)
      if (lease && lease.identity === identity) {
        storage.removeItem(UPDATE_PROMPT_LEASE_KEY)
      }
    }
  } catch {
    // Ignore storage errors
  }
  if (_activePromptLease === identity) _activePromptLease = null
}

export async function resolveWorkerGeneration(
  worker: ServiceWorker
): Promise<ServiceWorkerGeneration> {
  return new Promise<ServiceWorkerGeneration>((resolve) => {
    const requestId = `felo-req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    let finished = false

    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      navigator.serviceWorker.removeEventListener('message', messageListener)
      resolve({
        version: null,
        promptIdentity: worker.scriptURL || 'unknown-worker'
      })
    }, WORKER_GENERATION_TIMEOUT_MS)

    const messageListener = (event: MessageEvent) => {
      const data = event.data
      if (
        data?.type === FELO_SW_GENERATION_RESPONSE &&
        data.requestId === requestId
      ) {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener('message', messageListener)
        const ver = typeof data.version === 'string' ? data.version : null
        resolve({
          version: ver,
          promptIdentity: ver ? `v:${ver}` : worker.scriptURL || 'unknown-worker'
        })
      }
    }

    navigator.serviceWorker.addEventListener('message', messageListener)
    try {
      worker.postMessage({ type: FELO_SW_GENERATION_REQUEST, requestId })
    } catch {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener('message', messageListener)
      resolve({
        version: null,
        promptIdentity: worker.scriptURL || 'unknown-worker'
      })
    }
  })
}

/**
 * Central waiting worker handler. Coordinates deferrals, leases, modal triggers, and skips.
 */
export async function handleWaitingWorker(
  worker: ServiceWorker,
  _registration?: ServiceWorkerRegistration
): Promise<void> {
  void _registration
  if (!navigator.serviceWorker.controller) {
    // First time claim; no old cache to retire
    return
  }

  const generation = await resolveWorkerGeneration(worker)

  // 1. If currently in a room or actively playing music:
  if (isUpdatePromptDeferred()) {
    _deferredWorker = worker
    if (!_announcedIdentities.has(generation.promptIdentity)) {
      _announcedIdentities.add(generation.promptIdentity)
      postLocalUpdateNotice()
    }
    return
  }

  // 2. If already dismissed for 24h:
  if (isGenerationDismissed(generation.promptIdentity)) {
    return
  }

  // 3. Acquire multi-tab lease so only 1 tab pops the modal
  if (!acquirePromptLease(generation.promptIdentity)) {
    return
  }

  // 4. Offer update modal dialog
  if (_dialogCallback) {
    _dialogCallback({
      isOpen: true,
      version: generation.version,
      onRefresh: () => {
        releasePromptLease(generation.promptIdentity)
        _dialogCallback?.(null)
        activateWorkerAndReload(worker)
      },
      onLater: () => {
        releasePromptLease(generation.promptIdentity)
        rememberGenerationDismissal(generation.promptIdentity)
        _dialogCallback?.(null)
      }
    })
  }
}

export function activateWorkerAndReload(worker: ServiceWorker): void {
  try {
    sessionStorage.setItem('felo-sw-reloading', String(Date.now()))
  } catch {
    // Ignore storage issues
  }

  let reloaded = false
  const reload = () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reload()
  })

  try {
    worker.postMessage({ type: 'SKIP_WAITING' })
  } catch (err) {
    console.warn('[SW Update] Failed to post SKIP_WAITING to worker:', err)
  }

  setTimeout(reload, 1200)
}

/**
 * Triggers recovery modal when a dynamic import fails (chunk missing after new deploy).
 */
export function triggerChunkLoadRecovery(error?: any): void {
  console.warn('[SW Update] Chunk load error detected; triggering recovery modal:', error)
  if (_dialogCallback) {
    _dialogCallback({
      isOpen: true,
      isRecovery: true,
      onRefresh: () => {
        window.location.reload()
      }
    })
  } else {
    window.location.reload()
  }
}

/**
 * Arms the 1-second settle timer when leaving a room or pausing playback.
 */
export function armDeferredPromptRetry(registration: ServiceWorkerRegistration): void {
  if (_deferredSettleTimer) clearTimeout(_deferredSettleTimer)
  _deferredSettleTimer = setTimeout(() => {
    _deferredSettleTimer = null
    if (!_deferredWorker) return
    if (isUpdatePromptDeferred()) return // Still active
    const worker = _deferredWorker
    _deferredWorker = null

    if (registration.waiting === worker && worker.state === 'installed') {
      void handleWaitingWorker(worker, registration)
    }
  }, DEFERRED_PROMPT_SETTLE_MS)
}

/**
 * Handle passive controllerchange: fired when another tab activated the new worker.
 */
export function handlePassiveControllerChange(controllerIdentity?: string): void {
  if (isUpdatePromptDeferred()) {
    // Tab in room or playing music: DO NOT reload!
    const key = controllerIdentity || 'active-update'
    if (!_announcedIdentities.has(key)) {
      _announcedIdentities.add(key)
      postLocalUpdateNotice('A new version of Felo was activated. Refresh the page when you are ready.')
    }
    return
  }

  // Tab is idle: reload smoothly
  try {
    const lastReload = Number(sessionStorage.getItem('felo-sw-reloading') || '0')
    if (Date.now() - lastReload < 10000) return // Avoid loop
    sessionStorage.setItem('felo-sw-reloading', String(Date.now()))
  } catch {
    // Ignore
  }
  window.location.reload()
}
