import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ScoreCounter } from '../ScoreCounter'

describe('ScoreCounter readout', () => {
  it('sits at a zero-padded zero until the count beat arrives', () => {
    render(<ScoreCounter score={10000} rolling={false} />)
    expect(screen.getByTestId('results-score')).toHaveTextContent('00000')
  })

  it('pads a small score to the four digits the design starts from', () => {
    render(<ScoreCounter score={40} rolling={false} />)
    expect(screen.getByTestId('results-score')).toHaveTextContent('0000')
  })

  // The authoritative number has to be readable off the DOM whatever the
  // animation is doing -- tests, and anything else inspecting this screen,
  // must never have to wait out a roll to learn the score.
  it('exposes the real final score as data, independent of the roll', () => {
    render(<ScoreCounter score={10000} rolling={false} />)
    expect(screen.getByTestId('results-score')).toHaveAttribute('data-final-score', '10000')
  })

  it('renders the final score immediately when told to skip the roll', () => {
    render(<ScoreCounter score={10000} rolling immediate />)
    expect(screen.getByTestId('results-score')).toHaveTextContent('10000')
  })

  it('still pads the immediate readout, so it occupies the same box as the roll', () => {
    render(<ScoreCounter score={40} rolling immediate />)
    expect(screen.getByTestId('results-score')).toHaveTextContent('0040')
  })

  // Tabular figures are what stop the readout twitching as digits change:
  // proportional numerals give "1" a different advance width from "8", so a
  // rolling counter visibly shivers without them.
  it('renders the digits with tabular figures', () => {
    render(<ScoreCounter score={10000} rolling={false} />)
    expect(screen.getByTestId('results-score')).toHaveStyle({ fontVariantNumeric: 'tabular-nums' })
  })

  // The digits are decoration for a screen reader -- a number that changes 20
  // times in a second is noise, not information. SessionResults announces the
  // real result once, in words, in its own live region.
  it('hides the spinning digits from assistive tech', () => {
    render(<ScoreCounter score={10000} rolling={false} />)
    expect(screen.getByTestId('results-score')).toHaveAttribute('aria-hidden', 'true')
  })

  it('rolls all the way to the final score and stops there', async () => {
    render(<ScoreCounter score={10000} rolling durationMs={60} />)
    await waitFor(() => expect(screen.getByTestId('results-score')).toHaveTextContent('10000'))
  })

  it('fires the tick callback while rolling, and stops once it has settled', async () => {
    const onTick = vi.fn()
    render(<ScoreCounter score={10000} rolling durationMs={120} onTick={onTick} />)

    await waitFor(() => expect(screen.getByTestId('results-score')).toHaveTextContent('10000'))
    const settledCallCount = onTick.mock.calls.length
    expect(settledCallCount).toBeGreaterThan(0)

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(onTick).toHaveBeenCalledTimes(settledCallCount)
  })

  it('never fires the tick callback when the roll is skipped outright', async () => {
    const onTick = vi.fn()
    render(<ScoreCounter score={10000} rolling immediate onTick={onTick} />)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(onTick).not.toHaveBeenCalled()
  })
})
