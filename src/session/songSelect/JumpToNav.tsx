import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import { ACCENT_CYAN, FOCUS_OUTLINE_GUTTER, SURFACE, TEXT, sectionLabelStyle, u } from './layout'

interface JumpToNavProps {
  letters: [string, number][]
  activeLetter: string | null
  onChange: (letter: string | null) => void
}

/** The alphabet rail: one whole row per letter, the only thing legible from a sofa. */
export function JumpToNav({ letters, activeLetter, onChange }: JumpToNavProps) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  return (
    <div
      className="flex shrink-0 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ width: u(180), gap: u(10), padding: FOCUS_OUTLINE_GUTTER }}
      data-testid="jump-to-nav"
    >
      <span style={{ ...sectionLabelStyle, marginBottom: u(4) }}>{t('songSelect.jumpTo')}</span>
      {letters.map(([letter, count]) => {
        const isActive = activeLetter === letter
        return (
          <button
            key={letter}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              playSfx('click')
              onChange(isActive ? null : letter)
            }}
            className="flex shrink-0 items-center justify-between transition-colors duration-150 hover:bg-[var(--ae-surface-hover,#2a2638)]"
            style={{
              padding: `${u(12)} ${u(18)}`,
              borderRadius: u(14),
              background: isActive ? 'oklch(0.78 0.19 195 / .2)' : SURFACE.raised,
              border: `1px solid ${isActive ? ACCENT_CYAN : SURFACE.line}`,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: u(24), color: TEXT.primary }}>{letter}</span>
            <span style={{ fontWeight: 500, fontSize: u(16), color: TEXT.secondary, fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
