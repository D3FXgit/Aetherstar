// One singer below the winner: their place, face, rank and rolling score,
// led by a block of their mic colour.
import { motion, type Transition } from 'framer-motion'
import { PlayerBadge } from '../../players/PlayerBadge'
import { useT } from '../../i18n'
import { du } from '../../scenes/designUnits'
import { ScoreCounter } from '../ScoreCounter'
import { SESSION_COLORS, TEXT, colorChipStyle, displayType } from '../sessionTheme'
import { HighscoreChip, LineSummary, RankTitle, Stars } from './ScoreDetails'
import type { ResultSinger } from './singers'

const ROW_BADGE_UNITS = 56

interface RosterRowProps {
  singer: ResultSinger
  /** 1-based place; the winner is 1. */
  place: number
  showCount: boolean
  settled: boolean
  reduceMotion: boolean
  scale: number
  transition: Transition
}

export function RosterRow({ singer, place, showCount, settled, reduceMotion, scale, transition }: RosterRowProps) {
  const t = useT()
  return (
    <motion.div
      data-testid="results-player-row"
      data-rank={place}
      className="flex shrink-0 items-stretch overflow-hidden"
      style={{ borderRadius: du(22), background: SESSION_COLORS.surface, minHeight: du(104) }}
      initial={reduceMotion ? false : { opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={transition}
    >
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ ...displayType(40), width: du(76), background: singer.color, color: SESSION_COLORS.ink }}
      >
        {place}
      </span>

      <div className="flex min-w-0 flex-1 items-center" style={{ gap: du(16), padding: `${du(12)} ${du(20)}` }}>
        <PlayerBadge
          name={singer.name}
          color={singer.color}
          avatarUrl={singer.avatarUrl}
          size={Math.round(ROW_BADGE_UNITS * scale)}
        />
        <div className="flex min-w-0 flex-1 flex-col" style={{ gap: du(6) }}>
          <div className="flex min-w-0 items-center" style={{ gap: du(10) }}>
            <span className="truncate" style={displayType(26, { fontWeight: 800 })}>
              {singer.name}
            </span>
            <span style={colorChipStyle(singer.color)}>{t('results.mic', { number: singer.micSlot + 1 })}</span>
          </div>
          <div className="flex min-w-0 items-center" style={{ gap: du(10) }}>
            <Stars
              stars={singer.rating.stars}
              color={SESSION_COLORS.gold}
              sizeUnits={18}
              show={showCount}
              reduceMotion={reduceMotion}
              testId="results-player-stars"
            />
            <RankTitle
              rating={singer.rating}
              testId="results-player-rating"
              style={{ color: TEXT.secondary, fontWeight: 700, fontSize: `max(0.8125rem, ${du(17)})` }}
            />
          </div>
          <LineSummary result={singer.result} onColor={false} testId="results-player-tiers" />
        </div>
        <div className="flex shrink-0 flex-col items-end" style={{ gap: du(8) }}>
          {singer.newHighscore && <HighscoreChip onColor={false} />}
          <ScoreCounter
            testId="results-player-score"
            score={singer.result.score}
            rolling={showCount}
            immediate={settled}
            style={{ ...displayType(40), color: TEXT.primary }}
          />
        </div>
      </div>
    </motion.div>
  )
}
