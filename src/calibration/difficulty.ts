import type { Difficulty } from './types'

/**
 * Pitch tolerance per preset, in semitones, UltraStar-style: the sung pitch is
 * rounded to the nearest semitone (octave-independent) and a beat is hit when
 * it lands within this many semitones of the written note. Tunable in this
 * one file.
 */
export const DIFFICULTY_TOLERANCE_SEMITONES: Record<Difficulty, number> = {
  easy: 2,
  normal: 1,
  hard: 0,
}

export function toleranceSemitonesFor(difficulty: Difficulty): number {
  return DIFFICULTY_TOLERANCE_SEMITONES[difficulty] ?? DIFFICULTY_TOLERANCE_SEMITONES.normal
}
