export default function Home() {
  const featuredPlaylists = [
    { id: 1, name: "Today's Top Hits", description: "The biggest songs right now.", cover: "" },
    { id: 2, name: "Chill Hits", description: "Kick back to the best new and recent chill hits.", cover: "" },
    { id: 3, name: "RapCaviar", description: "New music from Drake, Travis Scott.", cover: "" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Good evening</h2>
      </div>
      
      <section>
        <h3 className="text-xl font-semibold mb-4">Featured Playlists</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {featuredPlaylists.map((playlist) => (
            <div key={playlist.id} className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-4 flex flex-col gap-3 group hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="aspect-square bg-muted rounded-md shadow-sm overflow-hidden group-hover:shadow-md transition-shadow"></div>
              <div>
                <h4 className="font-semibold leading-tight truncate">{playlist.name}</h4>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{playlist.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xl font-semibold mb-4">Top Tracks</h3>
        <div className="space-y-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 p-2 rounded-md hover:bg-accent cursor-pointer group">
              <div className="w-8 text-center text-muted-foreground text-sm">{i}</div>
              <div className="h-10 w-10 bg-muted rounded"></div>
              <div className="flex-1">
                <p className="font-medium text-sm">Track {i}</p>
                <p className="text-xs text-muted-foreground">Artist {i}</p>
              </div>
              <div className="text-sm text-muted-foreground pr-4 opacity-0 group-hover:opacity-100 transition-opacity">3:45</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
