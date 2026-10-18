import { useEffect } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import { usePrivateSessionStore } from '../hooks/usePrivateSessionStore'
import { useDirectChatStore } from '../hooks/useDirectChatStore'
import { getActiveAudioElement } from '../lib/audioBridge'
import { downloadTrackInBackground } from '../lib/backgroundDownloader'
import { AppCapabilities } from '../lib/appConfig'
import type { Song } from '../pages/Library/Library'

type Command = {
  requestId: string
  deadline: number
  command: {
    type: string
    query?: string
    action?: 'play_now' | 'play_next' | 'enqueue'
    song?: Song
    songs?: Song[]
    songId?: string
    percent?: number
    volumePercent?: number
    seconds?: number
    shuffle?: boolean
    repeat?: 'off' | 'all' | 'one'
    offset?: number
    limit?: number
    playlistName?: string
    collection?: string
    artistName?: string
    albumTitle?: string
    index?: number
    forceNew?: boolean
    preferredCode?: string
    code?: string
    roomId?: string
    friendName?: string
    friendId?: string
    name?: string
  }
}

function summary(song?: Song) {
  return song
    ? {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        artworkPath: song.artworkPath,
        isPriority: Boolean(song.isPriority),
        requestedBy: song.requestedBy
      }
    : null
}

