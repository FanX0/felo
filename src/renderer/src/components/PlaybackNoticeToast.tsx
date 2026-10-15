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
        title: detail.title || '🤖 Discord Bot Action',
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

  const borderClass = isDeviceSwitch
    ? 'border-emerald-500/50 bg-[#062c1e]/95 shadow-emerald-950/40'
    : isPrivateSession
    ? 'border-amber-500/50 bg-[#1c1409]/95 shadow-amber-950/40'
    : isDownload
    ? 'border-sky-500/40 bg-[#0c192c]/95 shadow-sky-950/40'
    : isCompleted
    ? 'border-emerald-500/40 bg-[#062c1e]/95 shadow-emerald-950/40'
    : isBot
    ? 'border-[#5865F2]/40 bg-[#14172e]/95 shadow-[#5865F2]/20'
    : 'border-amber-500/30 bg-[#1c1917]/95 shadow-amber-950/30'

  const titleClass = isDeviceSwitch
    ? 'text-emerald-300'
    : isPrivateSession
    ? 'text-amber-400'
    : isDownload
    ? 'text-sky-300'
    : isCompleted
    ? 'text-emerald-300'
    : isBot
    ? 'text-indigo-300'
    : 'text-amber-300'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-24 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200 ${borderClass}`}
    >
      {isDeviceSwitch ? (
        <Laptop2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
      ) : isPrivateSession ? (
        <EyeOff className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
      ) : isDownload ? (
        <Download className="h-5 w-5 shrink-0 text-sky-400 mt-0.5 animate-pulse" />
      ) : isCompleted ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
      ) : isBot ? (
        <Bot className="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${titleClass}`}>
          {notice.title ? notice.title : 'Playback Notice'}
        </p>
        <p className="text-[11px] text-zinc-300 leading-snug mt-0.5 line-clamp-2">
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

