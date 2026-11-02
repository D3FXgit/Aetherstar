import { describe, expect, it } from 'vitest'
import { computeFrameStats } from '../frameStats'

describe('computeFrameStats', () => {
  it('computes fps/frameTimeMs from a rolling buffer of steady 60fps-spaced timestamps', () => {
    const stats = computeFrameStats([0, 16.6, 33.3, 50.0])
    expect(stats.frameTimeMs).toBeCloseTo(16.66, 0)
    expect(stats.fps).toBeCloseTo(60, 0)
  })

  it('returns zeroed stats for fewer than two timestamps, never NaN', () => {
    expect(computeFrameStats([])).toEqual({ fps: 0, frameTimeMs: 0 })
    expect(computeFrameStats([42])).toEqual({ fps: 0, frameTimeMs: 0 })
  })

  it('reflects a stall by averaging it into the buffer, not masking it', () => {
    const steady = computeFrameStats([0, 16.6, 33.3, 50.0, 66.6])
    const withStall = computeFrameStats([0, 16.6, 33.3, 50.0, 150.0])
    expect(withStall.frameTimeMs).toBeGreaterThan(steady.frameTimeMs)
    expect(withStall.fps).toBeLessThan(steady.fps)
  })
})
