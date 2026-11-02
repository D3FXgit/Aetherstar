import { hzToSemitone } from './hzToPitchClass'

/**
 * Aligns a detected Hz into the same octave range as `referencePitch` (a
 * chart pitch integer), so the live pitch line's Y position (computed via
 * the note lane's own pitch-range scale) visually lines up with note blocks
 * when the singer is on pitch. Not independently tested -- simple glue,
 * covered by Gameplay's integration test.
 */
export function octaveAlign(hz: number, referencePitch: number): number {
  const detectedSemitone = hzToSemitone(hz)
  const octaveShift = Math.round((detectedSemitone - referencePitch) / 12)
  return detectedSemitone - octaveShift * 12
}
