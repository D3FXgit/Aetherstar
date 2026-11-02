import { describe, expect, it } from 'vitest'
import { computeGainRamp } from '../gainRamp'

describe('computeGainRamp', () => {
  it('adds the ramp duration (in seconds) to "now" for the end time, and returns the target gain unchanged', () => {
    expect(computeGainRamp(0.1, 1, 500, 10)).toEqual({ targetGain: 1, endTimeSeconds: 10.5 })
  })

  it('a zero-duration ramp ends exactly at "now", never NaN or negative', () => {
    const result = computeGainRamp(1, 0, 0, 10)
    expect(result.endTimeSeconds).toBe(10)
    expect(Number.isNaN(result.endTimeSeconds)).toBe(false)
    expect(result.endTimeSeconds).toBeGreaterThanOrEqual(0)
  })
})
