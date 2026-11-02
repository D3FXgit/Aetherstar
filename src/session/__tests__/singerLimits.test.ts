import { describe, expect, it } from 'vitest'
import { VERSUS_SINGER_COUNT, canStartWith, clampLineupForMode, maxSingersFor, minSingersFor } from '../singerLimits'

describe('singerLimits', () => {
  it('caps Versus at two singers, and at the mics there are', () => {
    expect(VERSUS_SINGER_COUNT).toBe(2)
    expect(maxSingersFor('battle', 8)).toBe(2)
    expect(maxSingersFor('battle', 1)).toBe(1)
  })

  it('lets Solo/Duet pick one singer per claimable mic', () => {
    expect(maxSingersFor('classic', 8)).toBe(8)
    expect(maxSingersFor('classic', 3)).toBe(3)
  })

  it('starts Versus with exactly two, anything else with at least one', () => {
    expect(minSingersFor('battle')).toBe(2)
    expect(minSingersFor('classic')).toBe(1)
    expect([0, 1, 2, 3].map((n) => canStartWith('battle', n))).toEqual([false, false, true, false])
    expect([0, 1, 8].map((n) => canStartWith('classic', n))).toEqual([false, true, true])
  })

  it('trims a Versus line-up to its first two picks and leaves others untouched', () => {
    const lineup = ['a', 'b', 'c']
    expect(clampLineupForMode(lineup, 'battle')).toEqual(['a', 'b'])
    expect(clampLineupForMode(lineup, 'classic')).toBe(lineup)
    const duel = ['a', 'b']
    expect(clampLineupForMode(duel, 'battle')).toBe(duel)
  })
})
