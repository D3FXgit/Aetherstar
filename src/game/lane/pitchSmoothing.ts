import { DEFAULT_TOLERANCE_SEMITONES, snapWindowSemitones } from '../matching/hzToPitchClass'

/**
 * The two transforms that sit between the raw pitch detector and the pixel the
 * pitch indicator is drawn at.
 *
 * # This layer is *visual only*, and that is the whole point
 *
 * Nothing in this file may ever reach `judgeNote` or the scoring path. The
 * detector's raw output is what the singer actually sang, and it is what has to
 * be scored -- snapping the *scored* value to the nearest target note would
 * hand out points for a note that was never hit, which is the one bug a
 * karaoke game cannot have. Gameplay keeps the two paths physically separate:
 * `pendingSamplesRef` (calibrated, otherwise raw) goes to the judge, and only
 * the indicator's Y goes through here. `Gameplay.test.tsx` pins that.
 *
 * What this fixes is a real problem all the same. A pitch detector's output on
 * a held human note wanders by tens of cents several times a second, which
 * shows up as a line that will not sit still even when the singer is holding a
 * note perfectly -- so the display says "you are wobbling" when the score says
 * "that was excellent". Both of these exist to make the picture agree with the
 * judgement, without letting the picture *become* the judgement.
 */

/**
 * How far off a note the singer can be and still have the indicator pulled
 * dead-centre onto it: exactly the raw-pitch window that the judge rounds into
 * the singer's semitone tolerance (see `snapWindowSemitones`).
 *
 * The line snaps when the note is scoring and drifts off it when it is not.
 * Deriving it from the judge's own tolerance makes "drawn on the note while
 * scoring nothing" (or the reverse) impossible to reintroduce by editing one
 * number.
 *
 * @param toleranceSemitones the singer's semitone tolerance (difficulty).
 */
export function snapThresholdSemitones(toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES): number {
  return snapWindowSemitones(toleranceSemitones)
}

/**
 * Pulls a detected pitch onto the note it is already close to. Callers pass
 * `snapThresholdSemitones(toleranceSemitones)` so the snap follows the window
 * the player is actually being judged by.
 *
 * Both arguments are in the *same octave-aligned semitone space* -- see
 * `octaveAlign` -- so the comparison is a plain subtraction. Outside the
 * threshold the raw value is returned untouched: a singer who is genuinely on
 * the wrong note must see that they are on the wrong note.
 */
export function snapToTarget(
  rawSemitone: number,
  targetSemitone: number | null,
  thresholdSemitones: number = snapThresholdSemitones(),
): number {
  if (targetSemitone === null || !Number.isFinite(targetSemitone)) return rawSemitone
  if (!Number.isFinite(rawSemitone)) return rawSemitone
  return Math.abs(rawSemitone - targetSemitone) <= thresholdSemitones ? targetSemitone : rawSemitone
}

/**
 * How quickly the indicator catches up, as a time constant in milliseconds.
 *
 * This is the time to close ~63% of the remaining distance, *regardless of
 * frame rate*. 55ms is short enough that a deliberate jump between two notes
 * lands inside a sixteenth note at any singable tempo (it is ~96% closed after
 * 165ms), and long enough to absorb the frame-to-frame wander of the detector,
 * which is what makes the line legible at all.
 */
export const PITCH_LERP_TIME_CONSTANT_MS = 55

/**
 * One frame of exponential approach toward `target`.
 *
 * ## Why this is not `current + (target - current) * 0.2`
 *
 * A fixed per-frame factor is a *different filter at every refresh rate*. At
 * 0.2 per frame, 60Hz closes 67% of the gap in 100ms and 120Hz closes 89% of it
 * -- so the same code feels sluggish on one display and twitchy on another, and
 * this app is developed on a 120Hz panel and will be played on 60Hz televisions.
 * It also breaks outright on a dropped frame, where one long frame should move
 * further and instead moves exactly as far as a short one.
 *
 * `1 - exp(-dt/tau)` is the exact discretisation of the continuous first-order
 * filter, so the result after a given number of *milliseconds* is the same
 * whatever the frame rate, and a 33ms frame moves exactly as far as two 16.5ms
 * frames would have. `__tests__/pitchSmoothing.test.ts` asserts that directly.
 *
 * Reduce Motion deliberately does **not** turn this off. The setting exists to
 * suppress motion that is decorative or vestibularly provocative; this is a
 * continuous data readout that moves either way, and the smoothed version moves
 * *less* -- switching it off would replace a glide with a jitter.
 */
export function lerpTowards(
  current: number,
  target: number,
  deltaMs: number,
  timeConstantMs: number = PITCH_LERP_TIME_CONSTANT_MS,
): number {
  if (!Number.isFinite(target)) return current
  if (!Number.isFinite(current)) return target
  // A zero-length frame moves nothing; a zero time constant is "no smoothing".
  if (!(deltaMs > 0)) return current
  if (!(timeConstantMs > 0)) return target

  const alpha = 1 - Math.exp(-deltaMs / timeConstantMs)
  return current + (target - current) * alpha
}
