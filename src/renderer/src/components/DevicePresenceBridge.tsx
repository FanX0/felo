import { useEffect, useRef } from 'react'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { toMediaUrl } from '../lib/media'

function getOrCreateDeviceId(isElectron: boolean): string {
  if (typeof window === 'undefined') return 'felo-desktop-main'
  let id = localStorage.getItem('felo_device_id')
  if (!id) {
    const prefix = isElectron ? 'desktop' : 'mobile'
    id = `${prefix}-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    localStorage.setItem('felo_device_id', id)
  }
  return id
}

function getDeviceName(isElectron: boolean, ip?: string): string {
  if (isElectron) {
    return `${ip ? 'Felo Desktop' : 'Felo Player'} (${ip || 'LAN'})`
  }
  if (typeof window === 'undefined') return 'Felo Web Player'
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android.*Mobile/i.test(ua)) return 'Android Phone'
  if (/Android/i.test(ua)) return 'Android Tablet'
  if (/Mac/i.test(ua)) return 'Mac (Web)'
  if (/Win/i.test(ua)) return 'Windows (Web)'
  return 'Web Player'
}

export default function DevicePresenceBridge() {
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const deviceIdRef = useRef<string>(getOrCreateDeviceId(isElectron))
  const heartbeatTimerRef = useRef<any>(null)
  const channelRef = useRef<any>(null)
  const wasPlayingRef = useRef(false)

  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSong = usePlayerStore((s) => s.queue[s.currentSongIndex] || null)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return undefined

    const deviceId = deviceIdRef.current
    const supabase = getSupabase()

    const publishPresence = async (isActive = true) => {
      try {
        let deviceName = getDeviceName(isElectron)
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
            deviceName = getDeviceName(isElectron, info.ip)
          }
        }

        const payload = {
          id: deviceId,
          user_id: user.id,
          device_name: deviceName,
          device_type: isElectron ? 'desktop' : 'mobile',
          local_ip: localIp,
          port: port,
          token: token,
          is_active: isRunning,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        await supabase.from('user_devices').upsert(payload, { onConflict: 'id' })
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
        { event: 'playback_state' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.activeDeviceId === deviceId) return
          if (payload.isPlaying) {
            useConnectedDeviceStore.getState().setRemotePlayback(payload)
          } else {
            const currentActive = useConnectedDeviceStore.getState().activePlayback
            if (currentActive && currentActive.activeDeviceId === payload.activeDeviceId) {
              useConnectedDeviceStore.getState().setRemotePlayback({
                ...currentActive,
                isPlaying: false,
                position: payload.position ?? currentActive.position,
                timestamp: Date.now()
              })
            }
          }
        }
      )
      .subscribe()

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
  }, [isElectron, user?.id])

  // Broadcast immediate state change (play, pause, song switch)
  useEffect(() => {
    if (!channelRef.current || !user?.id) return
    const deviceId = deviceIdRef.current
    const deviceName = getDeviceName(isElectron)

    if (isPlaying && currentSong) {
      // Clear remote playback because this device is actively outputting sound now
      useConnectedDeviceStore.getState().clearRemotePlayback()

      void channelRef.current.send({
        type: 'broadcast',
        event: 'playback_state',
        payload: {
          activeDeviceId: deviceId,
          activeDeviceName: deviceName,
          activeDeviceType: isElectron ? 'desktop' : 'mobile',
          isPlaying: true,
          song: {
            id: currentSong.id,
            title: currentSong.title,
            artist: currentSong.artist,
            album: currentSong.album,
            duration: currentSong.duration,
            artworkUrl: currentSong.artworkUrl || toMediaUrl(currentSong.artworkPath)
          },
          position: currentTime,
          duration: duration || currentSong.duration || 0,
          timestamp: Date.now()
        }
      })
    } else if (!isPlaying && wasPlayingRef.current) {
      void channelRef.current.send({
        type: 'broadcast',
        event: 'playback_state',
        payload: {
          activeDeviceId: deviceId,
          activeDeviceName: deviceName,
          activeDeviceType: isElectron ? 'desktop' : 'mobile',
          isPlaying: false,
          position: currentTime,
          duration: duration || currentSong?.duration || 0,
          timestamp: Date.now()
        }
      })
    }
    wasPlayingRef.current = isPlaying
  }, [isPlaying, currentSong?.id, isElectron, user?.id])

  // Periodic 5-second sync pulse while playing to maintain drift-free position tracking
  useEffect(() => {
    if (!isPlaying || !currentSong || !user?.id) return undefined
    const syncTimer = setInterval(() => {
      const player = usePlayerStore.getState()
      if (channelRef.current && player.isPlaying && currentSong) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'playback_state',
          payload: {
            activeDeviceId: deviceIdRef.current,
            activeDeviceName: getDeviceName(isElectron),
            activeDeviceType: isElectron ? 'desktop' : 'mobile',
            isPlaying: true,
            song: {
              id: currentSong.id,
              title: currentSong.title,
              artist: currentSong.artist,
              album: currentSong.album,
              duration: currentSong.duration,
              artworkUrl: currentSong.artworkUrl || toMediaUrl(currentSong.artworkPath)
            },
            position: player.currentTime,
            duration: player.duration || currentSong.duration || 0,
            timestamp: Date.now()
          }
        })
      }
    }, 5_000)

    return () => clearInterval(syncTimer)
  }, [isPlaying, currentSong?.id, isElectron, user?.id])

  return null
}
