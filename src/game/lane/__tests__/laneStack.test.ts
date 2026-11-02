import { describe, expect, it } from 'vitest'
import {
  LANE_STACK_BUDGET_PX,
  MIN_LANE_HEIGHT_PX,
  SOLO_LANE_HEIGHT_PX,
  guideLineCount,
  laneGapPx,
  laneHeightForPlayerCount,
  laneStackHeightPx,
  noteHeightForLaneHeight,
} from '../laneStack'
import { NOTE_HEIGHT_PX } from '../NoteBlock'

/**
 * Every singer gets their own lane, and all of them stack in the one shared
 * lane cell in the middle of the stage. The screen does not grow when a fifth
 * person picks up a microphone, so these are the pixel facts that keep the
 * stack legible and bounded at every party size from one to eight.
 */
describe('laneHeightForPlayerCount', () => {
  it('gives a single singer the full-height lane, unchanged from the solo layout', () => {
    expect(laneHeightForPlayerCount(1)).toBe(SOLO_LANE_HEIGHT_PX)
  })

  it('degrades gracefully for a count that cannot happen', () => {
    expect(laneHeightForPlayerCount(0)).toBe(SOLO_LANE_HEIGHT_PX)
    expect(laneHeightForPlayerCount(-3)).toBe(SOLO_LANE_HEIGHT_PX)
  })

  it('divides a fixed budget, so two lanes are far taller than eight', () => {
    expect(laneHeightForPlayerCount(2)).toBeGreaterThan(laneHeightForPlayerCount(4))
    expect(laneHeightForPlayerCount(4)).toBeGreaterThan(laneHeightForPlayerCount(8))
  })

  /**
   * Every lane in the stack is the same height, always. Two lanes of different
   * heights map the same pitch range onto different numbers of pixels, so the
   * same note would be drawn at two different places on the same screen and no
   * two singers could compare their lines.
   */
  it('shrinks every lane monotonically as singers are added, never just the new one', () => {
    for (let count = 2; count <= 8; count += 1) {
      expect(laneHeightForPlayerCount(count)).toBeLessThanOrEqual(laneHeightForPlayerCount(count - 1))
    }
  })

  /**
   * The floor is the point of the clamp. Eight lanes divided out of the budget
   * would be 47px, which is not enough travel for a pitch line to be read
   * across a room -- so the stack is allowed to be a little taller than its
   * budget rather than illegible.
   */
  it('never shrinks a lane below the floor a pitch line can still be read in', () => {
    for (let count = 1; count <= 8; count += 1) {
      expect(laneHeightForPlayerCount(count)).toBeGreaterThanOrEqual(MIN_LANE_HEIGHT_PX)
    }
    expect(laneHeightForPlayerCount(8)).toBe(MIN_LANE_HEIGHT_PX)
  })

  it('never gives anyone a taller lane than the solo one', () => {
    for (let count = 1; count <= 8; count += 1) {
      expect(laneHeightForPlayerCount(count)).toBeLessThanOrEqual(SOLO_LANE_HEIGHT_PX)
    }
  })

  it('produces integral pixel heights, because the pitch scale maps onto them', () => {
    for (let count = 1; count <= 8; count += 1) {
      expect(Number.isInteger(laneHeightForPlayerCount(count))).toBe(true)
    }
  })
})

describe('laneStackHeightPx', () => {
  it('accounts for the gaps between lanes, not just the lanes', () => {
    expect(laneStackHeightPx(3)).toBe(3 * laneHeightForPlayerCount(3) + 2 * laneGapPx(3))
  })

  it('keeps the stack inside its budget for every party size the budget can hold', () => {
    for (let count = 1; count <= 6; count += 1) {
      expect(laneStackHeightPx(count)).toBeLessThanOrEqual(LANE_STACK_BUDGET_PX)
    }
  })

  it('tightens the gap as lanes are added, so the space goes to the lanes themselves', () => {
    expect(laneGapPx(2)).toBeGreaterThan(laneGapPx(4))
  })
})

describe('noteHeightForLaneHeight', () => {
  it('keeps the full-height lane on the reference note size', () => {
    expect(noteHeightForLaneHeight(SOLO_LANE_HEIGHT_PX)).toBe(NOTE_HEIGHT_PX)
  })

  it('shrinks the note pill with the lane, so eight lanes are not all note and no track', () => {
    const tall = noteHeightForLaneHeight(laneHeightForPlayerCount(2))
    const short = noteHeightForLaneHeight(laneHeightForPlayerCount(8))
    expect(short).toBeLessThan(tall)
    expect(tall).toBeLessThanOrEqual(NOTE_HEIGHT_PX)
  })

  it('leaves most of every lane as pitch track rather than note thickness', () => {
    for (let count = 1; count <= 8; count += 1) {
      const laneHeight = laneHeightForPlayerCount(count)
      expect(noteHeightForLaneHeight(laneHeight)).toBeLessThanOrEqual(laneHeight / 4)
    }
  })

  it('never rounds a note down to something unhittable to look at', () => {
    expect(noteHeightForLaneHeight(1)).toBeGreaterThanOrEqual(8)
    expect(Number.isInteger(noteHeightForLaneHeight(153))).toBe(true)
  })
})

describe('guideLineCount', () => {
  // Nine hairlines across a 64px lane is a hatch pattern, not a guide.
  it('thins the guide lines out as the lane gets shorter', () => {
    expect(guideLineCount(laneHeightForPlayerCount(8))).toBeLessThan(
      guideLineCount(laneHeightForPlayerCount(1)),
    )
  })
})
