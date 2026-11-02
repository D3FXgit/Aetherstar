import { describe, expect, it } from 'vitest'
import type { SongLine } from '../../../contracts/types'
import { flattenNotes } from '../../matching/flattenNotes'
import { msPerBeat } from '../../../stage/timing/beatMs'
import {
  buildLinePaging,
  noteLayoutOnPage,
  PAGE_EDGE_PADDING_PERCENT,
  PAGE_FLIP_LEAD_MS,
  PAGE_MIN_RANGE_SEMITONES,
  pageIndexAt,
  pitchWindowFor,
  playheadPercentAt,
} from '../linePaging'

const BPM = 60 // 250 ms a beat, so the 450 ms lead is 1.8 beats.
const LEAD = PAGE_FLIP_LEAD_MS / msPerBeat(BPM)

function line(notes: [start: number, length: number, pitch: number][], lineBreakBeat?: number): SongLine {
  return {
    part: 'solo',
    notes: notes.map(([startBeat, length, pitch]) => ({ kind: 'normal', startBeat, length, pitch, syllable: 'la' })),
    lineBreakBeat,
  }
}

describe('line paging -- when a page flips', () => {
  it('makes one page per line, carrying the ids flattenNotes gives the lane', () => {
    const lines = [line([[0, 4, 60], [8, 4, 62]], 16), line([[20, 4, 64]])]
    const paging = buildLinePaging(lines, BPM)
    expect(paging.pages).toHaveLength(2)
    expect(paging.pages.flatMap((page) => page.notes.map((note) => note.noteId))).toEqual(
      flattenNotes(lines).map((note) => note.noteId),
    )
    expect(paging.pageOfNote.get('note-2')).toBe(1)
  })

  it('flips at the line break marker when it comes before the lead', () => {
    const paging = buildLinePaging([line([[0, 4, 60], [8, 4, 62]], 14), line([[20, 4, 64]])], BPM)
    expect(paging.pages[0].untilBeat).toBe(14)
    expect(paging.pages[1].fromBeat).toBe(14)
  })

  it('flips ~450 ms before the next line when the marker is later than that', () => {
    const paging = buildLinePaging([line([[0, 4, 60]], 19.9), line([[20, 4, 64]])], BPM)
    expect(paging.pages[0].untilBeat).toBeCloseTo(20 - LEAD, 6)
  })

  it('never takes a line away while it is still being sung', () => {
    // The next line is due straight after: the lead would cut into the last note.
    const paging = buildLinePaging([line([[0, 10, 60]]), line([[10.5, 2, 64]])], BPM)
    expect(paging.pages[0].untilBeat).toBe(10)
  })

  it('never flips after the next line has started', () => {
    // Overlapping lines (a merged chart): the next line wins at its first note.
    const paging = buildLinePaging([line([[0, 12, 60]]), line([[8, 2, 64]])], BPM)
    expect(paging.pages[0].untilBeat).toBe(8)
  })

  it('finds the page for a beat by binary search, and holds the last page to the end', () => {
    const lines = [line([[0, 2, 60]], 4), line([[6, 2, 60]], 10), line([[12, 2, 60]])]
    const paging = buildLinePaging(lines, BPM)
    expect(pageIndexAt(paging, -100)).toBe(0)
    expect(pageIndexAt(paging, 3.9)).toBe(0)
    expect(pageIndexAt(paging, 4)).toBe(1)
    expect(pageIndexAt(paging, 11)).toBe(2)
    expect(pageIndexAt(paging, 10_000)).toBe(2)
    expect(pageIndexAt(buildLinePaging([], BPM), 0)).toBe(-1)
  })

  it('pages in singing order even when the lines are not in file order', () => {
    const paging = buildLinePaging([line([[20, 2, 60]]), line([[0, 2, 60]])], BPM)
    expect(paging.pages.map((page) => page.startBeat)).toEqual([0, 20])
  })
})

describe('line paging -- the layout across a page', () => {
  it('lays the line across the lane, first note at the left padding, last note ending at the right', () => {
    const paging = buildLinePaging([line([[10, 2, 60], [14, 6, 62]])], BPM)
    const [page] = paging.pages
    const first = noteLayoutOnPage(page, page.notes[0])
    const last = noteLayoutOnPage(page, page.notes[1])
    expect(first.leftPercent).toBeCloseTo(PAGE_EDGE_PADDING_PERCENT, 6)
    expect(last.leftPercent + last.widthPercent).toBeCloseTo(100 - PAGE_EDGE_PADDING_PERCENT, 6)
    expect(first.widthPercent).toBeGreaterThan(0)
  })

  it('moves the playhead across the page with the beat, clamped to the lane', () => {
    const paging = buildLinePaging([line([[10, 10, 60]])], BPM)
    expect(playheadPercentAt(paging, 10)).toBeCloseTo(PAGE_EDGE_PADDING_PERCENT, 6)
    expect(playheadPercentAt(paging, 15)).toBeCloseTo(50, 6)
    expect(playheadPercentAt(paging, 20)).toBeCloseTo(100 - PAGE_EDGE_PADDING_PERCENT, 6)
    expect(playheadPercentAt(paging, -1000)).toBe(0)
    expect(playheadPercentAt(paging, 1000)).toBe(100)
  })
})

describe('line paging -- the pitch window per page', () => {
  it('is at least an octave, centred on a narrow line', () => {
    const window = pitchWindowFor([60, 61], null)
    expect(window.max - window.min).toBe(PAGE_MIN_RANGE_SEMITONES)
    expect((window.max + window.min) / 2).toBeCloseTo(60.5, 6)
  })

  it('leaves a semitone of room above and below a wide line', () => {
    expect(pitchWindowFor([50, 70], null)).toEqual({ min: 49, max: 71 })
  })

  it('keeps the previous window when the next line fits inside it', () => {
    const previous = { min: 54, max: 66 }
    expect(pitchWindowFor([58, 62], previous)).toBe(previous)
    expect(pitchWindowFor([58, 66], previous)).not.toBe(previous)
  })

  it('maps a page\'s notes inside the lane, never on its edges', () => {
    const paging = buildLinePaging([line([[0, 2, 40], [2, 2, 52]])], BPM)
    const { scale } = paging.pages[0]
    for (const note of paging.pages[0].notes) {
      const y = scale.toY(note.pitch, 100)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(100)
    }
  })
})
