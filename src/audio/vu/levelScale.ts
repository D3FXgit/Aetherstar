/**
 * Pure level maths for the input meters on the player matrix.
 *
 * Kept separate from any component so the scaling can be tested for real --
 * jsdom has no layout, so asserting on a rendered bar's width proves nothing,
 * whereas these functions are the part that can actually be wrong.
 */

/**
 * Quietest level the meter shows. Below this the bar reads empty.
 *
 * -60 dBFS rather than the -inf the maths would otherwise give: a live mic in
 * a quiet room sits around -55 to -45 dBFS on room tone alone, so a floor much
 * lower would spend most of the bar's length rendering silence, and one much
 * higher would show room tone as signal and make an unplugged mic hard to tell
 * from a working one.
 */
export const VU_FLOOR_DB = -60

/** How long a peak stays pinned before it starts falling back. */
export const PEAK_HOLD_MS = 800

/** Fraction of the remaining distance the peak falls per second once the hold expires. */
const PEAK_DECAY_PER_SECOND = 0.6

/**
 * Convert an RMS amplitude (0..1) to dBFS, with silence pinned to the floor.
 *
 * `20 * log10(0)` is -Infinity, and an infinite value flowing into a CSS width
 * yields `NaN%`, which leaves the bar broken for the rest of the session. An
 * idle mic row is silent by default, so this is the common path, not an edge.
 */
export function rmsToDb(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return VU_FLOOR_DB
  return Math.max(VU_FLOOR_DB, 20 * Math.log10(Math.min(rms, 1)))
}

/**
 * Convert an RMS amplitude to the 0..1 fraction of the meter to fill.
 *
 * Plotted on the dB scale rather than raw amplitude, because amplitude is
 * perceptually wrong here: -40 dBFS -- a quiet but perfectly audible voice --
 * is 1% of a linear bar and looks identical to a dead input. The meter exists
 * to answer "is this mic working", so the quiet end is the end that matters.
 */
export function vuFraction(rms: number): number {
  const db = rmsToDb(rms)
  return Math.min(1, Math.max(0, (db - VU_FLOOR_DB) / -VU_FLOOR_DB))
}

/**
 * Advance a held peak marker by `elapsedMs`.
 *
 * A bare instantaneous bar is nearly unreadable for speech or singing: the
 * signal is spiky, and the tallest excursion -- the bit that says "this input
 * is hot" -- is on screen for a single frame. Holding it makes the meter
 * legible at a glance from across a room.
 */
export function decayPeak(peak: number, current: number, elapsedMs: number): number {
  if (current >= peak) return current
  if (elapsedMs < PEAK_HOLD_MS) return peak

  const decaySeconds = (elapsedMs - PEAK_HOLD_MS) / 1000
  const fallen = peak - (peak - current) * (1 - Math.pow(1 - PEAK_DECAY_PER_SECOND, decaySeconds))
  return Math.max(current, fallen)
}
