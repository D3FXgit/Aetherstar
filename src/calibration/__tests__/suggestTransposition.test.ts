import { describe, expect, it } from 'vitest'
import { suggestTranspositionSemitones } from '../suggestTransposition'

describe('suggestTranspositionSemitones', () => {
  it('suggests 0 when the player range matches the fixture range exactly', () => {
    // Fixture pitches span semitone 60 to 72 (an octave); player's low/high match that exactly.
    const fixturePitches = [60, 66, 72]
    const lowHz = 440 * Math.pow(2, (60 - 69) / 12)
    const highHz = 440 * Math.pow(2, (72 - 69) / 12)

    expect(suggestTranspositionSemitones(lowHz, highHz, fixturePitches)).toBe(0)
  })

  it('suggests +12 when the player sings a full octave below the fixture range', () => {
    const fixturePitches = [60, 66, 72] // center = 66
    const lowHz = 440 * Math.pow(2, (48 - 69) / 12) // one octave below 60
    const highHz = 440 * Math.pow(2, (60 - 69) / 12) // one octave below 72

    expect(suggestTranspositionSemitones(lowHz, highHz, fixturePitches)).toBe(12)
  })

  it('rounds hzToSemitone-derived centers to the nearest whole semitone', () => {
    expect(Number.isInteger(suggestTranspositionSemitones(200, 300, [60, 72]))).toBe(true)
  })
})
