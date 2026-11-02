// Layout math for the song selector's virtualized grid (see SongSelector.tsx).

/**
 * Gutter inside the grid's scroll container, px: room for the app's 3px focus
 * outline at its 3px offset, so a focused card is never clipped.
 */
export const FOCUS_OUTLINE_GUTTER_PX = 7

/** Card minimum width and the gap between cards, in design units (about five columns on a 16:9 screen). */
const CARD_MIN_UNITS = 180
const CARD_GAP_UNITS = 22

export interface SongGridGeometry {
  columns: number
  /** Edge of one square card, px. */
  cardPx: number
  gapPx: number
  /** One row: a card plus the gap below it, px. */
  rowHeightPx: number
}

/**
 * An auto-fill grid (minimum 180 units per column), solved in JS.
 *
 * A virtualized list has to know its row height up front, so the column count
 * and card size can no longer be left to CSS. This reproduces what auto-fill
 * did: as many columns as fit at the minimum width, then the leftover shared
 * out. At 16:9 that is five columns at any resolution; a wider
 * screen gets more columns rather than wider cards. The focus gutter comes off
 * both sides first, as the old grid's padding did.
 */
export function songGridGeometry(widthPx: number, unitPx: number): SongGridGeometry {
  const gapPx = CARD_GAP_UNITS * unitPx
  const minCardPx = CARD_MIN_UNITS * unitPx
  const innerPx = Math.max(0, widthPx - 2 * FOCUS_OUTLINE_GUTTER_PX)
  const columns = Math.max(1, Math.floor((innerPx + gapPx) / (minCardPx + gapPx)))
  const cardPx = Math.max(minCardPx, (innerPx - (columns - 1) * gapPx) / columns)
  return { columns, cardPx, gapPx, rowHeightPx: cardPx + gapPx }
}
