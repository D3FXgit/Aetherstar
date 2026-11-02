import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { PlayerBadge } from '../players/PlayerBadge'
import { NeonText } from '../design/primitives/NeonText'
import { micColor, tokens } from '../design/tokens'
import { useT } from '../i18n'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { computeRating, maxScoreForLane, rankTitleKey } from '../session/rating'
import { CROWN_IMAGE_URL } from '../session/resultsAssets'
import { AudienceSingerRow, AudienceSurface, MicChip } from './AudienceSurface'
import type { AudienceResultRow, AudienceSong } from './types'

/**
 * Who won, as the room sees it: the host's celebration without the buttons.
 *
 * `SessionResults` itself cannot be mounted here: it writes the leaderboard and
 * player stats on mount and plays sound cues, which must happen once, on the
 * host. So this mirrors its layout from the broadcast rows, and recomputes the
 * rating with the same `computeRating` and chart so both screens agree.
 */
export function AudienceResultsView({ song, results }: { song: AudienceSong | null; results: AudienceResultRow[] }) {
  const t = useT()
  const { chart } = useChartLoader(song?.path ?? null)

  /**
   * Every singer's rank against the lines their lane sang (`maxScoreForLane`),
   * as on the host. Rows arrive sorted by score, so line-up order -- which is
   * lane order -- is recovered from the mic numbers. Until the chart is in, the
   * fixed 10,000 ceiling applies.
   */
  const ratings = useMemo(() => {
    const byMic = [...results].sort((a, b) => a.micNumber - b.micNumber)
    return new Map(
      results.map((result) => {
        const maxScore = chart ? maxScoreForLane(chart, byMic.indexOf(result)) : undefined
        return [result, computeRating(result.score, maxScore)] as const
      }),
    )
  }, [chart, results])

  const winner = results[0] ?? null
  const others = results.slice(1)

  if (!winner) {
    return (
      <AudienceSurface testId="audience-results">
        <div className="flex h-full items-center justify-center">
          <p className="text-[clamp(1rem,2vw,2rem)] text-ink-tertiary">{t('audience.results.empty')}</p>
        </div>
      </AudienceSurface>
    )
  }

  const rating = ratings.get(winner) ?? computeRating(winner.score)
  const winnerRim = micColor(winner.micNumber)
  const stars = [...Array(5)].map((_, index) => (index < rating.stars ? '★' : '☆'))

  return (
    <AudienceSurface testId="audience-results">
      <div className="relative flex h-full w-full items-center justify-center gap-[5vw] px-[5vw] py-[6vh]">
        <motion.div
          className="flex shrink-0 flex-col items-center gap-4 text-center"
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={tokens.spring.panelEnter}
        >
          <div className="relative">
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '-4vmin' }}>
              <Crown />
            </div>
            <PlayerBadge name={winner.name} color={winnerRim} avatarUrl={winner.avatarUrl} size={180} />
            <span className="absolute -bottom-2 -right-2">
              <MicChip micNumber={winner.micNumber} size={46} />
            </span>
          </div>

          <NeonText
            accent="gold"
            className="font-bold"
            style={{ fontSize: 'clamp(1.1rem,1.8vw,2rem)' }}
            data-testid="audience-results-winner-label"
          >
            {t('audience.results.winner')}
          </NeonText>
          <p data-testid="audience-results-winner" className="text-[clamp(1.5rem,3.2vw,3.5rem)] font-bold leading-tight text-ink-primary">
            {winner.name}
          </p>
          <p
            data-testid="audience-results-score"
            className="font-mono text-[clamp(2.5rem,6vw,6rem)] font-bold tabular-nums text-ink-primary"
          >
            {winner.score.toLocaleString()}
          </p>
          <NeonText accent="gold" className="font-bold" style={{ fontSize: 'clamp(1.1rem,2vw,2rem)' }}>
            {t(rankTitleKey(rating.title))}
          </NeonText>
          <p data-testid="audience-results-stars" aria-hidden className="text-[clamp(1.25rem,2.2vw,2.25rem)]" style={{ color: tokens.accent.gold }}>
            {stars.join('')}
          </p>
          {winner.score > 0 && winner.bestLine && (
            <p className="max-w-[26ch] text-center text-[clamp(0.875rem,1.4vw,1.5rem)] italic text-ink-tertiary">
              &ldquo;{winner.bestLine}&rdquo;
            </p>
          )}
        </motion.div>

        {others.length > 0 && (
          <ul data-testid="audience-results-others" className="flex max-h-full min-w-[26vw] flex-col gap-3 overflow-hidden">
            {others.map((result) => (
              <AudienceSingerRow
                key={result.playerId ?? `${result.micNumber}-${result.name}`}
                singer={result}
                badgeSize={52}
                testId="audience-results-row"
                trailing={
                  <span className="flex flex-col items-end leading-tight">
                    <span
                      className="font-mono text-[clamp(1rem,1.8vw,2rem)] font-semibold tabular-nums text-ink-primary"
                    >
                      {result.score.toLocaleString()}
                    </span>
                    <span
                      data-testid="audience-results-row-rating"
                      className="text-[clamp(0.7rem,1vw,1.1rem)] font-semibold"
                      style={{ color: tokens.accent.gold }}
                    >
                      {t(rankTitleKey((ratings.get(result) ?? computeRating(result.score)).title))}
                    </span>
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </AudienceSurface>
  )
}

/** The host's crown artwork, at TV scale. */
function Crown() {
  return (
    <img
      src={CROWN_IMAGE_URL}
      alt=""
      aria-hidden
      data-testid="audience-results-crown"
      style={{ width: '9vmin', height: '6.3vmin', objectFit: 'contain' }}
    />
  )
}
