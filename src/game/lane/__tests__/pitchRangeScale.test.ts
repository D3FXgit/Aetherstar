import { describe, expect, it } from 'vitest'
import { computePitchRangeScale } from '../pitchRangeScale'
import type { SongLine } from '../../../contracts/types'

const LINES: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 2, pitch: 65, syllable: 'a' }] },
  {
    part: 'solo',
    notes: [
      { kind: 'normal', startBeat: 4, length: 2, pitch: 58, syllable: 'b' },
      { kind: 'normal', startBeat: 8, length: 2, pitch: 72, syllable: 'c' },
    ],
  },
]

describe('computePitchRangeScale', () => {
  it('computes the min/max pitch across every note in the chart', () => {
    const scale = computePitchRangeScale(LINES)
    expect(scale.min).toBe(58)
    expect(scale.max).toBe(72)
  })

  it('maps the max pitch to the top (y=0) and min pitch to the bottom of the lane', () => {
    const scale = computePitchRangeScale(LINES)
    expect(scale.toY(58, 400)).toBeCloseTo(400, 0)
    expect(scale.toY(72, 400)).toBeCloseTo(0, 0)
    expect(scale.toY(65, 400)).toBeCloseTo(200, 0)
  })
})
