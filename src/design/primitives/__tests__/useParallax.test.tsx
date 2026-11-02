import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { PARALLAX_PLANE_PX } from '../parallaxOffset'
import { useParallax, useParallaxPlane, type Parallax } from '../useParallax'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect)
}

let captured: { parallax: Parallax; glowX: () => number }

function Harness() {
  const parallax = useParallax()
  const glow = useParallaxPlane(parallax, 'glow')
  captured = { parallax, glowX: () => glow.x.get() }
  return (
    <div ref={parallax.ref} data-testid="host">
      <button type="button" data-testid="a">
        A
      </button>
      <button type="button" data-testid="b">
        B
      </button>
    </div>
  )
}

const rawX = () => captured.parallax.biasX.get()

describe('useParallax', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    vi.restoreAllMocks()
  })

  it('subscribes to pointer movement on mount and unsubscribes on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(<Harness />)
    expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)

    unmount()
    expect(remove.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
  })

  it('leaves no window listener behind after unmount', () => {
    const added: string[] = []
    const removed: string[] = []
    const realAdd = window.addEventListener.bind(window)
    const realRemove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((...args: Parameters<typeof window.addEventListener>) => {
      added.push(args[0])
      realAdd(...args)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((...args: Parameters<typeof window.removeEventListener>) => {
      removed.push(args[0])
      realRemove(...args)
    })

    const { unmount } = render(<Harness />)
    unmount()
    expect(removed.sort()).toEqual(added.sort())
  })

  // A gamepad emits no pointer events, so a mouse-only parallax is dead on a
  // sofa. Reduce Motion must be equally dead -- no listeners at all, not a
  // damped response (HIG Accessibility: reduce "automatic and repetitive
  // animations, including ... peripheral motion").
  it('attaches no listeners whatsoever under reduced motion', () => {
    mocks.reducedMotion = true
    const add = vi.spyOn(window, 'addEventListener')
    render(<Harness />)
    expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(false)
  })

  it('holds every plane at rest under reduced motion even when the pointer moves', () => {
    mocks.reducedMotion = true
    render(<Harness />)
    stubRect(screen.getByTestId('host'), { left: 0, top: 0, width: 1000, height: 1000 })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000, clientY: 1000 }))
    })
    expect(rawX()).toBe(0)
    expect(captured.glowX()).toBe(0)
  })

  it('maps a pointer at the container edge to a full deflection', () => {
    render(<Harness />)
    stubRect(screen.getByTestId('host'), { left: 0, top: 0, width: 1000, height: 1000 })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000, clientY: 500 }))
    })
    expect(rawX()).toBe(1)
  })

  it('settles the glow plane onto its full amplitude, in the opposite direction to the pointer', async () => {
    render(<Harness />)
    stubRect(screen.getByTestId('host'), { left: 0, top: 0, width: 1000, height: 1000 })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000, clientY: 500 }))
    })
    await waitFor(() => expect(captured.glowX()).toBeLessThan(-PARALLAX_PLANE_PX.glow * 0.5))
  })

  it('recentres when the pointer leaves the menu', () => {
    render(<Harness />)
    const host = screen.getByTestId('host')
    stubRect(host, { left: 0, top: 0, width: 1000, height: 1000 })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000, clientY: 500 }))
    })
    act(() => {
      host.dispatchEvent(new MouseEvent('pointerleave'))
    })
    expect(rawX()).toBe(0)
  })

  // The controller case: no pointer ever moves, so focus is the input. The
  // focused control's centre is normalised against the *span of focusable
  // controls*, which is what makes a two-button menu produce a readable tilt
  // instead of the ~0.08 deflection its share of the screen would give.
  it('tilts the scene toward the focused control when there is no pointer at all', () => {
    render(<Harness />)
    stubRect(screen.getByTestId('host'), { left: 0, top: 0, width: 1000, height: 1000 })
    stubRect(screen.getByTestId('a'), { left: 400, top: 500, width: 100, height: 50 })
    stubRect(screen.getByTestId('b'), { left: 600, top: 500, width: 100, height: 50 })

    act(() => {
      screen.getByTestId('b').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(rawX()).toBeGreaterThan(0)

    act(() => {
      screen.getByTestId('a').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(rawX()).toBeLessThan(0)
  })

  it('does not tilt when a lone focusable control is focused -- there is no span to lean along', () => {
    let single: Parallax
    function Single() {
      const parallax = useParallax()
      single = parallax
      return (
        <div ref={parallax.ref} data-testid="host">
          <button type="button" data-testid="only">
            Only
          </button>
        </div>
      )
    }
    render(<Single />)
    stubRect(screen.getByTestId('host'), { left: 0, top: 0, width: 1000, height: 1000 })
    stubRect(screen.getByTestId('only'), { left: 400, top: 500, width: 100, height: 50 })
    act(() => {
      screen.getByTestId('only').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(single!.biasX.get()).toBe(0)
  })

  it('survives a container that has not been laid out yet without emitting NaN', () => {
    render(<Harness />)
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
    })
    expect(rawX()).toBe(0)
  })
})
