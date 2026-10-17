import { useEffect, useRef } from 'react'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useConnectedDeviceStore, REMOTE_PLAYBACK_STALE_MS } from '../hooks/useConnectedDeviceStore'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { toMediaUrl } from '../lib/media'
import {
  detectDeviceInfo,
  getCurrentDeviceId,
  getDeviceCategory,
  isPcDevice,
  type DeviceCategory,
  type DeviceInfo
} from '../lib/deviceInfo'
import { remoteClient } from '../pages/Remote/remoteClient'
import { getActiveAudioElement, getActiveAudioTime } from '../lib/audioBridge'
import { useListeningStore, isSessionSyncing } from '../hooks/useListeningStore'

function getDeviceName(info: DeviceInfo, isElectron: boolean): string {
  if (info.customName) {
    return info.customName
  }
  if (isElectron) {
    return 'Felo Desktop'
  }
  return info.canonicalName
}

export default function DevicePresenceBridge() {
  const user = useOnlineStore((s) => s.user)
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electron)
  const deviceInfo = detectDeviceInfo()
  const deviceCategory: DeviceCategory = deviceInfo.category
  const isDesktopDevice = isPcDevice(deviceCategory)
  const deviceType: DeviceCategory = deviceCategory
  const deviceIdRef = useRef<string>(getCurrentDeviceId())
  const heartbeatTimerRef = useRef<any>(null)
  const channelRef = useRef<any>(null)
  const wasPlayingRef = useRef(false)
  const broadcastTimerRef = useRef<any>(null)
  const lastBroadcastHashRef = useRef<string>('')
  const staleCleanupTimerRef = useRef<any>(null)
  const lastClaimRef = useRef<{ epoch: number; timer: any; payload: any } | null>(null)

  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isAudioActive = usePlayerStore((s) => s.isAudioActive)
  const currentSong = usePlayerStore((s) => s.queue[s.currentSongIndex] || null)
  const seekRequest = usePlayerStore((s) => s.seekRequest)
  const remoteControlInfoRef = useRef<any>(null)

  const sendPlaybackClaim = (claimPayload: any) => {
    if (!channelRef.current) return
    void channelRef.current.send({
      type: 'broadcast',
      event: 'playback_claim',
      payload: claimPayload
    })
    if (lastClaimRef.current?.timer) {
      clearTimeout(lastClaimRef.current.timer)
    }
    const timer = setTimeout(() => {
      const store = useConnectedDeviceStore.getState()
      const player = usePlayerStore.getState()
      if (
        lastClaimRef.current?.epoch === claimPayload.claimEpoch &&
        store.devicePlaybackMode === 'local' &&
        player.isPlaying &&
        player.isAudioActive &&
        channelRef.current
      ) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'playback_claim',
          payload: { ...claimPayload, isRetry: true }
        })
      }
      lastClaimRef.current = null
    }, 2000)
    lastClaimRef.current = { epoch: claimPayload.claimEpoch, timer, payload: claimPayload }
  }

  // Broadcast current player state to all peers
  const broadcastCurrentState = (playing: boolean) => {
    if (!channelRef.current || !user?.id) return
    const player = usePlayerStore.getState()
    // CRITICAL: A device must NEVER broadcast playback_state claiming to be the active player
    // unless it is the designated audio owner (isAudioActive === true).
    if (playing && !player.isAudioActive) return

    const song = player.queue[player.currentSongIndex] || currentSong
    const deviceId = deviceIdRef.current
    const devName = getDeviceName(deviceInfo, isElectron)

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
        activeDeviceType: deviceCategory,
        activeDeviceCategory: deviceCategory,
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

  // Debounced version to prevent broadcast storms during rapid state transitions
  const debouncedBroadcast = (playing: boolean) => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current)
    broadcastTimerRef.current = setTimeout(() => {
      broadcastTimerRef.current = null
      const player = usePlayerStore.getState()
      const song = player.queue[player.currentSongIndex]
      const pos = getActiveAudioTime() || player.currentTime
      const hash = `${song?.id || ''}:${playing}:${Math.floor(pos)}`
      if (hash === lastBroadcastHashRef.current) return
      lastBroadcastHashRef.current = hash
      broadcastCurrentState(playing)
    }, 120)
  }

  useEffect(() => {
    if (!user?.id || !isSupabaseConfigured) return undefined

    const deviceId = deviceIdRef.current
    const supabase = getSupabase()

    const publishPresence = async (isActive = true) => {
      try {
        let deviceName = getDeviceName(deviceInfo, isElectron)
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
            deviceName = getDeviceName(deviceInfo, isElectron)
          }
        }
        // Desktop presence reflects that the desktop Felo application is active
        isRunning = isActive

        const payload = {
          id: deviceId,
          user_id: user.id,
          device_name: deviceName,
          device_type: deviceCategory,
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
    const processedChunksRef = new Set<string>()

    // Discover active devices and load cached songs immediately
    if (user.id) {
      if (!isElectron) {
        useConnectedDeviceStore.getState().loadCachedPcSongs(user.id)
      }

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
              if (!isElectron) {
                const activeDesktop = data.find(
                  (d: any) =>
                    (d.device_type === 'app_pc' || d.device_type === 'desktop') && d.local_ip
                )
                if (activeDesktop && activeDesktop.local_ip) {
                  const targetUrl = `http://${activeDesktop.local_ip}:${activeDesktop.port || 4788}`
                  const currentBase = remoteClient.getBaseUrl()
                  if (!currentBase || !currentBase.includes(activeDesktop.local_ip)) {
                    remoteClient.configure(targetUrl, activeDesktop.token || '')
                  }
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

    const channel = supabase.channel(`user_playback_sync_${user.id}`)

    const sanitizeSongsForCache = (songsToCache: any[]) => {
      return songsToCache.map((s: any) => {
        const isLan = (u?: string) =>
          Boolean(
            u &&
              /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.0\.0\.1|localhost)/i.test(
                u
              )
          )
        return {
          id: s.id,
          title: s.title,
          artist: s.artist,
          artists: s.artists,
          album: s.album,
          duration: s.duration,
          genre: s.genre,
          trackNumber: s.trackNumber,
          artworkUrl: isLan(s.artworkUrl) ? undefined : s.artworkUrl,
          artworkPath: isLan(s.artworkPath) ? undefined : s.artworkPath,
          audioUrl: isLan(s.audioUrl) ? undefined : s.audioUrl,
          filePath: isLan(s.filePath) ? undefined : s.filePath,
          isOnline: true
        }
      })
    }

    const handleLibraryRequest = async (payload?: any) => {
      const isTargetMe =
        payload?.targetDeviceId === deviceId ||
        payload?.targetDeviceId === 'lan-desktop' ||
        ((!payload?.targetDeviceId ||
          payload.targetDeviceId === 'default-pc' ||
          payload.targetDeviceId === 'pc' ||
          payload.targetDeviceId === 'desktop') &&
          (isElectron || isDesktopDevice))
      if (!isTargetMe) return

      try {
        let rawSongs: any[] = []
        if (window.api?.getSongs) {
          try {
            rawSongs = (await window.api.getSongs()) || []
          } catch (e) {
            console.warn('[DevicePresenceBridge] window.api.getSongs failed:', e)
          }
        }
        if (rawSongs.length === 0) {
          // Mobile/web device fallback: share active player queue if available
          const currentQueue = usePlayerStore.getState().queue || []
          if (currentQueue.length > 0) {
            rawSongs = currentQueue
          }
        }
        if (rawSongs.length === 0) {
          // Immediate empty response to acknowledge peer request without timeout
          await channel.send({
            type: 'broadcast',
            event: 'device_library_response',
            payload: {
              transferId: `empty-${Date.now()}`,
              deviceId,
              requesterDeviceId: payload?.requesterDeviceId,
              chunkIndex: 0,
              totalChunks: 1,
              songs: [],
              totalSongs: 0
            }
          })
          return
        }

        let streamBase = ''
        let downloadBase = ''
        let artworkBase = ''
        let tokenParam = ''
        if (window.api?.getRemoteControlInfo) {
          const info = await window.api.getRemoteControlInfo()
          if (info && info.ip && info.port) {
            remoteControlInfoRef.current = info
            streamBase = `http://${info.ip}:${info.port}/v1/audio/`
            downloadBase = `http://${info.ip}:${info.port}/v1/download/`
            artworkBase = `http://${info.ip}:${info.port}/v1/artwork/`
            tokenParam = info.token ? `?token=${encodeURIComponent(info.token)}` : ''
          }
        }
        const cleanSongs = rawSongs.map((s: any) => {
          let artworkUrl = s.artworkUrl
          if (!artworkUrl || artworkUrl.startsWith('media:') || artworkUrl.startsWith('blob:')) {
            if (artworkBase) {
              artworkUrl = `${artworkBase}${encodeURIComponent(s.id)}${tokenParam}`
            } else {
              artworkUrl = s.artworkUrl || toMediaUrl(s.artworkPath) || undefined
            }
          }
          const audioUrl = streamBase
            ? `${streamBase}${encodeURIComponent(s.id)}${tokenParam}`
            : (s.audioUrl || (s.filePath && /^(https?:)/i.test(s.filePath) ? s.filePath : undefined))
          return {
            id: s.id,
            title: s.title,
            artist: s.artist,
            artists: s.artists,
            album: s.album,
            duration: s.duration,
            filePath: audioUrl || s.filePath,
            artworkUrl,
            artworkPath: artworkUrl,
            audioUrl,
            downloadUrl: downloadBase
              ? `${downloadBase}${encodeURIComponent(s.id)}${tokenParam}`
              : s.downloadUrl,
            genre: s.genre,
            bitrate: s.bitrate,
            sampleRate: s.sampleRate,
            bitDepth: s.bitDepth,
            codec: s.codec,
            trackNumber: s.trackNumber,
            dateAdded: s.dateAdded,
            isOnline: true
          }
        })

        const CHUNK_SIZE = 60
        const totalChunks = Math.ceil(cleanSongs.length / CHUNK_SIZE) || 1
        const transferId = `${deviceId}-${Date.now().toString(36)}`

        for (let i = 0; i < totalChunks; i++) {
          const chunk = cleanSongs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
          const respPayload = {
            transferId,
            deviceId,
            requesterDeviceId: payload?.requesterDeviceId,
            chunkIndex: i,
            totalChunks,
            songs: chunk,
            totalSongs: cleanSongs.length
          }
          await channel.send({
            type: 'broadcast',
            event: 'device_library_response',
            payload: respPayload
          })
          if (totalChunks > 1) {
            await new Promise((r) => setTimeout(r, 75))
          }
        }
      } catch (err) {
        console.warn('[DevicePresence] Failed to stream device library to peer:', err)
      }
    }

    const handleLibraryResponse = (payload: any) => {
      if (!payload || payload.deviceId === deviceId) return
      if (payload.requesterDeviceId) {
        const baseDeviceId = typeof window !== 'undefined' ? localStorage.getItem('felo_device_id') : null
        const isForMe =
          payload.requesterDeviceId === deviceId ||
          deviceId.startsWith(payload.requesterDeviceId) ||
          payload.requesterDeviceId.startsWith(deviceId) ||
          (baseDeviceId && (payload.requesterDeviceId.includes(baseDeviceId) || baseDeviceId.includes(payload.requesterDeviceId)))
        if (!isForMe) return
      }

      const {
        transferId = 'default',
        chunkIndex = 0,
        totalChunks = 1,
        songs: chunkSongs,
        deviceId: sourceDeviceId
      } = payload
      if (!Array.isArray(chunkSongs)) return

      // Deduplicate chunk receipt
      const chunkKey = `${transferId}:${chunkIndex}`
      if (processedChunksRef.has(chunkKey)) return
      processedChunksRef.add(chunkKey)
      if (processedChunksRef.size > 500) {
        const first = processedChunksRef.values().next().value
        if (first) processedChunksRef.delete(first)
      }

      if (totalChunks <= 1) {
        useConnectedDeviceStore
          .getState()
          .setDeviceLibrarySongs(sourceDeviceId || 'default', chunkSongs)
        if (user?.id) {
          try {
            const compactChunk = sanitizeSongsForCache(chunkSongs)
            const serialized = JSON.stringify(compactChunk)
            if (
              !sourceDeviceId ||
              sourceDeviceId === 'default' ||
              sourceDeviceId === 'pc' ||
              sourceDeviceId === 'default-pc'
            ) {
              localStorage.setItem(`felo_cached_pc_songs_${user.id}`, serialized)
            }
            if (sourceDeviceId) {
              localStorage.setItem(
                `felo_cached_songs_${user.id}_${sourceDeviceId}`,
                serialized
              )
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

      // Progressive merge: immediately assemble and display currently received tracks
      const currentAssembled: any[] = []
      for (let i = 0; i < transfer.total; i++) {
        const part = transfer.chunks.get(i)
        if (part && Array.isArray(part)) {
          currentAssembled.push(...part)
        }
      }
      if (currentAssembled.length > 0) {
        useConnectedDeviceStore
          .getState()
          .setDeviceLibrarySongs(sourceDeviceId || 'default', currentAssembled)
      }

      if (transfer.chunks.size >= transfer.total) {
        chunksRef.delete(transferId)
        if (user?.id) {
          try {
            const compactAssembled = sanitizeSongsForCache(currentAssembled)
            const serialized = JSON.stringify(compactAssembled)
            if (
              !sourceDeviceId ||
              sourceDeviceId === 'default' ||
              sourceDeviceId === 'pc' ||
              sourceDeviceId === 'default-pc'
            ) {
              localStorage.setItem(
                `felo_cached_pc_songs_${user.id}`,
                serialized
              )
            }
            if (sourceDeviceId) {
              localStorage.setItem(
                `felo_cached_songs_${user.id}_${sourceDeviceId}`,
                serialized
              )
            }
          } catch {
            // Ignore storage limits
          }
        }
      }
    }

    channel
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
                  useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
                  const epoch = useConnectedDeviceStore.getState().claimPlayback()
                  player.setQueue([songToPlay], 0, {
                    type: 'library',
                    title: 'Remote Playback'
                  })
                  if (typeof payload.position === 'number' && payload.position > 0) {
                    setTimeout(() => {
                      usePlayerStore.getState().seek(payload.position)
                    }, 80)
                  }
                  sendPlaybackClaim({
                    deviceId: deviceIdRef.current,
                    deviceName: getDeviceName(deviceInfo, isElectron),
                    deviceCategory: deviceInfo.category,
                    deviceType: isPcDevice(deviceInfo.category) ? 'desktop' : 'mobile',
                    song: songToPlay,
                    position: payload.position ?? 0,
                    duration: songToPlay.duration ?? 0,
                    claimEpoch: epoch,
                    timestamp: Date.now()
                  })
                }
              } else {
                useConnectedDeviceStore.getState().setDevicePlaybackMode('local')
                const epoch = useConnectedDeviceStore.getState().claimPlayback()
                player.setIsPlaying(true)
                const currentTrack = player.queue[player.currentSongIndex] || currentSong
                if (currentTrack) {
                  sendPlaybackClaim({
                    deviceId: deviceIdRef.current,
                    deviceName: getDeviceName(deviceInfo, isElectron),
                    deviceCategory: deviceInfo.category,
                    deviceType: isPcDevice(deviceInfo.category) ? 'desktop' : 'mobile',
                    song: currentTrack,
                    position: getActiveAudioTime() || player.currentTime,
                    duration: player.duration || currentTrack.duration || 0,
                    claimEpoch: epoch,
                    timestamp: Date.now()
                  })
                }
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
      .on('broadcast', { event: 'request_pc_library' }, async ({ payload }: { payload?: any }) => {
        await handleLibraryRequest(payload)
      })
      .on('broadcast', { event: 'request_device_library' }, async ({ payload }: { payload?: any }) => {
        await handleLibraryRequest(payload)
      })
      .on('broadcast', { event: 'pc_library_response' }, ({ payload }: { payload: any }) => {
        handleLibraryResponse(payload)
      })
      .on('broadcast', { event: 'device_library_response' }, ({ payload }: { payload: any }) => {
        handleLibraryResponse(payload)
      })
      .on(
        'broadcast',
        { event: 'request_playback_state' },
        ({ payload: reqPayload }: { payload: any }) => {
          if (reqPayload?.requesterDeviceId === deviceId) return
          const player = usePlayerStore.getState()
          const song = player.queue[player.currentSongIndex]
          if (song && player.isAudioActive) {
            broadcastCurrentState(player.isPlaying)
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
            // Do NOT auto-hijack playbackTarget — that is managed exclusively by
            // user action or playback arbitration to prevent silent preference override

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
              device_name: payload.activeDeviceName || 'Felo Player',
              device_type: payload.activeDeviceCategory || payload.activeDeviceType || 'desktop',
              device_category:
                payload.activeDeviceCategory ||
                getDeviceCategory({
                  device_type: payload.activeDeviceType,
                  device_name: payload.activeDeviceName
                }),
              last_seen_at: new Date(payload.timestamp || Date.now()).toISOString(),
              is_active: true
            }
            store.setDiscoveredDevices([
              updated,
              ...existing.filter((d) => d.id !== payload.activeDeviceId)
            ])
          } else {
            // Device stopped playing or sent empty song — fully clear remote playback
            // to prevent ghost/stale activePlayback state from lingering
            const currentActive = store.activePlayback
            if (currentActive && currentActive.activeDeviceId === payload.activeDeviceId) {
              store.clearRemotePlayback()
            }
          }
        }
      )
      .on(
        'broadcast',
        { event: 'playback_claim' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.deviceId === deviceId) return
          const player = usePlayerStore.getState()
          const store = useConnectedDeviceStore.getState()

          const amPlayingLocally = Boolean(
            player.isPlaying &&
            player.isAudioActive &&
            store.devicePlaybackMode !== 'remote_controller'
          )

          if (amPlayingLocally) {
            // Remote claimed playback. If remote claim epoch is newer than our claimEpoch, yield.
            // If claims were made nearly simultaneously (within 500ms), deterministic tiebreak: lower deviceId yields.
            const epochDiff = payload.claimEpoch - store.claimEpoch
            const shouldYield =
              epochDiff > 0 ||
              (Math.abs(epochDiff) < 500 && deviceId < payload.deviceId)

            if (shouldYield) {
              player.setIsPlaying(false)
              store.setDevicePlaybackMode('remote_controller')
              store.setRemotePlayback({
                activeDeviceId: payload.deviceId,
                activeDeviceName: payload.deviceName,
                activeDeviceType: payload.deviceType,
                activeDeviceCategory: payload.deviceCategory,
                isPlaying: true,
                song: payload.song,
                position: payload.position ?? 0,
                duration: payload.duration ?? 0,
                timestamp: Date.now()
              })
              void channel.send({
                type: 'broadcast',
                event: 'playback_claim_ack',
                payload: {
                  acknowledgerDeviceId: deviceId,
                  claimerDeviceId: payload.deviceId,
                  claimEpoch: payload.claimEpoch,
                  accepted: true
                }
              })
              return
            }
          } else {
            // Local device is not playing, accept remote claim
            store.setRemotePlayback({
              activeDeviceId: payload.deviceId,
              activeDeviceName: payload.deviceName,
              activeDeviceType: payload.deviceType,
              activeDeviceCategory: payload.deviceCategory,
              isPlaying: true,
              song: payload.song,
              position: payload.position ?? 0,
              duration: payload.duration ?? 0,
              timestamp: Date.now()
            })
            void channel.send({
              type: 'broadcast',
              event: 'playback_claim_ack',
              payload: {
                acknowledgerDeviceId: deviceId,
                claimerDeviceId: payload.deviceId,
                claimEpoch: payload.claimEpoch,
                accepted: true
              }
            })
          }
        }
      )
      .on(
        'broadcast',
        { event: 'playback_claim_ack' },
        ({ payload }: { payload: any }) => {
          if (!payload || payload.claimerDeviceId !== deviceId) return
          // Claim successfully acknowledged by remote peer
          if (lastClaimRef.current && lastClaimRef.current.epoch === payload.claimEpoch) {
            clearTimeout(lastClaimRef.current.timer)
            lastClaimRef.current = null
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

    const handleCustomRequestLib = (e: any) => {
      if (channelRef.current && e.detail) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'request_device_library',
          payload: e.detail
        })
      }
    }
    window.addEventListener('felo:request-device-library', handleCustomRequestLib)

    // 4. Stale activePlayback TTL cleanup
    // If no playback_state update arrives within REMOTE_PLAYBACK_STALE_MS,
    // the remote playback is considered abandoned (device crashed/disconnected)
    staleCleanupTimerRef.current = setInterval(() => {
      const store = useConnectedDeviceStore.getState()
      const ap = store.activePlayback
      if (ap && Date.now() - ap.timestamp > REMOTE_PLAYBACK_STALE_MS) {
        store.clearRemotePlayback()
      }
    }, 5_000)

    // 5. Mark offline on unload
    const handleUnload = () => {
      void publishPresence(false)
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      window.removeEventListener('felo:request-device-library', handleCustomRequestLib)
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current)
      }
      if (staleCleanupTimerRef.current) {
        clearInterval(staleCleanupTimerRef.current)
      }
      if (broadcastTimerRef.current) {
        clearTimeout(broadcastTimerRef.current)
      }
      if (lastClaimRef.current?.timer) {
        clearTimeout(lastClaimRef.current.timer)
        lastClaimRef.current = null
      }
      channelRef.current = null
      window.removeEventListener('beforeunload', handleUnload)
      void supabase.removeChannel(channel)
      void publishPresence(false)
    }
  }, [isElectron, isDesktopDevice, deviceType, user?.id])

  // Broadcast immediate state change (play, pause, song switch) — debounced
  useEffect(() => {
    if (!channelRef.current || !user?.id) return

    if (isPlaying && isAudioActive && currentSong) {
      // Do NOT broadcast playback_claim if we're a guest syncing in Listen-Together
      const listeningState = useListeningStore.getState()
      const isGuestSyncing = Boolean(
        (listeningState.joinedRoom && !listeningState.hostRoom) ||
        isSessionSyncing()
      )
      if (isGuestSyncing) {
        debouncedBroadcast(true)
        wasPlayingRef.current = isPlaying && isAudioActive
        return
      }

      useConnectedDeviceStore.getState().clearRemotePlayback()
      const newEpoch = useConnectedDeviceStore.getState().claimPlayback()
      sendPlaybackClaim({
        deviceId: deviceIdRef.current,
        deviceName: getDeviceName(deviceInfo, isElectron),
        deviceCategory: deviceInfo.category,
        deviceType: isPcDevice(deviceInfo.category) ? 'desktop' : 'mobile',
        song: currentSong,
        position: getActiveAudioTime() || usePlayerStore.getState().currentTime,
        duration: usePlayerStore.getState().duration || currentSong.duration || 0,
        claimEpoch: newEpoch,
        timestamp: Date.now()
      })
      debouncedBroadcast(true)
    } else if (!isPlaying && wasPlayingRef.current && isAudioActive) {
      // Pause events should propagate immediately (no debounce)
      broadcastCurrentState(false)
    }
    wasPlayingRef.current = isPlaying && isAudioActive
  }, [isPlaying, isAudioActive, currentSong?.id, isElectron, isDesktopDevice, deviceType, user?.id])

  // Broadcast immediate seek changes so remote peers jump — debounced
  useEffect(() => {
    if (!channelRef.current || !user?.id || seekRequest === null || !isAudioActive) return
    debouncedBroadcast(isPlaying)
  }, [seekRequest, isPlaying, isAudioActive, user?.id])

  // Listen to audio DOM seeked event for native browser / manual scrub events
  useEffect(() => {
    const audio = getActiveAudioElement() ?? document.querySelector('audio')
    if (!audio || !isAudioActive) return
    const onSeeked = () => {
      if (channelRef.current && user?.id && isAudioActive) {
        debouncedBroadcast(isPlaying)
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
