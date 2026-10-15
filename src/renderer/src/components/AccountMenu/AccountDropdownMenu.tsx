import { type ReactElement, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User,
  Settings as SettingsIcon,
  Radio,
  EyeOff,
  LogOut,
  LogIn
} from 'lucide-react'
import { useOnlineStore } from '../../hooks/useOnlineStore'
import { usePrivateSessionStore } from '../../hooks/usePrivateSessionStore'
import { cn } from '../../lib/utils'

interface AccountDropdownMenuProps {
  isOpen: boolean
  onClose: () => void
  isMobile?: boolean
  className?: string
}

export default function AccountDropdownMenu({
  isOpen,
  onClose,
  isMobile = false,
  className
}: AccountDropdownMenuProps): ReactElement | null {
  const navigate = useNavigate()
  const { configured, initialized, user, profile, signOut } = useOnlineStore()
  const isPrivateSession = usePrivateSessionStore((s) => s.isPrivateSession)
  const togglePrivateSession = usePrivateSessionStore((s) => s.togglePrivateSession)
  const getRemainingTimeMs = usePrivateSessionStore((s) => s.getRemainingTimeMs)

  const [remainingTimeStr, setRemainingTimeStr] = useState<string | null>(null)

  useEffect(() => {
    if (!isPrivateSession) {
      setRemainingTimeStr(null)
      return
    }
    const updateTime = () => {
      const ms = getRemainingTimeMs()
      if (ms === null) {
        setRemainingTimeStr(null)
        return
      }
      const totalMinutes = Math.floor(ms / 60000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      setRemainingTimeStr(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`)
    }
    updateTime()
    const interval = setInterval(updateTime, 30_000)
    return () => clearInterval(interval)
  }, [isPrivateSession, getRemainingTimeMs])

  if (!isOpen) return null

  const handleNavigate = (path: string) => {
    onClose()
    navigate(path)
  }

  const handleSignOut = async () => {
    onClose()
    try {
      await signOut()
      navigate('/')
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  const menuContent = (
    <div
      role="menu"
      className={cn(
        'bg-surface-elevated border border-border rounded-xl shadow-2xl py-1.5 z-[100] animate-in fade-in select-none',
        isMobile
          ? 'fixed top-[calc(3.5rem+env(safe-area-inset-top,0px)+6px)] right-3 w-64 z-[60] slide-in-from-top-2 duration-150'
          : 'absolute right-0 top-full mt-2 w-56 slide-in-from-top-1',
        className
      )}
    >
      {/* User Info Header */}
      <div className="px-4 py-3 border-b border-border/80">
        <p className="truncate text-sm font-bold text-text">
          {profile?.display_name || (user ? 'Online profile' : 'Local listener')}
        </p>
        <p className="truncate text-xs text-text-muted">
          {user?.email || (configured && initialized ? 'Not signed in' : 'Local account')}
        </p>
      </div>

      <div className="py-1">
        <button
          type="button"
          onClick={() => handleNavigate(user ? '/profile' : '/account')}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors cursor-pointer text-left"
        >
          {user ? <User className="w-4 h-4 shrink-0" /> : <LogIn className="w-4 h-4 shrink-0" />}
          <span>{user ? 'Profile' : 'Sign in'}</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigate('/settings')}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors cursor-pointer text-left"
        >
          <SettingsIcon className="w-4 h-4 shrink-0" />
          <span>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => handleNavigate('/remote')}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors cursor-pointer text-left"
        >
          <Radio className="w-4 h-4 shrink-0" />
          <span>Remote control (PC)</span>
        </button>

        <button
          type="button"
          onClick={() => togglePrivateSession()}
          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-text-muted hover:bg-hover hover:text-text transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-3">
            <EyeOff className="w-4 h-4 shrink-0" />
            <span className="text-left">
              <span>Private session</span>
              {isPrivateSession && remainingTimeStr && (
                <span className="block text-[10px] text-primary-amber font-normal">
                  {remainingTimeStr} remaining
                </span>
              )}
            </span>
          </span>
          <div
            className={cn(
              'w-9 h-5 rounded-full transition-colors relative shrink-0',
              isPrivateSession ? 'bg-primary-amber' : 'bg-border'
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                isPrivateSession ? 'translate-x-4' : 'translate-x-0.5'
              )}
            />
          </div>
        </button>
      </div>

      {user && (
        <div className="border-t border-border/80 py-1">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 transition-colors cursor-pointer text-left font-semibold"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Log out</span>
          </button>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <>
        {/* Backdrop for tapping outside on mobile */}
        <div
          className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150"
          onClick={onClose}
          onTouchStart={onClose}
          aria-hidden="true"
        />
        {menuContent}
      </>
    )
  }

  return menuContent
}
