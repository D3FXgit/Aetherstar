import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AmbientFallback } from '../AmbientFallback'

describe('AmbientFallback', () => {
  it('renders a panning cover image when a cover URL is given', () => {
    render(<AmbientFallback coverUrl="app-media:///abs/fixtures/sample-song/cover.jpg" />)

    const img = screen.getByTestId('stage-ambient-cover')
    expect(img).toHaveAttribute('src', 'app-media:///abs/fixtures/sample-song/cover.jpg')
    expect(img.className).toMatch(/animate-/)
  })

  it('falls back to the token-driven gradient when there is no cover', () => {
    render(<AmbientFallback coverUrl={null} />)

    expect(screen.queryByTestId('stage-ambient-cover')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-gradient')).toBeInTheDocument()
  })
})

describe('AmbientFallback: background, then cover, then gradient', () => {
  const BG = 'app-media://media/song/bg.jpg'
  const COVER = 'app-media://media/song/cover.jpg'

  it('shows #BACKGROUND full screen and sharp when there is one', () => {
    render(<AmbientFallback backgroundUrl={BG} coverUrl={COVER} />)
    const background = screen.getByTestId('stage-ambient-background')
    expect(background).toHaveAttribute('src', BG)
    expect(background.className).toMatch(/object-cover/)
    expect(background.className).not.toMatch(/blur/)
    expect(screen.queryByTestId('stage-ambient-cover')).not.toBeInTheDocument()
  })

  it('falls back to the blurred cover when the background will not load, then to the gradient', () => {
    render(<AmbientFallback backgroundUrl={BG} coverUrl={COVER} />)
    fireEvent.error(screen.getByTestId('stage-ambient-background'))
    const cover = screen.getByTestId('stage-ambient-cover')
    expect(cover.className).toMatch(/blur-/)

    fireEvent.error(cover)
    expect(screen.queryByTestId('stage-ambient-cover')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-gradient')).toBeInTheDocument()
  })

  // The shell's Backdrop is `fixed -z-10` and near-black: behind the stage's
  // own black layer it rendered as a pure black screen.
  it('paints its own tinted gradient rather than the shell backdrop', () => {
    const { container } = render(<AmbientFallback coverUrl={null} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.background).toMatch(/gradient/)
    expect(container.querySelector('.fixed')).toBeNull()
  })
})
