import { describe, expect, it } from 'vitest'
import { secondsUntilGap } from '../secondsUntilGap'

describe('secondsUntilGap', () => {
  it('rounds up the remaining time before the fixture\'s GAP', () => {
    expect(secondsUntilGap(0, 24065)).toBe(25)
  })

  it('is 0 once GAP has been reached', () => {
    expect(secondsUntilGap(24065, 24065)).toBe(0)
  })

  it('never goes negative past GAP', () => {
    expect(secondsUntilGap(30000, 24065)).toBe(0)
  })
})
