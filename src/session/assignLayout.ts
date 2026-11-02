/**
 * Grid geometry for the Player Selection screen.
 *
 * Kept as pure arithmetic rather than as CSS so the one thing that actually
 * broke can be *asserted*: a selected badge grows by `transform: scale()`, and
 * a transform reserves no layout space whatsoever. The old
 * `flex gap-4 flex-wrap` reserved the unscaled 190px footprint and nothing
 * else, so a selected-and-hovered badge painted ~10px past its own box on both
 * sides -- into a 16px gutter that two neighbours were already sharing -- and
 * the 70px avatar glow spilled far past even that. The gutter here is derived
 * from the growth it has to absorb instead of being picked by eye.
 */

/** The largest a badge ever gets: selected *and* hovered. */
export const MAX_SELECTED_SCALE = 1.1

/**
 * How far outside its own box the app-wide couch focus treatment paints:
 * `outline: 3px` at `outline-offset: 3px` (src/index.css). Two adjacent focused
 * badges would want this twice, and nothing may clip it.
 */
export const FOCUS_RING_EXTENT = 6

/** Never smaller than this: comfortably past the 44pt minimum target size. */
export const MIN_BADGE_SIZE = 96

/**
 * Four is the widest a row gets. Past that the badges shrink faster than the
 * row gains scanning value, and eight singers read better as 4 x 2.
 */
export const MAX_COLUMNS = 4

/** Screen padding (p-8, both sides). */
const PAGE_INSET_X = 64

/**
 * p-8 top and bottom.
 * Nothing for a shell Back bar: this scene draws Back in its own title row.
 */
const PAGE_INSET_Y = 64

/** Title row + confirm button + the gaps around them. */
const CHROME_HEIGHT = 220

/** The base cap, before the display gets a say. Raised on a bigger panel. */
const BASE_MAX_BADGE_SIZE = 260

/** Fraction of the viewport height a single badge may occupy on a large display. */
const MAX_BADGE_VIEWPORT_FRACTION = 0.24

/** Extra air in the gutter beyond the two hard requirements, so it never reads as tight. */
const GUTTER_BREATHING_ROOM = 8

export interface AssignGrid {
  columns: number
  rows: number
  /** Edge of the square each badge occupies in layout, unscaled. */
  badgeSize: number
  /** Grid gap, in both axes. */
  gap: number
}

export interface AssignGridInput {
  playerCount: number
  viewportWidth: number
  viewportHeight: number
}

/**
 * Column count for a party.
 *
 * Up to four, one column each. Past four, two even rows, so the second row's
 * badges line up under the first instead of under its gaps.
 */
export function columnsFor(playerCount: number): number {
  if (playerCount <= 1) return 1
  if (playerCount <= MAX_COLUMNS) return playerCount
  return Math.min(MAX_COLUMNS, Math.ceil(playerCount / 2))
}

/**
 * The gutter, derived from what it must absorb: both neighbours' selected
 * growth, plus both neighbours' focus outlines, plus air.
 */
export function gapFor(badgeSize: number): number {
  return (
    Math.ceil(badgeSize * (MAX_SELECTED_SCALE - 1)) + 2 * FOCUS_RING_EXTENT + GUTTER_BREATHING_ROOM
  )
}

/**
 * Vertical allowance below the avatar square for the mic badge row and the name
 * row, plus the clearance a centre-origin scale needs so a growing avatar never
 * reaches the text under it.
 */
export function captionAllowanceFor(badgeSize: number): number {
  return Math.round(badgeSize * 0.42) + 20
}

/**
 * Largest badge that fits, once each badge is charged for its own gutter and
 * caption.
 *
 * `gapFor` and `captionAllowanceFor` are both affine in the size, so the fit is
 * solved directly rather than searched: a cell is about `1.1s + 20` wide and
 * `1.52s + 40` tall, and the constant terms are rounded up a little to cover
 * the ceil/round in the two helpers.
 */
export function assignGridFor({ playerCount, viewportWidth, viewportHeight }: AssignGridInput): AssignGrid {
  const columns = columnsFor(playerCount)
  const rows = Math.max(1, Math.ceil(Math.max(playerCount, 1) / columns))

  const availableWidth = Math.max(viewportWidth - PAGE_INSET_X, MIN_BADGE_SIZE)
  const availableHeight = Math.max(viewportHeight - PAGE_INSET_Y - CHROME_HEIGHT, MIN_BADGE_SIZE)

  const byWidth = (availableWidth / columns - 24) / 1.1
  const byHeight = (availableHeight / rows - 44) / 1.52

  // A 190px badge is half the apparent size on a 4K panel that it is on a
  // 1080p one; the cap follows the display so the screen reads the same from
  // the sofa either way.
  const maxBadgeSize = Math.max(BASE_MAX_BADGE_SIZE, Math.round(viewportHeight * MAX_BADGE_VIEWPORT_FRACTION))
  const badgeSize = Math.max(MIN_BADGE_SIZE, Math.min(maxBadgeSize, Math.floor(Math.min(byWidth, byHeight))))

  return { columns, rows, badgeSize, gap: gapFor(badgeSize) }
}
