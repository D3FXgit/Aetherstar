import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import { useSessionStore } from '../sessionStore'
import { SESSION_MODE_LABEL_KEYS, type SessionMode } from '../types'
import { SURFACE, TEXT, u } from './layout'

/** The three ways to sing, in switcher order, each with its own tint. */
const MODE_TABS: { mode: SessionMode; color: string; background: string }[] = [
  { mode: 'classic', color: '#ffffff', background: 'rgba(255,255,255,.18)' },
  { mode: 'battle', color: '#ff6b61', background: 'rgba(255,59,48,.24)' },
  { mode: 'party', color: '#d0a4fd', background: 'rgba(192,132,252,.24)' },
]

export function ModeTabs({ mode }: { mode: SessionMode }) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  return (
    <div
      className="flex items-center"
      style={{ background: SURFACE.raised, borderRadius: '999px', padding: u(4), border: `1px solid ${SURFACE.line}` }}
      data-testid="mode-segmented-control"
    >
      {MODE_TABS.map((tab) => {
        const isActive = mode === tab.mode
        return (
          <button
            key={tab.mode}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              if (isActive) return
              playSfx('click')
              useSessionStore.getState().setMode(tab.mode)
            }}
            className="transition-colors duration-150"
            style={{
              padding: `${u(7)} ${u(18)}`,
              borderRadius: '999px',
              fontSize: u(17),
              fontWeight: isActive ? 700 : 600,
              color: isActive ? tab.color : TEXT.secondary,
              background: isActive ? tab.background : 'transparent',
              cursor: isActive ? 'default' : 'pointer',
            }}
          >
            {t(SESSION_MODE_LABEL_KEYS[tab.mode])}
          </button>
        )
      })}
    </div>
  )
}
