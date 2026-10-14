import { useEffect, useRef } from 'react'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { getSupabase } from '../lib/supabase'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'

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

  // 3. Listen for incoming Universal Bot commands via Supabase Realtime
  useEffect(() => {
    if (!hostRoom?.code || !enabled) return
    const roomCode = hostRoom.code
    const supabase = getSupabase()

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

          // Mark processed
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
                const action = cmdPayload?.action || 'play_now'
                if (!query) {
                  player.setIsPlaying(true)
                  break
                }

                if (window.api?.getSongs) {
                  const songs = await window.api.getSongs()
                  const cleanQ = query.toLowerCase()
                  const match = songs.find(
                    (s: any) =>
                      s.title?.toLowerCase().includes(cleanQ) ||
                      s.artist?.toLowerCase().includes(cleanQ)
                  )
                  if (match) {
                    if (action === 'enqueue') {
                      player.enqueueSong(match)
                    } else if (action === 'play_next') {
                      player.enqueueSongNext(match)
                    } else {
                      player.enqueueSongNext(match)
                      player.playNext(true)
                    }
                  } else {
                    void downloadTrackInBackground(
                      { title: query },
                      {
                        playAction: action,
                        autoPlay: action === 'play_now',
                        conflictMode: 'keep_both'
                      }
                    )
                  }
                }
                break
              }
              case 'skip':
              case 'next':
                player.playNext(true)
                break
              case 'prev':
              case 'previous':
                player.playPrevious()
                break
              case 'stop':
                player.setIsPlaying(false)
                player.seek(0)
                break
              case 'pause':
                player.setIsPlaying(false)
                break
              case 'resume':
                player.setIsPlaying(true)
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
      )
      .subscribe()

    return () => {
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

