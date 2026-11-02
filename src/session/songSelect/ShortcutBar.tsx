// The bottom bar: filter chips, the button hints and the library status.
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { useSfx } from '../../audio/useSfx'
import { LibraryScanStatus } from '../../library/LibraryScanStatus'
import type { LibrarySearchFilters, ScanProgress } from '../../library/types'
import { SORT_LABEL_KEYS, SORT_ORDERS, nextInCycle } from './filters'
import { SURFACE, TEXT, filterChipActiveStyle, filterChipStyle, u } from './layout'

interface ShortcutBarProps {
  filters: LibrarySearchFilters
  languages: string[]
  jukebox: boolean
  isReindexing: boolean
  scanProgress: Record<string, ScanProgress>
  indexedCount: number
  onSearch: (filters: LibrarySearchFilters) => void
  onShuffle: () => void
  onRefresh: () => void
}

/** A controller/keyboard hint: the pad button, then the key. */
function ButtonHint({ pad, keyName, children }: { pad: string; keyName: string; children: ReactNode }) {
  return (
    <span className="flex items-center" style={{ gap: u(8), fontSize: u(16), color: TEXT.secondary }}>
      <kbd
        className="flex items-center justify-center"
        style={{
          minWidth: u(30),
          height: u(30),
          borderRadius: '999px',
          background: SURFACE.hover,
          color: TEXT.primary,
          fontWeight: 700,
          fontSize: u(15),
          fontFamily: 'inherit',
        }}
      >
        {pad}
      </kbd>
      <kbd
        style={{
          padding: `0 ${u(7)}`,
          borderRadius: u(6),
          border: `1px solid ${SURFACE.line}`,
          color: TEXT.tertiary,
          fontSize: u(14),
          fontFamily: 'inherit',
        }}
      >
        {keyName}
      </kbd>
      <span>{children}</span>
    </span>
  )
}

export function ShortcutBar({
  filters,
  languages,
  jukebox,
  isReindexing,
  scanProgress,
  indexedCount,
  onSearch,
  onShuffle,
  onRefresh,
}: ShortcutBarProps) {
  const t = useT()
  const playSfx = useSfx((state) => state.play)
  const sort = filters.sort ?? 'artist'

  return (
    <div
      className="flex shrink-0 flex-wrap items-center"
      style={{
        marginTop: u(20),
        gap: u(14),
        padding: `${u(16)} ${u(22)}`,
        borderRadius: u(20),
        background: SURFACE.panel,
        border: `1px solid ${SURFACE.line}`,
      }}
    >
      <div className="flex flex-1 flex-wrap items-center" style={{ gap: u(10) }}>
        <button
          type="button"
          onClick={() => {
            playSfx('click')
            onSearch({ ...filters, favoritesOnly: !filters.favoritesOnly })
          }}
          aria-pressed={Boolean(filters.favoritesOnly)}
          style={filters.favoritesOnly ? filterChipActiveStyle : filterChipStyle}
        >
          {t('songSelect.filter.favorites')}
        </button>
        <button
          type="button"
          onClick={() => onSearch({ ...filters, duetOnly: !filters.duetOnly })}
          aria-pressed={Boolean(filters.duetOnly)}
          style={filters.duetOnly ? filterChipActiveStyle : filterChipStyle}
        >
          {t('songSelect.filter.duets')}
        </button>
        {/* One chip cycles every order, so each is one press away on a gamepad. */}
        <button
          type="button"
          onClick={() => {
            playSfx('click')
            onSearch({ ...filters, sort: nextInCycle(SORT_ORDERS, sort) ?? 'artist' })
          }}
          style={sort !== 'artist' ? filterChipActiveStyle : filterChipStyle}
        >
          {t('songSelect.sort.label', { order: t(SORT_LABEL_KEYS[sort]) })}
        </button>
        {/* Only offered when there is a choice to make. */}
        {(languages.length > 1 || filters.language) && (
          <button
            type="button"
            onClick={() => {
              playSfx('click')
              onSearch({ ...filters, language: nextInCycle(languages, filters.language) })
            }}
            aria-pressed={Boolean(filters.language)}
            style={filters.language ? filterChipActiveStyle : filterChipStyle}
          >
            {t('songSelect.filter.language', { language: filters.language ?? t('songSelect.filter.languageAll') })}
          </button>
        )}
        <button type="button" onClick={onShuffle} style={filterChipStyle}>
          {t('songSelect.filter.random')}
        </button>
        {/* Stays enabled during a scan (the store refuses a second walk), so gamepad focus is never dropped. */}
        <button type="button" onClick={onRefresh} aria-busy={isReindexing} style={filterChipStyle}>
          {t('songSelect.filter.refresh')}
        </button>
      </div>
      <div className="flex items-center" style={{ gap: u(18) }} data-testid="shortcut-hints">
        <ButtonHint pad="Y" keyName="F">
          {t('songSelect.hint.favorite')}
        </ButtonHint>
        {jukebox && (
          <ButtonHint pad="X" keyName="Q">
            {t('songSelect.hint.addToQueue')}
          </ButtonHint>
        )}
      </div>
      <div style={{ fontWeight: 500, fontSize: u(16), color: TEXT.secondary }}>
        <LibraryScanStatus isReindexing={isReindexing} scanProgress={scanProgress} indexedCount={indexedCount} />
      </div>
    </div>
  )
}
