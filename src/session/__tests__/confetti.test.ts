import { describe, it, expect } from 'vitest'
import { CONFETTI_COUNT, createConfetti } from '../confetti'

describe('confetti geometry', () => {
  // Performance is the binding constraint on this screen: a results screen is
  // left open for as long as a party wants to look at it, so the burst has to
  // be a bounded, one-shot handful of composited layers -- never an unbounded
  // emitter.
  it('is capped, and the cap is small enough to be free on the compositor', () => {
    expect(CONFETTI_COUNT).toBeLessThanOrEqual(48)
    expect(createConfetti()).toHaveLength(CONFETTI_COUNT)
  })

  it('honours an explicit lower count', () => {
    expect(createConfetti(12)).toHaveLength(12)
  })

  it('is deterministic -- the same seed always produces the same burst', () => {
    expect(createConfetti(20, 7)).toEqual(createConfetti(20, 7))
  })

  it('differs between seeds, so two bursts are not identical', () => {
    expect(createConfetti(20, 7)).not.toEqual(createConfetti(20, 8))
  })

  it('gives every piece a finite, one-shot lifetime', () => {
    for (const piece of createConfetti()) {
      expect(piece.durationSec).toBeGreaterThan(0)
      expect(Number.isFinite(piece.durationSec)).toBe(true)
      expect(piece.delaySec).toBeGreaterThanOrEqual(0)
    }
  })

  it('throws every piece downward and outward from the burst origin', () => {
    const pieces = createConfetti()
    // Screen coordinates: +y is down. Gravity wins for every piece, whatever
    // its initial upward kick, or the burst would hang in the air.
    expect(pieces.every((p) => p.fallYPx > 0)).toBe(true)
    // Both directions are used, so the burst is not a one-sided spray.
    expect(pieces.some((p) => p.driftXPx < 0)).toBe(true)
    expect(pieces.some((p) => p.driftXPx > 0)).toBe(true)
  })

  it('spreads pieces across the width rather than stacking them in a column', () => {
    const xs = createConfetti().map((p) => p.xPercent)
    expect(Math.min(...xs)).toBeLessThan(35)
    expect(Math.max(...xs)).toBeGreaterThan(65)
  })

  it('gives each piece a stable id', () => {
    const ids = createConfetti().map((p) => p.id)
    expect(new Set(ids).size).toBe(CONFETTI_COUNT)
  })

  // Colour alone must never be the carrier of meaning, but confetti carries no
  // meaning at all -- it is decoration, and it draws from the app's own accent
  // hues so the celebration looks like it belongs to this app.
  it('draws only from the app accent hues', () => {
    const hues = new Set(createConfetti().map((p) => p.hue))
    for (const hue of hues) {
      expect([25, 85, 195, 320]).toContain(hue)
    }
    expect(hues.size).toBeGreaterThan(1)
  })
})
