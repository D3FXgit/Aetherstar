import { describe, expect, it } from 'vitest'
import { findLineIndexForBeat } from '../findLineIndexForBeat'
import type { SongLine } from '../../../contracts/types'

// Beat numbers matching the real fixture's early lines (fixtures/sample-song/notes.txt).
const lines: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 3, pitch: 64, syllable: 'Wake' }], lineBreakBeat: 30 },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 32, length: 2, pitch: 64, syllable: 'A' }], lineBreakBeat: 62 },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 64, length: 4, pitch: 67, syllable: 'Hold' }] },
]

describe('findLineIndexForBeat', () => {
  it('returns the first line while before the second line starts', () => {
    expect(findLineIndexForBeat(lines, 10)).toBe(0)
  })

  it('advances to the next line once its first note starts', () => {
    expect(findLineIndexForBeat(lines, 32)).toBe(1)
  })

  it('switches at the line break marker, before the next line starts', () => {
    expect(findLineIndexForBeat(lines, 29.9)).toBe(0)
    expect(findLineIndexForBeat(lines, 30)).toBe(1)
    expect(findLineIndexForBeat(lines, 62)).toBe(2)
  })

  it('falls back to the next line\'s first note when there is no break marker', () => {
    const unmarked: SongLine[] = lines.map((line) => ({ part: line.part, notes: line.notes }))
    expect(findLineIndexForBeat(unmarked, 31)).toBe(0)
    expect(findLineIndexForBeat(unmarked, 32)).toBe(1)
  })

  it('clamps to the last line for beats beyond the chart', () => {
    expect(findLineIndexForBeat(lines, 100)).toBe(2)
  })

  it('returns 0 for an empty chart', () => {
    expect(findLineIndexForBeat([], 5)).toBe(0)
  })
})
