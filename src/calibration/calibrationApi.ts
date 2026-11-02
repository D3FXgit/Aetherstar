// Thin window.api.calibration.* wrapper that degrades gracefully outside
// Electron, like src/audio/api.ts.
import type { CalibrationSettings } from './types'
import { DEFAULT_CALIBRATION_SETTINGS } from './types'

function calibrationApi() {
  return window.api?.calibration
}

export const get = (): Promise<CalibrationSettings> => calibrationApi()?.get() ?? Promise.resolve(DEFAULT_CALIBRATION_SETTINGS)

export const set = (settings: CalibrationSettings): Promise<void> =>
  calibrationApi()
    ? calibrationApi()!.set(settings).then(() => undefined)
    : Promise.resolve()
