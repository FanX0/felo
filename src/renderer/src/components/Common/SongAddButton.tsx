import { useState, useEffect } from 'react'
import { Check, Plus } from 'lucide-react'
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

  const sizeClasses = {
    sm: 'w-5 h-5 text-[10px]',
    md: 'w-6 h-6 text-xs',
    lg: 'w-8 h-8 text-sm'
  }[size]

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-3.5 h-3.5',
    lg: 'w-4 h-4'
  }[size]

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={isFav ? 'Added to Liked Songs (Click to edit playlists)' : 'Save to Liked Songs'}
        className={cn(
          'relative flex items-center justify-center rounded-full transition-all cursor-pointer select-none shrink-0 outline-none',
          sizeClasses,
          isFav
            ? 'bg-emerald-500 text-black border border-emerald-400 hover:scale-110 active:scale-95 shadow-sm'
            : cn(
                'border border-white/30 text-white/70 hover:border-white hover:text-white hover:scale-105 active:scale-95 bg-black/20',
                !alwaysVisible && 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              ),
          justToggled && 'animate-in zoom-in-75 duration-200',
          className
        )}
      >
        {isFav ? (
          <Check className={cn(iconSizes, 'stroke-[3]')} />
        ) : (
          <Plus className={cn(iconSizes, 'stroke-[2.5]')} />
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
