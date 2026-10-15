import { useEffect, useRef } from 'react'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useConnectedDeviceStore } from '../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { toMediaUrl } from '../lib/media'
import { detectDeviceInfo } from '../lib/deviceInfo'
import { remoteClient } from '../pages/Remote/remoteClient'
import { getActiveAudioElement, getActiveAudioTime } from '../lib/audioBridge'

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
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const currentSong = usePlayerStore((s) => s.queue[s.currentSongIndex] || null)
  const seekRequest = usePlayerStore((s) => s.seekRequest)
  const remoteControlInfoRef = useRef<any>(null)

  // Broadcast current player state to all peers
  const broadcastCurrentState = (playing: boolean) => {
    if (!channelRef.current || !user?.id) return
    const player = usePlayerStore.getState()
    // CRITICAL: A device must NEVER broadcast playback_state claiming to be the active player
    // unless it is the designated audio owner (isAudioActive === true).
    if (playing && !player.isAudioActive) return

    const song = player.queue[player.currentSongIndex] || currentSong
    const deviceId = deviceIdRef.current
    const devName = getDeviceName(isElectron, isDesktopDevice)

    const rc = remoteControlInfoRef.current
    const streamBase = rc?.ip && rc?.port ? `http://${rc.ip}:${rc.port}/v1/audio/` : ''
    const downloadBase = rc?.ip && rc?.port ? `http://${rc.ip}:${rc.port}/v1/download/` : ''
    const tokenParam = rc?.token ? `?token=${encodeURIComponent(rc.token)}` : ''

    let lyricsPayload: { plainLyrics?: string; syncedLyrics?: string } | undefined = undefined
    try {
      const cleanTrack = song?.title?.toLowerCase().trim()
      const cleanArtist = song?.artist?.toLowerCase().trim()
      if (cleanTrack && cleanArtist) {
        const raw = localStorage.getItem(`felo-lyrics:${cleanTrack}:::${cleanArtist}`)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed?.syncedLyrics || parsed?.plainLyrics) {
            lyricsPayload = {
              syncedLyrics: parsed.syncedLyrics,
              plainLyrics: parsed.plainLyrics
            }
          }
        }
      }
    } catch {
      // ignore
    }

    const currentAudioTime = getActiveAudioTime()
    const livePosition = currentAudioTime > 0 ? currentAudioTime : player.currentTime

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
              artworkUrl: song.artworkUrl || toMediaUrl(song.artworkPath),
              audioUrl: streamBase ? `${streamBase}${encodeURIComponent(song.id)}${tokenParam}` : undefined,
              downloadUrl: downloadBase ? `${downloadBase}${encodeURIComponent(song.id)}${tokenParam}` : undefined
            }
          : null,
        lyrics: lyricsPayload,
        position: livePosition,
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
            remoteControlInfoRef.current = info
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
    const chunksRef = new Map<string, { total: number; chunks: Map<number, any[]> }>()

    // Mobile / Web: Load cached songs and discover active devices immediately
    if (!isElectron && user.id) {
      useConnectedDeviceStore.getState().loadCachedPcSongs(user.id)

      const refreshDiscovered = () => {
        void supabase
          .from('user_devices')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .then(({ data }) => {
            if (Array.isArray(data)) {
              useConnectedDeviceStore.getState().setDiscoveredDevices(data)

              // Auto-configure remoteClient with the desktop's local IP and token if available
              const activeDesktop = data.find((d: any) => d.device_type === 'desktop' && d.local_ip)
              if (activeDesktop && activeDesktop.local_ip) {
                const currentBase = remoteClient.getBaseUrl()
                if (
                  !currentBase ||
                  currentBase.includes('workers.dev') ||
                  currentBase.includes('localhost')
                ) {
                  const targetUrl = `http://${activeDesktop.local_ip}:${activeDesktop.port || 4788}`
                  remoteClient.configure(targetUrl, activeDesktop.token || '')
                }
              }
            }
          })
      }

      refreshDiscovered()
      const devicePollInterval = setInterval(refreshDiscovered, 15_000)

      const devChannel = supabase
        .channel(`user_devices_live_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_devices',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            refreshDiscovered()
          }
        )
        .subscribe()

      // Cleanup
      const prevCleanup = () => {
        clearInterval(devicePollInterval)
        void supabase.removeChannel(devChannel)
      }
      window.addEventListener('beforeunload', prevCleanup)
    }

    const channel = supabase
      .channel(`user_playback_sync_${user.id}`)
      .on(
        'broadcast',
        { event: 'command' },
        async ({ payload }: { payload: any }) => {
          if (!payload) return
          const isTargetMe =
            payload.targetDeviceId === deviceId ||
            (payload.targetDeviceId === 'desktop' && isDesktopDevice) ||
            (!payload.targetDeviceId && isDesktopDevice)

          if (!isTargetMe) return

          const player = usePlayerStore.getState()
          switch (payload.action) {
            case 'play':
              if (payload.songId || payload.song) {
                let songToPlay = payload.song
                if (isElectron && window.api?.getSongs) {
                  try {
                    const localSongs = (await window.api.getSongs()) || []
                    const matched = localSongs.find(
                      (s) =>
                        s.id === (payload.songId || payload.song?.id) ||
                        (payload.song?.title &&
                          s.title.toLowerCase() === payload.song.title.toLowerCase() &&
                          s.artist.toLowerCase() === (payload.song.artist || '').toLowerCase())
                    )
                    if (matched) {
                      songToPlay = matched
                    }
                  } catch (err) {
                    console.warn('[DevicePresence] Failed to resolve local song for play command:', err)
                  }
                }
                if (songToPlay) {
                  player.setQueue([songToPlay], 0, {
                    type: 'library',
                    title: 'Remote Playback'
                  })
                  if (typeof payload.position === 'number' && payload.position > 0) {
                    setTimeout(() => {
                      usePlayerStore.getState().seek(payload.position)
                    }, 80)
                  }
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
        { event: 'request_pc_library' },
        async ({ payload }: { payload?: any }) => {
          // Only Desktop with Electron local SQLite library responds
          if (!isElectron || !window.api?.getSongs) return
          if (
            payload?.targetDeviceId &&
            payload.targetDeviceId !== 'default-pc' &&
            payload.targetDeviceId !== 'pc' &&
            payload.targetDeviceId !== deviceId
          ) {
            return
          }
          try {
            const rawSongs = (await window.api.getSongs()) || []
            let streamBase = ''
            let downloadBase = ''
            let tokenParam = ''
            if (window.api?.getRemoteControlInfo) {
              const info = await window.api.getRemoteControlInfo()
              if (info && info.ip && info.port) {
                remoteControlInfoRef.current = info
                streamBase = `http://${info.ip}:${info.port}/v1/audio/`
                downloadBase = `http://${info.ip}:${info.port}/v1/download/`
                tokenParam = info.token ? `?token=${encodeURIComponent(info.token)}` : ''
              }
            }
            const cleanSongs = rawSongs.map((s: any) => ({
              id: s.id,
              title: s.title,
              artist: s.artist,
              artists: s.artists,
              album: s.album,
              duration: s.duration,
              artworkUrl: s.artworkUrl || toMediaUrl(s.artworkPath) || undefined,
              audioUrl: streamBase ? `${streamBase}${encodeURIComponent(s.id)}${tokenParam}` : undefined,
              downloadUrl: downloadBase ? `${downloadBase}${encodeURIComponent(s.id)}${tokenParam}` : undefined,
              genre: s.genre,
              bitrate: s.bitrate,
              sampleRate: s.sampleRate,
              bitDepth: s.bitDepth,
              codec: s.codec,
              trackNumber: s.trackNumber,
              dateAdded: s.dateAdded,
              isOnline: true
            }))

            const CHUNK_SIZE = 250
            const totalChunks = Math.ceil(cleanSongs.length / CHUNK_SIZE) || 1
            const transferId = `${deviceId}-${Date.now().toString(36)}`

            for (let i = 0; i < totalChunks; i++) {
              const chunk = cleanSongs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
              await channel.send({
                type: 'broadcast',
                event: 'pc_library_response',
                payload: {
                  transferId,
                  deviceId,
                  chunkIndex: i,
                  totalChunks,
                  songs: chunk,
                  totalSongs: cleanSongs.length
                }
              })
              if (totalChunks > 1) {
                await new Promise((r) => setTimeout(r, 40))
              }
            }
          } catch (err) {
            console.warn('[DevicePresence] Failed to stream PC library to peer:', err)
          }
        }
      )
      .on(
        'broadcast',
        { event: 'pc_library_response' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.deviceId === deviceId) return
          const { transferId = 'default', chunkIndex = 0, totalChunks = 1, songs: chunkSongs, deviceId: sourceDeviceId } = payload
          if (!Array.isArray(chunkSongs)) return

          if (totalChunks <= 1) {
            useConnectedDeviceStore.getState().setDeviceLibrarySongs(sourceDeviceId || 'default', chunkSongs)
            if (user?.id) {
              try {
                localStorage.setItem(`felo_cached_pc_songs_${user.id}`, JSON.stringify(chunkSongs))
                if (sourceDeviceId) {
                  localStorage.setItem(`felo_cached_songs_${user.id}_${sourceDeviceId}`, JSON.stringify(chunkSongs))
                }
              } catch {
                // Ignore storage limits
              }
            }
            return
          }

          let transfer = chunksRef.get(transferId)
          if (!transfer) {
            transfer = { total: totalChunks, chunks: new Map() }
            chunksRef.set(transferId, transfer)
          }
          transfer.chunks.set(chunkIndex, chunkSongs)

          if (transfer.chunks.size >= transfer.total) {
            const assembled: any[] = []
            for (let i = 0; i < transfer.total; i++) {
              const part = transfer.chunks.get(i) || []
              assembled.push(...part)
            }
            chunksRef.delete(transferId)
            useConnectedDeviceStore.getState().setDeviceLibrarySongs(sourceDeviceId || 'default', assembled)
            if (user?.id) {
              try {
                localStorage.setItem(`felo_cached_pc_songs_${user.id}`, JSON.stringify(assembled))
                if (sourceDeviceId) {
                  localStorage.setItem(`felo_cached_songs_${user.id}_${sourceDeviceId}`, JSON.stringify(assembled))
                }
              } catch {
                // Ignore storage limits
              }
            }
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
            const playerState = usePlayerStore.getState()
            if (!playerState.isPlaying || !playerState.isAudioActive) {
              store.setPlaybackTarget('desktop')
            }

            store.setRemotePlayback({
              ...payload,
              timestamp: Date.now()
            })

            // Cache remote lyrics locally if provided by host PC
            if (payload.lyrics && payload.song?.title && payload.song?.artist) {
              try {
                const cleanT = payload.song.title.toLowerCase().trim()
                const cleanA = payload.song.artist.toLowerCase().trim()
                const k = `felo-lyrics:${cleanT}:::${cleanA}`
                if (!localStorage.getItem(k)) {
                  localStorage.setItem(k, JSON.stringify(payload.lyrics))
                }
              } catch {
                // ignore storage quota error
              }
            }

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
          if (player.isPlaying && player.isAudioActive && (player.queue[player.currentSongIndex] || currentSong)) {
            broadcastCurrentState(true)
          } else {
            void channel.send({
              type: 'broadcast',
              event: 'request_playback_state',
              payload: { requesterDeviceId: deviceId }
            })
          }

          // If mobile / web, ask PC for its music library
          if (!isElectron) {
            void channel.send({
              type: 'broadcast',
              event: 'request_pc_library',
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

    if (isPlaying && isAudioActive && currentSong) {
      useConnectedDeviceStore.getState().clearRemotePlayback()
      broadcastCurrentState(true)
    } else if (!isPlaying && wasPlayingRef.current && isAudioActive) {
      broadcastCurrentState(false)
    }
    wasPlayingRef.current = isPlaying && isAudioActive
  }, [isPlaying, isAudioActive, currentSong?.id, isElectron, isDesktopDevice, deviceType, user?.id])

  // Broadcast immediate seek changes so remote peers jump instantly
  useEffect(() => {
    if (!channelRef.current || !user?.id || seekRequest === null || !isAudioActive) return
    broadcastCurrentState(isPlaying)
  }, [seekRequest, isPlaying, isAudioActive, user?.id])

  // Listen to audio DOM seeked event for native browser / manual scrub events
  useEffect(() => {
    const audio = getActiveAudioElement() ?? document.querySelector('audio')
    if (!audio || !isAudioActive) return
    const onSeeked = () => {
      if (channelRef.current && user?.id && isAudioActive) {
        broadcastCurrentState(isPlaying)
      }
    }
    audio.addEventListener('seeked', onSeeked)
    return () => audio.removeEventListener('seeked', onSeeked)
  }, [isPlaying, isAudioActive, user?.id])

  // Periodic 3-second sync pulse while playing to maintain drift-free position tracking
  useEffect(() => {
    if (!isPlaying || !isAudioActive || !currentSong || !user?.id) return undefined
    const syncTimer = setInterval(() => {
      const player = usePlayerStore.getState()
      if (channelRef.current && player.isPlaying && player.isAudioActive && currentSong) {
        broadcastCurrentState(true)
      }
    }, 3_000)

    return () => clearInterval(syncTimer)
  }, [isPlaying, isAudioActive, currentSong?.id, isElectron, isDesktopDevice, deviceType, user?.id])

  return null
}
