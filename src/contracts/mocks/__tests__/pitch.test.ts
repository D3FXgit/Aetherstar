import { describe, expect, it } from 'vitest'
import { generatePitchSample } from '../pitch'

const SINGABLE_MIN_HZ = 80
const SINGABLE_MAX_HZ = 1100
const MAX_STEP_HZ = 40

describe('generatePitchSample', () => {
  it('produces a sample within a singable Hz range with a valid confidence and the given deviceId', () => {
    const sample = generatePitchSample(null, 0, 'dev-mic')

    expect(sample.deviceId).toBe('dev-mic')
    expect(sample.t).toBe(0)
    expect(sample.hz).toBeGreaterThanOrEqual(SINGABLE_MIN_HZ)
    expect(sample.hz).toBeLessThanOrEqual(SINGABLE_MAX_HZ)
    expect(sample.confidence).toBeGreaterThanOrEqual(0)
    expect(sample.confidence).toBeLessThanOrEqual(1)
  })

  it('stays within a bounded step of the previous sample (no wild jumps)', () => {
    const first = generatePitchSample(null, 0, 'dev-mic')
    const second = generatePitchSample(first, 1, 'dev-mic')

    expect(Math.abs(second.hz - first.hz)).toBeLessThanOrEqual(MAX_STEP_HZ)
    expect(second.hz).toBeGreaterThanOrEqual(SINGABLE_MIN_HZ)
    expect(second.hz).toBeLessThanOrEqual(SINGABLE_MAX_HZ)
  })
})
