// Per-song highscores: who just set a record (SessionResults), kept pure for testing.
import type { Difficulty } from '../calibration/types'

/**
 * Which singers just set a new record on this song, one per difficulty.
 *
 * A record is per song *and* difficulty, so an Easy score never beats a Hard
 * one. When two singers on the same difficulty both beat the old record, only
 * the better of them holds it. A first score on a song with no record yet is a
 * record, as long as it is above zero.
 */
export function newHighscoreHolders(
  results: { playerId: string; score: number; difficulty: Difficulty }[],
  previousBest: Partial<Record<Difficulty, number>>,
): Set<string> {
  const holders = new Set<string>()
  const byDifficulty = new Map<Difficulty, { playerId: string; score: number }>()
  for (const result of results) {
    const leader = byDifficulty.get(result.difficulty)
    if (!leader || result.score > leader.score) byDifficulty.set(result.difficulty, result)
  }
  for (const [difficulty, leader] of byDifficulty) {
    if (leader.score > 0 && leader.score > (previousBest[difficulty] ?? 0)) holders.add(leader.playerId)
  }
  return holders
}
