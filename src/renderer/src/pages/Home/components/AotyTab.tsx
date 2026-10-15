import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCw, Disc3, Download, Trophy } from 'lucide-react'
import { AppCapabilities } from '../../../lib/appConfig'
import { UnifiedMediaCard } from './UnifiedMediaCard'

type AotyCategory = 'must-hear' | 'highest-rated' | 'new-releases' | 'anticipated'

export function AotyTab() {
  const navigate = useNavigate()
  const [aotyCategory, setAotyCategory] = useState<AotyCategory>('must-hear')
  const [aotyAlbums, setAotyAlbums] = useState<any[]>([])
  const [isLoadingAoty, setIsLoadingAoty] = useState(false)

  const loadAoty = (category: AotyCategory) => {
    setIsLoadingAoty(true)
    window.api
      ?.fetchAotyAlbums?.(category)
      .then((albums: any[]) => {
        setAotyAlbums(Array.isArray(albums) && albums.length > 0 ? albums : [])
      })
      .catch((err: any) => {
        console.warn('AOTY load failed:', err)
        setAotyAlbums([])
      })
      .finally(() => {
        setIsLoadingAoty(false)
      })
  }

  useEffect(() => {
    loadAoty(aotyCategory)
  }, [aotyCategory])

  const categories: Array<{ id: AotyCategory; label: string }> = [
    { id: 'must-hear', label: 'Must Hear' },
    { id: 'highest-rated', label: 'Highest Rated' },
    { id: 'new-releases', label: 'New Releases' },
    { id: 'anticipated', label: 'Anticipated' }
  ]

  return (
    <section className="space-y-5 pt-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black tracking-tight text-white">Album of the Year</h2>
            <span className="inline-flex items-center gap-1 rounded-md bg-primary-amber/15 px-2 py-0.5 text-[10px] font-black text-primary-amber border border-primary-amber/30">
              <Trophy className="h-3 w-3" /> Critic Scores
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Curated critic reviews and top-scoring albums from{' '}
            <span className="font-bold text-white">albumoftheyear.org</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadAoty(aotyCategory)}
          title="Refresh AOTY list"
          disabled={isLoadingAoty}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover hover:text-white disabled:opacity-50"
        >
          <RotateCw className={`h-4 w-4 ${isLoadingAoty ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setAotyCategory(cat.id)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
              aotyCategory === cat.id
                ? 'bg-white text-black shadow-md'
                : 'bg-surface-elevated text-text-muted hover:bg-hover hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {isLoadingAoty && aotyAlbums.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col rounded-xl bg-surface-elevated/40 p-3 animate-pulse border border-white/5"
            >
              <div className="aspect-square w-full rounded-lg bg-white/10" />
              <div className="mt-3 h-3 w-3/4 rounded bg-white/10" />
              <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : aotyAlbums.length === 0 ? (
        <div className="py-16 text-center text-sm text-text-muted">
          No albums found in this category.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {aotyAlbums.map((album: any) => (
            <UnifiedMediaCard
              key={album.id}
              title={album.title}
              subtitle={`${album.artist}${album.year ? ` • ${album.year}` : ''}`}
              artworkUrl={album.coverUrl || album.artworkUrl}
              score={album.criticScore ?? null}
              badge={album.mustHear ? 'Must Hear' : undefined}
              sourceTag="AOTY"
              onClick={() =>
                navigate(
                  `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
                )
              }
              onAction={() => {
                navigate(
                  `/album/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.title)}`
                )
              }}
              actionTitle={AppCapabilities.downloads ? 'View & download album tracks' : 'View album tracks'}
              actionIcon={AppCapabilities.downloads ? <Download className="h-4 w-4" /> : <Disc3 className="h-4 w-4" />}
            />
          ))}
        </div>
      )}
    </section>
  )
}
