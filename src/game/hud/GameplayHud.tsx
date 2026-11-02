import { memo, useMemo } from 'react'
import type { PlayerProfile, PlayerScore } from '../../contracts/types'
import type { LineRatingEvent } from '../types'
import { PlayerBadge } from '../../players/PlayerBadge'
import { micLabel } from '../../multiplayer/slots'
import { useT } from '../../i18n'
import { formatScore } from './formatScore'
import { LineRatingPop } from './LineRatingPop'

const HUD_BADGE_SIZE = 56

/**
 * One singer's score card, down the right edge of the singer view.
 *
 * Solid and translucent, no backdrop blur: up to eight of these sit over
 * playing video, and a blur re-filters the video under each one every frame.
 * The singer's colour runs down the card's edge and names the mic.
 */
const HUD_SURFACE_CLASS = 'flex items-stretch overflow-hidden rounded-2xl bg-black/75'

interface GameplayHudProps {
  playerScore: PlayerScore
  /** The roster profile; omitted for a scored singer the roster does not know (the card falls back to the score's name). */
  playerProfile?: PlayerProfile
  /** This singer's newest line verdict -- popped as "Perfect!" / "Great!" / "Good" / "OK". */
  lineRating?: LineRatingEvent | null
  /** The microphone this singer is on, 1-based -- identity follows the mic, spelled through `micLabel()`. */
  slotNumber?: number
  /** That mic's rim colour (see `micRimColor`) -- reinforcement for the number, never a replacement. */
  accentColor?: string
}

/**
 * Memoised: with eight singers, a score change for one must not re-render the
 * other seven cards (ScoreColumn keeps unchanged players' objects stable).
 */
export const GameplayHud = memo(function GameplayHud({
  playerScore,
  playerProfile,
  lineRating = null,
  slotNumber,
  accentColor,
}: GameplayHudProps) {
  const profile = useMemo<PlayerProfile>(
    () => playerProfile ?? { id: playerScore.playerId, name: playerScore.name, color: accentColor ?? 'cyan', avatarUrl: '' },
    [playerProfile, playerScore.playerId, playerScore.name, accentColor],
  )

  useT()

  return (
    <div className={HUD_SURFACE_CLASS} data-testid="gameplay-hud" data-slot-number={slotNumber}>
      {/* The singer's colour: the same one their lane, pitch arrow and lyrics use. */}
      {accentColor && <div data-testid="hud-rim" aria-hidden className="w-1.5 shrink-0" style={{ background: accentColor }} />}

      <div className="flex min-w-0 flex-1 items-center gap-4 p-4">
        <PlayerBadge name={profile.name} color={profile.color} avatarUrl={profile.avatarUrl} size={HUD_BADGE_SIZE} />

        <div className="flex min-w-0 flex-col gap-1">
          {slotNumber !== undefined && (
            <span
              data-testid="hud-slot-badge"
              className="text-sm font-semibold leading-none"
              style={{ color: accentColor ?? 'var(--ae-text-secondary)' }}
            >
              {micLabel(slotNumber)}
            </span>
          )}
          {/* Grouped and rounded first, never a raw float. */}
          <span data-testid="hud-score" className="tabular-nums text-3xl font-extrabold leading-none text-[var(--ae-text-primary)]">
            {formatScore(playerScore.score)}
          </span>
        </div>

        <LineRatingPop rating={lineRating} />
      </div>
    </div>
  )
})
