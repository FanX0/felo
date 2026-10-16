export function AnimatedPlayingWave() {
  return (
    <div className="flex items-end justify-center gap-[2.5px] h-3.5 w-3.5">
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '70%' }}
      />
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '100%', animationDelay: '0.15s' }}
      />
      <span
        className="w-[2.5px] bg-primary rounded-full animate-pulse"
        style={{ height: '80%', animationDelay: '0.3s' }}
      />
    </div>
  )
}
