import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroFrame } from '../HeroFrame'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

describe('HeroFrame', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
  })

  it('renders the wordmark and tagline plus its children', () => {
    render(
      <HeroFrame>
        <button type="button">Start a night</button>
      </HeroFrame>,
    )
    expect(screen.getByRole('heading', { name: 'AetherStar' })).toBeInTheDocument()
    expect(screen.getByText('Sing together')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a night' })).toBeInTheDocument()
  })

  // The tagline is sentence case, not a letter-spaced all-caps label.
  it('sets the tagline in sentence case', () => {
    render(<HeroFrame>x</HeroFrame>)
    expect(screen.getByText('Sing together').className).not.toContain('uppercase')
  })

  // Back to front: the colour wash, the stage lights, the content.
  it('renders three distinct depth planes', () => {
    render(<HeroFrame>x</HeroFrame>)
    expect(screen.getByTestId('hero-glow')).toBeInTheDocument()
    expect(screen.getByTestId('stage-lights')).toBeInTheDocument()
    expect(screen.getByTestId('hero-content')).toBeInTheDocument()
  })

  // The old canvas flow field is gone; the backdrop is CSS only.
  it('draws no canvas behind the menu', () => {
    const { container } = render(<HeroFrame>x</HeroFrame>)
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('keeps the content plane above the ambient planes so nothing paints over the CTAs', () => {
    render(<HeroFrame>x</HeroFrame>)
    expect(screen.getByTestId('hero-content').className).toContain('z-10')
    expect(screen.getByTestId('stage-lights').className).toContain('pointer-events-none')
    expect(screen.getByTestId('hero-glow').className).toContain('pointer-events-none')
  })

  it('holds the stage lights still under reduced motion, keeping the backdrop', () => {
    mocks.reducedMotion = true
    render(<HeroFrame>x</HeroFrame>)
    expect(screen.getByTestId('hero-glow')).toBeInTheDocument()
    expect(screen.getByTestId('stage-lights')).toHaveAttribute('data-animated', 'false')
  })

  // Promoting the parallax planes moves textures instead of repainting a
  // full-viewport gradient and a 96px wordmark on every pointer frame.
  describe('compositor promotion (frame-rate regression)', () => {
    it('promotes the planes the parallax translates, so a pointer sweep transforms layers instead of repainting them', () => {
      render(<HeroFrame>x</HeroFrame>)
      expect(screen.getByTestId('hero-glow')).toHaveStyle({ willChange: 'transform' })
      expect(screen.getByTestId('hero-content')).toHaveStyle({ willChange: 'transform' })
    })

    it('promotes nothing under reduced motion, where the parallax is inert and a layer would be pure cost', () => {
      mocks.reducedMotion = true
      render(<HeroFrame>x</HeroFrame>)
      expect(screen.getByTestId('hero-glow').style.willChange).toBe('')
      expect(screen.getByTestId('hero-content').style.willChange).toBe('')
    })
  })

  // The focus ring is an outset outline; a clipping container would cut it off.
  it('never wraps the content plane in a clipping container', () => {
    render(<HeroFrame>x</HeroFrame>)
    let node: HTMLElement | null = screen.getByTestId('hero-content')
    while (node && node !== document.body) {
      if (node.dataset.testid !== 'hero-root') {
        expect(node.className).not.toContain('overflow-hidden')
      }
      node = node.parentElement
    }
  })
})
