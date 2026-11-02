// One drawn singer: painted in their mic's colour, with a way to pass the mic
// to someone on the bench.
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../../i18n'
import { PlayerBadge } from '../../players/PlayerBadge'
import { du, useDesignScale } from '../../scenes/designUnits'
import { micRimColor } from '../../design/tokens'
import { BUTTON_HOVER_CLASS, SESSION_COLORS, colorChipStyle, displayType } from '../sessionTheme'

interface SingerSlotCardProps {
  name: string | null
  avatarUrl: string
  micNumber: number
  timesSung: number
  canPass: boolean
  onPass: () => void
  slotIndex: number
}

export function SingerSlotCard({ name, avatarUrl, micNumber, timesSung, canPass, onPass, slotIndex }: SingerSlotCardProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const scale = useDesignScale()
  const color = micRimColor(micNumber - 1)
  const ink = SESSION_COLORS.ink
  const displayName = name ?? t('party.unknownPlayer')

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 24, stiffness: 300 }}
      className="flex items-center"
      style={{ background: color, color: ink, borderRadius: du(24), padding: `${du(16)} ${du(20)}`, gap: du(18) }}
    >
      <PlayerBadge name={displayName} color={color} avatarUrl={avatarUrl} size={Math.round(64 * scale)} />
      <div className="flex flex-col" style={{ minWidth: du(150), gap: du(6) }}>
        <span style={colorChipStyle(ink, { color, alignSelf: 'flex-start' })}>
          {t('party.mic', { number: micNumber })}
        </span>
        <span style={displayType(26, { fontWeight: 800 })}>{displayName}</span>
        <span style={{ fontSize: `max(0.8125rem, ${du(15)})`, fontWeight: 600, opacity: 0.75 }}>
          {timesSung === 0 ? t('party.slot.firstSong') : t('party.slot.sung', { count: timesSung })}
        </span>
      </div>
      <button
        type="button"
        disabled={!canPass}
        onClick={onPass}
        title={canPass ? t('party.slot.passHint') : t('party.slot.passDisabled')}
        data-testid={`opt-out-slot-${slotIndex}`}
        className={BUTTON_HOVER_CLASS}
        style={{
          padding: `${du(10)} ${du(16)}`,
          borderRadius: '999px',
          fontSize: `max(0.8125rem, ${du(15)})`,
          fontWeight: 800,
          color: ink,
          background: 'rgba(18, 17, 24, 0.14)',
          border: 'none',
          opacity: canPass ? 1 : 0.4,
          cursor: canPass ? 'pointer' : 'not-allowed',
          minHeight: `max(2.75rem, ${du(44)})`,
        }}
      >
        {t('party.slot.pass')}
      </button>
    </motion.div>
  )
}
