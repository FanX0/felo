import { useEffect, useRef } from 'react'
import { useListeningStore, isSessionSyncing, registerRoomDspSyncSender, toSharedSong } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore, setPlaybackGuard } from '../hooks/usePlayerStore'
import { useDspStore, type DspRoomSnapshot } from '../hooks/useDspStore'
import { getSupabase } from '../lib/supabase'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'
import { findMatchingLibrarySong } from '../lib/songMatching'
import { registerLocalSlotPoolPath } from '../lib/jitAudioPipeline'
import { playParticipantJoinSound, playParticipantLeaveSound } from '../lib/uiSounds'
import { roomClockSync } from '../lib/roomClockSync'
import { getActiveAudioTime, getAudioPlaybackRate } from '../lib/audioBridge'
import type { Song } from '../pages/Library/Library'

let _activeHostSyncChannel: any = null
let _activeGuestSyncChannel: any = null

/**
 * Broadcasts room DSP settings (EQ gains, Reverb presets, Virtual Bass) and volume
 * over the active room-sync channel to all connected listeners.
 */
export function broadcastDspOverSyncChannel(snapshot: DspRoomSnapshot, volume?: number): void {
  if (_activeHostSyncChannel) {
    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'dsp_settings_sync',
      payload: {
        settings: snapshot,
        volume: typeof volume === 'number' ? volume : usePlayerStore.getState().volume
      }
    })
  }
}

registerRoomDspSyncSender(broadcastDspOverSyncChannel)

/**
 * Broadcasts an authoritative track change to all connected listeners immediately.
 * Called when local playback changes or when cloud audio upload completes.
 */
