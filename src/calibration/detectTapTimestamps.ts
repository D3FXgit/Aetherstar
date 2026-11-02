import type { PitchSample } from '../contracts/types'

const DEFAULT_CONFIDENCE_THRESHOLD = 0.5
const DEFAULT_REFRACTORY_MS = 200
/**
 * Unvoiced frames never reach the sample stream -- the pitch worker only emits
 * a sample when it hears a pitch -- so the silence between two taps usually
 * shows up as *no samples at all* rather than as low-confidence ones. A hole
 * longer than this between consecutive samples is therefore read as the signal
 * having dropped (a falling edge). ~60 ms is several analysis hops, so a
 * single late or dropped frame inside one sustained sound does not split it.
 */
const DEFAULT_MAX_GAP_MS = 60

/**
 * Detects a "tap" as a rising edge in `confidence` crossing `confidenceThreshold`,
 * with a refractory window so one sustained vocalization only counts once. A
 * gap of more than `maxGapMs` between consecutive samples counts as a falling
 * edge too (see DEFAULT_MAX_GAP_MS). Works on the PitchSample stream as-is,
 * with no raw-waveform onset detection.
 */
export function detectTapTimestamps(
  samples: PitchSample[],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
  refractoryMs: number = DEFAULT_REFRACTORY_MS,
  maxGapMs: number = DEFAULT_MAX_GAP_MS,
): number[] {
  const taps: number[] = []
  let wasAboveThreshold = false
  let lastTapT: number | null = null
  let previousT: number | null = null

  for (const sample of samples) {
    // Nothing arrived for a while: the sound stopped, even though no
    // below-threshold sample said so.
    if (previousT !== null && sample.t - previousT > maxGapMs) wasAboveThreshold = false
    previousT = sample.t

    const isAboveThreshold = sample.confidence >= confidenceThreshold

    if (isAboveThreshold && !wasAboveThreshold) {
      const withinRefractory = lastTapT !== null && sample.t - lastTapT < refractoryMs
      if (!withinRefractory) {
        taps.push(sample.t)
        lastTapT = sample.t
      }
    }

    wasAboveThreshold = isAboveThreshold
  }

  return taps
}
