import type { NoteWithId } from '../types'
import type { ScoringPlan } from './scoringPlan'

/**
 * Points one judged note earns: its share of the part's note pool (see
 * scoringPlan.ts) times `credit`, the fraction of its beats sung in tolerance.
 *
 * UltraStar awards points per beat, so a note sung for three of its four beats
 * pays three quarters -- no cliff, no tier rate, no combo. Freestyle notes and
 * notes outside the plan earn 0.
 *
 * Returned **unrounded**: rounding per note would make a perfect run land a
 * few points off 10,000. The score store accumulates the exact value and
 * publishes a whole number (see useScoreStore).
 */
export function scoreNote(note: NoteWithId, credit: number, plan: ScoringPlan): number {
  const full = plan.notePoints.get(note.noteId) ?? 0
  if (full <= 0) return 0
  const earned = Number.isFinite(credit) ? Math.min(1, Math.max(0, credit)) : 0
  return full * earned
}
