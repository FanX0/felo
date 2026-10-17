import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  HardDrive,
  FolderOpen,
  FolderPlus,
  UploadCloud,
  RefreshCw,
  X,
  Loader2,
  Music,
  Trash2
} from 'lucide-react'
import { useLibraryScanStore } from '../../../hooks/useLibraryScanStore'
import { isElectron } from '../../../lib/appConfig'
import {
  extractAudioFilesFromDataTransfer,
  AUDIO_FILE_ACCEPT,
  partitionAudioFileCandidates
} from '../../../lib/audioFile'
import { SettingsSection } from '../components/SettingsSection'
import type { LibraryRoot } from '../types'

interface LibrarySectionProps {
  roots: LibraryRoot[]
  loadRoots: () => Promise<void>
}

export function LibrarySection({ roots, loadRoots }: LibrarySectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [isDraggingOverLibrary, setIsDraggingOverLibrary] = useState(false)
  const { isScanning, progress: scanProgress, cancelScan } = useLibraryScanStore()

  const setFolderInputRef = (element: HTMLInputElement | null) => {
    folderInputRef.current = element
    if (element) {
      element.setAttribute('webkitdirectory', '')
      element.setAttribute('directory', '')
      element.setAttribute('mozdirectory', '')
      ;(element as any).webkitdirectory = true
      ;(element as any).directory = true
      ;(element as any).mozdirectory = true
    }
  }

  const handleUploadFilesClick = () => {
    fileInputRef.current?.click()
  }

  const handleUploadFolderClick = () => {
    if (isElectron) {
      void handleAddFolder()
      return
    }
    // On web, trigger directory input synchronously to preserve transient user activation
    folderInputRef.current?.click()
  }

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const rawFiles = event.target.files
    if (!rawFiles || rawFiles.length === 0) return
    try {
      const { accepted, rejected } = partitionAudioFileCandidates(rawFiles)
      if (accepted.length === 0) {
        if (rejected.length > 0) alert('No supported audio files selected.')
        return
      }
      if (window.api?.scanFiles) {
        await window.api.scanFiles(accepted, 'Uploaded Music')
      } else if (window.api?.selectFiles) {
        const folderToken = await window.api.selectFiles()
        if (folderToken) await window.api.scanLibrary(folderToken)
      }
      await loadRoots()
    } catch (err) {
      console.error('Failed to upload audio files in Settings:', err)
    } finally {
      event.target.value = ''
    }
  }

  const handleFolderInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const rawFiles = event.target.files
    if (!rawFiles || rawFiles.length === 0) return
    try {
      const { accepted, rejected } = partitionAudioFileCandidates(rawFiles)
      if (accepted.length === 0) {
        if (rejected.length > 0) alert('No supported audio files found in the selected folder.')
        return
      }
      const firstRelPath = (accepted[0] as File & { webkitRelativePath?: string }).webkitRelativePath
      const folderName =
        firstRelPath && firstRelPath.includes('/')
          ? firstRelPath.split('/')[0]
          : 'Uploaded Folder'

      if (window.api?.scanFiles) {
        await window.api.scanFiles(accepted, folderName)
      } else if (window.api?.selectFiles) {
        const folderToken = await window.api.selectFiles()
        if (folderToken) await window.api.scanLibrary(folderToken)
      }
      await loadRoots()
    } catch (err) {
      console.error('Failed to upload music folder in Settings:', err)
    } finally {
      event.target.value = ''
    }
  }

  const handleLibraryDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOverLibrary(true)
  }

  const handleLibraryDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOverLibrary(false)
  }

  const handleLibraryDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingOverLibrary(false)
    try {
      const { files, folderName } = await extractAudioFilesFromDataTransfer(e.dataTransfer)
      const { accepted } = partitionAudioFileCandidates(files)
      if (accepted.length === 0) return
      if (window.api?.scanFiles) {
        await window.api.scanFiles(accepted, folderName)
        await loadRoots()
      }
    } catch (err) {
      console.error('Failed to drop audio files in Settings:', err)
    }
  }

  const handleAddFolder = async () => {
    try {
      if (!window.api?.selectFolder) return
      let folderPath: string | null = null
      try {
        folderPath = await window.api.selectFolder()
      } catch (selectErr) {
        console.warn('Folder selection error in Settings:', selectErr)
      }
      if (folderPath) {
        await window.api.scanLibrary(folderPath)
        await loadRoots()
      }
    } catch (err) {
      console.error('Error adding folder in Settings:', err)
    }
  }

  const handleRemoveRoot = async (rootId: string) => {
    if (confirm('Remove this folder from your library? (Your music files will NOT be deleted).')) {
      try {
        await window.api.removeLibraryRoot(rootId)
        await loadRoots()
      } catch (err) {
        console.error('Failed to remove root:', err)
      }
    }
  }

  const handleRescanRoot = async (rootPath: string) => {
    try {
      await window.api.scanLibrary(rootPath)
      await loadRoots()
    } catch (err) {
      console.error('Rescan failed:', err)
    }
  }

  return (
    <SettingsSection
      icon={<HardDrive className="w-5 h-5" />}
      title="Library Sources"
      description="Manage the music folders on your device that Felo indexes and plays."
    >
      <div className="flex items-center justify-end gap-2.5 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={AUDIO_FILE_ACCEPT}
          className="hidden"
          onChange={handleFileInputChange}
        />
        <input
          ref={setFolderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '', mozdirectory: '' } as any)}
          className="hidden"
          onChange={handleFolderInputChange}
        />
        <button
          type="button"
          onClick={handleUploadFilesClick}
          disabled={isScanning}
          className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-white/90 rounded-full text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
        >
          <FolderOpen className="w-4 h-4 text-primary" />
          <span>Upload Music</span>
        </button>
        <button
          type="button"
          onClick={handleUploadFolderClick}
          disabled={isScanning}
          className="flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-border rounded-full text-xs font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Scanning {scanProgress?.percent !== undefined ? `${scanProgress.percent}%` : ''}</span>
            </>
          ) : (
            <>
              <FolderPlus className="w-4 h-4" />
              <span>{isElectron ? 'Add Music Folder' : 'Upload Folder'}</span>
            </>
          )}
        </button>
      </div>

      {isScanning && scanProgress && (
        <div className="mb-4 rounded-xl bg-surface border border-white/20 p-4 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between pb-2 border-b border-border/20">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-white/10 text-white border border-white/20">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    {scanProgress.status === 'discovering'
                      ? 'Discovering Files...'
                      : scanProgress.status === 'committing'
                        ? 'Saving to Database...'
                        : 'Indexing Music Folder'}
                  </h4>
                  <span className="text-xs font-mono font-bold text-white px-2 py-0.5 rounded-full bg-white/10 border border-white/20 tabular-nums">
                    {scanProgress.percent}%
                  </span>
                </div>
                <p className="text-xs text-text-muted truncate mt-0.5" title={scanProgress.folderPath}>
                  {scanProgress.folderName} •{' '}
                  <span className="text-white font-medium tabular-nums">
                    {scanProgress.processedFiles} / {scanProgress.totalFiles} songs
                  </span>
                  {scanProgress.speed ? ` • ~${scanProgress.speed} songs/s` : ''}
                  {scanProgress.estimatedRemainingMs ? ` • ~${Math.round(scanProgress.estimatedRemainingMs / 1000)}s left` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => cancelScan()}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-danger hover:bg-danger/90 text-white text-xs font-bold transition-all shadow-sm"
            >
              <X className="h-3 w-3" /> Stop
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#242424]">
              <div
                className="h-full bg-white transition-all duration-200"
                style={{ width: `${Math.max(2, scanProgress.percent)}%` }}
              />
            </div>
            {(scanProgress.currentTrack || scanProgress.currentFile) && (
              <div className="flex items-center gap-1.5 text-[11px] text-text-muted truncate">
                <Music className="w-3 h-3 text-white shrink-0 animate-pulse" />
                <span className="truncate">
                  {scanProgress.currentTrack
                    ? `${scanProgress.currentTrack.artist} - ${scanProgress.currentTrack.title}`
                    : scanProgress.currentFile}
                </span>
              </div>
            )}
          </div>

          <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-muted border-t border-border/15 pt-2">
            <span>Added: <strong className="text-white">{scanProgress.addedCount}</strong></span>
            <span>Updated: <strong className="text-white">{scanProgress.updatedCount}</strong></span>
            <span>Cached: <strong className="text-white">{scanProgress.skippedCount}</strong></span>
          </div>
        </div>
      )}

      <div
        data-library-drop-zone="true"
        onDragOver={handleLibraryDragOver}
        onDragLeave={handleLibraryDragLeave}
        onDrop={handleLibraryDrop}
        className={`divide-y divide-border/10 rounded-xl transition-all ${
          isDraggingOverLibrary ? 'ring-2 ring-primary/50 bg-primary/5 p-2' : ''
        }`}
      >
        {roots.length === 0 ? (
          <div
            className={`my-3 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-7 text-center transition-all ${
              isDraggingOverLibrary
                ? 'border-primary bg-primary/10 scale-[1.01]'
                : 'border-border/40 bg-surface/20 hover:border-border/80'
            }`}
          >
            <div className="mb-3 rounded-full bg-surface-elevated p-3 text-text-muted border border-border/30">
              <UploadCloud className="h-6 w-6 text-primary" />
            </div>
            <h4 className="text-sm font-bold text-text mb-1">
              No music library added yet
            </h4>
            <p className="text-xs text-text-muted max-w-sm mb-4">
              Upload audio tracks or add a local music folder to index and play your songs in this browser.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={handleUploadFilesClick}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-white/90 rounded-full text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4 text-primary" />
                <span>Upload Music Files</span>
              </button>
              <button
                type="button"
                onClick={handleUploadFolderClick}
                disabled={isScanning}
                className="flex items-center gap-2 px-4 py-2 bg-surface-elevated border border-white/20 text-white rounded-full text-xs font-bold hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                <FolderPlus className="w-4 h-4" />
                <span>{isElectron ? 'Select Folder' : 'Upload Folder'}</span>
              </button>
            </div>
            <p className="text-[11px] text-text-muted mt-3">
              Or drag & drop music folders or audio files (.mp3, .flac, .wav, .m4a, .ogg) directly here
            </p>
          </div>
        ) : (
          roots.map((root) => {
            const isThisRootScanning = isScanning && scanProgress?.folderPath === root.path
            return (
              <div key={root.id} className="py-3 flex items-center justify-between gap-4 group">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-text truncate">{root.path}</span>
                  <span className="text-[11px] text-text-muted">
                    {root.songCount !== undefined ? `${root.songCount} songs • ` : ''}
                    Added {new Date(root.dateAdded * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isThisRootScanning ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/20 bg-white/10 text-white text-xs font-semibold tabular-nums">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{scanProgress?.percent}%</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRescanRoot(root.path)}
                      disabled={isScanning}
                      title="Rescan this folder"
                      className="p-2 hover:bg-hover rounded-full border border-border text-text-muted hover:text-text transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveRoot(root.id)}
                    disabled={isScanning}
                    title="Remove folder"
                    className="p-2 hover:bg-red-500/20 rounded-full border border-border text-text-muted hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </SettingsSection>
  )
}
