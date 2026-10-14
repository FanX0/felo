import { useEffect, useRef } from 'react'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { getSupabase } from '../lib/supabase'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'
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
  const isDeviceAudioSharing = useListeningStore((state) => state.isDeviceAudioSharing)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const deactivateHostRoom = useListeningStore((state) => state.deactivateHostRoom)

  const prevSongIdRef = useRef<string | undefined>(undefined)
  const prevQueueKeyRef = useRef<string | undefined>(undefined)
  const prevIsPlayingRef = useRef<boolean | undefined>(undefined)
  const isUpdatingRef = useRef(false)

  // 1. Immediate Broadcast on Playback State Change (Song Change, Queue/Playlist Change, or Play/Pause)
  useEffect(() => {
    if (!user || !enabled || !isAudioActive || isJoiningRoom || hostRoomStopped || joinedRoom !== null || isDeviceAudioSharing) return

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
            const action = cmdPayload?.action || 'play_next'
            const requester = record?.sender_name ? `@${record.sender_name}` : 'Discord'
            if (!query) {
              player.setIsPlaying(true)
              void ensureHostRoom(true)
              break
            }

            const cleanQ = query.toLowerCase()

            // 1. Check if the song is already in active player queue
            const queueMatchIndex = player.queue.findIndex(
              (s) =>
                s.title?.toLowerCase().includes(cleanQ) ||
                (s.artist && s.artist.toLowerCase().includes(cleanQ))
            )

            if (queueMatchIndex >= 0) {
              const matchedSong = {
                ...player.queue[queueMatchIndex],
                requestedBy: requester,
                isPriority: true
              }
              if (action === 'play_now') {
                player.playSong(queueMatchIndex)
              } else if (action === 'enqueue') {
                player.enqueueSong(matchedSong)
              } else {
                // Priority / Important request: placed right after current song or after previous priority requests
                player.enqueueSongPriority(matchedSong)
                if (!player.isPlaying || player.currentSongIndex === -1) {
                  player.playNext(true)
                }
              }
              void ensureHostRoom(true)
              break
            }

            // 2. Check local library if available
            let libraryMatch: Song | undefined
            try {
              const songs = (await window.api?.getSongs?.()) || []
              libraryMatch = songs.find(
                (s: any) =>
                  s.title?.toLowerCase().includes(cleanQ) ||
                  (s.artist && s.artist.toLowerCase().includes(cleanQ))
              )
            } catch {}

            if (libraryMatch) {
              const prioritySong = {
                ...libraryMatch,
                requestedBy: requester,
                isPriority: true
              }
              if (action === 'enqueue') {
                player.enqueueSong(prioritySong)
              } else if (action === 'play_now') {
                player.enqueueSongPriority(prioritySong)
                player.playNext(true)
              } else {
                // Priority / Important request
                player.enqueueSongPriority(prioritySong)
                if (!player.isPlaying || player.currentSongIndex === -1) {
                  player.playNext(true)
                }
              }
              void ensureHostRoom(true)
              break
            }

            // 3. Fallback: Create instant virtual track so UI & audio switch in 0ms
            const virtualSong: Song = {
              id: `discord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: cmdPayload?.title || query,
              artist: cmdPayload?.artist || 'Discord Request',
              album: '',
              duration: cmdPayload?.duration || 0,
              artworkPath: '',
              filePath: `virtual:${query}`,
              requestedBy: requester,
              isPriority: true
            }

            if (action === 'enqueue') {
              player.enqueueSong(virtualSong)
            } else if (action === 'play_now') {
              player.enqueueSongPriority(virtualSong)
              player.playNext(true)
            } else {
              // Priority / Important request
              player.enqueueSongPriority(virtualSong)
              if (!player.isPlaying || player.currentSongIndex === -1) {
                player.playNext(true)
              }
            }
            void ensureHostRoom(true)

            // Also trigger desktop background downloader if capabilities allow
            void downloadTrackInBackground(
              { title: query },
              {
                playAction: action,
                autoPlay: action === 'play_now',
                conflictMode: 'keep_both'
              }
            ).catch(() => undefined)

            break
          }
          case 'skip':
          case 'next':
            player.playNext(true)
            void ensureHostRoom(true)
            break
          case 'prev':
          case 'previous':
            player.playPrevious()
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
          case 'volume': {
            const percent = Number(cmdPayload?.percent)
            if (!isNaN(percent) && percent >= 0 && percent <= 100) {
              player.setVolume(percent / 100)
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

  // 4. Deactivate room on unmount or disable ONLY if this tab was the active audio owner
  useEffect(() => {
    return () => {
      if (usePlayerStore.getState().isAudioActive) {
        void deactivateHostRoom()
      }
    }
  }, [deactivateHostRoom])

  return null
}

