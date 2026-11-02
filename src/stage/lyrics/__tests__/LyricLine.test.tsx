import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LyricLine } from '../LyricLine'
import type { SongLine } from '../../../contracts/types'

const soloLine: SongLine = {
  part: 'solo',
  notes: [
    { kind: 'normal', startBeat: 0, length: 3, pitch: 65, syllable: 'Wake' },
    { kind: 'normal', startBeat: 4, length: 2, pitch: 65, syllable: 'is' },
  ],
}

const lineWithGoldenNote: SongLine = {
  part: 'solo',
  notes: [{ kind: 'golden', startBeat: 0, length: 4, pitch: 65, syllable: 'Gold' }],
}

describe('LyricLine', () => {
  it('renders every syllable in the line', () => {
    render(<LyricLine line={soloLine} />)
    expect(screen.getByText('Wake')).toBeInTheDocument()
    expect(screen.getByText('is')).toBeInTheDocument()
  })

  // The design's clamp() is still the size the line wants -- it is now the
  // *ceiling* of a fit rather than the size outright, so that a line too long
  // for one row shrinks instead of wrapping the box out of its grid row. It
  // lives in a custom property because that is the one form of declaration
  // jsdom's CSS parser keeps verbatim, which is what makes the fit assertable
  // here rather than only in a browser.
  it('applies a token-driven clamp() font size, as the ceiling of a fit', () => {
    render(<LyricLine line={soloLine} />)

    const container = screen.getByTestId('lyric-line')
    const fit = container.style.getPropertyValue('--lyric-fit')
    expect(fit).toMatch(/clamp\(/)
    expect(fit).toMatch(/^max\(.*min\(clamp\(/)
    expect(container.style.fontSize).toBe('var(--lyric-fit)')
  })

  // The preview is fitted on its own metrics, not the current line's -- it is
  // set 40px against the current line's 68px, so it has room for far more
  // characters before it has to give any of it up.
  it('fits the next-line preview against its own smaller preferred size', () => {
    const { unmount } = render(<LyricLine line={soloLine} />)
    const current = screen.getByTestId('lyric-line').style.getPropertyValue('--lyric-fit')
    unmount()

    render(<LyricLine line={soloLine} variant="next" />)
    const next = screen.getByTestId('lyric-line').style.getPropertyValue('--lyric-fit')

    expect(next).not.toBe(current)
    expect(next).toContain('clamp(1.25rem, 2.2vw, 2.5rem)')
  })

  // A wrap is exactly what the fit exists to prevent: the box budgets two rows,
  // and a line that wraps spends the preview's.
  it('never wraps -- the fit is only a guarantee if wrapping is off the table', () => {
    render(<LyricLine line={soloLine} />)
    expect(screen.getByTestId('lyric-line').className).toContain('whitespace-nowrap')
  })

  it('marks a golden note with a data-note-kind attribute', () => {
    render(<LyricLine line={lineWithGoldenNote} />)
    const syllable = screen.getByText('Gold')
    expect(syllable).toHaveAttribute('data-note-kind', 'golden')
  })

  it('reflects sub-word progress on the active syllable via a CSS custom property', () => {
    const { container } = render(<LyricLine line={soloLine} activeSyllableIndex={0} progress={0.5} />)
    const syllable = container.querySelector<HTMLElement>('[data-active]')!
    expect(syllable).toHaveTextContent('Wake')
    expect(syllable.style.getPropertyValue('--progress')).toBe('0.5')
  })

  // The shadows are static: the dark halo (below) and the coloured glow (above)
  // sit on aria-hidden siblings painted once per syllable, while the element
  // whose --progress moves every frame carries no shadow to re-rasterise.
  it('keeps the halo and glow off the sweeping span, on static aria-hidden siblings', () => {
    const { container } = render(<LyricLine line={soloLine} activeSyllableIndex={0} progress={0.5} />)
    const sweep = container.querySelector<HTMLElement>('[data-active]')!
    expect(sweep.style.textShadow).toBe('none')

    for (const testId of ['lyric-active-halo', 'lyric-active-glow']) {
      const layer = screen.getByTestId(testId)
      expect(layer).toHaveAttribute('aria-hidden')
      expect(layer.style.getPropertyValue('--progress')).toBe('')
      expect(layer.style.willChange).toBe('transform')
    }
    expect(screen.getByTestId('lyric-active-halo').style.textShadow).toContain('rgba(0,0,0')
    expect(screen.getByTestId('lyric-active-glow').style.textShadow).toMatch(/^0 0 44px /)
  })

  it("colours the words already sung in the singer's colour", () => {
    const { container } = render(
      <LyricLine line={soloLine} activeSyllableIndex={1} progress={0.5} accentColor="rgb(255, 0, 0)" />,
    )
    const syllables = container.querySelectorAll<HTMLElement>('[data-note-kind]')
    expect(syllables[0].style.color).toBe('rgb(255, 0, 0)')
    expect(syllables[1].style.backgroundImage).toContain('rgb(255, 0, 0)')
  })

  // LyricBox no longer runs a live backdrop blur under itself, so the contrast
  // these words used to borrow from a blurred video frame is bought outright:
  // a scrim on the box and a dark halo here. A text shadow reads nothing back
  // from the frame buffer, which is exactly why it can replace a blur that did.
  it('carries a dark text halo, so the words survive an arbitrary video frame without a blur under them', () => {
    render(<LyricLine line={soloLine} />)

    const shadow = screen.getByTestId('lyric-line').style.textShadow
    expect(shadow).toContain('rgba(0,0,0')
    // Two layers: a tight offset for a hard glyph edge, a wider one to lift
    // the whole word. One alone is visibly weaker over bright video.
    expect(shadow.match(/rgba\(0,0,0/g)).toHaveLength(2)
  })

  it('gives the next-line preview the same halo, not just the current line', () => {
    render(<LyricLine line={soloLine} variant="next" />)
    expect(screen.getByTestId('lyric-line').style.textShadow).toContain('rgba(0,0,0')
  })
})
