// Calibration-domain types. Kept here rather than in src/contracts/types.ts
// because nothing outside calibration (and electron/calibration) needs them.

export type Difficulty = 'easy' | 'normal' | 'hard'

/**
 * Persisted calibration settings, in three independent parts:
 * outputOffsetMs is global (no output-device
 * targeting exists anywhere in the app); inputDevices is keyed by AudioDevice['id']
 * (a hardware characteristic); players is keyed by PlayerProfile['id'] (a personal
 * characteristic) so a mixed-skill household sharing one mic can each keep their
 * own difficulty/transposition.
 */
export interface CalibrationSettings {
  outputOffsetMs: number
  /**
   * Per-mic input latency. Versioned on disk (electron/calibration/settings.cjs
   * CALIBRATION_SCHEMA_VERSION): offsets measured before native pitch frames
   * were stamped at the window centre are dropped on load, so those mics read
   * as uncalibrated until measured again.
   */
  inputDevices: Record<string, { offsetMs: number }>
  players: Record<string, { difficulty: Difficulty; transpositionSemitones: number }>
}

export const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = {
  outputOffsetMs: 0,
  inputDevices: {},
  players: {},
}
