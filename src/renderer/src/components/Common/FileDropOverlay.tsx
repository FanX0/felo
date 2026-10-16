import { useEffect, useState, useRef } from 'react'
import { Music, UploadCloud } from 'lucide-react'
import { usePlayerStore } from '../../hooks/usePlayerStore'
import {
  extractAudioFilesFromDataTransfer,
  partitionAudioFileCandidates,
  stripRecognizedAudioFileExtension
} from '../../lib/audioFile'
import { registerLocalSlotPoolFile, registerLocalSlotPoolPath } from '../../lib/jitAudioPipeline'
import type { Song } from '../../pages/Library/Library'

export default function FileDropOverlay() {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)
  const watchdogTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      // If the drag event is targeting a specific in-page dropzone (e.g. library dropzone in Settings), avoid overlaying
      if ((e.target as HTMLElement)?.closest?.('[data-library-drop-zone]')) return
      e.preventDefault()
      dragCounterRef.current += 1

      if (dragCounterRef.current === 1) {
        setIsDraggingOver(true)
      }

      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current)
      }
      watchdogTimerRef.current = window.setTimeout(() => {
        dragCounterRef.current = 0
        setIsDraggingOver(false)
      }, 1500)
    }

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      if ((e.target as HTMLElement)?.closest?.('[data-library-drop-zone]')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'

      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current)
      }
      watchdogTimerRef.current = window.setTimeout(() => {
        dragCounterRef.current = 0
        setIsDraggingOver(false)
      }, 1500)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)

      if (dragCounterRef.current === 0) {
        setIsDraggingOver(false)
      }
    }

    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      // If target is inside an explicit in-page drop container or already handled, yield to it
      if (e.defaultPrevented || (e.target as HTMLElement)?.closest?.('[data-library-drop-zone]')) {
        dragCounterRef.current = 0
        setIsDraggingOver(false)
        return
      }

      e.preventDefault()
      dragCounterRef.current = 0
      setIsDraggingOver(false)

      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current)
        watchdogTimerRef.current = null
      }

      try {
        const { files, folderName } = await extractAudioFilesFromDataTransfer(e.dataTransfer)
        const { accepted: audioFiles } = partitionAudioFileCandidates(files)
        if (audioFiles.length === 0) return

        // Also index into local library so songs persist and appear in Library tab
        if (window.api?.scanFiles) {
          try {
            await window.api.scanFiles(audioFiles, folderName || 'Dropped Audio')
          } catch (scanErr) {
            console.warn('Failed to scan dropped audio files into library:', scanErr)
          }
        }

        const newSongs: Song[] = audioFiles.map((file, idx) => {
          const cleanTitle = stripRecognizedAudioFileExtension(file.name)
          const audioBlobUrl = URL.createObjectURL(file)
          const filePath = (file as any).path || audioBlobUrl
          const songId = `dropped-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`

          registerLocalSlotPoolFile(songId, file)
          if ((file as any).path) {
            registerLocalSlotPoolPath(songId, (file as any).path)
          }

          return {
            id: songId,
            title: cleanTitle,
            artist: 'Local File',
            album: folderName || 'Dropped Audio',
            duration: 0,
            filePath: filePath,
            audioUrl: audioBlobUrl,
            dateAdded: Date.now()
          }
        })

        // Load into queue and start playing the first dropped song immediately
        usePlayerStore.getState().setQueue(newSongs, 0, {
          type: 'library',
          title: folderName || 'Dropped Files'
        })
      } catch (err) {
        console.error('Failed to handle dropped files in FileDropOverlay:', err)
      }
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      if (watchdogTimerRef.current !== null) {
        window.clearTimeout(watchdogTimerRef.current)
      }
    }
  }, [])

  if (!isDraggingOver) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md p-6 pointer-events-none select-none animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg aspect-[16/10] rounded-3xl border-2 border-dashed border-emerald-500/80 bg-emerald-950/20 shadow-[0_0_50px_rgba(16,185,129,0.25)] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 animate-bounce">
          <UploadCloud className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-white tracking-wide">
          Drop audio files or folders to play in Felo
        </h3>
        <p className="text-sm text-emerald-300/80 mt-1.5 max-w-sm">
          Supports MP3, FLAC, WAV, AAC, OGG, Opus, M4A, and nested music folders.
        </p>
        <div className="flex items-center gap-1.5 mt-4 text-[11px] font-mono text-emerald-400/70 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          <Music className="w-3.5 h-3.5" />
          <span>Felo Local-First Player</span>
        </div>
      </div>
    </div>
  )
}
