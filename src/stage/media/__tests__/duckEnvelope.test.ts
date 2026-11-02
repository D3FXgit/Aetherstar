import { describe, expect, it } from 'vitest'
import { DUCK, DUCKED_GAIN, duckTargetGain, isDuckingTier, nextDuckGain } from '../duckEnvelope'

/** Runs the envelope forward at 60fps and returns the gain after `ms`. */
function rampFor(ms: number, { from, target }: { from: number; target: number }): number {
  let gain = from
  for (let elapsed = 0; elapsed < ms; elapsed += 16.7) {
    gain = nextDuckGain({ current: gain, target, dtMs: 16.7 })
  }
  return gain
}

describe('duck target', () => {
  it('ducks on a good or epic hit and not on a miss', () => {
    expect(isDuckingTier('epic')).toBe(true)
    expect(isDuckingTier('good')).toBe(true)
    expect(isDuckingTier('awful')).toBe(false)
  })

  it('is full volume before the singer has landed anything', () => {
    expect(duckTargetGain(null)).toBe(1)
  })

  it('attenuates to -12dB, not to silence — the singer still needs the pitch reference', () => {
    expect(duckTargetGain(0)).toBeCloseTo(DUCKED_GAIN, 5)
    expect(DUCKED_GAIN).toBeCloseTo(0.2512, 3)
    expect(DUCKED_GAIN).toBeGreaterThan(0)
  })

  it('holds the duck across the gap between notes instead of releasing in every rest', () => {
    // Hit events arrive one per note; a hold shorter than a note's length
    // would make the guide vocal pump on every note boundary.
    expect(duckTargetGain(DUCK.holdMs - 1)).toBeCloseTo(DUCKED_GAIN, 5)
    expect(duckTargetGain(DUCK.holdMs + 1)).toBe(1)
    expect(DUCK.holdMs).toBeGreaterThan(500) // longer than a beat at 120bpm
  })
})

describe('nextDuckGain', () => {
  it('lands the duck inside the note that earned it', () => {
    const gain = rampFor(DUCK.attackMs, { from: 1, target: DUCKED_GAIN })
    // ~95% of the way down after one full attack time.
    expect(gain).toBeLessThan(1 - 0.9 * (1 - DUCKED_GAIN))
    expect(gain).toBeGreaterThanOrEqual(DUCKED_GAIN)
  })

  it('releases far more slowly than it ducks, so a single clipped note cannot make it pump', () => {
    const duckedAfterAttack = 1 - rampFor(DUCK.attackMs, { from: 1, target: DUCKED_GAIN })
    const releasedAfterAttack = rampFor(DUCK.attackMs, { from: DUCKED_GAIN, target: 1 }) - DUCKED_GAIN

    expect(releasedAfterAttack).toBeLessThan(duckedAfterAttack)
    expect(DUCK.releaseMs).toBeGreaterThan(DUCK.attackMs * 3)
  })

  it('is frame-rate independent: one 100ms step lands where six 16.7ms steps do', () => {
    const oneBigStep = nextDuckGain({ current: 1, target: DUCKED_GAIN, dtMs: 100.2 })
    const manySmallSteps = rampFor(100.2, { from: 1, target: DUCKED_GAIN })

    expect(oneBigStep).toBeCloseTo(manySmallSteps, 2)
  })

  it('never leaves the 0..1 range HTMLMediaElement.volume will accept', () => {
    expect(nextDuckGain({ current: 1, target: 5, dtMs: 1000 })).toBeLessThanOrEqual(1)
    expect(nextDuckGain({ current: 0, target: -5, dtMs: 1000 })).toBeGreaterThanOrEqual(0)
  })

  it('holds still on a zero or non-finite frame delta', () => {
    expect(nextDuckGain({ current: 0.4, target: 1, dtMs: 0 })).toBe(0.4)
    expect(nextDuckGain({ current: 0.4, target: 1, dtMs: Number.NaN })).toBe(0.4)
  })
})
