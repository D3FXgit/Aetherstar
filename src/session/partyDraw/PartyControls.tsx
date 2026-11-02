// The party draw's two segmented controls: which mode the night is in, and
// how many singers to draw.
import { useT } from '../../i18n'
import { du } from '../../scenes/designUnits'
import { SESSION_COLORS, TEXT } from '../sessionTheme'
import { SESSION_MODE_LABEL_KEYS } from '../types'

const SEGMENT_TRACK = {
  background: SESSION_COLORS.surface,
  borderRadius: '999px',
  padding: du(5),
  gap: du(4),
} as const

function segmentStyle(active: boolean) {
  return {
    padding: `${du(10)} ${du(22)}`,
    minHeight: `max(2.75rem, ${du(44)})`,
    borderRadius: '999px',
    fontSize: `max(0.875rem, ${du(16)})`,
    fontWeight: 800,
    color: active ? SESSION_COLORS.ink : TEXT.secondary,
    background: active ? 'var(--ae-text-primary)' : 'transparent',
    border: 'none',
    cursor: active ? 'default' : 'pointer',
  } as const
}

/** The modes this screen can switch to; Party itself is the current one. */
const OTHER_MODES = ['classic', 'battle'] as const

export function PartyModeSwitcher({ onSwitch }: { onSwitch: (mode: 'classic' | 'battle') => void }) {
  const t = useT()
  return (
    <div
      role="group"
      aria-label={t('party.mode.label')}
      className="flex items-center"
      style={SEGMENT_TRACK}
      data-testid="party-mode-switcher"
    >
      {OTHER_MODES.map((mode) => (
        <button key={mode} type="button" onClick={() => onSwitch(mode)} style={segmentStyle(false)}>
          {t(SESSION_MODE_LABEL_KEYS[mode])}
        </button>
      ))}
      <button type="button" aria-pressed="true" style={segmentStyle(true)}>
        {t(SESSION_MODE_LABEL_KEYS.party)}
      </button>
    </div>
  )
}

export function PlayerCountPicker({
  max,
  value,
  onChange,
}: {
  max: number
  value: number
  onChange: (count: number) => void
}) {
  const t = useT()
  return (
    <div className="flex items-center" style={{ gap: du(12) }} data-testid="party-player-count-selector">
      <span style={{ fontSize: `max(0.875rem, ${du(16)})`, fontWeight: 700, color: TEXT.secondary }}>
        {t('party.count.label')}
      </span>
      <div role="group" aria-label={t('party.count.label')} className="flex items-center" style={SEGMENT_TRACK}>
        {Array.from({ length: max }, (_, i) => i + 1).map((count) => (
          <button
            key={count}
            type="button"
            data-testid={`player-count-${count}`}
            aria-pressed={value === count}
            aria-label={t('party.count.option', { count })}
            onClick={() => onChange(count)}
            style={{ ...segmentStyle(value === count), padding: 0, width: `max(2.75rem, ${du(44)})` }}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  )
}
