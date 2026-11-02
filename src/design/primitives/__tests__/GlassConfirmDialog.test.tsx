import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlassConfirmDialog } from '../GlassConfirmDialog'

function setup(overrides: Partial<Parameters<typeof GlassConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const result = render(
    <GlassConfirmDialog
      open
      title="Abandon this song?"
      message="The current song will end and the night will go back to the start."
      confirmLabel="Abandon song"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onConfirm, onCancel, ...result }
}

describe('GlassConfirmDialog', () => {
  it('renders nothing while closed', () => {
    setup({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is an accessible modal dialog labelled by its own title and message', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Abandon this song?')
    expect(dialog).toHaveAccessibleDescription(/the night will go back to the start/i)
  })

  // The safe choice takes focus, so a stray A press on a controller cancels
  // rather than throwing the song away.
  it('focuses Cancel, not the destructive action, when it opens', () => {
    setup()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('confines directional focus movement to itself while open', () => {
    setup()
    expect(screen.getByRole('dialog')).toHaveAttribute('data-focus-scope')
  })

  it('calls onConfirm and onCancel from their buttons', async () => {
    const { onConfirm, onCancel } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Abandon song' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('cancels on Escape, and stops the press before any Back handler underneath sees it', async () => {
    const shellBack = vi.fn()
    window.addEventListener('keydown', shellBack)
    try {
      const { onCancel } = setup()
      await userEvent.keyboard('{Escape}')
      expect(onCancel).toHaveBeenCalledOnce()
      expect(shellBack).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', shellBack)
    }
  })
})
