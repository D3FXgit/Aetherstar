import { describe, expect, it } from 'vitest'
import { dialAngleForValue } from '../dialAngleForValue'

describe('dialAngleForValue', () => {
  it('maps the min value to -90 degrees', () => {
    expect(dialAngleForValue(0, 0, 200)).toBe(-90)
  })

  it('maps the max value to 90 degrees', () => {
    expect(dialAngleForValue(200, 0, 200)).toBe(90)
  })

  it('maps the midpoint value to 0 degrees', () => {
    expect(dialAngleForValue(100, 0, 200)).toBe(0)
  })

  it('clamps values outside [min, max]', () => {
    expect(dialAngleForValue(-50, 0, 200)).toBe(-90)
    expect(dialAngleForValue(500, 0, 200)).toBe(90)
  })
})
