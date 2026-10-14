import { useEffect, useRef } from 'react'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'felo-desktop-main'
  let id = localStorage.getItem('felo_device_id')
  if (!id) {
    id = `desktop-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    localStorage.setItem('felo_device_id', id)
  }
  return id
}

export default function DevicePresenceBridge() {
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const deviceIdRef = useRef<string>(getOrCreateDeviceId())
  const heartbeatTimerRef = useRef<any>(null)

  useEffect(() => {
    // Only desktop instances broadcast device presence to the user's account
    if (!isElectron || !user || !isSupabaseConfigured) return undefined

    const deviceId = deviceIdRef.current
    const supabase = getSupabase()

    const publishPresence = async (isActive = true) => {
      if (!window.api?.getRemoteControlInfo) return
      try {
        const info = await window.api.getRemoteControlInfo()
        if (!info) return

        const payload = {
          id: deviceId,
          user_id: user.id,
          device_name: `${info.ip ? 'Felo Desktop' : 'Felo Player'} (${info.ip || 'LAN'})`,
          device_type: 'desktop',
          local_ip: info.ip || null,
          port: info.port || 4788,
          token: info.token || null,
          is_active: isActive && Boolean(info.enabled && info.running),
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }

        await supabase.from('user_devices').upsert(payload, { onConflict: 'id' })
      } catch (err) {
        // Silently tolerate network/offline blips
        console.warn('[DevicePresence] Failed to update presence:', err)
      }
    }

    // 1. Initial registration
    void publishPresence(true)

    // 2. 30-second heartbeat
    heartbeatTimerRef.current = setInterval(() => {
      void publishPresence(true)
    }, 30_000)

    // 3. Mark offline on window close / page refresh
    const handleUnload = () => {
      void publishPresence(false)
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current)
      }
      window.removeEventListener('beforeunload', handleUnload)
      void publishPresence(false)
    }
  }, [isElectron, user?.id])

  return null
}
