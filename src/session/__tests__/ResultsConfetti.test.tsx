import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ResultsConfetti } from '../ResultsConfetti'
import { CONFETTI_COUNT } from '../confetti'
import { BEAT_DURATIONS } from '../resultsChoreography'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('ResultsConfetti', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until the burst is armed', () => {
    render(<ResultsConfetti active={false} />)
    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })

  it('renders exactly the capped number of pieces once armed', () => {
    render(<ResultsConfetti active />)
    expect(screen.getByTestId('results-confetti').children).toHaveLength(CONFETTI_COUNT)
  })

  it('is inert to the pointer and hidden from assistive tech', () => {
    render(<ResultsConfetti active />)
    const burst = screen.getByTestId('results-confetti')
    expect(burst).toHaveAttribute('aria-hidden', 'true')
    expect(burst.className).toContain('pointer-events-none')
  })

  // The teardown guarantee. A results screen is left open for as long as a
  // party wants to look at it; if the burst were still on screen it would be
  // holding compositor layers (and, with any per-frame implementation, a core)
  // indefinitely. It has to remove itself, not merely finish.
  it('unmounts itself entirely once the burst has run', () => {
    render(<ResultsConfetti active />)
    expect(screen.getByTestId('results-confetti')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(BEAT_DURATIONS.confettiLifetimeMs + 1)
    })

    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })

  it('tears down immediately when disarmed mid-burst -- a skip must not leave it running', () => {
    const { rerender } = render(<ResultsConfetti active />)
    expect(screen.getByTestId('results-confetti')).toBeInTheDocument()

    rerender(<ResultsConfetti active={false} />)

    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })

  it('leaves no timer behind when the whole screen unmounts mid-burst', () => {
    const { unmount } = render(<ResultsConfetti active />)
    unmount()

    // A surviving timer would fire a setState on an unmounted component here.
    expect(() => act(() => vi.advanceTimersByTime(BEAT_DURATIONS.confettiLifetimeMs * 2))).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  // Every piece must be composited, never painted per frame: only `transform`
  // and `opacity` may vary, and the animation must be one-shot.
  it('drives every piece from one shared, one-shot CSS keyframe', () => {
    render(<ResultsConfetti active />)
    for (const piece of Array.from(screen.getByTestId('results-confetti').children)) {
      const style = (piece as HTMLElement).style
      expect(style.animationName).toBe('aeConfetti')
      expect(style.animationIterationCount).toBe('1')
      expect(style.animationFillMode).toBe('forwards')
      // The per-piece geometry rides on custom properties, so 36 pieces share
      // one keyframe instead of needing 36.
      expect(style.getPropertyValue('--ae-confetti-y')).not.toBe('')
    }
  })

  /**
   * The full-screen results surface changed the *area*, not the budget.
   *
   * confetti.ts calls 36 a hard cap rather than a default, deliberately: the
   * budget exists for the audio thread's sake, and an emitter whose cost
   * depends on how big the surface is, is an emitter that is eventually too
   * expensive. So the count does not move, and each piece's size and travel
   * scale instead -- otherwise a 4K screen would get 36 tiny flecks falling a
   * sixth of the way down it.
   */
  it('keeps the piece count fixed no matter how big the surface gets', () => {
    const { rerender } = render(<ResultsConfetti active scale={1} />)
    expect(screen.getByTestId('results-confetti').children).toHaveLength(CONFETTI_COUNT)

    rerender(<ResultsConfetti active scale={2} />)
    expect(screen.getByTestId('results-confetti').children).toHaveLength(CONFETTI_COUNT)
  })

  it('scales each piece’s size and travel with the design unit instead', () => {
    const { rerender, unmount } = render(<ResultsConfetti active scale={1} />)
    const at1x = Array.from(screen.getByTestId('results-confetti').children).map((piece) => ({
      width: (piece as HTMLElement).style.width,
      fall: (piece as HTMLElement).style.getPropertyValue('--ae-confetti-y'),
    }))

    rerender(<ResultsConfetti active scale={2} />)
    const at2x = Array.from(screen.getByTestId('results-confetti').children).map((piece) => ({
      width: (piece as HTMLElement).style.width,
      fall: (piece as HTMLElement).style.getPropertyValue('--ae-confetti-y'),
    }))

    for (const [index, piece] of at2x.entries()) {
      expect(parseFloat(piece.width)).toBeCloseTo(parseFloat(at1x[index].width) * 2)
      expect(parseFloat(piece.fall)).toBeCloseTo(parseFloat(at1x[index].fall) * 2)
    }

    unmount()
  })

  // The most motion-heavy thing on the screen, so reduced motion removes it rather than slowing it.
  it('renders nothing at all under reduced motion', () => {
    mocks.reducedMotion = true
    render(<ResultsConfetti active />)
    expect(screen.queryByTestId('results-confetti')).not.toBeInTheDocument()
  })
})
