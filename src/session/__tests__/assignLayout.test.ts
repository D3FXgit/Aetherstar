import { describe, expect, it } from 'vitest'
import {
  FOCUS_RING_EXTENT,
  MAX_COLUMNS,
  MAX_SELECTED_SCALE,
  MIN_BADGE_SIZE,
  assignGridFor,
  captionAllowanceFor,
  columnsFor,
  gapFor,
} from '../assignLayout'

const VIEWPORTS = [
  { name: '1080p', viewportWidth: 1920, viewportHeight: 1080 },
  { name: '1440p', viewportWidth: 2560, viewportHeight: 1440 },
  { name: '4K', viewportWidth: 3840, viewportHeight: 2160 },
]

const PARTY_SIZES = [2, 3, 4, 5, 6, 7, 8]

describe('columnsFor', () => {
  it('gives a small party one row', () => {
    expect(columnsFor(2)).toBe(2)
    expect(columnsFor(3)).toBe(3)
    expect(columnsFor(4)).toBe(4)
  })

  // Even rows, so the second row lines up under the first.
  it('balances a large party across even rows instead of leaving a ragged last row', () => {
    expect(columnsFor(5)).toBe(3) // 3 + 2
    expect(columnsFor(6)).toBe(3) // 3 + 3
    expect(columnsFor(7)).toBe(4) // 4 + 3
    expect(columnsFor(8)).toBe(4) // 4 + 4
  })

  it('never exceeds four columns, so a badge never has to shrink below reading size', () => {
    PARTY_SIZES.forEach((count) => expect(columnsFor(count)).toBeLessThanOrEqual(MAX_COLUMNS))
  })

  it('survives a degenerate count rather than dividing by zero', () => {
    expect(columnsFor(0)).toBe(1)
    expect(columnsFor(1)).toBe(1)
  })
})

// The overlap regression, stated as physics rather than as a magic number:
// selecting a badge grows it by transform, which reserves no layout space at
// all, so the gutter alone has to absorb both neighbours' growth *and* both
// neighbours' focus outlines.
describe('gapFor', () => {
  it('absorbs the selected-scale growth of both neighbours plus both focus outlines', () => {
    for (let size = MIN_BADGE_SIZE; size <= 600; size += 1) {
      const growthOfBothNeighbours = size * (MAX_SELECTED_SCALE - 1)
      expect(gapFor(size)).toBeGreaterThanOrEqual(growthOfBothNeighbours + 2 * FOCUS_RING_EXTENT)
    }
  })

  it('grows with the badge, so the guarantee holds at 4K as well as at 1080p', () => {
    expect(gapFor(400)).toBeGreaterThan(gapFor(120))
  })
})

describe('assignGridFor', () => {
  it.each(VIEWPORTS)('lays every party size out inside the $name viewport', (viewport) => {
    PARTY_SIZES.forEach((playerCount) => {
      const grid = assignGridFor({ playerCount, ...viewport })
      const cellWidth = grid.badgeSize + grid.gap
      const cellHeight = grid.badgeSize + captionAllowanceFor(grid.badgeSize) + grid.gap

      expect(grid.columns * cellWidth).toBeLessThanOrEqual(viewport.viewportWidth)
      expect(grid.rows * cellHeight).toBeLessThanOrEqual(viewport.viewportHeight)
    })
  })

  it.each(VIEWPORTS)('never lets a neighbour reach into another badge at $name', (viewport) => {
    PARTY_SIZES.forEach((playerCount) => {
      const grid = assignGridFor({ playerCount, ...viewport })
      const halfGap = grid.gap / 2
      const overhangOfOneSelectedBadge = (grid.badgeSize * (MAX_SELECTED_SCALE - 1)) / 2

      expect(halfGap).toBeGreaterThanOrEqual(overhangOfOneSelectedBadge + FOCUS_RING_EXTENT)
    })
  })

  it('keeps every badge far above the 44pt minimum target size', () => {
    VIEWPORTS.forEach((viewport) => {
      PARTY_SIZES.forEach((playerCount) => {
        expect(assignGridFor({ playerCount, ...viewport }).badgeSize).toBeGreaterThanOrEqual(44)
      })
    })
  })

  it('clamps to a floor rather than collapsing on a small window', () => {
    expect(assignGridFor({ playerCount: 8, viewportWidth: 480, viewportHeight: 360 }).badgeSize).toBe(MIN_BADGE_SIZE)
  })

  // A fixed 190px badge would look half the size on a 4K panel.
  it('scales the badge up with the display instead of pinning it to one pixel size', () => {
    const at1080 = assignGridFor({ playerCount: 4, viewportWidth: 1920, viewportHeight: 1080 }).badgeSize
    const at1440 = assignGridFor({ playerCount: 4, viewportWidth: 2560, viewportHeight: 1440 }).badgeSize
    const at4K = assignGridFor({ playerCount: 4, viewportWidth: 3840, viewportHeight: 2160 }).badgeSize

    expect(at1440).toBeGreaterThan(at1080)
    expect(at4K).toBeGreaterThan(at1440)
  })

  it('shrinks the badge as the party grows rather than overflowing the screen', () => {
    const two = assignGridFor({ playerCount: 2, viewportWidth: 1920, viewportHeight: 1080 }).badgeSize
    const eight = assignGridFor({ playerCount: 8, viewportWidth: 1920, viewportHeight: 1080 }).badgeSize

    expect(eight).toBeLessThan(two)
  })

  it('reports the row count implied by the column count', () => {
    expect(assignGridFor({ playerCount: 8, viewportWidth: 1920, viewportHeight: 1080 }).rows).toBe(2)
    expect(assignGridFor({ playerCount: 3, viewportWidth: 1920, viewportHeight: 1080 }).rows).toBe(1)
    expect(assignGridFor({ playerCount: 5, viewportWidth: 1920, viewportHeight: 1080 }).rows).toBe(2)
  })
})
