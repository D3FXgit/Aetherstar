// Versus mode's verdict, across the top of the stage: who won and by how much.
import { motion } from 'framer-motion'
import { useT } from '../../i18n'
import { du } from '../../scenes/designUnits'
import { SESSION_COLORS, TEXT, displayType } from '../sessionTheme'
import type { ResultSinger } from './singers'

export function VersusBanner({
  winner,
  runnerUp,
  reduceMotion,
}: {
  winner: ResultSinger
  runnerUp: ResultSinger
  reduceMotion: boolean
}) {
  const t = useT()
  const tie = winner.result.score === runnerUp.result.score
  return (
    <motion.div
      data-testid="battle-results-banner"
      data-tie={tie}
      className="flex shrink-0 flex-wrap items-baseline justify-between"
      style={{
        gap: du(24),
        padding: `${du(20)} ${du(32)}`,
        borderRadius: du(26),
        background: tie ? SESSION_COLORS.raised : winner.color,
        color: tie ? TEXT.primary : SESSION_COLORS.ink,
      }}
      initial={reduceMotion ? false : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 24 }}
    >
      <span style={displayType(52)}>
        {tie ? t('results.versus.tie') : t('results.versus.wins', { name: winner.name })}
      </span>
      <span style={{ fontWeight: 700, fontSize: `max(1rem, ${du(26)})` }}>
        {tie
          ? t('results.versus.tieScore', { score: winner.result.score })
          : t('results.versus.margin', {
              name: runnerUp.name,
              points: winner.result.score - runnerUp.result.score,
            })}
      </span>
    </motion.div>
  )
}
