import { useEffect, useRef } from 'react'
import {
  useListeningStore,
  isSessionSyncing,
  registerRoomDspSyncSender,
  registerRoomClosureSender,
  toSharedSong
} from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore, setPlaybackGuard } from '../hooks/usePlayerStore'
import { useDspStore, type DspRoomSnapshot } from '../hooks/useDspStore'
import { getSupabase } from '../lib/supabase'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'
import { findMatchingLibrarySong } from '../lib/songMatching'
import { registerLocalSlotPoolPath } from '../lib/jitAudioPipeline'
import { playParticipantLeaveSound } from '../lib/uiSounds'
import { roomClockSync } from '../lib/roomClockSync'
import { getActiveAudioTime, getAudioPlaybackRate } from '../lib/audioBridge'
import { isYouTubeSong } from '../lib/youtubeService'
import { resolveSongAudioUrl } from '../lib/songAudioResolver'
import { evaluateAutoPriority, recordUserRequest } from '../lib/autoPriority'
import type { Song } from '../pages/Library/Library'

let _activeHostSyncChannel: any = null
let _activeGuestSyncChannel: any = null
const _userRequestCountsMap = new Map<string, number>()

/**
 * Broadcasts room DSP settings (EQ gains, Reverb presets, Virtual Bass) and volume
 * over the active room-sync channel to all connected listeners.
 */
export function broadcastDspOverSyncChannel(snapshot: DspRoomSnapshot): void {
  if (_activeHostSyncChannel) {
    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'dsp_settings_sync',
      payload: {
        settings: snapshot
      }
    })
  }
}

registerRoomDspSyncSender(broadcastDspOverSyncChannel)

registerRoomClosureSender(() => {
  if (_activeHostSyncChannel) {
    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'room_closed',
      payload: {
        timestamp: Date.now()
      }
    })
  }
})

/**
 * Broadcasts an authoritative track change to all connected listeners immediately.
 * Called when local playback changes or when cloud audio upload completes.
 */
export function broadcastHostTrackChange(song: any): void {
  if (_activeHostSyncChannel) {
    const queue = usePlayerStore.getState().queue
    const currentIdx = usePlayerStore.getState().currentSongIndex
    const safeIdx = Math.max(0, currentIdx)
    const upcomingQueue = queue
      .slice(safeIdx, safeIdx + 100)
      .map((s) => toSharedSong(s))

    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'track_change',
      payload: {
        song,
        queue: upcomingQueue,
        position: getActiveAudioTime() || usePlayerStore.getState().currentTime || 0,
        isPlaying: usePlayerStore.getState().isPlaying,
        hostTimestamp: Date.now()
      }
    })
  }
}

/**
 * Broadcasts when full audio quality becomes available on the CDN for a track
 * that guests might currently be playing in low-bitrate preview mode.
 */
export function broadcastHostTrackUpgrade(trackId: string, fullUrl: string): void {
  if (_activeHostSyncChannel) {
    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'track_upgrade',
      payload: {
        trackId,
        fullUrl,
        timestamp: Date.now()
      }
    })
  }
}

/**
 * Requests an immediate sync ping/pong burst and live sync_pulse from the host
 * (e.g. immediately when a download finishes or after buffering).
 */
export function requestImmediateHostSyncPulse(): void {
  if (_activeGuestSyncChannel) {
    void _activeGuestSyncChannel.send({
      type: 'broadcast',
      event: 'sync_ping',
      payload: {
        guestId: roomClockSync.getGuestId(),
        t0: Date.now()
      }
    })
  }
}

/**
 * Requests the current host DSP settings and volume snapshot when joining or when
 * turning Settings Sync ON.
 */
export function requestRoomDspSync(): void {
  if (_activeGuestSyncChannel && useDspStore.getState().settingsSync) {
    void _activeGuestSyncChannel.send({
      type: 'broadcast',
      event: 'dsp_request_sync',
      payload: {
        guestId: roomClockSync.getGuestId(),
        timestamp: Date.now()
      }
    })
  }
}

interface ListeningPresenceBridgeProps {
  enabled: boolean
}

