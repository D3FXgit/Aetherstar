import type { LineRating } from '../types'
import type { ScoringPlan } from './scoringPlan'
import { t } from '../../i18n'

/**
 * The per-line verdict shown when a line ends, party-karaoke-style, from the
 * fraction of the line's achievable note points the singer earned. Highest
 * first; the first band whose `minFraction` is met wins. `poor` has no label:
 * a bad line simply gets no pop. Labels are language keys.
 */
export const LINE_RATING_BANDS: readonly { rating: LineRating; minFraction: number; labelKey: string | null }[] = [
  { rating: 'perfect', minFraction: 0.95, labelKey: 'sing.lineRating.perfect' },
  { rating: 'great', minFraction: 0.8, labelKey: 'sing.lineRating.great' },
  { rating: 'good', minFraction: 0.6, labelKey: 'sing.lineRating.good' },
  { rating: 'ok', minFraction: 0.4, labelKey: 'sing.lineRating.ok' },
  { rating: 'poor', minFraction: 0, labelKey: null },
]

export function rateLine(fraction: number): LineRating {
  const value = Number.isFinite(fraction) ? fraction : 0
  return (LINE_RATING_BANDS.find((band) => value >= band.minFraction) ?? LINE_RATING_BANDS[LINE_RATING_BANDS.length - 1]).rating
}

/** What the HUD pops for a rating, in the current language -- null for `poor`. */
export function lineRatingLabel(rating: LineRating): string | null {
  const key = LINE_RATING_BANDS.find((band) => band.rating === rating)?.labelKey ?? null
  return key === null ? null : t(key)
}

/**
 * The line bonus actually awarded: the line's full bonus scaled by how much
 * of it was sung, so a perfect line pays all of it and the bonus pool sums to
 * exactly its budget over a perfect song. Unrounded, like `scoreNote`.
 */
export function lineBonusPoints(fraction: number, fullBonusPoints: number): number {
  const value = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  return fullBonusPoints * value
}

export interface CompletedLine {
  lineIndex: number
  /** Note points earned on this line / the line's maximum, 0..1. */
  fraction: number
  rating: LineRating
  /** Exact line bonus awarded. */
  bonusPoints: number
}

/**
 * Tracks one singer's progress through their lines and reports each line the
 * moment its last scorable note has been judged. Lines with nothing scorable
 * (all freestyle) never complete and award nothing.
 */
export function createLineTracker(plan: ScoringPlan): {
  record(noteId: string, points: number): CompletedLine | null
} {
  const remaining = new Map<number, number>()
  const earned = new Map<number, number>()
  for (const line of plan.lines) remaining.set(line.lineIndex, line.scoredNoteIds.length)

  return {
    record(noteId, points) {
      if (!plan.notePoints.has(noteId)) return null
      const lineIndex = plan.lineIndexByNoteId.get(noteId)
      if (lineIndex === undefined) return null
      const left = remaining.get(lineIndex) ?? 0
      if (left <= 0) return null

      earned.set(lineIndex, (earned.get(lineIndex) ?? 0) + points)
      remaining.set(lineIndex, left - 1)
      if (left - 1 > 0) return null

      const line = plan.lines[lineIndex]
      const fraction = line.maxNotePoints > 0 ? Math.min(1, (earned.get(lineIndex) ?? 0) / line.maxNotePoints) : 0
      return {
        lineIndex,
        fraction,
        rating: rateLine(fraction),
        bonusPoints: lineBonusPoints(fraction, line.bonusPoints),
      }
    },
  }
}
