import { describe, expect, it } from 'vitest'
import { PEAK_HOLD_MS, VU_FLOOR_DB, decayPeak, rmsToDb, vuFraction } from '../levelScale'

describe('rmsToDb', () => {
  it('maps full scale to 0 dBFS', () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 5)
  })

  it('maps half amplitude to about -6 dBFS', () => {
    expect(rmsToDb(0.5)).toBeCloseTo(-6.02, 1)
  })

  // log10(0) is -Infinity, which propagates into a style width as "NaN%" and
  // leaves the bar permanently broken. Silence is the *normal* state of an
  // unused mic row, so it has to be the well-behaved case, not an edge case.
  it('returns the floor for digital silence rather than -Infinity', () => {
    expect(rmsToDb(0)).toBe(VU_FLOOR_DB)
    expect(Number.isFinite(rmsToDb(0))).toBe(true)
  })

  it('clamps negative and non-finite input to the floor', () => {
    expect(rmsToDb(-0.5)).toBe(VU_FLOOR_DB)
    expect(rmsToDb(Number.NaN)).toBe(VU_FLOOR_DB)
  })
})

describe('vuFraction', () => {
  it('is 1 at full scale and 0 at the floor', () => {
    expect(vuFraction(1)).toBeCloseTo(1, 5)
    expect(vuFraction(0)).toBe(0)
  })

  it('never leaves the 0..1 range even for out-of-range input', () => {
    expect(vuFraction(4)).toBe(1)
    expect(vuFraction(-1)).toBe(0)
  })

  // The whole point of plotting a meter in dB rather than raw amplitude: a
  // quiet-but-audible voice must occupy a visible part of the bar. On a linear
  // amplitude scale -40 dBFS is 1% wide and reads as "dead mic", which is
  // exactly the diagnosis this meter exists to prevent someone making.
  it('gives a quiet signal a visible share of the bar', () => {
    const quiet = vuFraction(0.01) // -40 dBFS
    expect(quiet).toBeGreaterThan(0.2)
    expect(quiet).toBeLessThan(0.65)
  })

  it('increases monotonically with level', () => {
    const points = [0, 0.001, 0.01, 0.1, 0.3, 0.7, 1].map(vuFraction)
    const sorted = [...points].sort((a, b) => a - b)
    expect(points).toEqual(sorted)
  })
})

describe('decayPeak', () => {
  it('jumps straight to a new higher level', () => {
    expect(decayPeak(0.2, 0.9, 16)).toBe(0.9)
  })

  it('holds the peak briefly instead of dropping with the signal', () => {
    expect(decayPeak(0.9, 0.1, 10)).toBe(0.9)
  })

  it('falls back toward the current level once the hold has elapsed', () => {
    const decayed = decayPeak(0.9, 0.1, PEAK_HOLD_MS + 100)
    expect(decayed).toBeLessThan(0.9)
    expect(decayed).toBeGreaterThanOrEqual(0.1)
  })

  it('never falls below the current level', () => {
    expect(decayPeak(0.5, 0.4, 10_000)).toBeGreaterThanOrEqual(0.4)
  })
})
