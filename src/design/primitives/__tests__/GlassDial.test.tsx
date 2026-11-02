import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GlassDial } from '../GlassDial'

describe('GlassDial', () => {
  it('renders the label and formatted value text from props', () => {
    render(<GlassDial label="Output latency" value={42} min={0} max={200} unit="ms" />)

    expect(screen.getByText('Output latency')).toBeInTheDocument()
    expect(screen.getByTestId('glass-dial-value')).toHaveTextContent('42 ms')
  })

  it('renders a placeholder when value is null', () => {
    render(<GlassDial label="Input latency" value={null} min={0} max={200} unit="ms" />)

    expect(screen.getByTestId('glass-dial-value')).toHaveTextContent('-- ms')
  })
})
