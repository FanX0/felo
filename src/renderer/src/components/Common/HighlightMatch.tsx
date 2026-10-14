import { useMemo, type ReactNode } from 'react'

export interface HighlightMatchProps {
  text?: string | null
  query?: string | null
  highlightClassName?: string
}

export function HighlightMatch({
  text,
  query,
  highlightClassName = 'text-primary-amber font-semibold'
}: HighlightMatchProps): ReactNode {
  const parts = useMemo(() => {
    if (!text) return null
    const trimmed = query?.trim()
    if (!trimmed) return [{ text, isMatch: false }]

    const tokens = trimmed.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return [{ text, isMatch: false }]

    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const regex = new RegExp(`(${escaped})`, 'gi')
    const rawParts = text.split(regex)

    return rawParts.map((part) => ({
      text: part,
      isMatch: tokens.some((token) => part.toLowerCase() === token.toLowerCase())
    }))
  }, [text, query])

  if (!text) return null
  if (!parts) return <>{text}</>

  return (
    <>
      {parts.map((item, index) =>
        item.isMatch ? (
          <span key={index} className={highlightClassName}>
            {item.text}
          </span>
        ) : (
          item.text
        )
      )}
    </>
  )
}

export default HighlightMatch
