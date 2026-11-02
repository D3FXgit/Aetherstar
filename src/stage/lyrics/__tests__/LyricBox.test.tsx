import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricBox } from '../LyricBox'
import { LYRIC_BOX_HEIGHT, PREVIEW_SIZE_RATIO } from '../lyricFit'
import type { SongLine } from '../../../contracts/types'

const lines: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 3, pitch: 65, syllable: 'Wake' }] },
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 16, length: 2, pitch: 65, syllable: 'Spark' }] },
]

/** A line long enough that it would have wrapped -- the case that broke the box. */
function longLine(words: number): SongLine {
  return {
    part: 'solo',
    notes: Array.from({ length: words }, (_, index) => ({
      kind: 'normal' as const,
      startBeat: index * 4,
      length: 3,
      pitch: 65,
      syllable: `syllable${index}`,
    })),
  }
}

/** The `calc(100cqw / N)` divisor a rendered line was sized with. */
function fitSpan(node: HTMLElement): number {
  const match = node.style.getPropertyValue('--lyric-fit').match(/calc\(100cqw \/ ([\d.]+)\)/)
  expect(match).not.toBeNull()
  return Number(match![1])
}

describe('LyricBox', () => {
  it('renders both the current and next line', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)
    expect(screen.getByText('Wake')).toBeInTheDocument()
    expect(screen.getByText('Spark')).toBeInTheDocument()
  })

  it('renders only the current line at the chart\'s end', () => {
    render(<LyricBox lines={lines} currentLineIndex={1} progress={0} />)
    expect(screen.getByText('Spark')).toBeInTheDocument()
    expect(screen.queryByText('Wake')).not.toBeInTheDocument()
  })

  /**
   * This is the largest surface in the app and it sits over playing video for
   * the whole song. A live `backdrop-filter` under a surface this size is the
   * single most expensive thing this app can ask a GPU to do -- removing the
   * 44px one this used to carry was worth +32% frame rate on an M3 Max (see
   * design/__tests__/blurBudget.test.ts). It must never grow one back.
   */
  it('uses no backdrop-filter at all: the box is a flat scrim, not a per-frame blur', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)

    const box = screen.getByTestId('lyric-box')
    expect(box.className).not.toMatch(/backdrop-blur/)
    expect(box.style.backdropFilter).toBe('')
    expect(box.style.getPropertyValue('-webkit-backdrop-filter')).toBe('')
  })

  /**
   * Dropping the blur without replacing the contrast it was carrying would be a
   * legibility regression, not an optimisation. The scrim is the box's half of
   * that trade; the glyph halo in LyricLine is the other half.
   */
  it('is dark enough to carry the lyrics\' contrast on its own over a white frame', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)

    const background = screen.getByTestId('lyric-box').style.background
    const alphas = [...background.matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/g)].map((m) =>
      Number(m[1]),
    )

    expect(alphas.length).toBeGreaterThanOrEqual(2)
    for (const alpha of alphas) expect(alpha).toBeGreaterThanOrEqual(0.75)
  })
})

/**
 * The two-line cap.
 *
 * The box used to size itself to its content, so a long chart line wrapped, two
 * long lines made four rendered rows, and the box grew down out of
 * `STAGE_LYRIC_CELL`'s `clamp(13rem, 26vh, 17rem)` row -- over the status pill
 * and off the bottom of the screen.
 *
 * Two rows now, always, at a height that does not depend on the words. See
 * lyricFit.ts for why a single over-long line is scaled down to fit its row
 * rather than wrapped onto the preview's row or truncated: in a karaoke game the
 * words on screen are the instructions, and cutting off the end of a phrase cuts
 * off the part that has not been sung yet.
 */
describe('LyricBox two-line cap', () => {
  it('renders at most two lines: the current one and the preview', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)
    expect(screen.getAllByTestId('lyric-line')).toHaveLength(2)
  })

  it('stands at a fixed two-row height rather than sizing to its content', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)

    const box = screen.getByTestId('lyric-box')
    expect(box.style.height).toBe('var(--lyric-box-height)')
    expect(box.style.getPropertyValue('--lyric-box-height')).toBe(LYRIC_BOX_HEIGHT)
  })

  it('is exactly as tall for a very long line as for a two-syllable one', () => {
    const { unmount } = render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)
    const short = screen.getByTestId('lyric-box').style.getPropertyValue('--lyric-box-height')
    unmount()

    render(<LyricBox lines={[longLine(24), longLine(24)]} currentLineIndex={0} progress={0} />)
    expect(screen.getByTestId('lyric-box').style.getPropertyValue('--lyric-box-height')).toBe(short)
  })

  // The alternative that was rejected. Every syllable of an over-long line is
  // still in the DOM -- what gives is point size, not words.
  it('keeps every syllable of an over-long line on screen rather than truncating it', () => {
    render(<LyricBox lines={[longLine(20)]} currentLineIndex={0} progress={0} />)

    for (let index = 0; index < 20; index++) {
      expect(screen.getByText(`syllable${index}`)).toBeInTheDocument()
    }
  })

  it('scales an over-long line down to fit its row instead of wrapping onto the preview’s', () => {
    render(<LyricBox lines={[longLine(20), lines[1]]} currentLineIndex={0} progress={0} />)

    const [current, next] = screen.getAllByTestId('lyric-line')
    // The long line is fitted far tighter than the three-character preview...
    expect(fitSpan(current)).toBeGreaterThan(fitSpan(next) * 10)
    // ...and neither is allowed to wrap, because a wrap is what breaks the cap.
    expect(current.className).toContain('whitespace-nowrap')
    expect(next.className).toContain('whitespace-nowrap')
  })

  /**
   * The hierarchy, through every amount of shrinking.
   *
   * Fitting each row independently breaks it exactly when it matters: at 1080p a
   * 95-character current line fitted down to 35px while a 78-character preview
   * under it stayed at its preferred 40px, so the grey "what's next" row was the
   * *larger* of the two. The preview is capped against the current line's own
   * fitted size instead.
   */
  it('holds the preview under the line being sung, however far that line has shrunk', () => {
    render(<LyricBox lines={[longLine(20), longLine(14)]} currentLineIndex={0} progress={0} />)

    const [current, next] = screen.getAllByTestId('lyric-line')
    const currentFit = current.style.getPropertyValue('--lyric-fit')

    expect(next.style.getPropertyValue('--lyric-fit')).toContain(
      `calc((${currentFit}) * ${PREVIEW_SIZE_RATIO})`,
    )
  })

  /**
   * `container-type: inline-size` is what makes the per-line `100cqw` fit
   * resolve against the box's own content width. Without it the unit falls back
   * to the small-viewport size and every line is mis-sized, so the declaration
   * is pinned rather than left as an implementation detail.
   */
  it('is the size container the per-line fit measures against', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)
    expect(screen.getByTestId('lyric-box').style.containerType).toBe('inline-size')
  })

  /**
   * The backstop, and the reason it is `clip` with a margin rather than
   * `hidden`: the active syllable's 44px accent bloom legitimately spills past
   * the text, and `hidden` would shave it off along the box's edges.
   */
  it('bounds itself without shaving the sweep’s glow off its edges', () => {
    render(<LyricBox lines={lines} currentLineIndex={0} progress={0} />)

    const box = screen.getByTestId('lyric-box')
    expect(box.style.overflow).toBe('clip')
    expect(box.style.overflowClipMargin).not.toBe('')
  })
})
