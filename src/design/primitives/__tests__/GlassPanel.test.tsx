import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GlassPanel } from '../GlassPanel'

describe('GlassPanel', () => {
  it('renders its children on a solid surface by default', () => {
    render(<GlassPanel>Hello panel</GlassPanel>)

    const panel = screen.getByText('Hello panel')
    expect(panel).toHaveAttribute('data-surface', 'solid')
    expect(panel.className).toContain('bg-surface-panel')
    expect(panel.className).not.toMatch(/backdrop-blur/)
  })

  it('renders a blurred glass surface when asked for one (over video)', () => {
    render(<GlassPanel variant="glass">Over video</GlassPanel>)
    expect(screen.getByText('Over video').className).toMatch(/backdrop-blur/)
  })
})
