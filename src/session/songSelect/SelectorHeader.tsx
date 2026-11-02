import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import { BackButton } from '../../scenes/SceneHeader'
import { SearchBar } from '../../library/SearchBar'
import type { ScanErrorEntry } from '../../library/types'
import type { SessionMode } from '../types'
import { ModeTabs } from './ModeTabs'
import { ScanErrorsButton } from './ScanErrorsDialog'
import { ACCENT_CYAN, BACK_BUTTON_STYLE, TEXT, u } from './layout'

interface SelectorHeaderProps {
  mode: SessionMode
  visibleCount: number
  resultCount: number
  activeLetter: string | null
  scanErrors: ScanErrorEntry[]
  onClearLetter: () => void
  onQueryChange: (query: string) => void
}

export function SelectorHeader({
  mode,
  visibleCount,
  resultCount,
  activeLetter,
  scanErrors,
  onClearLetter,
  onQueryChange,
}: SelectorHeaderProps) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const jukebox = mode === 'jukebox'

  return (
    <header className="flex shrink-0 flex-wrap items-end justify-between" style={{ gap: u(24), marginBottom: u(36) }}>
      <div className="flex flex-col" style={{ gap: u(16) }}>
        {/* Back leads the title row (HIG: a top-toolbar Back, on the leading side). */}
        <div className="flex items-center" style={{ gap: u(20) }}>
          <BackButton style={BACK_BUTTON_STYLE} />
          <h1 style={{ fontSize: u(40), fontWeight: 800, lineHeight: 1, letterSpacing: '.12em', color: TEXT.primary }}>
            AETHERSTAR
          </h1>
          <span style={{ fontSize: u(30), fontWeight: 500, color: TEXT.secondary }}>
            {jukebox ? t('songSelect.jukebox.title') : t('songSelect.title')}
          </span>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: u(14) }}>
          {jukebox ? (
            <span
              style={{
                padding: `${u(7)} ${u(18)}`,
                borderRadius: '999px',
                background: 'oklch(0.85 0.16 85 / .2)',
                color: 'oklch(0.9 0.12 85)',
                fontSize: u(17),
                fontWeight: 700,
              }}
              data-testid="jukebox-mode-label"
            >
              {t('songSelect.mode.jukebox')}
            </span>
          ) : (
            <ModeTabs mode={mode} />
          )}
          {activeLetter && (
            // The way back out of a letter filter, so it is a real control.
            <button
              type="button"
              onClick={() => {
                playSfx('back')
                onClearLetter()
              }}
              aria-label={t('songSelect.letter.clear', { letter: activeLetter })}
              style={{
                padding: `${u(6)} ${u(16)}`,
                borderRadius: '999px',
                background: 'oklch(0.78 0.19 195 / .2)',
                border: `1px solid ${ACCENT_CYAN}`,
                fontWeight: 700,
                fontSize: u(18),
                color: TEXT.primary,
              }}
            >
              {activeLetter} ×
            </button>
          )}
          <span style={{ fontSize: u(18), color: TEXT.secondary }}>{t('songSelect.count', { count: visibleCount })}</span>
          <ScanErrorsButton errors={scanErrors} />
        </div>
      </div>
      <SearchBar onQueryChange={onQueryChange} resultCount={resultCount} />
    </header>
  )
}
