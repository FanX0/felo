import { useState, useEffect } from 'react'
import { cn } from '../../lib/utils'
import type { Song } from '../../types'
import AddToPlaylistPopover from './AddToPlaylistPopover'

interface SongAddButtonProps {
  song: Song
  className?: string
  size?: 'sm' | 'md' | 'lg'
  alwaysVisible?: boolean
  onToggle?: (isFav: boolean) => void
}

/**
 * Spotify Encore-style Checked / In Library icon.
 * Pure vector with Spotify green (#1ed760) and high-contrast deep black (#121212) checkmark.
 */
function CheckedIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('shrink-0 fill-none', className)}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="8"
        fill="#1ed760"
        className="transition-colors duration-150 group-hover/add-btn:fill-[#1fdf64]"
      />
      <path
        d="M11.748 6.205a.75.75 0 0 0-1.06-1.06L7.427 8.406 5.86 6.84a.75.75 0 1 0-1.06 1.06l2.096 2.096a.75.75 0 0 0 1.06 0l3.792-3.791z"
        fill="#121212"
      />
    </svg>
  )
}

/**
 * Spotify Encore-style Add / Save to Library icon.
 * Circular outline with a plus sign, rendered with currentColor for smooth gray-to-white hover transition.
 */
function PlusCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('shrink-0 fill-current', className)}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z" />
      <path d="M11.75 8a.75.75 0 0 1-.75.75H8.75V11a.75.75 0 0 1-1.5 0V8.75H5a.75.75 0 0 1 0-1.5h2.25V5a.75.75 0 0 1 1.5 0v2.25H11c.414 0 .75.336.75.75z" />
    </svg>
  )
}

export default function SongAddButton({
  song,
  className,
  size = 'md',
  alwaysVisible = false,
  onToggle
}: SongAddButtonProps) {
  const [isFav, setIsFav] = useState(Boolean(song.isFavorite))
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [justToggled, setJustToggled] = useState(false)

  useEffect(() => {
    setIsFav(Boolean(song.isFavorite))
  }, [song.isFavorite, song.id])

  useEffect(() => {
    const handleFavUpdated = (e: Event) => {
      const custom = e as CustomEvent<{ songId: string; isFavorite: boolean }>
      if (custom.detail && custom.detail.songId === song.id) {
        setIsFav(custom.detail.isFavorite)
      }
    }
    window.addEventListener('felo:favorites-updated', handleFavUpdated)
    return () => window.removeEventListener('felo:favorites-updated', handleFavUpdated)
  }, [song.id])

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    if (isFav) {
      // If already added, open the playlist selection popover (like Spotify)
      setIsPopoverOpen(true)
      return
    }

    // Direct Like / Add
    const nextFav = true
    setIsFav(nextFav)
    setJustToggled(true)
    setTimeout(() => setJustToggled(false), 300)

    try {
      if (window.api?.toggleFavorite) {
        await window.api.toggleFavorite(song.id, nextFav, song)
      }
      onToggle?.(nextFav)
      window.dispatchEvent(
        new CustomEvent('felo:favorites-updated', {
          detail: { songId: song.id, isFavorite: nextFav }
        })
      )
      window.dispatchEvent(new CustomEvent('felo:library-updated'))
    } catch (err) {
      console.error('Failed to add to Liked Songs:', err)
      setIsFav(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsPopoverOpen(true)
  }

  const buttonSizes = {
    sm: 'w-7 h-7',
    md: 'w-8 h-8',
    lg: 'w-10 h-10'
  }[size]

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-7 h-7'
  }[size]

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={isFav ? 'Added to Liked Songs (Click to edit playlists)' : 'Save to Liked Songs'}
        aria-label={isFav ? 'Added to Liked Songs (Click to edit playlists)' : 'Save to Liked Songs'}
        className={cn(
          'group/add-btn relative inline-flex items-center justify-center rounded-full transition-transform duration-150 cursor-pointer select-none shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-white/50',
          buttonSizes,
          isFav
            ? 'hover:scale-105 active:scale-95'
            : cn(
                'text-text-muted hover:text-white hover:scale-105 active:scale-95',
                !alwaysVisible && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              ),
          justToggled && 'scale-115 duration-200 ease-out',
          className
        )}
      >
        {isFav ? (
          <CheckedIcon className={iconSizes} />
        ) : (
          <PlusCircleIcon className={iconSizes} />
        )}
      </button>

      {isPopoverOpen && (
        <AddToPlaylistPopover
          song={song}
          isOpen={isPopoverOpen}
          isFavorite={isFav}
          onClose={() => setIsPopoverOpen(false)}
          onToggleFavorite={(next) => {
            setIsFav(next)
            onToggle?.(next)
          }}
        />
      )}
    </>
  )
}

