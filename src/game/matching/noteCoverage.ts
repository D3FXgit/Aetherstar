/**
 * How much of a note the singer actually sang in tolerance, beat by beat.
 *
 * # UltraStar-style per-beat credit
 *
 * UltraStar awards points per beat: every beat of a note the singer holds in
 * tolerance pays the same share, so a note sung for three of its four beats
 * pays three quarters. That is what `credit` is here -- the (length-weighted)
 * fraction of the note's beats judged hit -- and it replaces the old
 * "coverage, then a 35% floor and a 90% full-credit cliff, then a tier rate"
 * chain, which charged a near-miss twice (once in coverage, again by dropping
 * from the epic rate to the good rate).
 *
 * # How a beat is judged
 *
 * Time, not sample counts: the detector emits nothing for silence (see
 * usePitchStore's `isPitched`), so "fraction of samples in tolerance" would
 * score a singer who sang one beat and stopped at 100%.
 *
 * 1. **A per-sample verdict over a vibrato-length window** (`PITCH_WINDOW_MS`).
 *    Each sample is judged on the signed (circular) mean deviation of the
 *    samples within 100 ms of it, which averages a 4-7 Hz vibrato away while a
 *    note sung flat then sharp still fails in each half. The caller decides what "in
 *    tolerance" means for that mean (semitone rounding for pitched notes,
 *    always-true for rap).
 * 2. **A hold around each sample** (`SAMPLE_HOLD_MS`). One sample speaks for
 *    the moment around it, so a dropped detector frame costs nothing.
 * 3. **An onset grace** (`ONSET_GRACE_MS`, capped at a quarter of the note):
 *    the consonant/glide at the start of a syllable is not charged.
 * 4. **A beat is hit** when at least `BEAT_HIT_FRACTION` of its charged time
 *    is covered by in-tolerance holds. A beat entirely inside the grace, or
 *    entirely beyond the audio heard so far, is not charged at all.
 */

/** Window the per-sample verdict averages over -- one cycle of real vibrato (4-7 Hz). */
export const PITCH_WINDOW_MS = 200

/** How long one sample speaks for, centred on its own timestamp (~3x the detector's hop). */
export const SAMPLE_HOLD_MS = 90

/** How much of a note's start is not charged to the singer -- the consonant, the glide, the breath. */
export const ONSET_GRACE_MS = 60

/** ...never more than this share of the note, so a short note is not mostly grace. */
export const ONSET_GRACE_MAX_FRACTION = 0.25

/** Share of a beat's charged time that must be in tolerance for the beat to count as hit. */
export const BEAT_HIT_FRACTION = 0.5

/** One in-span sample, reduced to the two things coverage cares about. */
export interface CoverageSample {
  /** Capture timestamp, ms. Ascending. */
  t: number
  /** Signed cents from the note's pitch (octave-aligned). 0 for activity-only (rap) samples. */
  deviationCents: number
}

export interface CoverageResult {
  /** Fraction of the note's charged duration covered by in-tolerance singing, 0..1. */
  coverage: number
  /** Length-weighted fraction of the note's charged beats judged hit, 0..1 -- the points multiplier. */
  credit: number
  /** Beats hit (length-weighted). */
  beatsHit: number
  /** Beats charged (length-weighted). */
  beatsCharged: number
  /**
   * Signed mean deviation over the in-tolerance samples only -- the off-pitch
   * part has already cost beats, so it does not also pull the accuracy figure.
   */
  onPitchDeviationCents: number
  /** How many samples passed the windowed in-tolerance test. */
  onPitchSamples: number
}

/** One octave: deviations are octave-folded onto (-600, 600], a circle this long. */
const OCTAVE_CENTS = 1200
const RADIANS_PER_CENT = (2 * Math.PI) / OCTAVE_CENTS

/**
 * Below this mean resultant length (|mean of unit vectors|) the deviations point
 * every which way and have no meaningful mean: a singer alternating between
 * +300 and -300 is not "on average on pitch". Judged as the furthest a
 * deviation can be.
 */
const MIN_RESULTANT = 1e-6

/** The circular mean of one window's (sin, cos) sums, in cents on (-600, 600]. */
function circularMeanCents(sinSum: number, cosSum: number, count: number): number {
  if (count <= 0 || Math.hypot(sinSum, cosSum) / count < MIN_RESULTANT) return OCTAVE_CENTS / 2
  return Math.atan2(sinSum, cosSum) / RADIANS_PER_CENT
}

/** The circular mean of octave-folded deviations, in cents (see `windowedMeans` for why not the arithmetic one). */
export function meanDeviationCents(samples: readonly { deviationCents: number }[]): number {
  let sinSum = 0
  let cosSum = 0
  for (const sample of samples) {
    const angle = sample.deviationCents * RADIANS_PER_CENT
    sinSum += Math.sin(angle)
    cosSum += Math.cos(angle)
  }
  return circularMeanCents(sinSum, cosSum, samples.length)
}

/**
 * Signed mean of `deviationCents` within `windowMs / 2` of each sample, in one
 * two-pointer pass.
 *
 * A **circular** mean on the 1200-cent octave circle, not an arithmetic one.
 * Deviations are octave-folded (see `matchPitch`), so a singer about six
 * semitones off flips between roughly +599 and -599 from one frame to the next
 * -- and the arithmetic mean of those is about 0, i.e. dead on pitch. On the
 * circle they are neighbours, and their mean is +-600, the furthest off a note
 * can be. For the small deviations of a real vibrato the two means agree.
 */
