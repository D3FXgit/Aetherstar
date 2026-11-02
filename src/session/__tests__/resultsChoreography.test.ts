import { describe, it, expect } from 'vitest'
import {
  BEAT_ORDER,
  beatSchedule,
  countDurationMs,
  isAtLeast,
  scorePadWidth,
  formatRollingScore,
  SCORE_TICK_MIN_INTERVAL_MS,
  shouldTick,
} from '../resultsChoreography'

describe('resultsChoreography beat order', () => {
  // The six beats and their order are the user-facing specification for this
  // screen; everything else here (durations, easing) is tuning. Pinning the
  // order in a pure test means a refactor of the component cannot quietly
  // reorder the celebration.
  it('names the six beats in the specified order', () => {
    expect(BEAT_ORDER).toEqual(['winner', 'crown', 'slide', 'roster', 'count', 'actions'])
  })

  it('gives every beat a strictly increasing start offset', () => {
    const schedule = beatSchedule(10000)
    const offsets = BEAT_ORDER.map((beat) => schedule[beat])
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1])
    }
  })

  it('starts the winner beat immediately -- the payoff is not behind a delay', () => {
    expect(beatSchedule(10000).winner).toBe(0)
  })

  it('places the actions beat after the counter has finished rolling', () => {
    const score = 10000
    const schedule = beatSchedule(score)
    expect(schedule.actions).toBeGreaterThanOrEqual(schedule.count + countDurationMs(score))
  })

  // A party screen is seen once per song. The whole sequence has to be over in
  // a few seconds even at a huge score, or it stops being a reward.
  it('reaches the actions beat inside 4s even for an enormous score', () => {
    expect(beatSchedule(999999).actions).toBeLessThanOrEqual(4000)
  })
})

describe('countDurationMs', () => {
  it('is clamped to a floor so a tiny score still reads as a count, not a cut', () => {
    expect(countDurationMs(0)).toBe(countDurationMs(1))
    expect(countDurationMs(0)).toBeGreaterThanOrEqual(800)
  })

  it('is clamped to a ceiling so a huge score does not roll forever', () => {
    expect(countDurationMs(10_000_000)).toBeLessThanOrEqual(1900)
  })

  it('scales between the two clamps -- a bigger number takes longer to arrive', () => {
    expect(countDurationMs(30000)).toBeGreaterThan(countDurationMs(2000))
  })
})

describe('isAtLeast', () => {
  it('is true for the beat itself and every earlier beat', () => {
    expect(isAtLeast('slide', 'winner')).toBe(true)
    expect(isAtLeast('slide', 'slide')).toBe(true)
  })

  it('is false for beats that have not been reached', () => {
    expect(isAtLeast('slide', 'count')).toBe(false)
    expect(isAtLeast('winner', 'crown')).toBe(false)
  })
})

describe('score formatting', () => {
  // Fixed-width padding is what stops the digits jittering as the number grows:
  // "0000" -> "10000" must never change how much horizontal space the readout
  // occupies mid-roll.
  it('pads to at least four digits, matching the "0000" start state', () => {
    expect(scorePadWidth(40)).toBe(4)
    expect(formatRollingScore(0, 4)).toBe('0000')
    expect(formatRollingScore(40, 4)).toBe('0040')
  })

  it('widens the pad for scores that need more than four digits', () => {
    expect(scorePadWidth(10000)).toBe(5)
    expect(formatRollingScore(0, 5)).toBe('00000')
    expect(formatRollingScore(10000, 5)).toBe('10000')
  })

  it('rounds rather than truncates, so the roll lands exactly on the final score', () => {
    expect(formatRollingScore(9999.6, 5)).toBe('10000')
  })

  it('never emits a negative or fractional readout', () => {
    expect(formatRollingScore(-3, 4)).toBe('0000')
  })
})

describe('SCORE_TICK_MIN_INTERVAL_MS', () => {
  // scoreTick is a 35ms sample. Firing it per animation frame (~16.7ms at
  // 60fps) would overlap every instance with the next and smear into noise.
  it('is comfortably longer than the 35ms sample it gates', () => {
    expect(SCORE_TICK_MIN_INTERVAL_MS).toBeGreaterThan(35)
  })

  it('still ticks often enough to read as counting, not as a handful of blips', () => {
    expect(1000 / SCORE_TICK_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(8)
  })
})

describe('shouldTick', () => {
  // Two gates, both required. The clock gate keeps the 35ms scoreTick sample
  // from overlapping itself into a buzz; the text gate keeps it silent through
  // the long decelerating tail of the roll, where the value is still changing
  // by fractions but the visible digits are not. Sound tracks what you can see.
  it('ticks when the visible digits changed and the interval has elapsed', () => {
    expect(shouldTick(SCORE_TICK_MIN_INTERVAL_MS, 0, '0420', '0410')).toBe(true)
  })

  it('stays silent when the interval has not elapsed, however fast the digits move', () => {
    expect(shouldTick(SCORE_TICK_MIN_INTERVAL_MS - 1, 0, '0420', '0410')).toBe(false)
  })

  it('stays silent when the visible digits have not changed', () => {
    expect(shouldTick(1000, 0, '0420', '0420')).toBe(false)
  })
})
