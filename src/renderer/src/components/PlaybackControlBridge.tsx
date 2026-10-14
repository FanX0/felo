import { useEffect } from 'react'
import { usePlayerStore } from '../hooks/usePlayerStore'
import { useListeningStore } from '../hooks/useListeningStore'
import { useOnlineStore } from '../hooks/useOnlineStore'
import type { Song } from '../pages/Library/Library'

type Command = {
  requestId: string
  deadline: number
  command: {
    type: string
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
        artworkPath: song.artworkPath
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
      const audio = document.querySelector('audio')
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
        )
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
          const domAudio = document.querySelector('audio')
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
              if (!song?.id || !song.filePath || song.filePath.startsWith('virtual:'))
                throw new Error('SONG_NOT_PLAYABLE')
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
            default:
              throw new Error('UNKNOWN_COMMAND')
          }
          if (verifyPlayback) {
            // Reconcile browser audio with the requested store state, including replay.
            await waitFor(() => usePlayerStore.getState().seekRequest === null)
            if (currentAudio.paused) {
              checkDeadline()
              void currentAudio.play().catch(() => undefined)
            }
            const position = currentAudio.currentTime
            await waitFor(() => {
              if (currentAudio.error) throw new Error('PLAYBACK_FAILED')
              const state = snapshot()
              const isProgressing =
                currentAudio.currentTime > position + 0.01 || currentAudio.currentTime > 0.01
              const isReadyAndPlaying =
                !currentAudio.paused &&
                currentAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
              return (
                state.isPlaying &&
                !currentAudio.seeking &&
                (!expectedSongId || state.song?.id === expectedSongId) &&
                (isProgressing || isReadyAndPlaying)
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
          // Cancel pending audio.play() so a timed-out load cannot start later.
          const current = usePlayerStore.getState()
          if (!disposed && verifyPlayback && current.queue[current.currentSongIndex]?.id === expectedSongId) {
            current.setIsPlaying(false)
            document.querySelector('audio')?.pause()
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
      audioEvents.forEach((event) => audio?.removeEventListener(event, onAudioChange))
      removeCommandListener()
    }
  }, [])
  return null
}
