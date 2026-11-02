import type { HitTier } from '../../contracts/types'
import type { PitchMatch } from '../types'

const A4_HZ = 440
const A4_SEMITONE = 69

/** Standard 12-TET Hz -> semitone (MIDI note number) conversion, A4 = 440 Hz = semitone 69. */
export function hzToSemitone(hz: number): number {
  return 12 * Math.log2(hz / A4_HZ) + A4_SEMITONE
}

/** Reduces a semitone (or any pitch integer) to its pitch class, 0-11. Negative-safe. */
export function pitchClassOf(semitone: number): number {
  return ((Math.round(semitone) % 12) + 12) % 12
}

/**
 * Semitone tolerance at Normal difficulty. UltraStar-style: the sung pitch is
 * rounded to the nearest semitone (octave-independent) and a note is hit when
 * that semitone is within this many of the written one. Easy is 2, Hard is 0
 * (see src/calibration/difficulty.ts).
 */
export const DEFAULT_TOLERANCE_SEMITONES = 1

/**
 * Cosmetic cents bands, kept ONLY for labels and visuals -- they decide
 * nothing about points or hits any more (that is `isWithinSemitoneTolerance`).
 *
 * `epic` (35 cents) is how close a fully-hit note must also be, on average,
 * to read as a dead-on "perfect" note to the FX layer. `good` (50 cents) is the
 * edge of the written semitone itself.
 *
 * @deprecated for judging. Still read by src/game/lane/pitchSmoothing.ts,
 * which should move to `snapWindowSemitones`.
 */
export const TOLERANCE_BANDS_CENTS = { epic: 35, good: 50 } as const

/**
 * Whether a signed, octave-aligned deviation lands within `toleranceSemitones`
 * once the sung pitch is rounded to the nearest semitone. Symmetric at the
 * half-semitone boundaries (|x.5| rounds away from zero both ways).
 */
export function isWithinSemitoneTolerance(deviationCents: number, toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES): boolean {
  if (!Number.isFinite(deviationCents)) return false
  return Math.round(Math.abs(deviationCents) / 100) <= toleranceSemitones
}

/**
 * The raw-pitch window (in semitones either side of a note) that rounds into
 * tolerance: `tolerance + 0.5`. What the pitch indicator's snap should use, so
 * the line is drawn on the note exactly when the note is scoring.
 */
export function snapWindowSemitones(toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES): number {
  return toleranceSemitones + 0.5
}

/**
 * Octave-agnostic pitch match: `notePitch` (the chart's raw UltraStar
 * relative-pitch integer) is snapped to whichever octave is nearest the
 * detected Hz, then the signed cents deviation between the two is measured.
 * Because only the pitch class needs to agree, this never needs to know
 * UltraStar's absolute pitch-to-Hz reference.
 *
 * `tier` is visual only: 'awful' outside tolerance, 'epic' when inside it and
 * within the cosmetic `TOLERANCE_BANDS_CENTS.epic`, else 'good'.
 */
export function matchPitch(hz: number, notePitch: number, toleranceSemitones: number = DEFAULT_TOLERANCE_SEMITONES): PitchMatch {
  const detectedSemitone = hzToSemitone(hz)
  const octaveShift = Math.round((detectedSemitone - notePitch) / 12)
  const targetSemitone = notePitch + octaveShift * 12
  const deviationCents = (detectedSemitone - targetSemitone) * 100

  return { tier: tierForMatch(deviationCents, toleranceSemitones), deviationCents }
}

function tierForMatch(deviationCents: number, toleranceSemitones: number): HitTier {
  if (!isWithinSemitoneTolerance(deviationCents, toleranceSemitones)) return 'awful'
  return Math.abs(deviationCents) <= TOLERANCE_BANDS_CENTS.epic ? 'epic' : 'good'
}
