import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlassButton } from '../GlassButton'

describe('GlassButton', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn()
    render(<GlassButton onClick={onClick}>Sing</GlassButton>)

    await userEvent.click(screen.getByRole('button', { name: 'Sing' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  // Menus are solid; glass is reserved for buttons floating over video.
  it('is a solid, unblurred surface by default', () => {
    render(<GlassButton>Sing</GlassButton>)
    const button = screen.getByRole('button', { name: 'Sing' })
    expect(button).toHaveAttribute('data-variant', 'solid')
    expect(button.className).toContain('bg-surface-raised')
    expect(button.className).not.toMatch(/backdrop-blur/)
  })

  it('keeps the glass material as an explicit variant', () => {
    render(<GlassButton variant="glass">Sing</GlassButton>)
    expect(screen.getByRole('button', { name: 'Sing' }).className).toMatch(/backdrop-blur/)
  })

  it('uses the shared press motion instead of its own hover spring', () => {
    render(<GlassButton>Sing</GlassButton>)
    const className = screen.getByRole('button', { name: 'Sing' }).className
    expect(className).toContain('active:scale-[0.97]')
    expect(className).not.toContain('hover:scale-105')
  })
})
