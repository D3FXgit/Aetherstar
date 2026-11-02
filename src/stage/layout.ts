/**
 * Shared singer-view geometry.
 *
 * The screen is drawn by two independently-positioned layers -- Stage's own
 * chrome (song card + lyric box) and the gameplay overlay it composes through
 * its `overlay` render-prop (pitch lane + score cards + status pill). Neither
 * layer can see the other's content, so both declare *this same grid* and place
 * themselves into named cells: the regions line up by construction instead of
 * by two sets of hand-tuned absolute offsets that drift apart.
 *
 * Every row is sized independently of its content (a clamp or a flexible
 * minmax, never `auto`) precisely so both layers agree on where each row starts
 * even though each fills a different subset of the cells.
 */

export const STAGE_GRID_CLASS = [
  'absolute inset-0 grid',
  'grid-cols-[minmax(0,1fr)_clamp(15rem,24vw,26rem)]',
  // Row 3 holds the lyric box *and* the status pill beneath it, so it is sized
  // for both -- a shorter row would let the pill ride up over the lyrics.
  'grid-rows-[clamp(4.5rem,10vh,6.5rem)_minmax(8rem,1fr)_clamp(13rem,26vh,17rem)]',
  'gap-x-[clamp(1rem,2vw,2.5rem)] gap-y-[clamp(0.75rem,1.6vh,1.5rem)]',
  'p-[clamp(1.25rem,2.6vw,3.5rem)]',
].join(' ')

/** Top-left song info card. */
export const STAGE_SONG_CARD_CELL = 'col-start-1 row-start-1 self-start justify-self-start max-w-full min-w-0'

/** Score cards stack down the right edge, starting level with the song card. */
export const STAGE_SCORE_COLUMN_CELL = 'col-start-2 row-start-1 row-span-2 self-start min-w-0'

/** The single shared pitch lane, centred in the space the two top cards leave. */
export const STAGE_LANE_CELL = 'col-start-1 row-start-2 self-center min-w-0 w-full'

/** Lyric box: full width across the bottom, sitting at the top of the bottom row. */
export const STAGE_LYRIC_CELL = 'col-start-1 col-span-2 row-start-3 self-start w-full min-w-0'

/** Status pill: centred at the very bottom, under the lyric box. */
export const STAGE_STATUS_CELL = 'col-start-1 col-span-2 row-start-3 self-end justify-self-center'