export default function ListeningPresenceBridge({ enabled }: ListeningPresenceBridgeProps): null {
  const user = useOnlineStore((state) => state.user)
  const profile = useOnlineStore((state) => state.profile)
  const currentSong = usePlayerStore((state) => state.queue[state.currentSongIndex])
  const currentSongId = currentSong?.id
  const queueKey = usePlayerStore((state) =>
    state.queue.slice(state.currentSongIndex, state.currentSongIndex + 10).map((s) => s.id).join(',')
  )
  const isPlaying = usePlayerStore((state) => state.isPlaying)

  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const isJoiningRoom = useListeningStore((state) => state.isJoiningRoom)
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const hostRoomStopped = useListeningStore((state) => state.hostRoomStopped)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const deactivateHostRoom = useListeningStore((state) => state.deactivateHostRoom)

  const prevSongIdRef = useRef<string | undefined>(undefined)
  const prevQueueKeyRef = useRef<string | undefined>(undefined)
  const prevIsPlayingRef = useRef<boolean | undefined>(undefined)
  const isUpdatingRef = useRef(false)

  // Register playback guard to prevent listeners from accidentally playing local music
  useEffect(() => {
    setPlaybackGuard((proceed) => {
      if (isSessionSyncing()) {
        return false
      }
      const { joinedRoom, myRole } = useListeningStore.getState()
      if (joinedRoom && (myRole === 'listener' || myRole === 'co_host')) {
        useListeningStore.getState().setPendingLeaveAndPlay(proceed)
        return true
      }
      return false
    })
    return () => setPlaybackGuard(null)
  }, [])

  // Global Lifecycle: Clean up room membership or host session if the app/window is closed
  useEffect(() => {
    const handleExitCleanup = () => {
      const listeningState = useListeningStore.getState()
      const onlineUser = useOnlineStore.getState().user
      if (!onlineUser?.id) return

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      const accessToken = useOnlineStore.getState().session?.access_token || supabaseAnonKey
      if (!supabaseUrl || !supabaseAnonKey) return

      // Case 1: Active Listener in a friend's room
      const joined = listeningState.joinedRoom
      if (joined?.id && joined.host_id !== onlineUser.id) {
        try {
          const url = `${supabaseUrl}/rest/v1/listening_room_members?room_id=eq.${joined.id}&user_id=eq.${onlineUser.id}`
          void fetch(url, {
            method: 'DELETE',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            keepalive: true
          })
          void getSupabase()
            .from('listening_room_members')
            .delete()
            .eq('room_id', joined.id)
            .eq('user_id', onlineUser.id)
        } catch {
          // ignore on exit
        }
      }

      // Case 2: Active Host of a party room
      const host = listeningState.hostRoom
      if (host?.id && host.host_id === onlineUser.id && host.is_active) {
        try {
          const url = `${supabaseUrl}/rest/v1/listening_rooms?id=eq.${host.id}&host_id=eq.${onlineUser.id}`
          void fetch(url, {
            method: 'PATCH',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_active: false, is_playing: false, updated_at: new Date().toISOString() }),
            keepalive: true
          })
          void getSupabase()
            .from('listening_rooms')
            .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
            .eq('id', host.id)
            .eq('host_id', onlineUser.id)
        } catch {
          // ignore on exit
        }
      }
    }

    window.addEventListener('beforeunload', handleExitCleanup)
    window.addEventListener('pagehide', handleExitCleanup)
    return () => {
      window.removeEventListener('beforeunload', handleExitCleanup)
      window.removeEventListener('pagehide', handleExitCleanup)
    }
  }, [])

  // Auto-sweep orphaned host rooms for this user from previous sessions or unexpected disconnects
  useEffect(() => {
    if (!user?.id || hostRoom) return
    const sweepOrphaned = async () => {
      try {
        await getSupabase()
          .from('listening_rooms')
          .update({ is_active: false, is_playing: false, updated_at: new Date().toISOString() })
          .eq('host_id', user.id)
          .eq('is_active', true)
      } catch {
        // silent
      }
    }
    void sweepOrphaned()
  }, [user?.id, Boolean(hostRoom)])

  // 1. Immediate Broadcast on Playback State Change (Song Change, Queue/Playlist Change, or Play/Pause)
  useEffect(() => {
    // Only broadcast playback updates if user has manually created an active host room
    if (!user || !enabled || isJoiningRoom || hostRoomStopped || joinedRoom !== null || !hostRoom || !hostRoom.is_active) return

    const songChanged = prevSongIdRef.current !== currentSongId
    const queueChanged = prevQueueKeyRef.current !== queueKey
    const playStateChanged = prevIsPlayingRef.current !== isPlaying

    prevSongIdRef.current = currentSongId
    prevQueueKeyRef.current = queueKey
    prevIsPlayingRef.current = isPlaying

    // If this is a meaningful change in playback / queue for an active host
    if (songChanged || queueChanged || playStateChanged) {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true

      if (songChanged && _activeHostSyncChannel) {
        const currentTrack = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
        if (currentTrack) {
          const shared = toSharedSong(currentTrack)
          broadcastHostTrackChange(shared)
          if (!isYouTubeSong(currentTrack)) {
            void (async () => {
              try {
                const { ensureTrackInAudioBucket } = await import('../lib/audioBucketService')
                await ensureTrackInAudioBucket(currentTrack)
              } catch {}
            })()
          }
        }
      }

      if (queueChanged && _activeHostSyncChannel) {
        const queue = usePlayerStore.getState().queue
        const currentIdx = usePlayerStore.getState().currentSongIndex
        const safeIdx = Math.max(0, currentIdx)
        const upcomingQueue = queue
          .slice(safeIdx, safeIdx + 100)
          .map((s) => toSharedSong(s))

        void _activeHostSyncChannel.send({
          type: 'broadcast',
          event: 'queue_update',
          payload: {
            queue: upcomingQueue
          }
        })
      }

      void ensureHostRoom(true, false).finally(() => {
        isUpdatingRef.current = false
      })
    }
  }, [user?.id, profile?.display_name, enabled, isJoiningRoom, hostRoomStopped, currentSongId, queueKey, isPlaying, joinedRoom, hostRoom?.id, hostRoom?.is_active, ensureHostRoom])

  // Sync active room code and member count to Discord service
  const memberCount = useListeningStore((state) => state.memberCount)
  useEffect(() => {
    if (hostRoom?.code) {
      window.api?.updateDiscordRoomInfo?.({
        code: hostRoom.code,
        name: hostRoom.name,
        members: memberCount
      })
    }
  }, [hostRoom?.code, hostRoom?.name, memberCount])

  // 2. Periodic Heartbeat (Every 5s) to Keep Room Timestamp & Position Fresh
  useEffect(() => {
    if (!user || !enabled || !hostRoom || !hostRoom.is_active) {
      if ((!user || !enabled) && hostRoom) {
        void deactivateHostRoom()
      }
      return
    }

    if (isJoiningRoom || hostRoomStopped || joinedRoom !== null) return

    const interval = window.setInterval(() => {
      const currentHost = useListeningStore.getState().hostRoom
      if (!currentHost || !currentHost.is_active || joinedRoom !== null || hostRoomStopped) return
      if (isUpdatingRef.current) return

      isUpdatingRef.current = true
      void ensureHostRoom(true, false).finally(() => {
        isUpdatingRef.current = false
      })

      if (currentHost?.id) {
        void useListeningStore.getState().refreshMemberCount(currentHost.id)
      }
    }, 5000)

    return () => window.clearInterval(interval)
  }, [user?.id, enabled, isJoiningRoom, hostRoomStopped, joinedRoom, hostRoom?.id, hostRoom?.is_active, ensureHostRoom, deactivateHostRoom])

  // 2b. Realtime subscription for immediate member-join detection (host only)
  // Instead of relying solely on 5s polling, subscribe to INSERT/DELETE on
  // listening_room_members so the host can start/refresh WebRTC streaming instantly.
  useEffect(() => {
    if (!hostRoom?.id || !enabled || !user || hostRoomStopped || joinedRoom !== null) return

    const supabase = getSupabase()
    const roomId = hostRoom.id

    const channel = supabase
      .channel(`host-members-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_room_members',
          filter: `room_id=eq.${roomId}`
        },
        (payload: any) => {
          if (payload.eventType === 'DELETE') {
            playParticipantLeaveSound()
          }
          void useListeningStore.getState().refreshMemberCount(roomId)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [hostRoom?.id, enabled, user?.id, hostRoomStopped, joinedRoom])

  // 2c. MUSIXQUARE High-Precision Realtime Broadcast Sync Pulse & NTP Pong (Host only)
  useEffect(() => {
    if (!hostRoom?.id || !enabled || !user || hostRoomStopped || joinedRoom !== null) return

    const roomId = hostRoom.id
    const supabase = getSupabase()
    const syncChannel = supabase.channel(`room-sync-${roomId}`, {
      config: { broadcast: { ack: false, self: false } }
    })
    _activeHostSyncChannel = syncChannel

    const sendPulse = (overridePosition?: number) => {
      const player = usePlayerStore.getState()
      const currentAudioTime = getActiveAudioTime()
      const seekReq = player.seekRequest
      const livePosition =
        typeof overridePosition === 'number'
          ? overridePosition
          : typeof seekReq === 'number' && !isNaN(seekReq)
            ? seekReq
            : currentAudioTime > 0
              ? currentAudioTime
              : player.currentTime || 0
      const song = player.queue[player.currentSongIndex]

      void syncChannel.send({
        type: 'broadcast',
        event: 'sync_pulse',
        payload: {
          position: livePosition,
          hostTimestamp: Date.now(),
          isPlaying: Boolean(player.isPlaying && song),
          trackId: song?.id,
          playbackRate: getAudioPlaybackRate(),
          title: song?.title,
          artist: song?.artist
        }
      })
    }

    syncChannel
      .on('broadcast', { event: 'sync_ping' }, ({ payload }: { payload: any }) => {
        if (!payload || !payload.guestId) return
        void syncChannel.send({
          type: 'broadcast',
          event: 'sync_pong',
          payload: {
            guestId: payload.guestId,
            t0: payload.t0,
            t1: Date.now()
          }
        })
        sendPulse()
      })
      .on('broadcast', { event: 'dsp_request_sync' }, () => {
        const snapshot = useDspStore.getState().getRoomDspSnapshot()
        const vol = usePlayerStore.getState().volume
        void syncChannel.send({
          type: 'broadcast',
          event: 'dsp_settings_sync',
          payload: {
            settings: snapshot,
            volume: vol
          }
        })
      })
      .subscribe()

    // Passive heartbeat every 10s for drift detection only (event-driven sync handles real-time actions)
    const interval = window.setInterval(() => {
      sendPulse()
    }, 10_000)

    // Immediate pulse on playback state changes (play, pause, seek, song change, volume change)
    const unsub = usePlayerStore.subscribe((state, prevState) => {
      const playChanged = state.isPlaying !== prevState.isPlaying
      const currentTrack = state.queue[state.currentSongIndex]
      const prevTrack = prevState.queue[prevState.currentSongIndex]
      const songChanged =
        state.currentSongIndex !== prevState.currentSongIndex ||
        currentTrack?.id !== prevTrack?.id ||
        currentTrack?.title !== prevTrack?.title ||
        currentTrack?.artist !== prevTrack?.artist
      const seekChanged = state.seekRequest !== null && state.seekRequest !== prevState.seekRequest
      const queueChanged = state.queue !== prevState.queue

      if (songChanged) {
        const newSong = state.queue[state.currentSongIndex]
        if (newSong) {
          const safeIdx = Math.max(0, state.currentSongIndex)
          const upcomingQueue = state.queue
            .slice(safeIdx, safeIdx + 100)
            .map((s) => toSharedSong(s))

          const shared = toSharedSong(newSong)
          void syncChannel.send({
            type: 'broadcast',
            event: 'track_change',
            payload: {
              song: shared,
              queue: upcomingQueue,
              position: 0,
              isPlaying: state.isPlaying,
              hostTimestamp: Date.now()
            }
          })

          broadcastHostTrackChange(shared)
          if (!isYouTubeSong(newSong)) {
            void (async () => {
              try {
                const { ensureTrackInAudioBucket } = await import('../lib/audioBucketService')
                await ensureTrackInAudioBucket(newSong)
                // N+1 Preloader: Also proactively pre-upload the upcoming track in queue for 0ms transitions
                const nextTrack = state.queue[state.currentSongIndex + 1]
                if (nextTrack && !isYouTubeSong(nextTrack)) {
                  await ensureTrackInAudioBucket(nextTrack)
                }
              } catch {}
            })()
          }
        }
        sendPulse(0)
      } else if (seekChanged && typeof state.seekRequest === 'number') {
        const song = state.queue[state.currentSongIndex]
        void syncChannel.send({
          type: 'broadcast',
          event: 'host_seek',
          payload: {
            position: state.seekRequest,
            hostTimestamp: Date.now(),
            trackId: song?.id,
            isLoop: state.seekRequest === 0,
            title: song?.title,
            artist: song?.artist
          }
        })
        sendPulse(state.seekRequest)
      }
      if (!songChanged && playChanged) {
        const song = state.queue[state.currentSongIndex]
        const currentAudioTime = getActiveAudioTime()
        const livePos = currentAudioTime > 0 ? currentAudioTime : state.currentTime || 0
        void syncChannel.send({
          type: 'broadcast',
          event: 'host_play_pause',
          payload: {
            isPlaying: state.isPlaying,
            position: livePos,
            hostTimestamp: Date.now(),
            trackId: song?.id,
            title: song?.title,
            artist: song?.artist
          }
        })
        sendPulse()
      } else if (queueChanged) {
        const safeIdx = Math.max(0, state.currentSongIndex)
        const upcomingQueue = state.queue
          .slice(safeIdx, safeIdx + 100)
          .map((s) => toSharedSong(s))

        void syncChannel.send({
          type: 'broadcast',
          event: 'queue_update',
          payload: {
            queue: upcomingQueue
          }
        })

        // Host sliding window: ensure the new upcoming track is ready in Cloud CDN
        const nextSong = state.queue[state.currentSongIndex + 1]
        if (nextSong && !isYouTubeSong(nextSong)) {
          void (async () => {
            try {
              const { ensureTrackInAudioBucket } = await import('../lib/audioBucketService')
              await ensureTrackInAudioBucket(nextSong)
            } catch {}
          })()
        }
      }

      // Volume is strictly personal to each user's hardware setup and is NOT synced across room participants
    })

    return () => {
      _activeHostSyncChannel = null
      window.clearInterval(interval)
      unsub()
      void supabase.removeChannel(syncChannel)
    }
  }, [hostRoom?.id, enabled, user?.id, hostRoomStopped, joinedRoom])

  // 3. Listen for incoming Universal Bot commands via Supabase Realtime + Active Polling Fallback
  useEffect(() => {
    if (!hostRoom?.code || !enabled) return
    const roomCode = hostRoom.code
    const supabase = getSupabase()
    const processedIds = new Set<string>()

    const processCommand = async (record: any) => {
      if (!record?.id || record.status !== 'pending' || processedIds.has(record.id)) return
      processedIds.add(record.id)

      // Mark processed immediately in database to prevent double-processing
      void supabase
        .from('listening_room_commands')
        .update({ status: 'processed' })
        .eq('id', record.id)

      const player = usePlayerStore.getState()
      const { command, payload: cmdPayload } = record

      try {
        switch (command) {
          case 'play': {
            const query = (cmdPayload?.query || '').trim()
            const title = (cmdPayload?.title || '').trim()
            const artist = (cmdPayload?.artist || '').trim()
            const album = (cmdPayload?.album || '').trim()
            const duration = Number(cmdPayload?.duration) || 0
            const artworkUrl = cmdPayload?.artworkUrl || ''
            const action = cmdPayload?.action || 'play_now'
            const requester = record?.sender_name ? `@${record.sender_name}` : 'Discord'

            if (!query && !title) {
              player.claimAudioOwnership()
              player.setIsPlaying(true)
              void ensureHostRoom(true)
              break
            }

            const cleanQ = query.toLowerCase()
            const targetTitle = (title || query).toLowerCase()
            const targetArtist = artist.toLowerCase()
            const isPriorityEnabled = useListeningStore.getState().discordPriorityEnabled

            // Industry-standard Auto-Priority fair rotation
            const recentArtists = player.queue
              .slice(Math.max(0, player.currentSongIndex - 4), player.currentSongIndex + 1)
              .map((s) => s.artist)
              .filter(Boolean)
            const senderKey = record?.sender_name || 'Discord'
            const autoPriorityEval = evaluateAutoPriority({
              senderKey,
              artist,
              duration,
              isExplicitPriority: Boolean(isPriorityEnabled && (action === 'play_next' || action === 'play_now')),
              recentArtists,
              userRequestCounts: _userRequestCountsMap
            })
            recordUserRequest(senderKey, _userRequestCountsMap)

            const isPriority = autoPriorityEval.isPriority
            const effectiveAction = isPriority ? (action === 'play_now' ? 'play_now' : 'play_next') : 'enqueue'

            const qWords = cleanQ.split(/\s+/).filter((w) => w.length >= 2)
            const matchesTrack = (s: { title?: string; artist?: string }) => {
              if (!s) return false
              const sTitle = (s.title || '').toLowerCase()
              const sArtist = (s.artist || '').toLowerCase()
              const sCombined = `${sTitle} ${sArtist}`
              const sCombinedRev = `${sArtist} ${sTitle}`

              if (targetTitle && (sTitle === targetTitle || sTitle.includes(targetTitle) || targetTitle.includes(sTitle))) {
                if (!targetArtist || sArtist.includes(targetArtist) || targetArtist.includes(sArtist)) {
                  return true
                }
              }

              if (sTitle.includes(cleanQ) || sArtist.includes(cleanQ)) return true
              if (sCombined.includes(cleanQ) || sCombinedRev.includes(cleanQ)) return true
              if (cleanQ.includes(sTitle) && sTitle.length >= 3) return true

              if (qWords.length > 0 && qWords.every((w) => sCombined.includes(w))) {
                return true
              }

              return false
            }

            // 1. Check if the song is already in active player queue
            let queueMatchIndex = player.queue.findIndex(matchesTrack)
            if (queueMatchIndex === -1 && (title || artist)) {
              const matched = findMatchingLibrarySong(title || query, artist, player.queue)
              if (matched) {
                queueMatchIndex = player.queue.findIndex((s) => s.id === matched.id)
              }
            }

            if (queueMatchIndex >= 0) {
              const matchedSong = {
                ...player.queue[queueMatchIndex],
                requestedBy: requester,
                isPriority
              }
              player.updateSong(matchedSong, matchedSong.id)

              if (effectiveAction === 'play_now' || !player.isPlaying) {
                player.claimAudioOwnership()
                player.playSong(queueMatchIndex)
                player.setIsPlaying(true)
              } else if (effectiveAction === 'enqueue') {
                player.enqueueSong(matchedSong)
              } else {
                player.enqueueSongPriority(matchedSong)
                if (!player.isPlaying || player.currentSongIndex === -1) {
                  const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                  player.claimAudioOwnership()
                  player.playSong(targetIdx)
                  player.setIsPlaying(true)
                }
              }
              void ensureHostRoom(true)
              break
            }

            // 2. Check local library if available
            let libraryMatch: Song | undefined
            try {
              const songs = (await window.api?.getSongs?.()) || []
              if (title || artist) {
                libraryMatch = findMatchingLibrarySong(title || query, artist, songs)
              }
              if (!libraryMatch) {
                libraryMatch = songs.find(matchesTrack)
              }
            } catch (err) {
              console.warn('[ListeningPresenceBridge] Library scan failed:', err)
            }

            if (libraryMatch) {
              const songToAdd: Song = {
                ...libraryMatch,
                requestedBy: requester,
                isPriority
              }

              player.claimAudioOwnership()

              if (effectiveAction === 'play_now' || !player.isPlaying) {
                if (player.queue.length === 0) {
                  player.setQueue([songToAdd], 0)
                } else {
                  const currentSong = player.queue[player.currentSongIndex]
                  const isCurrentVirtual = !currentSong?.filePath || currentSong.filePath.startsWith('virtual:')
                  if (isCurrentVirtual) {
                    player.updateSong(songToAdd, currentSong?.id)
                    player.playSong(player.currentSongIndex)
                  } else {
                    player.enqueueSongPriority(songToAdd)
                    const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                    player.playSong(targetIdx)
                  }
                }
                player.setIsPlaying(true)
              } else if (effectiveAction === 'enqueue') {
                player.enqueueSong(songToAdd)
              } else {
                player.enqueueSongPriority(songToAdd)
                if (!player.isPlaying || player.currentSongIndex === -1) {
                  const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                  player.playSong(targetIdx)
                  player.setIsPlaying(true)
                }
              }
              void ensureHostRoom(true)
              break
            }

            // 3. Fallback: Create instant virtual track so UI switches in 0ms, then stream/download
            const virtualSong: Song = {
              id: `discord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: title || query,
              artist: artist || 'Discord Request',
              album: album || '',
              duration: duration || 0,
              artworkPath: artworkUrl || '',
              artworkUrl: artworkUrl || '',
              filePath: `virtual:${query}`,
              requestedBy: requester,
              isPriority
            }

            player.claimAudioOwnership()

            if (effectiveAction === 'play_now' || !player.isPlaying) {
              if (player.queue.length === 0) {
                player.setQueue([virtualSong], 0)
              } else {
                const currentSong = player.queue[player.currentSongIndex]
                const isCurrentVirtual = !currentSong?.filePath || currentSong.filePath.startsWith('virtual:')
                if (isCurrentVirtual) {
                  player.updateSong(virtualSong, currentSong?.id)
                  player.playSong(player.currentSongIndex)
                } else {
                  player.enqueueSongPriority(virtualSong)
                  const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                  player.playSong(targetIdx)
                }
              }
              player.setIsPlaying(true)
            } else if (effectiveAction === 'enqueue') {
              player.enqueueSong(virtualSong)
            } else {
              player.enqueueSongPriority(virtualSong)
              if (!player.isPlaying || player.currentSongIndex === -1) {
                const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                player.playSong(targetIdx)
                player.setIsPlaying(true)
              }
            }
            void ensureHostRoom(true)

            // Trigger background downloader with complete track metadata
            void downloadTrackInBackground(
              {
                id: virtualSong.id,
                title: title || query,
                artist,
                album,
                duration,
                artworkUrl
              },
              {
                playAction: effectiveAction,
                autoPlay: effectiveAction === 'play_now' || !player.isPlaying,
                conflictMode: 'keep_both'
              }
            ).catch(() => undefined)

            break
          }
          case 'skip':
          case 'next':
            player.claimAudioOwnership()
            player.playNext(true)
            player.setIsPlaying(true)
            void ensureHostRoom(true)
            break
          case 'prev':
          case 'previous':
            player.claimAudioOwnership()
            player.playPrevious()
            player.setIsPlaying(true)
            void ensureHostRoom(true)
            break
          case 'stop':
            player.setIsPlaying(false)
            player.seek(0)
            void ensureHostRoom(true)
            break
          case 'pause':
            player.setIsPlaying(false)
            void ensureHostRoom(true)
            break
          case 'resume':
            player.claimAudioOwnership()
            player.setIsPlaying(true)
            void ensureHostRoom(true)
            break
          case 'seek': {
            const seconds = Number(cmdPayload?.seconds)
            if (!isNaN(seconds) && seconds >= 0) {
              player.seek(seconds)
            }
            break
          }
          case 'jump':
          case 'jumpto':
          case 'skipto': {
            let targetIdx = -1
            const searchTitle = cmdPayload?.title || cmdPayload?.query
            if (searchTitle) {
              const q = String(searchTitle).toLowerCase()
              targetIdx = player.queue.findIndex(
                (s) => s.title.toLowerCase().includes(q) || (s.artist && s.artist.toLowerCase().includes(q))
              )
            }
            if (targetIdx === -1 && typeof cmdPayload?.index === 'number') {
              const relIdx = player.currentSongIndex + cmdPayload.index
              if (relIdx >= 0 && relIdx < player.queue.length) {
                targetIdx = relIdx
              } else if (cmdPayload.index >= 0 && cmdPayload.index < player.queue.length) {
                targetIdx = cmdPayload.index
              }
            }
            if (targetIdx >= 0 && targetIdx < player.queue.length) {
              player.claimAudioOwnership()
              player.playSong(targetIdx)
              player.setIsPlaying(true)
              void ensureHostRoom(true)
            }
            break
          }
          case 'bump':
          case 'make_priority': {
            let targetIdx = -1
            const searchTitle = cmdPayload?.title || cmdPayload?.query
            if (searchTitle) {
              const q = String(searchTitle).toLowerCase()
              targetIdx = player.queue.findIndex(
                (s) => s.title.toLowerCase().includes(q) || (s.artist && s.artist.toLowerCase().includes(q))
              )
            }
            if (targetIdx === -1 && typeof cmdPayload?.index === 'number') {
              const relIdx = player.currentSongIndex + cmdPayload.index
              if (relIdx >= 0 && relIdx < player.queue.length) {
                targetIdx = relIdx
              } else if (cmdPayload.index >= 0 && cmdPayload.index < player.queue.length) {
                targetIdx = cmdPayload.index
              }
            }
            if (targetIdx >= 0 && targetIdx < player.queue.length) {
              player.bumpSongToPriority(targetIdx)
              void ensureHostRoom(true)
            }
            break
          }
          case 'remove':
          case 'remove_queue': {
            let targetIdx = -1
            const searchTitle = cmdPayload?.title || cmdPayload?.query
            if (searchTitle) {
              const q = String(searchTitle).toLowerCase()
              targetIdx = player.queue.findIndex(
                (s) => s.title.toLowerCase().includes(q) || (s.artist && s.artist.toLowerCase().includes(q))
              )
            }
            if (targetIdx === -1 && typeof cmdPayload?.index === 'number') {
              const relIdx = player.currentSongIndex + cmdPayload.index
              if (relIdx >= 0 && relIdx < player.queue.length) {
                targetIdx = relIdx
              } else if (cmdPayload.index >= 0 && cmdPayload.index < player.queue.length) {
                targetIdx = cmdPayload.index
              }
            }
            if (targetIdx >= 0 && targetIdx < player.queue.length) {
              player.removeSongFromQueueByIndex(targetIdx)
              void ensureHostRoom(true)
            }
            break
          }
          case 'priority':
          case 'set_priority': {
            if (cmdPayload?.enabled !== undefined) {
              useListeningStore.getState().setDiscordPriorityEnabled(Boolean(cmdPayload.enabled))
            }
            break
          }
          case 'add_song':
          case 'enqueue_song': {
            const songId = cmdPayload?.id || `shared-${Date.now()}`
            const title = cmdPayload?.title || 'Shared Song'
            const artist = cmdPayload?.artist || 'Unknown Artist'
            const album = cmdPayload?.album || 'Shared Song'
            const duration = Number(cmdPayload?.duration) || 0
            const audioUrl = cmdPayload?.audioUrl || ''
            const artworkUrl = cmdPayload?.artworkUrl || ''
            const action = cmdPayload?.action || 'enqueue'
            const requester = record?.sender_name ? `@${record.sender_name}` : (cmdPayload?.requestedBy || 'Member')
            const senderKey = record?.sender_name || 'Member'
            const isPriorityEnabled = useListeningStore.getState().discordPriorityEnabled

            const recentArtists = player.queue
              .slice(Math.max(0, player.currentSongIndex - 4), player.currentSongIndex + 1)
              .map((s) => s.artist)
              .filter(Boolean)

            const autoPriorityEval = evaluateAutoPriority({
              senderKey,
              artist,
              duration,
              isExplicitPriority: Boolean(cmdPayload?.isPriority || (isPriorityEnabled && (action === 'play_next' || action === 'play_now'))),
              recentArtists,
              userRequestCounts: _userRequestCountsMap
            })
            recordUserRequest(senderKey, _userRequestCountsMap)
            const isPriority = autoPriorityEval.isPriority

            const incomingSong: Song = {
              id: songId,
              title,
              artist,
              album,
              duration,
              artworkUrl,
              artworkPath: artworkUrl,
              audioUrl,
              filePath: audioUrl,
              requestedBy: requester,
              isPriority,
              isOnline: true
            }

            if (audioUrl) {
              registerLocalSlotPoolPath(songId, audioUrl)
            }

            const isQueueEmpty = player.queue.length === 0
            const shouldPlayNow = action === 'play_now' || isQueueEmpty

            if (shouldPlayNow) {
              player.claimAudioOwnership()
              if (isQueueEmpty) {
                player.setQueue([incomingSong], 0)
              } else {
                player.enqueueSongPriority(incomingSong)
                const targetIdx = player.currentSongIndex === -1 ? 0 : player.currentSongIndex + 1
                player.playSong(targetIdx)
              }
              player.setIsPlaying(true)
            } else if (isPriority) {
              player.enqueueSongPriority(incomingSong)
            } else {
              player.enqueueSong(incomingSong)
            }

            void ensureHostRoom(true)
            break
          }
        }
      } catch (err) {
        console.warn('[RoomCommands] Error executing command:', err)
      }
    }

    // 1. Supabase Realtime WebSocket listener
    const channel = supabase
      .channel(`room-cmd-${roomCode}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'listening_room_commands',
          filter: `room_code=eq.${roomCode}`
        },
        async (payload) => {
          const record = payload.new as any
          if (!record || record.status !== 'pending') return
          await processCommand(record)
        }
      )
      .subscribe()

    // 2. High-reliability polling fallback (every 2.5s) to guarantee zero dropped commands
    const pollPendingCommands = async () => {
      try {
        const { data: pendingRows } = await supabase
          .from('listening_room_commands')
          .select('*')
          .eq('room_code', roomCode)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })

        if (Array.isArray(pendingRows) && pendingRows.length > 0) {
          for (const cmd of pendingRows) {
            await processCommand(cmd)
          }
        }
      } catch {
        // best effort polling
      }
    }

    // Immediate initial check on room mount
    void pollPendingCommands()
    const pollInterval = window.setInterval(pollPendingCommands, 2500)

    return () => {
      window.clearInterval(pollInterval)
      void supabase.removeChannel(channel)
    }
  }, [hostRoom?.code, enabled])

  // 4. Guest Session Sync & Heartbeat Watchdog (Lag mitigation, Reconnection & Failover)
  useEffect(() => {
    if (!joinedRoom?.id || !enabled || !user) return

    const roomId = joinedRoom.id
    const supabase = getSupabase()

    // 1. Realtime channel for room updates (song changes, seeks, pauses, host transfers)
    const channel = supabase
      .channel(`guest-sync-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_rooms',
          filter: `id=eq.${roomId}`
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            void useListeningStore.getState().handleHostDisconnect()
            return
          }

          const next = payload.new as any
          if (!next) return

          // If room was explicitly marked inactive
          if (!next.is_active) {
            void useListeningStore.getState().handleHostDisconnect()
            return
          }

          // If this user was promoted to host (via automatic failover or host transfer)
          if (next.host_id === user.id) {
            useListeningStore.setState({
              hostRoom: next,
              joinedRoom: null,
              hostRoomStopped: false,
              syncStatus: 'idle',
              myRole: 'host'
            })
            usePlayerStore.getState().setIsPlaying(true)
            void useListeningStore.getState().ensureHostRoom(true, false)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const prevIsDeviceStream = Boolean(
            currentRoom?.song?.isDeviceStream || currentRoom?.is_device_stream
          )
          const newIsDeviceStream = Boolean(
            next.song?.isDeviceStream || next.is_device_stream
          )

          // Auto-Switch 1: Host live broadcast active -> ensure WebRTC stream connection
          if ((!prevIsDeviceStream || !useListeningStore.getState().isReceivingDeviceStream) && newIsDeviceStream) {
            console.log('[AutoSwitch] Host live broadcast active, ensuring WebRTC stream connection')
            usePlayerStore.getState().setIsPlaying(false)
            useListeningStore.getState().setJoinedRoom(next)
            void useListeningStore.getState().connectToDeviceStream(next)
            return
          }

          // Auto-Switch 2: Host stopped live device broadcast -> seamlessly resume track sync
          if ((prevIsDeviceStream || useListeningStore.getState().isReceivingDeviceStream) && !newIsDeviceStream) {
            console.log('[AutoSwitch] Host stopped broadcast, resuming track sync')
            useListeningStore.getState().disconnectFromDeviceStream()
            useListeningStore.getState().setJoinedRoom(next)
            void useListeningStore.getState().handleHostSongChange(next)
            return
          }

          const prevIsYouTube = Boolean(
            currentRoom?.song?.isYouTube ||
            currentRoom?.song?.videoId ||
            (currentRoom?.song && isYouTubeSong(currentRoom.song))
          )
          const newIsYouTube = Boolean(
            next.song?.isYouTube ||
            next.song?.videoId ||
            (next.song && isYouTubeSong(next.song))
          )
          const sourceTypeChanged = prevIsYouTube !== newIsYouTube

          const currentPlayingSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
          const isSongEffectivelyEqual = Boolean(
            !sourceTypeChanged &&
            currentRoom?.song &&
            next.song &&
            next.song.title === currentRoom.song.title &&
            next.song.artist === currentRoom.song.artist &&
            (next.song.localId ? next.song.localId === currentRoom.song.localId : true)
          )
          const songChanged = Boolean(
            next.song &&
            !isSongEffectivelyEqual
          )

          if (next.song && typeof next.song.hostPosition !== 'number') {
            next.song = {
              ...next.song,
              hostPosition: next.position_seconds || 0,
              hostTimestamp: new Date(next.updated_at || Date.now()).getTime()
            }
          }

          useListeningStore.getState().setJoinedRoom(next)
          useListeningStore.setState({ lastHostUpdate: Date.now() })

          if (newIsDeviceStream) {
            // Live WebRTC device stream is active. Do not trigger local track sync or player queue updates.
            return
          }

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(next)
          } else if (
            next.song &&
            (next.position_seconds === 0 || next.song.hostPosition === 0) &&
            ((getActiveAudioTime() || currentPlayingSong?.duration || 0) > 3)
          ) {
            // Host looped / replayed the same song from 0
            useListeningStore.getState().handleHostExplicitSeek({
              position: 0,
              hostTimestamp: new Date(next.updated_at || Date.now()).getTime(),
              trackId: next.song.localId || (next.song as any).id,
              isLoop: true
            })
          } else if (next.is_playing !== currentRoom?.is_playing) {
            useListeningStore.getState().handleHostPauseResume(next)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'listening_room_members',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          // If kicked by host
          if (payload.eventType === 'DELETE' && (payload.old as any)?.user_id === user.id) {
            console.log('[ListeningPresenceBridge] Kicked from session by host')
            void useListeningStore.getState().leaveJoinedRoom()
            return
          }
          // If role or speaker role changed
          if (payload.eventType === 'UPDATE' && (payload.new as any)?.user_id === user.id) {
            const newRole = (payload.new as any).role
            if (newRole) {
              console.log('[ListeningPresenceBridge] Member role updated to:', newRole)
              useListeningStore.getState().setMyRole(newRole)
            }
            const newSpeakerRole = (payload.new as any).speaker_role
            if (newSpeakerRole) {
              console.log('[ListeningPresenceBridge] Speaker role updated to:', newSpeakerRole)
              useDspStore.getState().setSpeakerRole(newSpeakerRole)
            }
            const newSubCutoff = (payload.new as any).sub_cutoff
            if (typeof newSubCutoff === 'number') {
              useDspStore.getState().setSubCutoff(newSubCutoff)
            }
          }
          void useListeningStore.getState().fetchMembers(roomId)
          void useListeningStore.getState().refreshMemberCount(roomId)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'listening_rooms',
          filter: `id=eq.${roomId}`
        },
        () => {
          void useListeningStore.getState().handleHostDisconnect()
        }
      )
      .subscribe()

    // 2. Watchdog timer (every 2.5s) to check host lag, heartbeat freshness & failover
    const watchdogInterval = window.setInterval(() => {
      void useListeningStore.getState().checkHostHealth()
    }, 2500)

    // 3. Periodic polling fallback (every 5s) to ensure zero desync even if WebSocket drops
    const pollInterval = window.setInterval(async () => {
      try {
        const { data: latestRoom, error: pollError } = await supabase
          .from('listening_rooms')
          .select('*')
          .eq('id', roomId)
          .maybeSingle()

        if (!pollError && (!latestRoom || !latestRoom.is_active)) {
          // Room was closed by host or deleted from database
          void useListeningStore.getState().handleHostDisconnect()
          return
        }

        if (latestRoom && latestRoom.is_active) {
          // Room is active in database: refresh host presence heartbeat
          useListeningStore.setState({ lastHostUpdate: Date.now() })

          // If this user was promoted to host (via automatic failover or host transfer)
          if (latestRoom.host_id === user.id) {
            useListeningStore.setState({
              hostRoom: latestRoom as any,
              joinedRoom: null,
              hostRoomStopped: false,
              syncStatus: 'idle',
              myRole: 'host'
            })
            usePlayerStore.getState().setIsPlaying(true)
            void useListeningStore.getState().ensureHostRoom(true, false)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const prevIsDeviceStream = Boolean(
            currentRoom?.song?.isDeviceStream || currentRoom?.is_device_stream
          )
          const newIsDeviceStream = Boolean(
            latestRoom.song?.isDeviceStream || latestRoom.is_device_stream
          )

          // Auto-Switch 1: Live broadcast detected via poll -> ensure WebRTC stream connection
          if ((!prevIsDeviceStream || !useListeningStore.getState().isReceivingDeviceStream) && newIsDeviceStream) {
            usePlayerStore.getState().setIsPlaying(false)
            useListeningStore.getState().setJoinedRoom(latestRoom as any)
            void useListeningStore.getState().connectToDeviceStream(latestRoom as any)
            return
          }

          // Auto-Switch 2: Live broadcast stop detected via poll
          if ((prevIsDeviceStream || useListeningStore.getState().isReceivingDeviceStream) && !newIsDeviceStream) {
            useListeningStore.getState().disconnectFromDeviceStream()
            useListeningStore.getState().setJoinedRoom(latestRoom as any)
            void useListeningStore.getState().handleHostSongChange(latestRoom as any)
            return
          }

          const prevIsYouTube = Boolean(
            currentRoom?.song?.isYouTube ||
            currentRoom?.song?.videoId ||
            (currentRoom?.song && isYouTubeSong(currentRoom.song))
          )
          const newIsYouTube = Boolean(
            latestRoom.song?.isYouTube ||
            latestRoom.song?.videoId ||
            (latestRoom.song && isYouTubeSong(latestRoom.song))
          )
          const sourceTypeChanged = prevIsYouTube !== newIsYouTube

          const currentPlayingSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
          const isSongEffectivelyEqual = Boolean(
            !sourceTypeChanged &&
            currentRoom?.song &&
            latestRoom.song &&
            latestRoom.song.title === currentRoom.song.title &&
            latestRoom.song.artist === currentRoom.song.artist &&
            (latestRoom.song.localId ? latestRoom.song.localId === currentRoom.song.localId : true)
          )
          const songChanged = Boolean(
            latestRoom.song &&
            !isSongEffectivelyEqual
          )

          useListeningStore.getState().setJoinedRoom(latestRoom as any)

          if (newIsDeviceStream) {
            // Live WebRTC device stream is active. Do not trigger local track sync or player queue updates.
            return
          }

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(latestRoom as any)
          } else if (
            latestRoom.song &&
            (latestRoom.position_seconds === 0 || latestRoom.song.hostPosition === 0) &&
            ((getActiveAudioTime() || currentPlayingSong?.duration || 0) > 3)
          ) {
            // Host looped / replayed the same song from 0
            useListeningStore.getState().handleHostExplicitSeek({
              position: 0,
              hostTimestamp: new Date(latestRoom.updated_at || Date.now()).getTime(),
              trackId: latestRoom.song.localId || (latestRoom.song as any).id,
              isLoop: true
            })
          } else if (latestRoom.is_playing !== currentRoom?.is_playing) {
            useListeningStore.getState().handleHostPauseResume(latestRoom as any)
          }
        }
      } catch {
        // best effort polling
      }
    }, 5000)


    return () => {
      window.clearInterval(watchdogInterval)
      window.clearInterval(pollInterval)
      void supabase.removeChannel(channel)
    }
  }, [joinedRoom?.id, enabled, user?.id])

  // 5. MUSIXQUARE Guest Realtime Broadcast Pulse Receiver & NTP Clock Calibrator
  useEffect(() => {
    if (!joinedRoom?.id || !enabled || !user) return

    const roomId = joinedRoom.id
    const supabase = getSupabase()
    const syncChannel = supabase.channel(`room-sync-${roomId}`, {
      config: { broadcast: { ack: false, self: false } }
    })
    _activeGuestSyncChannel = syncChannel

    const sendPing = () => {
      void syncChannel.send({
        type: 'broadcast',
        event: 'sync_ping',
        payload: {
          guestId: roomClockSync.getGuestId(),
          t0: Date.now()
        }
      })
    }

    syncChannel
      .on('broadcast', { event: 'sync_pong' }, ({ payload }: { payload: any }) => {
        if (payload && payload.guestId === roomClockSync.getGuestId()) {
          roomClockSync.handlePong(payload)
          // MUSIXQUARE resilience: receiving pong directly proves host is responsive
          useListeningStore.setState({ lastHostUpdate: Date.now() })
        }
      })
      .on('broadcast', { event: 'sync_pulse' }, ({ payload }: { payload: any }) => {
        if (payload) {
          useListeningStore.getState().handleHostSyncPulse(payload)
        }
      })
      .on('broadcast', { event: 'host_seek' }, ({ payload }: { payload: any }) => {
        if (payload && typeof payload.position === 'number') {
          useListeningStore.getState().handleHostExplicitSeek(payload)
        }
      })
      .on('broadcast', { event: 'host_play_pause' }, ({ payload }: { payload: any }) => {
        if (payload && typeof payload.isPlaying === 'boolean') {
          useListeningStore.getState().handleHostExplicitPlayPause(payload)
        }
      })
      .on('broadcast', { event: 'room_closed' }, () => {
        void useListeningStore.getState().handleHostDisconnect()
      })
      .on('broadcast', { event: 'track_change' }, ({ payload }: { payload: any }) => {
        if (payload?.song) {
          const currentRoom = useListeningStore.getState().joinedRoom
          if (currentRoom) {
            // Same-song detection: If the incoming track_change is for the SAME song
            // (e.g., host finished uploading to CDN), update the URL in-place
            // WITHOUT restarting the queue, which would cause a seek-to-0 jump.
            const currentSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
            const isSameSong = Boolean(
              currentSong &&
              currentRoom.song &&
              payload.song.title === currentRoom.song.title &&
              payload.song.artist === currentRoom.song.artist &&
              (payload.song.localId ? payload.song.localId === currentRoom.song.localId : true)
            )

            const updatedRoom = {
              ...currentRoom,
              song: {
                ...payload.song,
                hostPosition: payload.position || 0,
                hostTimestamp: payload.hostTimestamp || Date.now()
              },
              queue: Array.isArray(payload.queue) && payload.queue.length > 0 ? payload.queue : currentRoom.queue,
              position_seconds: payload.position || 0,
              is_playing: payload.isPlaying,
              updated_at: new Date(payload.hostTimestamp || Date.now()).toISOString()
            }
            useListeningStore.getState().setJoinedRoom(updatedRoom as any)
            useListeningStore.setState({ lastHostUpdate: Date.now() })

            const playerState = usePlayerStore.getState()
            const currentPlayingTrack = playerState.queue[playerState.currentSongIndex]
            const hasPlayableSource = Boolean(currentPlayingTrack && resolveSongAudioUrl(currentPlayingTrack))
            const isMissingSong = useListeningStore.getState().syncStatus === 'missing_song'
            const isBuffering = useListeningStore.getState().syncStatus === 'buffering'

            if (isSameSong && hasPlayableSource && !isMissingSong && !isBuffering) {
              if (payload.isLoop) {
                // Host looped the current track!
                usePlayerStore.getState().seek(0)
                usePlayerStore.getState().setCurrentTime(0)
                usePlayerStore.getState().setIsPlaying(payload.isPlaying !== false)
                useListeningStore.getState().performOneTimeSyncWithHost({
                  forceSeek: true,
                  logReason: 'Host looped current track'
                })
              } else {
                // Same song — host just uploaded to CDN or updated metadata.
                if (payload.song?.audioUrl && useListeningStore.getState().audioQuality === 'preview') {
                  void useListeningStore.getState().hotSwapToFullQuality(payload.song.audioUrl)
                }
                console.log('[track_change] Same song upload completion detected, updated room in-place')
              }
            } else {
              // Actual song change OR resolving missing/unplayable/buffering song — full handleHostSongChange
              void useListeningStore.getState().handleHostSongChange(updatedRoom as any)
            }
          }
        }
      })
      .on('broadcast', { event: 'track_upgrade' }, ({ payload }: { payload: any }) => {
        if (payload?.fullUrl) {
          const currentSong = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]
          const joinedRoom = useListeningStore.getState().joinedRoom
          const isCurrentTrack = Boolean(
            !payload.trackId ||
            (currentSong && (currentSong.id === payload.trackId || (currentSong as any).localId === payload.trackId)) ||
            (joinedRoom?.song && (joinedRoom.song.localId === payload.trackId || (joinedRoom.song as any).id === payload.trackId))
          )
          if (isCurrentTrack) {
            console.log('[track_upgrade] Full audio quality available for active song, initiating seamless hot-swap:', payload.fullUrl)
            if (joinedRoom?.song) {
              joinedRoom.song.audioUrl = payload.fullUrl
              joinedRoom.song.uploadStatus = 'UPLOADED'
            }
            const hasPlayableSource = Boolean(currentSong && resolveSongAudioUrl(currentSong))
            const isBuffering = useListeningStore.getState().syncStatus === 'buffering'
            if (!hasPlayableSource || isBuffering) {
              if (joinedRoom) {
                void useListeningStore.getState().handleHostSongChange(joinedRoom as any)
              }
            } else {
              void useListeningStore.getState().hotSwapToFullQuality(payload.fullUrl)
            }
          } else {
            console.log('[track_upgrade] Full audio quality available for upcoming track:', payload.trackId)
            if (payload.trackId) {
              void (async () => {
                try {
                  const { downloadRemoteAudioFileWithRetry, cacheAudioBlob } = await import('../lib/jitAudioPipeline')
                  const blob = await downloadRemoteAudioFileWithRetry(payload.fullUrl, {
                    trackId: payload.trackId,
                    onProgress: () => {}
                  })
                  if (blob && blob.size > 0) {
                    cacheAudioBlob(payload.trackId, blob)
                  }
                } catch {}
              })()
            }
          }
        }
      })
      .on('broadcast', { event: 'queue_update' }, ({ payload }: { payload: any }) => {
        if (Array.isArray(payload?.queue) && payload.queue.length > 0) {
          const currentRoom = useListeningStore.getState().joinedRoom
          if (currentRoom) {
            const updatedRoom = {
              ...currentRoom,
              queue: payload.queue
            }
            useListeningStore.getState().setJoinedRoom(updatedRoom as any)
            void useListeningStore.getState().preloadNextQueueTracks(updatedRoom as any)
          }
        }
      })
      .on('broadcast', { event: 'dsp_settings_sync' }, ({ payload }: { payload: any }) => {
        if (payload?.settings) {
          if (useDspStore.getState().settingsSync) {
            useDspStore.getState().applyRoomDspSnapshot(payload.settings)
          }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Rapid initial NTP probe burst (0ms, 300ms, 700ms) for instant Min-RTT calibration
          sendPing()
          window.setTimeout(sendPing, 300)
          window.setTimeout(sendPing, 700)
          // Request host DSP settings & volume if Settings Sync is enabled
          if (useDspStore.getState().settingsSync) {
            requestRoomDspSync()
          }
        }
      })

    // Continuous NTP calibration probe every 10 seconds to maintain smoothed clock offset
    const pingInterval = window.setInterval(sendPing, 10_000)

    return () => {
      _activeGuestSyncChannel = null
      window.clearInterval(pingInterval)
      void supabase.removeChannel(syncChannel)
    }
  }, [joinedRoom?.id, enabled, user?.id])

  return null
}


