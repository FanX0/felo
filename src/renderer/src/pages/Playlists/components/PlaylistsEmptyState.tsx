import { Music2, Plus } from 'lucide-react'

interface PlaylistsEmptyStateProps {
  searchQuery: string
  onCreateClick: () => void
}

export function PlaylistsEmptyState({ searchQuery, onCreateClick }: PlaylistsEmptyStateProps) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center text-center text-[#b3b3b3]">
      <Music2 className="mb-5 h-14 w-14" />
      <h2 className="text-2xl font-black text-white">
        {searchQuery ? 'No playlists found' : 'Create your first playlist'}
      </h2>
      <p className="mt-2 text-sm">
        {searchQuery
          ? 'Try another playlist search.'
          : 'Collect songs into a playlist you can play anytime.'}
      </p>
      {!searchQuery && (
        <button
          type="button"
          onClick={onCreateClick}
          className="mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-bold text-black hover:bg-white/90 transition-all cursor-pointer shadow-md"
        >
          <Plus className="h-4 w-4" />
          <span>Create Playlist</span>
        </button>
      )}
    </div>
  )
}
