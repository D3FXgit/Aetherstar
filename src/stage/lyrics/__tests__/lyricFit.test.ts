import { describe, expect, it } from 'vitest'
import type { SongLine } from '../../../contracts/types'
import {
  FIT_SAFETY_MARGIN,
  GLYPH_WIDTH_EM,
  LYRIC_BOX_HEIGHT,
  LYRIC_BOX_PADDING_Y,
  LYRIC_CURRENT_FLOOR,
  LYRIC_CURRENT_FONT,
  LYRIC_LINE_HEIGHT,
  LYRIC_NEXT_FONT,
  LYRIC_ROW_BUDGET,
  LYRIC_ROW_GAP,
  glyphWidthEm,
  lyricFitFontSize,
  lyricLineSpanEm,
} from '../lyricFit'

function lineOf(...syllables: string[]): SongLine {
  return {
    part: 'solo',
    notes: syllables.map((syllable, index) => ({
      kind: 'normal' as const,
      startBeat: index * 4,
      length: 3,
      pitch: 65,
      syllable,
    })),
  }
}

/** The divisor out of `calc(100cqw / N)` -- the line's width in em. */
function fitSpan(expression: string): number {
  const match = expression.match(/calc\(100cqw \/ ([\d.]+)\)/)
  expect(match, `no cqw fit in ${expression}`).not.toBeNull()
  return Number(match![1])
}

describe('glyphWidthEm', () => {
  /**
   * The four classes, and why one flat average was not enough. Too small for a
   * full-width glyph (a Japanese line would be estimated at half its real width,
   * run off the end of its row and get clipped -- the truncation this module
   * exists to avoid); too large for ordinary lowercase, which shrank lines that
   * had room to spare.
   */
  it('separates the four widths that actually differ', () => {
    expect(glyphWidthEm(' ')).toBe(GLYPH_WIDTH_EM.space)
    expect(glyphWidthEm('a')).toBe(GLYPH_WIDTH_EM.narrow)
    expect(glyphWidthEm('A')).toBe(GLYPH_WIDTH_EM.upper)
    expect(glyphWidthEm('電')).toBe(GLYPH_WIDTH_EM.wide)
  })

  it('reads kana, hangul and full-width forms as a full em, like the ideographs', () => {
    for (const character of ['ひ', 'ヤ', '한', 'Ａ']) {
      expect(glyphWidthEm(character)).toBe(GLYPH_WIDTH_EM.wide)
    }
  })

  // Digits and punctuation have no case, so the uppercase test must not claim
  // them -- `'1'.toUpperCase() === '1'` is true and would have.
  it('does not mistake caseless characters for capitals', () => {
    for (const character of ['1', '!', '’', '-']) {
      expect(glyphWidthEm(character)).toBe(GLYPH_WIDTH_EM.narrow)
    }
  })
})

describe('lyricLineSpanEm', () => {
  // LyricLine renders `{syllable}{' '}` per note, so the laid-out text is the
  // syllables plus one separator each -- this measures what the DOM contains,
  // not what the chart means.
  it('sums every syllable plus the space the renderer draws after it', () => {
    expect(lyricLineSpanEm(lineOf('He', 'y'))).toBeCloseTo(
      GLYPH_WIDTH_EM.upper + GLYPH_WIDTH_EM.narrow * 2 + GLYPH_WIDTH_EM.space * 2,
      5,
    )
  })

  // The case a flat per-character average got badly wrong.
  it('measures a CJK line at roughly twice a Latin line of the same character count', () => {
    const latin = lyricLineSpanEm(lineOf('ab', 'cd'))
    const cjk = lyricLineSpanEm(lineOf('電光', '石火'))
    expect(cjk).toBeGreaterThan(latin * 1.7)
  })

  it('is zero for an empty line rather than throwing', () => {
    expect(lyricLineSpanEm(lineOf())).toBe(0)
  })
})

