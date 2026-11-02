import { describe, expect, it } from 'vitest'
import { DIFFICULTY_TOLERANCE_SEMITONES, toleranceSemitonesFor } from '../difficulty'

describe('toleranceSemitonesFor', () => {
  it('maps each preset to its UltraStar-style semitone tolerance', () => {
    expect(toleranceSemitonesFor('easy')).toBe(2)
    expect(toleranceSemitonesFor('normal')).toBe(1)
    expect(toleranceSemitonesFor('hard')).toBe(0)
  })

  it('gets strictly stricter from Easy to Hard', () => {
    const { easy, normal, hard } = DIFFICULTY_TOLERANCE_SEMITONES
    expect(easy).toBeGreaterThan(normal)
    expect(normal).toBeGreaterThan(hard)
  })
})
