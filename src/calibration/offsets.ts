/**
 * Bounds for a measured latency offset. Real speaker or mic chains sit in the
 * tens to low hundreds of ms; a full second is already far past any working
 * setup, so anything beyond it is a measurement fault (a mistimed tap, or the
 * clock-origin bug that once produced offsets of minutes or ~1.7e12 ms) and
 * must never reach #GAP or the pitch timestamps.
 */
export const MAX_CALIBRATION_OFFSET_MS = 1000

/** Clamp a freshly measured offset into ±MAX_CALIBRATION_OFFSET_MS; non-finite reads as 0. */
export function clampCalibrationOffsetMs(ms: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0
  return Math.max(-MAX_CALIBRATION_OFFSET_MS, Math.min(MAX_CALIBRATION_OFFSET_MS, ms))
}

/** True for a stored offset that a working measurement could have produced. */
export function isPlausibleOffsetMs(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_CALIBRATION_OFFSET_MS
}

/**
 * The mic step plays its clicks through the speakers, so its raw click-to-tap
 * delay is speaker delay + reaction + mic-chain delay, while the speaker step's
 * key tap measures speaker delay + reaction. Gameplay already applies the
 * speaker delay by moving the notes later (#GAP + outputOffsetMs) and then
 * subtracts the mic offset from capture timestamps, so storing the raw figure
 * would count the speaker delay twice. What belongs to the mic is the
 * difference.
 */
export function micOffsetFromMeasurement(rawInputMs: number, outputOffsetMs: number): number {
  return clampCalibrationOffsetMs(rawInputMs - outputOffsetMs)
}
