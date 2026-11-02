import { describe, expect, it } from 'vitest'
import { pickVariation } from '../pickVariation'

describe('pickVariation', () => {
  it('always returns 0 when there is only one sample', () => {
    for (let i = 0; i < 10; i++) {
      expect(pickVariation(1, null)).toBe(0)
    }
  })

  it('returns a value in range on the first pick', () => {
    const picked = pickVariation(3, null)
    expect(picked).toBeGreaterThanOrEqual(0)
    expect(picked).toBeLessThan(3)
  })

  it('never immediately repeats the previous index', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickVariation(3, 1)).not.toBe(1)
    }
  })
})
