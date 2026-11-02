// The facts under a singer's score: stars, rank title, line summary, record.
import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../../i18n'
import { du } from '../../scenes/designUnits'
import { rankTitleKey } from '../rating'
import { SESSION_COLORS, colorChipStyle, neutralChipStyle } from '../sessionTheme'
import type { RatingResult, SessionSongResult } from '../types'
import { ANNOUNCED_LINE_RATINGS, type AnnouncedLineRating } from '../../game/types'

/**
 * Five stars, filled up to the rank. Hidden from assistive tech, which hears
 * the rating in words from the announcer instead of "black star" five times.
 */
export function Stars({
  stars,
  color,
  sizeUnits,
  show,
  reduceMotion,
  testId,
}: {
  stars: RatingResult['stars']
  color: string
  sizeUnits: number
  /** The count beat has been reached; stars pop in one after another. */
  show: boolean
  reduceMotion: boolean
  testId: string
}) {
  return (
    <p
      data-testid={testId}
      aria-hidden="true"
      style={{ color, fontSize: `max(1rem, ${du(sizeUnits)})`, letterSpacing: du(2), lineHeight: 1 }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <motion.span
          key={index}
          className="inline-block"
          style={{ opacity: index < stars ? 1 : 0.3 }}
          initial={reduceMotion ? false : { scale: 0.4 }}
          animate={{ scale: show ? 1 : 0.4 }}
          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 20, delay: index * 0.05 }}
        >
          {index < stars ? '★' : '☆'}
        </motion.span>
      ))}
    </p>
  )
}

/** The rank title, translated. Rank names stay in English, as in classic party karaoke games. */
export function RankTitle({ rating, style, testId }: { rating: RatingResult; style?: CSSProperties; testId?: string }) {
  const t = useT()
  return (
    <span data-testid={testId} style={style}>
      {t(rankTitleKey(rating.title))}
    </span>
  )
}

const LINE_LABEL_KEY: Record<AnnouncedLineRating, string> = {
  perfect: 'results.lines.perfect',
  great: 'results.lines.great',
  good: 'results.lines.good',
  ok: 'results.lines.ok',
}

/**
 * How the song went, in the verdicts the singer saw pop up line by line
 * ("Perfect ×3, Great ×5 ..."), only the ones they earned. A result with no
 * rated lines (nothing sung, or built without a live song) falls back to the
 * note counts so the row never reads empty.
 * `onColor` sets it on a singer's colour (dark ink) rather than on a dark card.
 */
export function LineSummary({
  result,
  onColor,
  testId,
}: {
  result: SessionSongResult
  onColor: boolean
  testId: string
}) {
  const t = useT()
  const chip: CSSProperties = onColor
    ? neutralChipStyle({ background: 'rgba(18, 17, 24, 0.14)', color: SESSION_COLORS.ink })
    : neutralChipStyle()
  const lineCounts = result.lineCounts
  const earned = lineCounts ? ANNOUNCED_LINE_RATINGS.filter((rating) => lineCounts[rating] > 0) : []
  if (lineCounts && earned.length > 0) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: du(8) }} data-testid={testId}>
        {earned.map((rating) => (
          <span key={rating} style={chip} data-line-rating={rating}>
            {t(LINE_LABEL_KEY[rating], { count: lineCounts[rating] })}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center" style={{ gap: du(8) }} data-testid={testId}>
      <span style={chip}>{t('results.notes.epic', { count: result.epicCount })}</span>
      <span style={chip}>{t('results.notes.good', { count: result.goodCount })}</span>
      <span style={chip}>{t('results.notes.missed', { count: result.awfulCount })}</span>
    </div>
  )
}

/** "New highscore!" -- this singer just set the song's record on their difficulty. */
export function HighscoreChip({ onColor }: { onColor: boolean }) {
  const t = useT()
  const style = onColor
    ? colorChipStyle(SESSION_COLORS.ink, { color: SESSION_COLORS.gold })
    : colorChipStyle(SESSION_COLORS.gold)
  return (
    <span data-testid="results-new-highscore" className="shrink-0 self-start" style={style}>
      {t('results.highscore')}
    </span>
  )
}
