import { usePitchStore } from '../../audio/pitchStore'
import { useT } from '../../i18n'

/**
 * The bottom status pill: how many mic captures are running. No latency
 * figure -- nothing measures end-to-end mic latency, so none is shown.
 */
export function MicStatusPill() {
  const t = useT()
  const micCount = usePitchStore((state) => Object.keys(state.activeCaptures).length)

  if (micCount === 0) return null

  return (
    // Solid, no backdrop blur: it sits over playing video for the whole song.
    <div data-testid="mic-status-pill" className="flex items-center gap-2 rounded-full bg-black/65 px-4 py-2">
      <span className="text-sm font-medium text-[var(--ae-text-secondary)]">{t('sing.micsLive', { count: micCount })}</span>
    </div>
  )
}
