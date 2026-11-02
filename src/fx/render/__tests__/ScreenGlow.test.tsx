import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScreenGlow } from '../ScreenGlow'
import { tokens } from '../../../design/tokens'

describe('ScreenGlow', () => {
  it('renders a glow referencing the given color when active', () => {
    render(<ScreenGlow active color={tokens.accent.gold} />)
    const glow = screen.getByTestId('screen-glow')
    expect(glow.style.boxShadow || glow.style.background).toContain('oklch(0.85 0.16 85')
  })

  it('renders nothing visible when inactive', () => {
    render(<ScreenGlow active={false} color={tokens.accent.gold} />)
    expect(screen.queryByTestId('screen-glow')).not.toBeInTheDocument()
  })
})