export default function PlaybackControlBridge() {
  useEffect(() => {
    if (!window.electron || !window.api?.onExternalPlayerCommand) return
    let disposed = false
    const snapshot = () => {
      const player = usePlayerStore.getState()
      const song = player.queue[player.currentSongIndex]
      const audio = getActiveAudioElement() ?? document.querySelector('audio')
      const isPlaying = Boolean(
        audio &&
        !audio.paused &&
        !audio.ended &&
        audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      )
      const playbackState = audio?.error
        ? 'error'
        : audio?.ended
          ? 'ended'
          : isPlaying
            ? 'playing'
            : song && player.isPlaying
              ? 'loading'
              : song
                ? 'paused'
                : 'stopped'
      const volume = audio?.volume ?? player.volume
      const outputMuted = Boolean(audio?.muted || volume === 0)
      return {
        ready: Boolean(audio),
        playbackState,
        isPlaying,
        song: summary(song),
        position: audio?.currentTime ?? player.currentTime,
        duration: Number.isFinite(audio?.duration) ? audio!.duration : player.duration || 0,
        volume,
        volumePercent: Math.round(volume * 100),
        muted: Boolean(audio?.muted),
        outputMuted,
        warnings: outputMuted
          ? [
              'PLAYER_MUTED: Playback is silent at the player. Set volume only when the user requests it.'
            ]
          : [],
        queueLength: player.queue.length,
        queueIndex: player.currentSongIndex,
        shuffle: player.isShuffle,
        repeat: player.repeatMode,
        listeningRoomControlled: Boolean(
          useListeningStore.getState().joinedRoom &&
          useListeningStore.getState().joinedRoom?.host_id !== useOnlineStore.getState().user?.id
        ),
        isListeningRoomHost: Boolean(
          useListeningStore.getState().hostRoom ||
          (useListeningStore.getState().joinedRoom &&
           useListeningStore.getState().joinedRoom?.host_id === useOnlineStore.getState().user?.id)
        ),
        listeningRoomCode:
          useListeningStore.getState().hostRoom?.code ||
          useListeningStore.getState().joinedRoom?.code ||
          undefined,
        listeningRoomName:
          useListeningStore.getState().hostRoom?.name ||
          useListeningStore.getState().joinedRoom?.name ||
          undefined,
        listeningRoomMembers: useListeningStore.getState().memberCount,
        isPrivateSession: usePrivateSessionStore.getState().isPrivateSession
      }
    }
    const publish = () => {
      const state = snapshot()
      if (!disposed) window.api.publishExternalPlayerStatus(state)
      return state
    }
    const unsubscribeStore = usePlayerStore.subscribe((state, prev) => {
      const songChanged =
        state.currentSongIndex !== prev.currentSongIndex ||
        state.queue[state.currentSongIndex]?.id !== prev.queue[prev.currentSongIndex]?.id
      const playbackChanged = state.isPlaying !== prev.isPlaying
      const volumeChanged = state.volume !== prev.volume
      const queueChanged = state.queue.length !== prev.queue.length
      const modeChanged =
        state.isShuffle !== prev.isShuffle || state.repeatMode !== prev.repeatMode

      if (songChanged || playbackChanged || volumeChanged || queueChanged || modeChanged) {
        publish()
      }
    })
    const unsubscribeListeningStore = useListeningStore.subscribe((state, prev) => {
      const roomChanged =
        state.hostRoom?.code !== prev.hostRoom?.code ||
        state.joinedRoom?.code !== prev.joinedRoom?.code ||
        state.memberCount !== prev.memberCount ||
        state.hostRoom?.is_active !== prev.hostRoom?.is_active
      if (roomChanged) {
        publish()
      }
    })
    const unsubscribePrivateStore = usePrivateSessionStore.subscribe(() => {
      publish()
    })
    const audio = document.querySelector('audio')
    const audioEvents = [
      'playing',
      'pause',
      'ended',
      'error',
      'loadedmetadata',
      'volumechange',
      'seeked'
    ]
    const onAudioChange = () => {
      publish()
    }
    audioEvents.forEach((event) => audio?.addEventListener(event, onAudioChange))

    const removeCommandListener = window.api.onExternalPlayerCommand(
      (payload: any) => {
        void (async () => {
          const { requestId, command, deadline } = payload as Command
        const checkDeadline = () => {
          if (disposed || Date.now() >= deadline) throw new Error('COMMAND_EXPIRED')
        }
        const waitFor = async (condition: () => boolean) => {
          const end = Math.min(deadline - 100, Date.now() + 8_000)
          while (Date.now() < end) {
            checkDeadline()
            if (condition()) return
            await new Promise((resolve) => window.setTimeout(resolve, 25))
          }
          throw new Error('PLAYBACK_FAILED: The audio player did not confirm the requested change.')
        }
        let result: Record<string, unknown>
        let verifyPlayback = false
        let expectedSongId: string | undefined
        try {
          checkDeadline()
          const player = usePlayerStore.getState()
          const domAudio = getActiveAudioElement() ?? document.querySelector('audio')
          if (!domAudio) throw new Error('PLAYER_NOT_READY')
          const currentAudio: HTMLAudioElement = domAudio
          const listeningState = useListeningStore.getState()
          const onlineUser = useOnlineStore.getState().user
          const joinedRoom = listeningState.joinedRoom
          const isHostOfJoined = Boolean(
            joinedRoom && onlineUser && joinedRoom.host_id === onlineUser.id
          )
          const isHost = Boolean(listeningState.hostRoom || isHostOfJoined)
          const isGuestInRoom = Boolean(joinedRoom && !isHostOfJoined)

          // If user is currently a GUEST in someone else's room:
          // An explicit user playback command via MCP cleanly exits the guest room
          // so local playback can immediately start without getting overridden by the host.
          if (isGuestInRoom && !['queue', 'volume'].includes(command.type)) {
            try {
              await listeningState.leaveJoinedRoom()
            } catch {
              listeningState.cleanupOnLeave()
            }
          }
          if (['play', 'play-song'].includes(command.type) && command.volumePercent !== undefined) {
            player.setVolume(command.volumePercent / 100)
            currentAudio.volume = command.volumePercent / 100
            currentAudio.muted = false
          }
          switch (command.type) {
            case 'queue': {
              const offset = command.offset ?? 0
              result = {
                ok: true,
                state: publish(),
                queue: player.queue
                  .slice(offset, offset + (command.limit ?? 20))
                  .map((song, index) => ({
                    ...summary(song),
                    index: offset + index,
                    current: offset + index === player.currentSongIndex
                  })),
                total: player.queue.length,
                offset
              }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'play':
              if (!player.queue.length) throw new Error('NO_PLAYABLE_TRACKS')
              if (!player.queue[player.currentSongIndex]) player.playSong(0)
              if (currentAudio.ended) player.seek(0)
              player.setIsPlaying(true)
              verifyPlayback = true
              expectedSongId =
                usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex].id
              break
            case 'play-song': {
              const song = command.song
              if (!song?.id || (!song.filePath && !song.audioUrl && !(song as any).previewUrl))
                throw new Error('SONG_NOT_PLAYABLE')
              window.dispatchEvent(
                new CustomEvent('felo:bot-activity', {
                  detail: {
                    type: 'bot',
                    title: 'Playing Track',
                    message: `Now playing "${song.title}" by ${song.artist} via bot command.`
                  }
                })
              )
              // Preserve the queue when selecting an existing item; append new choices.
              const index = player.queue.findIndex((item) => item.id === song.id)
              if (index >= 0) {
                player.playSong(index)
                if (index === player.currentSongIndex) player.seek(0)
              } else if (player.queue.length) {
                player.enqueueSong(song)
                usePlayerStore.getState().playSong(player.queue.length)
              } else player.setQueue([song], 0)
              verifyPlayback = true
              expectedSongId = song.id
              break
            }
            case 'play-index': {
              if (
                typeof command.index === 'number' &&
                command.index >= 0 &&
                player.queue[command.index]
              ) {
                player.playSong(command.index)
                verifyPlayback = true
                expectedSongId = player.queue[command.index].id
              } else {
                throw new Error('INVALID_QUEUE_INDEX')
              }
              break
            }
            case 'play-playlist':
            case 'play-collection':
            case 'play-artist':
            case 'play-album': {
              const songs = command.songs
              if (!Array.isArray(songs) || songs.length === 0) throw new Error('NO_PLAYABLE_TRACKS')
              if (command.shuffle) {
                if (!player.isShuffle) player.toggleShuffle()
              }
              player.setQueue(songs, 0)
              verifyPlayback = true
              expectedSongId = songs[0].id
              break
            }
            case 'pause':
              player.setIsPlaying(false)
              // Reconcile actual audio even if the store already said paused.
              currentAudio.pause()
              await waitFor(() => currentAudio.paused)
              break
            case 'next':
              if (!player.queue.length) throw new Error('QUEUE_EMPTY')
              if (player.repeatMode === 'off' && player.currentSongIndex >= player.queue.length - 1)
                throw new Error(
                  'END_OF_QUEUE: Add another song with felo_enqueue or choose one with felo_play.'
                )
              window.dispatchEvent(
                new CustomEvent('felo:bot-activity', {
                  detail: {
                    type: 'skip',
                    title: 'Track Skipped',
                    message: 'Skipped to next track via bot command.'
                  }
                })
              )
              player.playNext(true)
              verifyPlayback = true
              expectedSongId = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]?.id
              break
            case 'previous':
              if (!player.queue.length) throw new Error('QUEUE_EMPTY')
              player.playPrevious()
              verifyPlayback = usePlayerStore.getState().isPlaying
              expectedSongId = usePlayerStore.getState().queue[usePlayerStore.getState().currentSongIndex]?.id
              await waitFor(() => usePlayerStore.getState().seekRequest === null && !currentAudio.seeking)
              break
            case 'volume':
              player.setVolume(command.percent! / 100)
              currentAudio.volume = command.percent! / 100
              currentAudio.muted = false
              window.dispatchEvent(
                new CustomEvent('felo:bot-activity', {
                  detail: {
                    type: 'volume',
                    title: 'Volume Changed',
                    message: `Volume set to ${command.percent}% via bot command.`
                  }
                })
              )
              break
            case 'seek': {
              if (!player.queue[player.currentSongIndex] || !Number.isFinite(currentAudio.duration))
                throw new Error('NO_TRACK_LOADED')
              if (command.seconds! >= currentAudio.duration)
                throw new Error('POSITION_OUT_OF_RANGE')
              player.seek(command.seconds!)
              await waitFor(
                () =>
                  !currentAudio.seeking &&
                  Math.abs(currentAudio.currentTime - command.seconds!) < 0.5
              )
              break
            }
            case 'enqueue':
              if (!command.song) throw new Error('SONG_NOT_PLAYABLE')
              player.enqueueSong(command.song)
              break
            case 'enqueue-next':
              if (!command.song) throw new Error('SONG_NOT_PLAYABLE')
              player.enqueueSongNext(command.song)
              break
            case 'download-and-play': {
              const query = command.query?.trim()
              const action = command.action || 'play_now'
              const user = (command as any).user ? `@${(command as any).user}` : 'Bot'
              if (!query) throw new Error('QUERY_REQUIRED')

              if (!AppCapabilities.downloads) {
                // In Web mode (downloads disabled), directly play/enqueue without downloading
                const song: Song = {
                  id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  title: query,
                  artist: 'Online Stream',
                  album: '',
                  duration: 0,
                  filePath: `virtual:${query}`,
                  isOnline: true
                }
                if (action === 'play_now') {
                  player.enqueueSong(song)
                  usePlayerStore.getState().playSong(player.queue.length - 1)
                } else if (action === 'play_next') {
                  player.enqueueSongNext(song)
                } else {
                  player.enqueueSong(song)
                }
                result = { ok: true, state: publish(), playing: true, query, action }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }

              window.dispatchEvent(
                new CustomEvent('felo:bot-activity', {
                  detail: {
                    type: 'download',
                    title: `Bot Request: ${user}`,
                    message: `Searching & downloading "${query}" via priority providers (${action === 'enqueue' ? 'Queueing' : action === 'play_next' ? 'Plays Next' : 'Auto-Plays'}).`
                  }
                })
              )
              void downloadTrackInBackground(
                { title: query },
                {
                  playAction: action,
                  autoPlay: action === 'play_now',
                  conflictMode: 'keep_both',
                  requestedBy: `${user} (Bot)`
                }
              )
              result = { ok: true, state: publish(), downloading: true, query, action }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'remove': {
              const currentId = player.queue[player.currentSongIndex]?.id
              if (currentId === command.songId)
                throw new Error('CURRENT_SONG: Choose another track before removing this one.')
              if (!command.songId) throw new Error('SONG_ID_REQUIRED')
              player.removeSongFromQueue(command.songId)
              break
            }
            case 'mode':
              if (command.shuffle !== undefined && command.shuffle !== player.isShuffle)
                player.toggleShuffle()
              if (command.repeat !== undefined) {
                for (
                  let i = 0;
                  i < 3 && usePlayerStore.getState().repeatMode !== command.repeat;
                  i++
                )
                  player.toggleRepeat()
              }
              break
            case 'create-room':
            case 'ensureRoom': {
              const listening = useListeningStore.getState()
              const online = useOnlineStore.getState()
              if (!online.user) {
                result = { ok: false, error: 'NOT_LOGGED_IN', message: 'You must be signed in to host a party room.' }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }
              let room = listening.hostRoom
              if (!room || !room.code || !room.is_active || command.forceNew) {
                room = await listening.ensureHostRoom(true, Boolean(command.forceNew), command.preferredCode)
              }
              const code = room?.code || null
              const name = room?.name || command.name || 'Listen Together'
              const members = listening.memberCount || 1
              const shareUrl = code ? `https://felo.feloapp.workers.dev/#/online/listen?code=${code}` : null
              if (code) {
                window.api?.updateDiscordRoomInfo?.({ code, name, members })
              }
              result = { ok: Boolean(code), code, name, members, shareUrl, state: publish() }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'join-room': {
              const listening = useListeningStore.getState()
              const online = useOnlineStore.getState()
              if (!online.user) {
                result = { ok: false, error: 'NOT_LOGGED_IN', message: 'You must be signed in to join a room.' }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }
              const code = (command.code || command.query || '').trim().toUpperCase()
              const roomId = command.roomId
              if (!code && !roomId) {
                result = { ok: false, error: 'ROOM_CODE_REQUIRED', message: 'Provide a 6-letter room code to join.' }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }
              try {
                let room: any = null
                if (code) {
                  room = await listening.joinRoomByCode(code)
                } else if (roomId) {
                  room = await listening.joinRoomById(roomId)
                }
                result = {
                  ok: Boolean(room),
                  code: room?.code || code,
                  name: room?.name || 'Listen Together',
                  host_id: room?.host_id,
                  members: listening.memberCount || 1,
                  state: publish()
                }
              } catch (err: any) {
                const isNotFound =
                  err?.code === 'ROOM_NOT_FOUND' ||
                  err?.name === 'RoomNotFoundError' ||
                  err?.message?.toLowerCase().includes('not found') ||
                  err?.message?.toLowerCase().includes('no longer active')
                result = {
                  ok: false,
                  error: isNotFound ? 'ROOM_NOT_FOUND' : (err?.message || 'JOIN_ROOM_FAILED'),
                  message: err?.message || 'Could not find or join the specified listening room.'
                }
              }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'join-friend': {
              const listening = useListeningStore.getState()
              const online = useOnlineStore.getState()
              if (!online.user) {
                result = { ok: false, error: 'NOT_LOGGED_IN', message: 'You must be signed in to connect to friends.' }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }
              const friendQuery = String(command.friendName || command.query || '').trim().toLowerCase()
              let targetFriendId = command.friendId
              let targetFriendName = ''

              const directChat = useDirectChatStore.getState()
              let friendsList = directChat.friends || []
              if (friendsList.length === 0 && directChat.loadFriends) {
                await directChat.loadFriends()
                friendsList = useDirectChatStore.getState().friends || []
              }

              if (!targetFriendId && friendQuery) {
                const match = friendsList.find(
                  (f) =>
                    f.id.toLowerCase() === friendQuery ||
                    f.username?.toLowerCase() === friendQuery ||
                    f.display_name?.toLowerCase() === friendQuery ||
                    f.username?.toLowerCase().includes(friendQuery) ||
                    f.display_name?.toLowerCase().includes(friendQuery)
                )
                if (match) {
                  targetFriendId = match.id
                  targetFriendName = match.display_name || match.username
                }
              }

              if (!targetFriendId) {
                result = {
                  ok: false,
                  error: 'FRIEND_NOT_FOUND',
                  message: `Could not find a friend matching "${friendQuery || 'unknown'}".`,
                  availableFriends: friendsList.map((f) => ({ id: f.id, username: f.username, displayName: f.display_name }))
                }
                window.api.respondToExternalPlayerCommand(requestId, result)
                return
              }

              try {
                const room = await listening.listenAlongWithFriend(targetFriendId)
                result = {
                  ok: Boolean(room),
                  friend: { id: targetFriendId, name: targetFriendName },
                  code: room?.code,
                  name: room?.name,
                  host_id: room?.host_id,
                  members: listening.memberCount || 1,
                  state: publish()
                }
              } catch (err: any) {
                const isNotFound =
                  err?.code === 'ROOM_NOT_FOUND' ||
                  err?.name === 'RoomNotFoundError' ||
                  err?.message?.toLowerCase().includes('not in an active party') ||
                  err?.message?.toLowerCase().includes('no longer active')
                result = {
                  ok: false,
                  error: isNotFound ? 'ROOM_NOT_FOUND' : (err?.message || 'LISTEN_ALONG_FAILED'),
                  message: err?.message || 'This friend is not in an active party room right now.',
                  friend: { id: targetFriendId, name: targetFriendName }
                }
              }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'leave-room': {
              const listening = useListeningStore.getState()
              if (listening.joinedRoom) {
                try {
                  await listening.leaveJoinedRoom()
                } catch {
                  listening.cleanupOnLeave()
                }
              } else if (listening.hostRoom) {
                await listening.deactivateHostRoom?.()
              }
              result = { ok: true, state: publish() }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            case 'room-status': {
              const listening = useListeningStore.getState()
              const online = useOnlineStore.getState()
              const directChat = useDirectChatStore.getState()
              const activeRoom = listening.joinedRoom || listening.hostRoom
              result = {
                ok: true,
                user: online.user ? { id: online.user.id, email: online.user.email } : null,
                inRoom: Boolean(activeRoom && activeRoom.is_active),
                isHost: Boolean(listening.hostRoom || (listening.joinedRoom && listening.joinedRoom.host_id === online.user?.id)),
                code: activeRoom?.code || null,
                name: activeRoom?.name || null,
                members: listening.memberCount || 0,
                friends: (directChat.friends || []).slice(0, 15).map((f) => ({
                  id: f.id,
                  username: f.username,
                  displayName: f.display_name,
                  inParty: Boolean(listening.liveFriendRooms?.[f.id])
                })),
                state: publish()
              }
              window.api.respondToExternalPlayerCommand(requestId, result)
              return
            }
            default:
              throw new Error('UNKNOWN_COMMAND')
          }
          if (verifyPlayback) {
            // Allow React a brief tick to process the state change before inspecting audio
            await new Promise((r) => setTimeout(r, 60))
            const getLiveAudio = (): HTMLAudioElement =>
              (getActiveAudioElement() ?? document.querySelector('audio') ?? currentAudio) as HTMLAudioElement

            // Reconcile browser audio with the requested store state, including replay.
            await waitFor(() => usePlayerStore.getState().seekRequest === null)
            const liveAudioStart = getLiveAudio()
            if (liveAudioStart.paused) {
              checkDeadline()
              void liveAudioStart.play().catch(() => undefined)
            }
            const position = liveAudioStart.currentTime
            await waitFor(() => {
              const liveAudio = getLiveAudio()
              if (liveAudio.error) throw new Error('PLAYBACK_FAILED')
              const state = snapshot()
              const isCorrectSong = !expectedSongId || state.song?.id === expectedSongId

              // Condition A: audio is audibly playing and data is ready
              const isReadyAndPlaying =
                !liveAudio.paused &&
                liveAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              // Condition B: audio is progressing (position moved), means play() succeeded
              const isProgressing =
                liveAudio.currentTime > position + 0.01 || liveAudio.currentTime > 0.01
              // Condition C: track is transitioning/buffering — store confirms playing + correct song
              const isActivelyBuffering =
                state.isPlaying &&
                isCorrectSong &&
                !liveAudio.error &&
                (usePlayerStore.getState().isBuffering ||
                  liveAudio.readyState >= HTMLMediaElement.HAVE_METADATA ||
                  liveAudio.networkState === HTMLMediaElement.NETWORK_LOADING ||
                  liveAudio.seeking)

              // Nudge play if paused during transition once metadata is present
              if (liveAudio.paused && !liveAudio.seeking && liveAudio.readyState >= HTMLMediaElement.HAVE_METADATA) {
                void liveAudio.play().catch(() => undefined)
              }

              return (
                state.isPlaying &&
                isCorrectSong &&
                (isProgressing || isReadyAndPlaying || isActivelyBuffering)
              )
            })
          }
          // If the user is the HOST of a room:
          // Immediately broadcast the updated playback state to all room members
          if (isHost && !['queue', 'volume'].includes(command.type)) {
            void listeningState.ensureHostRoom(true).catch(() => undefined)
          }

          const state = publish()
          result = { ok: true, state, warnings: state.warnings }
        } catch (error) {
          // Only pause playback if there is an explicit fatal audio error (bad codec, 404 file).
          // Never cancel playback just because a network buffer / verify took longer than the deadline.
          const current = usePlayerStore.getState()
          const liveAudio = getActiveAudioElement() ?? document.querySelector('audio')
          if (!disposed && verifyPlayback && liveAudio?.error && current.queue[current.currentSongIndex]?.id === expectedSongId) {
            current.setIsPlaying(false)
            liveAudio.pause()
          }
          result = {
            ok: false,
            error: error instanceof Error ? error.message : 'PLAYBACK_FAILED',
            state: publish()
          }
        }
        if (!disposed) window.api.respondToExternalPlayerCommand(requestId, result)
        })()
      }
    )
    publish()
    const interval = window.setInterval(publish, 1000)
    return () => {
      disposed = true
      window.clearInterval(interval)
      unsubscribeStore()
      unsubscribeListeningStore()
      unsubscribePrivateStore()
      audioEvents.forEach((event) => audio?.removeEventListener(event, onAudioChange))
      removeCommandListener()
    }
  }, [])
  return null
}
