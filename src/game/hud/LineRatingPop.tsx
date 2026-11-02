import { useEffect, useState } from 'react'
import type { LineRatingEvent } from '../types'
import { useT } from '../../i18n'
import { lineRatingLabel } from '../scoring/lineRating'
import { LINE_RATING_COLOR, LINE_RATING_POP_MS } from './lineRatingStyle'

interface LineRatingPopProps {
  rating: LineRatingEvent | null
}

/**
 * The party-karaoke-style verdict for the line just finished: "Perfect!", "Great!",
 * "Good", "OK" -- nothing for a poor line. Shown for LINE_RATING_POP_MS after
 * each new verdict; keyed on the event, so the same rating twice still re-pops.
 */
export function LineRatingPop({ rating }: LineRatingPopProps) {
  useT()
  const [expired, setExpired] = useState<LineRatingEvent | null>(null)

  useEffect(() => {
    if (!rating) return
    const timer = setTimeout(() => setExpired(rating), LINE_RATING_POP_MS)
    return () => clearTimeout(timer)
  }, [rating])

  // Translated at render time, so a language switch mid-song is honoured.
  const label = rating ? lineRatingLabel(rating.rating) : null
  if (!rating || !label || expired === rating) return null

  return (
    <div
      key={`${rating.lineIndex}:${rating.t}`}
      data-testid="line-rating-pop"
      data-rating={rating.rating}
      role="status"
      className="whitespace-nowrap text-lg font-bold"
      style={{ color: LINE_RATING_COLOR[rating.rating] }}
    >
      {label}
    </div>
  )
}
