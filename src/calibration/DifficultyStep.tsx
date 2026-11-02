import { GlassPanel } from '../design/primitives/GlassPanel'
import { useT } from '../i18n'
import type { Difficulty } from './types'

const OPTIONS: { value: Difficulty; labelKey: string }[] = [
  { value: 'easy', labelKey: 'calibration.difficulty.easy' },
  { value: 'normal', labelKey: 'calibration.difficulty.normal' },
  { value: 'hard', labelKey: 'calibration.difficulty.hard' },
]

interface DifficultyStepProps {
  value: Difficulty
  onChange: (difficulty: Difficulty) => void
}

/** Difficulty preset picker; the tolerance per preset lives in difficulty.ts. */
export function DifficultyStep({ value, onChange }: DifficultyStepProps) {
  const t = useT()
  return (
    <GlassPanel className="p-6 flex flex-col gap-3" data-testid="difficulty-step">
      <h2 className="text-xl font-semibold text-ink-primary">{t('calibration.difficulty.title')}</h2>
      <div role="radiogroup" aria-label={t('calibration.difficulty.title')} className="flex gap-6">
        {OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-lg text-ink-secondary">
            <input
              type="radio"
              name="difficulty"
              role="radio"
              aria-checked={value === option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {t(option.labelKey)}
          </label>
        ))}
      </div>
    </GlassPanel>
  )
}
