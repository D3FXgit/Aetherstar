import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NeonText } from '../NeonText'

describe('NeonText', () => {
  it('renders its text with the requested accent color applied', () => {
    render(<NeonText accent="cyan">Library</NeonText>)

    const text = screen.getByText('Library')
    expect(text.style.color).toContain('oklch(0.78 0.19 195')
  })

  it('defaults to the coral accent when none is given', () => {
    render(<NeonText>Sing</NeonText>)

    const text = screen.getByText('Sing')
    // jsdom's CSSOM normalizes the numeric literal (0.20 -> 0.2) on serialization.
    expect(text.style.color).toContain('oklch(0.72 0.2 25')
  })

  it('is flat by default and only glows when asked to', () => {
    const { rerender } = render(<NeonText>Sing</NeonText>)
    expect(screen.getByText('Sing').style.textShadow).toBe('')

    rerender(<NeonText glow>Sing</NeonText>)
    expect(screen.getByText('Sing').style.textShadow).not.toBe('')
  })
})
