import { useT } from '../i18n'

interface SearchBarProps {
  onQueryChange: (query: string) => void
  resultCount: number
}

export function SearchBar({ onQueryChange, resultCount }: SearchBarProps) {
  const t = useT()
  return (
    <input
      type="search"
      role="searchbox"
      aria-label={t('songSelect.search.label')}
      placeholder={t('songSelect.search.placeholder', { count: resultCount })}
      // No `outline-none`: the app's focus ring is the only cue a gamepad user gets here.
      className="rounded-full border border-[var(--ae-line,rgba(255,255,255,0.09))] bg-[var(--ae-surface-raised,#1f1c2a)] text-[var(--ae-text-primary)] placeholder:text-[var(--ae-text-tertiary)]"
      // In the selector's design unit, so it grows on a 4K TV; 1px where no unit is in scope.
      style={{
        paddingInline: 'calc(24 * var(--u, 1px))',
        paddingBlock: 'calc(14 * var(--u, 1px))',
        fontSize: 'calc(18 * var(--u, 1px))',
        minWidth: 'calc(320 * var(--u, 1px))',
      }}
      onChange={(event) => onQueryChange(event.target.value)}
    />
  )
}
