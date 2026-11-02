import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import type { SongLine } from '../../../contracts/types'
import { micRimColor, tokens } from '../../../design/tokens'
import { ClockLyrics } from '../ClockLyrics'
import { LyricBox } from '../LyricBox'
import { LyricLine } from '../LyricLine'
import { LYRIC_FALLBACK_ACCENT, isUsableLyricColor, lyricAccent, lyricSweepGradient } from '../lyricAccent'

/**
 * Regression: the karaoke wipe rendered black on Windows. The sweep's static
 * dark halo copy was painted *over* the sweeping text (a positioned sibling
 * paints after in-flow text), and an empty or invalid singer colour would drop
 * the gradient outright, leaving transparent text with only its dark shadow.
 * Every case below must produce a two-stop gradient of real colours, with the
 * halo behind the sweep and the glow over it.
 */

const SWEEP = /^linear-gradient\(90deg, (.+) calc\(var\(--progress\) \* 100%\), (.+) calc\(var\(--progress\) \* 100%\)\)$/

/** The colours of the active syllable's wipe, as written to its inline style. */
function sweepStops(scope: HTMLElement): { sung: string; unsung: string; raw: string } {
  const sweep = scope.querySelector<HTMLElement>('[data-active]')
  expect(sweep, 'an active syllable is rendered').not.toBeNull()
  const raw = sweep!.style.backgroundImage
  const match = SWEEP.exec(raw)
  expect(match, `sweep gradient is well formed: "${raw}"`).not.toBeNull()
  return { sung: match![1], unsung: match![2], raw }
}