describe('lyricFitFontSize', () => {
  // The whole point: a short line is not shrunk at all, it just gets the
  // design's preferred size.
  it('leaves the preferred size as the ceiling, so a short line is never scaled up or down', () => {
    const fit = lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 6)
    expect(fit).toContain(`min(${LYRIC_CURRENT_FONT}`)
  })

  /**
   * The regression this pins: a long line used to wrap, and two wrapped lines
   * made the box four rows tall and pushed it off the bottom of the screen.
   * The fit is what replaces wrapping -- and truncation, which in a karaoke game
   * would delete the syllables the singer has not sung yet.
   */
  it('shrinks in exact proportion to the line’s width, so a longer line fits the same row', () => {
    const short = fitSpan(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 10))
    const long = fitSpan(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 40))

    // A bigger divisor is a smaller font size.
    expect(long).toBeGreaterThan(short)
    expect(long / short).toBeCloseTo(4, 5)
    // The line's own width, plus the headroom the estimate is given.
    expect(short).toBeCloseTo(10 * FIT_SAFETY_MARGIN, 5)
  })

  /**
   * The headroom exists because the width table is an estimate and
   * `whitespace-nowrap` means anything past the row's edge is clipped rather
   * than wrapped -- the one way a word could still be lost.
   */
  it('leaves headroom, so an estimate that is a few percent low still fits', () => {
    expect(FIT_SAFETY_MARGIN).toBeGreaterThan(1)
    expect(fitSpan(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 30))).toBeGreaterThan(30)
  })

  // Below the floor the words are smaller than the status pill's label and the
  // trade stops being worth making.
  it('never shrinks past a floor', () => {
    expect(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 2000)).toContain(`max(${LYRIC_CURRENT_FLOOR}`)
  })

  it('does not divide by zero on an empty line', () => {
    expect(fitSpan(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 0))).toBeCloseTo(
      GLYPH_WIDTH_EM.narrow * FIT_SAFETY_MARGIN,
      // The expression rounds to two decimals, so this is exact to that.
      2,
    )
  })

  /**
   * The fit resolves against `cqw`, which is only meaningful inside a size
   * container. If LyricBox ever stopped declaring `container-type: inline-size`
   * the unit would fall back to the small-viewport size and every line would be
   * mis-sized, so the unit is pinned here and the container in LyricBox.test.
   */
  it('measures against the box’s own content width, not the viewport', () => {
    expect(lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, 30)).toContain('100cqw')
  })

  /**
   * The one number that decides whether the whole approach holds: at the fit's
   * floor, how long a line still fits one row? 1.05rem is 16.8px, and the box is
   * ~1478px of content at 1080p, so the floor holds a line of ~88em -- around
   * 180 Latin characters, or 88 CJK ones. No real chart line is remotely that
   * long, which is what makes "shrink to fit" a guarantee in practice rather
   * than a best effort.
   */
  it('holds a line far longer than any real chart contains before it hits the floor', () => {
    const contentWidthAt1080p = 0.82 * 1920 - 96
    const floorPx = 1.05 * 16
    const longestFittingSpanEm = contentWidthAt1080p / floorPx

    expect(longestFittingSpanEm).toBeGreaterThan(80)

    // A realistically long one: ~95 characters, as long as the longest verse
    // lines this was tested against in the running app. It comes to ~42em --
    // less than half of what the floor can still hold on one row.
    const longRealLine = lyricLineSpanEm(
      lineOf(...'Every lantern on the river told us we were nearly home and every song we sang was louder still'.split(' ')),
    )
    expect(longRealLine).toBeLessThan(longestFittingSpanEm / 2)
  })
})

describe('LYRIC_BOX_HEIGHT', () => {
  // Two rows and no more: the box's whole reason for having a fixed height.
  it('is exactly the two rows, their gap and the box’s own padding', () => {
    expect(LYRIC_ROW_BUDGET).toBe(2)
    expect(LYRIC_BOX_HEIGHT).toBe(
      `calc((${LYRIC_CURRENT_FONT} + ${LYRIC_NEXT_FONT}) * ${LYRIC_LINE_HEIGHT}` +
        ` + ${LYRIC_ROW_GAP} + ${LYRIC_BOX_PADDING_Y} * 2)`,
    )
  })

  /**
   * The box shares `clamp(13rem, 26vh, 17rem)` with the status pill beneath it
   * (stage/layout.ts), so its own worst case has to leave room for one. At the
   * clamps' ceilings the two rows come to (68 + 40) x 1.14 = 123px, plus an 8px
   * gap and 2 x 21.6px of padding: 175px, against a 272px row.
   */
  it('fits inside the grid row it shares with the status pill, at the type’s largest', () => {
    const maxCurrentPx = 4.25 * 16
    const maxNextPx = 2.5 * 16
    const gapPx = 0.5 * 16
    const paddingPx = 1.35 * 16 * 2
    const tallestBoxPx = (maxCurrentPx + maxNextPx) * LYRIC_LINE_HEIGHT + gapPx + paddingPx

    const rowCeilingPx = 17 * 16
    expect(tallestBoxPx).toBeLessThan(rowCeilingPx)
    // And with a status pill's worth of room to spare underneath it.
    expect(rowCeilingPx - tallestBoxPx).toBeGreaterThan(3.5 * 16)
  })
})
