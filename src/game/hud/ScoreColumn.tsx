import { memo } from 'react'
import { micRimColor } from '../../design/tokens'
import { usePlayersStore } from '../../players/store'
import { useScoreStore } from '../state/useScoreStore'
import { GameplayHud } from './GameplayHud'

export interface ScoreEntry {
  playerId: string
  /** The *microphone* this singer is on, 1-based -- the same number their lane carries. */
  micNumber: number
}

interface ScoreColumnProps {
  /**
   * The singers, in the order their cards should stack down the right edge --
   * the same order their lanes are stacked in, so a card is always level-ish
   * with the lane it is counting.
   */
  entries: ScoreEntry[]
}

/**
 * The live score cards, stacked down the right edge of the singer view.
 *
 * All of it is real state: scores and line verdicts come from useScoreStore
 * (already multi-player), the player's name and avatar from the roster, and
 * the mic number and colour from the caller's lane assignment. The
 * subscriptions live *here* rather than in the frame above them, so a score
 * change re-renders these cards only -- never the note lane, which must stay
 * off React's render path. Each card is memoised, so only the
 * singer whose score or line verdict changed re-renders.
 */
export const ScoreColumn = memo(function ScoreColumn({ entries }: ScoreColumnProps) {
  const scores = useScoreStore((state) => state.players)
  const lineRatings = useScoreStore((state) => state.lineRatingByPlayerId)
  const profiles = usePlayersStore((state) => state.players)

  return (
    <div data-testid="score-column" className="flex w-full flex-col gap-3">
      {entries.map((entry) => {
        const playerScore = scores.find((player) => player.playerId === entry.playerId)
        if (!playerScore) return null

        return (
          <GameplayHud
            key={entry.playerId}
            playerScore={playerScore}
            playerProfile={profiles.find((player) => player.id === entry.playerId)}
            // Only the singer whose line just ended sees its verdict.
            lineRating={lineRatings[entry.playerId] ?? null}
            slotNumber={entry.micNumber}
            accentColor={micRimColor(entry.micNumber - 1)}
          />
        )
      })}
    </div>
  )
})
