import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StageLights } from '../StageLights'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('StageLights', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
  })

  it('is decoration only: hidden from assistive tech and click-through', () => {
    render(<StageLights />)
    const lights = screen.getByTestId('stage-lights')
    expect(lights).toHaveAttribute('aria-hidden', 'true')
    expect(lights.className).toContain('pointer-events-none')
  })

  it('animates when motion is allowed', () => {
    render(<StageLights />)
    expect(screen.getByTestId('stage-lights')).toHaveAttribute('data-animated', 'true')
  })

  // The beams stay (they are the backdrop), but nothing sways.
  it('holds the beams still under reduced motion', () => {
    mocks.reducedMotion = true
    render(<StageLights />)
    expect(screen.getByTestId('stage-lights')).toHaveAttribute('data-animated', 'false')
  })
})
