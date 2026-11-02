import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlayerBadge } from '../PlayerBadge'
import { PLAYER_ACCENT_COLORS, colorWithAlpha } from '../colors'
import { withAlpha } from '../../design/tokens'

describe('PlayerBadge', () => {
  it('shows initials over the accent color when there is no avatarUrl', () => {
    render(<PlayerBadge name="Jane Doe" color={PLAYER_ACCENT_COLORS[0]} avatarUrl="" />)

    const badge = screen.getByTestId('player-badge')
    expect(badge).toHaveTextContent('JD')
    expect(badge.querySelector('img')).not.toBeInTheDocument()
  })

  it('shows the avatar image instead of initials when avatarUrl is set', () => {
    render(<PlayerBadge name="Jane Doe" color={PLAYER_ACCENT_COLORS[0]} avatarUrl="app-media://%2Fpath%2Favatar.jpg" />)

    const badge = screen.getByTestId('player-badge')
    const img = badge.querySelector('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'app-media://%2Fpath%2Favatar.jpg')
    expect(badge).not.toHaveTextContent('JD')
  })

  it('sizes itself entirely from a size prop, not a hardcoded pixel value in the component', () => {
    render(<PlayerBadge name="Jane Doe" color={PLAYER_ACCENT_COLORS[0]} avatarUrl="" size={64} />)

    const badge = screen.getByTestId('player-badge')
    expect(badge.style.width).toBe('64px')
    expect(badge.style.height).toBe('64px')
  })

  it('is a flat tint of the profile colour, with no glow', () => {
    render(<PlayerBadge name="Jane Doe" color={PLAYER_ACCENT_COLORS[0]} avatarUrl="" />)

    const badge = screen.getByTestId('player-badge')
    expect(badge.style.background).not.toContain('gradient')
    expect(badge.style.boxShadow).toBe('')
  })
})

describe('colorWithAlpha', () => {
  it('is the design system withAlpha', () => {
    expect(colorWithAlpha).toBe(withAlpha)
    expect(colorWithAlpha('oklch(0.78 0.19 195)', 0.5)).toBe('oklch(0.78 0.19 195 / 0.5)')
  })
})
