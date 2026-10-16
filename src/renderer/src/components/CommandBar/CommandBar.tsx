import { useState, useRef, useEffect } from 'react'
import { Search, ChevronLeft, ChevronRight, Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import NotificationDropdown from '../Notifications/NotificationDropdown'
import { useNotificationStore } from '../../stores/useNotificationStore'

export default function CommandBar() {
  const navigate = useNavigate()
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)
  const notificationRef = useRef<HTMLDivElement>(null)
  const unreadNotificationCount = useNotificationStore(
    (s) => s.invitations.length + s.incomingFriendRequests.length
  )

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setIsNotificationOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="h-14 bg-canvas border-b border-border flex items-center px-4 justify-between draggable-header shrink-0 z-10">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-hover text-text-muted hover:text-text transition-colors no-drag cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => navigate(1)}
          className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-hover text-text-muted hover:text-text transition-colors no-drag cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 max-w-xl mx-4 relative no-drag">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
          <Search className="w-4 h-4" />
        </div>
        <input
          type="text"
          placeholder="Search library or type a command... (Ctrl+K)"
          className="w-full h-9 bg-surface border border-border rounded-full pl-9 pr-4 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/40 transition-all"
        />
      </div>

      <div className="flex items-center gap-3 no-drag">
        <div ref={notificationRef} className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationOpen((prev) => !prev)}
            title={unreadNotificationCount > 0 ? `Notifications (${unreadNotificationCount} new)` : 'Notifications'}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-hover text-text-muted hover:text-text transition-colors relative cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 bg-danger text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-canvas shadow-xs">
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
          </button>

          <NotificationDropdown
            isOpen={isNotificationOpen}
            onClose={() => setIsNotificationOpen(false)}
            isMobile={false}
          />
        </div>

        <div className="h-8 w-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text text-sm font-bold shadow-sm">
          F
        </div>
      </div>
    </div>
  )
}

