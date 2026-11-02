import { describe, expect, it } from 'vitest'
import { computeDuckedVolume } from '../duckVolume'

describe('computeDuckedVolume', () => {
  it('reduces volume proportionally to the duck amount', () => {
    expect(computeDuckedVolume(1, 0.5)).toBe(0.5)
  })

  it('clamps at 0', () => {
    expect(computeDuckedVolume(0.2, 0.9)).toBeGreaterThanOrEqual(0)
  })

  it('leaves volume unchanged when duckAmount is 0', () => {
    expect(computeDuckedVolume(1, 0)).toBe(1)
  })
})
