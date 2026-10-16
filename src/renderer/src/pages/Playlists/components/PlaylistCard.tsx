import { MoreVertical, Music2, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toMediaUrl } from '../../../lib/media'
import HighlightMatch from '../../../components/Common/HighlightMatch'
import type { Playlist } from '../types'

interface PlaylistCardProps {
  playlist: Playlist
  searchQuery: string
  isMenuActive: boolean
  onPlay: (playlistId: string) => void
  onOpenMenu: (playlist: Playlist, rect: DOMRect) => void
}

export function PlaylistCard({
  playlist,
  searchQuery,
  isMenuActive,
  onPlay,
  onOpenMenu
}: PlaylistCardProps) {
  const navigate = useNavigate()
  const artworkUrl = toMediaUrl(playlist.artworkPath)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/playlists/${playlist.id}`)}
      onKeyDown={(event) =>
        event.key === 'Enter' && navigate(`/playlists/${playlist.id}`)
      }
      className="group relative flex w-full sm:w-[234px] cursor-pointer flex-col rounded-xl bg-[#181818] p-3 sm:p-5 text-left transition-all hover:bg-[#282828] active:scale-[0.98]"
    >
      <div className="relative mb-3 sm:mb-5 flex aspect-square w-full sm:h-[194px] sm:w-[194px] items-center justify-center overflow-hidden rounded-lg bg-[#242424] shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Music2 className="h-10 w-10 sm:h-16 sm:w-16 fill-[#5f5f5f] text-[#5f5f5f]" />
        )}
        {playlist.songCount > 0 && (
          <button
            type="button"
            title={`Play ${playlist.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onPlay(playlist.id)
            }}
            className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 flex h-9 w-9 sm:h-12 sm:w-12 translate-y-2 items-center justify-center rounded-full bg-white text-black opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 cursor-pointer"
          >
            <Play className="ml-0.5 h-4 w-4 sm:h-5 sm:w-5 fill-current" />
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-start justify-between gap-1.5 sm:gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm sm:text-[18px] font-bold sm:font-black leading-tight sm:leading-6">
            <HighlightMatch text={playlist.name} query={searchQuery} />
          </h2>
          <p className="mt-1 sm:mt-2 truncate text-xs sm:text-[14px] font-medium text-[#b9c4d8]">
            {playlist.songCount} {playlist.songCount === 1 ? 'song' : 'songs'}
          </p>
        </div>
        <button
          type="button"
          title="Playlist options"
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            onOpenMenu(playlist, rect)
          }}
          className={`mt-0.5 flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-[3px] border transition-all cursor-pointer ${
            isMenuActive
              ? 'border-primary-amber bg-hover text-text opacity-100'
              : 'border-transparent text-[#b3b3b3] opacity-70 md:opacity-0 group-hover:opacity-100 hover:border-primary-amber hover:bg-hover hover:text-white'
          }`}
        >
          <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>
      </div>
    </div>
  )
}
