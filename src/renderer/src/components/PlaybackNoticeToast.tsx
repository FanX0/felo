import { useEffect, useState, type ReactElement } from 'react'
import { AlertCircle, Bot, CheckCircle2, Download, EyeOff, Laptop2, X } from 'lucide-react'

interface NoticeMessage {
  id: string
  title?: string
  artist?: string
  message: string
  type?:
    | 'unavailable'
    | 'bot'
    | 'download'
    | 'completed'
    | 'skip'
    | 'volume'
    | 'private_session'
    | 'device_switch'
}

export default function PlaybackNoticeToast(): ReactElement | null {
  const [notice, setNotice] = useState<NoticeMessage | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const handleUnavailable = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.message) return

      setNotice({
        id: String(Date.now()),
        title: detail.title,
        artist: detail.artist,
        message: detail.message,
        type: 'unavailable'
      })

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setNotice(null)
      }, 4500)
    }

    const handleBotActivity = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.message) return

      setNotice({
        id: String(Date.now()),
        title: detail.title || 'Discord Bot Action',
        artist: detail.artist,
        message: detail.message,
        type: detail.type || 'bot'
      })

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setNotice(null)
      }, 5500)
    }

    const handlePrivateSessionToast = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.message) return

      setNotice({
        id: String(Date.now()),
        title: detail.title || 'Private Session',
        message: detail.message,
        type: 'private_session'
      })

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setNotice(null)
      }, 5000)
    }

    const handleDeviceToast = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (!detail?.message) return

      setNotice({
        id: String(Date.now()),
        title: detail.title || 'Switched to This Device',
        message: detail.message,
        type: 'device_switch'
      })

      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setNotice(null)
      }, 3500)
    }

    window.addEventListener('felo:track-unavailable', handleUnavailable)
    window.addEventListener('fanxmusic:track-unavailable', handleUnavailable)
    window.addEventListener('felo:bot-activity', handleBotActivity)
    window.addEventListener('felo:private-session-toast', handlePrivateSessionToast)
    window.addEventListener('felo:device-toast', handleDeviceToast)

    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('felo:track-unavailable', handleUnavailable)
      window.removeEventListener('fanxmusic:track-unavailable', handleUnavailable)
      window.removeEventListener('felo:bot-activity', handleBotActivity)
      window.removeEventListener('felo:private-session-toast', handlePrivateSessionToast)
      window.removeEventListener('felo:device-toast', handleDeviceToast)
    }
  }, [])

  if (!notice) return null

  const isDeviceSwitch = notice.type === 'device_switch'
  const isDownload = notice.type === 'download'
  const isCompleted = notice.type === 'completed'
  const isBot = notice.type === 'bot' || notice.type === 'skip' || notice.type === 'volume'
  const isPrivateSession = notice.type === 'private_session'

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-24 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-border bg-surface-elevated p-4 text-text shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      {isDeviceSwitch ? (
        <Laptop2 className="h-5 w-5 shrink-0 text-primary mt-0.5" />
      ) : isPrivateSession ? (
        <EyeOff className="h-5 w-5 shrink-0 text-text-muted mt-0.5" />
      ) : isDownload ? (
        <Download className="h-5 w-5 shrink-0 text-primary mt-0.5 animate-pulse" />
      ) : isCompleted ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary mt-0.5" />
      ) : isBot ? (
        <Bot className="h-5 w-5 shrink-0 text-primary mt-0.5" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0 text-primary mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-text">
          {notice.title ? notice.title : 'Playback Notice'}
        </p>
        <p className="text-[11px] text-text-muted leading-snug mt-0.5 line-clamp-2">
          {notice.message}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="text-zinc-400 hover:text-white transition-colors p-0.5 -mr-1 cursor-pointer"
        title="Dismiss notice"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

