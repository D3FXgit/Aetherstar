import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlassErrorState } from '../GlassErrorState'

describe('GlassErrorState', () => {
  it('renders the title and message', () => {
    render(<GlassErrorState title="Couldn't load media" message="The song's audio file is missing." />)

    expect(screen.getByText("Couldn't load media")).toBeInTheDocument()
    expect(screen.getByText("The song's audio file is missing.")).toBeInTheDocument()
  })

  it('renders a retry button that calls onRetry when both retryLabel and onRetry are given', async () => {
    const onRetry = vi.fn()
    render(<GlassErrorState title="Oops" message="Something went wrong." retryLabel="Retry" onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders no retry button when retryLabel/onRetry are omitted', () => {
    render(<GlassErrorState title="Oops" message="Something went wrong." />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('applies the accent prop to the title, matching every other primitive', () => {
    render(<GlassErrorState title="Oops" message="Something went wrong." accent="gold" />)

    expect(screen.getByText('Oops')).toHaveStyle({ color: 'oklch(0.85 0.16 85)' })
  })

  it('keeps technical details behind a collapsed "Show details" disclosure', () => {
    render(<GlassErrorState title="Oops" message="Try again." details="TypeError: x is undefined" />)

    const details = screen.getByTestId('glass-error-details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Show details')).toBeInTheDocument()
    expect(details).toHaveTextContent('TypeError: x is undefined')
  })

  it('renders no disclosure when there are no details', () => {
    render(<GlassErrorState title="Oops" message="Try again." />)

    expect(screen.queryByTestId('glass-error-details')).not.toBeInTheDocument()
  })
})
