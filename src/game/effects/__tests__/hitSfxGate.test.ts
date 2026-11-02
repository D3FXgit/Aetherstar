import { describe, expect, it } from 'vitest'
import { EPIC_MIN_GAP_MS, GOLDEN_MIN_GAP_MS, HIT_SFX_MIN_GAP_MS, createHitSfxGate } from '../hitSfxGate'

describe('createHitSfxGate', () => {
  it('lets the first hit of a song through', () => {
    expect(createHitSfxGate().admit('good', 1_000)).toBe(true)
  })

  it('collapses a wall of simultaneous hits into one sound', () => {
    // A duet's shared line ends on the same beat for everyone, so up to eight
    // lanes judge in the same millisecond. Eight copies of the same 160ms wav
    // starting in phase sum into a click, and every play() allocates its own
    // <audio> element.
    const gate = createHitSfxGate()
    const admitted = Array.from({ length: 8 }, () => gate.admit('good', 5_000)).filter(Boolean)
    expect(admitted).toHaveLength(1)
  })

  it('opens again once the minimum gap has passed', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('good', 0)).toBe(true)
    expect(gate.admit('good', HIT_SFX_MIN_GAP_MS - 1)).toBe(false)
    expect(gate.admit('good', HIT_SFX_MIN_GAP_MS)).toBe(true)
  })

  // The payoff moment must never be the one that gets swallowed: a run of
  // Goods flooding the gate would silence the Excellent that lands amongst
  // them, which is exactly backwards.
  it('lets an Excellent cut in ahead of a stream of lesser hits', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('good', 0)).toBe(true)
    expect(gate.admit('good', EPIC_MIN_GAP_MS)).toBe(false)
    expect(gate.admit('epic', EPIC_MIN_GAP_MS)).toBe(true)
  })

  it('still rate-limits Excellents against each other', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('epic', 0)).toBe(true)
    expect(gate.admit('epic', EPIC_MIN_GAP_MS - 1)).toBe(false)
    expect(gate.admit('epic', EPIC_MIN_GAP_MS)).toBe(true)
  })

  it('recovers when the clock jumps backwards', () => {
    // A restart, a seek, or a second song in the same session: the gate must
    // not go silent for the rest of the night because it remembers a
    // timestamp from the future.
    const gate = createHitSfxGate()
    expect(gate.admit('good', 10_000)).toBe(true)
    expect(gate.admit('good', 20)).toBe(true)
  })

  it('is reusable across songs via reset', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('good', 0)).toBe(true)
    gate.reset()
    expect(gate.admit('good', 1)).toBe(true)
  })

  it('takes its timings from the sound files, so no sound overlaps its own tail unrecognisably', () => {
    // hitGood is 160ms and hitBad 200ms; a gap far below that turns distinct
    // one-shots into a texture. 45ms for an Excellent is a deliberate
    // exception -- a double-hit there reads as emphasis, not as mud.
    expect(HIT_SFX_MIN_GAP_MS).toBeGreaterThanOrEqual(80)
    expect(EPIC_MIN_GAP_MS).toBeLessThan(HIT_SFX_MIN_GAP_MS)
  })
})

describe('where a golden note sits in the priority order', () => {
  // golden > Excellent > everything else. A golden note is the rarest good
  // thing in a song and the only one the score doubles; being silenced because
  // someone else's ordinary Good landed 40ms earlier would invert the whole
  // point of having a priority order.
  it('cuts in ahead of an Excellent, which cuts in ahead of everything else', () => {
    expect(GOLDEN_MIN_GAP_MS).toBeLessThan(EPIC_MIN_GAP_MS)
    expect(EPIC_MIN_GAP_MS).toBeLessThan(HIT_SFX_MIN_GAP_MS)
  })

  it('is heard through a wall of Goods and Excellents that would have gated it', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('good', 0)).toBe(true)
    expect(gate.admit('epic', GOLDEN_MIN_GAP_MS)).toBe(false)
    expect(gate.admit('epic', GOLDEN_MIN_GAP_MS, true)).toBe(true)
  })

  // The gate models one specific problem -- eight lanes judging the same beat
  // summing into a click -- and the golden window still solves it, because
  // those eight land inside the same millisecond, not 30 apart.
  it('still collapses eight lanes clearing the same golden note into one sound', () => {
    const gate = createHitSfxGate()
    const admitted = Array.from({ length: 8 }, () => gate.admit('epic', 7_000, true)).filter(Boolean)
    expect(admitted).toHaveLength(1)
  })

  // Golden notes come in runs in an UltraStar chart -- a whole golden phrase,
  // one note per syllable. Consecutive syllables are ~100ms apart at the very
  // fastest, so a real run must never be gated.
  it('lets a whole golden phrase through at the fastest rate a singer can sing it', () => {
    const gate = createHitSfxGate()
    for (let syllable = 0; syllable < 6; syllable += 1) {
      expect(gate.admit('epic', syllable * 100, true)).toBe(true)
    }
  })

  it('gives a *missed* golden note no priority at all -- it is still a miss', () => {
    const gate = createHitSfxGate()
    expect(gate.admit('good', 0)).toBe(true)
    expect(gate.admit('awful', GOLDEN_MIN_GAP_MS, true)).toBe(false)
  })
})
