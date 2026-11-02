import { describe, expect, it } from 'vitest'
import type { SongLine, SongPart } from '../../../contracts/types'
import { isDuetChart, lineStartBeat, linesForPart, lyricTracks, sortLinesByStart } from '../duetParts'
import { linesForLane, partForLaneIndex } from '../../../multiplayer/laneParts'

function line(part: SongPart, startBeat: number): SongLine {
  return { part, notes: [{ kind: 'normal', startBeat, length: 2, pitch: 60, syllable: `${part}@${startBeat}` }] }
}

const DUET: SongLine[] = [line('p1', 0), line('p2', 8), line('solo', 4), line('p1', 12)]

describe('duet parts', () => {
  it('knows a line starts at its first note, or its break marker when it has none', () => {
    expect(lineStartBeat(line('solo', 7))).toBe(7)
    expect(lineStartBeat({ part: 'solo', notes: [], lineBreakBeat: 3 })).toBe(3)
    expect(lineStartBeat({ part: 'solo', notes: [] })).toBe(Infinity)
  })

  it('sorts by start, stably, and hands an already-sorted chart back unchanged', () => {
    const sorted = [line('solo', 0), line('solo', 4)]
    expect(sortLinesByStart(sorted)).toBe(sorted)
    expect(sortLinesByStart(DUET).map(lineStartBeat)).toEqual([0, 4, 8, 12])
  })

  it('is a duet only when both singers have lines', () => {
    expect(isDuetChart(DUET)).toBe(true)
    expect(isDuetChart([line('p1', 0), line('solo', 4)])).toBe(false)
    expect(isDuetChart([line('solo', 0)])).toBe(false)
  })

  it('gives each singer their own part plus the shared lines, in singing order', () => {
    expect(linesForPart(DUET, 'p1').map(lineStartBeat)).toEqual([0, 4, 12])
    expect(linesForPart(DUET, 'p2').map(lineStartBeat)).toEqual([4, 8])
  })

  it('stacks a duet\'s lyric boxes P2 over P1, and an ordinary song in one', () => {
    expect(lyricTracks(DUET).map((track) => track.part)).toEqual(['p2', 'p1'])
    expect(lyricTracks([line('solo', 0)]).map((track) => track.part)).toEqual(['solo'])
  })
})

describe('lane parts', () => {
  it('alternates P1 and P2 across the lanes of a duet', () => {
    expect([0, 1, 2, 3, 4].map(partForLaneIndex)).toEqual(['p1', 'p2', 'p1', 'p2', 'p1'])
    expect(linesForLane(DUET, 2)).toBe(linesForLane(DUET, 0))
    expect(linesForLane(DUET, 3)).toBe(linesForLane(DUET, 1))
  })

  it('gives every lane the whole chart for an ordinary song', () => {
    const solo = [line('solo', 0), line('solo', 4)]
    expect(linesForLane(solo, 0)).toBe(solo)
    expect(linesForLane(solo, 5)).toBe(solo)
  })

  it('returns the same arrays every time for the same chart, so memos keyed on them hold', () => {
    expect(linesForLane(DUET, 1)).toBe(linesForLane(DUET, 1))
  })
})