function expectSaneSweep(scope: HTMLElement, expectedSung: string) {
  const { sung, unsung, raw } = sweepStops(scope)
  expect(raw).not.toMatch(/undefined|null|NaN/)
  expect(raw).not.toMatch(/\(\s*,|,\s*,|,\s*calc/)
  expect(isUsableLyricColor(sung)).toBe(true)
  expect(isUsableLyricColor(unsung)).toBe(true)
  expect(sung).toBe(expectedSung)
  // Unsung stays bright white, never the dim of a disabled control.
  expect(unsung).toMatch(/^rgba\(242, ?242, ?244, ?0\.9\d?\)$/)

  // The text itself is transparent so the gradient shows through it.
  const sweep = scope.querySelector<HTMLElement>('[data-active]')!
  expect(sweep.style.color).toBe('transparent')
  expect(sweep.style.textShadow).toBe('none')

  // Paint order: the dark halo behind the sweep, the coloured glow over it.
  const syllable = within(scope).getByTestId('lyric-active-syllable')
  expect(syllable.style.isolation).toBe('isolate')
  const halo = within(scope).getByTestId('lyric-active-halo')
  const glow = within(scope).getByTestId('lyric-active-glow')
  expect(Number(halo.style.zIndex)).toBeLessThan(0)
  expect(Number(glow.style.zIndex)).toBeGreaterThan(0)
  expect(halo.style.textShadow).toContain('rgba(0,0,0')
  expect(glow.style.textShadow).toBe(`0 0 44px ${expectedSung}`)
  expect(glow.style.textShadow).not.toMatch(/rgba\(0,0,0/)
}

const soloLine: SongLine = {
  part: 'solo',
  notes: [
    { kind: 'normal', startBeat: 0, length: 4, pitch: 60, syllable: 'Sing' },
    { kind: 'normal', startBeat: 4, length: 4, pitch: 62, syllable: 'loud' },
  ],
}

const goldenLine: SongLine = {
  part: 'solo',
  notes: [{ kind: 'golden', startBeat: 0, length: 4, pitch: 60, syllable: 'Gold' }],
}

const duetLines: SongLine[] = [
  { part: 'p1', notes: [{ kind: 'normal', startBeat: 0, length: 8, pitch: 60, syllable: 'One' }] },
  { part: 'p2', notes: [{ kind: 'normal', startBeat: 0, length: 8, pitch: 64, syllable: 'Two' }] },
]

describe('lyricAccent', () => {
  it.each([undefined, null, '', '   ', 'undefined', 'null', 'none', 'transparent', 'oklch(undefined 0.1 20)'])(
    'falls back to the original cyan for %j',
    (color) => {
      expect(lyricAccent(color as string | undefined)).toBe(LYRIC_FALLBACK_ACCENT)
      expect(LYRIC_FALLBACK_ACCENT).toBe(tokens.accent.cyan)
    },
  )

  it('keeps a real colour, in any format a gradient takes', () => {
    expect(lyricAccent(micRimColor(1))).toBe(micRimColor(1))
    expect(lyricAccent('#ff3366')).toBe('#ff3366')
    expect(lyricAccent(' rgb(1, 2, 3) ')).toBe('rgb(1, 2, 3)')
  })

  it('builds a two-stop hard wipe with both colours present', () => {
    expect(lyricSweepGradient('red', 'white')).toBe(
      'linear-gradient(90deg, red calc(var(--progress) * 100%), white calc(var(--progress) * 100%))',
    )
  })
})

describe('the karaoke wipe never paints an empty colour', () => {
  it('solo singer with a configured mic: their mic colour', () => {
    const { container } = render(<LyricLine line={soloLine} activeSyllableIndex={0} progress={0.4} accentColor={micRimColor(2)} />)
    expectSaneSweep(container, micRimColor(2))
  })

  it('no hardware / no known singer: the original cyan', () => {
    const { container } = render(<LyricLine line={soloLine} activeSyllableIndex={0} progress={0.4} />)
    expectSaneSweep(container, tokens.accent.cyan)
  })

  it.each(['', 'undefined', '  '])('an unusable singer colour (%j) falls back to the original cyan', (bad) => {
    const { container } = render(<LyricLine line={soloLine} activeSyllableIndex={1} progress={0.4} accentColor={bad} />)
    expectSaneSweep(container, tokens.accent.cyan)
    // The word already sung takes the same fallback, not an empty colour.
    const sung = container.querySelector<HTMLElement>('[data-note-kind]:not([data-active])')!
    expect(sung.style.color).not.toBe('')
  })

  it('a golden note sweeps gold whoever sings it', () => {
    const { container } = render(<LyricLine line={goldenLine} activeSyllableIndex={0} progress={0.4} accentColor={micRimColor(1)} />)
    expectSaneSweep(container, tokens.accent.gold)
  })

  it('the stage lyric box (solo, store-fed colour or none)', () => {
    const { container, unmount } = render(
      <LyricBox lines={[soloLine]} currentLineIndex={0} activeSyllableIndex={0} progress={0.5} accentColor={micRimColor(0)} />,
    )
    expectSaneSweep(container, micRimColor(0))
    unmount()

    const empty = render(<LyricBox lines={[soloLine]} currentLineIndex={0} activeSyllableIndex={0} progress={0.5} accentColor="" />)
    expectSaneSweep(empty.container, tokens.accent.cyan)
    expect(screen.getByTestId('lyric-box').style.borderColor).toBe('')
  })

  it("duets (host and audience): each box in its part's colour", () => {
    const beat = motionValue(2)
    render(<ClockLyrics lines={duetLines} beatPosition={beat} partColors={[micRimColor(4), micRimColor(5)]} />)
    const [p2, p1] = screen.getAllByTestId('lyric-box')
    expect(p2).toHaveAttribute('data-part', 'p2')
    expectSaneSweep(p1, micRimColor(4))
    expectSaneSweep(p2, micRimColor(5))
  })

  it("duets with missing or blank lane colours: each part's mic colour", () => {
    const beat = motionValue(2)
    render(<ClockLyrics lines={duetLines} beatPosition={beat} partColors={['']} />)
    const [p2, p1] = screen.getAllByTestId('lyric-box')
    expectSaneSweep(p1, micRimColor(0))
    expectSaneSweep(p2, micRimColor(1))
  })

  it('an ordinary song on the clock (the audience window): one singer, one colour; otherwise cyan', () => {
    const beat = motionValue(1)
    const { unmount } = render(<ClockLyrics lines={[soloLine]} beatPosition={beat} partColors={[micRimColor(3)]} />)
    expectSaneSweep(screen.getByTestId('lyric-box'), micRimColor(3))
    unmount()

    const crowd = render(<ClockLyrics lines={[soloLine]} beatPosition={beat} partColors={[micRimColor(0), micRimColor(1)]} />)
    expectSaneSweep(crowd.getByTestId('lyric-box'), tokens.accent.cyan)
    crowd.unmount()

    render(<ClockLyrics lines={[soloLine]} beatPosition={beat} partColors={['undefined']} />)
    expectSaneSweep(screen.getByTestId('lyric-box'), tokens.accent.cyan)
  })
})
