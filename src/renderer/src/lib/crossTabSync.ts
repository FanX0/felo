import type { Song } from '../pages/Library/Library'
import type { PlaybackContext, RepeatMode } from '../hooks/usePlayerStore'

export interface PlayerSyncSnapshot {
  isPlaying: boolean
  isBuffering?: boolean
  currentSongIndex: number
  queue: Song[]
  originalQueue?: Song[]
  currentTime: number
  duration: number
  volume: number
  isShuffle: boolean
  repeatMode: RepeatMode
  playbackContext: PlaybackContext | null
  timestamp: number
  activeInstanceId: string
}

export type CrossTabSyncMessage =
  | { type: 'REQUEST_SYNC_STATE'; senderId: string }
  | {
      type: 'SYNC_STATE_RESPONSE'
      senderId: string
      targetId?: string
      payload: PlayerSyncSnapshot
    }
  | { type: 'CLAIM_PLAYBACK'; senderId: string; payload: PlayerSyncSnapshot }
  | { type: 'STATE_UPDATE'; senderId: string; payload: Partial<PlayerSyncSnapshot> }
  | {
      type: 'COMMAND'
      senderId: string
      command: 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume'
      value?: any
    }
  | { type: 'RELEASE_PLAYBACK'; senderId: string }

const SYNC_CHANNEL_NAME = 'felo_playback_sync'
const STORAGE_SYNC_KEY = 'felo_cross_tab_sync_msg'

let _tabInstanceId: string | null = null

export function getTabInstanceId(): string {
  if (typeof window === 'undefined') return 'felo_server'
  if (_tabInstanceId) return _tabInstanceId

  try {
    let id = sessionStorage.getItem('felo_tab_instance_id')
    if (!id) {
      id = `tab_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`
      sessionStorage.setItem('felo_tab_instance_id', id)
    }
    _tabInstanceId = id
    return id
  } catch {
    _tabInstanceId = `tab_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`
    return _tabInstanceId
  }
}

type SyncMessageHandler = (message: CrossTabSyncMessage) => void

let broadcastChannel: BroadcastChannel | null = null
const messageListeners = new Set<SyncMessageHandler>()

function initChannel(): void {
  if (typeof window === 'undefined') return

  if ('BroadcastChannel' in window) {
    try {
      broadcastChannel = new BroadcastChannel(SYNC_CHANNEL_NAME)
      broadcastChannel.onmessage = (event: MessageEvent<CrossTabSyncMessage>) => {
        if (!event.data || typeof event.data !== 'object') return
        // Do not process messages sent by ourselves
        if (event.data.senderId === getTabInstanceId()) return
        messageListeners.forEach((listener) => {
          try {
            listener(event.data)
          } catch (err) {
            console.warn('[CrossTabSync] Error in message listener:', err)
          }
        })
      }
    } catch (e) {
      console.warn('[CrossTabSync] BroadcastChannel initialization failed, using storage fallback:', e)
    }
  }

  // Storage event listener fallback for browsers/environments without BroadcastChannel
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_SYNC_KEY || !event.newValue) return
    try {
      const data = JSON.parse(event.newValue) as CrossTabSyncMessage
      if (!data || data.senderId === getTabInstanceId()) return
      messageListeners.forEach((listener) => {
        try {
          listener(data)
        } catch (err) {
          console.warn('[CrossTabSync] Error in storage message listener:', err)
        }
      })
    } catch {
      // Ignore parse errors from stale storage events
    }
  })
}

export function subscribeCrossTabSync(handler: SyncMessageHandler): () => void {
  if (messageListeners.size === 0 && !broadcastChannel) {
    initChannel()
  }
  messageListeners.add(handler)
  return () => {
    messageListeners.delete(handler)
  }
}

export function broadcastCrossTabMessage(message: CrossTabSyncMessage): void {
  if (typeof window === 'undefined') return
  if (!broadcastChannel && messageListeners.size === 0) {
    initChannel()
  }

  // 1. BroadcastChannel transport
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(message)
    } catch (e) {
      console.warn('[CrossTabSync] broadcastChannel.postMessage failed:', e)
    }
  }

  // 2. Storage event transport (fallback / cross-window redundancy)
  try {
    const serialized = JSON.stringify({
      ...message,
      _storageTimestamp: Date.now() + Math.random()
    })
    localStorage.setItem(STORAGE_SYNC_KEY, serialized)
  } catch {
    // localStorage might be unavailable or full
  }
}
