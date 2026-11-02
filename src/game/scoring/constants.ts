import type { ScoringConstants } from '../types'

/**
 * Party-karaoke/UltraStar-style scoring budget -- the single file real singing
 * tests retune. Every consumer imports from here, never a hardcoded literal.
 *
 * Each singer can score at most `maxScore` per song, measured against the
 * notes of the part they sing: `notePool` is shared over those notes by
 * length (golden beats weigh `goldenMultiplier`x), `linePool` over the lines
 * that contain anything scorable. There is no combo multiplier.
 */
export const SCORING: ScoringConstants = {
  maxScore: 10_000,
  notePool: 9_000,
  linePool: 1_000,
  goldenMultiplier: 2,
}
