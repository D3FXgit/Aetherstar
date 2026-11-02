/**
 * Keeps the vocal stem locked to the clock element.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, NOT ASSUMED
 *
 * Two <audio> elements playing the same generated tone were driven from a rAF
 * loop in real Chromium and their `currentTime` compared every frame. Three
 * results shaped this file:
 *
 * 1. In steady state they barely drift at all. Over 30 seconds: mean |drift|
 *    0.01 ms, p95 0.03 ms, worst 0.23 ms, and the start offset after seeding
 *    the follower from the clock and calling play() on both was 0.03 ms. They
 *    share one output-device clock, so two elements are a viable way to do
 *    this -- no Web Audio graph is needed for sync.
 *
 * 2. A stall is permanent. Pausing the follower for 180 ms (standing in for a
 *    decode underrun) left it 209 ms behind for the rest of the song, with no
 *    tendency to recover. So correction is mandatory even though steady-state
 *    drift is negligible.
 *
 * 3. *** Seeking a playing element is worse than the problem it fixes. ***
 *    This is the finding that dictates the whole design. Assigning
 *    `currentTime` on a playing element reports success almost immediately
 *    (drift ~1 ms right after the `seeked` event, which itself fires in 1-2 ms)
 *    and then costs 55-80 ms of playback time over the following 600 ms.
 *    Measured directly: starting from 0.0 ms drift, one corrective seek left
 *    74.7 ms of drift 600 ms later. A correction loop that re-seeks therefore
 *    never converges -- it fires forever, roughly once per cooldown, and each
 *    firing is an audible discontinuity in the guide vocal. An early version
 *    of this file did exactly that: 113 re-seeks for a single stall.
 *    Pausing, seeking while paused, and resuming costs the same 60-80 ms, and
 *    seeking ahead to compensate was not reliably repeatable (26-38 ms
 *    residual for a fixed 40 ms lead).
 *
 * So: this never seeks or pauses the stem to correct it. `playbackRate` is the
 * only tool, which is glitch-free and, measured across caps of 4% and 8%,
 * converges monotonically with zero overshoot every time.
 * ---------------------------------------------------------------------------
 *
 * The thresholds:
 *
 * - `deadbandMs: 20`. Below this, unity rate and no correction at all. Two
 *   correlated tracks read as one performance while they are within roughly
 *   20 ms; that is comfortably under the ~30-40 ms echo threshold at which a
 *   listener hears two separate attacks, and about a 1/32 note at 120 BPM,
 *   which is ordinary live-band tightness. Given result (1), the stem sits
 *   inside this band essentially all of the time.
 *
 * - `maxRateDeviation: 0.06`, reached at `fullCorrectionAtMs: 150`. Chromium's
 *   default `preservesPitch = true` makes a rate change a time-stretch rather
 *   than a pitch shift, so the artifact is mild warble rather than a
 *   transposition. 6% is far looser than the video clock's 5% is tight,
 *   because unlike the video this has to be able to claw back a real stall:
 *   measurement showed the achieved rate change is roughly half of what is
 *   asked for, so a 180 ms stall recovers in ~6 seconds at this cap. It only
 *   ever engages after a fault -- and a few seconds of slight warble on the
 *   guide vocal is much better than a permanent 200 ms flam, which is what
 *   result (2) gives you for free and what result (3) says you cannot seek
 *   your way out of.
 *
 * - `abandonMs: 1500`. Past this the stem is not recoverable by rate alone in
 *   any musical timeframe (a dying file, repeated underruns), and since
 *   seeking is off the table there is nothing left to try. The caller mutes
 *   and stops it. The song is unaffected: the instrumental is the clock.
 *
 * Nothing here can ever touch the clock element. The stem follows; the clock
 * leads, always.
 */
export const STEM_SYNC = {
  deadbandMs: 20,
  fullCorrectionAtMs: 150,
  maxRateDeviation: 0.06,
  abandonMs: 1500,
} as const

// Chosen so the correction reaches its full cap exactly at fullCorrectionAtMs.
const CORRECTION_GAIN = STEM_SYNC.maxRateDeviation / (STEM_SYNC.fullCorrectionAtMs / 1000)

export interface StemCorrection {
  /** playbackRate to set on the stem element. Always 1 inside the deadband. */
  playbackRate: number
  /** The stem is too far gone to pull back; stop trying and silence it. */
  abandon: boolean
}

/**
 * @param clockMs the authoritative element's currentTime, in ms
 * @param stemMs the follower's currentTime, in ms
 */
export function computeStemCorrection(input: { clockMs: number; stemMs: number }): StemCorrection {
  const { clockMs, stemMs } = input
  const driftMs = clockMs - stemMs // positive: the stem is running late

  if (!Number.isFinite(driftMs)) return { playbackRate: 1, abandon: false }
  if (Math.abs(driftMs) >= STEM_SYNC.abandonMs) return { playbackRate: 1, abandon: true }
  if (Math.abs(driftMs) < STEM_SYNC.deadbandMs) return { playbackRate: 1, abandon: false }

  const nudge = (driftMs / 1000) * CORRECTION_GAIN
  const clamped = Math.max(-STEM_SYNC.maxRateDeviation, Math.min(STEM_SYNC.maxRateDeviation, nudge))
  return { playbackRate: 1 + clamped, abandon: false }
}
