import { describe, expect, it } from 'vitest'
import {
  BEAT_HIT_FRACTION,
  meanDeviationCents,
  measureCoverage,
  ONSET_GRACE_MS,
  PITCH_WINDOW_MS,
  SAMPLE_HOLD_MS,
  type CoverageSample,
} from '../noteCoverage'
import { isWithinSemitoneTolerance } from '../hzToPitchClass'

const START = 1000
const BEATS = 4
const MS_PER_BEAT = 250
const END = START + BEATS * MS_PER_BEAT
const NORMAL = (cents: number) => isWithinSemitoneTolerance(cents, 1)

/** One sample every `stepMs` over [from, to) ms relative to the note's start, all `cents` off. */
function run(from: number, to: number, cents = 0, stepMs = 10): CoverageSample[] {
  const samples: CoverageSample[] = []
  for (let t = from; t < to; t += stepMs) samples.push({ t: START + t, deviationCents: cents })
  return samples
}

function measure(samples: CoverageSample[], observedUntil?: number | null) {
  return measureCoverage(samples, START, END, BEATS, NORMAL, observedUntil)
}

describe('measureCoverage: per-beat credit', () => {
  it('credits a note sung all the way through in full', () => {
    const result = measure(run(0, 1000))
    expect(result.credit).toBe(1)
    expect(result.coverage).toBeCloseTo(1, 5)
    expect(result.beatsHit).toBe(4)
  })

  it('reports nothing at all for a note with no samples', () => {
    const result = measure([])
    expect(result.credit).toBe(0)
    expect(result.coverage).toBe(0)
    expect(result.beatsCharged).toBe(4)
  })

  it('pays in whole beats: a half-note sung pays half', () => {
    expect(measure(run(0, 500)).credit).toBe(0.5)
    expect(measure(run(500, 1000)).credit).toBe(0.5)
  })

  it('needs at least BEAT_HIT_FRACTION of a beat to count it', () => {
    expect(BEAT_HIT_FRACTION).toBe(0.5)
    // Beat 2 is [500, 750]: singing to 600 (+ hold) covers less than half of it.
    expect(measure(run(0, 560)).credit).toBe(0.5)
    // Singing to 640 (+45 ms hold) covers more than half of it.
    expect(measure(run(0, 640)).credit).toBe(0.75)
  })

  it('does not credit the part of a note sung out of tolerance', () => {
    const samples = [...run(0, 500, 0), ...run(500, 1000, 400)]
    expect(measure(samples).credit).toBe(0.5)
  })

  it('costs nothing when the detector drops a frame mid-note', () => {
    const samples = run(0, 1000, 0, 30).filter((_, i) => i !== 10)
    expect(measure(samples).credit).toBe(1)
  })

  it('excuses the onset grace, which nobody can start instantly', () => {
    expect(measure(run(ONSET_GRACE_MS, 1000)).credit).toBe(1)
  })

  it('evaluates in-tolerance on a vibrato-length window, so vibrato survives', () => {
    // +/-120 cent vibrato at 5 Hz averages to well inside one semitone.
    const samples: CoverageSample[] = []
    for (let t = 0; t < 1000; t += 10) samples.push({ t: START + t, deviationCents: 120 * Math.sin((2 * Math.PI * 5 * t) / 1000) })
    expect(measureCoverage(samples, START, END, BEATS, (c) => isWithinSemitoneTolerance(c, 0)).credit).toBe(1)
    expect(PITCH_WINDOW_MS).toBe(200)
  })

  // Review finding: deviations are octave-folded onto (-600, 600], so a singer
  // ~6 semitones off flips between about +599 and -599. Averaged linearly that
  // is ~0 -- dead on pitch -- and a tritone off scored in full.
  it('averages on the octave circle, so a tritone-off singer flipping +-599 is not judged on pitch', () => {
    const samples: CoverageSample[] = []
    for (let t = 0; t < 1000; t += 10) samples.push({ t: START + t, deviationCents: (t / 10) % 2 === 0 ? 599 : -599 })
    const result = measure(samples)
    expect(result.credit).toBe(0)
    expect(result.onPitchSamples).toBe(0)
    expect(meanDeviationCents(samples)).toBeCloseTo(600, 0)
  })

  it('still averages small deviations as the arithmetic mean would', () => {
    expect(meanDeviationCents([{ deviationCents: 40 }, { deviationCents: -20 }])).toBeCloseTo(10, 0)
  })

  it('reports the accuracy of the in-tolerance part only', () => {
    const samples = [...run(0, 700, 10), ...run(700, 1000, 500)]
    expect(measure(samples).onPitchDeviationCents).toBeCloseTo(10, 0)
  })

  describe('audio that has not arrived yet', () => {
    it('is not charged to the singer', () => {
      const result = measure(run(0, 500), START + 500)
      expect(result.credit).toBe(1)
      expect(result.beatsCharged).toBe(2)
    })

    it('does not become a way to be credited for silence', () => {
      expect(measure(run(0, 200), START + 1000).credit).toBe(0.25)
    })
  })

  describe('without a clock that can place the note', () => {
    it('falls back to the fraction of samples that were in tolerance', () => {
      const samples = [...run(0, 500, 0), ...run(500, 1000, 400)]
      expect(measureCoverage(samples, null, null, BEATS, NORMAL).credit).toBeCloseTo(0.5, 1)
      expect(measureCoverage(samples, START, null, BEATS, NORMAL).credit).toBeCloseTo(0.5, 1)
    })
  })

  it('weights a fractional last beat by its length', () => {
    // 2.5 beats: the sung first two beats are 2 / 2.5 of the note.
    const result = measureCoverage(run(0, 500), START, START + 625, 2.5, NORMAL)
    expect(result.credit).toBeCloseTo(2 / 2.5, 5)
  })

  it('holds a sample for a couple of detector frames, and no more', () => {
    expect(SAMPLE_HOLD_MS).toBeLessThanOrEqual(100)
  })
})
