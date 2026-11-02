import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE_SEMITONES,
  hzToSemitone,
  isWithinSemitoneTolerance,
  matchPitch,
  pitchClassOf,
  snapWindowSemitones,
} from '../hzToPitchClass'

const at = (cents: number) => 440 * Math.pow(2, cents / 1200)

describe('hzToSemitone', () => {
  it('converts A4 (440 Hz) to semitone 69', () => {
    expect(hzToSemitone(440)).toBeCloseTo(69, 1)
  })
})

describe('pitchClassOf', () => {
  it('reduces a semitone to its pitch class (0-11)', () => {
    expect(pitchClassOf(69)).toBe(9)
    expect(pitchClassOf(60)).toBe(0)
  })

  it('is negative-safe (JS % can return negative)', () => {
    expect(pitchClassOf(-3)).toBe(9)
  })
})

describe('isWithinSemitoneTolerance', () => {
  it('rounds the sung pitch to the nearest semitone before comparing', () => {
    expect(isWithinSemitoneTolerance(49, 0)).toBe(true)
    expect(isWithinSemitoneTolerance(51, 0)).toBe(false)
    expect(isWithinSemitoneTolerance(149, 1)).toBe(true)
    expect(isWithinSemitoneTolerance(151, 1)).toBe(false)
    expect(isWithinSemitoneTolerance(-249, 2)).toBe(true)
    expect(isWithinSemitoneTolerance(-251, 2)).toBe(false)
  })

  it('is symmetric at the half-semitone boundary', () => {
    expect(isWithinSemitoneTolerance(150, 1)).toBe(isWithinSemitoneTolerance(-150, 1))
  })

  it('never accepts a non-finite deviation', () => {
    expect(isWithinSemitoneTolerance(Number.NaN, 2)).toBe(false)
  })

  it('defaults to Normal (one semitone)', () => {
    expect(DEFAULT_TOLERANCE_SEMITONES).toBe(1)
  })
})

describe('snapWindowSemitones', () => {
  it('is exactly the raw-pitch window that rounds into tolerance', () => {
    expect(snapWindowSemitones(0)).toBe(0.5)
    expect(snapWindowSemitones(1)).toBe(1.5)
    expect(snapWindowSemitones(2)).toBe(2.5)
  })
})

describe('matchPitch', () => {
  it('scores an exact pitch-class match as ~0 deviation, epic tier', () => {
    const result = matchPitch(440, 9)
    expect(result.deviationCents).toBeCloseTo(0, 0)
    expect(result.tier).toBe('epic')
  })

  it('is octave-agnostic: a detected pitch one octave up from the note still scores near 0', () => {
    const result = matchPitch(880, 9)
    expect(result.deviationCents).toBeCloseTo(0, 0)
    expect(result.tier).toBe('epic')
  })

  it('reports a signed deviation', () => {
    expect(matchPitch(at(45), 9).deviationCents).toBeCloseTo(45, 0)
    expect(matchPitch(at(-45), 9).deviationCents).toBeCloseTo(-45, 0)
  })

  it('judges hit/miss by semitone tolerance, and keeps cents only for the cosmetic tier', () => {
    expect(matchPitch(at(30), 9, 0).tier).toBe('epic')
    expect(matchPitch(at(45), 9, 0).tier).toBe('good')
    expect(matchPitch(at(60), 9, 0).tier).toBe('awful')
    expect(matchPitch(at(120), 9, 1).tier).toBe('good')
    expect(matchPitch(at(220), 9, 1).tier).toBe('awful')
    expect(matchPitch(at(220), 9, 2).tier).toBe('good')
  })
})
