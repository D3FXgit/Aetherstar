import type { SongLine } from '../../contracts/types'

/**
 * The lyric box's two-line budget, and the CSS that enforces it.
 *
 * ## The bug this exists to fix
 *
 * The box holds the current chart line and a grey preview of the next one, and
 * it sat in `STAGE_LYRIC_CELL` at its content height. Both lines wrapped freely,
 * so a long line became two rendered rows, two long lines became four, and the
 * box grew straight down out of its grid row -- over the status pill and off the
 * bottom of the screen. The row it lives in is `clamp(13rem, 26vh, 17rem)` and
 * it has to share that with the pill, so "as tall as the words need" was never a
 * height the layout could honour.
 *
 * ## What "two lines" means when one chart line is already too long
 *
 * The box renders exactly two rows: the current line on the first, the preview
 * on the second. The interesting case is a single chart line that will not fit
 * across one row on its own -- which is the case that actually caused the
 * overflow, since a full-width box at 68px holds roughly 45 characters and
 * plenty of lyrics are longer than that.
 *
 * The three available answers, and why this is the one:
 *
 * * **Truncate it** (`line-clamp` / an ellipsis). Unacceptable here. This is a
 *   karaoke game: the words on screen are the instructions, and cutting the end
 *   off a phrase is cutting off the part the singer has not sung yet. It also
 *   silently deletes syllables that the sweep is about to highlight, so the
 *   accent underline would travel off the end of a line that no longer exists.
 * * **Let it wrap and drop the preview.** Keeps every word, keeps the budget --
 *   but it costs the singer the next line at exactly the moment the chart is
 *   densest, and it makes the box's *content* jump between one-big-row and
 *   two-rows-of-something-else from line to line.
 * * **Shrink the type until the line fits its row** -- this one. Every syllable
 *   stays on screen, the preview stays, the box height never changes, and the
 *   only thing that gives is point size, which is the one variable a singer
 *   does not have to read ahead of.
 *
 * So: a line is laid out at its preferred size, unless its estimated width in em
 * (see `lyricLineSpanEm`) exceeds the box's inner width -- in which case its
 * font size becomes exactly the size at which it does fit. `100cqw` is
 * the box's own content-box width (LyricBox declares `container-type:
 * inline-size`), so this is a real fit against real available space with no
 * JavaScript measurement anywhere -- which matters because jsdom has no text
 * metrics and this whole layer is unit-tested.
 *
 * The floor is the backstop. Below it the words would be smaller than the status
 * pill's label and the trade stops being worth making; a line long enough to hit
 * it (~180 characters at 1080p) does not exist in any real chart, and if one
 * ever did, the box's fixed height plus `overflow: clip` keeps it inside its grid
 * row rather than letting it push the pill off the screen.
 */

/** Rendered rows the box may ever occupy: the current line, and the preview under it. */
export const LYRIC_ROW_BUDGET = 2

/** Line box height as a multiple of the font size, for both rows. */
export const LYRIC_LINE_HEIGHT = 1.14

/** Vertical padding inside the box, top and bottom. */
export const LYRIC_BOX_PADDING_Y = '1.35rem'

/** The gap between the two rows. */
export const LYRIC_ROW_GAP = '0.5rem'

/** Preferred type sizes (about 68px current line, 40px preview at 1080p), as viewport clamps. */
export const LYRIC_CURRENT_FONT = 'clamp(2rem, 3.6vw, 4.25rem)'
export const LYRIC_NEXT_FONT = 'clamp(1.25rem, 2.2vw, 2.5rem)'

/** Sizes the fit is never allowed to shrink past. */
export const LYRIC_CURRENT_FLOOR = '1.05rem'
export const LYRIC_NEXT_FLOOR = '0.85rem'

/**
 * Advance widths, in em, by the only distinctions that actually matter.
 *
 * Deliberately a table rather than a measurement. The alternative is a canvas
 * `measureText` per line on the same main thread that runs the audio engine,
 * for a number that only has to be right enough to pick a font size -- and it
 * would make this module untestable under jsdom, which has no text metrics at
 * all.
 *
 * One flat average was the first attempt and it was wrong in both directions at
 * once. Too small for a Japanese line -- a full-width glyph is a whole em, so a
 * chart in `assets`-style CJK would be estimated at half its real width, run
 * past the end of its row and get clipped, which is the truncation this whole
 * module exists to avoid. Too large for ordinary English, where a flat 0.52
 * over-estimated by about 20% and shrank lines that had room to spare (measured
 * in the running app: a 95-character line laid out at 42.3em against an estimate
 * of 49.4em).
 *
 * Four classes covers it, and each number is the measured advance for the app's
 * display face at 600-700 weight:
 *
 *   space    0.26  a word space is roughly half a lowercase letter
 *   upper    0.62  capitals are much wider, and some charts are ALL CAPS
 *   wide     1.00  CJK and full-width forms are square by definition
 *   narrow   0.48  everything else -- lowercase, digits, punctuation
 */
