import { describe, expect, it } from 'vitest'
import type { SongLine } from '../../contracts/types'
import { msPerBeat } from '../../stage/timing/beatMs'
import {
  findInstrumentalBreaks,
  INSTRUMENTAL_GAP_MS,
  isPitchUiVisibleAtBeat,
  RETURN_LEAD_MS,
} from '../instrumentalBreaks'

/**
 * 120 BPM. The `* 4` in msPerBeat is the whole reason this test names it
 * rather than hard-coding a number: an UltraStar `#BPM` counts *quarter*
 * beats, so one chart beat here is 125ms, not 500ms. A previous bug in exactly
 * that conversion made every beat four times too long, which would have turned
 * a five-second silence threshold into a twenty-second one and meant no chart
 * in the library ever produced a break at all.
 */
const BPM = 120
const MS_PER_BEAT = msPerBeat(BPM)

function line(startBeat: number, lengthBeats: number): SongLine {
  return {
    part: 'solo',
    notes: [{ kind: 'normal', startBeat, length: lengthBeats, pitch: 60, syllable: 'la' }],
  }
}

const beatsFor = (ms: number) => ms / MS_PER_BEAT

describe('findInstrumentalBreaks', () => {
  it('derives one beat from the chart the same way the rest of the stage does', () => {
    // 60000 / (120 * 4) -- the quarter-beat convention, pinned here because
    // every threshold below is expressed through it.
    expect(MS_PER_BEAT).toBeCloseTo(125, 6)
  })

  it('finds nothing in a chart that never stops singing', () => {
    const lines = [line(0, 4), line(4, 4), line(8, 4)]
    expect(findInstrumentalBreaks(lines, BPM)).toEqual([])
  })

  it('ignores a rest that is merely a breath, however long the singer takes', () => {
    // Just under the threshold: a four-and-a-bit second rest is a phrase end,
    // not a guitar solo, and clearing the screen for it would be a flicker.
    const lines = [line(0, 4), line(4 + beatsFor(INSTRUMENTAL_GAP_MS) - 1, 4)]
    expect(findInstrumentalBreaks(lines, BPM)).toEqual([])
  })

  it('finds a break the moment the gap passes five seconds', () => {
    const nextStart = 4 + beatsFor(INSTRUMENTAL_GAP_MS) + 1
    const breaks = findInstrumentalBreaks([line(0, 4), line(nextStart, 4)], BPM)

    expect(breaks).toHaveLength(1)
    // The hide begins where the last note of the preceding line ends...
    expect(breaks[0].hideAtBeat).toBe(4)
    // ...and the interface is on its way back exactly 2.5s ahead of the next.
    expect(breaks[0].showAtBeat).toBeCloseTo(nextStart - beatsFor(RETURN_LEAD_MS), 6)
  })

  it('measures the gap in real time, so the same beat distance is a break at one tempo and not at another', () => {
    const lines = [line(0, 4), line(60, 4)]
    // 56 beats at 120 BPM is 7s -- a break. The same 56 beats at 400 BPM is
    // 2.1s -- a breath. Nothing about the beat numbers changed.
    expect(findInstrumentalBreaks(lines, 120)).toHaveLength(1)
    expect(findInstrumentalBreaks(lines, 400)).toEqual([])
  })

  it('finds every break in a chart, not just the first', () => {
    const step = beatsFor(INSTRUMENTAL_GAP_MS) + 10
    const lines = [line(0, 4), line(step, 4), line(step * 2, 4)]
    expect(findInstrumentalBreaks(lines, BPM)).toHaveLength(2)
  })

  /**
   * A duet interleaves p1 and p2 lines, and in real files they are not always
   * in time order. Taking the *previous line in the array* would find a break
   * that a line already in flight is singing straight through.
   */
  it('waits for every line so far to have finished, not just the previous one in the file', () => {
    const nextStart = 100 + beatsFor(INSTRUMENTAL_GAP_MS) + 1
    const lines: SongLine[] = [
      { ...line(0, 4), part: 'p1' },
      { ...line(2, 98), part: 'p2' }, // still going long after p1's line ended
      { ...line(nextStart, 4), part: 'p1' },
    ]

    const breaks = findInstrumentalBreaks(lines, BPM)
    expect(breaks).toHaveLength(1)
    expect(breaks[0].hideAtBeat).toBe(100) // where p2 finished, not where p1 did
  })

  it('sorts lines by their own first beat rather than trusting file order', () => {
    const nextStart = 4 + beatsFor(INSTRUMENTAL_GAP_MS) + 1
    const inOrder = findInstrumentalBreaks([line(0, 4), line(nextStart, 4)], BPM)
    const shuffled = findInstrumentalBreaks([line(nextStart, 4), line(0, 4)], BPM)
    expect(shuffled).toEqual(inOrder)
  })

  /**
   * The lead-in before the first line already has an owner -- the pre-`#GAP`
   * countdown, which is showing "3, 2, 1" over the same video. Two systems
   * fading the same interface in opposite directions is worse than either.
   */
  it('never treats the lead-in before the first line as a break', () => {
    expect(findInstrumentalBreaks([line(10000, 4)], BPM)).toEqual([])
  })

  it('survives lines with no notes and a nonsense tempo without inventing breaks', () => {
    expect(findInstrumentalBreaks([{ part: 'solo', notes: [] }, line(0, 4)], BPM)).toEqual([])
    expect(findInstrumentalBreaks([line(0, 4), line(9999, 4)], 0)).toEqual([])
  })
})

describe('isPitchUiVisibleAtBeat', () => {
  const breaks = [{ hideAtBeat: 10, showAtBeat: 40 }]

  it('shows the interface everywhere outside a break', () => {
    expect(isPitchUiVisibleAtBeat(0, breaks)).toBe(true)
    expect(isPitchUiVisibleAtBeat(9.99, breaks)).toBe(true)
    expect(isPitchUiVisibleAtBeat(40, breaks)).toBe(true)
    expect(isPitchUiVisibleAtBeat(200, breaks)).toBe(true)
  })

  it('hides it from the instant the last note ends until the lead-in begins', () => {
    expect(isPitchUiVisibleAtBeat(10, breaks)).toBe(false)
    expect(isPitchUiVisibleAtBeat(25, breaks)).toBe(false)
    expect(isPitchUiVisibleAtBeat(39.99, breaks)).toBe(false)
  })

  it('is always visible in a chart with no breaks at all', () => {
    expect(isPitchUiVisibleAtBeat(500, [])).toBe(true)
  })
})
