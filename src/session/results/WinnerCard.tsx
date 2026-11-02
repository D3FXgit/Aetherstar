// The winner's card: painted in their mic colour, wearing the crown, with
// their score rolling up and the screen's main actions at the bottom.
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { PlayerBadge } from '../../players/PlayerBadge'
import { useT } from '../../i18n'
import { du } from '../../scenes/designUnits'
import { easing } from '../../design/tokens'
import { ScoreCounter } from '../ScoreCounter'
import { BEAT_DURATIONS } from '../resultsChoreography'
import { DISPLAY_FONT, SESSION_COLORS, colorChipStyle, displayType } from '../sessionTheme'
import { Crown } from './Crown'
import { HighscoreChip, LineSummary, RankTitle, Stars } from './ScoreDetails'
import type { ResultSinger } from './singers'

/** The crown's impact. Module constants: a new array identity would replay the squash on every render. */
const IMPACT_SQUASH = { scale: [1, 0.94, 1.03, 1] }
const IMPACT_REST = { scale: 1 }

export const WINNER_CARD_UNITS = 600
const WINNER_BADGE_UNITS = 150

interface WinnerCardProps {
  winner: ResultSinger
  label: string
  slid: boolean
  showCrown: boolean
  showCount: boolean
  settled: boolean
  reduceMotion: boolean
  onTick: () => void
  /** Badge size in px (PlayerBadge takes a number, not a CSS length). */
  scale: number
  actions: ReactNode
}

export function WinnerCard({
  winner,
  label,
  slid,
  showCrown,
  showCount,
  settled,
  reduceMotion,
  onTick,
  scale,
  actions,
}: WinnerCardProps) {
  const t = useT()
  const ink = SESSION_COLORS.ink
  const countReveal = { duration: reduceMotion ? 0 : BEAT_DURATIONS.rosterFadeMs / 1000, ease: easing.standard }

  return (
    <motion.div
      data-testid="results-winner-column"
      data-slid={slid}
      // FLIP, so sliding aside is a transform rather than a guessed offset.
      layout={!reduceMotion}
      transition={{ duration: BEAT_DURATIONS.slideMs / 1000, ease: easing.emphasized }}
      className="flex shrink-0 flex-col"
      style={{
        width: du(WINNER_CARD_UNITS),
        maxHeight: '100%',
        padding: du(30),
        borderRadius: du(32),
        background: winner.color,
        color: ink,
      }}
    >
      {/* The one element allowed to overshoot: the winner should land, not slide in. */}
      <motion.div
        className="flex items-center"
        style={{ gap: du(24), paddingTop: du(18) }}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.72 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 13 }}
      >
        {/* Not clipped: the crown lands over the badge from above. */}
        <div
          className="relative flex shrink-0 items-center justify-center"
          style={{ width: du(180), height: du(180), borderRadius: du(36), background: ink }}
        >
          {showCrown && <Crown reduceMotion={reduceMotion} />}
          <motion.div
            animate={showCrown && !reduceMotion ? IMPACT_SQUASH : IMPACT_REST}
            transition={{ duration: 0.42, times: [0, 0.18, 0.45, 1], ease: 'easeOut' }}
          >
            <PlayerBadge
              name={winner.name}
              color={winner.color}
              avatarUrl={winner.avatarUrl}
              size={Math.round(WINNER_BADGE_UNITS * scale)}
            />
          </motion.div>
          {/* The mic number is always drawn: colour alone never tells two singers apart. */}
          <span
            data-testid="results-winner-mic"
            className="absolute"
            style={{ ...colorChipStyle(winner.color), bottom: du(-12), right: du(-12), border: `${du(3)} solid ${ink}` }}
          >
            {t('results.mic', { number: winner.micSlot + 1 })}
          </span>
        </div>

        <div className="flex min-w-0 flex-col" style={{ gap: du(8) }}>
          <p
            data-testid="results-winner-label"
            style={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: `max(1rem, ${du(24)})` }}
          >
            {label}
          </p>
          <p data-testid="results-winner" className="truncate" style={displayType(56)}>
            {winner.name}
          </p>
          {winner.newHighscore && <HighscoreChip onColor />}
        </div>
      </motion.div>

      {/* Mounted from the first frame at zero opacity, so nothing resizes when the number arrives. */}
      <motion.div
        className="flex flex-col"
        style={{ marginTop: du(24), gap: du(12) }}
        initial={false}
        animate={{ opacity: showCount ? 1 : 0 }}
        transition={countReveal}
      >
        <ScoreCounter
          score={winner.result.score}
          rolling={showCount}
          immediate={settled}
          onTick={onTick}
          style={{ ...displayType(104), color: ink, letterSpacing: '-0.02em' }}
        />
        <div className="flex flex-wrap items-center" style={{ gap: du(14) }}>
          <Stars
            stars={winner.rating.stars}
            color={ink}
            sizeUnits={30}
            show={showCount}
            reduceMotion={reduceMotion}
            testId="results-stars"
          />
          <RankTitle rating={winner.rating} style={displayType(30, { fontWeight: 800 })} />
        </div>
        <LineSummary result={winner.result} onColor testId="results-tier-breakdown" />
        {/* A singer who scored nothing has no best line to quote. */}
        {winner.result.score > 0 && winner.result.bestLine?.trim() && (
          <p
            data-testid="results-best-line"
            className="truncate italic"
            style={{ fontSize: `max(0.875rem, ${du(18)})`, fontWeight: 600, opacity: 0.75 }}
          >
            &ldquo;{winner.result.bestLine}&rdquo;
          </p>
        )}
      </motion.div>

      {/* Height reserved from the first frame so the card does not grow when the buttons land. */}
      <div className="flex" style={{ marginTop: du(24), minHeight: `max(2.75rem, ${du(64)})`, gap: du(12) }}>
        {actions}
      </div>
    </motion.div>
  )
}
