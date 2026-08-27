import { useEffect, useRef } from 'react'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'

interface ListeningPresenceBridgeProps {
  enabled: boolean
}

export default function ListeningPresenceBridge({ enabled }: ListeningPresenceBridgeProps): null {
  const user = useOnlineStore((state) => state.user)
  const profile = useOnlineStore((state) => state.profile)
  const currentSong = usePlayerStore((state) => state.queue[state.currentSongIndex])
  const currentSongId = currentSong?.id
  const isPlaying = usePlayerStore((state) => state.isPlaying)

  const joinedRoom = useListeningStore((state) => state.joinedRoom)
  const isJoiningRoom = useListeningStore((state) => state.isJoiningRoom)
  const hostRoom = useListeningStore((state) => state.hostRoom)
  const ensureHostRoom = useListeningStore((state) => state.ensureHostRoom)
  const deactivateHostRoom = useListeningStore((state) => state.deactivateHostRoom)

  const prevSongIdRef = useRef<string | undefined>(undefined)
  const prevIsPlayingRef = useRef<boolean | undefined>(undefined)
  const isUpdatingRef = useRef(false)

  // 1. Immediate Broadcast on Playback State Change (Song Change or Play/Pause)
  useEffect(() => {
    if (!user || !enabled || isJoiningRoom) return

    // If currently listening to someone else, do not broadcast as host
    if (joinedRoom && joinedRoom.host_id !== user.id) return

    const songChanged = prevSongIdRef.current !== currentSongId
    const playStateChanged = prevIsPlayingRef.current !== isPlaying

    prevSongIdRef.current = currentSongId
    prevIsPlayingRef.current = isPlaying

    // If this is the initial load or a meaningful change in playback
    if (songChanged || playStateChanged || !hostRoom) {
      if (isUpdatingRef.current) return
      isUpdatingRef.current = true

      void ensureHostRoom(true).finally(() => {
        isUpdatingRef.current = false
      })
    }
  }, [user?.id, profile?.display_name, enabled, isJoiningRoom, currentSongId, isPlaying, joinedRoom?.id, hostRoom?.id, ensureHostRoom])

  // 2. Periodic Heartbeat (Every 5s) to Keep Room Timestamp & Position Fresh
  useEffect(() => {
    if (!user || !enabled) {
      void deactivateHostRoom()
      return
    }

    if (isJoiningRoom) return

    if (joinedRoom && joinedRoom.host_id !== user.id) return

    const interval = window.setInterval(() => {
      if (joinedRoom && joinedRoom.host_id !== user.id) return
      if (isUpdatingRef.current) return

      isUpdatingRef.current = true
      void ensureHostRoom(true).finally(() => {
        isUpdatingRef.current = false
      })
    }, 5000)

    return () => window.clearInterval(interval)
  }, [user?.id, enabled, isJoiningRoom, joinedRoom?.id, ensureHostRoom, deactivateHostRoom])

  // 3. Deactivate room on unmount or disable
  useEffect(() => {
    return () => {
      void deactivateHostRoom()
    }
  }, [deactivateHostRoom])

  return null
}
