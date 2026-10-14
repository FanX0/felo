import { useEffect, useRef } from 'react'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { toMediaUrl } from '../lib/media'
import { detectDeviceInfo } from '../lib/deviceInfo'

function getIsDesktop(isElectron: boolean): boolean {
  if (isElectron) return true
  if (typeof window === 'undefined') return true
  const info = detectDeviceInfo()
  return info.type === 'desktop'
}

function getOrCreateDeviceId(isDesktop: boolean): string {
  if (typeof window === 'undefined') return 'felo-desktop-main'
  let id = localStorage.getItem('felo_device_id')
  if (!id) {
    const prefix = isDesktop ? 'desktop' : 'mobile'
    id = `${prefix}-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    localStorage.setItem('felo_device_id', id)
  }
  return id
}

function getDeviceName(isElectron: boolean, isDesktop: boolean, ip?: string): string {
  if (isElectron) {
    return `${ip ? 'Felo Desktop' : 'Felo Player'} (${ip || 'LAN'})`
  }
  if (typeof window === 'undefined') return 'Felo Web Player'
  const info = detectDeviceInfo()
  if (isDesktop) {
    return `${info.name} (${info.browser})`
  }
  return info.name || 'Web Player'
}

export default function DevicePresenceBridge() {
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const isDesktopDevice = getIsDesktop(isElectron)
  const deviceType: 'desktop' | 'mobile' = isDesktopDevice ? 'desktop' : 'mobile'
  const deviceIdRef = useRef<string>(getOrCreateDeviceId(isDesktopDevice))
  const heartbeatTimerRef = useRef<any>(null)
  const channelRef = useRef<any>(null)
  const wasPlayingRef = useRef(false)

  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSong = usePlayerStore((s) => s.queue[s.currentSongIndex] || null)

  // Broadcast current player state to all peers
  const broadcastCurrentState = (playing: boolean) => {
    if (!channelRef.current || !user?.id) return
    const player = usePlayerStore.getState()
    const song = player.queue[player.currentSongIndex] || currentSong
    const deviceId = deviceIdRef.current
    const devName = getDeviceName(isElectron, isDesktopDevice)

    void channelRef.current.send({
      type: 'broadcast',
      event: 'playback_state',
      payload: {
        activeDeviceId: deviceId,
        activeDeviceName: devName,
        activeDeviceType: deviceType,
        isPlaying: playing,
        song: song
          ? {
              id: song.id,
              title: song.title,
              artist: song.artist,
              album: song.album,
              duration: song.duration,
              artworkUrl: song.artworkUrl || toMediaUrl(song.artworkPath)
            }
          : null,
        position: player.currentTime,
        duration: player.duration || song?.duration || 0,
        timestamp: Date.now()
      }
    })
  }

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return undefined

    const deviceId = deviceIdRef.current
    const supabase = getSupabase()

    const publishPresence = async (isActive = true) => {
      try {
        let deviceName = getDeviceName(isElectron, isDesktopDevice)
        let localIp: string | null = null
        let port: number | null = null
        let token: string | null = null
        let isRunning = isActive

        if (isElectron && window.api?.getRemoteControlInfo) {
          const info = await window.api.getRemoteControlInfo()
          if (info) {
            localIp = info.ip || null
            port = info.port || 4788
            token = info.token || null
            isRunning = isActive && Boolean(info.enabled && info.running)
            deviceName = getDeviceName(isElectron, isDesktopDevice, info.ip)
          }
        }

        const payload = {
          id: deviceId,
          user_id: user.id,
          device_name: deviceName,
          device_type: deviceType,
          local_ip: localIp,
          port: port,
          token: token,
          is_active: isRunning,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        const { error } = await supabase.from('user_devices').upsert(payload, { onConflict: 'id' })
        if (error) {
          console.warn('[DevicePresence] Failed to update presence:', error.message)
        }
      } catch (err) {
        console.warn('[DevicePresence] Failed to update presence:', err)
      }
    }

    // 1. Initial registration
    void publishPresence(true)

    // 2. 25-second heartbeat
    heartbeatTimerRef.current = setInterval(() => {
      void publishPresence(true)
    }, 25_000)

    // 3. Bidirectional Realtime Channel
    const channel = supabase
      .channel(`user_playback_sync_${user.id}`)
      .on(
        'broadcast',
        { event: 'command' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.targetDeviceId !== deviceId) return

          const player = usePlayerStore.getState()
          switch (payload.action) {
            case 'play':
              if (payload.song) {
                player.setQueue([payload.song], 0, {
                  type: 'library',
                  title: 'Remote Playback'
                })
                if (typeof payload.position === 'number' && payload.position > 0) {
                  setTimeout(() => {
                    usePlayerStore.getState().seek(payload.position)
                  }, 80)
                }
              } else {
                player.setIsPlaying(true)
              }
              break
            case 'pause':
              player.setIsPlaying(false)
              break
            case 'togglePlay':
              player.togglePlay()
              break
            case 'next':
              player.playNext(true)
              break
            case 'previous':
              player.playPrevious()
              break
            case 'seek':
              if (typeof payload.seconds === 'number') {
                player.seek(payload.seconds)
              }
              break
            case 'volume':
              if (typeof payload.volume === 'number') {
                player.setVolume(payload.volume)
              }
              break
          }
        }
      )
      .on(
        'broadcast',
        { event: 'request_playback_state' },
        ({ payload: reqPayload }: { payload: any }) => {
          if (reqPayload?.requesterDeviceId === deviceId) return
          const player = usePlayerStore.getState()
          const song = player.queue[player.currentSongIndex]
          if (song && player.isPlaying) {
            broadcastCurrentState(true)
          }
        }
      )
      .on(
        'broadcast',
        { event: 'playback_state' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.activeDeviceId === deviceId) return
          const store = useConnectedDeviceStore.getState()

          if (payload.song) {
            store.setRemotePlayback({
              ...payload,
              timestamp: Date.now()
            })

            // Also register in discoveredDevices store so UI immediately displays this device
            const existing = store.discoveredDevices
            const updated = {
              id: payload.activeDeviceId,
              user_id: user.id,
              device_name: payload.activeDeviceName || 'Felo Desktop',
              device_type: payload.activeDeviceType || 'desktop',
              last_seen_at: new Date(payload.timestamp || Date.now()).toISOString(),
              is_active: true
            }
            store.setDiscoveredDevices([
              updated,
              ...existing.filter((d) => d.id !== payload.activeDeviceId)
            ])
          } else {
            const currentActive = store.activePlayback
            if (currentActive && currentActive.activeDeviceId === payload.activeDeviceId) {
              store.setRemotePlayback({
                ...currentActive,
                isPlaying: false,
                position: payload.position ?? currentActive.position,
                timestamp: Date.now()
              })
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          const player = usePlayerStore.getState()
          if (player.isPlaying && (player.queue[player.currentSongIndex] || currentSong)) {
            broadcastCurrentState(true)
          } else {
            void channel.send({
              type: 'broadcast',
              event: 'request_playback_state',
              payload: { requesterDeviceId: deviceId }
            })
          }
        }
      })

    channelRef.current = channel

    // 4. Mark offline on unload
    const handleUnload = () => {
      void publishPresence(false)
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current)
      }
      channelRef.current = null
      window.removeEventListener('beforeunload', handleUnload)
      void supabase.removeChannel(channel)
      void publishPresence(false)
    }
  }, [isElectron, isDesktopDevice, deviceType, user?.id])

  // Broadcast immediate state change (play, pause, song switch)
  useEffect(() => {
    if (!channelRef.current || !user?.id) return

    if (isPlaying && currentSong) {
      useConnectedDeviceStore.getState().clearRemotePlayback()
      broadcastCurrentState(true)
    } else if (!isPlaying && wasPlayingRef.current) {
      broadcastCurrentState(false)
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, currentSong?.id, isElectron, isDesktopDevice, deviceType, user?.id])

  // Periodic 5-second sync pulse while playing to maintain drift-free position tracking
  useEffect(() => {
    if (!isPlaying || !currentSong || !user?.id) return undefined
    const syncTimer = setInterval(() => {
      const player = usePlayerStore.getState()
      if (channelRef.current && player.isPlaying && currentSong) {
        broadcastCurrentState(true)
      }
    }, 5_000)

    return () => clearInterval(syncTimer)
  }, [isPlaying, currentSong?.id, isElectron, isDesktopDevice, deviceType, user?.id])

  return null
}
