import { describe, expect, it } from 'vitest'
import { averageOffsetMs } from '../measureLatency'

describe('averageOffsetMs', () => {
  it('returns 0 for exact-sync taps', () => {
    expect(averageOffsetMs([0, 500, 1000], [0, 500, 1000])).toBe(0)
  })

  it('returns the constant offset for consistently-late taps', () => {
    expect(averageOffsetMs([0, 500, 1000], [50, 550, 1050])).toBe(50)
  })

  it('averages out jitter around a true offset', () => {
    // A true 30ms offset with +/-10ms jitter per beat: 20, 40, 20, 40 -> mean 30.
    const commanded = [0, 500, 1000, 1500]
    const tapped = [20, 540, 1020, 1540]
    expect(averageOffsetMs(commanded, tapped)).toBeCloseTo(30, 5)
  })
})
