import type { PitchSample } from '../contracts/types'

export interface CalibrationAdjustment {
  inputOffsetMs: number
  transpositionSemitones: number
}

/**
 * Shifts capture timestamps by the measured input latency and scales detected
 * Hz to undo a player's deliberate transposition, so judgeNote/reconcileClock/
 * octaveAlign never need to know calibration exists. `null` is the identity.
 */
export function applyCalibration(samples: PitchSample[], adjustment: CalibrationAdjustment | null): PitchSample[] {
  if (!adjustment) return samples

  const { inputOffsetMs, transpositionSemitones } = adjustment
  const hzScale = Math.pow(2, transpositionSemitones / 12)

  return samples.map((sample) => ({
    ...sample,
    t: sample.t - inputOffsetMs,
    hz: sample.hz * hzScale,
  }))
}
