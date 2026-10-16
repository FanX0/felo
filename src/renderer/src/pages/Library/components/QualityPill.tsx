import type { Song } from '../types'

export function QualityPill({ song }: { song: Song }) {
  const rawFormat = String(song.codec || song.container || '').toLowerCase()
  const isLossless =
    rawFormat.includes('flac') ||
    rawFormat.includes('alac') ||
    rawFormat.includes('wav') ||
    rawFormat.includes('aiff')
  const isHiRes =
    (song.bitDepth && song.bitDepth >= 24) || (song.sampleRate && song.sampleRate >= 88200)

  if (isHiRes) {
    const rateKhz = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(0)}k` : ''
    return (
      <span
        title={`Hi-Res Audio: ${song.bitDepth || 24}-bit / ${song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : ''}`}
        className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted"
      >
        Hi-Res{rateKhz ? ` ${rateKhz}` : ''}
      </span>
    )
  }

  if (isLossless) {
    return (
      <span
        title="Lossless CD Quality Audio"
        className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted"
      >
        Lossless
      </span>
    )
  }

  const format = rawFormat.includes('mp3') || /mpeg.*layer\s*3/.test(rawFormat)
    ? 'MP3'
    : rawFormat.includes('m4a') || rawFormat.includes('aac')
      ? 'AAC'
      : rawFormat.includes('opus')
        ? 'OPUS'
        : rawFormat.includes('ogg')
          ? 'OGG'
          : rawFormat.toUpperCase()

  if (!format || format === 'UNKNOWN') return null

  const kbps = song.bitrate ? `${Math.round(song.bitrate / 1000)}k` : ''

  return (
    <span className="shrink-0 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted/70">
      {format}{kbps ? ` ${kbps}` : ''}
    </span>
  )
}
