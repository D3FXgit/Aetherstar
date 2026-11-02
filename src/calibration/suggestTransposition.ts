import { hzToSemitone } from '../game/matching/hzToPitchClass'
import { computePitchRangeScaleFromPitches } from '../game/lane/pitchRangeScale'

/**
 * Suggests a transposition by comparing the player's sung low/high range
 * against the bundled fixture chart's pitch range: the one reference range
 * every install has, independent of which song they'll actually sing.
 */
export function suggestTranspositionSemitones(playerLowHz: number, playerHighHz: number, fixtureNotePitches: number[]): number {
  const playerCenter = (hzToSemitone(playerLowHz) + hzToSemitone(playerHighHz)) / 2
  const { min, max } = computePitchRangeScaleFromPitches(fixtureNotePitches)
  const fixtureCenter = (min + max) / 2

  return Math.round(fixtureCenter - playerCenter)
}
