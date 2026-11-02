import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Backdrop } from '../Backdrop'

describe('Backdrop', () => {
  it('renders a full-bleed element with the token background applied', () => {
    render(<Backdrop data-testid="backdrop" />)

    const backdrop = screen.getByTestId('backdrop')
    expect(backdrop.className).toMatch(/fixed/)
    expect(backdrop.className).toMatch(/inset-0/)
    // jsdom's CSSOM normalizes hex colors to rgb() on serialization; #08080b === rgb(8, 8, 11).
    expect(backdrop.style.background).toContain('rgb(8, 8, 11)')
  })
})
