import { useEffect, useRef } from 'react'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { getSupabase } from '../lib/supabase'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'
import { findMatchingLibrarySong } from '../lib/songMatching'
import type { Song } from '../pages/Library/Library'

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
  const isAudioActive = usePlayerStore((state) => state.isAudioActive)

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

  // 1. Immediate Broadcast on Playback State Change (Song Change, Queue/Playlist Change, or Play/Pause)
  useEffect(() => {
    if (!user || !enabled || !isAudioActive || isJoiningRoom || hostRoomStopped || joinedRoom !== null) return

    const songChanged = prevSongIdRef.current !== currentSongId
    const queueChanged = prevQueueKeyRef.current !== queueKey
    const playStateChanged = prevIsPlayingRef.current !== isPlaying

    prevSongIdRef.current = currentSongId
    prevQueueKeyRef.current = queueKey
    prevIsPlayingRef.current = isPlaying

    // If this is the initial load or a meaningful change in playback / queue
    if (songChanged || queueChanged || playStateChanged || !hostRoom) {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true

      void ensureHostRoom(true).finally(() => {
        isUpdatingRef.current = false
      })
    }
  }, [user?.id, profile?.display_name, enabled, isAudioActive, isJoiningRoom, hostRoomStopped, currentSongId, queueKey, isPlaying, joinedRoom, hostRoom?.id, ensureHostRoom])

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
    if (!user || !enabled || !isAudioActive) {
      if (isAudioActive && (!user || !enabled)) {
        void deactivateHostRoom()
      }
      return
    }

    if (isJoiningRoom || hostRoomStopped || joinedRoom !== null) return

    const interval = window.setInterval(() => {
      if (joinedRoom !== null || hostRoomStopped) return
      if (isUpdatingRef.current) return

      isUpdatingRef.current = true
      void ensureHostRoom(true).finally(() => {
        isUpdatingRef.current = false
      })

      const currentHost = useListeningStore.getState().hostRoom
      if (currentHost?.id) {
        void useListeningStore.getState().refreshMemberCount(currentHost.id)
      }
    }, 5000)

    return () => window.clearInterval(interval)
  }, [user?.id, enabled, isAudioActive, isJoiningRoom, hostRoomStopped, joinedRoom, ensureHostRoom, deactivateHostRoom])

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
      } catch (err) {
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
              syncStatus: 'idle'
            })
            usePlayerStore.getState().setIsPlaying(true)
            void useListeningStore.getState().ensureHostRoom(true, true)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const songChanged =
            next.song?.title !== currentRoom?.song?.title ||
            next.song?.artist !== currentRoom?.song?.artist ||
            next.song?.localId !== currentRoom?.song?.localId

          useListeningStore.getState().setJoinedRoom(next)

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(next)
          } else {
            useListeningStore.getState().handleHostPauseResume(next)
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
          // If this user was promoted to host (via automatic failover or host transfer)
          if (latestRoom.host_id === user.id) {
            useListeningStore.setState({
              hostRoom: latestRoom as any,
              joinedRoom: null,
              hostRoomStopped: false,
              syncStatus: 'idle'
            })
            usePlayerStore.getState().setIsPlaying(true)
            void useListeningStore.getState().ensureHostRoom(true, true)
            return
          }

          const currentRoom = useListeningStore.getState().joinedRoom
          const songChanged =
            latestRoom.song?.title !== currentRoom?.song?.title ||
            latestRoom.song?.artist !== currentRoom?.song?.artist ||
            latestRoom.song?.localId !== currentRoom?.song?.localId

          useListeningStore.getState().setJoinedRoom(latestRoom as any)

          if (songChanged) {
            void useListeningStore.getState().handleHostSongChange(latestRoom as any)
          } else {
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

  return null
}


