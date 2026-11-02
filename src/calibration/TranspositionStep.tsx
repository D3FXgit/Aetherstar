import { useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { usePitchStore } from '../audio/pitchStore'
import { suggestTranspositionSemitones } from './suggestTransposition'
import { useT } from '../i18n'

interface TranspositionStepProps {
  deviceId: string
  fixtureNotePitches: number[]
  value: number
  onChange: (transpositionSemitones: number) => void
}

/**
 * Guided transposition: the player captures a comfortable low and high note,
 * a shift is suggested against the bundled fixture chart's range, and they can
 * accept or adjust it.
 */
export function TranspositionStep({ deviceId, fixtureNotePitches, value, onChange }: TranspositionStepProps) {
  const [lowHz, setLowHz] = useState<number | null>(null)
  const [highHz, setHighHz] = useState<number | null>(null)
  const [suggestion, setSuggestion] = useState<number | null>(null)
  const t = useT()

  function captureLow() {
    const hz = usePitchStore.getState().activeCaptures[deviceId]?.latest?.hz
    if (hz === undefined) return
    setLowHz(hz)
    if (highHz !== null) applySuggestion(hz, highHz)
  }

  function captureHigh() {
    const hz = usePitchStore.getState().activeCaptures[deviceId]?.latest?.hz
    if (hz === undefined) return
    setHighHz(hz)
    if (lowHz !== null) applySuggestion(lowHz, hz)
  }

  function applySuggestion(low: number, high: number) {
    const suggested = suggestTranspositionSemitones(low, high, fixtureNotePitches)
    setSuggestion(suggested)
    onChange(suggested)
  }

  return (
    <GlassPanel className="p-6 flex flex-col gap-4" data-testid="transposition-step">
      <h2 className="text-xl font-semibold text-ink-primary">{t('calibration.range.title')}</h2>
      <p className="text-base text-ink-secondary">{t('calibration.range.description')}</p>

      <div className="flex gap-3">
        <GlassButton type="button" onClick={captureLow}>
          {t('calibration.range.captureLow')}
        </GlassButton>
        <GlassButton type="button" onClick={captureHigh}>
          {t('calibration.range.captureHigh')}
        </GlassButton>
      </div>

      {suggestion !== null && (
        <p className="text-base text-ink-secondary" data-testid="transposition-suggestion">
          {t('calibration.range.suggestion', { count: suggestion })}
        </p>
      )}

      <label className="flex items-center gap-3 text-base text-ink-secondary">
        {t('calibration.range.shift.label')}
        <input
          type="number"
          aria-label={t('calibration.range.shift.label')}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-20 rounded-lg border border-line bg-surface-raised px-2 py-1 tabular-nums text-ink-primary"
        />
      </label>
    </GlassPanel>
  )
}
