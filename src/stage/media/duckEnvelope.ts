import type { HitTier } from '../../contracts/types'

/**
 * The guide-vocal ducking envelope.
 *
 * The effect: while the singer is actually on pitch, the recorded vocal steps
 * back and lets them have the song; the moment they lose it, the guide comes
 * back to lead them. Every number below is an audio-feel decision, so here is
 * the reasoning for each.
 *
 * - `attenuationDb: -12`. Not a mute. Muting removes the pitch reference at
 *   exactly the moment the singer is using it, so the first wrong note has
 *   nothing to recover towards, and the on/off contrast is jarring. -12 dB
 *   (a quarter of the amplitude) is squarely in the range broadcast ducking
 *   uses (8-15 dB): unmistakably out of the way, still audible underneath.
 *
 * - `attackMs: 120`. The duck has to land inside the note that earned it. A
 *   beat at 120 BPM is 500 ms and a typical sung syllable is 250-500 ms, so
 *   120 ms is fast enough to feel like a response to *this* note and slow
 *   enough that it reads as a fade rather than a cut.
 *
 * - `releaseMs: 450`, deliberately ~4x the attack. Asymmetry is what stops the
 *   envelope fighting per-note hit granularity: hits arrive as discrete
 *   events, one per note, so a symmetric envelope would pump audibly on every
 *   note boundary. Ducking fast and recovering slowly means a run of good
 *   notes reads as one continuous duck.
 *
 * - `holdMs: 600`. The gap between two consecutive hit events is a whole
 *   note's length, and a phrase contains rests. Holding the ducked level for
 *   600 ms after the last good note -- longer than a beat at any singable
 *   tempo -- keeps the duck steady across a phrase instead of releasing in
 *   every gap. Combined with the 450 ms release, one genuinely bad note takes
 *   about a second to bring the guide vocal all the way back, which is the
 *   intended feel: the guide returns when you have *lost* the line, not when
 *   you clip one note.
 *
 * Implementation note: this ramps `HTMLMediaElement.volume` from a rAF loop
 * rather than a Web Audio GainNode. A GainNode would give sample-accurate
 * ramps, but routing the element through an AudioContext makes the guide
 * vocal depend on that context staying running -- a new silent-audio failure
 * mode on the playback path -- and this app's only AudioContext belongs to a
 * different subsystem. At 60 Hz over a 120 ms attack the ramp is ~7 steps of a
 * smooth exponential curve, which is well inside the range where volume
 * stepping is inaudible.
 */
export const DUCK = {
  attenuationDb: -12,
  attackMs: 120,
  releaseMs: 450,
  holdMs: 600,
} as const

/** Linear gain the vocal stem is pulled down to while the singer is on pitch. */
export const DUCKED_GAIN = 10 ** (DUCK.attenuationDb / 20)

/** Tiers that count as "the singer has this note" -- anything but a miss. */
export function isDuckingTier(tier: HitTier): boolean {
  return tier === 'epic' || tier === 'good'
}

/**
 * Target gain right now.
 *
 * @param msSinceQualifyingHit time since the last non-'awful' hit, or null if there has never been one
 */
export function duckTargetGain(msSinceQualifyingHit: number | null): number {
  if (msSinceQualifyingHit === null) return 1
  return msSinceQualifyingHit <= DUCK.holdMs ? DUCKED_GAIN : 1
}

// A one-pole ramp reaches ~95% of its target in 3 time constants, so the
// documented attack/release times above are the audible durations.
const TIME_CONSTANT_DIVISOR = 3

/** One frame of exponential approach toward `target`. Frame-rate independent. */
export function nextDuckGain(input: { current: number; target: number; dtMs: number }): number {
  const { current, target, dtMs } = input
  if (!Number.isFinite(dtMs) || dtMs <= 0) return current

  const goingDown = target < current
  const tauMs = (goingDown ? DUCK.attackMs : DUCK.releaseMs) / TIME_CONSTANT_DIVISOR
  const alpha = 1 - Math.exp(-dtMs / tauMs)
  const next = current + (target - current) * alpha

  // Volume is clamped hard: an out-of-range assignment throws in the DOM.
  return Math.min(1, Math.max(0, next))
}