function windowedMeans(samples: CoverageSample[], windowMs: number): number[] {
  const half = windowMs / 2
  const means = new Array<number>(samples.length)
  const sines = new Array<number>(samples.length)
  const cosines = new Array<number>(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const angle = samples[i].deviationCents * RADIANS_PER_CENT
    sines[i] = Math.sin(angle)
    cosines[i] = Math.cos(angle)
  }

  let low = 0
  let high = 0
  let sinSum = 0
  let cosSum = 0

  for (let i = 0; i < samples.length; i += 1) {
    const centre = samples[i].t
    while (high < samples.length && samples[high].t <= centre + half) {
      sinSum += sines[high]
      cosSum += cosines[high]
      high += 1
    }
    while (low < high && samples[low].t < centre - half) {
      sinSum -= sines[low]
      cosSum -= cosines[low]
      low += 1
    }
    const count = high - low
    means[i] = count > 0 ? circularMeanCents(sinSum, cosSum, count) : samples[i].deviationCents
  }

  return means
}

/** How many beats a note of `lengthBeats` is judged as (a fractional last beat counts as one). */
function beatCount(lengthBeats: number): number {
  return lengthBeats > 0 ? Math.ceil(lengthBeats - 1e-9) : 0
}

/**
 * Measures, per beat, how much of a note was sung in tolerance.
 *
 * `spanStartMs`/`spanEndMs` are the note's edges in capture time (from
 * `ClockBuffer.timeAt`); either may be null when the clock cannot place them
 * (a replay harness, a hand-built test clock). Then there is no honest
 * duration to divide by, and credit falls back to the fraction of the
 * *evidence* that was in tolerance.
 *
 * `observedUntilMs` is how far the audio pipeline has actually been heard;
 * audio still in flight is never charged. Omitted means "all of it".
 */
export function measureCoverage(
  samples: CoverageSample[],
  spanStartMs: number | null,
  spanEndMs: number | null,
  lengthBeats: number,
  isInTolerance: (windowedDeviationCents: number) => boolean,
  observedUntilMs?: number | null,
): CoverageResult {
  const beats = beatCount(lengthBeats)
  if (samples.length === 0) {
    return { coverage: 0, credit: 0, beatsHit: 0, beatsCharged: Math.max(0, lengthBeats), onPitchDeviationCents: 0, onPitchSamples: 0 }
  }

  const means = windowedMeans(samples, PITCH_WINDOW_MS)
  let onPitchSamples = 0
  let onPitchDeviationSum = 0
  const onPitch = new Array<boolean>(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    onPitch[i] = isInTolerance(means[i])
    if (onPitch[i]) {
      onPitchSamples += 1
      onPitchDeviationSum += samples[i].deviationCents
    }
  }
  const onPitchDeviationCents = onPitchSamples > 0 ? onPitchDeviationSum / onPitchSamples : 0

  const evidenceFallback = (): CoverageResult => {
    const ratio = onPitchSamples / samples.length
    const charged = Math.max(0, lengthBeats)
    return { coverage: ratio, credit: ratio, beatsHit: ratio * charged, beatsCharged: charged, onPitchDeviationCents, onPitchSamples }
  }

  const spanMs = spanStartMs !== null && spanEndMs !== null ? spanEndMs - spanStartMs : 0
  if (!(spanMs > 0) || beats === 0) return evidenceFallback()

  const start = spanStartMs as number
  const end = spanEndMs as number
  const graceMs = Math.min(ONSET_GRACE_MS, spanMs * ONSET_GRACE_MAX_FRACTION)
  const from = start + graceMs
  const to =
    observedUntilMs === undefined || observedUntilMs === null || !Number.isFinite(observedUntilMs)
      ? end
      : Math.min(end, observedUntilMs)
  if (!(to - from > 0)) return evidenceFallback()

  // The union of every in-tolerance sample's hold, clipped to [from, to], as
  // sorted disjoint intervals. Samples ascend, so one forward cursor merges.
  const half = SAMPLE_HOLD_MS / 2
  const intervals: number[] = []
  let cursor = from
  let coveredMs = 0
  for (let i = 0; i < samples.length; i += 1) {
    if (!onPitch[i]) continue
    const a = Math.max(samples[i].t - half, cursor)
    const b = Math.min(samples[i].t + half, to)
    if (b > a) {
      intervals.push(a, b)
      coveredMs += b - a
      cursor = b
    }
  }

  // Per beat: charged part of the beat, and how much of it the intervals cover.
  const beatMs = spanMs / lengthBeats
  let hitWeight = 0
  let chargedWeight = 0
  let intervalIndex = 0
  for (let k = 0; k < beats; k += 1) {
    const beatStart = start + k * beatMs
    const beatEnd = Math.min(start + (k + 1) * beatMs, end)
    const weight = (beatEnd - beatStart) / beatMs
    const chargedStart = Math.max(beatStart, from)
    const chargedEnd = Math.min(beatEnd, to)
    if (!(chargedEnd - chargedStart > 0)) continue

    while (intervalIndex < intervals.length && intervals[intervalIndex + 1] <= chargedStart) intervalIndex += 2
    let covered = 0
    for (let j = intervalIndex; j < intervals.length && intervals[j] < chargedEnd; j += 2) {
      covered += Math.max(0, Math.min(intervals[j + 1], chargedEnd) - Math.max(intervals[j], chargedStart))
    }

    chargedWeight += weight
    if (covered / (chargedEnd - chargedStart) >= BEAT_HIT_FRACTION) hitWeight += weight
  }

  const coverage = Math.min(1, Math.max(0, coveredMs / (to - from)))
  if (!(chargedWeight > 0)) {
    return { coverage, credit: coverage, beatsHit: 0, beatsCharged: 0, onPitchDeviationCents, onPitchSamples }
  }

  return {
    coverage,
    credit: Math.min(1, hitWeight / chargedWeight),
    beatsHit: hitWeight,
    beatsCharged: chargedWeight,
    onPitchDeviationCents,
    onPitchSamples,
  }
}
