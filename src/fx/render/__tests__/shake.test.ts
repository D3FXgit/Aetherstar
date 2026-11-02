import { describe, expect, it } from 'vitest'
import { computeShakeOffset } from '../shake'

describe('computeShakeOffset', () => {
  it('bounds the offset magnitude by maxOffsetPx at the start', () => {
    const { x, y } = computeShakeOffset(0, 300, 8, () => 1)
    expect(Math.abs(x)).toBeLessThanOrEqual(8)
    expect(Math.abs(y)).toBeLessThanOrEqual(8)
  })

  it('decays to zero exactly at the shake duration', () => {
    expect(computeShakeOffset(300, 300, 8, () => 1)).toEqual({ x: 0, y: 0 })
  })

  it('stays zero past the shake duration', () => {
    expect(computeShakeOffset(600, 300, 8, () => 1)).toEqual({ x: 0, y: 0 })
  })
})
