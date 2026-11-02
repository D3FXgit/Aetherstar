import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlassToggle } from '../GlassToggle'

describe('GlassToggle', () => {
  it('exposes a real checkbox named by its label', () => {
    render(<GlassToggle label="Reduce effects" checked={false} onChange={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Reduce effects' })).not.toBeChecked()
  })

  it('reflects the checked prop', () => {
    render(<GlassToggle label="Reduce effects" checked onChange={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Reduce effects' })).toBeChecked()
  })

  it('calls onChange with the next value when clicked', () => {
    const onChange = vi.fn()
    render(<GlassToggle label="Perf overlay" checked={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Perf overlay' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange(false) when an already-on toggle is clicked', () => {
    const onChange = vi.fn()
    render(<GlassToggle label="Perf overlay" checked onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Perf overlay' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('is operable from the keyboard', async () => {
    const onChange = vi.fn()
    render(<GlassToggle label="Perf overlay" checked={false} onChange={onChange} />)

    await userEvent.tab()
    expect(screen.getByRole('checkbox', { name: 'Perf overlay' })).toHaveFocus()

    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('forwards extra input props (e.g. data-testid) to the underlying checkbox', () => {
    render(<GlassToggle label="Second screen" checked onChange={() => {}} data-testid="my-toggle" />)
    const toggle = screen.getByTestId('my-toggle')
    expect(toggle).toBeChecked()
    expect(toggle.tagName).toBe('INPUT')
  })

  it('disables the real control (rather than only dimming it) so it cannot be operated', async () => {
    const onChange = vi.fn()
    render(<GlassToggle label="Second screen" checked={false} onChange={onChange} disabled />)

    const toggle = screen.getByRole('checkbox', { name: 'Second screen' })
    expect(toggle).toBeDisabled()

    await userEvent.click(toggle)
    expect(onChange).not.toHaveBeenCalled()
  })
})
