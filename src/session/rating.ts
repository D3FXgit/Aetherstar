// The classic party-karaoke rank ladder, tunable in one place. Scores are on the 0..10,000
// scale per singer, measured against the part that singer sang (see
// src/game/scoring/scoringPlan.ts), so every player gets a rank of their own.
import type { RatingResult } from './types'
import type { SongChart, SongLine } from '../contracts/types'
import { linesForLane } from '../multiplayer/laneParts'
import { buildScoringPlan } from '../game/scoring/scoringPlan'
import { SCORING } from '../game/scoring/constants'

/**
 * Highest first; the first rank whose `minRatio` (score / max) is met wins. On the 10,000 scale: 9,000 / 8,000 / ... / 2,000.
 * `title` is the stable identifier (stored, compared); `key` is what the screen shows, via the language files.
 */
export const RANKS: readonly { minRatio: number; title: string; key: string; stars: RatingResult['stars'] }[] = [
  { minRatio: 0.9, title: 'Superstar', key: 'results.rank.superstar', stars: 5 },
  { minRatio: 0.8, title: 'Hit Machine', key: 'results.rank.hitMachine', stars: 4 },
  { minRatio: 0.7, title: 'Lead Singer', key: 'results.rank.leadSinger', stars: 4 },
  { minRatio: 0.6, title: 'Rising Star', key: 'results.rank.risingStar', stars: 3 },
  { minRatio: 0.5, title: 'Hopeful', key: 'results.rank.hopeful', stars: 3 },
  { minRatio: 0.4, title: 'Wannabe', key: 'results.rank.wannabe', stars: 2 },
  { minRatio: 0.2, title: 'Amateur', key: 'results.rank.amateur', stars: 2 },
  { minRatio: 0, title: 'Tone Deaf', key: 'results.rank.toneDeaf', stars: 1 },
]

/** The language-file key for a rank title. An unknown title falls back to the lowest rank's. */
export function rankTitleKey(title: string): string {
  return (RANKS.find((rank) => rank.title === title) ?? RANKS[RANKS.length - 1]).key
}

/**
 * The rank for a score. `theoreticalMaxScore` defaults to the fixed 10,000
 * ceiling every singer is scored against; pass `maxScoreForLane` when a lane
 * might have nothing scorable (it is 0 then, and the rank is Tone Deaf).
 */
export function computeRating(score: number, theoreticalMaxScore: number = SCORING.maxScore): RatingResult {
  const ratio = theoreticalMaxScore > 0 && Number.isFinite(score) ? score / theoreticalMaxScore : 0
  const band = RANKS.find((b) => ratio >= b.minRatio) ?? RANKS[RANKS.length - 1]
  return { title: band.title, stars: band.stars }
}

/**
 * The best score the singer on lane `laneIndex` can reach on this chart:
 * 10,000, or 0 when that lane has nothing scorable.
 *
 * The lane's lines come from `linesForLane` -- the very split the host's lanes
 * score against and the television mirrors (alternating P1/P2 in a duet, the
 * whole chart otherwise) -- so the rank on the results screen is measured
 * against exactly what the singer was given to sing. `laneIndex` is the
 * singer's place in the line-up (pick order, which is mic order).
 */
export function maxScoreForLane(chart: SongChart | SongLine[], laneIndex: number): number {
  const lines = Array.isArray(chart) ? chart : chart.lines
  return buildScoringPlan(linesForLane(lines, Math.max(0, laneIndex))).maxScore
}

/**
 * The best score any one singer can reach on these lines: the fixed 10,000
 * when there is anything scorable, else 0. Scores are already normalised per
 * part, so this no longer depends on the chart's length or note mix.
 */
export function computeTheoreticalMaxScore(lines: SongLine[]): number {
  return buildScoringPlan(lines).maxScore
}
