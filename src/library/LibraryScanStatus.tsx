// The selector's quiet scan readout: determinate whenever the scanner has
// streamed real counts, and never covering or blocking the grid.
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import type { ScanProgress } from './types'

interface LibraryScanStatusProps {
  isReindexing: boolean
  scanProgress: Record<string, ScanProgress>
  indexedCount: number
}

export function LibraryScanStatus({ isReindexing, scanProgress, indexedCount }: LibraryScanStatusProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const active = Object.values(scanProgress).filter((entry) => !entry.done)
  const parsed = active.reduce((total, entry) => total + entry.songsParsed, 0)
  const found = active.reduce((total, entry) => total + entry.songsFound, 0)

  if (!isReindexing) {
    return (
      <span
        role="status"
        aria-live="polite"
        data-testid="library-scan-status"
        className="ml-auto normal-case tracking-normal text-[var(--ae-text-tertiary)]"
      >
        {t('songSelect.status.indexed', { count: indexedCount })}
      </span>
    )
  }

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="library-scan-status"
      className="ml-auto flex items-center gap-3 normal-case tracking-normal text-[var(--ae-text-secondary)]"
    >
      <span>{t('songSelect.status.refreshing')}</span>
      {/* No numbers before the first progress event: a bar pinned at zero reads as "stuck". */}
      {found > 0 && (
        <>
          <span className="tabular-nums text-[var(--ae-text-primary)]">
            {parsed.toLocaleString()} / {found.toLocaleString()}
          </span>
          <span
            role="progressbar"
            aria-label={t('songSelect.status.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={found}
            aria-valuenow={parsed}
            className="block h-1 w-28 overflow-hidden rounded-full bg-white/10"
          >
            <motion.span
              className="block h-full rounded-full bg-white/70"
              initial={false}
              animate={{ width: `${Math.min(100, (parsed / found) * 100)}%` }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.3 }}
            />
          </span>
        </>
      )}
    </span>
  )
}