export function broadcastHostTrackChange(song: any): void {
  if (_activeHostSyncChannel) {
    void _activeHostSyncChannel.send({
      type: 'broadcast',
      event: 'track_change',
      payload: {
        song,
        position: getActiveAudioTime() || usePlayerStore.getState().currentTime || 0,
        isPlaying: usePlayerStore.getState().isPlaying,
        hostTimestamp: Date.now()
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
      if (joinedRoom && myRole === 'listener') {
        useListeningStore.getState().setPendingLeaveAndPlay(proceed)
        return true
      }
      return false
    })
    return () => setPlaybackGuard(null)
  }, [])

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
          if (payload.eventType === 'INSERT') {
            playParticipantJoinSound()
          } else if (payload.eventType === 'DELETE') {
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
          playbackRate: getAudioPlaybackRate()
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

    // Periodic pulse every 2.0s unconditionally (continuous presence heartbeat like MUSIXQUARE)
    const interval = window.setInterval(() => {
      sendPulse()
    }, 2000)

    // Immediate pulse on playback state changes (play, pause, seek, song change, volume change)
    const unsub = usePlayerStore.subscribe((state, prevState) => {
      const playChanged = state.isPlaying !== prevState.isPlaying
      const songChanged = state.currentSongIndex !== prevState.currentSongIndex
      const seekChanged = state.seekRequest !== null && state.seekRequest !== prevState.seekRequest
      const volumeChanged = state.volume !== prevState.volume

      if (songChanged) {
        const newSong = state.queue[state.currentSongIndex]
        if (newSong) {
          void syncChannel.send({
            type: 'broadcast',
            event: 'track_change',
            payload: {
              song: toSharedSong(newSong),
              position: 0,
              isPlaying: state.isPlaying,
              hostTimestamp: Date.now()
            }
          })
        }
      }

      if (seekChanged && typeof state.seekRequest === 'number') {
        sendPulse(state.seekRequest)
      } else if (playChanged || songChanged) {
        sendPulse()
      }

      // Sync volume to listeners if Settings Sync is active
      if (volumeChanged && useDspStore.getState().settingsSync) {
        const snapshot = useDspStore.getState().getRoomDspSnapshot()
        void syncChannel.send({
          type: 'broadcast',
          event: 'dsp_settings_sync',
          payload: {
            settings: snapshot,
            volume: state.volume
          }
        })
      }
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
            const effectiveAction = !isPriorityEnabled && action === 'play_next' ? 'enqueue' : action
            const isPriority = Boolean(isPriorityEnabled && (effectiveAction === 'play_next' || effectiveAction === 'play_now'))

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
            const isPriority = Boolean(cmdPayload?.isPriority)

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
          event: 'UPDATE',
          schema: 'public',
          table: 'listening_rooms',
          filter: `id=eq.${roomId}`
        },
        (payload) => {
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
            void useListeningStore.getState().ensureHostRoom(true, true)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const prevIsDeviceStream = Boolean(
            currentRoom?.song?.isDeviceStream || currentRoom?.is_device_stream
          )
          const newIsDeviceStream = Boolean(
            next.song?.isDeviceStream || next.is_device_stream
          )

          // Auto-Switch 1: Host started live device broadcast -> seamlessly switch to WebRTC
          if (!prevIsDeviceStream && newIsDeviceStream) {
            console.log('[AutoSwitch] Host started live broadcast, switching to WebRTC')
            usePlayerStore.getState().setIsPlaying(false)
            useListeningStore.getState().setJoinedRoom(next)
            void useListeningStore.getState().connectToDeviceStream(next)
            return
          }

          // Auto-Switch 2: Host stopped live device broadcast -> seamlessly resume track sync
          if (prevIsDeviceStream && !newIsDeviceStream) {
            console.log('[AutoSwitch] Host stopped broadcast, resuming track sync')
            useListeningStore.getState().disconnectFromDeviceStream()
            useListeningStore.getState().setJoinedRoom(next)
            void useListeningStore.getState().handleHostSongChange(next)
            return
          }

          const songChanged =
            next.song?.title !== currentRoom?.song?.title ||
            next.song?.artist !== currentRoom?.song?.artist ||
            next.song?.localId !== currentRoom?.song?.localId ||
            next.song?.lanUrl !== currentRoom?.song?.lanUrl ||
            next.song?.audioUrl !== currentRoom?.song?.audioUrl ||
            next.song?.uploadStatus !== currentRoom?.song?.uploadStatus ||
            next.song?.isTrackStream !== currentRoom?.song?.isTrackStream ||
            next.is_track_streaming !== currentRoom?.is_track_streaming

          const posChanged =
            Math.abs((next.position_seconds || 0) - (currentRoom?.position_seconds || 0)) > 1.2 ||
            Math.abs(
              (typeof next.song?.hostPosition === 'number' ? next.song.hostPosition : 0) -
                (typeof currentRoom?.song?.hostPosition === 'number' ? currentRoom.song.hostPosition : 0)
            ) > 1.2

          useListeningStore.getState().setJoinedRoom(next)

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(next)
          } else if (next.is_playing !== currentRoom?.is_playing || posChanged) {
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
          event: 'UPDATE',
          schema: 'public',
          table: 'listening_rooms',
          filter: `id=eq.${roomId}`
        },
        (payload: any) => {
          if (payload.new) {
            const updatedRoom = payload.new as any
            const currentRoom = useListeningStore.getState().joinedRoom
            if (!currentRoom) return

            const songChanged =
              updatedRoom.song?.audioUrl !== currentRoom.song?.audioUrl ||
              updatedRoom.song?.uploadStatus !== currentRoom.song?.uploadStatus ||
              updatedRoom.song?.localId !== currentRoom.song?.localId ||
              updatedRoom.song?.title !== currentRoom.song?.title

            if (songChanged) {
              const mergedRoom = {
                ...currentRoom,
                ...updatedRoom,
                song: {
                  ...updatedRoom.song,
                  hostPosition: updatedRoom.position_seconds || 0,
                  hostTimestamp: new Date(updatedRoom.updated_at || Date.now()).getTime()
                }
              }
              useListeningStore.setState({ joinedRoom: mergedRoom, lastHostUpdate: Date.now() })
              void useListeningStore.getState().handleHostSongChange(mergedRoom)
            }
          }
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
        const { data: latestRoom } = await supabase
          .from('listening_rooms')
          .select('*')
          .eq('id', roomId)
          .maybeSingle()

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
            void useListeningStore.getState().ensureHostRoom(true, true)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const prevIsDeviceStream = Boolean(
            currentRoom?.song?.isDeviceStream || currentRoom?.is_device_stream
          )
          const newIsDeviceStream = Boolean(
            latestRoom.song?.isDeviceStream || latestRoom.is_device_stream
          )

          // Auto-Switch 1: Live broadcast start detected via poll
          if (!prevIsDeviceStream && newIsDeviceStream) {
            usePlayerStore.getState().setIsPlaying(false)
            useListeningStore.getState().setJoinedRoom(latestRoom as any)
            void useListeningStore.getState().connectToDeviceStream(latestRoom as any)
            return
          }

          // Auto-Switch 2: Live broadcast stop detected via poll
          if (prevIsDeviceStream && !newIsDeviceStream) {
            useListeningStore.getState().disconnectFromDeviceStream()
            useListeningStore.getState().setJoinedRoom(latestRoom as any)
            void useListeningStore.getState().handleHostSongChange(latestRoom as any)
            return
          }

          const songChanged =
            latestRoom.song?.title !== currentRoom?.song?.title ||
            latestRoom.song?.artist !== currentRoom?.song?.artist ||
            latestRoom.song?.localId !== currentRoom?.song?.localId ||
            latestRoom.song?.lanUrl !== currentRoom?.song?.lanUrl ||
            latestRoom.song?.audioUrl !== currentRoom?.song?.audioUrl ||
            latestRoom.song?.uploadStatus !== currentRoom?.song?.uploadStatus ||
            latestRoom.song?.isTrackStream !== currentRoom?.song?.isTrackStream ||
            latestRoom.is_track_streaming !== currentRoom?.is_track_streaming

          const posChanged =
            Math.abs((latestRoom.position_seconds || 0) - (currentRoom?.position_seconds || 0)) > 1.2 ||
            Math.abs(
              (typeof latestRoom.song?.hostPosition === 'number' ? latestRoom.song.hostPosition : 0) -
                (typeof currentRoom?.song?.hostPosition === 'number' ? currentRoom.song.hostPosition : 0)
            ) > 1.2

          useListeningStore.getState().setJoinedRoom(latestRoom as any)

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(latestRoom as any)
          } else if (latestRoom.is_playing !== currentRoom?.is_playing || posChanged) {
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
      .on('broadcast', { event: 'track_change' }, ({ payload }: { payload: any }) => {
        if (payload?.song) {
          const currentRoom = useListeningStore.getState().joinedRoom
          if (currentRoom) {
            const updatedRoom = {
              ...currentRoom,
              song: {
                ...payload.song,
                hostPosition: payload.position || 0,
                hostTimestamp: payload.hostTimestamp || Date.now()
              },
              position_seconds: payload.position || 0,
              is_playing: payload.isPlaying,
              updated_at: new Date(payload.hostTimestamp || Date.now()).toISOString()
            }
            useListeningStore.setState({ joinedRoom: updatedRoom as any, lastHostUpdate: Date.now() })
            void useListeningStore.getState().handleHostSongChange(updatedRoom as any)
          }
        }
      })
      .on('broadcast', { event: 'dsp_settings_sync' }, ({ payload }: { payload: any }) => {
        if (payload?.settings) {
          if (useDspStore.getState().settingsSync) {
            useDspStore.getState().applyRoomDspSnapshot(payload.settings)
            if (typeof payload.volume === 'number' && Number.isFinite(payload.volume)) {
              usePlayerStore.getState().setVolume(payload.volume)
            }
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


