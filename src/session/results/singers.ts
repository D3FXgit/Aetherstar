// Who sang what on the results screen: each singer's part, mic slot and rank.
import type { SongChart } from '../../contracts/types'
import type { PlayerProfile } from '../../players/types'
import { micRimColor } from '../../design/tokens'
import { computeRating, maxScoreForLane } from '../rating'
import type { RatingResult, SessionSongResult } from '../types'

/** One singer as the results screen draws them. */
export interface ResultSinger {
  result: SessionSongResult
  name: string
  avatarUrl: string
  /** Zero-indexed mic slot. The number is the identifier; `color` is reinforcement. */
  micSlot: number
  /** The singer's mic colour -- what their card is painted in. */
  color: string
  /** Ranked against the best the lines their lane sang allow. */
  rating: RatingResult
  newHighscore: boolean
}

/**
 * The line-up, best first, with everything the screen needs per singer.
 *
 * The sort is stable, so tied scores keep assignment order and the first
 * assigned of them reads as the winner. Colour follows the mic, never the
 * profile: whoever picked up mic 3 tonight is drawn in mic 3's colour.
 */
export function rankSingers({
  results,
  assignedPlayerIds,
  players,
  chart,
  newHighscores,
}: {
  results: readonly SessionSongResult[]
  assignedPlayerIds: readonly string[]
  players: readonly Pick<PlayerProfile, 'id' | 'name' | 'avatarUrl'>[]
  chart: SongChart | null
  newHighscores: ReadonlySet<string>
}): ResultSinger[] {
  const ranked = [...results].sort((a, b) => b.score - a.score)
  return ranked.map((result, rankIndex) => {
    const assignedIndex = assignedPlayerIds.indexOf(result.playerId)
    const micSlot = assignedIndex >= 0 ? assignedIndex : rankIndex
    // Ranked against the lines this singer's lane was actually given: their
    // place in the line-up is their lane (see MultiplayerGameplay). Until the
    // chart is in, the fixed 10,000 ceiling.
    const maxScore = chart ? maxScoreForLane(chart, Math.max(assignedIndex, 0)) : undefined
    const profile = players.find((p) => p.id === result.playerId)
    return {
      result,
      name: profile?.name ?? result.playerId,
      avatarUrl: profile?.avatarUrl ?? '',
      micSlot,
      color: micRimColor(micSlot),
      rating: computeRating(result.score, maxScore),
      newHighscore: newHighscores.has(result.playerId),
    }
  })
}
