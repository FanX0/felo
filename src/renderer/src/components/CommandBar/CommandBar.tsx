import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function CommandBar() {
  const navigate = useNavigate()

  return (
    <div className="h-14 bg-canvas border-b border-border flex items-center px-4 justify-between draggable-header shrink-0 z-10">
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-hover text-text-muted hover:text-text transition-colors no-drag"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={() => navigate(1)}
          className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-hover text-text-muted hover:text-text transition-colors no-drag"
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
          className="w-full h-9 bg-surface border border-border rounded-full pl-9 pr-4 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary-amber focus:ring-1 focus:ring-primary-amber transition-all"
        />
      </div>

      <div className="flex items-center gap-3 no-drag">
        {/* Placeholder for User Profile / Notifications */}
        <div className="h-8 w-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text text-sm font-bold shadow-sm">
          F
        </div>
      </div>
    </div>
  )
}
