import { describe, it, expect } from 'vitest'
import { hzToNoteName } from '../noteName'

describe('hzToNoteName', () => {
  it('440 Hz is A4 with 0 cents', () => {
    expect(hzToNoteName(440)).toEqual({ name: 'A4', cents: 0 })
  })

  it('220 Hz is A3 with 0 cents', () => {
    expect(hzToNoteName(220)).toEqual({ name: 'A3', cents: 0 })
  })

  it('261.63 Hz is C4 (middle C) with ~0 cents', () => {
    const result = hzToNoteName(261.63)
    expect(result.name).toBe('C4')
    expect(Math.abs(result.cents)).toBeLessThanOrEqual(1)
  })

  it('466.16 Hz is A#4 with ~0 cents', () => {
    const result = hzToNoteName(466.16)
    expect(result.name).toBe('A#4')
    expect(Math.abs(result.cents)).toBeLessThanOrEqual(1)
  })

  it('a slightly sharp 445 Hz still reads as A4 with a small positive cents offset', () => {
    const result = hzToNoteName(445)
    expect(result.name).toBe('A4')
    expect(result.cents).toBeGreaterThan(0)
    expect(result.cents).toBeLessThan(50)
  })

  it('a slightly flat 435 Hz still reads as A4 with a small negative cents offset', () => {
    const result = hzToNoteName(435)
    expect(result.name).toBe('A4')
    expect(result.cents).toBeLessThan(0)
    expect(result.cents).toBeGreaterThan(-50)
  })
})
