import { create } from 'zustand'

export const PRIVATE_SESSION_ACTIVE_KEY = 'felo_private_session_active'
export const PRIVATE_SESSION_STARTED_AT_KEY = 'felo_private_session_started_at'
export const PRIVATE_SESSION_AUTO_HOURS_KEY = 'felo_private_session_auto_hours'
export const PRIVATE_SESSION_MASK_SMTC_KEY = 'felo_private_session_mask_smtc'
export const LISTEN_HISTORY_ENABLED_KEY = 'felo_listen_history_enabled'

export interface PrivateSessionState {
  isPrivateSession: boolean
  startedAt: number | null
  autoDisableHours: number // 0 means manual only, e.g. 1, 6, 12
  maskMediaSession: boolean
  listenHistoryEnabled: boolean

  setPrivateSession: (enabled: boolean, notify?: boolean) => void
  togglePrivateSession: () => void
  setMaskMediaSession: (mask: boolean) => void
  setAutoDisableHours: (hours: number) => void
  setListenHistoryEnabled: (enabled: boolean) => void
  checkExpiration: () => boolean
  getRemainingTimeMs: () => number | null
}

function getInitialState() {
  if (typeof window === 'undefined') {
    return {
      isPrivateSession: false,
      startedAt: null,
      autoDisableHours: 6,
      maskMediaSession: true,
      listenHistoryEnabled: true
    }
  }

  const autoDisableHours = Number(localStorage.getItem(PRIVATE_SESSION_AUTO_HOURS_KEY) || '6')
  const maskMediaSession = localStorage.getItem(PRIVATE_SESSION_MASK_SMTC_KEY) !== 'false'
  const listenHistoryEnabled = localStorage.getItem(LISTEN_HISTORY_ENABLED_KEY) !== 'false'

  const wasActive = localStorage.getItem(PRIVATE_SESSION_ACTIVE_KEY) === 'true'
  const startedAt = Number(localStorage.getItem(PRIVATE_SESSION_STARTED_AT_KEY) || '0')

  // Check if session has expired
  if (wasActive && startedAt > 0 && autoDisableHours > 0) {
    const elapsed = Date.now() - startedAt
    const maxDuration = autoDisableHours * 60 * 60 * 1000
    if (elapsed >= maxDuration) {
      localStorage.removeItem(PRIVATE_SESSION_ACTIVE_KEY)
      localStorage.removeItem(PRIVATE_SESSION_STARTED_AT_KEY)
      return {
        isPrivateSession: false,
        startedAt: null,
        autoDisableHours,
        maskMediaSession,
        listenHistoryEnabled
      }
    }
  }

  return {
    isPrivateSession: wasActive,
    startedAt: wasActive ? startedAt : null,
    autoDisableHours,
    maskMediaSession,
    listenHistoryEnabled
  }
}

export const usePrivateSessionStore = create<PrivateSessionState>((set, get) => {
  const initial = getInitialState()

  const emitToast = (enabled: boolean) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('felo:private-session-toast', {
        detail: {
          enabled,
          title: enabled ? 'Private Session Enabled' : 'Private Session Ended',
          message: enabled
            ? 'Your listening activity is hidden from friends, history, scrobbles, and Discord.'
            : 'Your listening activity is now being shared and recorded normally.'
        }
      })
    )
    window.dispatchEvent(
      new CustomEvent('felo:private-session-changed', {
        detail: { isPrivateSession: enabled }
      })
    )
  }

  return {
    ...initial,

    setPrivateSession: (enabled, notify = true) => {
      const now = enabled ? Date.now() : null
      if (typeof window !== 'undefined') {
        if (enabled) {
          localStorage.setItem(PRIVATE_SESSION_ACTIVE_KEY, 'true')
          localStorage.setItem(PRIVATE_SESSION_STARTED_AT_KEY, String(now))
        } else {
          localStorage.removeItem(PRIVATE_SESSION_ACTIVE_KEY)
          localStorage.removeItem(PRIVATE_SESSION_STARTED_AT_KEY)
        }
      }

      set({
        isPrivateSession: enabled,
        startedAt: now
      })

      if (notify) {
        emitToast(enabled)
      }
    },

    togglePrivateSession: () => {
      const next = !get().isPrivateSession
      get().setPrivateSession(next, true)
    },

    setMaskMediaSession: (mask) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(PRIVATE_SESSION_MASK_SMTC_KEY, String(mask))
      }
      set({ maskMediaSession: mask })
      // Trigger media session refresh event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('felo:media-session-refresh'))
      }
    },

    setAutoDisableHours: (hours) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(PRIVATE_SESSION_AUTO_HOURS_KEY, String(hours))
      }
      set({ autoDisableHours: hours })
    },

    setListenHistoryEnabled: (enabled) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(LISTEN_HISTORY_ENABLED_KEY, String(enabled))
      }
      set({ listenHistoryEnabled: enabled })
    },

    checkExpiration: () => {
      const { isPrivateSession, startedAt, autoDisableHours } = get()
      if (!isPrivateSession || !startedAt || autoDisableHours <= 0) {
        return false
      }
      const elapsed = Date.now() - startedAt
      const maxDuration = autoDisableHours * 60 * 60 * 1000
      if (elapsed >= maxDuration) {
        get().setPrivateSession(false, true)
        return true
      }
      return false
    },

    getRemainingTimeMs: () => {
      const { isPrivateSession, startedAt, autoDisableHours } = get()
      if (!isPrivateSession || !startedAt || autoDisableHours <= 0) {
        return null
      }
      const elapsed = Date.now() - startedAt
      const maxDuration = autoDisableHours * 60 * 60 * 1000
      return Math.max(0, maxDuration - elapsed)
    }
  }
})
