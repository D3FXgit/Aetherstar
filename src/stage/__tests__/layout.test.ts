import { describe, expect, it } from 'vitest'
import {
  STAGE_GRID_CLASS,
  STAGE_LANE_CELL,
  STAGE_LYRIC_CELL,
  STAGE_SCORE_COLUMN_CELL,
  STAGE_SONG_CARD_CELL,
  STAGE_STATUS_CELL,
} from '../layout'

/**
 * The singer view is drawn by **two layers that cannot see each other** --
 * Stage's own chrome (song card + lyric box) and the gameplay overlay it
 * composes through its `overlay` render-prop (the pitch lane, the score cards,
 * the status pill). They line up because both declare this same grid and place
 * into named cells.
 *
 * That contract is the thing these tests exist to protect. A column or row
 * template that differed between the two layers by even one value would put the
 * lane in one place and the lyric box over the top of it, and nothing in either
 * file would look wrong on its own.
 */
describe('the shared singer-view grid', () => {
  it('is a two-column grid: the stage on the left, the score cards on the right', () => {
    expect(STAGE_GRID_CLASS).toContain('inset-0')
    expect(STAGE_GRID_CLASS).toContain('grid-cols-[minmax(0,1fr)_clamp(15rem,24vw,26rem)]')
  })

  it('lays out three rows: the top cards, the lane, and the lyric box', () => {
    expect(STAGE_GRID_CLASS).toContain(
      'grid-rows-[clamp(4.5rem,10vh,6.5rem)_minmax(8rem,1fr)_clamp(13rem,26vh,17rem)]',
    )
  })

  /**
   * Both layers place into this grid, so the outer padding has to live on the
   * grid itself rather than on the cells -- otherwise a cell one layer pads and
   * the other does not is a cell whose two halves start in different places.
   */
  it('carries its own outer padding, so neither layer has to reproduce it', () => {
    expect(STAGE_GRID_CLASS).toMatch(/\bp-\[/)
  })

  it('puts the song card top-left and the score cards down the right edge, level with it', () => {
    expect(STAGE_SONG_CARD_CELL).toContain('col-start-1')
    expect(STAGE_SONG_CARD_CELL).toContain('row-start-1')

    expect(STAGE_SCORE_COLUMN_CELL).toContain('col-start-2')
    expect(STAGE_SCORE_COLUMN_CELL).toContain('row-start-1')
    // Down the edge, not squeezed into the song card's own row.
    expect(STAGE_SCORE_COLUMN_CELL).toContain('row-span-2')
    expect(STAGE_SCORE_COLUMN_CELL).toContain('self-start')
  })

  // One lane, shared by everyone singing, centred in the space the two top
  // cards leave rather than pinned to either of them.
  it('centres the single shared pitch lane in the middle row of the left column', () => {
    expect(STAGE_LANE_CELL).toContain('col-start-1')
    expect(STAGE_LANE_CELL).toContain('row-start-2')
    expect(STAGE_LANE_CELL).toContain('self-center')
    expect(STAGE_LANE_CELL).toContain('w-full')
  })

  /**
   * The lyric box runs the *whole* width, under the score column as well as the
   * lane -- the words are the one thing on this screen everybody in the room
   * reads, so they get the full frame rather than the left column's share.
   */
  it('runs the lyric box across the full width of the bottom row', () => {
    expect(STAGE_LYRIC_CELL).toContain('col-start-1')
    expect(STAGE_LYRIC_CELL).toContain('col-span-2')
    expect(STAGE_LYRIC_CELL).toContain('row-start-3')
    expect(STAGE_LYRIC_CELL).toContain('self-start')
  })

  /**
   * The status pill shares row 3 with the lyric box and sits at the bottom of
   * it. That is why the row is sized for both: a shorter row would let the pill
   * ride up over the lyrics.
   */
  it('centres the status pill at the very bottom, under the lyric box', () => {
    expect(STAGE_STATUS_CELL).toContain('row-start-3')
    expect(STAGE_STATUS_CELL).toContain('self-end')
    expect(STAGE_STATUS_CELL).toContain('justify-self-center')
    // Same row as the lyric box, by construction.
    expect(STAGE_LYRIC_CELL).toContain('row-start-3')
  })
})