export const GLYPH_WIDTH_EM = {
  space: 0.26,
  narrow: 0.48,
  upper: 0.62,
  wide: 1.0,
} as const

/**
 * Full-width and CJK ranges -- the characters that are one em wide.
 *
 * Hangul jamo and syllables, Kana, CJK ideographs (including Extension A),
 * compatibility ideographs, and the full-width/vertical forms blocks. This is
 * the standard "East Asian Wide/Fullwidth" set, minus the astral planes that a
 * lyric file will not contain.
 */
const WIDE_GLYPH =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/

/** The advance width of one character, in em. */
export function glyphWidthEm(character: string): number {
  if (character === ' ') return GLYPH_WIDTH_EM.space
  if (WIDE_GLYPH.test(character)) return GLYPH_WIDTH_EM.wide
  if (character !== character.toLowerCase() && character === character.toUpperCase()) {
    return GLYPH_WIDTH_EM.upper
  }
  return GLYPH_WIDTH_EM.narrow
}

/**
 * The box's height: exactly two rows, their gap, and its own padding.
 *
 * Fixed rather than `min-height`, so it is the *same* height whether it is
 * showing two lines, one line at the end of the chart, or a shrunken long line.
 * A box that resized per line would make the words twitch upward and downward
 * for the length of every song.
 */
export const LYRIC_BOX_HEIGHT =
  `calc((${LYRIC_CURRENT_FONT} + ${LYRIC_NEXT_FONT}) * ${LYRIC_LINE_HEIGHT}` +
  ` + ${LYRIC_ROW_GAP} + ${LYRIC_BOX_PADDING_Y} * 2)`

/**
 * How wide a line lays out, in em.
 *
 * `LyricLine` renders every note as `{syllable}{' '}`, including the last, so the
 * rendered text is the syllables plus one separating space each -- this measures
 * what the DOM contains rather than what the chart means.
 */
export function lyricLineSpanEm(line: SongLine): number {
  let span = 0
  for (const note of line.notes) {
    for (const character of note.syllable) span += glyphWidthEm(character)
    span += GLYPH_WIDTH_EM.space
  }
  return span
}

/**
 * The preview's size, as a fraction of whatever size the current line ended up
 * at.
 *
 * The preview is 0.59 of the line being sung, and that ratio is the hierarchy: at a glance the big row is
 * what you sing now and the small grey one is what comes next.
 *
 * Fitting each row independently breaks it, and does so exactly when it matters
 * most. A long current line shrinks to fit while a shorter preview under it does
 * not, and the two end up the same size -- observed at 1080p with a 95-character
 * line over a 78-character one: the current line fitted to 35px while the
 * preview stayed at its preferred 40px, so the *preview* was the larger of the
 * two. Capping the preview against the current line's own fitted size keeps the
 * ratio through every amount of shrinking.
 */
export const PREVIEW_SIZE_RATIO = 0.6

/**
 * Headroom on the fit, because the table above is an estimate.
 *
 * Measured in the running app at 1080p, a 95-character line fitted to 34.9px
 * laid out at 1505px inside 1572px of box -- 95.7% of the row, which is the
 * estimate being accurate to within half a percent and is also uncomfortably
 * close to the edge. `whitespace-nowrap` means anything past that edge is
 * clipped rather than wrapped, so the one failure mode left is the estimate
 * being a few percent low on some string the table does not model well (a run of
 * capital Ws, an unusual fallback face). Six percent buys the margin for about
 * one point of size on a long line, which is the right side of that trade.
 */
export const FIT_SAFETY_MARGIN = 1.06

/**
 * The font size at which a line `spanEm` ems wide fits one row.
 *
 * `max(floor, min(preferred, 100cqw / spanEm, ...ceilings))` -- the preferred
 * size until the line is too long for it, the exact fitting size after that, and
 * never below the floor. Dividing the container's content width by the line's
 * width in em gives the largest em size that still fits.
 *
 * `ceilings` is how the preview is held under the current line (see
 * PREVIEW_SIZE_RATIO): any further upper bound, as a CSS length.
 */
export function lyricFitFontSize(
  preferred: string,
  floor: string,
  spanEm: number,
  ...ceilings: string[]
): string {
  const span = Math.max(spanEm, GLYPH_WIDTH_EM.narrow) * FIT_SAFETY_MARGIN
  const bounds = [preferred, `calc(100cqw / ${span.toFixed(2)})`, ...ceilings]
  return `max(${floor}, min(${bounds.join(', ')}))`
}
