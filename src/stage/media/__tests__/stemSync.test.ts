import { describe, expect, it } from 'vitest'
import { computeStemCorrection, STEM_SYNC } from '../stemSync'

describe('computeStemCorrection', () => {
  it('does nothing at all inside the deadband — two tracks within 20ms read as one performance', () => {
    for (const driftMs of [0, 5, -5, 19, -19]) {
      expect(computeStemCorrection({ clockMs: 10_000 + driftMs, stemMs: 10_000 })).toEqual({
        playbackRate: 1,
        abandon: false,
      })
    }
  })

  it('speeds the stem up when it is running late, and slows it when early', () => {
    const late = computeStemCorrection({ clockMs: 10_030, stemMs: 10_000 })
    const early = computeStemCorrection({ clockMs: 10_000, stemMs: 10_030 })

    expect(late.playbackRate).toBeGreaterThan(1)
    expect(early.playbackRate).toBeLessThan(1)
  })

  // Regression guard for the finding that dictated this whole design: a
  // corrective seek on a *playing* element costs 55-80ms of playback time, so
  // a loop that re-seeks never converges and glitches the guide vocal on every
  // firing. There is deliberately no seek output at all.
  it('never asks for a seek, at any drift — rate is the only correction tool', () => {
    for (const driftMs of [0, 25, 100, 500, 2000, -2000]) {
      const correction = computeStemCorrection({ clockMs: 10_000 + driftMs, stemMs: 10_000 })
      expect(correction).not.toHaveProperty('seekToMs')
      expect(Object.keys(correction).sort()).toEqual(['abandon', 'playbackRate'])
    }
  })

  it('reaches its full cap exactly at the full-correction threshold, and never exceeds it', () => {
    const atFull = computeStemCorrection({ clockMs: 10_000 + STEM_SYNC.fullCorrectionAtMs, stemMs: 10_000 })
    expect(atFull.playbackRate).toBeCloseTo(1 + STEM_SYNC.maxRateDeviation, 6)

    for (const driftMs of [200, 600, 1400, -200, -1400]) {
      const { playbackRate } = computeStemCorrection({ clockMs: 10_000 + driftMs, stemMs: 10_000 })
      expect(Math.abs(playbackRate - 1)).toBeLessThanOrEqual(STEM_SYNC.maxRateDeviation + 1e-9)
    }
  })

  it('scales the nudge with the error, so a small drift gets a small correction', () => {
    const small = computeStemCorrection({ clockMs: 10_030, stemMs: 10_000 }).playbackRate - 1
    const large = computeStemCorrection({ clockMs: 10_100, stemMs: 10_000 }).playbackRate - 1

    expect(large).toBeGreaterThan(small)
    expect(small).toBeLessThan(STEM_SYNC.maxRateDeviation)
  })

  it('gives up once the stem is beyond any rate-only recovery, rather than warbling forever', () => {
    // Seeking is not an option (it costs more playback time than it saves), so
    // an unrecoverable stem is silenced instead of chased.
    const correction = computeStemCorrection({ clockMs: 20_000, stemMs: 10_000 })

    expect(correction.abandon).toBe(true)
    expect(correction.playbackRate).toBe(1)
  })

  it('is inert when a currentTime is NaN (an element that has not loaded yet)', () => {
    expect(computeStemCorrection({ clockMs: Number.NaN, stemMs: 0 })).toEqual({ playbackRate: 1, abandon: false })
  })
})
